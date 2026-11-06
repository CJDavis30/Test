import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-hr-'));
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { register, allAdapters } = await import('../server/registry');
const { adapter } = await import('../server/adapters/live/util');
import type { RunEvent, Finding, GraphNode } from '../shared/types';
import { suggestNext, pivotWorthy, ruleBrief } from '../shared/scoring';

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>, caseId: string;
const call = async (m: string, p: string, b?: unknown) => { const r = await ctx.app.request(p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => ({})) as any }; };
const done = (runId: string) => new Promise<void>((resolve) => { let off: () => void = () => {}; off = ctx.hub.subscribe(runId, (e: RunEvent) => { if (e.t === 'run.done') { off(); resolve(); } }); });
const lookup = async (value: string, role?: unknown, type = 'username') => { const r = (await call('POST', `/api/cases/${caseId}/lookups`, { type, value, role })).json; await done(r.run.id); return r.node as GraphNode; };
const findings = async (subjectId?: string): Promise<Finding[]> => ((await call('GET', `/api/cases/${caseId}/findings`)).json.findings as Finding[]).filter((f) => !subjectId || f.subjectId === subjectId);

const RBX = 'https://www.roblox.com/users/777/profile', GH = 'https://github.com/ravenfox_77', GH2 = 'https://github.com/ravenfox_77x';
// a stand-in for the real Roblox lookup: it IS the platform, so it returns the account that was named
const roblox = adapter({
  id: 'fake-roblox', name: 'Roblox (fake)', description: '', accepts: ['username'], capability: 'gaming-profile', family: 'roblox', reliability: 0.92,
  selfTest: { type: 'username', value: 'x' },
  async run(e) {
    if (!/^ravenfox/i.test(e.value)) return [];
    return [
      { type: 'account', value: RBX, relation: 'Roblox profile', weight: 0.92, url: RBX, attrs: { platform: 'Roblox', handle: e.value } },
      { type: 'person', value: 'Raven Fox', relation: 'name on profile', weight: 0.8, url: RBX, snippet: 'Display name' },
      { type: 'person', value: 'Rae', relation: 'display name', weight: 0.8, url: RBX },
      { type: 'location', value: 'Tampa, FL', relation: 'location on profile', weight: 0.7, url: RBX, conflictKey: 'location' },
      { type: 'email', value: 'raven@example.test', relation: 'listed in Roblox bio', weight: 0.55, url: RBX },
    ];
  },
});
// a stand-in for "looks the same name up on another site": it finds whoever uses it there
const github = adapter({
  id: 'fake-github', name: 'GitHub (fake)', description: '', accepts: ['username'], capability: 'code-profile', family: 'github', reliability: 0.85,
  selfTest: { type: 'username', value: 'x' },
  async run(e) {
    if (e.value.toLowerCase() === 'ravenfox_77') return [
      { type: 'account', value: GH, relation: 'GitHub profile', weight: 0.9, url: GH, attrs: { platform: 'GitHub', handle: 'ravenfox_77' }, record: { title: 'GitHub profile', facts: [['Username', 'ravenfox_77'], ['Bio', 'I play roblox as ravenfox_77, dm me']] } },
      { type: 'person', value: 'Jane Doe', relation: 'name on profile', weight: 0.55, url: GH },
      { type: 'location', value: 'Berlin', relation: 'location on profile', weight: 0.5, url: GH, conflictKey: 'location' },
    ];
    if (e.value.toLowerCase() === 'ravenfox_88') return [
      { type: 'account', value: 'https://github.com/ravenfox_88', relation: 'GitHub profile', weight: 0.9, url: 'https://github.com/ravenfox_88', attrs: { platform: 'GitHub', handle: 'ravenfox_88' }, record: { title: 'GitHub profile', facts: [['Username', 'ravenfox_88'], ['Bio', 'compilers. roblox: ravenfox_88 is my kid']] } },
      { type: 'account', value: 'https://github.com/ravenfox_88-clone', relation: 'GitHub profile', weight: 0.9, url: 'https://github.com/ravenfox_88-clone', attrs: { platform: 'GitHub', handle: 'ravenfox_88-clone' }, record: { title: 'GitHub profile', facts: [['Username', 'ravenfox_88-clone'], ['Bio', 'ravenfox_88 forever, best handle']] } },
    ];
    if (e.value.toLowerCase() === 'raven_alt') return [
      { type: 'account', value: GH2, relation: 'GitHub profile', weight: 0.9, url: GH2, attrs: { platform: 'GitHub', handle: 'ravenfox_77x' }, record: { title: 'GitHub profile', facts: [['Username', 'ravenfox_77x'], ['Bio', 'my main is ravenfox_77 on roblox']] } },
    ];
    if (e.value.toLowerCase() === 'john') return [{ type: 'account', value: 'https://github.com/john', relation: 'GitHub profile', weight: 0.9, url: 'https://github.com/john', attrs: { platform: 'GitHub', handle: 'john' } }];
    return [];
  },
});

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'hr.db')));
  for (const a of allAdapters()) ctx.store.setSourceEnabled(a.id, false); // nothing touches the network
  register(roblox, github);
  ctx.store.setSourceEnabled('fake-roblox', true); ctx.store.setSourceEnabled('fake-github', true);
  ctx.store.setSetting('crossCheck', false);
  caseId = (await call('POST', '/api/cases', { name: 'HR', purpose: 'test' })).json.case.id;
}, 30_000);

