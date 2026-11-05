import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-xc-'));
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { register, allAdapters } = await import('../server/registry');
import type { Claim, Finding, RunEvent } from '../shared/types';

let ctx: Awaited<ReturnType<typeof createApp>>;
const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
const call = async (method: string, path: string, body?: unknown) => {
  const res = await ctx.app.request(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return (await res.json().catch(() => ({}))) as any;
};
const calls: string[] = [];

/** The world: an email source finds three usernames; a profile source answers questions about usernames. */
const SUBJECT = 'jo@acme-test.example';
const profiles: Record<string, Claim[]> = {
  // a genuine profile: lists the email, and shows the same name + city we found elsewhere
  jo_dev: [
    { type: 'email', value: SUBJECT, relation: 'public email', weight: 0.8, record: { title: 'Profile jo_dev', facts: [['Public email', SUBJECT]] } },
    { type: 'person', value: 'Jo Rivers', relation: 'name on profile', weight: 0.7, record: { title: 'Profile jo_dev', facts: [['Name', 'Jo Rivers']] } },
    { type: 'location', value: 'Austin, TX', relation: 'location on profile', weight: 0.6 },
  ],
  // somebody else entirely: a different name and city
  jo: [
    { type: 'person', value: 'Stefan Brandt', relation: 'name on profile', weight: 0.7 },
    { type: 'location', value: 'Berlin, Germany', relation: 'location on profile', weight: 0.6 },
  ],
  ghost: [], // no such profile
};

const emailSource = (n = 3) => ({
  id: 'x-email-src', name: 'Email source', description: '', accepts: ['email' as const], capability: 'x-email', family: 'x-email', reliability: 0.8, priority: 1,
  selfTest: { type: 'email' as const, value: SUBJECT },
  run: async (): Promise<Claim[]> => [
    { type: 'username', value: 'jo_dev', relation: 'handle', weight: 0.55 },
    { type: 'username', value: 'jo', relation: 'possible handle', weight: 0.3 },
    { type: 'username', value: 'ghost', relation: 'handle', weight: 0.4 },
    { type: 'person', value: 'Jo Rivers', relation: 'name on profile', weight: 0.5 },
    { type: 'location', value: 'Austin, TX', relation: 'based in', weight: 0.4, conflictKey: 'location' },
    ...Array.from({ length: Math.max(0, n - 3) }, (_, i) => ({ type: 'username' as const, value: `extra${i}`, relation: 'handle', weight: 0.35 })),
  ],
});
const profileSource = {
  id: 'x-profile-src', name: 'Profile source', description: '', accepts: ['username' as const], capability: 'x-profile', family: 'x-profile', reliability: 0.85, priority: 1,
  selfTest: { type: 'username' as const, value: 'jo_dev' },
  run: async (e: { value: string }): Promise<Claim[]> => { calls.push(e.value); return profiles[e.value] ?? []; },
};

async function lookup(caseName: string, opts: { crossCheck: boolean; many?: boolean }) {
  ctx.store.setSetting('crossCheck', opts.crossCheck);
  ctx.store.cacheClear();
  calls.length = 0;
  const c = (await call('POST', '/api/cases', { name: caseName })).case;
  const r = await call('POST', `/api/cases/${c.id}/lookups`, { value: SUBJECT, type: 'email' });
  const events: RunEvent[] = [];
  await new Promise<void>((resolve) => {
    let off: () => void = () => {}; let fin = false;
    off = ctx.hub.subscribe(r.run.id, (e) => { events.push(e); if (e.t === 'run.done' || e.t === 'run.error') { fin = true; off(); resolve(); } });
    if (fin) off();
  });
  const fs = ctx.store.listFindings(c.id, { subjectId: r.node.id });
  const by = (type: string, value: string) => fs.find((f) => f.type === type && f.value === value) as Finding;
  return { fs, by, events };
}

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'xc.db')));
  ctx.store.setSetting('demoMode', false);
  ctx.store.setSetting('requirePurpose', false); // these tests run live-mode lookups on throwaway cases
  for (const a of allAdapters()) ctx.store.setSourceEnabled(a.id, false); // only our fake world answers
  register(emailSource(), profileSource);
  ctx.store.setSourceEnabled('x-email-src', true); ctx.store.setSourceEnabled('x-profile-src', true);
});

