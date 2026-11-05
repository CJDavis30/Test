import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-sg-'));
process.env.PLEXUS_DEMO_FAST = '1';
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { register } = await import('../server/registry');
const { autoAcceptable } = await import('../server/autopilot');
const { careOf } = await import('../server/safeguards');
import type { ApEvent, Finding, RunEvent } from '../shared/types';

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>;
const call = async (m: string, p: string, b?: unknown) => { const r = await ctx.app.request(p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as any }; };
const wait = (runId: string) => new Promise<RunEvent[]>((resolve) => { const ev: RunEvent[] = []; let off = () => {}; let f = false; off = ctx.hub.subscribe(runId, (e) => { ev.push(e); if (e.t === 'run.done' || e.t === 'run.error') { f = true; off(); resolve(ev); } }); if (f) off(); });

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 's.db')));
  // a live-mode source whose profile bio says the owner is 13
  register({ id: 'kidsrc', name: 'Kid Source', description: 't', family: 'kid', accepts: ['username'], capability: 'sg-test', requiresKey: undefined, minIntervalMs: 0, selfTest: { type: 'username', value: 'x' }, reliability: 0.9, priority: 1, anyMode: true, cacheTtlMs: 0,
    async run() { return [{ type: 'account', value: 'https://www.roblox.com/users/1/profile', relation: 'profile', weight: 0.9, attrs: { platform: 'Roblox', handle: 'builder_kid' }, snippet: 'Roblox account', record: { title: 'Roblox profile', facts: [['About', 'hi im 13 and i make obbies, dm me']] } }, { type: 'location', value: 'Austin, TX', relation: 'likely location', weight: 0.8, snippet: 'Seen near Austin' }, { type: 'email', value: 'dad@example.com', relation: 'listed in bio', weight: 0.9 }]; } } as any);
  register({ id: 'kidsrc2', name: 'Second Kid Source', description: 't', family: 'kid2', accepts: ['username'], capability: 'sg-test', minIntervalMs: 0, selfTest: { type: 'username', value: 'x' }, reliability: 0.9, priority: 2, anyMode: true, cacheTtlMs: 0,
    async run() { return [{ type: 'account', value: 'https://www.roblox.com/users/1/profile', relation: 'profile', weight: 0.9, attrs: { platform: 'Roblox', handle: 'builder_kid' } }, { type: 'location', value: 'Austin, TX', relation: 'resident', weight: 0.9 }, { type: 'email', value: 'dad@example.com', relation: 'listed in bio', weight: 0.9 }]; } } as any);
  const { CAPABILITY_MODE } = await import('../server/adapters/types'); CAPABILITY_MODE['sg-test'] = 'all';
});

const fnd = (o: Partial<Finding>): Finding => ({ id: 'f', caseId: 'c', subjectId: 's', type: 'person', value: 'x', key: 'x', relation: 'works at', attrs: {}, score: 0.95, rank: 1, level: 4, reasons: [], status: 'pending', createdAt: 0, evidence: [{ id: 'a', adapter: 'a', adapterName: 'A', family: 'a', retrievedAt: 0, weight: 0.9 }, { id: 'b', adapter: 'b', adapterName: 'B', family: 'b', retrievedAt: 0, weight: 0.9 }], ...o } as Finding);

