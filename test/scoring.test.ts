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

import { ruleBrief } from '../shared/scoring';
describe('ruleBrief', () => {
  const f = (id: string, type: Finding['type'], value: string, rank: number, level: 1 | 2 | 3 | 4 = 3): Finding => mk({ id, type, value, key: value.toLowerCase(), rank, score: rank, level, relation: 'r', evidence: [ev('a', 'f' + id, 0.8)] });
  const ids = (fs: Finding[]) => new Map(fs.map((x, i) => [x.id, `F${i + 1}`]));
  it('leads with the searched name and lists other names as aliases', () => {
    const fs = [f('1', 'person', 'Mara L. Linden', 0.9), f('2', 'org', 'Northwind Labs', 0.8), f('3', 'location', 'Austin, TX', 0.7)];
    const b = ruleBrief({ type: 'person', value: 'Mara Linden' }, fs, ids(fs));
    expect(b.headline).toBe('Mara Linden · Northwind Labs · Austin, TX');
    expect(b.summary).toContain('Also appears as Mara L. Linden');
    expect(b.summary).not.toContain('Most likely name');
  });
  it('for an email subject, the best name leads', () => {
    const fs = [f('1', 'person', 'Jane Roe', 0.9)];
    expect(ruleBrief({ type: 'email', value: 'j@x.example' }, fs, ids(fs)).headline).toBe('Jane Roe');
  });
  it('summarises long tallies without a dangling "and more"', () => {
    const types: Finding['type'][] = ['person', 'email', 'phone', 'username', 'account', 'org', 'location'];
    const fs = types.map((t, i) => f(String(i), t, `${t} value`, 0.5));
    const b = ruleBrief({ type: 'email', value: 'x@y.example' }, fs, ids(fs));
    expect(b.summary).toMatch(/Found 1 name, 1 email, 1 phone number, 1 username and 1 account, plus 2 other kinds of finding/);
  });
  it('every citation in the summary resolves through cites', () => {
    const fs = [f('1', 'person', 'Jane Roe', 0.9), f('2', 'org', 'Acme', 0.8)];
    const b = ruleBrief({ type: 'email', value: 'j@acme.example' }, fs, ids(fs));
    for (const m of b.summary.matchAll(/\[(F\d+)\]/g)) expect(b.cites[m[1]]).toBeTruthy();
  });
});

describe('evidence for and against', () => {
  const xe = (adapter: string, family: string, weight: number, extra: Partial<Evidence> = {}): Evidence => ({ id: adapter + family, adapter, adapterName: adapter, family, retrievedAt: 0, weight, ...extra });
  it('contradictions lower the score but cannot erase strong independent support', () => {
    const pro = [xe('a', 'fa', 0.8), xe('b', 'fb', 0.8)];
    const base = scoreEvidence('username', pro, rel).score;
    const hit = scoreEvidence('username', [...pro, xe('c', 'fc', 0.8, { polarity: 'against', kind: 'cross' })], rel);
    expect(hit.score).toBeLessThan(base);
    expect(hit.score).toBeGreaterThan(base * 0.3);
    expect(hit.against).toBe(1);
    expect(hit.reasons.join(' ')).toMatch(/contradict/);
  });
  it('a lone weak guess that a cross-check contradicts drops to near nothing', () => {
    const r = scoreEvidence('username', [xe('derive', 'derived', 0.25), xe('gh', 'github', 0.9, { polarity: 'against', kind: 'cross' })], rel);
    expect(r.score).toBeLessThan(0.1);
  });
  it('a cross-check from a NEW source family raises the score; from the same family it does not', () => {
    const direct = [xe('github', 'github', 0.7)];
    const base = scoreEvidence('username', direct, rel).score;
    const sameFamily = scoreEvidence('username', [...direct, xe('github', 'github', 0.7, { kind: 'cross' })], rel).score;
    const newFamily = scoreEvidence('username', [...direct, xe('gravatar', 'gravatar', 0.7, { kind: 'cross' })], rel);
    expect(sameFamily).toBeCloseTo(base, 6);
    expect(newFamily.score).toBeGreaterThan(base);
    expect(newFamily.reasons.join(' ')).toMatch(/1 cross-check from other sources back it up/);
  });
  it('describes direct vs cross-check support separately', () => {
    const r = scoreEvidence('email', [xe('a', 'fa', 0.8), xe('b', 'fb', 0.7), xe('c', 'fc', 0.6, { kind: 'cross' })], rel);
    expect(r.reasons[0]).toMatch(/2 separate sources report this directly/);
    expect(r.independent).toBe(3);
  });
});
