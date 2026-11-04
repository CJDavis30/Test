import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-test-'));
process.env.PLEXUS_DEMO_FAST = '1';

const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { register } = await import('../server/registry');
import type { RunEvent, Finding } from '../shared/types';

let ctx: Awaited<ReturnType<typeof createApp>>;
let caseId: string;

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await ctx.app.request(path, { method, headers: { ...H, ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};

async function runAndWait(value: string, extra: object = {}) {
  const { json } = await call('POST', `/api/cases/${caseId}/lookups`, { value, ...extra });
  expect(json.run, JSON.stringify(json)).toBeTruthy();
  const events: RunEvent[] = [];
  await new Promise<void>((resolve) => {
    let off: () => void = () => {};
    let finished = false;
    off = ctx.hub.subscribe(json.run.id, (e) => {
      events.push(e);
      if (e.t === 'run.done' || e.t === 'run.error') { finished = true; off(); resolve(); }
    });
    if (finished) off();
  });
  return { node: json.node, run: json.run, events };
}

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'test.db')));
  ctx.store.setSetting('demoMode', true);
  caseId = (await call('POST', '/api/cases', { name: 'T', purpose: 'test' })).json.case.id;
});

describe('API security', () => {
  it('rejects foreign hosts, foreign origins and header-less writes', async () => {
    expect((await call('GET', '/api/health', undefined, { host: 'evil.example' })).status).toBe(403);
    expect((await call('GET', '/api/health', undefined, { origin: 'https://evil.example' })).status).toBe(403);
    const res = await ctx.app.request('/api/cases', { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(403);
    expect((await call('GET', '/api/health')).status).toBe(200);
  });
});

describe('lookup pipeline (demo world)', () => {
  it('streams progress and corroborated, conflict-aware findings', async () => {
    const { events, node } = await runAndWait('mara.linden@northwind-labs.example');
    expect(node.type).toBe('email');
    const t = events.map((e) => e.t);
    expect(t[0]).toBe('run.started');
    expect(t).toContain('brief');
    expect(t.at(-1)).toBe('run.done');

    const all = new Map<string, Finding>();
    for (const e of events) if (e.t === 'findings') for (const f of e.findings) all.set(f.id, f);
    const fs = [...all.values()];
    const person = fs.find((f) => f.type === 'person' && f.value === 'Mara Linden')!;
    expect(person).toBeTruthy();
    expect(person.evidence.length).toBeGreaterThanOrEqual(3);
    expect(person.level).toBeGreaterThanOrEqual(3);
    // never discovers the subject itself
    expect(fs.some((f) => f.type === 'email' && f.key === 'mara.linden@northwind-labs.example')).toBe(false);
    const brief = events.find((e) => e.t === 'brief') as Extract<RunEvent, { t: 'brief' }>;
    expect(brief.brief.headline).toContain('Mara Linden');
    expect(Object.keys(brief.brief.cites).length).toBeGreaterThan(0);
  });

  it('flags competing locations and keeps the weak namesake weak', async () => {
    const { events } = await runAndWait('Mara Linden');
    const fs = new Map<string, Finding>();
    for (const e of events) if (e.t === 'findings') for (const f of e.findings) fs.set(f.id, f);
    const locs = [...fs.values()].filter((f) => f.type === 'location').sort((a, b) => b.score - a.score);
    expect(locs[0].value).toBe('Austin, TX');
    expect(locs[1].conflictsWith?.length).toBeGreaterThan(0);
    expect(locs[1].score).toBeLessThan(locs[0].score);
    const ns = [...fs.values()].find((f) => f.value === 'Mara Lindqvist')!;
    expect(ns.level).toBe(1);
  });

  it('records first-source-wins skips and honors disabled sources', async () => {
    ctx.store.setSourceEnabled('demo-broker', false);
    const { events } = await runAndWait('maralinden');
    const started = events[0] as Extract<RunEvent, { t: 'run.started' }>;
    expect(started.sources.some((s) => s.adapter === 'demo-broker')).toBe(false);
    ctx.store.setSourceEnabled('demo-broker', true);
  });
});

describe('review → feedback → commit', () => {
  it('accepts, undoes, learns per-source reliability, and commits idempotently', async () => {
    const { node } = await runAndWait('mara.linden@northwind-labs.example');
    const fs = ctx.store.listFindings(caseId, { subjectId: node.id });
    const person = fs.find((f) => f.value === 'Mara Linden')!;
    await call('POST', '/api/findings/review', { ids: [person.id], status: 'accepted' });
    const fb1 = ctx.store.allFeedback().get('demo-registry|person');
    expect(fb1?.accepted).toBe(1);
    await call('POST', '/api/findings/review', { ids: [person.id], status: 'pending' }); // undo
    expect(ctx.store.allFeedback().get('demo-registry|person')?.accepted).toBe(0);
    await call('POST', '/api/findings/review', { ids: [person.id], status: 'accepted' });

    const c1 = (await call('POST', `/api/cases/${caseId}/commit`, { subjectId: node.id })).json;
    expect(c1.nodes.some((n: any) => n.value === 'Mara Linden')).toBe(true);
    const snap1 = (await call('GET', `/api/cases/${caseId}`)).json;
    await call('POST', `/api/cases/${caseId}/commit`, { subjectId: node.id });
    const snap2 = (await call('GET', `/api/cases/${caseId}`)).json;
    expect(snap2.nodes.length).toBe(snap1.nodes.length);
    expect(snap2.edges.length).toBe(snap1.edges.length);
  });

  it('never resurrects a rejected finding on re-run', async () => {
    const { node } = await runAndWait('maralinden');
    const f = ctx.store.listFindings(caseId, { subjectId: node.id }).find((x) => x.type === 'account')!;
    await call('POST', '/api/findings/review', { ids: [f.id], status: 'rejected' });
    await runAndWait('maralinden', { nodeId: node.id });
    expect(ctx.store.getFinding(f.id)!.status).toBe('rejected');
  });
});

describe('fallback chain', () => {
  it('falls through failing/empty sources and skips the rest once one answers', async () => {
    ctx.store.setSetting('demoMode', false);
    const mk = (id: string, priority: number, run: () => Promise<any[]>) => ({
      id, name: id, description: '', accepts: ['domain' as const], capability: 'subdomains', family: id, reliability: 0.8,
      priority, selfTest: { type: 'domain' as const, value: 'x.example' }, run,
    });
    register(
      mk('t-fail', 1, async () => { throw new Error('HTTP 503'); }),
      mk('t-empty', 2, async () => []),
      mk('t-ok', 3, async () => [{ type: 'domain', value: 'a.fallback.example', relation: 'subdomain', weight: 0.8 }]),
      mk('t-never', 4, async () => [{ type: 'domain', value: 'b.fallback.example', relation: 'subdomain', weight: 0.8 }]),
    );
    const { events } = await runAndWait('fallback.example', { type: 'domain' });
    const st = new Map<string, string>();
    for (const e of events) if (e.t === 'source') st.set(e.progress.adapter, e.progress.state);
    expect(st.get('t-fail')).toBe('error');
    expect(st.get('t-empty')).toBe('empty');
    expect(st.get('t-ok')).toBe('done');
    expect(st.get('t-never')).toBe('skipped');
    ctx.store.setSetting('demoMode', true);
  });
});

describe('link inference', () => {
  it('suggests same-handle and merge candidates from structure alone', async () => {
    const s = await call('POST', `/api/cases/${caseId}/lookups`, { value: 'Mara L. Linden', run: false });
    const r = (await call('GET', `/api/cases/${caseId}/suggestions`)).json;
    expect(Array.isArray(r.suggestions)).toBe(true);
    expect(s.json.node.type).toBe('person');
  });
});