describe('young-person safeguards', () => {
  it('Autopilot will not accept anything pointing to the real world when care is on, but accepts the same finding otherwise', () => {
    for (const type of ['person', 'phone', 'email', 'location'] as const) { expect(autoAcceptable(fnd({ type }), { care: true }).ok, type).toBe(false); expect(autoAcceptable(fnd({ type })).ok, type).toBe(true); }
    expect(autoAcceptable(fnd({ type: 'username' }), { care: true }).ok).toBe(true);
  });
  it('notices a bio that says the owner is 13, flags the case once, says why, and logs it', async () => {
    const caseId = (await call('POST', '/api/cases', { name: 'K', purpose: 'trust and safety report' })).json.case.id;
    ctx.store.setSetting('demoMode', false);
    for (const x of (await import('../server/registry')).allAdapters()) if (!x.id.startsWith('kidsrc')) ctx.store.setSourceEnabled(x.id, false);
    const r = (await call('POST', `/api/cases/${caseId}/lookups`, { value: 'builder_kid', type: 'username' })).json;
    const ev = await wait(r.run.id);
    expect(ev.some((e) => e.t === 'care')).toBe(true);
    const care = careOf(ctx.store, caseId); expect(care.youth).toBe(true); expect(care.reasons.join()).toMatch(/says they are 13/);
    const snap = (await call('GET', `/api/cases/${caseId}`)).json; expect(snap.case.care.youth).toBe(true);
    const audit = ctx.store.listAudit(caseId); expect(audit.filter((a) => a.action === 'safeguard.minor').length).toBe(1);
    expect(ctx.store.verifyAudit(caseId).ok).toBe(true);
    // a person can override, which is logged, and then detection stops changing it
    const o = await call('PUT', `/api/cases/${caseId}/care`, { youth: false });
    expect(o.json).toMatchObject({ youth: false, manual: 'off' });
    expect(ctx.store.listAudit(caseId).some((a) => a.action === 'safeguard.override' && /overrode/.test(a.detail))).toBe(true);
    const r2 = (await call('POST', `/api/cases/${caseId}/lookups`, { nodeId: r.node.id })).json; await wait(r2.run.id);
    expect(careOf(ctx.store, caseId).youth).toBe(false);
  }, 30_000);
  it('Autopilot on a flagged case accepts the account but leaves the place and the email for a human', async () => {
    const caseId = (await call('POST', '/api/cases', { name: 'K2', purpose: 'trust and safety report' })).json.case.id;
    ctx.store.setSetting('demoMode', false);
    const a = (await call('POST', `/api/cases/${caseId}/autopilot`, { value: 'builder_kid2', type: 'username', depth: 1, subjects: 3 })).json;
    await new Promise<void>((resolve) => { ctx.autopilot.subscribe(a.id, (e: ApEvent) => { if (e.t === 'ap.done' || e.t === 'ap.error') resolve(); }); });
    const acc = ctx.store.listFindings(caseId, { status: ['accepted'] });
    expect(acc.some((f) => f.type === 'account')).toBe(true);
    expect(acc.some((f) => f.type === 'location' || f.type === 'email')).toBe(false);
    expect(ctx.store.listFindings(caseId, { status: ['pending'] }).some((f) => f.type === 'email')).toBe(true);
    expect(ctx.store.listAudit(caseId).some((x) => x.action === 'safeguard.minor')).toBe(true);
  }, 30_000);
});

describe('purpose before live lookups', () => {
  it('asks for a purpose in live mode, never in demo mode, and accepts once it is given', async () => {
    const caseId = (await call('POST', '/api/cases', { name: 'P', purpose: '' })).json.case.id;
    ctx.store.setSetting('demoMode', false);
    const blocked = await call('POST', `/api/cases/${caseId}/lookups`, { value: 'someone', type: 'username' });
    expect(blocked.status).toBe(428); expect(blocked.json.error).toBe('purpose_required');
    expect((await call('POST', `/api/cases/${caseId}/autopilot`, { value: 'someone', type: 'username' })).status).toBe(428);
    expect((await call('POST', `/api/cases/${caseId}/lookups`, { value: 'someone', type: 'username', run: false })).status).toBe(200); // adding a node is not a lookup
    ctx.store.setSetting('demoMode', true);
    expect((await call('POST', `/api/cases/${caseId}/lookups`, { value: 'someone', type: 'username', run: false })).status).toBe(200);
    expect((await call('POST', `/api/cases/${caseId}/lookups`, { value: 'mara.linden@northwind-labs.example' })).status).toBe(200);
    ctx.store.setSetting('demoMode', false);
    await call('PATCH', `/api/cases/${caseId}`, { purpose: 'Scam or fraud' });
    const ok = await call('POST', `/api/cases/${caseId}/lookups`, { value: 'someone', type: 'username' }); expect(ok.status).toBe(200); await wait(ok.json.run.id);
  }, 30_000);
  it('can be switched off in settings', async () => {
    const caseId = (await call('POST', '/api/cases', { name: 'P2', purpose: '' })).json.case.id;
    ctx.store.setSetting('demoMode', false);
    await call('PUT', '/api/settings', { requirePurpose: false });
    const r = await call('POST', `/api/cases/${caseId}/lookups`, { value: 'someone', type: 'username' }); expect(r.status).toBe(200); await wait(r.json.run.id);
    expect((await call('GET', '/api/settings')).json.requirePurpose).toBe(false);
  }, 30_000);
});
