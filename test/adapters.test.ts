import { describe, it, expect } from 'vitest';
import { keyFor } from '../shared/normalize';
import { makeCtx } from '../server/http';
import { RateLimitedError, type Adapter, type AdapterCtx } from '../server/adapters/types';
import * as net from '../server/adapters/live/network';
import * as idn from '../server/adapters/live/identity';
import * as misc from '../server/adapters/live/misc';
import { usernameSweep, SITES } from '../server/adapters/live/sweep';
import { liveAdapters } from '../server/adapters/live/index';
import type { EntityType } from '../shared/types';

type Route = [RegExp | string, { status?: number; body?: unknown; headers?: Record<string, string> }];

/** A ctx whose network is a lookup table, so adapters can be tested against recorded-style fixtures. */
function fake(routes: Route[], key?: string): AdapterCtx & { calls: string[] } {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  const ctx = makeCtx(new AbortController().signal, key);
  const respond = (url: string) => {
    calls.push(url);
    const hit = routes.find(([m]) => (typeof m === 'string' ? url.includes(m) : m.test(url)));
    if (!hit) return new Response('', { status: 404 });
    const { status = 200, body = {}, headers } = hit[1];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  };
  const f = async (url: string) => { const r = respond(url); if (r.status === 429) throw new RateLimitedError(); return r; };
  void realFetch;
  return Object.assign(ctx, {
    calls, fetch: f as any,
    json: async (u: string) => (await f(u)).json(), text: async (u: string) => (await f(u)).text(),
  });
}
const run = (a: Adapter, type: EntityType, value: string, ctx: AdapterCtx) => a.run({ type, value, key: keyFor(type, value) }, ctx);
const has = (cs: { type: string; value: string }[], type: string, value: string | RegExp) => cs.some((c) => c.type === type && (typeof value === 'string' ? c.value === value : value.test(c.value)));

describe('registry sanity', () => {
  it('every live adapter has an id, a self-test, and unique ids', () => {
    const ids = new Set<string>();
    for (const a of liveAdapters) {
      expect(a.id).toBeTruthy(); expect(ids.has(a.id)).toBe(false); ids.add(a.id);
      expect(a.accepts.length).toBeGreaterThan(0);
      expect(a.reliability).toBeGreaterThan(0); expect(a.reliability).toBeLessThanOrEqual(1);
      expect(a.selfTest.value).toBeTruthy();
    }
    expect(liveAdapters.length).toBeGreaterThanOrEqual(24);
  });
  it('every adapter tolerates an empty/garbage response without throwing', async () => {
    for (const a of liveAdapters.filter((x) => x.id !== 'username-sweep' && x.id !== 'phone-offline')) {
      for (const body of [{}, [], 'oops', null]) {
        const ctx = fake([[/.*/, { body: body as any }]]);
        const r = await run(a, a.accepts[0], a.selfTest.value, ctx).catch((e) => e);
        // Either clean claims or a clean Error — never a TypeError from unguarded property access.
        expect(r instanceof TypeError, `${a.id} with ${JSON.stringify(body)} → ${String(r)}`).toBe(false);
      }
    }
  });
});

describe('dns', () => {
  const a = (data: string, type: number) => ({ name: 'x', type, TTL: 1, data });
  it('extracts IPs, mail hosts, nameservers, SPF includes and inferred services', async () => {
    const ctx = fake([
      [/type=A$/, { body: { Answer: [a('93.184.216.34', 1)] } }],
      [/type=AAAA/, { body: { Answer: [] } }],
      [/type=MX/, { body: { Answer: [a('10 aspmx.l.google.com.', 15)] } }],
      [/type=NS/, { body: { Answer: [a('ns1.example-dns.net.', 2)] } }],
      [/type=TXT/, { body: { Answer: [a('"v=spf1 include:_spf.google.com include:sendgrid.net ~all"', 16), a('"google-site-verification=abc"', 16)] } }],
    ]);
    const c = await run(net.dnsCloudflare, 'domain', 'example.com', ctx);
    expect(has(c, 'ip', '93.184.216.34')).toBe(true);
    expect(has(c, 'domain', 'aspmx.l.google.com')).toBe(true);
    expect(has(c, 'domain', 'ns1.example-dns.net')).toBe(true);
    expect(has(c, 'domain', '_spf.google.com')).toBe(true);
    expect(has(c, 'org', 'Google Workspace')).toBe(true);
    expect(has(c, 'org', 'SendGrid')).toBe(true);
  });
  it('does reverse DNS for IPv4', async () => {
    const ctx = fake([[/4\.3\.2\.1\.in-addr\.arpa/, { body: { Answer: [a('host.example.net.', 12)] } }]]);
    expect(has(await run(net.dnsGoogle, 'ip', '1.2.3.4', ctx), 'domain', 'host.example.net')).toBe(true);
  });
});

