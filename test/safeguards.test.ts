import { describe, it, expect } from 'vitest';
import { youthSignals, isRealWorld } from '../shared/safeguards';

describe('youth signals', () => {
  it('notices what people say about their own age and school', () => {
    for (const t of ["hi im 13 and i love building", "I'm 15", "age: 14", "14yo gamer", "16 y/o dev", "12 years old", "13 year old", "in 8th grade", "grade 9 student", "going into middle school", "high school freshman", "born 2011", "bday 2010-04-05"]) expect(youthSignals(t, new Date('2025-06-01')).length, t).toBeGreaterThan(0);
  });
  it('does not fire on adults, numbers that are not ages, or ordinary words', () => {
    for (const t of ["I'm 25", "age 35", "14.2k followers", "12+ years in security", "13 reasons why", "grade A steak", "I am 10 minutes away", "im 18", "18 y/o", "born 1989", "we have 15 members", "level 14", "session 12 of 20", "ver 1.7", "I'm 3 years in", "2 years old company"]) expect(youthSignals(t, new Date('2025-06-01')), t).toEqual([]);
  });
  it('says what it saw, so a human can judge it', () => {
    expect(youthSignals('im 13')[0]).toBe('says they are 13'); expect(youthSignals('born 2012', new Date('2025-01-01'))[0]).toMatch(/2012/);
  });
  it('survives hostile input', () => { expect(() => youthSignals('x'.repeat(500_000))).not.toThrow(); expect(youthSignals('')).toEqual([]); });
  it('knows which findings point toward a real-world identity', () => {
    for (const t of ['person', 'phone', 'email', 'location']) expect(isRealWorld(t)).toBe(true);
    for (const t of ['username', 'account', 'domain', 'image', 'org']) expect(isRealWorld(t)).toBe(false);
  });
});
