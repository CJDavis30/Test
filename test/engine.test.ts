import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-test-'));
process.env.PLEXUS_DEMO_FAST = '1';

const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { register, allAdapters } = await import('../server/registry');
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

describe('untrusted source data', () => {
  it('strips non-http evidence URLs before they are stored or sent to the client', async () => {
    ctx.store.setSetting('demoMode', false);
    register({
      id: 't-evil', name: 'evil', description: '', accepts: ['domain' as const], capability: 'evil-cap', family: 'evil', reliability: 0.8, priority: 1,
      selfTest: { type: 'domain' as const, value: 'x.example' },
      run: async () => [{ type: 'domain', value: 'child.evil-test.example', relation: 'subdomain', weight: 0.8, url: 'javascript:alert(document.cookie)', snippet: '<img src=x onerror=alert(1)>' }],
    });
    const { events } = await runAndWait('evil-test.example', { type: 'domain' });
    const f = events.filter((e) => e.t === 'findings').flatMap((e: any) => e.findings).find((x: any) => x.value === 'child.evil-test.example');
    expect(f).toBeTruthy();
    expect(f.evidence[0].url).toBeUndefined();
    ctx.store.setSetting('demoMode', true);
  });
});

describe('learned trust & edge labels', () => {
  it('exposes learned trust per source and moves it with decisions', async () => {
    ctx.store.setSetting('demoMode', true);
    const before = (await call('GET', '/api/sources')).json.sources.find((s: any) => s.id === 'demo-broker');
    expect(before.trust).toBeCloseTo(before.reliability, 5);
    for (let i = 0; i < 12; i++) ctx.store.bumpFeedback('demo-broker', 'person', 'rejected');
    const after = (await call('GET', '/api/sources')).json.sources.find((s: any) => s.id === 'demo-broker');
    expect(after.trust).toBeLessThan(before.trust - 0.15);
    expect(after.decisions).toBeGreaterThanOrEqual(12);
  });
  it('relabels manual edges and rejects empty labels', async () => {
    const a = (await call('POST', `/api/cases/${caseId}/lookups`, { value: 'edge-a.example', type: 'domain', run: false })).json.node;
    const b = (await call('POST', `/api/cases/${caseId}/lookups`, { value: 'edge-b.example', type: 'domain', run: false })).json.node;
    const e = (await call('POST', `/api/cases/${caseId}/edges`, { from: a.id, to: b.id })).json.edge;
    expect((await call('PATCH', `/api/edges/${e.id}`, { label: '  same owner  ' })).status).toBe(200);
    expect(ctx.store.listEdges(caseId).find((x) => x.id === e.id)?.label).toBe('same owner');
    expect((await call('PATCH', `/api/edges/${e.id}`, { label: '   ' })).status).toBe(400);
  });
});

describe('evidence trail', () => {
  it('every piece of evidence records what was asked and what came back', async () => {
    ctx.store.setSetting('demoMode', true);
    const { node } = await runAndWait('mara.linden@northwind-labs.example', { type: 'email' });
    const fs = ctx.store.listFindings(caseId, { subjectId: node.id });
    expect(fs.length).toBeGreaterThan(5);
    for (const f of fs) for (const ev of f.evidence) {
      expect(ev.how, `${f.value} / ${ev.adapterName}`).toMatch(/mara\.linden@northwind-labs\.example/);
      expect(ev.snippet && ev.snippet.length > 8, `${f.value} / ${ev.adapterName} has no excerpt`).toBe(true);
    }
    // different kinds of source never return the same excerpt for the same finding
    for (const f of fs) { const q = f.evidence.map((e: any) => e.snippet); expect(new Set(q).size, `${f.value}: duplicated excerpts ${q.join(' | ')}`).toBe(q.length); }
  });
});

