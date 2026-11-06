import type { Evidence, Finding, GraphNode } from '../shared/types';
import { factsOf, matchAnchors, mentionOfSubject, anchorOf, isKnown, isAnchorNode, type Anchor } from '../shared/anchors';
import { fingerprint } from './integrity';
import { uid } from './store';
import type { Store } from './store';

/** The knowledge the investigator supplied, as things new findings are checked against. */
export const loadAnchors = (store: Store, caseId: string): Anchor[] => store.listNodes(caseId).filter(isAnchorNode).map(anchorOf);

const WHO = 'What you told Plexus';
const label = (a: Anchor) => `${a.type}: ${a.value}`;

export interface AnchorContext {
  anchors: Anchor[];
  /** the node each finding was looked up from, so a finding is never "matched" to the very thing that was searched */
  subjectAnchors: Map<string, Anchor>;
  subjectLabel: (subjectId: string) => string;
  /** how much a route counts: finding the same thing from a second known fact is strong, from an ordinary seed less so */
  routeWeight: (subjectId: string) => number;
}

/**
 * Add (or refresh) the evidence that comes from what the investigator already knows:
 *   - matches: this finding mentions their email / phone / username / name…  (or, for a different name, counts against)
 *   - routes: the same thing was also reached starting from a different fact, an independent route to the same place
 * It is safe to run repeatedly: earlier results of this kind are removed first. Returns every finding it changed.
 */
export function applyAnchorEvidence(findings: Finding[], others: Finding[], ctx: AnchorContext, now = Date.now()): Finding[] {
  const touched = new Set<Finding>();
  const strip = (f: Finding) => { const n = f.evidence.length; f.evidence = f.evidence.filter((e) => e.adapter !== 'anchor'); if (f.checks) f.checks = f.checks.filter((c) => c.adapter !== 'anchor'); return n !== f.evidence.length; };
  for (const f of findings) if (strip(f)) touched.add(f);
  const anchorById = new Map(ctx.anchors.map((a) => [a.id, a]));

  const mk = (f: Finding, family: string, polarity: 'for' | 'against', weight: number, how: string, saw: string, title: string, facts: [string, string][], verdict: string): Evidence => fingerprint({
    id: uid('ev_'), adapter: 'anchor', adapterName: WHO, family, url: f.evidence.find((e) => e.url && e.urlKind !== 'lookup')?.url, urlKind: 'record',
    snippet: saw.slice(0, 300), how, kind: 'cross', polarity, record: { title, facts }, verdict, retrievedAt: now, weight: Math.min(0.97, Math.max(0.05, weight)),
  });

  for (const f of findings) {
    if (f.status === 'rejected') continue;
    const sub = ctx.subjectAnchors.get(f.subjectId);
    const anchors = ctx.anchors.filter((a) => !(sub && a.type === sub.type && a.key === sub.key));
    if (anchors.length || sub) {
      const facts = factsOf(f, findings.filter((g) => g !== f && g.subjectId === f.subjectId));
      const live = f.evidence.some((e) => e.basis && e.adapter !== 'anchor'); // only live lookups carry a basis; simulated and offline runs stay as they were
      const own = live && sub ? mentionOfSubject(facts, sub) : null;
      const hits = own ? [...matchAnchors(facts, anchors), own] : matchAnchors(facts, anchors);
      for (const h of hits) {
        const a = anchorById.get(h.anchorId) ?? sub!;
        const verdict = /^(its|their|the)\b/i.test(h.how) ? `${h.how[0].toUpperCase()}${h.how.slice(1)}.` : `It ${h.how}.`;
        f.evidence.push(mk(f, `anchor:${a.id}`, h.against ? 'against' : 'for', h.weight, `Compared with something you told Plexus (${label(a)})`, h.saw, h.against ? 'Does not match something you know' : 'Matches something you know', [['You told Plexus', label(a)], ['Found here', h.saw], ['Why it counts', h.how.charAt(0).toUpperCase() + h.how.slice(1)]], verdict));
        if (live && !h.against && h.basis) { const ev = f.evidence[f.evidence.length - 1]; ev.basis = h.basis; ev.cap = h.cap; }
        (f.checks ??= []).push({ adapter: 'anchor', source: WHO, result: h.against ? 'contradicts' : 'confirms', note: h.how.charAt(0).toUpperCase() + h.how.slice(1) + '.' });
        touched.add(f);
      }
    }
  }

  // routes: the same thing reached from a different starting point
  const index = new Map<string, Finding[]>();
  for (const o of others) if (o.status !== 'rejected') (index.get(`${o.type}|${o.key}`) ?? index.set(`${o.type}|${o.key}`, []).get(`${o.type}|${o.key}`)!).push(o);
  const addRoute = (target: Finding, via: Finding) => {
    const family = `route:${via.subjectId}`;
    if (target.evidence.some((e) => e.adapter === 'anchor' && e.family === family)) return;
    const from = ctx.subjectLabel(via.subjectId);
    target.evidence.push(mk(target, family, 'for', ctx.routeWeight(via.subjectId), `Looked up separately starting from ${from}`, `Also found starting from ${from}`, 'Reached from a second starting point', [['Also found from', from], ['What it shows', `${via.type}: ${via.value}`]], `It was also found when starting from ${from}, a separate route to the same thing.`));
    (target.checks ??= []).push({ adapter: 'anchor', source: WHO, result: 'confirms', note: `Also found starting from ${from}.` });
    touched.add(target);
  };
  for (const f of findings) {
    if (f.status === 'rejected') continue;
    for (const o of index.get(`${f.type}|${f.key}`) ?? []) {
      if (o === f || o.subjectId === f.subjectId) continue;
      addRoute(f, o); addRoute(o, f);
    }
  }
  return [...touched];
}

export function contextFor(store: Store, caseId: string): AnchorContext {
  const nodes = store.listNodes(caseId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const anchors = nodes.filter(isAnchorNode).map(anchorOf);
  return {
    anchors, subjectAnchors: new Map(nodes.map((n) => [n.id, anchorOf(n)])),
    subjectLabel: (id) => { const n = byId.get(id); return n ? (n.label || n.value) : 'another starting point'; },
    routeWeight: (id) => { const n = byId.get(id); return n && isKnown(n) ? 0.7 : n?.state === 'confirmed' ? 0.55 : 0.4; },
  };
}
export type { GraphNode };
