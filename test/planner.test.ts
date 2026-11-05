import { describe, it, expect } from 'vitest';
import { bestMoves, expectedGain, type Candidate } from '../shared/planner';
import type { Finding } from '../shared/types';

const src = (id: string, r = 0.8, extra: Partial<Candidate> = {}): Candidate => ({ id, name: id.toUpperCase(), reliability: r, accepts: ['username', 'email'], used: false, needsKey: false, keySet: true, enabled: true, ...extra });
const f = (id: string, score: number, extra: Partial<Finding> = {}) => ({ id, type: 'username' as const, value: id, score, status: 'pending' as const, evidence: [], ...extra }) as Pick<Finding, 'id' | 'type' | 'value' | 'score' | 'status' | 'evidence' | 'conflictsWith'>;

describe('expected information gain', () => {
  it('is largest when we are most unsure, and negligible when we already know', () => {
    const g = (p: number) => expectedGain(p, 0.8).gain;
    expect(g(0.5)).toBeGreaterThan(g(0.8)); expect(g(0.5)).toBeGreaterThan(g(0.2)); expect(g(0.99)).toBeLessThan(0.05); expect(g(0.01)).toBeLessThan(0.05);
  });
  it('is never negative, and a more reliable source teaches more', () => {
    for (const p of [0.05, 0.3, 0.5, 0.7, 0.95]) for (const r of [0.4, 0.6, 0.9]) expect(expectedGain(p, r).gain).toBeGreaterThanOrEqual(0);
    expect(expectedGain(0.5, 0.9).gain).toBeGreaterThan(expectedGain(0.5, 0.5).gain);
  });
  it('confirmation raises confidence and silence lowers it, and the probabilities are coherent', () => {
    const e = expectedGain(0.5, 0.8);
    expect(e.ifConfirms).toBeGreaterThan(0.5); expect(e.ifSilent).toBeLessThan(0.5);
    // the expected posterior equals the prior (martingale property of Bayesian updating)
    expect(e.pConfirm * e.ifConfirms + (1 - e.pConfirm) * e.ifSilent).toBeCloseTo(0.5, 9);
  });
});

describe('best moves', () => {
  it('ranks the most uncertain finding first and ignores decided ones', () => {
    const m = bestMoves([f('sure', 0.97), f('toss', 0.5), f('maybe', 0.3), f('done', 0.5, { status: 'accepted' }), f('no', 0.5, { status: 'rejected' })], [src('gh')]);
    expect(m.map((x) => x.value)).toEqual(['toss', 'maybe', 'sure']);
  });
  it('never suggests a source that has already weighed in, and picks the more reliable of two', () => {
    const used = f('x', 0.5, { evidence: [{ id: 'e', adapter: 'gh', adapterName: 'GH', family: 'gh', retrievedAt: 0, weight: 0.8 }] });
    expect(bestMoves([used], [src('gh')])).toEqual([]);
    expect(bestMoves([f('x', 0.5)], [src('weak', 0.5), src('strong', 0.9)])[0].source.id).toBe('strong');
  });
  it('lets a dispute raise the priority, and puts moves you can make now before ones that need a key', () => {
    expect(bestMoves([f('a', 0.5), f('b', 0.5, { conflictsWith: ['z'] })], [src('s')])[0].value).toBe('b');
    const m = bestMoves([f('a', 0.5)], [src('keyed', 0.95, { needsKey: true, keySet: false }), src('free', 0.8)]);
    expect(m[0].source.id).toBe('free'); expect(m[0].action).toBe('lookup');
    expect(bestMoves([f('a', 0.5)], [src('keyed', 0.95, { needsKey: true, keySet: false })])[0].action).toBe('add-key');
  });
  it('respects what a source accepts', () => { expect(bestMoves([{ ...f('p', 0.5), type: 'phone' as const }], [src('gh')])).toEqual([]); });
});
