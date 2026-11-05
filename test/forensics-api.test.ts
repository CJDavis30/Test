import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-fx-'));
process.env.PLEXUS_DEMO_FAST = '1';
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
import type { RunEvent } from '../shared/types';

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>;
let caseId: string;
const call = async (m: string, p: string, b?: unknown) => { const r = await ctx.app.request(p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as any }; };

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'fx.db')));
  ctx.store.setSetting('demoMode', true);
  caseId = (await call('POST', '/api/cases', { name: 'FX', purpose: '' })).json.case.id;
  const r = (await call('POST', `/api/cases/${caseId}/lookups`, { value: 'maralinden', type: 'username' })).json;
  await new Promise<void>((resolve) => { let off: () => void = () => {}; let fin = false; off = ctx.hub.subscribe(r.run.id, (e: RunEvent) => { if (e.t === 'run.done') { fin = true; off(); resolve(); } }); if (fin) off(); });
  const fs = (await call('GET', `/api/cases/${caseId}/findings`)).json.findings.filter((f: any) => f.type === 'account');
  await call('POST', '/api/findings/review', { ids: fs.map((f: any) => f.id), status: 'accepted' });
  await call('POST', `/api/cases/${caseId}/commit`, {});
}, 60_000);

const accounts = async () => (await call('GET', `/api/cases/${caseId}`)).json.nodes.filter((n: any) => n.type === 'account');

describe('forensics over a real case', () => {
  it('finds the gaming accounts and reads their creation times and clocks from what the case holds', async () => {
    const acc = await accounts();
    const rob = acc.find((n: any) => n.attrs.platform === 'Roblox'), dis = acc.find((n: any) => n.attrs.platform === 'Discord' && n.attrs.handle === 'maralinden');
    expect(rob).toBeTruthy(); expect(dis).toBeTruthy();
    const clock = (await call('GET', `/api/nodes/${rob.id}/activity`)).json;
    expect(clock.circadian.best.offset).toBe(-6);
  });
  it('the Roblox and Discord accounts created 41 seconds apart are the same operator; the look-alike with a different clock is not', async () => {
    const acc = await accounts();
    const rob = acc.find((n: any) => n.attrs.platform === 'Roblox'), dis = acc.find((n: any) => n.attrs.platform === 'Discord' && n.attrs.handle === 'maralinden'), imp = acc.find((n: any) => n.attrs.handle === 'maralinden_');
    const real = (await call('GET', `/api/cases/${caseId}/match?a=${rob.id}&b=${dis.id}`)).json;
    expect(real.match.posterior).toBeGreaterThan(0.999);
    const keys = real.match.signals.map((s: any) => s.key);
    expect(keys).toContain('handle'); expect(keys).toContain('created'); expect(keys).toContain('clock'); expect(keys).toContain('alternation');
    expect(real.match.signals.find((s: any) => s.key === 'alternation').bits).toBeGreaterThan(3);
    expect(real.match.signals.find((s: any) => s.key === 'created').detail).toMatch(/41 seconds/);
    if (imp) {
      const fake = (await call('GET', `/api/cases/${caseId}/match?a=${dis.id}&b=${imp.id}`)).json;
      expect(fake.match.posterior).toBeLessThan(0.25);
      expect(['unlikely', 'different']).toContain(fake.match.verdict);
      expect(fake.match.signals.find((s: any) => s.key === 'clock').bits).toBeLessThan(-3);
    }
  });
  it('groups accounts into identities and lists the look-alike separately', async () => {
    const r = (await call('GET', `/api/cases/${caseId}/identities`)).json;
    const acc = await accounts();
    const rob = acc.find((n: any) => n.attrs.platform === 'Roblox'), dis = acc.find((n: any) => n.attrs.platform === 'Discord' && n.attrs.handle === 'maralinden');
    const idRob = r.identities.find((i: any) => i.members.some((m: any) => m.id === rob.id));
    expect(idRob.members.map((m: any) => m.id)).toContain(dis.id);
    const imp = acc.find((n: any) => n.attrs.handle === 'maralinden_');
    if (imp) expect(idRob.members.map((m: any) => m.id)).not.toContain(imp.id);
  });
  it('lets the prior move the answer', async () => {
    const acc = await accounts();
    const rob = acc.find((n: any) => n.attrs.platform === 'Roblox'), dis = acc.find((n: any) => n.attrs.platform === 'Discord' && n.attrs.handle === 'maralinden');
    const lo = (await call('GET', `/api/cases/${caseId}/match?a=${rob.id}&b=${dis.id}&prior=0.000001`)).json.match.posterior;
    const hi = (await call('GET', `/api/cases/${caseId}/match?a=${rob.id}&b=${dis.id}&prior=1`)).json.match.posterior;
    expect(hi).toBeGreaterThan(lo);
  });
  it('rejects things it cannot compare', async () => {
    expect((await call('GET', `/api/cases/${caseId}/match?a=nope&b=nope`)).status).toBe(400);
    expect((await call('GET', `/api/cases/missing/identities`)).status).toBe(404);
  });
});

