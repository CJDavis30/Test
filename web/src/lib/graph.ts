import {
  forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY, type Simulation, type SimulationNodeDatum, type SimulationLinkDatum,
} from 'd3-force';
import type { EntityType, GraphEdge, GraphNode, Level } from '@shared/types';
import { initials } from '@shared/normalize';
import { canvasIcon, thumb } from './icons';

export interface SimNode extends SimulationNodeDatum {
  id: string; type: EntityType; label: string; state: GraphNode['state']; score?: number; level?: Level; r: number; degree: number; born: number; pinned: boolean; image?: string;
}
export interface SimLink extends SimulationLinkDatum<SimNode> { id: string; label: string; strength: number; kind: GraphEdge['kind']; curve: number; born: number }

export interface Palette {
  nodeFill: string; nodeStroke: string; nodeInk: string; edge: string; text: string; text2: string; bg: string; dot: string; accent: string; accentSoft: string;
  lvl: Record<Level, string>;
}

export interface Hover { kind: 'node' | 'edge'; id: string; x: number; y: number }

export interface Callbacks {
  onSelect(ids: string[], additive: boolean): void;
  onSelectEdge(id: string | null): void;
  onOpen(id: string): void;
  onContext(id: string | null, x: number, y: number): void;
  onHover(h: Hover | null): void;
  onSettle(items: { id: string; x: number; y: number; pinned: boolean }[]): void;
  onEmptyDouble(x: number, y: number): void;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const backOut = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    nodeFill: v('--node-fill'), nodeStroke: v('--node-stroke'), nodeInk: v('--node-ink'), edge: v('--edge'), text: v('--text'), text2: v('--text-2'),
    bg: v('--canvas'), dot: v('--grid-dot'), accent: v('--accent'), accentSoft: v('--accent-soft'),
    lvl: { 1: v('--lvl1'), 2: v('--lvl2'), 3: v('--lvl3'), 4: v('--lvl4') },
  };
}

export class GraphEngine {
  ctx: CanvasRenderingContext2D;
  sim: Simulation<SimNode, SimLink>;
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  byId = new Map<string, SimNode>();
  cam = { x: 0, y: 0, k: 1 };
  camTarget: { x: number; y: number; k: number } | null = null;
  w = 0; h = 0; dpr = 1;
  insets = { left: 0, right: 0, top: 0, bottom: 0 };
  palette: Palette;
  selection = new Set<string>();
  selectedEdge: string | null = null;
  highlight: { nodes: Set<string>; edges: Set<string> } | null = null;
  focus: Set<string> | null = null;
  hover: Hover | null = null;
  lasso: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private dirty = true;
  private raf = 0;
  private drag: { id: string; sx: number; sy: number; moved: boolean; ox: number; oy: number } | null = null;
  private pan: { sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;
  private settleTimer = 0;
  private lastClick = { t: 0, id: '' };
  private fitted = false;
  private disposed = false;
  reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private canvas: HTMLCanvasElement, private cb: Callbacks) {
    this.ctx = canvas.getContext('2d')!;
    this.palette = readPalette();
    this.sim = forceSimulation<SimNode, SimLink>([])
      .force('link', forceLink<SimNode, SimLink>([]).id((d) => d.id).distance((l) => 118 + (1 - l.strength) * 64).strength(0.5))
      .force('charge', forceManyBody<SimNode>().strength((d) => -380 - d.degree * 26).distanceMax(640))
      .force('collide', forceCollide<SimNode>().radius((d) => d.r + 26).strength(0.9))
      .force('x', forceX<SimNode>(0).strength(0.035))
      .force('y', forceY<SimNode>(0).strength(0.035))
      .alphaDecay(0.045).velocityDecay(0.52)
      .on('tick', () => { this.dirty = true; })
      .on('end', () => this.emitSettle());
    this.bind();
    this.loop();
  }

