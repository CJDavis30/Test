import { describe, it, expect } from 'vitest';
import { caseHealth } from '../shared/health';
import { staleness, warningsFor } from '../shared/explain';
import type { Finding } from '../shared/types';

const ev = (family: string, extra: any = {}) => ({ id: family, adapter: family, adapterName: family, family, retrievedAt: 0, weight: 0.8, ...extra });
const f = (id: string, fams: string[], extra: Partial<Finding> = {}): Finding => ({ id, caseId: 'c', subjectId: 's', type: 'username', value: id, key: id, relation: 'username', attrs: {}, score: 0.8, rank: 1, level: 3, reasons: [], status: 'accepted', createdAt: 0, evidence: fams.map((x) => ev(x)), ...extra } as Finding);

describe('case health', () => {
  it('is empty with nothing accepted, and reports what it measured', () => {
    expect(caseHealth([f('a', ['x'], { status: 'pending' })]).label).toBe('Empty');
    const h = caseHealth([f('a', ['x', 'y']), f('b', ['x', 'z'])]); expect(h.parts.map((p) => p.key)).toEqual(['corroboration', 'robustness', 'disputes', 'freshness', 'backlog']);
  });
  it('rewards corroboration and punishes single-source, disputed, stale and unreviewed work', () => {
    const good = caseHealth([f('a', ['x', 'y']), f('b', ['x', 'z']), f('c', ['y', 'z'])]);
    const weak = caseHealth([f('a', ['x'], { conflictsWith: ['q'] }), f('b', ['x']), f('c', ['y'], { status: 'accepted' }), f('p', ['x', 'y'], { status: 'pending', level: 4 })]);
    expect(good.score).toBeGreaterThan(weak.score); expect(good.label).toBe('Strong'); expect(['Thin', 'Mixed']).toContain(weak.label);
    expect(weak.parts.filter((p) => p.tip).length).toBeGreaterThan(good.parts.filter((p) => p.tip).length);
  });
  it('uses the stress test when it has one', () => {
    const fs = [f('a', ['x', 'y']), f('b', ['x', 'y'])];
    expect(caseHealth(fs, { a: { verdict: 'fragile' }, b: { verdict: 'single' } }).parts[1].value).toBe(0);
    expect(caseHealth(fs, { a: { verdict: 'solid' }, b: { verdict: 'sturdy' } }).parts[1].value).toBe(1);
  });
  it('scores stay in range', () => { for (const n of [1, 5, 50]) { const h = caseHealth(Array.from({ length: n }, (_, i) => f(String(i), i % 2 ? ['x'] : ['x', 'y']))); expect(h.score).toBeGreaterThanOrEqual(0); expect(h.score).toBeLessThanOrEqual(100); } });
});

describe('staleness', () => {
  const now = Date.UTC(2025, 5, 1);
  it('warns about old phones, places, jobs and emails, but not about old handles, and not about recent claims', () => {
    expect(staleness({ type: 'phone', when: '2019-04-01' }, now)).toMatch(/Last reported 2019/);
    expect(staleness({ type: 'location', when: '2016' }, now)).toMatch(/ddresses/i);
    expect(staleness({ type: 'username', when: '2012-01-01' }, now)).toBeNull();
    expect(staleness({ type: 'phone', when: '2025-01-01' }, now)).toBeNull(); expect(staleness({ type: 'phone' }, now)).toBeNull(); expect(staleness({ type: 'phone', when: 'garbage' }, now)).toBeNull();
  });
  it('shows up among the warnings on a finding', () => { expect(warningsFor({ relation: 'phone', level: 3, evidence: [{ family: 'a' }, { family: 'b' }], reasons: [], type: 'phone', when: '2018-01-01' }, now).some((w) => /Last reported 2018/.test(w))).toBe(true); });
});