describe('paste anything', () => {
  const log = `
    [2024-03-02 03:12:44] mara: gg
    [2024-03-02 03:14:01] mara: one more
    https://discord.com/channels/111111111111111111/222222222222222222/${'1' + '0'.repeat(0)}175928847299117063
    profile https://www.roblox.com/users/3148802991/profile, steam https://steamcommunity.com/profiles/76561197960287930
    epoch 1709349164 and 1709349164000
  `;
  it('decodes every platform reference and every timestamp, and reports honestly when there are too few for a clock', async () => {
    const r = (await call('POST', '/api/forensics/scan', { text: log })).json;
    expect(r.refs.map((x: any) => x.platform)).toEqual(expect.arrayContaining(['Discord', 'Roblox', 'Steam']));
    expect(r.timestamps).toBeGreaterThanOrEqual(4);
    expect(r.circadian === null || r.circadian.strength === 'insufficient').toBe(true);
  });
  it('turns a big pasted log into a timezone estimate, and stores it on an account', async () => {
    const lines: string[] = []; let s = 5; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 120; i++) { const hour = 14 + Math.floor(r() * 9); lines.push(`${new Date(Date.UTC(2024, 0, 1 + Math.floor(r() * 300), hour, Math.floor(r() * 60))).toISOString()} message`); } // UTC 14-22 → daytime for UTC+... people
    const out = (await call('POST', '/api/forensics/scan', { text: lines.join('\n') })).json;
    expect(out.circadian.sessions).toBeGreaterThan(50);
    const acc = (await accounts())[0];
    const stored = (await call('POST', `/api/nodes/${acc.id}/activity`, { text: lines.join('\n') })).json;
    expect(stored.count).toBeGreaterThan(50);
    expect((await call('GET', `/api/nodes/${acc.id}/activity`)).json.count).toBe(stored.count);
  });
  it('shrugs off garbage', async () => {
    expect((await call('POST', '/api/forensics/scan', { text: 'x'.repeat(50000) })).status).toBe(200);
    expect((await call('POST', '/api/forensics/scan', {})).status).toBe(200);
  });
});

describe('chat exports', () => {
  const chat = (() => { let s = 21; const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return JSON.stringify({ messages: Array.from({ length: 700 }, (_, i) => ({ id: String(i), timestamp: new Date(Date.UTC(2024, 0, 1) + Math.floor(r() * 250) * 86_400_000 + (16 + Math.floor(r() * 7)) * 3_600_000 + Math.floor(r() * 3_600_000)).toISOString(), author: { id: i % 7 === 0 ? '222222222222222222' : '175928847299117063', name: i % 7 === 0 ? 'friend' : 'night_owl' }, content: 'x' })) }); })();
  it('summarises speakers with their own clocks, and ignores text that is not a chat', async () => {
    const r = (await call('POST', '/api/forensics/chat', { text: chat })).json.chat;
    expect(r.platform).toBe('Discord'); expect(r.total).toBe(700); expect(r.speakers[0].name).toBe('night_owl');
    expect(r.speakers[0].circadian.strength).not.toBe('insufficient');
    expect((await call('POST', '/api/forensics/chat', { text: 'just some words' })).json.chat).toBeNull();
  });
  it('adds chosen speakers to a case as accounts with their activity attached', async () => {
    const cid = (await call('POST', '/api/cases', { name: 'Chat', purpose: '' })).json.case.id;
    const out = (await call('POST', `/api/cases/${cid}/chat-import`, { text: chat, speakers: ['175928847299117063'] })).json;
    expect(out.added).toBe(1);
    const n = (await call('GET', `/api/cases/${cid}`)).json.nodes.find((x: any) => x.attrs.platform === 'Discord');
    expect(n.value).toBe('https://discord.com/users/175928847299117063');
    const clock = (await call('GET', `/api/nodes/${n.id}/activity`)).json; expect(clock.count).toBeGreaterThan(500); expect(clock.circadian).toBeTruthy();
    expect((await call('POST', `/api/cases/${cid}/chat-import`, { text: chat, speakers: [] })).json.added).toBe(0);
  });
});

describe('ID clocks learn from what Plexus sees', () => {
  it('stays silent until it has seen enough accounts, then dates an unseen Roblox ID with an honest band', async () => {
    const { learnIds } = await import('../server/idclocks');
    const text = 'see https://www.roblox.com/users/777777777/profile';
    const before = (await call('POST', '/api/forensics/scan', { text })).json.refs[0];
    expect(before.note ?? '').not.toMatch(/created around/);
    const T0 = Date.UTC(2010, 0, 1), Y = 365.25 * 86_400_000;
    const claims = Array.from({ length: 40 }, (_, i) => ({ type: 'account', value: `https://www.roblox.com/users/${Math.round(1e6 * (i + 1) ** 2.2)}/profile`, relation: 'profile', weight: 0.9, attrs: { platform: 'Roblox', robloxId: String(Math.round(1e6 * (i + 1) ** 2.2)), createdAt: new Date(T0 + (i / 39) * 14 * Y).toISOString() } }));
    expect(learnIds(ctx.store, claims as any)).toBe(40);
    const after = (await call('POST', '/api/forensics/scan', { text })).json.refs[0];
    expect(after.note).toMatch(/created around [A-Z][a-z]{2} \d{4} \(±/); expect(after.note).toMatch(/estimated from \d+ accounts/);
  });
});