describe('records reach the evidence', () => {
  it('direct evidence carries the source record (title + fields) and is marked direct', async () => {
    ctx.store.setSetting('demoMode', true); ctx.store.cacheClear();
    const { node } = await runAndWait('mara.linden@northwind-labs.example', { type: 'email' });
    const ev = ctx.store.listFindings(caseId, { subjectId: node.id }).flatMap((f) => f.evidence).filter((e) => e.kind === 'direct');
    expect(ev.length).toBeGreaterThan(5);
    for (const e of ev) { expect(e.record?.title, e.adapterName).toBeTruthy(); expect(e.record!.facts.length, e.adapterName).toBeGreaterThanOrEqual(3); expect(e.record!.facts.every(([k, v]) => k && v)).toBe(true); }
  });
});

describe('evidence links', () => {
  it('uses the record page a source returns, else a page to repeat the lookup, and drops unsafe links', async () => {
    ctx.store.setSetting('demoMode', false); ctx.store.cacheClear();
    for (const a of allAdapters()) ctx.store.setSourceEnabled(a.id, false);
    register(
      { id: 'wayback', name: 'Web archive (Wayback Machine)', description: '', accepts: ['domain' as const], capability: 'link-test', family: 'wayback', reliability: 0.8, priority: 1, selfTest: { type: 'domain' as const, value: 'x.example' },
        run: async () => [{ type: 'url', value: 'https://links-test.example/about', relation: 'archived page', weight: 0.8 }, { type: 'url', value: 'https://links-test.example/team', relation: 'archived page', weight: 0.8, url: 'https://web.archive.org/web/2020/https://links-test.example/team' }, { type: 'url', value: 'https://links-test.example/evil', relation: 'archived page', weight: 0.8, url: 'javascript:alert(1)' }] } as any,
    );
    ctx.store.setSourceEnabled('wayback', true);
    const { node } = await runAndWait('links-test.example', { type: 'domain' });
    const fs = ctx.store.listFindings(caseId, { subjectId: node.id });
    const ev = (v: string) => fs.find((f) => f.value.endsWith(v))!.evidence[0];
    expect(ev('/about').url).toBe('https://web.archive.org/web/*/links-test.example/*');
    expect(ev('/about').urlKind).toBe('lookup');
    expect(ev('/team').url).toContain('web.archive.org/web/2020');
    expect(ev('/team').urlKind).toBe('record');
    expect(ev('/evil').urlKind).toBe('lookup');              // the javascript: link was discarded, the safe lookup page used instead
    expect(ev('/evil').url).not.toMatch(/^javascript:/);
    for (const a of allAdapters()) if (a.id !== 'wayback') ctx.store.setSourceEnabled(a.id, true);
    ctx.store.setSetting('demoMode', true);
  });
});

describe('reliability: a failing source is paused and the chain falls through', () => {
  it('skips a source after repeated failures and answers from the next one in its chain', async () => {
    const { breaker } = await import('../server/breaker');
    breaker.reset();
    let calls = 0;
    const base = { accepts: ['username'] as any, capability: 'flaky-test', requiresKey: false, minIntervalMs: 0, selfTest: { type: 'username' as const, value: 'x' }, anyMode: true, reliability: 0.8, cacheTtlMs: 0 };
    register({ ...base, id: 'flaky-a', name: 'Flaky A', description: 'always fails', family: 'fa', priority: 1, async run() { calls++; throw new Error('HTTP 503'); } } as any);
    register({ ...base, id: 'steady-b', name: 'Steady B', description: 'works', family: 'sb', priority: 2, async run() { return [{ type: 'org', value: 'Reliable Co', relation: 'works at', weight: 0.7 }]; } } as any);
    const { CAPABILITY_MODE } = await import('../server/adapters/types');
    CAPABILITY_MODE['flaky-test'] = 'first';
    ctx.store.setSetting('demoMode', false);
    // keep this test off the network: only the two fake sources may run
    const others = allAdapters().filter((x) => !['flaky-a', 'steady-b'].includes(x.id));
    for (const x of others) ctx.store.setSourceEnabled(x.id, false);
    try {
      let last: Awaited<ReturnType<typeof runAndWait>> | undefined;
      for (let i = 0; i < 4; i++) { last = await runAndWait(`flaky_user_${i}`, { type: 'username' }); }
      const src = (id: string) => (last!.events.filter((e) => e.t === 'source') as any[]).map((e) => e.progress).filter((p) => p.adapter === id).at(-1);
      expect(src('steady-b')?.state).toBe('done');                 // the fallback answered every time
      expect(src('flaky-a')?.state).toBe('skipped');               // and the broken one was no longer even tried
      expect(String(src('flaky-a')?.note)).toMatch(/Paused/);
      expect(calls).toBeLessThanOrEqual(12);                       // 3 failures x up to 3 attempts each, then nothing
      const info = (await call('GET', '/api/sources')).json.sources.find((s: any) => s.id === 'flaky-a');
      expect(info.pausedUntil).toBeGreaterThan(Date.now());
      await call('POST', '/api/sources/flaky-a/resume');
      expect((await call('GET', '/api/sources')).json.sources.find((s: any) => s.id === 'flaky-a').pausedUntil).toBeUndefined();
    } finally { for (const x of others) ctx.store.setSourceEnabled(x.id, true); ctx.store.setSetting('demoMode', true); delete CAPABILITY_MODE['flaky-test']; breaker.reset(); }
  }, 60_000);
});

