import type { GraphEdge, GraphNode } from '@shared/types';

/** Strongest-evidence path: Dijkstra over cost = -ln(strength), so confident chains beat short weak ones. */
export function shortestPath(nodes: Pick<GraphNode, 'id'>[], edges: Pick<GraphEdge, 'id' | 'from' | 'to' | 'strength'>[], from: string, to: string):
  { nodes: string[]; edges: string[]; strength: number } | null {
  const adj = new Map<string, { to: string; id: string; w: number; s: number }[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    const s = Math.min(0.99, Math.max(0.05, e.strength || 0.3));
    const w = -Math.log(s) + 0.05; // tiny per-hop cost so ties prefer fewer hops
    adj.get(e.from)?.push({ to: e.to, id: e.id, w, s });
    adj.get(e.to)?.push({ to: e.from, id: e.id, w, s });
  }
  if (!adj.has(from) || !adj.has(to)) return null;
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { node: string; edge: string; s: number }>();
  const done = new Set<string>();
  const q: [number, string][] = [[0, from]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, u] = q.shift()!;
    if (done.has(u)) continue;
    done.add(u);
    if (u === to) break;
    for (const a of adj.get(u) ?? []) {
      const nd = d + a.w;
      if (nd < (dist.get(a.to) ?? Infinity)) { dist.set(a.to, nd); prev.set(a.to, { node: u, edge: a.id, s: a.s }); q.push([nd, a.to]); }
    }
  }
  if (!prev.has(to) && from !== to) return null;
  const pn = [to], pe: string[] = [];
  let strength = 1, cur = to;
  while (cur !== from) { const p = prev.get(cur)!; pn.unshift(p.node); pe.unshift(p.edge); strength *= p.s; cur = p.node; }
  return { nodes: pn, edges: pe, strength };
}

export function neighborhood(edges: Pick<GraphEdge, 'from' | 'to'>[], id: string, depth = 1): Set<string> {
  let frontier = new Set([id]);
  const seen = new Set([id]);
  for (let i = 0; i < depth; i++) {
    const next = new Set<string>();
    for (const e of edges) {
      if (frontier.has(e.from) && !seen.has(e.to)) next.add(e.to);
      if (frontier.has(e.to) && !seen.has(e.from)) next.add(e.from);
    }
    next.forEach((n) => seen.add(n));
    frontier = next;
  }
  return seen;
}