describe('saying what a username is', () => {
  it('stores the role, origin and trust on the node, and describes it', async () => {
    const n = await lookup('ravenfox_77', { platform: 'roblox', kind: 'username', trust: 'certain', origin: 'their-profile', originNote: 'from their Roblox page' });
    expect(n.attrs).toMatchObject({ handlePlatform: 'roblox', handleKind: 'username', handleTrust: 'certain', handleOrigin: 'their-profile', handleOriginNote: 'from their Roblox page' });
  });
  it('rejects junk roles instead of trusting them', async () => {
    const r = await call('POST', `/api/cases/${caseId}/lookups`, { type: 'username', value: 'zzjunk99', run: false, role: { platform: '<script>', kind: 'bogus', trust: 'maybe', origin: 'x' } });
    expect(r.json.node.attrs.handlePlatform).toBeUndefined(); expect(r.json.node.attrs.handleTrust).toBe('probable'); expect(r.json.node.attrs.handleOrigin).toBeUndefined();
  });
});

describe('the platform you named is exact; everything else is the same name only', () => {
  let fs: Finding[];
  beforeAll(async () => { fs = await findings((await lookup('ravenfox_77')).id); });
  const get = (type: string, value: string) => fs.find((f) => f.type === type && f.value.toLowerCase().includes(value.toLowerCase()))!;

  it('the Roblox account for a Roblox username is exact and strong', () => {
    const a = get('account', 'roblox.com');
    expect(a.evidence.find((e) => e.adapter === 'fake-roblox')!.basis).toBe('exact');
    expect(a.score).toBeGreaterThan(0.8); expect(a.nameOnly).toBeUndefined();
  });
  it('what that profile says about itself (name, town, email) is a claim, capped, never a fact', () => {
    for (const [t, v] of [['person', 'Raven Fox'], ['location', 'Tampa'], ['email', 'raven@']] as const) {
      const f = get(t, v); expect(f.evidence[0].basis).toBe('self-reported'); expect(f.score).toBeLessThanOrEqual(0.72); expect(f.nameOnly).toBeUndefined();
    }
  });
  it('a one-word display name becomes an alias (a handle), not a person', () => {
    expect(fs.some((f) => f.type === 'person' && f.value === 'Rae')).toBe(false);
    const alias = get('username', 'Rae'); expect(alias).toBeTruthy(); expect(alias.attrs.handleKind).toBe('display-name');
  });
  it('the same name on GitHub is only a same-name match: low, flagged, and nothing it says counts', () => {
    const a = get('account', 'github.com/ravenfox_77');
    expect(a.evidence[0].basis).toBe('name-match'); expect(a.nameOnly).toBe(true); expect(a.score).toBeLessThan(0.4); expect(a.level).toBe(1);
    expect(a.reasons[0]).toMatch(/same name exists there/);
    for (const [t, v] of [['person', 'Jane Doe'], ['location', 'Berlin']] as const) { const f = get(t, v); expect(f.nameOnly).toBe(true); expect(f.score).toBeLessThan(0.4); }
  });
  it('nothing found only by name can start a new search, and a profile\'s own claimed name needs a second source', () => {
    const next = suggestNext(fs, new Set());
    expect(next.some((n) => /Jane|Berlin|github/i.test(n.value))).toBe(false);
    expect(pivotWorthy(get('person', 'Raven Fox')).ok).toBe(false);
    expect(pivotWorthy(get('person', 'Jane Doe')).why).toMatch(/same-name/);
  });
  it('the summary never calls a profile\'s name or town "the" name or place, and counts same-name accounts as unverified', () => {
    const ids = new Map(fs.map((f, i) => [f.id, `F${i + 1}`]));
    const b = ruleBrief({ type: 'username', value: 'ravenfox_77' }, fs, ids);
    expect(b.summary).not.toMatch(/Most likely name|Most likely location/);
    expect(b.summary).toMatch(/That is what it says about itself/); expect(b.summary).toMatch(/self-reported/);
    expect(b.summary).toMatch(/other accounts? uses? the same name|use the same name/);
    expect(b.headline).toBe('ravenfox_77');
  });
});

