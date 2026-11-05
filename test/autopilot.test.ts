import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-ap-'));
process.env.PLEXUS_DEMO_FAST = '1';
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { autoAcceptable, pivotCandidates } = await import('../server/autopilot');
import type { ApEvent, Finding } from '../shared/types';

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>;
let caseId: string;
const call = async (m: string, p: string, b?: unknown) => { const r = await ctx.app.request(p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as any }; };

const fnd = (o: Partial<Finding> & { fams?: string[] }): Finding => ({
  id: 'f', caseId: 'c', subjectId: 's', type: 'username', value: 'x', key: 'x', relation: 'username', attrs: {}, score: 0.9, rank: 0.9, level: 4, reasons: [], status: 'pending', createdAt: 0,
  evidence: (o.fams ?? ['a', 'b']).map((fam, i) => ({ id: 'e' + i, adapter: fam, adapterName: fam, family: fam, retrievedAt: 0, weight: 0.8 })), ...o,
} as Finding);

describe('autopilot acceptance policy', () => {
  it('accepts strong, independently confirmed, undisputed findings', () => {
    expect(autoAcceptable(fnd({})).ok).toBe(true);
    expect(autoAcceptable(fnd({ level: 3, score: 0.8, fams: ['a', 'b'] })).ok).toBe(true);
  });
  it('refuses anything that needs a human', () => {
    expect(autoAcceptable(fnd({ level: 3, score: 0.68, fams: ['a', 'b'] })).ok).toBe(false); // good, but not good enough to act on unseen
    expect(autoAcceptable(fnd({ level: 3, score: 0.8, fams: ['a'] })).ok).toBe(false);
    expect(autoAcceptable(fnd({ fams: ['a'] })).ok).toBe(false);                          // one source, however sure
    expect(autoAcceptable(fnd({ conflictsWith: ['other'] })).ok).toBe(false);             // a rival answer exists
    expect(autoAcceptable(fnd({ relation: 'possible namesake' })).ok).toBe(false);        // a guess by nature
    expect(autoAcceptable(fnd({ relation: 'similar handle' })).ok).toBe(false);
    expect(autoAcceptable(fnd({ status: 'rejected' })).ok).toBe(false);                   // never overrides a human
    const contradicted = fnd({}); contradicted.evidence.push({ ...contradicted.evidence[0], id: 'x', polarity: 'against' } as any);
    expect(autoAcceptable(contradicted).ok).toBe(false);
  });
  it('only follows identifiers, and never bare names beyond the start', () => {
    const list = [fnd({ type: 'person', key: 'a', value: 'A', score: 0.99 }), fnd({ type: 'username', key: 'u', value: 'u', score: 0.9 }), fnd({ type: 'domain', key: 'd', value: 'd', score: 0.95 }), fnd({ type: 'org', key: 'o', value: 'O', score: 0.97 })];
    expect(pivotCandidates(list, 0, new Set(), 'email').map((f) => f.type)).toEqual(['org', 'domain', 'username']);
    expect(pivotCandidates(list, 1, new Set(), 'email').map((f) => f.type)).toEqual(['domain', 'username']);
    expect(pivotCandidates(list, 0, new Set(['username:u']), 'email').map((f) => f.type)).not.toContain('username');
  });
});

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'ap.db')));
  ctx.store.setSetting('demoMode', true);
  caseId = (await call('POST', '/api/cases', { name: 'AP', purpose: '' })).json.case.id;
});

async function runAutopilot(body: object) {
  const r = await call('POST', `/api/cases/${caseId}/autopilot`, body);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  const events: ApEvent[] = [];
  await new Promise<void>((resolve) => { const off = ctx.autopilot.subscribe(r.json.id, (e: ApEvent) => { events.push(e); if (e.t === 'ap.done' || e.t === 'ap.error') resolve(); }); void off; });
  return { id: r.json.id as string, events };
}

