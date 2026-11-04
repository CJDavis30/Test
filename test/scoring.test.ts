import { describe, it, expect } from 'vitest';
import { learnedReliability, scoreEvidence, levelFor, rescore, parseContext, contextBoost } from '../shared/scoring';
import type { Evidence, Finding } from '../shared/types';

const ev = (adapter: string, family: string, weight: number): Evidence => ({
  id: adapter, adapter, adapterName: adapter, family, retrievedAt: 0, weight,
});
const rel = () => 0.9;

describe('scoreEvidence', () => {
  it('corroboration from independent families raises belief', () => {
    const one = scoreEvidence('email', [ev('a', 'fa', 0.6)], rel).score;
    const two = scoreEvidence('email', [ev('a', 'fa', 0.6), ev('b', 'fb', 0.6)], rel).score;
    expect(two).toBeGreaterThan(one);
  });
  it('same-family evidence is counted once', () => {
    const one = scoreEvidence('email', [ev('a', 'f', 0.6)], rel).score;
    const dup = scoreEvidence('email', [ev('a', 'f', 0.6), ev('b', 'f', 0.55)], rel).score;
    expect(dup).toBeCloseTo(one, 5);
  });
  it('never reaches certainty', () => {
    const s = scoreEvidence('email', Array.from({ length: 12 }, (_, i) => ev('a' + i, 'f' + i, 0.99)), rel).score;
    expect(s).toBeLessThanOrEqual(0.99);
  });
});

describe('levels', () => {
  it('maps thresholds', () => {
    expect([0.1, 0.4, 0.65, 0.85].map(levelFor)).toEqual([1, 2, 3, 4]);
  });
});

describe('learnedReliability', () => {
  it('moves toward user decisions and stays bounded', () => {
    expect(learnedReliability(0.7)).toBe(0.7);
    expect(learnedReliability(0.7, { accepted: 0, rejected: 40 })).toBeLessThan(0.2);
    expect(learnedReliability(0.7, { accepted: 200, rejected: 0 })).toBeLessThanOrEqual(0.99);
  });
});

function mk(over: Partial<Finding>): Finding {
  return {
    id: 'x', caseId: 'c', runId: 'r', subjectId: 's', type: 'location', value: 'Austin, TX', key: 'austin tx',
    relation: 'based in', attrs: {}, evidence: [ev('a', 'fa', 0.7)], score: 0, rank: 0, level: 1, reasons: [],
    status: 'pending', createdAt: 0, ...over,
  };
}

describe('conflicts & context', () => {
  it('demotes the weaker of two competing values and links them', () => {
    const a = mk({ id: 'a', value: 'Austin, TX', conflictKey: 'location', evidence: [ev('a', 'fa', 0.8), ev('b', 'fb', 0.7)] });
    const b = mk({ id: 'b', value: 'Berlin', key: 'berlin', conflictKey: 'location', evidence: [ev('c', 'fc', 0.5)] });
    rescore([a, b], rel);
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.conflictsWith).toEqual(['a']);
    expect(b.reasons.join()).toMatch(/Disagrees/);
  });
  it('context re-ranks but does not change confidence', () => {
    const f = mk({ type: 'org', value: 'Northwind Labs', relation: 'works at' });
    rescore([f], rel);
    const before = f.score;
    rescore([f], rel, 'where does this person work, employer');
    expect(f.score).toBe(before);
    expect(f.rank).toBeGreaterThan(before);
    expect(contextBoost(f, parseContext(''))).toBe(0);
  });
});
