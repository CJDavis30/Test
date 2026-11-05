import { describe, it, expect } from 'vitest';
import { profileOf, ageText } from '../shared/profile';
import { keyFor } from '../shared/normalize';
import type { Finding, EntityType } from '../shared/types';

const NOW = Date.UTC(2025, 5, 15);
const ev = (url: string, facts: [string, string][] = [], adapterName = 'Roblox') => ({ id: 'e', adapter: 'roblox', adapterName, family: 'roblox', url, urlKind: 'record' as const, record: facts.length ? { title: 't', facts } : undefined, retrievedAt: 0, weight: 0.9 });
const F = (type: EntityType, value: string, url: string, facts: [string, string][] = [], attrs: Finding['attrs'] = {}) => ({ type, value, key: keyFor(type, value, attrs), attrs, evidence: [ev(url, facts)] }) as any;
const URL1 = 'https://www.roblox.com/users/1/profile';

describe('account preview', () => {
  const acct = F('account', URL1, URL1, [['Username', 'm_builds'], ['Display name', 'maralinden'], ['About', 'builder. mail me: mara@lindenmade.example'], ['Created', '2021-03-04 19:22:11 UTC'], ['Verified badge', 'No'], ['Friends', '1,234']], { platform: 'Roblox', createdAt: '2021-03-04T19:22:11.317Z' });
  it('gathers display name, handle, bio, creation date and age', () => {
    const p = profileOf(acct, [], [], NOW);
    expect(p).toMatchObject({ platform: 'Roblox', handle: 'm_builds', displayName: 'maralinden', bio: 'builder. mail me: mara@lindenmade.example', verified: false, rich: true });
    expect(p.created).toBe('2021-03-04T19:22:11.317Z'); expect(p.createdAgo).toBe('4 years, 3 months ago');
    expect(p.facts.map((x) => x[0])).toContain('Friends');
  });
  it('shows the email and phone found on this same page, and marks the ones you told Plexus about', () => {
    const sib = [F('email', 'mara@lindenmade.example', URL1), F('phone', '+14155552671', URL1), F('email', 'other@else.example', 'https://elsewhere.example/x'), F('image', 'https://tr.rbxcdn.com/abc.png', URL1)];
    const p = profileOf(acct, sib, [{ id: 'k', type: 'email', value: 'mara@lindenmade.example', key: 'mara@lindenmade.example' }], NOW);
    expect(p.contacts.map((c) => [c.value, c.known])).toEqual([['mara@lindenmade.example', true], ['+14155552671', false]]);
    expect(p.avatar).toMatch(/^https:\/\/tr\.rbxcdn\.com/);
  });
  it('finds an email that is only mentioned in the bio', () => {
    const p = profileOf(acct, [], [], NOW);
    expect(p.contacts).toEqual([{ type: 'email', value: 'mara@lindenmade.example', known: false, where: 'in the bio' }]);
  });
  it('handles different sites\' wording for the same thing', () => {
    const p = profileOf(F('account', 'https://x.example/u', 'https://x.example/u', [['Bio', 'hello'], ['Joined', '2019-06-01'], ['Followers', '4,100'], ['Location', 'Austin, TX'], ['Company', 'Northwind'], ['Website', 'https://mara.example']]), [], [], NOW);
    expect(p).toMatchObject({ bio: 'hello', followers: 4100, location: 'Austin, TX', org: 'Northwind' }); expect(p.createdAgo).toBe('6 years ago'); expect(p.links[0].url).toBe('https://mara.example');
  });
  it('is not "rich" when there is nothing but the bare value, and never invents anything', () => {
    const p = profileOf(F('location', 'Austin, TX', 'https://x.example/', []), [], [], NOW);
    expect(p.rich).toBe(false); expect(p.avatar).toBeUndefined(); expect(p.contacts).toEqual([]);
  });
  it('refuses unsafe picture addresses', () => {
    const p = profileOf(acct, [F('image', 'javascript:alert(1)', URL1)], [], NOW);
    expect(p.avatar).toBeUndefined();
  });
  it('ages read naturally and refuse the future', () => {
    expect(ageText('2025-06-14', NOW)).toBe('1 day ago'); expect(ageText('2025-06-15', NOW)).toBe('today'); expect(ageText('2025-03-01', NOW)).toBe('3 months ago');
    expect(ageText('2010-01-01', NOW)).toBe('15 years ago'); expect(ageText('2030-01-01', NOW)).toBe(''); expect(ageText('garbage', NOW)).toBe('');
  });
});
