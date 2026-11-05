import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-kf-'));
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { register } = await import('../server/registry');
const { adapter } = await import('../server/adapters/live/util');
import type { RunEvent, Finding, GraphNode, GraphEdge } from '../shared/types';

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>, caseId: string;
const call = async (m: string, p: string, b?: unknown) => { const r = await ctx.app.request(p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as any }; };
const done = (runId: string) => new Promise<void>((resolve) => { let off: () => void = () => {}; off = ctx.hub.subscribe(runId, (e: RunEvent) => { if (e.t === 'run.done') { off(); resolve(); } }); });
const lookup = async (type: string, value: string) => { const r = (await call('POST', `/api/cases/${caseId}/lookups`, { type, value })).json; await done(r.run.id); return r.node as GraphNode; };
const findings = async (): Promise<Finding[]> => (await call('GET', `/api/cases/${caseId}/findings`)).json.findings;
const snap = async () => (await call('GET', `/api/cases/${caseId}`)).json as { nodes: GraphNode[]; edges: GraphEdge[] };

const EMAIL = 'mara.linden@northwind-labs.example', USER = 'maralinden', ACCT = 'https://www.roblox.com/users/1/profile', DECOY = 'https://www.roblox.com/users/2/profile';
const roblox = adapter({
  id: 'test-roblox', name: 'Roblox (test)', description: '', accepts: ['username', 'email'], capability: 'gaming-profile', family: 'test-roblox', reliability: 0.9, demo: true,
  selfTest: { type: 'username', value: USER },
  async run(e) {
    if (e.type === 'username' && e.value.toLowerCase() === USER) return [
      { type: 'account', value: ACCT, relation: 'Roblox profile', weight: 0.6, url: ACCT, attrs: { platform: 'Roblox', handle: 'm_builds', displayName: USER }, record: { title: 'Roblox profile', facts: [['Username', 'm_builds'], ['Display name', USER], ['About', `builder. mail me: ${EMAIL}`], ['Created', '2021-03-04']] } },
      { type: 'email', value: EMAIL, relation: 'listed in Roblox bio', weight: 0.5, url: ACCT },
      { type: 'account', value: DECOY, relation: 'Roblox profile', weight: 0.6, url: DECOY, attrs: { platform: 'Roblox', handle: 'maralinden_', displayName: 'mara' }, record: { title: 'Roblox profile', facts: [['Username', 'maralinden_'], ['About', 'hi']] } },
    ];
    if (e.type === 'email' && e.value.toLowerCase() === EMAIL) return [{ type: 'account', value: ACCT, relation: 'account using this email', weight: 0.5, url: ACCT, attrs: { platform: 'Roblox', handle: 'm_builds', displayName: USER } }];
    return [];
  },
});

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'kf.db')));
  ctx.store.setSetting('demoMode', true); ctx.store.setSetting('crossCheck', false);
  register(roblox);
  caseId = (await call('POST', '/api/cases', { name: 'KF', purpose: 'test' })).json.case.id;
}, 30_000);

describe('telling Plexus what you know', () => {
  it('adds several known facts at once, marks them confirmed, and links them to each other', async () => {
    const r = (await call('POST', `/api/cases/${caseId}/known`, { items: [{ value: EMAIL }, { value: USER, type: 'username' }], run: false })).json;
    expect(r.nodes).toHaveLength(2);
    for (const n of r.nodes) { expect(n.attrs.known).toBe(true); expect(n.state).toBe('confirmed'); expect(n.level).toBe(4); }
    expect(r.edges).toHaveLength(1); expect(r.edges[0]).toMatchObject({ label: 'known to be the same subject', kind: 'manual' });
    expect((await call('POST', `/api/cases/${caseId}/known`, { items: [] })).status).toBe(400);
    expect((await call('POST', `/api/cases/nope/known`, { items: [{ value: 'x@y.example' }] })).status).toBe(404);
  });
  it('adding the same known fact twice does not duplicate it', async () => {
    await call('POST', `/api/cases/${caseId}/known`, { items: [{ value: EMAIL }], run: false });
    expect((await snap()).nodes.filter((n) => n.type === 'email')).toHaveLength(1);
  });
});

