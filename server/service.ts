import type { Finding, FindingStatus, GraphEdge, GraphNode, CaseSnapshot, EntityType } from '../shared/types';
import { keyFor, displayFor, labelFor } from '../shared/normalize';
import { detect } from '../shared/detect';
import { uid, type Store } from './store';
import { reliabilityFn } from './registry';
import { rescore } from '../shared/scoring';
import { careOf } from './safeguards';
import { factsOf, matchAnchors, anchorOf, isKnown, isAnchorNode, shortLabel, type Anchor } from '../shared/anchors';
import { ROLE_ATTR_KEYS, roleFromAttrs, roleToAttrs, trustFactor, type HandleRole } from '../shared/handles';
import { contextFor, applyAnchorEvidence } from './anchors';

export class Service {
  constructor(public store: Store) {}

  snapshot(caseId: string): CaseSnapshot | null {
    const c = this.store.getCase(caseId);
    if (!c) return null;
    return {
      case: { ...c, care: careOf(this.store, caseId) },
      nodes: this.store.listNodes(caseId),
      edges: this.store.listEdges(caseId),
      findings: this.store.listFindings(caseId, { status: ['pending', 'unsure'] }),
    };
  }

  /** Create (or reuse) a seed node for something the user typed. */
  seed(caseId: string, input: { type?: EntityType; value: string; near?: { x: number; y: number }; role?: HandleRole }): GraphNode | null {
    const d = input.type ? { type: input.type, value: displayFor(input.type, input.value) } : detect(input.value);
    if (!d) return null;
    const key = keyFor(d.type, d.value);
    const existing = this.store.findNode(caseId, d.type, key);
    if (existing) return input.role && d.type === 'username' ? (this.setRole(existing.id, input.role) ?? existing) : existing;
    const n = this.store.upsertNode({ caseId, type: d.type, value: d.value, key, state: 'seed', x: input.near?.x, y: input.near?.y });
    this.store.audit(caseId, 'node.added', `${n.type}:${n.value}`);
    return input.role && d.type === 'username' ? (this.setRole(n.id, input.role) ?? n) : n;
  }

  /**
   * Say what a username IS (a Roblox username, a Discord display name, an alt…), where it came from and how sure you are. Plexus then
   * looks it up where it belongs, treats every other service as "same name only", and checks other finds against it. Pass null to clear.
   */
  setRole(nodeId: string, role: HandleRole | null): GraphNode | null {
    const n = this.store.getNode(nodeId); if (!n) return null;
    for (const k of [...ROLE_ATTR_KEYS, 'handleSearch']) this.store.setNodeAttr(nodeId, k, undefined);
    if (role) for (const [k, v] of Object.entries(roleToAttrs(role))) this.store.setNodeAttr(nodeId, k, v);
    this.store.audit(n.caseId, role ? 'handle.role' : 'handle.role.cleared', `${n.value}: ${role ? `${role.platform ?? 'platform unspecified'} ${role.kind}, ${role.trust}${role.origin ? `, from ${role.origin}` : ''}${role.alt ? ', alt' : ''}` : 'cleared'}`);
    if (role?.alt) this.linkAlt(n.caseId, nodeId);
    this.reapplyAnchors(n.caseId);
    return this.store.getNode(nodeId);
  }

  /** An alt account belongs to the same person as the handles you already described: say so on the graph, at the strength you believe it. */
  private linkAlt(caseId: string, nodeId: string): GraphEdge | null {
    const me = this.store.getNode(nodeId); if (!me) return null;
    const hub = this.store.listNodes(caseId).filter((x) => x.id !== nodeId && isAnchorNode(x)).sort((a, b) => Number(isKnown(b)) - Number(isKnown(a)) || a.createdAt - b.createdAt)[0];
    if (!hub) return null;
    return this.store.upsertEdge({ caseId, from: hub.id, to: nodeId, label: 'alt account (as you described it)', strength: Math.max(0.3, trustFactor(roleFromAttrs(me.attrs))), kind: 'manual', why: 'You said this is an alternate account of the same person.' });
  }

