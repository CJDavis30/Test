import { describe, it, expect } from 'vitest';
import { stressTest, dependencies } from '../shared/stress';
import { rescore, scoreEvidence, levelFor } from '../shared/scoring';
import type { Evidence, Finding } from '../shared/types';

const rel = () => 0.8;
const ev = (family: string, weight: number, extra: Partial<Evidence> = {}): Evidence => ({ id: family + weight, adapter: family, adapterName: family.toUpperCase(), family, retrievedAt: 0, weight, ...extra });
const mk = (evidence: Evidence[], type: Finding['type'] = 'username'): Finding => {
  const f = { id: 'f', type, value: 'v', key: 'v', relation: 'username', evidence, score: 0, level: 1, rank: 0, reasons: [], status: 'pending' } as unknown as Finding;
  rescore([f], rel); return f;
};

describe('stress test (leave one source out)', () => {
  it('a single source is a single point of failure, however sure it looks', () => {
    const s = stressTest(mk([ev('a', 0.98)]), rel);
    expect(s.verdict).toBe('single'); expect(s.headline).toMatch(/Rests entirely on A/); expect(s.survives).toBe(0);
  });
  it('many independent sources are solid: losing any one barely moves it', () => {
    const f = mk([ev('a', 0.9), ev('b', 0.9), ev('c', 0.9), ev('d', 0.9)]);
    const s = stressTest(f, rel);
    expect(s.verdict).toBe('solid');
    expect(levelFor(s.survives)).toBe(f.level);
  });
  it('one dominant source plus a weak one is fragile, and names the source it hinges on', () => {
    const f = mk([ev('strong', 0.95), ev('weak', 0.15)]);
    const s = stressTest(f, rel);
    expect(['fragile', 'sturdy']).toContain(s.verdict);
    expect(s.weakest?.family).toBe('strong');
    expect(s.weakest!.after).toBeLessThan(f.score);
    expect(s.drops[0].drop).toBeGreaterThanOrEqual(s.drops[1].drop);
  });
  it('removing evidence never raises a score, and base equals the stored score', () => {
    const f = mk([ev('a', 0.7), ev('b', 0.6), ev('c', 0.5)]);
    const s = stressTest(f, rel);
    expect(s.base).toBe(f.score);
    for (const d of s.drops) expect(d.after).toBeLessThanOrEqual(f.score + 1e-9);
  });
  it('a cross-check from the same source family is not a second opinion, so it cannot hold a finding up on its own', () => {
    const f = mk([ev('gh', 0.8), ev('gh', 0.7, { kind: 'cross' })]);
    expect(stressTest(f, rel).verdict).toBe('single');
  });
  it('tells you what a contradiction is costing', () => {
    const f = mk([ev('a', 0.8), ev('b', 0.7), ev('c', 0.7, { polarity: 'against' })]);
    const s = stressTest(f, rel);
    expect(s.ifContradictionWrong).toBeGreaterThan(f.score);
    expect(s.ifContradictionWrong).toBeCloseTo(scoreEvidence('username', f.evidence.filter((e) => e.polarity !== 'against'), rel).score, 6);
  });
  it('keeps conflict demotion in the numbers so what is shown matches the screen', () => {
    const f = mk([ev('a', 0.9), ev('b', 0.9)]);
    const raw = f.score; f.score = raw * 0.5; // another source answered the same question differently
    const s = stressTest(f, rel);
    expect(s.base).toBeCloseTo(raw * 0.5, 9);
    for (const d of s.drops) expect(d.after).toBeLessThanOrEqual(raw * 0.5 + 1e-9);
  });
  it('level-1 leads are too thin to stress', () => {
    expect(stressTest(mk([ev('a', 0.2), ev('b', 0.1)]), rel).verdict).toBe('thin');
  });
});

describe('dependencies across a case', () => {
  it('counts how many conclusions lean on each source, most dependent first', () => {
    const shared = ev('broker', 0.9);
    const fs = [mk([shared, ev('x', 0.2)]), mk([shared, ev('y', 0.2)]), mk([ev('a', 0.9), ev('b', 0.9), ev('c', 0.9)])];
    const dep = dependencies(fs, rel);
    expect(dep[0].family).toBe('broker');
    expect(dep[0].weakens.length).toBe(2);
    expect(dep.find((d) => d.family === 'a')).toBeUndefined(); // the well-corroborated one depends on nobody
  });
});