describe('cross-checking', () => {
  it('a profile that links back raises the score and quotes what it returned', async () => {
    const base = await lookup('baseline', { crossCheck: false });
    const xc = await lookup('checked', { crossCheck: true });
    const before = base.by('username', 'jo_dev'), after = xc.by('username', 'jo_dev');
    expect(before.evidence.every((e) => e.kind !== 'cross')).toBe(true);
    const cross = after.evidence.filter((e) => e.kind === 'cross' && e.polarity === 'for');
    expect(cross.length).toBeGreaterThanOrEqual(1);
    const link = cross.find((e) => /lists jo@acme-test\.example/i.test(e.verdict ?? ''))!;
    expect(link, 'a link-back verdict that names the email').toBeTruthy();
    expect(link.record?.facts).toEqual([['Public email', SUBJECT]]);       // the source's own fields, quoted
    expect(link.how).toMatch(/to check a username found for jo@acme-test\.example/);
    expect(link.via?.label).toBe('jo_dev');
    expect(after.checks?.some((c) => c.result === 'confirms' && c.source === 'Profile source')).toBe(true);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it('a shared detail corroborates the OTHER finding too (the name is backed by the profile we found)', async () => {
    const base = await lookup('baseline2', { crossCheck: false });
    const xc = await lookup('checked2', { crossCheck: true });
    const name = xc.by('person', 'Jo Rivers');
    const viaProfile = name.evidence.find((e) => e.kind === 'cross' && e.via?.label === 'jo_dev');
    expect(viaProfile, 'the name gains evidence from the jo_dev profile').toBeTruthy();
    expect(viaProfile!.verdict).toMatch(/jo_dev/);
    expect(viaProfile!.record?.facts).toEqual([['Name', 'Jo Rivers']]);
    expect(name.checks?.some((c) => c.result === 'confirms')).toBe(true);
    expect(xc.by('location', 'Austin, TX').evidence.some((e) => e.kind === 'cross')).toBe(true);
    // same source family as the direct hit would not be a second opinion, but this is a different family: score rises
    expect(name.score).toBeGreaterThan(base.by('person', 'Jo Rivers').score);
  });

  it('a profile with a different name and city counts AGAINST the username', async () => {
    const base = await lookup('baseline3', { crossCheck: false });
    const xc = await lookup('checked3', { crossCheck: true });
    const jo = xc.by('username', 'jo');
    const against = jo.evidence.filter((e) => e.polarity === 'against');
    expect(against.length).toBeGreaterThanOrEqual(1);
    expect(against[0].verdict).toMatch(/Stefan Brandt/);
    expect(against[0].verdict).toMatch(/does not match “Jo Rivers”/);
    expect(jo.checks?.some((c) => c.result === 'contradicts')).toBe(true);
    expect(jo.score).toBeLessThan(base.by('username', 'jo').score);
    expect(jo.reasons.join(' ')).toMatch(/contradict/);
  });

  it('records "checked, nothing there" without adding any evidence', async () => {
    const xc = await lookup('checked4', { crossCheck: true });
    const ghost = xc.by('username', 'ghost');
    expect(ghost.evidence.every((e) => e.kind !== 'cross')).toBe(true);
    expect(ghost.checks?.find((c) => c.source === 'Profile source')?.result).toBe('neutral');
  });

  it('can be switched off, and then makes no extra calls', async () => {
    const off = await lookup('checked5', { crossCheck: false });
    expect(calls.length).toBe(0);
    expect(off.fs.flatMap((f) => f.evidence).some((e) => e.kind === 'cross')).toBe(false);
    expect(off.events.some((e) => e.t === 'source' && e.progress.adapter === 'cross-check')).toBe(false);
  });

  it('stays within its budget however many findings there are', async () => {
    register(emailSource(30));
    const xc = await lookup('checked6', { crossCheck: true });
    expect(xc.fs.filter((f) => f.type === 'username').length).toBeGreaterThan(20);
    expect(new Set(calls).size).toBeLessThanOrEqual(8);   // MAX_CROSSCHECK candidates
    register(emailSource());
  });

  it('reports progress as its own step, finishing "done"', async () => {
    const xc = await lookup('checked7', { crossCheck: true });
    const last = [...xc.events].reverse().find((e) => e.t === 'source' && e.progress.adapter === 'cross-check') as Extract<RunEvent, { t: 'source' }>;
    expect(last.progress.state).toBe('done');
    expect(last.progress.capability).toBe('verify');
  });

  it('migrates a database that predates the checks column', () => {
    const s = new Store(join(process.env.PLEXUS_HOME!, 'old.db'));
    s.db.exec('DROP TABLE findings');
    s.db.exec(`CREATE TABLE findings (id TEXT PRIMARY KEY, case_id TEXT, run_id TEXT, subject_id TEXT, type TEXT, value TEXT, key TEXT, relation TEXT, attrs TEXT, evidence TEXT, score REAL, rank REAL, level INTEGER, reasons TEXT, status TEXT, conflict_key TEXT, conflicts_with TEXT, when_at TEXT, created_at INTEGER)`);
    s.close();
    expect(() => new Store(join(process.env.PLEXUS_HOME!, 'old.db'))).not.toThrow();
  });
});

describe('namesakes are never corroborated', () => {
  it('a profile belonging to a flagged namesake contradicts the handle instead of boosting the namesake', async () => {
    register({
      id: 'x-email-src', name: 'Email source', description: '', accepts: ['email' as const], capability: 'x-email', family: 'x-email', reliability: 0.8, priority: 1, selfTest: { type: 'email' as const, value: SUBJECT },
      run: async (): Promise<Claim[]> => [
        { type: 'person', value: 'Jo Rivers', relation: 'name on profile', weight: 0.8 },
        { type: 'person', value: 'Jo Rivera', relation: 'possible namesake', weight: 0.3 },
        { type: 'username', value: 'jorivera_ph', relation: 'handle', weight: 0.5 },
      ],
    });
    profiles.jorivera_ph = [{ type: 'person', value: 'Jo Rivera', relation: 'name on profile', weight: 0.8 }];
    const base = await lookup('ns-base', { crossCheck: false });
    const xc = await lookup('ns-checked', { crossCheck: true });
    const ns = xc.by('person', 'Jo Rivera');
    expect(ns.evidence.every((e) => e.kind !== 'cross')).toBe(true);                       // not boosted
    expect(ns.score).toBeCloseTo(base.by('person', 'Jo Rivera').score, 6);
    const handle = xc.by('username', 'jorivera_ph');
    expect(handle.evidence.some((e) => e.polarity === 'against' && /does not match “Jo Rivers”/.test(e.verdict ?? ''))).toBe(true);
    expect(handle.score).toBeLessThan(base.by('username', 'jorivera_ph').score);
    register(emailSource());
  });
});
