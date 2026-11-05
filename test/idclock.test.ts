import { describe, it, expect } from 'vitest';
import { IdClock, describeEstimate } from '../shared/forensics/idclock';

const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const T0 = Date.UTC(2008, 0, 1), YEAR = 365.25 * 86_400_000;
/** A platform whose sign-ups accelerate: IDs grow roughly with the square of time, plus noise (bursts and lulls). */
const world = (r: () => number, n: number) => Array.from({ length: n }, () => { const u = r(); const years = u * 14; const id = Math.round(1000 + 5e6 * (years ** 1.8) * (0.97 + 0.06 * r())); return { id, at: T0 + years * YEAR }; });

describe('self-calibrating ID clock', () => {
  it('gives no estimate until it has seen enough accounts, and says so by returning nothing', () => {
    const c = new IdClock(); expect(c.estimate(5000)).toBeNull();
    for (let i = 0; i < 5; i++) c.add(1000 * (i + 1), T0 + i * YEAR); expect(c.estimate(2500)).toBeNull();
    c.add(6000, T0 + 5 * YEAR); expect(c.estimate(2500)).not.toBeNull();
  });
  it('dates an unseen ID from its neighbours, accurately on a platform with accelerating growth', () => {
    const r = rng(3); const w = world(r, 400); const train = w.slice(0, 60), test = w.slice(60);
    const c = new IdClock(train); const errs: number[] = []; let covered = 0, n = 0;
    for (const x of test) { const e = c.estimate(x.id); if (!e) continue; n++; errs.push(Math.abs(e.at - x.at)); if (x.at >= e.lo && x.at <= e.hi) covered++; }
    errs.sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length / 2)] / 86_400_000).toBeLessThan(120);  // median error under four months over a 14-year span
    expect(covered / n).toBeGreaterThanOrEqual(0.75);                          // the stated band holds about as often as claimed
  });
  it('gets better with more anchors, and its error band shrinks with it', () => {
    const r = rng(8); const w = world(r, 600); const probe = w.slice(300);
    const err = (k: number) => { const c = new IdClock(w.slice(0, k)); const e = probe.map((x) => c.estimate(x.id)).filter(Boolean).map((e, i) => Math.abs(e!.at - probe[i].at)); return e.reduce((a, b) => a + b, 0) / e.length; };
    expect(err(250)).toBeLessThan(err(12));
    const band = (k: number) => { const c = new IdClock(w.slice(0, k)); const e = c.estimate(probe[10].id)!; return e.hi - e.lo; };
    expect(band(250)).toBeLessThan(band(12));
  });
  it('is monotone: a later ID is never dated earlier, even when the anchors are noisy', () => {
    const r = rng(5); const w = world(r, 120).map((x) => ({ ...x, at: x.at + (r() - 0.5) * 0.4 * YEAR })); const c = new IdClock(w);
    let last = -Infinity; for (let id = 1000; id < 4e8; id = Math.round(id * 1.3)) { const e = c.estimate(id)!; expect(e.at).toBeGreaterThanOrEqual(last - 1); last = e.at; }
  });
  it('widens its band beyond the IDs it has seen and flags extrapolation', () => {
    const w = world(rng(2), 80); const c = new IdClock(w); const max = Math.max(...w.map((x) => x.id));
    const inside = c.estimate(Math.round(max * 0.5))!, beyond = c.estimate(Math.round(max * 1.4))!;
    expect(inside.extrapolated).toBe(false); expect(beyond.extrapolated).toBe(true); expect(beyond.hi - beyond.lo).toBeGreaterThan(inside.hi - inside.lo);
  });
  it('ignores bad input, keeps duplicates from piling up, and describes its answer in words', () => {
    const c = new IdClock(); c.add(NaN, 1); c.add(5, NaN); c.add(-1, 1); expect(c.size).toBe(0);
    for (let i = 0; i < 10; i++) c.add(100, T0 + i); expect(c.size).toBe(1);
    const w = world(rng(4), 50); const d = new IdClock(w).estimate(w[25].id)!; expect(describeEstimate(d)).toMatch(/estimated from 50 accounts/);
  });
});