  /** Apply a review decision and keep the per-source accuracy statistics honest (including undo). */
  review(ids: string[], status: FindingStatus): Finding[] {
    const out: Finding[] = [];
    this.store.tx(() => {
      for (const id of ids) {
        const f = this.store.getFinding(id);
        if (!f || f.status === status) continue;
        const adapters = [...new Set(f.evidence.map((e) => e.adapter))].filter((a) => a !== 'anchor');
        for (const a of adapters) {
          if (f.status === 'accepted') this.store.bumpFeedback(a, f.type, 'accepted', -1);
          if (f.status === 'rejected') this.store.bumpFeedback(a, f.type, 'rejected', -1);
          if (status === 'accepted') this.store.bumpFeedback(a, f.type, 'accepted', 1);
          if (status === 'rejected') this.store.bumpFeedback(a, f.type, 'rejected', 1);
        }
        this.store.setFindingStatus(id, status);
        f.status = status;
        out.push(f);
      }
    });
    if (out.length) {
      const first = out[0];
      this.store.audit(first.caseId, 'review', `${status} × ${out.length}${out.length === 1 ? ` (${first.type}:${first.value})` : ''}`);
    }
    return out;
  }

  /**
   * Which matches are specific enough to draw a line for. A shared email, phone, wallet, profile or handle says "these are tied"; a shared company,
   * place, domain or common name only says "these overlap", and drawing all of those turns the graph into a hairball.
   */
  private static readonly DRAW = new Set(['email', 'phone', 'wallet', 'same-account', 'link', 'handle', 'display-name']);
  private static readonly MAX_JOINS = 3;
  private static strong(hits: ReturnType<typeof matchAnchors>) {
    return hits.filter((h) => !h.against && h.weight >= 0.6 && h.hits.some((x) => Service.DRAW.has(x.kind))).sort((a, b) => b.weight - a.weight).slice(0, Service.MAX_JOINS);
  }
  /** The kinds of things worth joining to each other on the graph: not places or breaches, which many unrelated things share. */
  private static readonly JOINABLE = new Set<EntityType>(['account', 'person', 'username', 'email', 'phone', 'wallet', 'org', 'domain']);

  /**
   * What accepting this finding would join it to: the thing it was found from, and every other dot on the graph it demonstrably
   * touches (its page lists a known email, its handle is a known username…), each with the sentence that says why.
   */
  connectionsFor(findingId: string): { nodeId: string; label: string; why: string; weight: number; kind: 'found-from' | 'match' }[] {
    const f = this.store.getFinding(findingId); if (!f) return [];
    const parent = this.store.getNode(f.subjectId);
    const out: { nodeId: string; label: string; why: string; weight: number; kind: 'found-from' | 'match' }[] = [];
    if (parent) out.push({ nodeId: parent.id, label: parent.label || parent.value, why: f.relation, weight: f.score, kind: 'found-from' });
    const nodes = this.store.listNodes(f.caseId).filter((n) => n.id !== f.subjectId && !(n.type === f.type && keyFor(n.type, n.value, n.attrs) === f.key));
    const siblings = this.store.listFindings(f.caseId, { subjectId: f.subjectId }).filter((g) => g.id !== f.id);
    for (const h of Service.strong(matchAnchors(factsOf(f, siblings), nodes.map(anchorOf)))) {
      const n = nodes.find((x) => x.id === h.anchorId)!;
      out.push({ nodeId: n.id, label: n.label || n.value, why: h.how.charAt(0).toUpperCase() + h.how.slice(1), weight: h.weight, kind: 'match' });
    }
    return out;
  }