describe('rdap', () => {
  it('reads registrar + dates, hides redacted registrants, keeps real ones', async () => {
    const vc = (fn: string, org?: string, email?: string) => ({ vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', fn], ...(org ? [['org', {}, 'text', org]] : []), ...(email ? [['email', {}, 'text', email]] : [])]] });
    const body = (reg: any) => ({ ldhName: 'EXAMPLE.COM', events: [{ eventAction: 'registration', eventDate: '2018-03-12T10:00:00Z' }, { eventAction: 'expiration', eventDate: '2027-03-12T10:00:00Z' }], nameservers: [{ ldhName: 'NS1.EXAMPLE.NET' }], entities: [{ roles: ['registrar'], ...vc('Example Registrar, Inc.') }, { roles: ['registrant'], ...reg }] });
    const red = await run(net.rdapDomain, 'domain', 'example.com', fake([['rdap.org/domain', { body: body(vc('REDACTED FOR PRIVACY')) }]]));
    expect(has(red, 'org', 'Example Registrar, Inc.')).toBe(true);
    expect(red.find((c) => c.relation === 'registrar')?.when).toBe('2018-03-12');
    expect(red.some((c) => c.relation === 'registrant')).toBe(false);
    expect(has(red, 'domain', 'ns1.example.net')).toBe(true);
    const real = await run(net.rdapDomain, 'domain', 'example.com', fake([['rdap.org/domain', { body: body(vc('Jane Roe', 'Roe Ventures LLC', 'jane@roe.example')) }]]));
    expect(has(real, 'org', 'Roe Ventures LLC')).toBe(true);
    expect(has(real, 'email', 'jane@roe.example')).toBe(true);
  });
  it('queries the registrable parent of a subdomain', async () => {
    const ctx = fake([['rdap.org/domain/example.com', { body: { events: [] } }]]);
    await run(net.rdapDomain, 'domain', 'a.b.example.com', ctx);
    expect(ctx.calls[0]).toContain('/domain/example.com');
  });
});

describe('certificate transparency', () => {
  it('splits multi-name certs, strips wildcards, dedupes and keeps earliest date', async () => {
    const rows = [
      { name_value: 'www.example.com\n*.example.com\nexample.com', not_before: '2020-05-01T00:00:00', common_name: 'example.com' },
      { name_value: 'api.example.com', not_before: '2021-02-01T00:00:00' },
      { name_value: 'api.example.com', not_before: '2019-11-11T00:00:00' },
      { name_value: 'evil.com', not_before: '2020-01-01T00:00:00' },
    ];
    const c = await run(net.crtsh, 'domain', 'example.com', fake([['crt.sh', { body: rows }]]));
    expect(c.map((x) => x.value).sort()).toEqual(['api.example.com', 'www.example.com']);
    expect(c.find((x) => x.value === 'api.example.com')?.when).toBe('2019-11-11');
  });
});

describe('wayback', () => {
  it('ranks short pages, skips assets, derives subdomains with first-seen dates', async () => {
    const rows = [['timestamp', 'original', 'statuscode'], ['20190822101010', 'https://example.com/about', '200'], ['20210409000000', 'https://blog.example.com/', '200'], ['20200101000000', 'https://example.com/logo.png', '200'], ['20200101000000', 'https://example.com/team?x=1', '200']];
    const c = await run(net.wayback, 'domain', 'example.com', fake([['web.archive.org/cdx', { body: rows }]]));
    expect(has(c, 'domain', 'blog.example.com')).toBe(true);
    expect(has(c, 'url', 'https://example.com/about')).toBe(true);
    expect(c.some((x) => /logo\.png/.test(x.value))).toBe(false);
    expect(c.find((x) => x.value === 'https://example.com/about')?.when).toBe('2019-08-22');
  });
});

describe('gravatar', () => {
  it('turns a profile into name, handle, photo, verified accounts, location and bio contacts', async () => {
    const body = { entry: [{ profileUrl: 'https://gravatar.com/jroe', preferredUsername: 'jroe', displayName: 'Jane Roe', name: { formatted: 'Jane Roe' }, thumbnailUrl: 'https://gravatar.com/avatar/x', currentLocation: 'Denver, CO', aboutMe: 'Say hi: jane@roe.example', accounts: [{ url: 'https://github.com/jroe', shortname: 'github', verified: true }], urls: [{ value: 'https://roe.example', title: 'Site' }] }] };
    const c = await run(idn.gravatar, 'email', 'jane@roe.example', fake([['gravatar.com/', { body }]]));
    expect(has(c, 'person', 'Jane Roe')).toBe(true);
    expect(has(c, 'username', 'jroe')).toBe(true);
    expect(has(c, 'image', /gravatar/)).toBe(true);
    expect(c.find((x) => x.type === 'account' && /github/.test(x.value))?.weight).toBeGreaterThanOrEqual(0.9);
    expect(has(c, 'location', 'Denver, CO')).toBe(true);
    expect(has(c, 'email', 'jane@roe.example')).toBe(true);
    expect(await run(idn.gravatar, 'email', 'nobody@x.example', fake([]))).toEqual([]);
  });
});

describe('github', () => {
  it('maps a username profile', async () => {
    const p = { login: 'jroe', id: 7, html_url: 'https://github.com/jroe', name: 'Jane Roe', company: '@Roe-Ventures', location: 'Denver', email: 'jane@roe.example', blog: 'roe.example', twitter_username: 'jroe', bio: 'DM or jane@roe.example', public_repos: 12, followers: 3, created_at: '2014-05-19T00:00:00Z', avatar_url: 'https://avatars/x' };
    const c = await run(idn.github, 'username', 'jroe', fake([['/users/jroe', { body: p }]]));
    expect(has(c, 'org', 'Roe-Ventures')).toBe(true);
    expect(has(c, 'url', 'https://roe.example')).toBe(true);
    expect(c.find((x) => x.type === 'account' && x.attrs?.platform === 'GitHub')?.when).toBe('2014-05-19');
  });
  it('finds accounts and commit identities for an email', async () => {
    const ctx = fake([
      [/search\/users/, { body: { items: [{ login: 'jroe', html_url: 'https://github.com/jroe' }] } }],
      [/search\/commits/, { body: { items: [{ author: { login: 'jroe' }, commit: { author: { name: 'Jane Roe' } } }, { author: { login: 'jroe' }, commit: { author: { name: 'Jane Roe' } } }] } }],
    ]);
    const c = await run(idn.github, 'email', 'jane@roe.example', ctx);
    expect(has(c, 'person', 'Jane Roe')).toBe(true);
    expect(c.filter((x) => x.type === 'username' && x.value === 'jroe').length).toBeGreaterThanOrEqual(1);
  });
  it('treats an exhausted rate limit as RateLimited, not an error', async () => {
    const ctx = fake([['/users/', { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: 'API rate limit exceeded' } }]]);
    // fake() bypasses http.ts status handling, so exercise getJson's own 403 logic through the shim
    await expect(run(idn.github, 'username', 'jroe', ctx)).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe('breaches', () => {
  it('HIBP maps names, classes and dates', async () => {
    const body = [{ Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', PwnCount: 152445165, DataClasses: ['Email addresses', 'Password hints'] }];
    const c = await run(idn.hibp, 'email', 'a@b.example', fake([['breachedaccount', { body }]], 'k'));
    expect(c[0]).toMatchObject({ type: 'breach', value: 'Adobe', when: '2013-10-04' });
    expect(c[0].attrs?.classes).toContain('Password hints');
  });
  it('XposedOrNot handles hits and 404-as-clean', async () => {
    expect(has(await run(idn.xposedornot, 'email', 'a@b.example', fake([['check-email', { body: { breaches: [['Adobe', 'LinkedIn']] } }]])), 'breach', 'LinkedIn')).toBe(true);
    expect(await run(idn.xposedornot, 'email', 'a@b.example', fake([['check-email', { status: 404, body: { Error: 'Not found' } }]]))).toEqual([]);
  });
});

describe('keybase', () => {
  it('only trusts proofs whose state is verified', async () => {
    const them = [{ basics: { username: 'jroe' }, profile: { full_name: 'Jane Roe' }, proofs_summary: { all: [{ proof_type: 'twitter', nametag: 'jroe', service_url: 'https://x.com/jroe', state: 1 }, { proof_type: 'reddit', nametag: 'jroe', service_url: 'https://reddit.com/u/jroe', state: 3 }] } }];
    const c = await run(idn.keybase, 'username', 'jroe', fake([['keybase.io', { body: { status: { code: 0 }, them } }]]));
    expect(has(c, 'account', 'https://x.com/jroe')).toBe(true);
    expect(has(c, 'account', 'https://reddit.com/u/jroe')).toBe(false);
  });
});

describe('username sweep', () => {
  it('ignores sites that say "exists" for everything, reports real hits only', async () => {
    const dribbble = SITES.find((s) => s.name === 'Dribbble')!.url.split('{u}')[0];
    const behance = SITES.find((s) => s.name === 'Behance')!.url.split('{u}')[0];
    const ctx = fake([
      [`${dribbble}plx-ctrl`, { status: 404 }], [`${dribbble}jroe`, { status: 200, body: 'ok' }],   // trustworthy site with a real hit
      [`${behance}`, { status: 200, body: 'always 200' }],                                            // lies for the control → must be skipped
    ]);
    const c = await run(usernameSweep, 'username', 'jroe', ctx);
    expect(c.some((x) => x.attrs?.platform === 'Dribbble')).toBe(true);
    expect(c.some((x) => x.attrs?.platform === 'Behance')).toBe(false);
    expect(c.every((x) => x.weight <= 0.35)).toBe(true);
  });
  it('rejects unsafe usernames without making requests', async () => {
    const ctx = fake([]);
    expect(await run(usernameSweep, 'username', 'a b/../x', ctx)).toEqual([]);
    expect(ctx.calls.length).toBe(0);
  });
});

describe('offline & chain adapters', () => {
  it('phone: country and line type, no network', async () => {
    const c = await run(misc.phone, 'phone', '+14155552671', fake([]));
    expect(c[0]?.value).toBe('United States');
  });
  it('btc: balance plus co-spent addresses (needs ≥2 inputs including the subject)', async () => {
    const addr = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const txs = [{ txid: 'a'.repeat(64), status: { block_time: 1600000000 }, vin: [{ prevout: { scriptpubkey_address: addr } }, { prevout: { scriptpubkey_address: 'bc1qother00000000000000000000000000000000x' } }] }, { txid: 'b'.repeat(64), vin: [{ prevout: { scriptpubkey_address: addr } }] }];
    const c = await run(misc.blockstream, 'wallet', addr, fake([[/\/txs$/, { body: txs }], [/address\/bc1/, { body: { chain_stats: { tx_count: 2, funded_txo_sum: 100000000, spent_txo_sum: 40000000 } } }]]));
    expect(c[0].snippet).toContain('balance 0.6 BTC');
    expect(has(c, 'wallet', /bc1qother/)).toBe(true);
    expect(c.filter((x) => x.type === 'wallet').length).toBe(1);
  });
  it('gleif ignores unrelated names', async () => {
    const rec = (n: string) => ({ data: [{ id: 'LEI1', attributes: { entity: { legalName: { name: n }, status: 'ACTIVE', jurisdiction: 'US-DE', legalAddress: { city: 'Austin', region: 'US-TX', country: 'US' } } } }] });
    expect(has(await run(misc.gleif, 'org', 'Northwind Labs Inc', fake([['gleif', { body: rec('Northwind Labs Inc') }]])), 'location', /Austin/)).toBe(true);
    expect(await run(misc.gleif, 'org', 'Northwind Labs Inc', fake([['gleif', { body: rec('Zzyzx Holdings') }]]))).toEqual([]);
  });
  it('wikidata only surfaces near-exact matches, weakly', async () => {
    const body = { search: [{ id: 'Q1', label: 'Jane Roe', description: 'American lawyer' }, { id: 'Q2', label: 'Janet Roe', description: 'singer' }] };
    const c = await run(misc.wikidata, 'person', 'Jane Roe', fake([['wikidata', { body }]]));
    expect(c.length).toBe(1);
    expect(c[0].weight).toBeLessThanOrEqual(0.2);
  });
});

describe('error honesty', () => {
  it('dns: a total network failure is an error, never "no records"', async () => {
    const ctx = fake([]);
    (ctx as any).fetch = async () => { throw new TypeError('fetch failed'); };
    await expect(run(net.dnsCloudflare, 'domain', 'example.com', ctx)).rejects.toThrow(/fetch failed/);
  });
  it('dns: partial failures still return what worked', async () => {
    const ctx = fake([[/type=A$/, { body: { Answer: [{ name: 'x', type: 1, TTL: 1, data: '1.2.3.4' }] } }]]);
    const orig = ctx.fetch;
    (ctx as any).fetch = async (u: string) => { if (/type=MX|type=TXT/.test(u)) throw new Error('boom'); return orig(u); };
    const c = await run(net.dnsCloudflare, 'domain', 'example.com', ctx);
    expect(has(c, 'ip', '1.2.3.4')).toBe(true);
  });
});
