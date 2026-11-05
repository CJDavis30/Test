import { describe, it, expect } from 'vitest';
import { pivotsFor, pivotCount } from '../shared/pivots';
import { ENTITY_TYPES } from '../shared/types';

const SAMPLE: Record<string, string> = { person: 'Mara Linden', email: 'mara.linden@northwind.example', phone: '+14155552671', username: '@maralinden', domain: 'northwind.example', url: 'https://northwind.example/about?x=1', ip: '203.0.113.9', org: 'Northwind Labs', location: '48.8584, 2.2945', account: 'https://github.com/maralinden', image: 'https://img.example/a.jpg', wallet: '0x1234567890123456789012345678901234567890', breach: 'Collection1' };

describe('check elsewhere', () => {
  it('offers links for every kind of thing, all https or deliberate app links, none empty', () => {
    for (const t of ENTITY_TYPES) {
      const g = pivotsFor(t, SAMPLE[t] ?? 'x');
      expect(g.length, t).toBeGreaterThan(0);
      for (const grp of g) for (const l of grp.links) { expect(l.label.length).toBeGreaterThan(1); expect(l.url, `${t}: ${l.label}`).toMatch(/^(https:\/\/|viber:\/\/)/); expect(() => new URL(l.url)).not.toThrow(); }
    }
  });
  it('is a large library: hundreds of places across the kinds of things', () => {
    const total = Object.entries(SAMPLE).reduce((n, [t, v]) => n + pivotCount(pivotsFor(t as any, v)), 0);
    expect(total).toBeGreaterThanOrEqual(200);
  });
  it('puts the value in each link, correctly encoded, and never lets it break out of the URL', () => {
    for (const grp of pivotsFor('username', 'a b&c=d#e/../x')) for (const l of grp.links.filter((x) => x.url.includes('a%20b'))) { const u = new URL(l.url); expect(u.hash === '' || /^#\//.test(u.hash) || l.url.includes('%23')).toBe(true); }
    const g = pivotsFor('person', 'Jane "The Boss" O\'Neil');
    expect(g[0].links[0].url).toContain('%22Jane%20The%20Boss%20O\'Neil%22');
  });
  it('builds exact, useful links for the cases people actually use', () => {
    const find = (t: any, v: string, label: RegExp) => pivotsFor(t, v).flatMap((g) => g.links).find((l) => label.test(l.label))!;
    expect(find('phone', '+14155552671', /^WhatsApp/).url).toBe('https://wa.me/14155552671');
    expect(find('phone', '+14155552671', /^Telegram/).url).toBe('https://t.me/+14155552671');
    expect(find('email', 'Test@Example.com', /^Gravatar/).url).toMatch(/^https:\/\/gravatar\.com\/[0-9a-f]{32}$/);
    expect(find('email', ' MyEmailAddress@example.com ', /^Gravatar/).url).toBe('https://gravatar.com/0bc83cb571cd1c50ba6f3e8a78ef1346');   // Gravatar's own documented example
    expect(find('username', '@mara', /^Instagram/).url).toBe('https://www.instagram.com/mara/');
    expect(find('username', 'mara', /^WhatsMyName/).url).toBe('https://whatsmyname.app/?q=mara');
    expect(find('location', '48.8584, 2.2945', /Street View/).url).toContain('48.858400');
    expect(find('image', 'https://img.example/a.jpg', /TinEye/).url).toBe('https://tineye.com/search?url=https%3A%2F%2Fimg.example%2Fa.jpg');
    expect(find('wallet', '0x1234567890123456789012345678901234567890', /Etherscan/)).toBeTruthy();
    expect(pivotsFor('wallet', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').flatMap((g) => g.links).some((l) => /Etherscan/.test(l.label))).toBe(false);
  });
  it('leaves people-search data brokers out on purpose', () => {
    const all = Object.entries(SAMPLE).flatMap(([t, v]) => pivotsFor(t as any, v).flatMap((g) => g.links.map((l) => l.url)));
    for (const bad of ['spokeo', 'whitepages', 'fastpeoplesearch', 'truepeoplesearch', 'beenverified', 'radaris', 'intelius', 'peoplefinders']) expect(all.some((u) => u.includes(bad)), bad).toBe(false);
  });
  it('returns nothing for empty input', () => { expect(pivotsFor('person', '   ')).toEqual([]); });
});
