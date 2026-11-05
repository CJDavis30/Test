import { describe, it, expect } from 'vitest';
import { organize, descendants, FOOTPRINT, type LNode, type LEdge } from '../web/src/lib/layout';

const TYPES = ['person', 'email', 'phone', 'username', 'account', 'org', 'location', 'domain', 'ip', 'url'] as const;
// tiny seeded PRNG so "random" graphs are reproducible
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function graph(n: number, extraEdgeRatio: number, hubs: number, seed = 1) {
  const r = rng(seed);
  const nodes: LNode[] = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: TYPES[i % TYPES.length], label: `Node ${i} ${'x'.repeat(i % 9)}`, seed: i < hubs, createdAt: i }));
  const edges: LEdge[] = [];
  for (let i = 1; i < n; i++) edges.push({ id: `t${i}`, from: `n${Math.floor(r() * Math.min(i, hubs))}`, to: `n${i}`, strength: 0.4 + r() * 0.55 });
  for (let k = 0; k < n * extraEdgeRatio; k++) { const a = Math.floor(r() * n), b = Math.floor(r() * n); if (a !== b) edges.push({ id: `x${k}`, from: `n${a}`, to: `n${b}`, strength: 0.3 + r() * 0.5 }); }
  return { nodes, edges };
}

const minDist = (pos: Map<string, { x: number; y: number }>) => {
  const p = [...pos.values()]; let m = Infinity;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) m = Math.min(m, Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y));
  return m;
};

