import type {
  Brief, Claim, CrossCheck, EntityType, Evidence, Finding, GraphNode, NextStep, RunEvent, RunInfo, SourceProgress,
} from '../shared/types';
import { displayFor, keyFor, labelFor, nameSimilarity, safeHttpUrl } from '../shared/normalize';
import { rescore, ruleBrief, suggestNext } from '../shared/scoring';
import { CAPABILITY_MODE, NeedsKeyError, RateLimitedError, type Adapter } from './adapters/types';
import { makeCtx, Throttle } from './http';
import { adaptersFor, reliabilityFn, usable, priorityOf } from './registry';
import { getSecret } from './config';
import { uid, type Store } from './store';
import { howFor, lookupUrl } from './adapters/how';
import { fingerprint } from './integrity';
import { contextFor, applyAnchorEvidence } from './anchors';
import { breaker, PausedError } from './breaker';
import { noticeYouth } from './safeguards';
import { learnIds } from './idclocks';

const MAX_CLAIMS_PER_ADAPTER = 150;
const CROSS_ID = 'cross-check';
const MAX_CROSSCHECK = 8;               // findings cross-checked per lookup
const MAX_CALLS_PER_CANDIDATE = 3;     // other sources asked about each one
const CROSSCHECK_BUDGET_MS = 25_000;   // the whole pass never holds the results hostage
const NO_CROSSCHECK = new Set(['username-sweep', 'derive', 'wikidata', 'phone-offline', 'blockstream']);

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
    const snapshot = (f: Finding) => `${f.score.toFixed(4)}|${f.rank.toFixed(4)}|${f.evidence.length}|${(f.checks ?? []).length}|${f.status}|${(f.conflictsWith ?? []).join()}`;
    let before = new Map([...known.values()].map((f) => [f.id, snapshot(f)]));

    // what the investigator already knows (checked against every finding) and what other starting points found (second routes)
    const anchorCtx = contextFor(store, subject.caseId);
    const otherFindings = store.listFindings(subject.caseId).filter((f) => f.subjectId !== subject.id && f.status !== 'rejected');
    const flush = () => {
      const all = [...byKey.values()];
      if (anchorCtx.anchors.length || otherFindings.length) {
        const touched = applyAnchorEvidence(all, otherFindings, anchorCtx).filter((f) => !byKey.has(`${f.type}|${f.key}`) || f.subjectId !== subject.id);
        if (touched.length) {
          // re-score each affected lookup as a whole, so conflicts between its findings are still judged against each other
          const groups = new Map<string, Finding[]>();
          for (const t of touched) groups.set(t.subjectId, otherFindings.filter((o) => o.subjectId === t.subjectId));
          for (const g of groups.values()) rescore(g, rel, '');
          for (const t of touched) store.saveFinding(t);
          this.hub.push(run.id, { t: 'findings', findings: touched });
        }
      }
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
        const ev: Evidence = fingerprint({
          id: uid('ev_'), adapter: a.id, adapterName: a.name, family: a.family, url: safeHttpUrl(c.url) ?? lookupUrl(a.id, subject.type, subject.value), urlKind: safeHttpUrl(c.url) ? 'record' : lookupUrl(a.id, subject.type, subject.value) ? 'lookup' : undefined,
          snippet: c.snippet?.slice(0, 400), how: (c.how ?? howFor(a.id, subject.type, subject.value))?.slice(0, 240), kind: 'direct', record: c.record, retrievedAt: now, weight: Math.min(1, Math.max(0.01, c.weight)),
        });
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
      const t0 = Date.now();
      setProgress(a.id, { state: 'running' });
      await this.sem.acquire();
      try {
        if (ctl.signal.aborted) throw new Error('Cancelled');
        const { claims, cached } = await this.fetchClaims(a, subject.type, subject.value, ctl.signal);
        const ms = Date.now() - t0;
        store.recordSource(a.id, true, ms);
        learnIds(store, claims);
        const care = noticeYouth(store, subject.caseId, claims, a.name);
        if (care) this.hub.push(run.id, { t: 'care', reasons: care.reasons });
        merge(a, claims);
        flush();
        const n = claims.length;
        setProgress(a.id, { state: n ? 'done' : 'empty', count: n, ms, cached });
        return n;
      } catch (err: any) {
        const ms = Date.now() - t0;
        const msg = String(err?.message ?? err);
        if (err instanceof PausedError) {
          setProgress(a.id, { state: 'skipped', ms, note: `Paused: it failed ${err.fails} times in a row. Trying again at ${new Date(err.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` });
        } else if (err instanceof RateLimitedError) {
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

    // Second pass: don't take first answers on trust. Ask other sources about what we found and see whether it holds together.
    if (!ctl.signal.aborted && store.getSetting<boolean>('crossCheck', true)) {
      const subjectLabel = labelFor(subject.type, subject.value);
      const stats = await this.crossCheck({
        subject, subjectKey: key, subjectLabel, ctl, byKey, flush,
        onProgress: (patch) => { if (!progress.has(CROSS_ID)) progress.set(CROSS_ID, { adapter: CROSS_ID, name: 'Cross-checking findings', capability: 'verify', state: 'running', count: 0 }); setProgress(CROSS_ID, patch); },
      });
      void stats;
    }

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

  /** One source, one question, cached and rate-limited. Shared by the main lookup and the cross-check pass. */
  private async fetchClaims(a: Adapter, type: EntityType, value: string, signal: AbortSignal): Promise<{ claims: Claim[]; cached: boolean }> {
    const key = keyFor(type, value);
    const cacheKey = `${a.id}|${type}|${key}`;
    const hit = this.store.cacheGet<Claim[]>(cacheKey);
    if (hit) return { claims: hit, cached: true };
    const gate = breaker.allow(a.id);
    if (!gate.ok) throw new PausedError(gate.until, gate.fails);
    await this.throttle.wait(a.id, a.minIntervalMs ?? 0);
    const sig = AbortSignal.any([signal, AbortSignal.timeout(a.timeoutMs ?? ADAPTER_TIMEOUT_MS)]);
    let claims: Claim[];
    try {
      claims = await this.withRetry(() => a.run({ type, value, key }, makeCtx(sig, getSecret(a.id))), sig);
    } catch (e: any) {
      // Only a genuine failure of the source counts against it; a cancelled run, a rate limit or a missing key says nothing about its health.
      if (e instanceof RateLimitedError || e instanceof NeedsKeyError || signal.aborted) breaker.neutral(a.id); else breaker.failure(a.id);
      throw e;
    }
    breaker.success(a.id);
    this.store.cachePut(cacheKey, a.cacheTtlMs ?? 6 * 3600_000, claims);
    return { claims, cached: false };
  }

  /**
   * Cross-check: for each promising finding, ask OTHER sources about it and compare the answer with everything we know.
   *  - link back:   the answer mentions what you searched              → strong support
   *  - shared:      the answer shows a detail we found elsewhere       → support for both findings
   *  - contradicts: the answer shows a different name/place/employer   → counts against it
   * Every piece of evidence added here quotes what the other source actually returned. Nothing is inferred without a match.
   */
  private async crossCheck(o: {
    subject: GraphNode; subjectKey: string; subjectLabel: string; ctl: AbortController; byKey: Map<string, Finding>; flush: () => void;
    onProgress: (patch: Partial<SourceProgress>) => void;
  }): Promise<{ checked: number; added: number }> {
    const { store } = this;
    const { subject, subjectKey, subjectLabel, ctl, byKey } = o;
    const identityish = ['email', 'person', 'username', 'org'].includes(subject.type);
    const candTypes = new Set<EntityType>(['username', 'email', 'wallet', ...(identityish ? (['domain'] as EntityType[]) : [])]);
    const cands = [...byKey.values()]
      .filter((f) => f.status !== 'rejected' && candTypes.has(f.type) && f.score >= 0.12 && !(f.type === subject.type && f.key === subjectKey))
      .sort((a, b) => b.rank - a.rank).slice(0, MAX_CROSSCHECK);
    if (!cands.length) return { checked: 0, added: 0 };

    o.onProgress({ state: 'running', note: `0 of ${cands.length}` });
    const crossSig = AbortSignal.any([ctl.signal, AbortSignal.timeout(CROSSCHECK_BUDGET_MS)]);
    const now = Date.now();
    let done = 0, added = 0;
    const seen = new Set<string>();
    const known = (type: EntityType) => [...byKey.values()].filter((g) => g.type === type && g.status !== 'rejected' && g.score >= 0.45).map((g) => g.value);
    const push = (target: Finding, ev: Evidence, result: CrossCheck['result'], note: string, via: Finding) => {
      const dedupe = `${target.id}|${ev.adapter}|${via.id}|${ev.polarity ?? 'for'}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      // the same source saying the same thing again (about a different username, say) adds clutter, not information
      if (target.evidence.some((e) => e.adapter === ev.adapter && e.snippet === ev.snippet && (e.polarity ?? 'for') === (ev.polarity ?? 'for'))) return;
      target.evidence.push(ev);
      (target.checks ??= []).push({ adapter: ev.adapter, source: ev.adapterName, result, note });
      added++;
    };

    // Phase 1: ask. Gather every answer first so judging does not depend on which request happened to finish first.
    const gathered = await Promise.all(cands.map(async (f) => {
      const groups = new Map<string, Adapter[]>();
      for (const a of adaptersFor(store, f.type)) {
        if (!usable(store, a).ok || NO_CROSSCHECK.has(a.id)) continue;
        (groups.get(a.capability) ?? groups.set(a.capability, []).get(a.capability)!).push(a);
      }
      for (const l of groups.values()) l.sort((x, y) => priorityOf(store, x) - priorityOf(store, y));
      const answers: { a: Adapter; claims: Claim[] }[] = [];
      let calls = 0;
      for (const [cap, list] of groups) {
        for (const a of list) {
          if (calls >= MAX_CALLS_PER_CANDIDATE || crossSig.aborted) break;
          await this.sem.acquire();
          try {
            const r = await this.fetchClaims(a, f.type, f.value, crossSig);
            calls++;
            if (r.claims.length) answers.push({ a, claims: r.claims });
            else (f.checks ??= []).push({ adapter: a.id, source: a.name, result: 'neutral', note: 'Nothing found there for this.' });
            if ((CAPABILITY_MODE[cap] ?? 'all') === 'first' && r.claims.length) break;
          } catch { (f.checks ??= []).push({ adapter: a.id, source: a.name, result: 'failed', note: 'Could not be reached.' }); calls++; }
          finally { this.sem.release(); }
        }
      }
      done++;
      o.onProgress({ state: 'running', note: `${done} of ${cands.length}` });
      return { f, answers, via: { findingId: f.id, label: labelFor(f.type, f.value, f.attrs) } };
    }));

    const mkEvidence = (a: Adapter, f: Finding, via: { findingId: string; label: string }, c: Claim, w: number, polarity: 'for' | 'against', verdict: string): Evidence => fingerprint({
      id: uid('ev_'), adapter: a.id, adapterName: a.name, family: a.family, url: safeHttpUrl(c.url) ?? lookupUrl(a.id, f.type, f.value), urlKind: safeHttpUrl(c.url) ? 'record' : lookupUrl(a.id, f.type, f.value) ? 'lookup' : undefined, snippet: c.snippet?.slice(0, 400),
      how: `${howFor(a.id, f.type, f.value) ?? `Asked ${a.name}`} (to check a ${f.type} found for ${subjectLabel})`.slice(0, 260),
      kind: 'cross', polarity, record: c.record, verdict, via, retrievedAt: now, weight: Math.min(0.95, Math.max(0.05, w)),
    });
    const matched = new Map<string, Set<string>>(); // `${findingId}|${adapterId}` -> keys the answer already matched

    // Phase 2: confirmations. A link back to what you searched, or a detail we also found elsewhere.
    for (const { f, answers, via } of gathered) {
      for (const { a, claims } of answers) {
        const keys = new Set<string>();
        matched.set(`${f.id}|${a.id}`, keys);
        let confirmed = false;
        for (const c of claims.slice(0, 200)) {
          const ck = keyFor(c.type, c.value, c.attrs);
          if (!ck) continue;
          if (c.type === subject.type && ck === subjectKey) {
            keys.add(`${c.type}|${ck}`);
            push(f, mkEvidence(a, f, via, c, 0.55 + c.weight * 0.4, 'for', `It lists ${subjectLabel} (${c.relation}).`), 'confirms', `Links back to ${subjectLabel}.`, f);
            confirmed = true;
            continue;
          }
          const g = byKey.get(`${c.type}|${ck}`);
          // A namesake or a famous person with a similar name is a warning, not a fact to be corroborated.
          if (g && g.id !== f.id && g.status !== 'rejected' && !/namesake|public-figure/.test(g.relation)) {
            keys.add(`${c.type}|${ck}`);
            const shown = labelFor(c.type, c.value, c.attrs);
            push(f, mkEvidence(a, f, via, c, c.weight * 0.75, 'for', `It also shows ${shown}, which we found for ${subjectLabel} too.`), 'confirms', `Also shows ${shown}.`, f);
            push(g, mkEvidence(a, f, via, c, c.weight * 0.75, 'for', `Shown on this source's record for “${via.label}”, which we found for ${subjectLabel}.`), 'confirms', `Shown on the record for “${via.label}”.`, f);
            confirmed = true;
          }
        }
        if (!confirmed) (f as Finding & { _unconfirmed?: Set<string> })._unconfirmed = (f as Finding & { _unconfirmed?: Set<string> })._unconfirmed ?? new Set(), (f as Finding & { _unconfirmed?: Set<string> })._unconfirmed!.add(a.id);
      }
    }
    o.flush(); // re-score now, so contradictions are judged against what the confirmations established

    // Phase 3: contradictions. A different name, place or employer than the ones we are now fairly sure of.
    for (const { f, answers, via } of gathered) {
      for (const { a, claims } of answers) {
        const keys = matched.get(`${f.id}|${a.id}`) ?? new Set<string>();
        let contradicted = false;
        for (const type of ['person', 'location', 'org'] as const) {
          const theirs = claims.filter((c) => c.type === type && !keys.has(`${c.type}|${keyFor(c.type, c.value, c.attrs)}`) && !/namesake|public-figure/.test(c.relation));
          const mine = [...known(type), ...(subject.type === type ? [subject.value] : [])];
          if (!theirs.length || !mine.length) continue;
          const c = theirs[0];
          const best = mine.map((m) => ({ m, sim: nameSimilarity(c.value, m) })).sort((x, y) => y.sim - x.sim)[0];
          if (best.sim >= (type === 'location' ? 0.88 : 0.9)) continue;
          push(f, mkEvidence(a, f, via, c, type === 'person' ? 0.75 : 0.5, 'against', `It shows the ${type === 'org' ? 'employer' : type} “${labelFor(c.type, c.value)}”, which does not match “${best.m}”.`), 'contradicts', `Shows “${labelFor(c.type, c.value)}” instead of “${best.m}”.`, f);
          contradicted = true;
        }
        const unconfirmed = (f as Finding & { _unconfirmed?: Set<string> })._unconfirmed?.has(a.id);
        if (unconfirmed && !contradicted) (f.checks ??= []).push({ adapter: a.id, source: a.name, result: 'neutral', note: 'Found a record, but nothing in it confirms or contradicts the link.' });
      }
      delete (f as Finding & { _unconfirmed?: Set<string> })._unconfirmed;
    }
    o.onProgress({ state: added ? 'done' : 'empty', count: added, note: `Checked ${cands.length} finding${cands.length > 1 ? 's' : ''} against other sources` });
    o.flush();
    return { checked: cands.length, added };
  }

  private async withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, delays = [500, 1500]): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e: any) {
        const text = String(e?.message ?? e) + String(e?.cause?.code ?? '');
        const transient = !(e instanceof RateLimitedError) && !(e instanceof NeedsKeyError) && !signal.aborted && /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|HTTP 5\d\d|socket|network/i.test(text) && !/ENOTFOUND/i.test(text);
        if (!transient || i >= delays.length) throw e;
        await new Promise((r) => setTimeout(r, delays[i] * (0.75 + Math.random() * 0.5)));
      }
    }
  }
}