describe('chaos: sources failing in every way at once', () => {
  it('a run still finishes, reports each source honestly, and keeps what the healthy ones found', async () => {
    const { breaker } = await import('../server/breaker'); breaker.reset();
    const { CAPABILITY_MODE } = await import('../server/adapters/types'); CAPABILITY_MODE['chaos-test'] = 'all';
    const base = { accepts: ['username'] as any, capability: 'chaos-test', requiresKey: false, minIntervalMs: 0, selfTest: { type: 'username' as const, value: 'x' }, anyMode: true, reliability: 0.8, cacheTtlMs: 0, family: 'x', priority: 1 };
    register({ ...base, id: 'chaos-throw', name: 'Throws', family: 'c1', description: 't', async run() { throw new Error('boom'); } } as any);
    register({ ...base, id: 'chaos-garbage', name: 'Garbage', family: 'c2', description: 't', async run() { return [null, undefined, 5, 'x', { type: 'nonsense', value: 1 }, { type: 'org', value: '', relation: 'x', weight: NaN }, { type: 'org', value: 'Survivor Inc', relation: 'works at', weight: 5 }] as any; } } as any);
    register({ ...base, id: 'chaos-good', name: 'Good', family: 'c3', description: 't', async run() { return [{ type: 'org', value: 'Survivor Inc', relation: 'works at', weight: 0.7 }]; } } as any);
    register({ ...base, id: 'chaos-reject', name: 'Rejects', family: 'c4', description: 't', async run() { return Promise.reject('a string, not an Error'); } } as any);
    ctx.store.setSetting('demoMode', false); ctx.store.setSetting('requirePurpose', false);
    const others = allAdapters().filter((x) => !x.id.startsWith('chaos-')); for (const x of others) ctx.store.setSourceEnabled(x.id, false);
    try {
      const { events } = await runAndWait('chaos_user', { type: 'username' });
      expect(events.at(-1)?.t).toBe('run.done');
      const last = (id: string) => (events.filter((e) => e.t === 'source') as any[]).map((e) => e.progress).filter((p) => p.adapter === id).at(-1);
      expect(last('chaos-throw').state).toBe('error'); expect(last('chaos-reject').state).toBe('error');
      expect(['done', 'empty', 'error']).toContain(last('chaos-garbage').state);
      const f = (events.filter((e) => e.t === 'findings') as any[]).flatMap((e) => e.findings).find((x: any) => x.value === 'Survivor Inc');
      expect(f).toBeTruthy(); expect(f.score).toBeLessThanOrEqual(0.99); expect(Number.isFinite(f.score)).toBe(true);
    } finally { for (const x of others) ctx.store.setSourceEnabled(x.id, true); ctx.store.setSetting('demoMode', true); delete CAPABILITY_MODE['chaos-test']; breaker.reset(); }
  }, 60_000);
});