  // ---------------------------------------------------------------------------------------------- data
  setData(nodes: GraphNode[], edges: GraphEdge[]) {
    const ids = new Set(nodes.map((n) => n.id));
    const deg = new Map<string, number>();
    const live = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    for (const e of live) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }

    const firstLoad = this.nodes.length === 0;
    const unplaced = nodes.filter((n) => n.x === undefined && !this.byId.has(n.id)).length;
    const next: SimNode[] = [];
    const adjacency = new Map<string, string[]>();
    for (const e of live) { (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)!).push(e.to); (adjacency.get(e.to) ?? adjacency.set(e.to, []).get(e.to)!).push(e.from); }

    for (const n of nodes) {
      const d = deg.get(n.id) ?? 0;
      const r = (n.state === 'seed' ? 17 : 13) + Math.min(9, Math.sqrt(d) * 2.4);
      let s = this.byId.get(n.id);
      if (!s) {
        let x = n.x, y = n.y;
        if (x === undefined || y === undefined) {
          const anchor = (adjacency.get(n.id) ?? []).map((id) => this.byId.get(id)).find((a) => a && a.x !== undefined);
          const ang = Math.random() * Math.PI * 2;
          if (anchor) { x = anchor.x! + Math.cos(ang) * 30; y = anchor.y! + Math.sin(ang) * 30; }
          else { x = (Math.random() - 0.5) * 240; y = (Math.random() - 0.5) * 240; }
        }
        s = { id: n.id, type: n.type, label: n.label, state: n.state, r, degree: d, born: performance.now(), pinned: !!n.pinned, x, y, vx: 0, vy: 0 } as SimNode;
        if (n.pinned && n.x !== undefined) { s.fx = n.x; s.fy = n.y; }
        this.byId.set(n.id, s);
      }
      s.type = n.type; s.label = n.label; s.state = n.state; s.score = n.score; s.level = n.level; s.r = r; s.degree = d;
      s.image = n.type === 'image' && /^(data:image|https?:)/.test(n.value) ? n.value : undefined;
      if (n.pinned !== s.pinned) { s.pinned = !!n.pinned; if (!s.pinned && !this.drag) { s.fx = null; s.fy = null; } }
      next.push(s);
    }
    for (const id of [...this.byId.keys()]) if (!ids.has(id)) this.byId.delete(id);
    this.nodes = next;

    // parallel edges between the same pair get fanned out
    const pairCount = new Map<string, number>();
    const prevBorn = new Map(this.links.map((l) => [l.id, l.born]));
    this.links = live.map((e) => {
      const key = [e.from, e.to].sort().join('|');
      const i = pairCount.get(key) ?? 0; pairCount.set(key, i + 1);
      return { id: e.id, source: e.from, target: e.to, label: e.label, strength: e.strength, kind: e.kind, curve: i, born: prevBorn.get(e.id) ?? performance.now() } as SimLink;
    });
    const totals = new Map<string, number>();
    for (const e of live) { const k = [e.from, e.to].sort().join('|'); totals.set(k, (totals.get(k) ?? 0) + 1); }
    this.links.forEach((l) => {
      const k = [(l.source as any), (l.target as any)].map((x) => (typeof x === 'string' ? x : x.id)).sort().join('|');
      const t = totals.get(k) ?? 1;
      l.curve = t > 1 ? (l.curve - (t - 1) / 2) * 26 : 0;
    });

    this.sim.nodes(this.nodes);
    (this.sim.force('link') as any).links(this.links);

    if (firstLoad && unplaced > 20) {
      this.sim.alpha(1);
      for (let i = 0; i < 260; i++) this.sim.tick();
      this.sim.alpha(0.15).restart();
    } else {
      this.sim.alpha(firstLoad ? 1 : 0.55).restart();
    }
    this.dirty = true;
    if (!this.fitted && this.nodes.length) { this.fitted = true; this.fit(false); }
  }

  private emitSettle() {
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.cb.onSettle(this.nodes.map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0, pinned: n.fx != null })));
    }, 400);
  }

  // ---------------------------------------------------------------------------------------------- view
  setSize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    this.dirty = true;
  }
  setInsets(i: Partial<typeof this.insets>) { Object.assign(this.insets, i); }
  refreshPalette() { this.palette = readPalette(); this.dirty = true; }
  setSelection(ids: string[], edge: string | null) { this.selection = new Set(ids); this.selectedEdge = edge; this.dirty = true; }
  setHighlight(h: { nodes: string[]; edges: string[] } | null) { this.highlight = h ? { nodes: new Set(h.nodes), edges: new Set(h.edges) } : null; this.dirty = true; }
  setFocus(ids: Set<string> | null) { this.focus = ids; this.dirty = true; }
  invalidate() { this.dirty = true; }

  toWorld(sx: number, sy: number) { return { x: (sx - this.cam.x) / this.cam.k, y: (sy - this.cam.y) / this.cam.k }; }
  toScreen(wx: number, wy: number) { return { x: wx * this.cam.k + this.cam.x, y: wy * this.cam.k + this.cam.y }; }

  fit(animated = true, ids?: string[]) {
    const list = ids ? this.nodes.filter((n) => ids.includes(n.id)) : this.nodes;
    if (!list.length || !this.w) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) { x0 = Math.min(x0, (n.x ?? 0) - n.r); y0 = Math.min(y0, (n.y ?? 0) - n.r); x1 = Math.max(x1, (n.x ?? 0) + n.r); y1 = Math.max(y1, (n.y ?? 0) + n.r + 18); }
    const pad = 64;
    const aw = Math.max(80, this.w - this.insets.left - this.insets.right - pad * 2);
    const ah = Math.max(80, this.h - this.insets.top - this.insets.bottom - pad * 2);
    const k = Math.min(1.5, Math.max(0.12, Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0))));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const tx = this.insets.left + (this.w - this.insets.left - this.insets.right) / 2 - cx * k;
    const ty = this.insets.top + (this.h - this.insets.top - this.insets.bottom) / 2 - cy * k;
    if (animated && !this.reduceMotion) this.camTarget = { x: tx, y: ty, k }; else { this.cam = { x: tx, y: ty, k }; this.camTarget = null; }
    this.dirty = true;
  }
  zoomBy(f: number, cx = this.w / 2, cy = this.h / 2) {
    const k = Math.min(3, Math.max(0.08, this.cam.k * f));
    const wx = (cx - this.cam.x) / this.cam.k, wy = (cy - this.cam.y) / this.cam.k;
    this.cam = { k, x: cx - wx * k, y: cy - wy * k };
    this.camTarget = null; this.dirty = true;
  }
  panTo(id: string) {
    const n = this.byId.get(id); if (!n) return;
    const tx = this.insets.left + (this.w - this.insets.left - this.insets.right) / 2 - (n.x ?? 0) * this.cam.k;
    const ty = this.insets.top + (this.h - this.insets.top - this.insets.bottom) / 2 - (n.y ?? 0) * this.cam.k;
    this.camTarget = { x: tx, y: ty, k: this.cam.k }; this.dirty = true;
  }
  reheat() { this.sim.alpha(0.6).restart(); }

  // ---------------------------------------------------------------------------------------------- hit tests
  nodeAt(sx: number, sy: number): SimNode | null {
    let best: SimNode | null = null, bd = Infinity;
    for (const n of this.nodes) {
      const p = this.toScreen(n.x ?? 0, n.y ?? 0);
      const d = Math.hypot(p.x - sx, p.y - sy);
      const rr = n.r * this.cam.k + 4;
      if (d <= rr && d < bd) { best = n; bd = d; }
    }
    return best;
  }
  edgeAt(sx: number, sy: number): SimLink | null {
    let best: SimLink | null = null, bd = 6;
    for (const l of this.links) {
      const a = l.source as SimNode, b = l.target as SimNode;
      if (!a || !b || typeof a === 'string') continue;
      const p = this.toScreen(a.x ?? 0, a.y ?? 0), q = this.toScreen(b.x ?? 0, b.y ?? 0);
      const dx = q.x - p.x, dy = q.y - p.y;
      const t = Math.max(0, Math.min(1, ((sx - p.x) * dx + (sy - p.y) * dy) / (dx * dx + dy * dy || 1)));
      let d = Math.hypot(p.x + t * dx - sx, p.y + t * dy - sy);
      if (l.curve) d = Math.abs(d - Math.abs(l.curve) * 0.5);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------------------------- input
  private bind() {
    const c = this.canvas;
    const pos = (e: MouseEvent | PointerEvent | WheelEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    c.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      c.setPointerCapture(e.pointerId);
      const p = pos(e);
      const n = this.nodeAt(p.x, p.y);
      if (n) {
        this.drag = { id: n.id, sx: p.x, sy: p.y, moved: false, ox: (n.x ?? 0), oy: (n.y ?? 0) };
      } else if (e.shiftKey) {
        this.lasso = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      } else {
        this.pan = { sx: p.x, sy: p.y, cx: this.cam.x, cy: this.cam.y, moved: false };
      }
      this.camTarget = null;
    });

    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (this.drag) {
        const d = this.drag;
        if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > 3) {
          d.moved = true;
          this.sim.alphaTarget(0.25).restart();
          if (!this.selection.has(d.id)) this.cb.onSelect([d.id], false);
        }
        if (d.moved) {
          const w = this.toWorld(p.x, p.y), n = this.byId.get(d.id)!;
          n.fx = w.x; n.fy = w.y; this.dirty = true;
        }
        return;
      }
      if (this.pan) {
        if (Math.hypot(p.x - this.pan.sx, p.y - this.pan.sy) > 3) this.pan.moved = true;
        this.cam.x = this.pan.cx + (p.x - this.pan.sx); this.cam.y = this.pan.cy + (p.y - this.pan.sy);
        this.dirty = true; c.style.cursor = 'grabbing';
        return;
      }
      if (this.lasso) { this.lasso.x1 = p.x; this.lasso.y1 = p.y; this.dirty = true; return; }
      // hover
      const n = this.nodeAt(p.x, p.y);
      const h: Hover | null = n ? { kind: 'node', id: n.id, x: p.x, y: p.y } : (() => { const l = this.edgeAt(p.x, p.y); return l ? { kind: 'edge' as const, id: l.id, x: p.x, y: p.y } : null; })();
      if (h?.id !== this.hover?.id || h?.kind !== this.hover?.kind || (h && this.hover && (Math.abs(h.x - this.hover.x) > 2 || Math.abs(h.y - this.hover.y) > 2))) {
        this.hover = h; this.cb.onHover(h); this.dirty = true;
      }
      c.style.cursor = n ? 'pointer' : h ? 'pointer' : 'default';
    });

    c.addEventListener('pointerup', (e) => {
      const p = pos(e);
      c.releasePointerCapture?.(e.pointerId);
      if (this.drag) {
        const d = this.drag; this.drag = null;
        if (d.moved) {
          const n = this.byId.get(d.id)!;
          n.pinned = true; // dragging pins; double-click or the inspector unpins
          this.sim.alphaTarget(0);
          this.emitSettle();
        } else {
          const now = performance.now();
          if (this.lastClick.id === d.id && now - this.lastClick.t < 380) { this.cb.onOpen(d.id); this.lastClick = { t: 0, id: '' }; }
          else { this.cb.onSelect([d.id], e.shiftKey || e.metaKey); this.lastClick = { t: now, id: d.id }; }
        }
      } else if (this.pan) {
        const moved = this.pan.moved; this.pan = null; c.style.cursor = 'default';
        if (!moved) {
          const l = this.edgeAt(p.x, p.y);
          if (l) this.cb.onSelectEdge(l.id);
          else {
            const now = performance.now();
            if (now - this.lastClick.t < 380 && this.lastClick.id === '') { const w = this.toWorld(p.x, p.y); this.cb.onEmptyDouble(w.x, w.y); this.lastClick = { t: 0, id: '' }; }
            else { this.cb.onSelect([], false); this.cb.onSelectEdge(null); this.lastClick = { t: now, id: '' }; }
          }
        }
      } else if (this.lasso) {
        const L = this.lasso; this.lasso = null;
        const x0 = Math.min(L.x0, L.x1), x1 = Math.max(L.x0, L.x1), y0 = Math.min(L.y0, L.y1), y1 = Math.max(L.y0, L.y1);
        const ids = this.nodes.filter((n) => { const s = this.toScreen(n.x ?? 0, n.y ?? 0); return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1; }).map((n) => n.id);
        this.cb.onSelect(ids, e.metaKey);
        this.dirty = true;
      }
    });

    c.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.cb.onHover(null); this.dirty = true; } });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = pos(e); const n = this.nodeAt(p.x, p.y);
      this.cb.onContext(n?.id ?? null, e.clientX, e.clientY);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      const mouseWheel = !e.ctrlKey && e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
      if (e.ctrlKey || mouseWheel) this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)), p.x, p.y);
      else { this.cam.x -= e.deltaX; this.cam.y -= e.deltaY; this.camTarget = null; this.dirty = true; }
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const p = pos(e);
      if (!this.nodeAt(p.x, p.y) && !this.edgeAt(p.x, p.y)) { const w = this.toWorld(p.x, p.y); this.cb.onEmptyDouble(w.x, w.y); }
    });
  }

  unpin(id: string) { const n = this.byId.get(id); if (n) { n.fx = null; n.fy = null; n.pinned = false; this.reheat(); } }
  pin(id: string) { const n = this.byId.get(id); if (n) { n.fx = n.x; n.fy = n.y; n.pinned = true; this.dirty = true; this.emitSettle(); } }

  // ---------------------------------------------------------------------------------------------- render
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (this.camTarget) {
      const t = this.camTarget, f = 0.16;
      this.cam.x += (t.x - this.cam.x) * f; this.cam.y += (t.y - this.cam.y) * f; this.cam.k += (t.k - this.cam.k) * f;
      if (Math.abs(t.x - this.cam.x) < 0.3 && Math.abs(t.y - this.cam.y) < 0.3 && Math.abs(t.k - this.cam.k) < 0.001) { this.cam = { ...t }; this.camTarget = null; }
      this.dirty = true;
    }
    const animating = this.nodes.some((n) => now - n.born < 600) || this.links.some((l) => now - l.born < 600);
    if (this.dirty || animating) { this.dirty = false; this.draw(now); }
  };

  private dim(id: string): number {
    if (this.highlight) return this.highlight.nodes.has(id) ? 1 : 0.14;
    if (this.focus) return this.focus.has(id) ? 1 : 0.12;
    return 1;
  }

  private draw(now: number) {
    const { ctx, palette: P, cam } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // dot grid
    let step = 28 * cam.k;
    while (step < 14) step *= 2;
    if (step > 10) {
      ctx.fillStyle = P.dot;
      const ox = ((cam.x % step) + step) % step, oy = ((cam.y % step) + step) % step;
      for (let x = ox; x < this.w; x += step) for (let y = oy; y < this.h; y += step) ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }

    ctx.save();
    ctx.translate(cam.x, cam.y); ctx.scale(cam.k, cam.k);
    const lod = cam.k < 0.32;
    const selNeighbors = new Set<string>();
    for (const l of this.links) {
      const a = l.source as SimNode, b = l.target as SimNode;
      if (this.selection.has(a.id)) selNeighbors.add(l.id);
      if (this.selection.has(b.id)) selNeighbors.add(l.id);
    }
    const hasSel = this.selection.size > 0;
    const labelAll = selNeighbors.size <= 8; // a 27-link hub would turn into confetti

    // edges
    for (const l of this.links) {
      const a = l.source as SimNode, b = l.target as SimNode;
      if (!a || !b || typeof a === 'string') continue;
      const age = Math.min(1, (now - l.born) / 450);
      const inPath = this.highlight?.edges.has(l.id);
      const dim = Math.min(this.dim(a.id), this.dim(b.id));
      const sel = this.selectedEdge === l.id;
      const hot = selNeighbors.has(l.id) || this.hover?.id === l.id;
      ctx.globalAlpha = (inPath ? 1 : dim) * (this.reduceMotion ? 1 : ease(age)) * (hasSel && !selNeighbors.has(l.id) && !inPath && !sel ? 0.4 : 1);
      ctx.lineCap = 'round';
      const x0 = a.x ?? 0, y0 = a.y ?? 0, x1 = b.x ?? 0, y1 = b.y ?? 0;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
      const cx = mx + (nx / nl) * l.curve, cy = my + (ny / nl) * l.curve;
      const path = () => { ctx.beginPath(); ctx.moveTo(x0, y0); if (l.curve) ctx.quadraticCurveTo(cx, cy, x1, y1); else ctx.lineTo(x1, y1); };
      if (inPath) { path(); ctx.strokeStyle = P.accentSoft; ctx.lineWidth = 9 / cam.k * 1.0; ctx.stroke(); }
      path();
      ctx.strokeStyle = inPath || sel ? P.accent : hot ? P.text2 : P.edge;
      ctx.lineWidth = (0.8 + l.strength * 1.5 + (inPath || sel ? 1 : 0)) / Math.max(0.6, cam.k) * Math.min(1, cam.k + 0.3);
      ctx.setLineDash(l.kind === 'inferred' ? [5 / cam.k, 4 / cam.k] : l.kind === 'manual' ? [1.5 / cam.k, 3.5 / cam.k] : []);
      ctx.stroke(); ctx.setLineDash([]);
      if ((this.hover?.id === l.id || sel || inPath || (hot && labelAll)) && cam.k > 0.55) this.pill(l.label, cx * 0.5 + mx * 0.5, cy * 0.5 + my * 0.5, ctx.globalAlpha);
    }

    // nodes
    for (const n of this.nodes) {
      const x = n.x ?? 0, y = n.y ?? 0;
      const age = Math.min(1, (now - n.born) / 520);
      const sc = this.reduceMotion ? 1 : backOut(age);
      const dim = this.dim(n.id);
      const sel = this.selection.has(n.id), hov = this.hover?.id === n.id;
      const r = n.r * Math.max(0.01, sc) * (hov ? 1.06 : 1);
      ctx.globalAlpha = dim * Math.min(1, age * 2.2);

      if (sel) { ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.fillStyle = P.accentSoft; ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = P.nodeFill; ctx.fill();
      if (n.image && !lod) {
        const img = thumb(n.image, () => (this.dirty = true));
        if (img) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r - 1), 0, Math.PI * 2); ctx.clip(); ctx.drawImage(img, x - r, y - r, r * 2, r * 2); ctx.restore(); }
      }
      ctx.lineWidth = (sel ? 2.4 : 1.3) / Math.max(0.7, cam.k) * Math.min(1, cam.k + 0.4);
      ctx.strokeStyle = sel ? P.accent : P.nodeStroke;
      ctx.setLineDash(n.state === 'seed' ? [4 / cam.k, 3 / cam.k] : []);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);

      // confidence ring
      if (n.score !== undefined && n.state === 'confirmed' && !lod) {
        ctx.beginPath(); ctx.arc(x, y, r + 3.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * n.score);
        ctx.strokeStyle = P.lvl[n.level ?? 1]; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
      }

      // glyph
      if (!lod && !n.image) {
        if (n.type === 'person' || n.type === 'org') {
          ctx.fillStyle = P.nodeInk; ctx.font = `600 ${Math.round(r * 0.78)}px -apple-system, "SF Pro Text", Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(n.type === 'org' ? initials(n.label).slice(0, 2) : initials(n.label), x, y + 0.5);
        } else {
          const img = canvasIcon(n.type, P.nodeInk, () => (this.dirty = true));
          if (img) { const s = r * 1.18; ctx.drawImage(img, x - s / 2, y - s / 2, s, s); }
        }
      }
      if (n.pinned && !lod) { ctx.beginPath(); ctx.arc(x + r * 0.78, y - r * 0.78, 2.6, 0, Math.PI * 2); ctx.fillStyle = P.accent; ctx.fill(); }

    }

    // labels: greedy placement by priority so they never pile on top of each other
    if (!lod) this.drawLabels(now);
    ctx.restore();
    ctx.globalAlpha = 1;

    if (this.lasso) {
      const L = this.lasso;
      ctx.fillStyle = P.accentSoft; ctx.strokeStyle = P.accent; ctx.lineWidth = 1;
      ctx.fillRect(Math.min(L.x0, L.x1), Math.min(L.y0, L.y1), Math.abs(L.x1 - L.x0), Math.abs(L.y1 - L.y0));
      ctx.strokeRect(Math.min(L.x0, L.x1) + 0.5, Math.min(L.y0, L.y1) + 0.5, Math.abs(L.x1 - L.x0), Math.abs(L.y1 - L.y0));
    }
  }

  private drawLabels(now: number) {
    const { ctx, palette: P, cam } = this;
    const fs = 12 / Math.max(0.85, Math.min(1.15, cam.k));
    const cands = this.nodes
      .filter((n) => cam.k >= 0.72 || this.selection.has(n.id) || this.hover?.id === n.id || n.state === 'seed')
      .map((n) => ({ n, pri: (this.selection.has(n.id) || this.hover?.id === n.id ? 1e6 : 0) + (n.state === 'seed' ? 5e5 : 0) + n.degree * 10 + (n.score ?? 0) * 5 }))
      .sort((a, b) => b.pri - a.pri);
    const placed: [number, number, number, number][] = [];
    ctx.lineJoin = 'round';
    for (const { n, pri } of cands) {
      const sel = this.selection.has(n.id), hov = this.hover?.id === n.id;
      const age = Math.min(1, (now - n.born) / 520);
      const text = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label;
      ctx.font = `${sel || n.state === 'seed' ? 600 : 500} ${fs}px -apple-system, "SF Pro Text", Inter, system-ui, sans-serif`;
      const w = ctx.measureText(text).width, h = fs + 2;
      const x = n.x ?? 0, y = (n.y ?? 0) + n.r + 6;
      const rect: [number, number, number, number] = [x - w / 2 - 3, y - 1, x + w / 2 + 3, y + h];
      const clash = placed.some((q) => rect[0] < q[2] && rect[2] > q[0] && rect[1] < q[3] && rect[3] > q[1]);
      if (clash && pri < 5e5) continue;
      placed.push(rect);
      ctx.globalAlpha = this.dim(n.id) * Math.min(1, age * 2.2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineWidth = 4; ctx.strokeStyle = P.bg; ctx.strokeText(text, x, y);
      ctx.fillStyle = sel || hov ? P.text : P.text2; ctx.fillText(text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  private pill(text: string, x: number, y: number, alpha: number) {
    const { ctx, palette: P, cam } = this;
    const fs = 11 / cam.k;
    ctx.font = `500 ${fs}px -apple-system, "SF Pro Text", Inter, system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 12 / cam.k, h = 18 / cam.k;
    const prev = ctx.globalAlpha; ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2.2);
    ctx.fillStyle = P.nodeFill; ctx.fill(); ctx.lineWidth = 1 / cam.k; ctx.strokeStyle = P.edge; ctx.stroke();
    ctx.fillStyle = P.text2; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5 / cam.k);
    ctx.globalAlpha = prev;
  }

  destroy() { this.disposed = true; cancelAnimationFrame(this.raf); this.sim.stop(); clearTimeout(this.settleTimer); }
}
