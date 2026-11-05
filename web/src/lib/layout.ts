import type { EntityType } from '@shared/types';

/**
 * "Organized" graph layout: a tidy radial tree.
 *
 *  - The strongest-evidence spanning tree of each connected component becomes the skeleton (maximum spanning tree).
 *  - The best-connected node is the centre; its children sit on a ring, grouped by entity type so similar things are neighbours.
 *  - Deeper levels fan out from their parent. Crowded rings are split into 2-3 lanes so they stay compact.
 *  - Separate clusters are packed snugly around the biggest one (never in a far-away row), and lone nodes share one tidy cluster.
 *  - A relaxation pass guarantees a minimum gap between neighbours on every ring (so nothing overlaps).
 *  - Edges that are NOT in the tree ("cross links") are returned separately so the renderer can draw them quietly.
 *
 * Pure and deterministic: same input, same output.
 */

export interface LNode { id: string; type: EntityType; label: string; seed?: boolean; createdAt?: number }
export interface LEdge { id: string; from: string; to: string; strength: number }

export interface Placed { x: number; y: number; angle: number; depth: number; comp: number }
export interface Layout {
  pos: Map<string, Placed>;
  parent: Map<string, string | null>;
  children: Map<string, string[]>;
  treeEdges: Set<string>;
  /** Centre (root position) of each component, used to bundle cross links toward the middle. */
  centers: { x: number; y: number }[];
  roots: string[];
}

const TYPE_RANK: Record<string, number> = { person: 0, email: 1, phone: 2, username: 3, account: 4, org: 5, location: 6, domain: 7, ip: 8, url: 9, wallet: 10, breach: 11, image: 12 };

export const FOOTPRINT = 100; // minimum centre-to-centre room each node needs on a ring
const GAP = 150;               // radial distance between rings
const STAGGER = 66;            // radial offset between neighbouring lanes of a crowded ring
/** Crowded rings are split into lanes (alternating radii) so they stay small: 1 lane, or 2 / 3 when there are many nodes. */
const lanesFor = (n: number) => (n >= 34 ? 3 : n >= 9 ? 2 : 1);
/** How much closer together neighbours along the ring may sit when the ring has that many lanes. */
const LANE_PACK = [1, 1, 1.7, 2.3];
const PACK_GAP = 36;               // clear space between separate clusters
const TAU = Math.PI * 2;