describe('without a role everything is a same-name match, and a common name is nearly worthless', () => {
  it('a very common handle caps a same-name hit near the floor; a distinctive one higher, never past 0.4', async () => {
    const common = await findings((await lookup('john')).id);
    const rare = await findings((await lookup('ravenfox_77')).id);
    const c = common.find((f) => f.type === 'account')!, r = rare.find((f) => f.value.includes('github.com/ravenfox_77'))!;
    expect(c.score).toBeLessThan(0.1); expect(r.score).toBeGreaterThan(c.score); expect(r.score).toBeLessThan(0.4);
  });
});

describe('a display name is a clue, not a search', () => {
  it('runs no sources at all, but is kept and used to check other finds', async () => {
    const n = await lookup('Raven F', { platform: 'discord', kind: 'display-name', trust: 'probable', origin: 'screenshot' });
    expect((await findings(n.id)).length).toBe(0);
    expect(n.attrs.handleKind).toBe('display-name');
  });
});

describe('corroboration is what turns a same-name match into a lead', () => {
  it('another account whose bio mentions the Roblox username you gave is lifted out of "same name only" (but only as far as its own word goes)', async () => {
    // the Roblox seed (with a role) is something every other find is checked against
    const alt = await lookup('raven_alt', { platform: 'discord', kind: 'username', trust: 'probable', origin: 'chat', alt: true });
    const fs = await findings(alt.id);
    const acct = fs.find((f) => f.type === 'account' && f.value.includes('ravenfox_77x'))!;
    expect(acct).toBeTruthy();
    const mention = acct.evidence.find((e) => e.adapter === 'anchor');
    expect(mention).toBeTruthy(); expect(mention!.basis).toBe('self-reported');
    expect(mention!.verdict).toMatch(/mentions/);
    expect(acct.nameOnly).toBeUndefined(); expect(acct.basis).toBe('self-reported');
    expect(acct.score).toBeGreaterThan(0.2); expect(acct.score).toBeLessThan(0.75);
    // and the alt you described is tied to the Roblox account on the graph, at the strength you believe it
    const g = (await call('GET', `/api/cases/${caseId}`)).json;
    const altNode = g.nodes.find((n: GraphNode) => n.id === alt.id), rbxNode = g.nodes.find((n: GraphNode) => n.value === 'ravenfox_77');
    expect(g.edges.some((e: any) => /alt account/.test(e.label) && [e.from, e.to].includes(altNode.id) && [e.from, e.to].includes(rbxNode.id))).toBe(true);
  });
  it('a lower-trust handle counts for proportionately less', async () => {
    const { anchorOf } = await import('../shared/anchors');
    const certain = anchorOf({ id: 'a', type: 'username', value: 'x1', attrs: { handleTrust: 'certain', handleOrigin: 'their-profile', handleKind: 'username' } });
    const unsure = anchorOf({ id: 'b', type: 'username', value: 'x2', attrs: { handleTrust: 'unsure', handleOrigin: 'told', handleKind: 'username' } });
    expect(certain.trust).toBe(1); expect(unsure.trust!).toBeLessThan(0.4);
  });
});

describe('a page that names the account you searched, with the service, is pointing back at it', () => {
  it('lifts it out of "same name only"; a bare mention of the same word does not', async () => {
    const n = await lookup('ravenfox_88', { platform: 'roblox', kind: 'username', trust: 'certain', origin: 'their-profile' });
    const fs = await findings(n.id);
    const good = fs.find((f) => f.value.endsWith('github.com/ravenfox_88'))!, bare = fs.find((f) => f.value.endsWith('ravenfox_88-clone'))!;
    const ev = good.evidence.find((e) => e.adapter === 'anchor' && /naming the Roblox account/.test(e.verdict ?? ''))!;
    expect(ev).toBeTruthy(); expect(ev.basis).toBe('self-reported'); expect(ev.verdict).toMatch(/naming the Roblox account you searched/);
    expect(good.nameOnly).toBeUndefined(); expect(good.score).toBeGreaterThan(bare.score + 0.1); expect(good.score).toBeLessThanOrEqual(0.72);
    expect(bare.nameOnly).toBe(true); expect(bare.evidence.some((e) => /naming the Roblox account/.test(e.verdict ?? ''))).toBe(false);
  });
});
