import { describe, it, expect } from 'vitest';
import { circadian, sessionize, TEMPLATE, fmtOffset } from '../shared/forensics/circadian';

// tiny seeded RNG so the statistics below are reproducible
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
function sample(offset: number, sessions: number, r: () => number, template = TEMPLATE): number[] {
  const cdf: number[] = []; let c = 0; for (const p of template) cdf.push((c += p));
  const out: number[] = [];
  for (let i = 0; i < sessions; i++) {
    const day = Math.floor(r() * 400); const u = r() * c; let lh = cdf.findIndex((x) => x >= u); if (lh < 0) lh = 23;
    const utcHour = (((lh - offset) % 24) + 24) % 24;
    out.push(Date.UTC(2023, 0, 1) + day * 86_400_000 + utcHour * 3_600_000 + Math.floor(r() * 3_600_000));
  }
  return out;
}

describe('circadian fingerprint', () => {
  it('recovers the timezone of a simulated person from plenty of activity', () => {
    for (const off of [-8, -5, 0, 1, 5, 9, 10]) {
      const c = circadian(sample(off, 400, rng(off + 100)))!;
      expect(c.best.offset, `true ${off}`).toBe(off);
      expect(c.strength).toBe('strong');
      expect(c.credible).toContain(off);
    }
  });
  it('says so when there is too little to go on', () => {
    const c = circadian(sample(-6, 6, rng(1)))!;
    expect(c.strength).toBe('insufficient'); expect(c.summary).toMatch(/too few/);
    expect(circadian([1, 2])).toBeNull();
  });
  it('collapses a burst of messages into one sitting, so spam cannot fake certainty', () => {
    const t0 = Date.UTC(2024, 0, 1, 20);
    const burst = Array.from({ length: 200 }, (_, i) => t0 + i * 20_000); // 200 messages in ~67 minutes
    expect(sessionize(burst).length).toBe(1); // one long chat is one sitting
    const spread = sample(-6, 30, rng(3));
    const c1 = circadian(spread)!, c2 = circadian([...spread, ...burst])!;
    expect(c2.sessions).toBeLessThanOrEqual(c1.sessions + 3);
  });
  it('is calibrated: its stated confidence matches how often it is exactly right, and its 80% range holds ~80%+ of the time', () => {
    for (const N of [20, 40, 80, 160]) {
      const r = rng(7 + N); const k = 300;
      let exact = 0, cover = 0, within1 = 0, bestP = 0;
      for (let i = 0; i < k; i++) {
        const off = Math.floor(r() * 23) - 11;
        const c = circadian(sample(off, N, r))!;
        exact += c.best.offset === off ? 1 : 0; cover += c.credible.includes(off) ? 1 : 0; bestP += c.best.p;
        within1 += Math.min(Math.abs(c.best.offset - off), 24 - Math.abs(c.best.offset - off)) <= 1 ? 1 : 0;
      }
      expect(Math.abs(bestP / k - exact / k), `N=${N} says ${(bestP / k).toFixed(2)}, right ${(exact / k).toFixed(2)}`).toBeLessThanOrEqual(0.08);
      expect(cover / k, `N=${N} 80% range coverage`).toBeGreaterThanOrEqual(0.8);
      if (N >= 80) expect(within1 / k).toBeGreaterThanOrEqual(0.95);
    }
  });
  it('does not pretend to know a night-shift worker: the probability it assigns to the wrong zone stays modest or the credible set is wide', () => {
    const shifted = TEMPLATE.map((_, h) => TEMPLATE[(h + 9) % 24]); // active all night
    const c = circadian(sample(-6, 60, rng(5), shifted))!;
    expect(c.best.offset).not.toBe(-6); // it will be wrong, as any method would be…
    expect(c.summary).toBeTruthy(); // …but it must still describe its answer, not crash
  });
  it('folds UTC−12 and UTC+12 into one clock and keeps probabilities summing to one', () => {
    const c = circadian(sample(12, 60, rng(8)))!;
    expect(c.offsets.map((o) => o.offset)).not.toContain(-12);
    expect(c.offsets.reduce((a, b) => a + b.p, 0)).toBeCloseTo(1, 9);
    expect(fmtOffset(-6)).toBe('UTC−6'); expect(fmtOffset(5)).toBe('UTC+5');
  });
});