  /** Turn accepted findings into nodes + evidenced edges, and join each new dot to every existing one it touches. Idempotent. */
  commit(caseId: string, subjectId?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [], edges: GraphEdge[] = [];
    this.store.tx(() => {
      const accepted = this.store.listFindings(caseId, { subjectId, status: ['accepted'] });
      const subj = new Map<string, GraphNode>();
      const bySubject = new Map<string, Finding[]>();
      const siblingsOf = (sid: string) => bySubject.get(sid) ?? (bySubject.set(sid, this.store.listFindings(caseId, { subjectId: sid })), bySubject.get(sid)!);
      for (const f of accepted) {
        const parent = subj.get(f.subjectId) ?? this.store.getNode(f.subjectId);
        if (!parent) continue;
        subj.set(parent.id, parent);
        const attrs = { ...f.attrs };
        const n = this.store.upsertNode({
          caseId, type: f.type, value: f.value, key: f.key, label: labelFor(f.type, f.value, f.attrs), state: 'confirmed', attrs, score: f.score, level: f.level,
          x: parent.x !== undefined ? parent.x + (Math.random() - 0.5) * 60 : undefined,
          y: parent.y !== undefined ? parent.y + (Math.random() - 0.5) * 60 : undefined,
        });
        nodes.push(n);
        edges.push(this.store.upsertEdge({ caseId, from: parent.id, to: n.id, label: f.relation, strength: f.score, kind: 'evidenced', findingId: f.id, why: `Found when looking up ${parent.label || parent.value}.` }));
      }
      // Seeds that had at least one accepted result become confirmed.
      for (const p of subj.values()) this.store.db.prepare("UPDATE nodes SET state='confirmed' WHERE id=?").run(p.id);

      // Join the dots: a new node to everything it touches, and everything that touches it.
      const all = this.store.listNodes(caseId);
      const accFor = new Map<string, Finding | null>();
      const backing = (m: GraphNode): Finding | null => {
        if (accFor.has(m.id)) return accFor.get(m.id)!;
        const k = keyFor(m.type, m.value, m.attrs);
        const row = this.store.db.prepare("SELECT id FROM findings WHERE case_id=? AND type=? AND key=? AND status='accepted' ORDER BY score DESC LIMIT 1").get(caseId, m.type, k) as { id: string } | undefined;
        const f = row ? this.store.getFinding(row.id) : null; accFor.set(m.id, f); return f;
      };
      for (const f of accepted) {
        const n = this.store.findNode(caseId, f.type, f.key); if (!n) continue;
        const others = all.filter((m) => m.id !== n.id && m.id !== f.subjectId);
        for (const h of Service.strong(matchAnchors(factsOf(f, siblingsOf(f.subjectId).filter((g) => g.id !== f.id)), others.map(anchorOf)))) {
          edges.push(this.store.upsertEdge({ caseId, from: h.anchorId, to: n.id, label: shortLabel(h), strength: h.weight, kind: 'evidenced', findingId: f.id, why: h.how.charAt(0).toUpperCase() + h.how.slice(1) + '.' }));
        }
        let back = 0;
        for (const m of others) {
          if (back >= Service.MAX_JOINS) break;
          if (!Service.JOINABLE.has(m.type) || !Service.JOINABLE.has(n.type)) continue;
          const bf = backing(m); if (!bf || bf.id === f.id) continue;
          for (const h of Service.strong(matchAnchors(factsOf(bf, siblingsOf(bf.subjectId).filter((g) => g.id !== bf.id)), [anchorOf(n)]))) {
            back++;
            edges.push(this.store.upsertEdge({ caseId, from: m.id, to: n.id, label: shortLabel(h), strength: h.weight, kind: 'evidenced', findingId: bf.id, why: `${m.label || m.value}: ${h.how}.` }));
          }
        }
      }
    });
    if (nodes.length) this.store.audit(caseId, 'graph.commit', `${nodes.length} nodes added/updated`);
    return { nodes, edges };
  }

