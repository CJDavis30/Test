import type { ApEvent, EntityType, Finding, GraphNode } from '../shared/types';
import { keyFor, labelFor } from '../shared/normalize';
import type { Service } from './service';
import type { Orchestrator } from './orchestrator';
import { uid, type Store } from './store';

/**
 * Autopilot follows the strongest leads on its own and builds the graph while you watch. It is deliberately conservative:
 * it accepts only what several independent sources agree on and nothing disputes, never follows guesses or bare names past the
 * starting point, and leaves everything else pending for you. Everything it accepts is logged, and nothing it does is hidden.
 */

/** Relations that are guesses by nature: never accepted without a human. */
const GUESSES = /possible|similar|namesake|public-figure|same handle|likely location|seen here/;

export function autoAcceptable(f: Finding): { ok: boolean; why: string } {
  if (f.status !== 'pending') return { ok: false, why: 'already decided' };
  if (GUESSES.test(f.relation)) return { ok: false, why: 'a guess, not a fact' };
  if (f.conflictsWith?.length) return { ok: false, why: 'another source disagrees on the same question' };
  if (f.evidence.some((e) => e.polarity === 'against')) return { ok: false, why: 'a cross-check contradicts it' };
  const families = new Set(f.evidence.filter((e) => e.polarity !== 'against').map((e) => e.family)).size;
  if (f.level >= 4 && families >= 2) return { ok: true, why: 'strong and independently confirmed' };
  if (f.level >= 3 && f.score >= 0.75 && families >= 2) return { ok: true, why: 'good, confirmed by two independent sources, and undisputed' };
  return { ok: false, why: 'not enough independent confirmation' };
}

/** Which accepted findings are worth following up? Identifiers that can lead somewhere, not bare names (ambiguous). */
export function pivotCandidates(accepted: Finding[], depth: number, looked: Set<string>, seedType: EntityType): Finding[] {
  const types: EntityType[] = depth === 0 ? ['username', 'email', 'domain', 'org', 'wallet', 'phone'] : ['username', 'email', 'domain', 'wallet'];
  return accepted
    .filter((f) => types.includes(f.type) && !looked.has(`${f.type}:${f.key}`) && !(f.type === 'org' && seedType === 'org'))
    .sort((a, b) => b.score - a.score);
}

class Feed {
  private ev: ApEvent[] = [];
  private subs = new Set<(e: ApEvent) => void>();
  push(e: ApEvent) { this.ev.push(e); this.subs.forEach((f) => f(e)); }
  subscribe(fn: (e: ApEvent) => void) { for (const e of this.ev) fn(e); this.subs.add(fn); return () => { this.subs.delete(fn); }; }
}

export interface ApOptions { depth?: number; subjects?: number; budgetMs?: number }

export class Autopilot {
  private feeds = new Map<string, { feed: Feed; stop: () => void; caseId: string }>();
  constructor(private store: Store, private svc: Service, private orch: Orchestrator) {}

  has(id: string) { return this.feeds.has(id); }
  subscribe(id: string, fn: (e: ApEvent) => void) { return this.feeds.get(id)?.feed.subscribe(fn); }
  stop(id: string) { this.feeds.get(id)?.stop(); }
  active(caseId: string) { return [...this.feeds.entries()].find(([, v]) => v.caseId === caseId && !(v as any).finished)?.[0]; }

  start(seed: GraphNode, opts: ApOptions = {}): string {
    const id = uid('ap_');
    const limits = { depth: Math.min(3, Math.max(0, opts.depth ?? 2)), subjects: Math.min(20, Math.max(1, opts.subjects ?? 8)) };
    const feed = new Feed();
    let stopped = false, currentRun: string | undefined;
    const entry = { feed, caseId: seed.caseId, stop: () => { stopped = true; if (currentRun) this.orch.hub.cancel(currentRun); }, finished: false };
    this.feeds.set(id, entry as any);
    setTimeout(() => void this.run(id, seed, limits, opts.budgetMs ?? 4 * 60_000, feed, () => stopped, (r) => { currentRun = r; }).finally(() => { (entry as any).finished = true; setTimeout(() => this.feeds.delete(id), 15 * 60_000).unref?.(); }), 0);
    return id;
  }