describe('autopilot end to end (demo world)', () => {
  it('builds the graph from one email, follows leads, and leaves the doubtful for review', async () => {
    const { events } = await runAutopilot({ value: 'mara.linden@northwind-labs.example', type: 'email' });
    const done = events.find((e) => e.t === 'ap.done') as Extract<ApEvent, { t: 'ap.done' }>;
    expect(done, JSON.stringify(events.at(-1))).toBeTruthy();
    expect(done.summary.subjects).toBeGreaterThanOrEqual(3);      // seed + at least two followed leads
    expect(done.summary.subjects).toBeLessThanOrEqual(8);
    expect(done.summary.accepted).toBeGreaterThan(5);
    expect(done.summary.nodes).toBeGreaterThan(6);
    expect(done.summary.pending).toBeGreaterThan(0);               // the weak and disputed were not decided for you
    const t = events.map((e) => e.t);
    expect(t[0]).toBe('ap.start'); expect(t).toContain('ap.accepted'); expect(t).toContain('ap.graph');
    // it never accepted a trap, a guess or anything disputed
    const fs = ctx.store.listFindings(caseId);
    const accepted = fs.filter((f) => f.status === 'accepted');
    for (const trap of ['Mara Lindqvist', 'mlinden', 'Lisbon, Portugal', 'mara.linden']) expect(accepted.map((f) => f.value), trap).not.toContain(trap);
    expect(accepted.every((f) => autoAcceptable({ ...f, status: 'pending' }).ok)).toBe(true);
    expect(fs.filter((f) => f.status === 'pending').length).toBe(done.summary.pending - ctx.store.listFindings(caseId, { status: ['unsure'] }).length);
    // and it is auditable
    const audit = ctx.store.listAudit(caseId).map((a) => a.action);
    expect(audit).toContain('autopilot.started'); expect(audit).toContain('autopilot.accepted'); expect(audit).toContain('autopilot.finished');
    expect(ctx.store.verifyAudit(caseId).ok).toBe(true);
  }, 120_000);

  it('can be stopped, and says so', async () => {
    const r = await call('POST', `/api/cases/${caseId}/autopilot`, { value: 'northwind-labs.example', type: 'domain', depth: 3, subjects: 20 });
    expect(r.status).toBe(200);
    const events: ApEvent[] = [];
    const finished = new Promise<void>((resolve) => { ctx.autopilot.subscribe(r.json.id, (e: ApEvent) => { events.push(e); if (e.t === 'ap.step') ctx.autopilot.stop(r.json.id); if (e.t === 'ap.done' || e.t === 'ap.error') resolve(); }); });
    await finished;
    const done = events.find((e) => e.t === 'ap.done') as Extract<ApEvent, { t: 'ap.done' }>;
    expect(done.summary.stopped).toBe(true);
    expect(done.summary.subjects).toBeLessThanOrEqual(2);
  }, 60_000);

  it('refuses to start a second run on the same case while one is active', async () => {
    const a = await call('POST', `/api/cases/${caseId}/autopilot`, { value: 'maralinden', type: 'username', subjects: 1 });
    expect(a.status).toBe(200);
    const b = await call('POST', `/api/cases/${caseId}/autopilot`, { value: 'maralinden', type: 'username' });
    expect(b.status).toBe(409);
    await new Promise<void>((resolve) => { ctx.autopilot.subscribe(a.json.id, (e: ApEvent) => { if (e.t === 'ap.done' || e.t === 'ap.error') resolve(); }); });
  }, 60_000);

  it('validates its input', async () => {
    expect((await call('POST', `/api/cases/${caseId}/autopilot`, {})).status).toBe(400);
    expect((await call('POST', `/api/cases/nope/autopilot`, { value: 'x' })).status).toBe(404);
  });
});

describe('autopilot: undo and dry run', () => {
  it('a dry run changes nothing and reports what it would have accepted', async () => {
    const before = { n: ctx.store.listNodes(caseId).length, accepted: ctx.store.listFindings(caseId, { status: ['accepted'] }).length };
    const { events } = await runAutopilot({ value: 'northwind-labs.example', type: 'domain', dryRun: true });
    const done = events.find((e) => e.t === 'ap.done') as Extract<ApEvent, { t: 'ap.done' }>;
    expect(done.summary.dryRun).toBe(true); expect(done.summary.accepted).toBeGreaterThan(0);
    expect(ctx.store.listFindings(caseId, { status: ['accepted'] }).length).toBe(before.accepted);
    expect(ctx.store.listNodes(caseId).length).toBeLessThanOrEqual(before.n + 1); // at most the seed itself
    expect(ctx.store.listAudit(caseId).some((a) => a.action === 'autopilot.dryrun')).toBe(true);
  }, 90_000);

  it('undo puts back exactly what the run accepted, leaves a human decision alone, and works once', async () => {
    const c2 = (await call('POST', '/api/cases', { name: 'AP2', purpose: '' })).json.case.id;
    const r0 = await call('POST', `/api/cases/${c2}/lookups`, { value: 'maralinden', type: 'username', run: false });
    // a decision the user made before Autopilot ran
    const r = await call('POST', `/api/cases/${c2}/autopilot`, { nodeId: r0.json.node.id, depth: 0, subjects: 1 });
    await new Promise<void>((resolve) => { ctx.autopilot.subscribe(r.json.id, (e: ApEvent) => { if (e.t === 'ap.done' || e.t === 'ap.error') resolve(); }); });
    const accepted = ctx.store.listFindings(c2, { status: ['accepted'] });
    const nodesAfter = ctx.store.listNodes(c2).length;
    expect(accepted.length).toBeGreaterThan(0); expect(nodesAfter).toBeGreaterThan(1);
    // the user also accepts something by hand after the run
    const manual = ctx.store.listFindings(c2, { status: ['pending'] })[0];
    ctx.svc.review([manual.id], 'accepted');
    const u = await call('POST', `/api/autopilot/${r.json.id}/undo`);
    expect(u.status).toBe(200); expect(u.json.findings).toBe(accepted.length);
    expect(ctx.store.listFindings(c2, { status: ['accepted'] }).map((f) => f.id)).toEqual([manual.id]); // only the human's own decision remains
    expect(ctx.store.listNodes(c2).length).toBeLessThan(nodesAfter);
    expect((await call('POST', `/api/autopilot/${r.json.id}/undo`)).status).toBe(409);
    expect(ctx.store.listAudit(c2).some((a) => a.action === 'autopilot.undone')).toBe(true);
    expect(ctx.store.verifyAudit(c2).ok).toBe(true);
  }, 90_000);
});