describe('organized layout', () => {
  it.each([[8, 0.3, 1], [30, 0.5, 2], [56, 0.8, 3], [120, 0.5, 4], [300, 0.4, 6]])('%i nodes: nothing overlaps and every node is placed', (n, extra, hubs) => {
    const { nodes, edges } = graph(n, extra, hubs);
    const L = organize(nodes, edges);
    expect(L.pos.size).toBe(n);
    for (const p of L.pos.values()) { expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true); }
    expect(minDist(L.pos)).toBeGreaterThanOrEqual(FOOTPRINT * 0.5); // node radius is ≤ ~24, so ≥50px apart never overlaps
  });

  it('the tree is a spanning forest: nodes − components edges, and a parent for every non-root', () => {
    const { nodes, edges } = graph(80, 0.6, 3);
    const L = organize(nodes, edges);
    expect(L.treeEdges.size).toBe(80 - L.roots.length);
    for (const n of nodes) if (!L.roots.includes(n.id)) expect(L.parent.get(n.id)).toBeTruthy();
  });

  it('keeps disconnected components apart', () => {
    const a = graph(20, 0.3, 1, 5), b = graph(20, 0.3, 1, 6);
    const nodes = [...a.nodes, ...b.nodes.map((x) => ({ ...x, id: 'b' + x.id }))];
    const edges = [...a.edges, ...b.edges.map((e) => ({ ...e, id: 'b' + e.id, from: 'b' + e.from, to: 'b' + e.to }))];
    const L = organize(nodes, edges);
    expect(L.roots.length).toBe(2);
    expect(minDist(L.pos)).toBeGreaterThanOrEqual(FOOTPRINT * 0.5);
  });

  it('places isolated nodes too, and handles empty input', () => {
    expect(organize([], []).pos.size).toBe(0);
    const L = organize([{ id: 'a', type: 'email', label: 'a' }, { id: 'b', type: 'email', label: 'b' }, { id: 'c', type: 'email', label: 'c' }], []);
    expect(L.pos.size).toBe(3);
    expect(minDist(L.pos)).toBeGreaterThan(100);
  });

  it('is deterministic and groups the same type together on the first ring', () => {
    const { nodes, edges } = graph(40, 0.4, 1);
    const A = organize(nodes, edges), B = organize([...nodes].reverse(), [...edges].reverse());
    for (const n of nodes) { expect(A.pos.get(n.id)!.x).toBeCloseTo(B.pos.get(n.id)!.x, 6); expect(A.pos.get(n.id)!.y).toBeCloseTo(B.pos.get(n.id)!.y, 6); }
    const kids = A.children.get(A.roots[0])!;
    const seq = kids.map((k) => nodes.find((n) => n.id === k)!.type);
    const changes = seq.filter((t, i) => i > 0 && t !== seq[i - 1]).length;
    expect(changes).toBeLessThan(TYPES.length); // sorted by type ⇒ at most (types−1) transitions
  });

  it('centres the best-connected node; descendants returns the whole branch below a node', () => {
    const L = organize(
      [{ id: 'r', type: 'person', label: 'r' }, { id: 'a', type: 'email', label: 'a' }, { id: 'b', type: 'email', label: 'b' }, { id: 'c', type: 'domain', label: 'c' }, { id: 'd', type: 'domain', label: 'd' }],
      [{ id: '1', from: 'r', to: 'a', strength: 0.9 }, { id: '2', from: 'a', to: 'b', strength: 0.9 }, { id: '3', from: 'a', to: 'c', strength: 0.9 }, { id: '4', from: 'c', to: 'd', strength: 0.9 }],
    );
    expect(L.roots[0]).toBe('a'); // degree 3 beats everyone
    expect(L.pos.get('a')).toMatchObject({ x: 0, y: 0, depth: 0 });
    expect(descendants(L, 'a').sort()).toEqual(['b', 'c', 'd', 'r']);
    expect(descendants(L, 'c')).toEqual(['d']);
    expect(descendants(L, 'b')).toEqual([]);
  });

  it('keeps strays close: small clusters and lone nodes pack next to the main cluster, not in a far row', () => {
    const main = graph(40, 0.4, 1, 9);
    const nodes: LNode[] = [...main.nodes];
    const edges: LEdge[] = [...main.edges];
    for (let c = 0; c < 6; c++) { // six little pairs
      nodes.push({ id: `p${c}a`, type: 'email', label: `pa${c}`, createdAt: 100 + c }, { id: `p${c}b`, type: 'username', label: `pb${c}`, createdAt: 100 + c });
      edges.push({ id: `pe${c}`, from: `p${c}a`, to: `p${c}b`, strength: 0.6 });
    }
    for (let i = 0; i < 12; i++) nodes.push({ id: `lone${i}`, type: 'domain', label: `lone${i}`, createdAt: 200 + i });
    const L = organize(nodes, edges);
    const mainR = Math.max(...main.nodes.map((n) => Math.hypot(L.pos.get(n.id)!.x, L.pos.get(n.id)!.y)));
    const farthest = Math.max(...nodes.map((n) => Math.hypot(L.pos.get(n.id)!.x, L.pos.get(n.id)!.y)));
    expect(farthest).toBeLessThan(mainR * 2.4 + 300);
    expect(minDist(L.pos)).toBeGreaterThanOrEqual(FOOTPRINT * 0.5);
    // lone nodes share one cluster: none is farther from the others than a couple of rings
    const lone = nodes.filter((n) => n.id.startsWith('lone')).map((n) => L.pos.get(n.id)!);
    const lc = { x: lone.reduce((a, p) => a + p.x, 0) / lone.length, y: lone.reduce((a, p) => a + p.y, 0) / lone.length };
    expect(Math.max(...lone.map((p) => Math.hypot(p.x - lc.x, p.y - lc.y)))).toBeLessThan(FOOTPRINT * 3);
  });

  it('many nodes on one ring stay compact (lanes) instead of growing a huge circle', () => {
    const nodes: LNode[] = [{ id: 'hub', type: 'person', label: 'hub', seed: true }];
    const edges: LEdge[] = [];
    for (let i = 0; i < 60; i++) { nodes.push({ id: `k${i}`, type: 'account', label: `k${i}` }); edges.push({ id: `e${i}`, from: 'hub', to: `k${i}`, strength: 0.5 }); }
    const L = organize(nodes, edges);
    const maxR = Math.max(...[...L.pos.values()].map((p) => Math.hypot(p.x, p.y)));
    expect(maxR).toBeLessThan((60 * FOOTPRINT) / (Math.PI * 2) + 100); // a single plain ring would need ~955; lanes keep it well under
    expect(minDist(L.pos)).toBeGreaterThanOrEqual(FOOTPRINT * 0.5);
  });
});