describe('cross-checking against what you know', () => {
  let acct: Finding, decoy: Finding;
  it('the account whose page lists the known email scores far above the look-alike, and says why', async () => {
    await lookup('username', USER);
    const fs = await findings();
    acct = fs.find((f) => f.type === 'account' && f.value === ACCT)!; decoy = fs.find((f) => f.type === 'account' && f.value === DECOY)!;
    expect(acct).toBeTruthy(); expect(decoy).toBeTruthy();
    const ev = acct.evidence.find((e) => e.adapter === 'anchor')!;
    expect(ev).toBeTruthy(); expect(ev.adapterName).toBe('What you told Plexus'); expect(ev.verdict).toMatch(/lists mara\.linden@northwind-labs\.example|shows mara\.linden/);
    expect(ev.record!.facts.map((x) => x[0])).toEqual(expect.arrayContaining(['You told Plexus', 'Found here', 'Why it counts']));
    expect(acct.score).toBeGreaterThanOrEqual(0.85); expect(acct.level).toBe(4);
    expect(decoy.score).toBeLessThan(0.7);
    expect(decoy.evidence.some((e) => e.adapter === 'anchor')).toBe(false);
    expect(acct.checks!.some((c) => c.adapter === 'anchor' && c.result === 'confirms')).toBe(true);
    // the sentence is grammatical however the match was worded ("Its page shows…", never "It its page shows…")
    for (const f of fs) for (const e of f.evidence.filter((x) => x.adapter === 'anchor')) expect(e.verdict).not.toMatch(/^It (its|their|the)\b/i);
  });
  it('a second starting point that reaches the same account counts as an independent route', async () => {
    await lookup('email', EMAIL);
    const a = (await findings()).filter((f) => f.type === 'account' && f.value === ACCT);
    expect(a).toHaveLength(2);                                           // one per starting point
    for (const f of a) expect(f.evidence.some((e) => e.adapter === 'anchor' && e.family.startsWith('route:'))).toBe(true);
  });
  it('is idempotent: looking up again does not pile up duplicate evidence', async () => {
    await lookup('username', USER);
    const f = (await findings()).find((x) => x.type === 'account' && x.value === ACCT && x.subjectId === acct.subjectId)!;
    const anchorEv = f.evidence.filter((e) => e.adapter === 'anchor');
    expect(new Set(anchorEv.map((e) => e.family)).size).toBe(anchorEv.length);
  });
  it('knowledge added later re-scores what was already found', async () => {
    const c2 = (await call('POST', '/api/cases', { name: 'Later', purpose: 'test' })).json.case.id; const old = caseId; caseId = c2;
    await lookup('username', USER);
    const before = (await findings()).find((f) => f.value === ACCT)!;
    expect(before.evidence.some((e) => e.adapter === 'anchor')).toBe(false);
    await call('POST', `/api/cases/${c2}/known`, { items: [{ value: EMAIL }], run: false });
    const after = (await findings()).find((f) => f.value === ACCT)!;
    expect(after.evidence.some((e) => e.adapter === 'anchor')).toBe(true); expect(after.score).toBeGreaterThan(before.score);
    caseId = old;
  });
  it('taking a fact back un-knows it and removes its evidence', async () => {
    const c3 = (await call('POST', '/api/cases', { name: 'Undo', purpose: 'test' })).json.case.id; const old = caseId; caseId = c3;
    const k = (await call('POST', `/api/cases/${c3}/known`, { items: [{ value: EMAIL }], run: false })).json.nodes[0];
    await lookup('username', USER);
    expect((await findings()).find((f) => f.value === ACCT)!.evidence.some((e) => e.adapter === 'anchor')).toBe(true);
    await call('PATCH', `/api/nodes/${k.id}`, { known: false });
    expect((await findings()).find((f) => f.value === ACCT)!.evidence.some((e) => e.adapter === 'anchor')).toBe(false);
    expect((await snap()).nodes.find((n) => n.id === k.id)!.attrs.known).toBeUndefined();
    caseId = old;
  });
});

describe('accepting means correct: it goes on the graph and joins every dot it touches', () => {
  it('previews what accepting will connect, with a sentence for each', async () => {
    const f = (await findings()).find((x) => x.type === 'account' && x.value === ACCT && x.status === 'pending')!;
    const c = (await call('GET', `/api/findings/${f.id}/connections`)).json.connections as any[];
    expect(c.map((x) => x.kind)).toContain('found-from');
    const email = c.find((x) => x.kind === 'match')!;
    expect(email.label).toBe(EMAIL); expect(email.why).toMatch(/lists mara\.linden|shows mara\.linden/);
  });
  it('accepting adds the node and edges at once: to what it was found from AND to the known email', async () => {
    const f = (await findings()).find((x) => x.type === 'account' && x.value === ACCT && x.status === 'pending')!;
    const r = (await call('POST', '/api/findings/review', { ids: [f.id], status: 'accepted' })).json;
    expect(r.nodes.some((n: GraphNode) => n.type === 'account' && n.value === ACCT)).toBe(true);
    const s = await snap();
    const node = s.nodes.find((n) => n.type === 'account' && n.value === ACCT)!, email = s.nodes.find((n) => n.type === 'email')!, user = s.nodes.find((n) => n.type === 'username')!;
    const edgesTo = s.edges.filter((e) => e.to === node.id || e.from === node.id);
    expect(edgesTo.some((e) => (e.from === email.id || e.to === email.id) && /email/.test(e.label) && e.kind === 'evidenced' && e.why)).toBe(true);
    expect(edgesTo.some((e) => (e.from === user.id || e.to === user.id))).toBe(true);
    expect(node.state).toBe('confirmed');
  });
  it('rejecting it afterwards takes it and its connections back off the graph', async () => {
    const f = (await findings()).find((x) => x.type === 'account' && x.value === ACCT && x.status === 'accepted')!;
    const r = (await call('POST', '/api/findings/review', { ids: [f.id], status: 'rejected' })).json;
    expect(r.removedNodeIds.length).toBeGreaterThan(0); expect(r.removedEdgeIds.length).toBeGreaterThan(0);
    const s = await snap();
    expect(s.nodes.some((n) => n.type === 'account' && n.value === ACCT)).toBe(false);
    expect(s.nodes.filter((n) => n.attrs.known)).toHaveLength(2);        // the facts you told Plexus stay
  });
  it('a node you pinned or wrote notes on is never deleted by a change of mind', async () => {
    const f = (await findings()).find((x) => x.type === 'account' && x.value === ACCT && x.status === 'rejected')!;
    await call('POST', '/api/findings/review', { ids: [f.id], status: 'accepted' });
    const node = (await snap()).nodes.find((n) => n.value === ACCT)!;
    await call('PATCH', `/api/nodes/${node.id}`, { notes: 'important' });
    await call('POST', '/api/findings/review', { ids: [f.id], status: 'unsure' });
    expect((await snap()).nodes.some((n) => n.value === ACCT)).toBe(true);
  });
  it('accepting twice or with an empty list is harmless', async () => {
    expect((await call('POST', '/api/findings/review', { ids: [], status: 'accepted' })).json.findings).toEqual([]);
    expect((await call('POST', '/api/findings/review', { ids: ['nope'], status: 'accepted' })).status).toBe(200);
  });
});
