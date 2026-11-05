import { describe, it, expect } from 'vitest';
import { dstFingerprint, inDst } from '../shared/forensics/dst';
import { TEMPLATE } from '../shared/forensics/circadian';
import type { DstRegime } from '../shared/forensics/dst';

const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const cdf = (() => { const c: number[] = []; let a = 0; for (const p of TEMPLATE) c.push((a += p)); return c; })();
/** A person living under `regime` with standard offset `std` (hours from UTC): local clock = UTC + std (+1 in daylight time). */
function live(regime: DstRegime, std: number, n: number, r: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const day = Date.UTC(2023, 0, 1) + Math.floor(r() * 730) * 86_400_000;
    const u = r(); const lh = Math.max(0, cdf.findIndex((x) => x >= u));
    // pick the UTC hour that yields local hour lh on that day
    let utcH = (((lh - std - (inDst(day + 12 * 3_600_000, regime) ? 1 : 0)) % 24) + 24) % 24;
    out.push(day + utcH * 3_600_000 + Math.floor(r() * 3_600_000));
  }
  return out;
}

describe('daylight-saving rules', () => {
  it('knows when the clocks change', () => {
    expect(inDst(Date.UTC(2024, 6, 1), 'us')).toBe(true); expect(inDst(Date.UTC(2024, 0, 15), 'us')).toBe(false);
    expect(inDst(Date.UTC(2024, 2, 9), 'us')).toBe(false); expect(inDst(Date.UTC(2024, 2, 11), 'us')).toBe(true);   // US 2024: 10 March
    expect(inDst(Date.UTC(2024, 2, 30), 'eu')).toBe(false); expect(inDst(Date.UTC(2024, 3, 1), 'eu')).toBe(true);   // EU 2024: 31 March
    expect(inDst(Date.UTC(2024, 0, 15), 'south')).toBe(true); expect(inDst(Date.UTC(2024, 6, 15), 'south')).toBe(false);
    expect(inDst(Date.UTC(2024, 6, 15), 'none')).toBe(false);
  });
});

describe('daylight-saving fingerprint', () => {
  const grp = (r: DstRegime) => (r === 'us' || r === 'eu' ? 'north' : r);
  it('tells whether the clocks change, and in which hemisphere, from a long record', () => {
    for (const [reg, std] of [['none', -6], ['us', -6], ['eu', 1], ['south', 10]] as const) {
      let right = 0; const N = 14;
      for (let s = 1; s <= N; s++) if (dstFingerprint(live(reg, std, 2500, rng(s * 29)))!.group.group === grp(reg)) right++;
      expect(right / N, reg).toBeGreaterThanOrEqual(0.8);
    }
  });
  it('is calibrated: its stated probability for the group matches how often it is right', () => {
    for (const n of [600, 1500]) {
      let p = 0, hit = 0, k = 0;
      for (let s = 1; s <= 60; s++) { const reg = (['none', 'us', 'eu', 'south'] as DstRegime[])[s % 4]; const f = dstFingerprint(live(reg, [-6, -6, 1, 10][s % 4], n, rng(s * 53 + n)))!; p += f.group.p; hit += f.group.group === grp(reg) ? 1 : 0; k++; }
      expect(Math.abs(p / k - hit / k), `N=${n}`).toBeLessThanOrEqual(0.12);
    }
  });
  it('is honest when it cannot tell: little data or only one season', () => {
    expect(dstFingerprint(live('us', -6, 30, rng(1)))!.strength).toBe('insufficient');
    const winterOnly = live('us', -6, 800, rng(2)).filter((t) => !inDst(t, 'us') && !inDst(t, 'eu') && new Date(t).getUTCMonth() <= 1);
    expect(dstFingerprint(winterOnly)!.strength).toBe('insufficient');
    expect(dstFingerprint([1, 2])).toBeNull();
  });
  it('probabilities add up, and the summary says what it found', () => {
    const f = dstFingerprint(live('us', -6, 2500, rng(7)))!;
    expect(f.regimes.reduce((a, b) => a + b.p, 0)).toBeCloseTo(1, 9); expect(f.groups.reduce((a, b) => a + b.p, 0)).toBeCloseTo(1, 9);
    expect(f.summary.length).toBeGreaterThan(20);
  });
});
