import type {
  Brief, Claim, Evidence, Finding, GraphNode, NextStep, RunEvent, RunInfo, SourceProgress,
} from '../shared/types';
import { displayFor, keyFor, safeHttpUrl } from '../shared/normalize';
import { rescore, ruleBrief, suggestNext } from '../shared/scoring';
import { CAPABILITY_MODE, NeedsKeyError, RateLimitedError, type Adapter } from './adapters/types';
import { makeCtx, Throttle } from './http';
import { adaptersFor, reliabilityFn, usable, priorityOf } from './registry';
import { getSecret } from './config';
import { uid, type Store } from './store';

const MAX_CLAIMS_PER_ADAPTER = 150;

/** Turn low-level fetch errors into something a person can act on. */
export function friendlyError(err: any): string {
  const msg = String(err?.message ?? err);
  const code = String(err?.cause?.code ?? '');
  if (/ENOTFOUND|EAI_AGAIN/.test(code + msg)) return "Couldn't resolve the host (offline or blocked?)";
  if (/ECONNREFUSED|ECONNRESET|UND_ERR|fetch failed|socket|EPIPE/i.test(code + msg)) return "Couldn't connect (offline, blocked, or the service is down)";
  if (/timed out|timeout|aborted/i.test(msg)) return 'Timed out';
  if (/certificate|CERT_|TLS|SSL/i.test(code + msg)) return 'TLS/certificate problem';
  return msg.replace(/^TypeError: /, '').slice(0, 160);
}
const ADAPTER_TIMEOUT_MS = 30_000;
const GLOBAL_CONCURRENCY = 8;

export interface BriefEnhancer {
  (args: { subject: GraphNode; findings: Finding[]; context: string; fallback: Brief; ids: Map<string, string> }): Promise<Brief | null>;
}

class Semaphore {
  private q: (() => void)[] = [];
  private n = 0;
  constructor(private max: number) {}
  async acquire() {
    if (this.n < this.max) { this.n++; return; }
    await new Promise<void>((r) => this.q.push(r));
    this.n++;
  }
  release() { this.n--; this.q.shift()?.(); }
}

/** Short stable citation ids (F1…Fn) for findings, ordered by rank. Shared by rules + AI briefs and the UI. */
export function citationIds(findings: Finding[]): Map<string, string> {
  const m = new Map<string, string>();
  [...findings].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id)).forEach((f, i) => m.set(f.id, `F${i + 1}`));
  return m;
}

export class RunHub {
  private events = new Map<string, RunEvent[]>();
  private subs = new Map<string, Set<(e: RunEvent) => void>>();
  private ctl = new Map<string, AbortController>();
  push(runId: string, e: RunEvent) {
    (this.events.get(runId) ?? this.events.set(runId, []).get(runId)!).push(e);
    this.subs.get(runId)?.forEach((fn) => fn(e));
  }
  /** Replays history, then streams live. Returns unsubscribe. */
  subscribe(runId: string, fn: (e: RunEvent) => void): () => void {
    for (const e of this.events.get(runId) ?? []) fn(e);
    const set = this.subs.get(runId) ?? this.subs.set(runId, new Set()).get(runId)!;
    set.add(fn);
    return () => set.delete(fn);
  }
  has(runId: string) { return this.events.has(runId); }
  setController(runId: string, c: AbortController) { this.ctl.set(runId, c); }
  cancel(runId: string) { this.ctl.get(runId)?.abort(new Error('Cancelled')); }
  /** Keep memory bounded: drop buffered events for a finished run after a while. */
  retire(runId: string, afterMs = 10 * 60_000) {
    setTimeout(() => { this.events.delete(runId); this.subs.delete(runId); this.ctl.delete(runId); }, afterMs).unref?.();
  }
}

export class Orchestrator {
  private throttle = new Throttle();
  private sem = new Semaphore(GLOBAL_CONCURRENCY);
  constructor(private store: Store, public hub: RunHub, private enhance?: BriefEnhancer) {}

  /** Starts a lookup and returns immediately; progress streams through the hub. */
  start(subject: GraphNode, context: string): RunInfo {
    const run = this.store.createRun(subject.caseId, subject.id, context);
    const ctl = new AbortController();
    this.hub.setController(run.id, ctl);
    this.store.audit(subject.caseId, 'lookup.started', `${subject.type}:${subject.value}${context ? ` · context: ${context}` : ''}`);
    void this.execute(run, subject, context, ctl).catch((err) => {
      this.hub.push(run.id, { t: 'run.error', message: String(err?.message ?? err) });
      this.store.finishRun(run.id, 'error', []);
      this.hub.retire(run.id);
    });
    return run;
  }

