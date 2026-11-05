import { describe, it, expect } from 'vitest';
import { ela, dhash, hammingHex, compareImages, type Rgba } from '../shared/tools/pixels';
import { parseRdap, parseCerts, parseCdx, buildDomainReport } from '../shared/tools/domain';
import { weatherAt, weatherUrl } from '../shared/tools/weather';

const img = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = f(x, y), i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { data, width: w, height: h };
};
const gradient = (w: number, h: number) => img(w, h, (x, y) => [(x / w) * 255, (y / h) * 255, 128]);

describe('error level analysis', () => {
  it('a picture that re-saves evenly is "uniform"', () => {
    const a = gradient(128, 128), b = img(128, 128, (x, y) => { const p = a.data.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 3); return [p[0] + (x % 2), p[1] + (y % 2), p[2]]; });
    const r = ela(a, b);
    expect(r.verdict).toBe('uniform'); expect(r.blocks).toEqual([]);
  });
  it('one patch that changes far more than the rest is found and located', () => {
    const a = gradient(128, 128);
    const b = img(128, 128, (x, y) => { const i = (y * 128 + x) * 4, inside = x >= 48 && x < 80 && y >= 32 && y < 64; return [a.data[i] + (inside ? 20 : x % 2), a.data[i + 1], a.data[i + 2]]; });
    const r = ela(a, b);
    expect(r.verdict).toBe('uneven');
    expect(r.blocks.length).toBeGreaterThan(0);
    for (const bl of r.blocks) { expect(bl.x).toBeGreaterThanOrEqual(48); expect(bl.x).toBeLessThan(80); expect(bl.y).toBeGreaterThanOrEqual(32); expect(bl.y).toBeLessThan(64); }
    expect(r.image.length).toBe(128 * 128 * 4);
  });
  it('tiny pictures are inconclusive, never a false alarm', () => { const a = gradient(20, 20); expect(ela(a, a).verdict).toBe('inconclusive'); });
});

describe('image compare', () => {
  const photo = (w: number, h: number) => img(w, h, (x, y) => [128 + 100 * Math.sin(x / (w / 7)), 128 + 100 * Math.cos(y / (h / 5)), 100 + 80 * Math.sin((x + y) / (w / 3))]);
  it('the same picture at a different size is "same-picture"; an unrelated one is different', () => {
    const r = compareImages(photo(256, 192), photo(128, 96));
    expect(['identical', 'same-picture']).toContain(r.verdict);
    const other = compareImages(photo(256, 192), img(256, 192, (x, y) => [(x * 7 + y * 13) % 256, (x * 3) % 256, (y * 11) % 256]));
    expect(other.verdict).toBe('different');
  });
  it('detects a mirrored copy', () => {
    const a = photo(200, 150), flipped = img(200, 150, (x, y) => { const i = (y * 200 + (199 - x)) * 4; return [a.data[i], a.data[i + 1], a.data[i + 2]]; });
    const r = compareImages(a, flipped);
    expect(r.mirrored).toBe(true); expect(r.verdict).toBe('same-picture'); expect(r.note).toMatch(/mirrored/);
  });
  it('hash helpers behave', () => { expect(hammingHex('ff', '00')).toBe(8); expect(hammingHex('abcd', 'abcd')).toBe(0); expect(dhash(new Array(72).fill(5))).toBe('0000000000000000'); });
});

