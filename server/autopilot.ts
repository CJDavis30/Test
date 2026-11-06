import type { ApEvent, EntityType, Finding, GraphNode } from '../shared/types';
import { keyFor, labelFor } from '../shared/normalize';
import type { Service } from './service';
import type { Orchestrator } from './orchestrator';
import { uid, type Store } from './store';
import { isRealWorld } from '../shared/safeguards';
import { careOf } from './safeguards';
import { pivotWorthy } from '../shared/scoring';

/**
 * Autopilot follows the strongest leads on its own and builds the graph while you watch. It is deliberately conservative:
 * it accepts only what several independent sources agree on and nothing disputes, never follows guesses or bare names past the
 * starting point, and leaves everything else pending for you. Everything it accepts is logged, and nothing it does is hidden.
 */

/** Relations that are guesses by nature: never accepted without a human. */
const GUESSES = /possible|similar|namesake|public-figure|same handle|likely location|seen here/;

export function autoAcceptable(f: Finding, o: { care?: boolean } = {}): { ok: boolean; why: string } {
  if (f.status !== 'pending') return { ok: false, why: 'already decided' };
  if (o.care && isRealWorld(f.type)) return { ok: false, why: 'this may involve a young person, so Autopilot will not point toward a real-world identity' };
  if (GUESSES.test(f.relation)) return { ok: false, why: 'a guess, not a fact' };
  if (f.nameOnly || f.basis === 'name-match') return { ok: false, why: 'found only because it shares a name, which proves nothing about who it is' };
  if (f.basis === 'self-reported' && !f.evidence.some((e) => e.kind === 'cross' && e.polarity !== 'against' && (e.basis === 'reciprocal' || e.adapter === 'anchor'))) return { ok: false, why: 'only the profile itself says so; nothing independent backs it up' };
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
    .filter((f) => types.includes(f.type) && !looked.has(`${f.type}:${f.key}`) && !(f.type === 'org' && seedType === 'org') && pivotWorthy(f).ok)
    .sort((a, b) => b.score - a.score);
}

class Feed {
  private ev: ApEvent[] = [];
  private subs = new Set<(e: ApEvent) => void>();
  push(e: ApEvent) { this.ev.push(e); this.subs.forEach((f) => f(e)); }
  subscribe(fn: (e: ApEvent) => void) { for (const e of this.ev) fn(e); this.subs.add(fn); return () => { this.subs.delete(fn); }; }
}

export interface ApOptions { depth?: number; subjects?: number; budgetMs?: number; dryRun?: boolean }

interface Ledger { findings: string[]; nodes: string[]; edges: string[]; undone: boolean }

export class Autopilot {
  private feeds = new Map<string, { feed: Feed; stop: () => void; caseId: string }>();
  private ledgers = new Map<string, Ledger>();
  constructor(private store: Store, private svc: Service, private orch: Orchestrator) {}

  has(id: string) { return this.feeds.has(id); }
  subscribe(id: string, fn: (e: ApEvent) => void) { return this.feeds.get(id)?.feed.subscribe(fn); }
  stop(id: string) { this.feeds.get(id)?.stop(); }

  /** Put everything this run accepted back to pending, and take off the graph what it added. Your own decisions are never touched. */
  undo(id: string): { findings: number; nodes: number } | null {
    const l = this.ledgers.get(id); const e = this.feeds.get(id);
    if (!l || !e || l.undone) return null;
    l.undone = true;
    this.svc.review(l.findings, 'pending');
    for (const x of l.edges) this.store.deleteEdge(x);
    for (const n of l.nodes) { const left = this.store.listEdges(e.caseId).some((x) => x.from === n || x.to === n); if (!left) this.store.patchNode(n, { hidden: true }); }
    this.store.audit(e.caseId, 'autopilot.undone', `${l.findings.length} findings back to pending, ${l.nodes.length} nodes removed`);
    return { findings: l.findings.length, nodes: l.nodes.length };
  }
  active(caseId: string) { return [...this.feeds.entries()].find(([, v]) => v.caseId === caseId && !(v as any).finished)?.[0]; }