  /** Take back the graph effects of a finding that is no longer accepted. A node stays if anything else still holds it there. */
  uncommit(f: Finding): { nodeIds: string[]; edgeIds: string[] } {
    const nodeIds: string[] = [], edgeIds: string[] = [];
    this.store.tx(() => {
      for (const e of this.store.edgesOfFinding(f.id)) { this.store.deleteEdge(e.id); edgeIds.push(e.id); }
      const n = this.store.findNode(f.caseId, f.type, f.key);
      if (!n || isKnown(n) || n.state === 'seed' || n.notes || n.pinned) return;
      const stillAccepted = this.store.db.prepare("SELECT COUNT(*) AS c FROM findings WHERE case_id=? AND type=? AND key=? AND status='accepted' AND id!=?").get(f.caseId, f.type, f.key, f.id) as { c: number };
      if (stillAccepted.c > 0) return;
      const remaining = this.store.edgesOfNode(n.id);
      for (const e of remaining) if (e.kind === 'manual') return;       // the person drew something here themselves
      for (const e of remaining) { this.store.deleteEdge(e.id); edgeIds.push(e.id); }
      this.store.deleteNode(n.id); nodeIds.push(n.id);
    });
    return { nodeIds, edgeIds };
  }

  /** Review, and put the result on the graph straight away: accepted means reviewed and correct. */
  reviewAndSync(ids: string[], status: FindingStatus): { findings: Finding[]; nodes: GraphNode[]; edges: GraphEdge[]; removedNodeIds: string[]; removedEdgeIds: string[] } {
    const before = new Map<string, FindingStatus>();
    for (const id of ids) { const f = this.store.getFinding(id); if (f) before.set(id, f.status); }
    const changed = this.review(ids, status);
    const out = { findings: changed, nodes: [] as GraphNode[], edges: [] as GraphEdge[], removedNodeIds: [] as string[], removedEdgeIds: [] as string[] };
    if (!changed.length) return out;
    const caseId = changed[0].caseId;
    if (status === 'accepted') {
      for (const sid of new Set(changed.map((f) => f.subjectId))) { const r = this.commit(caseId, sid); out.nodes.push(...r.nodes); out.edges.push(...r.edges); }
    }
    for (const f of changed) if (before.get(f.id) === 'accepted' && status !== 'accepted') { const r = this.uncommit(f); out.removedNodeIds.push(...r.nodeIds); out.removedEdgeIds.push(...r.edgeIds); }
    return out;
  }

  /** Mark something as known to belong to the subject (or take that back), and re-check everything already found against it. */
  setKnown(nodeId: string, known: boolean): GraphNode | null {
    const n = this.store.getNode(nodeId); if (!n) return null;
    if (known) {
      this.store.setNodeAttr(nodeId, 'known', true);
      this.store.setNodeState(nodeId, 'confirmed', 1, 4);
      this.store.audit(n.caseId, 'known.added', `${n.type}:${n.value}`);
      this.linkKnown(n.caseId);
    } else {
      this.store.setNodeAttr(nodeId, 'known', undefined);
      for (const e of this.store.edgesOfNode(nodeId)) if (e.kind === 'manual' && e.label === 'known to be the same subject') this.store.deleteEdge(e.id);
      const backed = this.store.db.prepare("SELECT COUNT(*) AS c FROM findings WHERE case_id=? AND type=? AND key=? AND status='accepted'").get(n.caseId, n.type, keyFor(n.type, n.value, n.attrs)) as { c: number };
      if (!backed.c) this.store.setNodeState(nodeId, 'seed', null, null);
      this.store.audit(n.caseId, 'known.removed', `${n.type}:${n.value}`);
    }
    this.reapplyAnchors(n.caseId);
    return this.store.getNode(nodeId);
  }

  /** Everything the investigator knows belongs together: join those dots to each other. */
  private linkKnown(caseId: string): GraphEdge[] {
    const known = this.store.listNodes(caseId).filter(isKnown).sort((a, b) => a.createdAt - b.createdAt);
    const out: GraphEdge[] = [];
    for (let i = 1; i < known.length; i++) out.push(this.store.upsertEdge({ caseId, from: known[0].id, to: known[i].id, label: 'known to be the same subject', strength: 1, kind: 'manual', why: 'You told Plexus these belong to the same subject.' }));
    return out;
  }

