import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-lf-'));
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { register, allAdapters } = await import('../server/registry');
const { adapter, bioClaims } = await import('../server/adapters/live/util');
import type { RunEvent, Finding, GraphNode } from '../shared/types';

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>, caseId: string;
const call = async (m: string, p: string, b?: unknown) => { const r = await ctx.app.request(p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => ({})) as any }; };
const done = (runId: string) => new Promise<void>((resolve) => { let off: () => void = () => {}; off = ctx.hub.subscribe(runId, (e: RunEvent) => { if (e.t === 'run.done') { off(); resolve(); } }); });
const lookup = async (value: string, role?: unknown) => { const r = (await call('POST', `/api/cases/${caseId}/lookups`, { type: 'username', value, role })).json; await done(r.run.id); return r.node as GraphNode; };
const findings = async (): Promise<Finding[]> => (await call('GET', `/api/cases/${caseId}/findings`)).json.findings;

const RBX = 'https://www.roblox.com/users/777/profile';
const BIO = 'builder | ig: foo_bar | https://www.twitch.tv/streamer1 | https://x.com/lookalike_acct';
const roblox = adapter({
  id: 'fake-roblox', name: 'Roblox (fake)', description: '', accepts: ['username'], capability: 'gaming-profile', family: 'roblox', reliability: 0.92, selfTest: { type: 'username', value: 'x' },
  async run(e) {
    if (e.value !== 'ravenfox_77') return [];
    return [{ type: 'account', value: RBX, relation: 'Roblox profile', weight: 0.92, url: RBX, attrs: { platform: 'Roblox', handle: e.value } }, ...bioClaims(BIO, 'Roblox', RBX)];
  },
});
// reads a page: the Twitch page says "roblox: ravenfox_77" (a link back); the X page says nothing about it
const pages = adapter({
  id: 'fake-page', name: 'Page reader (fake)', description: '', accepts: ['account'], capability: 'profile-page', family: 'page', reliability: 0.6, selfTest: { type: 'account', value: 'https://x.test/' },
  async run(e) {
    if (/twitch\.tv\/streamer1/.test(e.value)) return [{ type: 'username', value: 'ravenfox_77', relation: 'roblox handle on this page', weight: 0.6, url: e.value, basis: 'self-reported', snippet: 'Bio: roblox: ravenfox_77', attrs: { handlePlatform: 'roblox', handleKind: 'username' } }];
    return [];
  },
});

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'lf.db')));
  for (const a of allAdapters()) ctx.store.setSourceEnabled(a.id, false);
  register(roblox, pages); ctx.store.setSourceEnabled('fake-roblox', true); ctx.store.setSourceEnabled('fake-page', true);
  ctx.store.setSetting('crossCheck', true);
  caseId = (await call('POST', '/api/cases', { name: 'LF', purpose: 'test' })).json.case.id;
}, 30_000);

describe('following what a profile says about itself', () => {
  let fs: Finding[];
  beforeAll(async () => { await lookup('ravenfox_77', { platform: 'roblox', kind: 'username', trust: 'certain', origin: 'their-profile' }); fs = await findings(); }, 30_000);
  const get = (type: string, v: string) => fs.find((f) => f.type === type && f.value.toLowerCase().includes(v))!;

  it('a handle named in the bio becomes a handle with its platform filled in, a low trust, and the bio quoted', () => {
    const ig = get('username', 'foo_bar');
    expect(ig).toBeTruthy();
    expect(ig.attrs).toMatchObject({ handlePlatform: 'instagram', handleKind: 'username', handleTrust: 'unsure', handleOrigin: 'bio' });
    expect(ig.evidence[0]).toMatchObject({ basis: 'self-reported' }); expect(ig.evidence[0].snippet).toMatch(/ig: foo_bar/);
    expect(ig.score).toBeLessThanOrEqual(0.72); expect(ig.nameOnly).toBeUndefined();
  });
  it('a link in the bio is an account to read, self-reported', () => {
    const tw = get('account', 'twitch.tv/streamer1');
    expect(tw.evidence[0].basis).toBe('self-reported'); expect(tw.attrs).toMatchObject({ platform: 'Twitch', handle: 'streamer1' });
  });
  it('the linked page was read, and one that names the Roblox username back is confirmed from both sides', () => {
    const tw = get('account', 'twitch.tv/streamer1'), x = get('account', 'x.com/lookalike_acct');
    const back = tw.evidence.find((e) => e.adapter === 'fake-page')!;
    expect(back).toBeTruthy(); expect(back.basis).toBe('reciprocal'); expect(back.verdict).toMatch(/lists ravenfox_77/);
    expect(tw.basis).toBe('reciprocal'); expect(tw.score).toBeGreaterThan(x.score + 0.15);
    expect(x.evidence.some((e) => e.adapter === 'fake-page')).toBe(false);          // nothing linked back
    expect((x.checks ?? []).some((c) => c.adapter === 'fake-page' && c.result === 'neutral')).toBe(true);
  });
  it('a one-way claim stays a claim: the X page that never mentions the account stays below the confirmed one and under the self-report cap', () => {
    const x = get('account', 'x.com/lookalike_acct');
    expect(x.score).toBeLessThanOrEqual(0.72); expect(x.basis).toBe('self-reported');
  });
});
