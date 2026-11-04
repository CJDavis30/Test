import type { Finding, FindingStatus, GraphEdge, GraphNode, CaseSnapshot, EntityType } from '../shared/types';
import { keyFor, displayFor } from '../shared/normalize';
import { detect } from '../shared/detect';
import { uid, type Store } from './store';
import { reliabilityFn } from './registry';
import { rescore } from '../shared/scoring';

export class Service {
  constructor(public store: Store) {}

  snapshot(caseId: string): CaseSnapshot | null {
    const c = this.store.getCase(caseId);
    if (!c) return null;
    return {
      case: c,
      nodes: this.store.listNodes(caseId),
      edges: this.store.listEdges(caseId),
      findings: this.store.listFindings(caseId, { status: ['pending', 'unsure'] }),
    };
  }

  /** Create (or reuse) a seed node for something the user typed. */
  seed(caseId: string, input: { type?: EntityType; value: string; near?: { x: number; y: number } }): GraphNode | null {
    const d = input.type ? { type: input.type, value: displayFor(input.type, input.value) } : detect(input.value);
    if (!d) return null;
    const key = keyFor(d.type, d.value);
    const existing = this.store.findNode(caseId, d.type, key);
    if (existing) return existing;
    const n = this.store.upsertNode({ caseId, type: d.type, value: d.value, key, state: 'seed', x: input.near?.x, y: input.near?.y });
    this.store.audit(caseId, 'node.added', `${n.type}:${n.value}`);
    return n;
  }

  /** Apply a review decision and keep the per-source accuracy statistics honest (including undo). */
  review(ids: string[], status: FindingStatus): Finding[] {
    const out: Finding[] = [];
    this.store.tx(() => {
      for (const id of ids) {
        const f = this.store.getFinding(id);
        if (!f || f.status === status) continue;
        const adapters = [...new Set(f.evidence.map((e) => e.adapter))];
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

  /** Turn accepted findings into nodes + evidenced edges. Idempotent. */
  commit(caseId: string, subjectId?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [], edges: GraphEdge[] = [];
    this.store.tx(() => {
      const accepted = this.store.listFindings(caseId, { subjectId, status: ['accepted'] });
      const subj = new Map<string, GraphNode>();
      for (const f of accepted) {
        const parent = subj.get(f.subjectId) ?? this.store.getNode(f.subjectId);
        if (!parent) continue;
        subj.set(parent.id, parent);
        const attrs = { ...f.attrs };
        const n = this.store.upsertNode({
          caseId, type: f.type, value: f.value, key: f.key, state: 'confirmed', attrs, score: f.score, level: f.level,
          x: parent.x !== undefined ? parent.x + (Math.random() - 0.5) * 60 : undefined,
          y: parent.y !== undefined ? parent.y + (Math.random() - 0.5) * 60 : undefined,
        });
        nodes.push(n);
        edges.push(this.store.upsertEdge({ caseId, from: parent.id, to: n.id, label: f.relation, strength: f.score, kind: 'evidenced', findingId: f.id }));
      }
      // Seeds that had at least one accepted result become confirmed.
      for (const p of subj.values()) this.store.db.prepare("UPDATE nodes SET state='confirmed' WHERE id=?").run(p.id);
    });
    if (nodes.length) this.store.audit(caseId, 'graph.commit', `${nodes.length} nodes added/updated`);
    return { nodes, edges };
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