  private async run(id: string, seed: GraphNode, limits: { depth: number; subjects: number }, budgetMs: number, feed: Feed, isStopped: () => boolean, setRun: (r?: string) => void) {
    const { store, svc, orch } = this;
    const t0 = Date.now(), caseId = seed.caseId;
    let accepted = 0, subjects = 0;
    const looked = new Set<string>([`${seed.type}:${keyFor(seed.type, seed.value)}`]);
    const queue: { node: GraphNode; depth: number; why?: string }[] = [{ node: seed, depth: 0 }];
    store.audit(caseId, 'autopilot.started', `from ${seed.type}:${seed.value} · up to ${limits.subjects} lookups, ${limits.depth} steps deep · accepts only strong, independently confirmed, undisputed findings`);
    feed.push({ t: 'ap.start', id, seed: { id: seed.id, label: seed.label, type: seed.type }, limits });
    try {
      while (queue.length && subjects < limits.subjects && !isStopped() && Date.now() - t0 < budgetMs) {
        const { node, depth, why } = queue.shift()!;
        subjects++;
        const subj = { id: node.id, label: node.label, type: node.type };
        feed.push({ t: 'ap.step', n: subjects, depth, subject: subj, phase: 'looking', why });
        const run = orch.start(node, '');
        setRun(run.id);
        await new Promise<void>((resolve) => {
          let off: () => void = () => {}, fin = false, done = 0, total = 0;
          off = orch.hub.subscribe(run.id, (e) => {
            if (e.t === 'run.started') total = e.sources.filter((s) => s.state === 'queued').length;
            if (e.t === 'source') {
              if (e.progress.capability === 'verify') feed.push({ t: 'ap.step', n: subjects, depth, subject: subj, phase: 'checking', why: e.progress.note });
              else if (!['queued', 'running'].includes(e.progress.state)) { done++; feed.push({ t: 'ap.step', n: subjects, depth, subject: subj, phase: 'looking', sources: { done, total } }); }
            }
            if (e.t === 'run.done' || e.t === 'run.error') { fin = true; off(); resolve(); }
          });
          if (fin) off();
        });
        setRun(undefined);
        if (isStopped()) break;

        // Judge: accept only what clears the bar.
        feed.push({ t: 'ap.step', n: subjects, depth, subject: subj, phase: 'judging' });
        const fs = store.listFindings(caseId, { subjectId: node.id });
        const take = fs.filter((f) => autoAcceptable(f).ok);
        if (take.length) {
          svc.review(take.map((f) => f.id), 'accepted');
          svc.commit(caseId, node.id);
          accepted += take.length;
          store.audit(caseId, 'autopilot.accepted', `${take.length} of ${fs.length} findings for ${node.type}:${node.value}: ${take.slice(0, 8).map((f) => labelFor(f.type, f.value, f.attrs)).join(', ')}${take.length > 8 ? '…' : ''}`);
          feed.push({ t: 'ap.accepted', subjectId: node.id, labels: take.slice(0, 6).map((f) => labelFor(f.type, f.value, f.attrs)), kept: fs.length - take.length });
        } else if (fs.length) feed.push({ t: 'ap.accepted', subjectId: node.id, labels: [], kept: fs.length });
        feed.push({ t: 'ap.graph', nodes: store.listNodes(caseId).length, edges: store.listEdges(caseId).length });

        // Follow the strongest new leads.
        if (depth < limits.depth) {
          const breadth = depth === 0 ? 4 : 2;
          for (const f of pivotCandidates(take, depth, looked, seed.type).slice(0, breadth)) {
            const n = store.findNode(caseId, f.type, f.key);
            if (!n) continue;
            looked.add(`${f.type}:${f.key}`);
            queue.push({ node: n, depth: depth + 1, why: `${labelFor(f.type, f.value, f.attrs)} was confirmed by several sources` });
          }
        }
      }
      const pending = store.listFindings(caseId, { status: ['pending', 'unsure'] }).length;
      const summary = { subjects, accepted, pending, nodes: store.listNodes(caseId).length, edges: store.listEdges(caseId).length, seconds: Math.round((Date.now() - t0) / 1000), stopped: isStopped() || undefined };
      store.audit(caseId, 'autopilot.finished', `${subjects} lookups, ${accepted} findings accepted, ${pending} left for review${isStopped() ? ' (stopped by you)' : ''}`);
      feed.push({ t: 'ap.done', summary });
    } catch (e: any) {
      store.audit(caseId, 'autopilot.failed', String(e?.message ?? e).slice(0, 300));
      feed.push({ t: 'ap.error', message: String(e?.message ?? e).slice(0, 300) });
    }
  }
}
