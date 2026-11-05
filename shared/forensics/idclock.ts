/**
 * Self-calibrating ID clocks. Some platforms hand out account IDs in order (Roblox, Steam account numbers, older Twitter IDs), so an ID is a
 * rough timestamp, but the exchange rate between ID and date is not published and changes as the platform grows. Plexus learns it: every
 * profile it sees, with a known ID and a known creation time, becomes an anchor, and any later ID can be dated by interpolating between the
 * anchors around it, with an error band that comes from how well the anchors predict each other (leave-one-out), not from a guess.
 *
 * It starts empty and says so; with too few anchors it gives no estimate at all.
 */
export interface Anchor { id: number; at: number }
export interface IdEstimate { at: number; lo: number; hi: number; anchors: number; /** typical error in days, from leave-one-out */ typicalErrorDays: number; extrapolated: boolean }

const MIN_ANCHORS = 6;

/** Pool-adjacent-violators: the closest non-decreasing times, because an account created later cannot have a smaller ID. */
function monotone(a: Anchor[]): Anchor[] {
  const blocks: { id: number[]; at: number[]; mean: number }[] = [];
  for (const x of a) {
    blocks.push({ id: [x.id], at: [x.at], mean: x.at });
    while (blocks.length > 1 && blocks[blocks.length - 2].mean > blocks[blocks.length - 1].mean) {
      const b = blocks.pop()!, p = blocks.pop()!;
      const at = [...p.at, ...b.at], id = [...p.id, ...b.id];
      blocks.push({ id, at, mean: at.reduce((s, v) => s + v, 0) / at.length });
    }
  }
  return blocks.flatMap((b) => b.id.map((id) => ({ id, at: b.mean })));
}

function interpolate(A: Anchor[], id: number): { at: number; lo: Anchor; hi: Anchor; inside: boolean } {
  let i = 0; while (i < A.length - 1 && A[i + 1].id < id) i++;
  if (id < A[0].id) { const lo = A[0], hi = A[Math.min(2, A.length - 1)]; const k = (hi.at - lo.at) / Math.max(1, hi.id - lo.id); return { at: lo.at + (id - lo.id) * k, lo, hi, inside: false }; }
  if (id > A[A.length - 1].id) { const hi = A[A.length - 1], lo = A[Math.max(0, A.length - 3)]; const k = (hi.at - lo.at) / Math.max(1, hi.id - lo.id); return { at: hi.at + (id - hi.id) * k, lo, hi, inside: false }; }
  const lo = A[i], hi = A[Math.min(i + 1, A.length - 1)];
  if (hi.id === lo.id) return { at: lo.at, lo, hi, inside: true };
  return { at: lo.at + ((id - lo.id) / (hi.id - lo.id)) * (hi.at - lo.at), lo, hi, inside: true };
}

export class IdClock {
  private raw: Anchor[];
  constructor(anchors: Anchor[] = []) { this.raw = [...anchors].filter((a) => Number.isFinite(a.id) && Number.isFinite(a.at)).sort((x, y) => x.id - y.id); }
  get anchors(): Anchor[] { return this.raw; }
  get size() { return this.raw.length; }
  add(id: number, at: number) {
    if (!Number.isFinite(id) || !Number.isFinite(at) || id < 0) return;
    const i = this.raw.findIndex((a) => a.id === id);
    if (i >= 0) { this.raw[i] = { id, at }; return; }
    this.raw.push({ id, at }); this.raw.sort((x, y) => x.id - y.id);
    if (this.raw.length > 3000) this.raw = this.raw.filter((_, k) => k % 2 === 0 || k === this.raw.length - 1); // thin an enormous history evenly
  }

  /** 90th-percentile absolute error (ms) of predicting each interior anchor from the others. */
  private looError(A: Anchor[]): number {
    const errs: number[] = [];
    for (let k = 1; k < A.length - 1; k++) { const rest = [...A.slice(0, k), ...A.slice(k + 1)]; errs.push(Math.abs(interpolate(rest, A[k].id).at - A[k].at)); }
    errs.sort((a, b) => a - b); return errs.length ? errs[Math.min(errs.length - 1, Math.floor(errs.length * 0.9))] : 0;
  }

  estimate(id: number): IdEstimate | null {
    if (this.raw.length < MIN_ANCHORS || !Number.isFinite(id) || id < 0) return null;
    const A = monotone(this.raw);
    const e = interpolate(A, id), err = this.looError(A);
    const span = Math.max(1, e.hi.at - e.lo.at);
    // a band that covers about 80% of cases: the typical leave-one-out error scaled up, never narrower than a fraction of the gap between neighbours
    let half = Math.max(1.6 * err, 0.25 * span, 86_400_000);
    if (!e.inside) { const beyond = id < A[0].id ? A[0].id - id : id - A[A.length - 1].id, range = Math.max(1, A[A.length - 1].id - A[0].id); half += (beyond / range) * (A[A.length - 1].at - A[0].at) * 0.5; }
    return { at: e.at, lo: e.at - half, hi: e.at + half, anchors: this.raw.length, typicalErrorDays: err / 86_400_000, extrapolated: !e.inside };
  }
}

export const fmtMonth = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
export function describeEstimate(e: IdEstimate): string {
  const days = (e.hi - e.lo) / 2 / 86_400_000;
  const pm = days < 45 ? `${Math.max(1, Math.round(days))} days` : days < 700 ? `${Math.round(days / 30)} months` : `${(days / 365).toFixed(1)} years`;
  return `around ${fmtMonth(e.at)} (±${pm}${e.extrapolated ? ', beyond the IDs seen so far' : ''}), estimated from ${e.anchors} accounts Plexus has seen`;
}
