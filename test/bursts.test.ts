import { describe, it, expect } from 'vitest';
import { findBursts, poissonTail } from '../shared/forensics/bursts';
import { ledger } from '../shared/ledger';
import { rescore } from '../shared/scoring';
import type { Evidence, Finding } from '../shared/types';

const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const YEAR = 365 * 86_400_000;

describe('Poisson tail', () => {
  it('matches known values', () => {
    expect(poissonTail(0, 3)).toBe(1);
    expect(poissonTail(1, 1)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(poissonTail(3, 2)).toBeCloseTo(1 - Math.exp(-2) * (1 + 2 + 2), 12);
    expect(poissonTail(10, 0.001)).toBeLessThan(1e-20);
  });
});

describe('creation bursts', () => {
  const noise = (r: () => number, n: number, base = Date.UTC(2020, 0, 1)) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, at: base + Math.floor(r() * 4 * YEAR) }));
  it('finds three accounts made within a minute among 25 spread over four years', () => {
    const r = rng(3); const t0 = Date.UTC(2022, 5, 1, 3, 0, 0);
    const items = [...noise(r, 25), { id: 'a', at: t0 }, { id: 'b', at: t0 + 22_000 }, { id: 'c', at: t0 + 41_000 }];
    const b = findBursts(items);
    expect(b.length).toBeGreaterThanOrEqual(1);
    expect(new Set(b[0].ids)).toEqual(new Set(['a', 'b', 'c']));
    expect(b[0].p).toBeLessThan(1e-4); expect(b[0].bits).toBeGreaterThan(13);
  });
  it('does not cry wolf: on random creation times the false-alarm rate stays at or below alpha', () => {
    let alarms = 0; const RUNS = 600;
    for (let s = 1; s <= RUNS; s++) if (findBursts(noise(rng(s * 7), 30)).length > 0) alarms++;
    expect(alarms / RUNS).toBeLessThanOrEqual(0.01);
  });
  it('needs at least three accounts and handles empty and tiny inputs', () => {
    expect(findBursts([])).toEqual([]); expect(findBursts([{ id: 'x', at: 1 }, { id: 'y', at: 2 }])).toEqual([]);
  });
  it('reports one burst per group of accounts, not a pile of overlapping ones', () => {
    const t0 = Date.UTC(2023, 0, 1); const items = [...noise(rng(9), 20), ...[0, 10, 20, 30].map((s, i) => ({ id: `b${i}`, at: t0 + s * 1000 }))];
    const b = findBursts(items); expect(b.filter((x) => x.ids.includes('b0')).length).toBe(1); expect(b[0].count).toBe(4);
  });
});

describe('the bits ledger', () => {
  const rel = () => 0.8;
  const ev = (family: string, weight: number, extra: Partial<Evidence> = {}): Evidence => ({ id: family + weight, adapter: family, adapterName: family.toUpperCase(), family, retrievedAt: 0, weight, ...extra });
  const mk = (evidence: Evidence[]) => { const f = { id: 'f', type: 'username', evidence, score: 0, level: 1, rank: 0, reasons: [], status: 'pending' } as unknown as Finding; rescore([f], rel); return f; };
  it('adds up the surprise of every source being wrong at once, and agrees with the score', () => {
    const f = mk([ev('a', 0.9), ev('b', 0.7), ev('c', 0.5)]);
    const l = ledger(f, rel);
    expect(l.sources).toBe(3);
    expect(l.total).toBeCloseTo(l.rows.reduce((s, r) => s + r.bits, 0), 12);
    // belief = 1 − (chance all wrong) = 1 − 2^−bits
    expect(1 - 2 ** -l.total).toBeCloseTo(f.score, 6);
    expect(l.allWrongOneIn).toBeCloseTo(1 / (1 - f.score), 6);
  });
  it('counts a source family once and ignores contradicting evidence', () => {
    const l = ledger(mk([ev('gh', 0.8), ev('gh', 0.6, { kind: 'cross' }), ev('x', 0.9, { polarity: 'against' })]), rel);
    expect(l.sources).toBe(1);
  });
  it('puts the strongest source first', () => { const l = ledger(mk([ev('weak', 0.2), ev('strong', 0.95)]), rel); expect(l.rows[0].family).toBe('strong'); });
});