class Heap<T> {
  private a: { k: number; v: T }[] = [];
  push(k: number, v: T) { this.a.push({ k, v }); let i = this.a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.a[p].k >= this.a[i].k) break; [this.a[p], this.a[i]] = [this.a[i], this.a[p]]; i = p; } }
  pop(): T | undefined {
    if (!this.a.length) return undefined;
    const top = this.a[0].v, last = this.a.pop()!;
    if (this.a.length) { this.a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < this.a.length && this.a[l].k > this.a[m].k) m = l; if (r < this.a.length && this.a[r].k > this.a[m].k) m = r; if (m === i) break; [this.a[m], this.a[i]] = [this.a[i], this.a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

/** Which lane the i-th node (in angle order) of a ring of n sits in: round-robin, but the last node must also differ from the first, which it neighbours around the seam. */
function laneOf(i: number, n: number, L: number): number {
  if (L < 3 || i < n - 1 || n % L === 0) return i % L;
  for (let l = 0; l < L; l++) if (l !== (n - 2) % L && l !== 0) return l;
  return i % L;
}

const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** Spread angles on a circle so neighbours are at least `gap` radians apart, moving things as little as possible. */
function relax(ids: string[], ang: Map<string, number>, gap: number) {
  const n = ids.length;
  if (n < 2) return;
  if (gap * n >= TAU) { ids.forEach((id, i) => ang.set(id, norm(-Math.PI / 2 + (TAU * i) / n))); return; }
  for (let pass = 0; pass < 400; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const a = ids[i], b = ids[(i + 1) % n];
      let d = ang.get(b)! - ang.get(a)!;
      if (i === n - 1) d += TAU;
      if (d < gap - 1e-6) { const push = (gap - d) / 2; ang.set(a, ang.get(a)! - push); ang.set(b, ang.get(b)! + push); moved = true; }
    }
    if (!moved) break;
  }
}

export function organize(nodes: LNode[], edges: LEdge[]): Layout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, { to: string; id: string; w: number }[]>();
  for (const n of nodes) adj.set(n.id, []);
  const seenPair = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) continue;
    const w = Math.min(0.99, Math.max(0.01, e.strength || 0.3));
    adj.get(e.from)!.push({ to: e.to, id: e.id, w }); adj.get(e.to)!.push({ to: e.from, id: e.id, w });
    seenPair.add(e.id);
  }

  // connected components
  const compOf = new Map<string, number>();
  const comps: string[][] = [];
  for (const n of nodes) {
    if (compOf.has(n.id)) continue;
    const c: string[] = [], q = [n.id];
    compOf.set(n.id, comps.length);
    while (q.length) { const u = q.pop()!; c.push(u); for (const a of adj.get(u)!) if (!compOf.has(a.to)) { compOf.set(a.to, comps.length); q.push(a.to); } }
    comps.push(c);
  }
  const order = comps.map((c, i) => i).sort((a, b) => comps[b].length - comps[a].length || Math.min(...comps[a].map((id) => byId.get(id)!.createdAt ?? 0)) - Math.min(...comps[b].map((id) => byId.get(id)!.createdAt ?? 0)) || comps[a].reduce((m, id) => (id < m ? id : m)).localeCompare(comps[b].reduce((m, id) => (id < m ? id : m))));

  const pos = new Map<string, Placed>();
  const parent = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  const treeEdges = new Set<string>();
  const centers: { x: number; y: number }[] = [];
  const roots: string[] = [];
  const local: { members: string[]; rad: number }[] = [];

  order.forEach((ci, slot) => {
    const members = comps[ci];
    // root: best connected, seeds win ties, then oldest
    const root = [...members].sort((a, b) => (adj.get(b)!.length + (byId.get(b)!.seed ? 0.5 : 0)) - (adj.get(a)!.length + (byId.get(a)!.seed ? 0.5 : 0)) || (byId.get(a)!.createdAt ?? 0) - (byId.get(b)!.createdAt ?? 0) || a.localeCompare(b))[0];

    // maximum spanning tree (Prim) — strongest evidence wins
    const inTree = new Set([root]);
    parent.set(root, null);
    const heap = new Heap<{ from: string; to: string; id: string }>();
    const push = (u: string) => { for (const a of adj.get(u)!) if (!inTree.has(a.to)) heap.push(a.w, { from: u, to: a.to, id: a.id }); };
    push(root);
    while (heap.size) {
      const e = heap.pop()!;
      if (inTree.has(e.to)) continue;
      inTree.add(e.to); parent.set(e.to, e.from); treeEdges.add(e.id);
      (children.get(e.from) ?? children.set(e.from, []).get(e.from)!).push(e.to);
      push(e.to);
    }
    const sortKids = (id: string) => children.get(id)?.sort((a, b) => {
      const A = byId.get(a)!, B = byId.get(b)!;
      return (TYPE_RANK[A.type] ?? 99) - (TYPE_RANK[B.type] ?? 99) || A.label.toLowerCase().localeCompare(B.label.toLowerCase()) || a.localeCompare(b);
    });

    // depth levels (BFS over the tree, children in sorted order)
    const levels: string[][] = [[root]];
    const depth = new Map<string, number>([[root, 0]]);
    for (let d = 0; levels[d]?.length; d++) {
      const next: string[] = [];
      for (const u of levels[d]) { sortKids(u); for (const k of children.get(u) ?? []) { depth.set(k, d + 1); next.push(k); } }
      if (next.length) levels.push(next); else break;
    }

    // ring radii: wide enough for every node on the ring; crowded rings are split into lanes
    const R: number[] = [0], lanes: number[] = [1];
    const spread = (L: number) => (STAGGER * (L - 1)) / 2;
    for (let d = 1; d < levels.length; d++) {
      const n = levels[d].length, L = lanesFor(n);
      const base = R[d - 1] + (d === 1 ? GAP : GAP * 0.92) + spread(lanes[d - 1]);
      R[d] = Math.max(base + spread(L), (n * FOOTPRINT) / TAU / LANE_PACK[L] + spread(L));
      lanes[d] = L;
    }

    const ang = new Map<string, number>();
    const rootKids = children.get(root) ?? [];
    rootKids.forEach((k, i) => ang.set(k, norm(-Math.PI / 2 + (TAU * (i + 0.5)) / rootKids.length)));
    for (let d = 1; d < levels.length; d++) {
      if (d >= 2) {
        const step = FOOTPRINT / R[d] / LANE_PACK[lanes[d]];
        for (const u of levels[d - 1]) {
          const ks = children.get(u) ?? [];
          ks.forEach((k, i) => ang.set(k, norm(ang.get(u)! + (i - (ks.length - 1) / 2) * step)));
        }
      }
      const ids = [...levels[d]].sort((a, b) => ang.get(a)! - ang.get(b)! || a.localeCompare(b));
      relax(ids, ang, FOOTPRINT / R[d] / LANE_PACK[lanes[d]]);
      ids.forEach((id, i) => {
        const L = lanes[d], r = R[d] + (L > 1 ? (laneOf(i, ids.length, L) - (L - 1) / 2) * STAGGER : 0);
        const a = ang.get(id)!;
        pos.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r, angle: norm(a), depth: d, comp: slot });
      });
    }
    pos.set(root, { x: 0, y: 0, angle: 0, depth: 0, comp: slot });

    let rad = 0;
    for (const id of members) { const p = pos.get(id)!; rad = Math.max(rad, Math.hypot(p.x, p.y)); }
    local[slot] = { members, rad: rad + 90 };
    roots[slot] = root;
  });

  // Lone nodes (no connections) would each be a far-flung stray, so they share ONE tidy cluster of concentric rings.
  const lone = local.map((c, i) => (c.members.length === 1 ? i : -1)).filter((i) => i >= 0);
  const loneOffset = new Map<number, { x: number; y: number }>();
  let loneRad = 0;
  if (lone.length) {
    const sorted = [...lone].sort((a, b) => {
      const A = byId.get(local[a].members[0])!, B = byId.get(local[b].members[0])!;
      return (TYPE_RANK[A.type] ?? 99) - (TYPE_RANK[B.type] ?? 99) || A.label.toLowerCase().localeCompare(B.label.toLowerCase()) || A.id.localeCompare(B.id);
    });
    const F = FOOTPRINT * 1.04;
    let i = 0, ring = 0;
    while (i < sorted.length) {
      if (ring === 0) { loneOffset.set(sorted[i++], { x: 0, y: 0 }); ring = 1; continue; }
      const r = ring * F;
      const cap = Math.max(1, Math.floor(Math.PI / Math.asin(Math.min(1, F / (2 * r)))));
      const take = Math.min(cap, sorted.length - i);
      for (let k = 0; k < take; k++) { const a = -Math.PI / 2 + (TAU * k) / take; loneOffset.set(sorted[i++], { x: Math.cos(a) * r, y: Math.sin(a) * r }); }
      loneRad = r; ring++;
    }
    loneRad += 60;
  }

  // Pack every cluster as a circle: the biggest sits on the origin, each next one goes as close to it as it can without touching another.
  const items: { slots: number[]; rad: number }[] = [];
  local.forEach((c, i) => { if (c.members.length > 1) items.push({ slots: [i], rad: c.rad }); });
  if (lone.length) items.push({ slots: lone, rad: loneRad || 60 });
  const placed: { x: number; y: number; r: number }[] = [];
  const itemPos: { x: number; y: number }[] = [];
  const STEPS = 48;
  items.forEach((it, k) => {
    if (k === 0) { itemPos[k] = { x: 0, y: 0 }; placed.push({ x: 0, y: 0, r: it.rad }); return; }
    let best = { d: Infinity, a: 0 };
    for (let s = 0; s < STEPS; s++) {
      const a = (TAU * s) / STEPS, ux = Math.cos(a), uy = Math.sin(a);
      // along the ray, the circle overlaps placed[j] for d in (d1, d2): find the nearest d outside every such interval
      const ban: [number, number][] = [];
      for (const p of placed) {
        const R2 = p.r + it.rad + PACK_GAP, b = p.x * ux + p.y * uy, disc = b * b - (p.x * p.x + p.y * p.y - R2 * R2);
        if (disc > 0) ban.push([b - Math.sqrt(disc), b + Math.sqrt(disc)]);
      }
      ban.sort((x, y) => x[0] - y[0]);
      let d = 0;
      for (const [lo, hi] of ban) { if (hi <= d) continue; if (lo >= d) break; d = hi; }
      if (d < best.d - 1e-6) best = { d, a };
    }
    const x = Math.cos(best.a) * best.d, y = Math.sin(best.a) * best.d;
    itemPos[k] = { x, y }; placed.push({ x, y, r: it.rad });
  });
  items.forEach((it, k) => {
    for (const slot of it.slots) {
      const o = loneOffset.get(slot) ?? { x: 0, y: 0 };
      const ox = itemPos[k].x + o.x, oy = itemPos[k].y + o.y;
      for (const id of local[slot].members) { const p = pos.get(id)!; p.x += ox; p.y += oy; }
      centers[slot] = { x: ox, y: oy };
    }
  });

  return { pos, parent, children, treeEdges, centers, roots };
}

/** All tree descendants of a node (used to drag a whole branch together). */
export function descendants(layout: Pick<Layout, 'children'>, id: string): string[] {
  const out: string[] = [], q = [...(layout.children.get(id) ?? [])];
  while (q.length) { const u = q.pop()!; out.push(u); q.push(...(layout.children.get(u) ?? [])); }
  return out;
}
