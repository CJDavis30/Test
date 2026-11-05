import { describe, it, expect } from 'vitest';
import { factsOf, matchAnchors, anchorOf, type Anchor } from '../shared/anchors';
import { keyFor } from '../shared/normalize';
import type { Finding, EntityType } from '../shared/types';

const A = (id: string, type: EntityType, value: string, attrs?: Record<string, unknown>): Anchor => ({ id, type, value, key: keyFor(type, value, attrs as any), attrs });
const F = (type: EntityType, value: string, attrs: Finding['attrs'] = {}, facts: [string, string][] = [], url = 'https://www.roblox.com/users/1/profile', snippet?: string): Pick<Finding, 'type' | 'value' | 'key' | 'attrs' | 'evidence'> =>
  ({ type, value, key: keyFor(type, value, attrs), attrs, evidence: [{ id: 'e', adapter: 'roblox', adapterName: 'Roblox', family: 'roblox', url, snippet, record: facts.length ? { title: 't', facts } : undefined, retrievedAt: 0, weight: 0.9 } as any] });
const sibling = (type: EntityType, value: string, url = 'https://www.roblox.com/users/1/profile') => F(type, value, {}, [], url);

describe('known facts matching', () => {
  const email = A('n1', 'email', 'mara@lindenmade.example'), user = A('n2', 'username', 'maralinden');

  it('the scenario: a Roblox account whose display name is the Discord username AND whose page lists the known email matches both', () => {
    const acct = F('account', 'https://www.roblox.com/users/1/profile', { platform: 'Roblox', handle: 'm_builds', displayName: 'maralinden' }, [['About', 'builder. mail me: mara@lindenmade.example']]);
    const hits = matchAnchors(factsOf(acct as any, [sibling('email', 'mara@lindenmade.example')] as any), [email, user]);
    const byA = Object.fromEntries(hits.map((h) => [h.anchorId, h]));
    expect(byA.n1.weight).toBeGreaterThanOrEqual(0.95);
    expect(byA.n1.how).toMatch(/lists mara@lindenmade\.example/);
    expect(byA.n2.hits[0].kind).toBe('display-name'); expect(byA.n2.weight).toBeGreaterThan(0.4);
    expect(byA.n2.how).toMatch(/display name is “maralinden”, the username you told Plexus about/);
  });
  it('an email only mentioned in a bio still matches, and says it was the bio', () => {
    const f = F('account', 'https://x.example/u/1', { platform: 'X' }, [['Bio', 'DM me or write to Mara@LindenMade.example please']]);
    const h = matchAnchors(factsOf(f as any), [email]);
    expect(h).toHaveLength(1); expect(h[0].how).toMatch(/bio shows/); expect(h[0].weight).toBeGreaterThanOrEqual(0.95);
  });
  it('an account that matches nothing known gets no evidence', () => {
    expect(matchAnchors(factsOf(F('account', 'https://x.example/u/9', { platform: 'X', handle: 'someone_else' }, [['Bio', 'hello']]) as any), [email, user])).toEqual([]);
  });
  it('rare handles count for more than common ones', () => {
    const rare = matchAnchors(factsOf(F('account', 'https://x.example/u/1', { platform: 'X', handle: 'zxqvmaralinden' }) as any), [A('r', 'username', 'zxqvmaralinden')])[0].weight;
    const common = matchAnchors(factsOf(F('account', 'https://x.example/u/2', { platform: 'X', handle: 'john' }) as any), [A('c', 'username', 'john')])[0].weight;
    expect(rare).toBeGreaterThan(common); expect(common).toBeLessThan(0.45); expect(rare).toBeLessThan(0.9);
  });
  it('an identical handle on another site is useful but never close to proof by itself', () => {
    const h = matchAnchors(factsOf(F('account', 'https://github.com/maralinden', { platform: 'GitHub', handle: 'maralinden' }) as any), [user])[0];
    expect(h.hits[0].kind).toBe('handle'); expect(h.weight).toBeGreaterThan(0.5); expect(h.weight).toBeLessThanOrEqual(0.85);
  });
  it('a look-alike handle (trailing underscore) matches weakly, so an impostor is not mistaken for the real account', () => {
    const exact = matchAnchors(factsOf(F('account', 'https://x.example/a', { platform: 'X', handle: 'maralinden' }) as any), [user])[0].weight;
    const lookalike = matchAnchors(factsOf(F('account', 'https://x.example/b', { platform: 'X', handle: 'maralinden_' }) as any), [user])[0].weight;
    expect(lookalike).toBeLessThan(exact); expect(lookalike).toBeGreaterThan(0.2);
  });
  it('phone numbers match across formats, from a sibling finding or from page text', () => {
    const phone = A('p', 'phone', '+1 415 555 2671');
    expect(matchAnchors(factsOf(F('account', 'https://x.example/1', { platform: 'X' }, [['About', 'call (415) 555-2671']]) as any), [phone])[0].how).toMatch(/shows \+1 415 555 2671/);
    expect(matchAnchors(factsOf(F('account', 'https://x.example/1', { platform: 'X' }) as any, [sibling('phone', '+14155552671', 'https://x.example/1')] as any), [phone])[0].weight).toBeGreaterThan(0.9);
    expect(matchAnchors(factsOf(F('account', 'https://x.example/1', { platform: 'X' }, [['About', '415 555 9999']]) as any), [phone])).toEqual([]);
  });
  it('two different matches against two different known facts both count, and a different name counts against', () => {
    const person = A('pp', 'person', 'Mara Linden');
    const same = matchAnchors(factsOf(F('person', 'Mara L. Linden', {}, []) as any), [person])[0];
    expect(same.against).toBe(false); expect(same.hits[0].kind).toBe('name');
    const other = matchAnchors(factsOf(F('person', 'Peter Hoffman', {}, []) as any), [person])[0];
    expect(other.against).toBe(true); expect(other.how).toMatch(/different name/);
    expect(matchAnchors(factsOf(F('person', 'Peter', {}, []) as any), [person])).toEqual([]);          // one word is not a name to compare
  });
  it('never matches a finding against itself', () => {
    expect(matchAnchors(factsOf(F('email', 'mara@lindenmade.example') as any), [email])).toEqual([]);
  });
  it('the same account you already told Plexus about is recognised at once', () => {
    const known = A('acct', 'account', 'https://github.com/maralinden', { platform: 'GitHub' });
    const found = F('account', 'https://github.com/maralinden/', { platform: 'GitHub', handle: 'maralinden' }, [], 'https://api.github.com/users/maralinden');
    const h = matchAnchors(factsOf({ ...found, key: 'different-key' } as any), [known])[0];
    expect(h.hits.some((x) => x.kind === 'same-account')).toBe(true); expect(h.weight).toBeGreaterThan(0.95);
  });
  it('domains: an email at the known company domain, or a link to it', () => {
    const dom = A('d', 'domain', 'lindenmade.example');
    expect(matchAnchors(factsOf(F('account', 'https://x.example/1', { platform: 'X' }) as any, [sibling('email', 'jo@lindenmade.example', 'https://x.example/1')] as any), [dom])[0].hits[0].kind).toBe('domain');
    expect(matchAnchors(factsOf(F('account', 'https://x.example/1', { platform: 'X' }, [['Website', 'https://www.lindenmade.example/about']], 'https://www.lindenmade.example/about') as any), [dom]).length).toBe(1);
  });
  it('builds an anchor from a graph node', () => {
    expect(anchorOf({ id: 'x', type: 'email', value: 'A@B.example', attrs: {} }).key).toBe('a@b.example');
  });
});