  start(seed: GraphNode, opts: ApOptions = {}): string {
    const id = uid('ap_');
    this.ledgers.set(id, { findings: [], nodes: [], edges: [], undone: false });
    const limits = { depth: Math.min(3, Math.max(0, opts.depth ?? 2)), subjects: Math.min(20, Math.max(1, opts.subjects ?? 8)) };
    const feed = new Feed();
    let stopped = false, currentRun: string | undefined;
    const entry = { feed, caseId: seed.caseId, stop: () => { stopped = true; if (currentRun) this.orch.hub.cancel(currentRun); }, finished: false };
    this.feeds.set(id, entry as any);
    setTimeout(() => void this.run(id, seed, limits, opts.budgetMs ?? 4 * 60_000, !!opts.dryRun, feed, () => stopped, (r) => { currentRun = r; }).finally(() => { (entry as any).finished = true; setTimeout(() => this.feeds.delete(id), 15 * 60_000).unref?.(); }), 0);
    return id;
  }

  private async run(id: string, seed: GraphNode, limits: { depth: number; subjects: number }, budgetMs: number, dryRun: boolean, feed: Feed, isStopped: () => boolean, setRun: (r?: string) => void) {
    const { store, svc, orch } = this;
    const t0 = Date.now(), caseId = seed.caseId;
    let accepted = 0, subjects = 0, careNoted = false;
    const looked = new Set<string>([`${seed.type}:${keyFor(seed.type, seed.value)}`]);
    const queue: { node: GraphNode; depth: number; why?: string }[] = [{ node: seed, depth: 0 }];
    const ledger = this.ledgers.get(id)!;
    store.audit(caseId, dryRun ? 'autopilot.dryrun' : 'autopilot.started', `from ${seed.type}:${seed.value} · up to ${limits.subjects} lookups, ${limits.depth} steps deep · accepts only strong, independently confirmed, undisputed findings`);
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
        const care = careOf(store, caseId).youth;
        if (care && !careNoted) { careNoted = true; feed.push({ t: 'ap.step', n: subjects, depth, subject: subj, phase: 'judging', why: 'This may involve a young person: Autopilot will not accept names, numbers, emails or places.' }); }
        const take = fs.filter((f) => autoAcceptable(f, { care }).ok);
        if (take.length && dryRun) {
          accepted += take.length;
          feed.push({ t: 'ap.accepted', subjectId: node.id, labels: take.slice(0, 6).map((f) => labelFor(f.type, f.value, f.attrs)), kept: fs.length - take.length });
        } else if (take.length) {
          const beforeN = new Set(store.listNodes(caseId).map((n) => n.id)), beforeE = new Set(store.listEdges(caseId).map((e) => e.id));
          svc.review(take.map((f) => f.id), 'accepted');
          svc.commit(caseId, node.id);
          ledger.findings.push(...take.map((f) => f.id));
          ledger.nodes.push(...store.listNodes(caseId).map((n) => n.id).filter((x) => !beforeN.has(x)));
          ledger.edges.push(...store.listEdges(caseId).map((e) => e.id).filter((x) => !beforeE.has(x)));
          accepted += take.length;
          store.audit(caseId, 'autopilot.accepted', `${take.length} of ${fs.length} findings for ${node.type}:${node.value}: ${take.slice(0, 8).map((f) => labelFor(f.type, f.value, f.attrs)).join(', ')}${take.length > 8 ? '…' : ''}`);
          feed.push({ t: 'ap.accepted', subjectId: node.id, labels: take.slice(0, 6).map((f) => labelFor(f.type, f.value, f.attrs)), kept: fs.length - take.length });
        } else if (fs.length) feed.push({ t: 'ap.accepted', subjectId: node.id, labels: [], kept: fs.length });
        feed.push({ t: 'ap.graph', nodes: store.listNodes(caseId).length, edges: store.listEdges(caseId).length });

        // Follow the strongest new leads.
        if (depth < limits.depth && !dryRun && !care) {
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
      const summary = { subjects, accepted, pending, nodes: store.listNodes(caseId).length, edges: store.listEdges(caseId).length, seconds: Math.round((Date.now() - t0) / 1000), stopped: isStopped() || undefined, dryRun: dryRun || undefined };
      store.audit(caseId, 'autopilot.finished', `${dryRun ? '[dry run, nothing changed] ' : ''}${subjects} lookups, ${accepted} findings ${dryRun ? 'would be accepted' : 'accepted'}, ${pending} left for review${isStopped() ? ' (stopped by you)' : ''}`);
      feed.push({ t: 'ap.done', summary });
    } catch (e: any) {
      store.audit(caseId, 'autopilot.failed', String(e?.message ?? e).slice(0, 300));
      feed.push({ t: 'ap.error', message: String(e?.message ?? e).slice(0, 300) });
    }
  }
}