  private async execute(run: RunInfo, subject: GraphNode, context: string, ctl: AbortController) {
    const { store } = this;
    const key = keyFor(subject.type, subject.value);
    const rel = reliabilityFn(store);

    // Plan: which sources apply, and which are unavailable (so the user can see what they're missing).
    const progress = new Map<string, SourceProgress>();
    const chains = new Map<string, Adapter[]>();
    for (const a of adaptersFor(store, subject.type)) {
      const u = usable(store, a);
      if (!u.ok) {
        if (u.reason === 'needs_key')
          progress.set(a.id, { adapter: a.id, name: a.name, capability: a.capability, state: 'needs_key', count: 0, note: 'Add an API key in Settings to enable' });
        continue;
      }
      progress.set(a.id, { adapter: a.id, name: a.name, capability: a.capability, state: 'queued', count: 0 });
      (chains.get(a.capability) ?? chains.set(a.capability, []).get(a.capability)!).push(a);
    }
    for (const list of chains.values()) list.sort((x, y) => priorityOf(store, x) - priorityOf(store, y));

    this.hub.push(run.id, { t: 'run.started', run, sources: [...progress.values()] });
    const setProgress = (id: string, patch: Partial<SourceProgress>) => {
      const p = { ...progress.get(id)!, ...patch };
      progress.set(id, p);
      this.hub.push(run.id, { t: 'source', progress: p });
    };

    const known = new Map<string, Finding>(store.listFindings(subject.caseId, { subjectId: subject.id }).map((f) => [f.id, f]));
    const byKey = new Map<string, Finding>([...known.values()].map((f) => [`${f.type}|${f.key}`, f]));
    const snapshot = (f: Finding) => `${f.score.toFixed(4)}|${f.rank.toFixed(4)}|${f.evidence.length}|${f.status}|${(f.conflictsWith ?? []).join()}`;
    let before = new Map([...known.values()].map((f) => [f.id, snapshot(f)]));

    const flush = () => {
      const all = [...byKey.values()];
      rescore(all, rel, context);
      const changed: Finding[] = [];
      for (const f of all) {
        const s = snapshot(f);
        if (before.get(f.id) !== s) { changed.push(f); before.set(f.id, s); store.saveFinding(f); }
      }
      if (changed.length) this.hub.push(run.id, { t: 'findings', findings: changed });
    };

    const merge = (a: Adapter, claims: Claim[]) => {
      const now = Date.now();
      for (const c of claims.slice(0, MAX_CLAIMS_PER_ADAPTER)) {
        if (!c.value || !String(c.value).trim()) continue;
        const k = keyFor(c.type, c.value, c.attrs);
        if (!k) continue;
        if (c.type === subject.type && k === key) continue; // never "discover" the subject itself
        const ev: Evidence = {
          id: uid('ev_'), adapter: a.id, adapterName: a.name, family: a.family, url: safeHttpUrl(c.url),
          snippet: c.snippet?.slice(0, 400), retrievedAt: now, weight: Math.min(1, Math.max(0.01, c.weight)),
        };
        const mapKey = `${c.type}|${k}`;
        let f = byKey.get(mapKey);
        if (!f) {
          f = {
            id: uid('f_'), caseId: subject.caseId, runId: run.id, subjectId: subject.id, type: c.type,
            value: displayFor(c.type, c.value), key: k, relation: c.relation, attrs: { ...(c.attrs ?? {}) },
            evidence: [ev], score: 0, rank: 0, level: 1, reasons: [], status: 'pending', conflictKey: c.conflictKey,
            when: c.when, createdAt: now,
          };
          byKey.set(mapKey, f);
        } else {
          if (!f.evidence.some((e) => e.adapter === a.id && e.url === ev.url)) f.evidence.push(ev);
          f.attrs = { ...(c.attrs ?? {}), ...f.attrs };
          f.conflictKey = f.conflictKey ?? c.conflictKey;
          if (c.when && (!f.when || c.when < f.when)) f.when = c.when;
          f.runId = run.id;
        }
      }
    };

    const runOne = async (a: Adapter): Promise<number> => {
      const cacheKey = `${a.id}|${subject.type}|${key}`;
      const t0 = Date.now();
      setProgress(a.id, { state: 'running' });
      await this.sem.acquire();
      try {
        if (ctl.signal.aborted) throw new Error('Cancelled');
        const cached = store.cacheGet<Claim[]>(cacheKey);
        let claims: Claim[];
        if (cached) {
          claims = cached;
        } else {
          await this.throttle.wait(a.id, a.minIntervalMs ?? 0);
          const sig = AbortSignal.any([ctl.signal, AbortSignal.timeout(ADAPTER_TIMEOUT_MS)]);
          claims = await this.withRetry(() => a.run({ type: subject.type, value: subject.value, key }, makeCtx(sig, getSecret(a.id))), sig);
          store.cachePut(cacheKey, a.cacheTtlMs ?? 6 * 3600_000, claims);
        }
        const ms = Date.now() - t0;
        store.recordSource(a.id, true, ms);
        merge(a, claims);
        flush();
        const n = claims.length;
        setProgress(a.id, { state: n ? 'done' : 'empty', count: n, ms, cached: !!cached });
        return n;
      } catch (err: any) {
        const ms = Date.now() - t0;
        const msg = String(err?.message ?? err);
        if (err instanceof RateLimitedError) {
          store.recordSource(a.id, false, ms, 'Rate limited');
          setProgress(a.id, { state: 'rate_limited', ms, error: 'Rate limited — fell back to the next source' });
        } else if (err instanceof NeedsKeyError) {
          setProgress(a.id, { state: 'needs_key', ms, error: msg });
        } else {
          const clean = ctl.signal.aborted ? 'Cancelled' : friendlyError(err);
          store.recordSource(a.id, false, ms, clean);
          setProgress(a.id, { state: 'error', ms, error: clean });
        }
        return -1;
      } finally {
        this.sem.release();
      }
    };

    const runChain = async (cap: string, list: Adapter[]) => {
      if ((CAPABILITY_MODE[cap] ?? 'all') === 'all') {
        await Promise.all(list.map(runOne));
        return;
      }
      let answered: Adapter | null = null;
      for (const a of list) {
        if (ctl.signal.aborted) break;
        if (answered) {
          setProgress(a.id, { state: 'skipped', note: `Not needed — ${answered.name} answered` });
          continue;
        }
        const n = await runOne(a);
        if (n > 0) answered = a;
      }
    };

    await Promise.all([...chains.entries()].map(([cap, list]) => runChain(cap, list)));
    flush();

    // Brief + next steps from everything now known for this subject.
    const finalFindings = [...byKey.values()];
    const ids = citationIds(finalFindings);
    const nodeKeys = new Set(store.listNodes(subject.caseId).map((n) => `${n.type}:${keyFor(n.type, n.value)}`));
    const next: NextStep[] = suggestNext(finalFindings, nodeKeys);
    const rules = ruleBrief({ type: subject.type, value: subject.value }, finalFindings, ids);
    this.hub.push(run.id, { t: 'brief', brief: rules, next });
    if (this.enhance && !ctl.signal.aborted && finalFindings.length) {
      try {
        const ai = await this.enhance({ subject, findings: finalFindings, context, fallback: rules, ids });
        if (ai) this.hub.push(run.id, { t: 'brief', brief: ai, next });
      } catch { /* AI is optional; the rules brief already shipped */ }
    }

    const sources = [...progress.values()];
    const ok = sources.filter((s) => s.state === 'done' || s.state === 'empty').length;
    store.finishRun(run.id, 'done', sources);
    store.audit(subject.caseId, 'lookup.finished', `${subject.type}:${subject.value} · ${finalFindings.length} findings · ${ok}/${sources.length} sources ok · sources: ${sources.filter((s) => s.state !== 'needs_key' && s.state !== 'skipped').map((s) => `${s.adapter}=${s.state}`).join(', ')}`);
    const done: RunInfo = { ...run, status: 'done', finishedAt: Date.now() };
    this.hub.push(run.id, { t: 'run.done', run: done, totals: { findings: finalFindings.length, sources: sources.length, ok } });
    this.hub.retire(run.id);
  }

  private async withRetry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      const transient = !(e instanceof RateLimitedError) && !signal.aborted && /fetch failed|ECONN|ETIMEDOUT|HTTP 5\d\d|socket/i.test(String(e?.message ?? e) + String(e?.cause?.code ?? '')) && !/ENOTFOUND|EAI_AGAIN/.test(String(e?.cause?.code ?? ''));
      if (!transient) throw e;
      await new Promise((r) => setTimeout(r, 600));
      return fn();
    }
  }
}