  /** Add several known facts at once (an email, a username, a phone…) and link them. */
  addKnown(caseId: string, items: { type?: EntityType; value: string; role?: HandleRole }[]): { nodes: GraphNode[]; edges: GraphEdge[]; skipped: string[] } {
    const nodes: GraphNode[] = [], skipped: string[] = [], believed: GraphNode[] = [];
    for (const it of items.slice(0, 30)) {
      const n = this.seed(caseId, it);
      if (!n) { skipped.push(it.value); continue; }
      // something you are only fairly sure of is described and checked against, but is not declared a fact
      const sure = !it.role || it.role.trust === 'certain';
      if (sure) {
        this.store.setNodeAttr(n.id, 'known', true);
        this.store.setNodeState(n.id, 'confirmed', 1, 4);
        this.store.audit(caseId, 'known.added', `${n.type}:${n.value}`);
      } else believed.push(this.store.getNode(n.id)!);
      nodes.push(this.store.getNode(n.id)!);
    }
    const edges = this.linkKnown(caseId);
    // handles added together that you only believe: joined to each other and to the first fact, at the strength you believe them
    const hub = nodes.find(isKnown) ?? believed[0];
    for (const b of believed) if (hub && hub.id !== b.id) edges.push(this.store.upsertEdge({ caseId, from: hub.id, to: b.id, label: 'you believe these belong together', strength: Math.max(0.3, trustFactor(roleFromAttrs(b.attrs))), kind: 'manual', why: 'You added these together and said you are fairly, but not completely, sure.' }));
    this.reapplyAnchors(caseId);
    return { nodes: nodes.map((n) => this.store.getNode(n.id)!), edges, skipped };
  }

  /** Re-check every finding in the case against everything known, and against each other starting point. Returns the findings that changed. */
  reapplyAnchors(caseId: string): Finding[] {
    const all = this.store.listFindings(caseId);
    const ctx = contextFor(this.store, caseId);
    const touched = applyAnchorEvidence(all, all, ctx);
    if (!touched.length) return [];
    const bySubject = new Map<string, Finding[]>();
    for (const f of all) (bySubject.get(f.subjectId) ?? bySubject.set(f.subjectId, []).get(f.subjectId)!).push(f);
    const rel = reliabilityFn(this.store);
    this.store.tx(() => { for (const fs of bySubject.values()) { rescore(fs, rel, ''); for (const f of fs) if (touched.includes(f)) this.store.saveFinding(f); } });
    return touched;
  }

  /** Re-score stored findings for a subject (e.g., after feedback changed source reliability). */
  rescoreSubject(caseId: string, subjectId: string, context = ''): Finding[] {
    const fs = this.store.listFindings(caseId, { subjectId });
    rescore(fs, reliabilityFn(this.store), context);
    this.store.tx(() => fs.forEach((f) => this.store.saveFinding(f)));
    return fs;
  }

  evidenceForNode(nodeId: string): Finding[] {
    const n = this.store.getNode(nodeId);
    if (!n) return [];
    const key = keyFor(n.type, n.value, n.attrs);
    const rows = this.store.db.prepare("SELECT id FROM findings WHERE case_id=? AND type=? AND key=? AND status!='rejected'").all(n.caseId, n.type, key) as { id: string }[];
    return rows.map((r) => this.store.getFinding(r.id)!).filter(Boolean).sort((a, b) => b.score - a.score);
  }

  acceptLink(caseId: string, a: string, b: string, label: string, strength: number): GraphEdge {
    const e = this.store.upsertEdge({ caseId, from: a, to: b, label, strength, kind: 'inferred' });
    this.store.audit(caseId, 'link.accepted', `${label}: ${a} ↔ ${b}`);
    return e;
  }
  newId = uid;
}