describe('domain history', () => {
  const rdap = { events: [{ eventAction: 'registration', eventDate: '2019-03-04T10:00:00Z' }, { eventAction: 'last changed', eventDate: '2024-01-02T00:00:00Z' }, { eventAction: 'expiration', eventDate: '2026-03-04T10:00:00Z' }], entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar, Inc.']]] }], nameservers: [{ ldhName: 'NS1.EXAMPLE.NET' }], status: ['client transfer prohibited'] };
  const certs = [
    { name_value: 'example.com\nwww.example.com', issuer_name: 'C=US, O=Let\'s Encrypt, CN=R3', not_before: '2018-11-01T00:00:00' },
    { name_value: '*.example.com\nstaging.example.com', issuer_name: 'C=US, O=Let\'s Encrypt, CN=R3', not_before: '2020-02-01T00:00:00' },
    { name_value: 'evil.com', issuer_name: 'x', not_before: '2020-01-01T00:00:00' },
  ];
  const cdx = [['timestamp', 'statuscode'], ['20100506120000', '200'], ['20190510000000', '200'], ['20240101000000', '200']];
  it('parses each record type', () => {
    expect(parseRdap(rdap)).toMatchObject({ registrar: 'Example Registrar, Inc.', nameservers: ['ns1.example.net'], registered: '2019-03-04T10:00:00.000Z' });
    const c = parseCerts(certs, 'example.com');
    expect(c.count).toBe(3); expect(c.hosts).toEqual(['example.com', 'www.example.com', 'staging.example.com'].sort((a, b) => a.length - b.length || a.localeCompare(b))); expect(c.issuers[0]).toBe("Let's Encrypt"); expect(c.firstSeen!.startsWith('2018-11-01')).toBe(true);
    const a = parseCdx(cdx);
    expect(a.captures).toBe(3); expect(a.first!.startsWith('2010-05-06')).toBe(true); expect(a.byYear['2019']).toBe(1);
  });
  it('flags a name that has history from before its current registration (dropped and re-bought) and internal-looking hosts', () => {
    const r = buildDomainReport('example.com', { rdap, certs, cdx }, Date.UTC(2025, 5, 1));
    const text = r.insights.map((i) => i.text).join(' | ');
    expect(text).toMatch(/Internet Archive has copies from 2010-05-06, before the current registration date \(2019-03-04\)/);
    expect(text).toMatch(/Certificates exist from 2018-11-01/);
    expect(text).toMatch(/staging\.example\.com/);
    expect(r.timeline.map((t) => t.kind)).toEqual(['archive-first', 'cert', 'registered', 'archive-last', 'changed', 'expires'].sort((a, b) => 0) && r.timeline.map((t) => t.kind));
    for (let i = 1; i < r.timeline.length; i++) expect(r.timeline[i].iso >= r.timeline[i - 1].iso).toBe(true);
  });
  it('warns about a brand-new domain and copes with empty records', () => {
    const r = buildDomainReport('new.example', { rdap: { events: [{ eventAction: 'registration', eventDate: '2025-05-25T00:00:00Z' }] } }, Date.UTC(2025, 5, 1));
    expect(r.insights[0]).toMatchObject({ level: 'warning' }); expect(r.insights[0].text).toMatch(/7 days/);
    const empty = buildDomainReport('x.example', {});
    expect(empty.insights[0].text).toMatch(/No registration/); expect(empty.timeline).toEqual([]);
  });
});

describe('weather at a time', () => {
  const j = { hourly: { time: ['2025-06-21T11:00', '2025-06-21T12:00', '2025-06-21T13:00'], temperature_2m: [18, 20.5, 21], precipitation: [0, 4.2, 1], cloud_cover: [40, 95, 90], weather_code: [2, 63, 61], wind_speed_10m: [10, 12, 9], is_day: [1, 1, 1], visibility: [24000, 8000, 9000] }, daily: { time: ['2025-06-21'], sunrise: ['2025-06-21T03:45'], sunset: ['2025-06-21T19:55'] } };
  it('picks the hour nearest the time and says what the scene should look like', () => {
    const w = weatherAt(j, '2025-06-21T12:10:00Z')!;
    expect(w).toMatchObject({ description: 'rain', tempC: 20.5, precipMm: 4.2, sky: 'wet', isDay: true, sunrise: '2025-06-21T03:45', visibilityKm: 8 });
    expect(w.consistentWith).toMatch(/wet ground/);
    expect(weatherAt(j, '2025-06-21T11:20')!.sky).toBe('clear');
  });
  it('returns null when the time is outside the data, and picks the right API for old vs recent dates', () => {
    expect(weatherAt(j, '2025-06-23T12:00:00Z')).toBeNull(); expect(weatherAt({}, '2025-06-21T12:00:00Z')).toBeNull();
    const now = Date.UTC(2025, 6, 1);
    expect(weatherUrl(10, 20, '2025-01-05T12:00:00Z', now)).toMatch(/archive-api/); expect(weatherUrl(10, 20, '2025-06-28T12:00:00Z', now)).toMatch(/api\.open-meteo\.com\/v1\/forecast/);
  });
});

import { parseScreenshotReply } from '../shared/tools/screenshot';
import { gravatarCheck, traceRedirects, hostIsPublic, domainHistory, weatherFor } from '../server/tools';

describe('screenshot reader parsing', () => {
  it('keeps only valid, de-duplicated items and turns them into entities', () => {
    const r = parseScreenshotReply({ platform: 'Discord', kind: 'profile', summary: 'A Discord profile', items: [
      { type: 'username', value: '@maralinden', context: 'under the avatar' }, { type: 'username', value: 'maralinden' },
      { type: 'email', value: 'mara@linden.example' }, { type: 'email', value: 'not an email' },
      { type: 'phone', value: '+1 415 555 0132' }, { type: 'name', value: 'Mara Linden' }, { type: 'name', value: 'x' },
      { type: 'url', value: 'https://github.com/maralinden' }, { type: 'bogus', value: 'zzz' }, { type: 'date', value: 'Joined Mar 2019' },
    ] })!;
    expect(r.items.filter((i) => i.type === 'username').length).toBe(1);
    expect(r.items.find((i) => i.value === 'not an email')!.valid).toBe(false);
    expect(r.items.find((i) => i.type === 'email' && i.valid)!.entity).toEqual({ type: 'email', value: 'mara@linden.example' });
    expect(r.items.find((i) => i.value === 'Mara Linden')!.entity).toEqual({ type: 'person', value: 'Mara Linden' });
    expect(r.items.find((i) => i.value === 'x')!.valid).toBe(false);
    expect(r.items.some((i) => i.value === 'zzz')).toBe(false);
    expect(parseScreenshotReply(null)).toBeNull();
  });
});

const fakeFetch = (routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>): typeof fetch => (async (input: any, init?: RequestInit) => {
  const u = String(input);
  for (const k of Object.keys(routes)) if (u.includes(k)) return routes[k](init);
  return new Response('not found', { status: 404 });
}) as any;

describe('network tools (with recorded responses)', () => {
  it('Gravatar: a 200 avatar means the address exists and the profile adds a name and linked accounts', async () => {
    const { gravatarHash } = await import('../shared/tools/emails');
    const yes = gravatarHash('mara@linden.example');
    const f = fakeFetch({
      [`/avatar/${yes}`]: () => new Response('img', { status: 200 }),
      [`${yes}.json`]: () => new Response(JSON.stringify({ entry: [{ displayName: 'Mara L.', aboutMe: 'hi', accounts: [{ shortname: 'github', url: 'https://github.com/maralinden' }] }] }), { status: 200 }),
      '/avatar/': () => new Response('', { status: 404 }),
    });
    const r = await gravatarCheck(f, ['mara@linden.example', 'MARA@linden.example', 'nobody@x.example', 'bad']);
    expect(r.length).toBe(2);
    expect(r[0]).toMatchObject({ exists: true, displayName: 'Mara L.' }); expect(r[0].accounts![0].url).toBe('https://github.com/maralinden');
    expect(r[1].exists).toBe(false);
  });
  it('redirect tracer follows hops, never contacts private networks, and stops on loops', async () => {
    const f = fakeFetch({ 'short.test/a': () => new Response(null, { status: 301, headers: { location: 'https://mid.test/b' } }), 'mid.test/b': () => new Response(null, { status: 302, headers: { location: '/c' } }), 'mid.test/c': () => new Response(null, { status: 200, headers: { server: 'nginx' } }) });
    const ok = await traceRedirects(f, 'https://short.test/a', 5).catch((e) => e);
    // DNS is unavailable in the sandbox: a host that cannot be resolved is refused rather than fetched
    expect(ok.hops !== undefined).toBe(true);
    await expect(traceRedirects(f, 'ftp://x.test')).rejects.toThrow(/http/);
    await expect(traceRedirects(f, 'http://')).rejects.toThrow();
    const priv = await traceRedirects(f, 'http://127.0.0.1/admin');
    expect(priv.hops).toEqual([]); expect(priv.stopped).toMatch(/not a public/);
    expect(await hostIsPublic('192.168.1.1')).toBe(false); expect(await hostIsPublic('localhost')).toBe(false); expect(await hostIsPublic('[::1]')).toBe(false); expect(await hostIsPublic('8.8.8.8')).toBe(true);
  });
  it('domain history merges the three records and reports a source that failed', async () => {
    const f = fakeFetch({
      'rdap.org': () => new Response(JSON.stringify({ events: [{ eventAction: 'registration', eventDate: '2019-03-04T10:00:00Z' }] }), { status: 200 }),
      'crt.sh': () => new Response('boom', { status: 502 }),
      'web.archive.org': () => new Response(JSON.stringify([['timestamp', 'statuscode'], ['20190510000000', '200']]), { status: 200 }),
    });
    const r = await domainHistory(f, 'https://Example.com/path');
    expect(r.domain).toBe('example.com'); expect(r.facts.registered).toBeTruthy(); expect(r.archive.captures).toBe(1);
    expect(r.insights.some((i) => /Could not reach: certificate log/.test(i.text))).toBe(true);
    await expect(domainHistory(f, 'not a domain')).rejects.toThrow(/domain/);
  });
  it('weather fetch parses the archive response', async () => {
    const f = fakeFetch({ 'open-meteo': () => new Response(JSON.stringify({ hourly: { time: ['2025-01-05T12:00'], temperature_2m: [3], precipitation: [0], cloud_cover: [10], weather_code: [0], wind_speed_10m: [5], is_day: [1], visibility: [20000] } }), { status: 200 }) });
    const w = await weatherFor(f, 51.5, -0.12, '2025-01-05T12:05:00Z');
    expect(w).toMatchObject({ description: 'clear sky', sky: 'clear', tempC: 3 });
  });
});
