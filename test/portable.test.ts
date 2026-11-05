import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-port-'));
process.env.PLEXUS_DEMO_FAST = '1';
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
import type { RunEvent } from '../shared/types';

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>;
let caseId: string;
const raw = (m: string, p: string, b?: unknown) => ctx.app.request(p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) });
const call = async (m: string, p: string, b?: unknown) => ({ status: (await raw(m, p, b)).status, json: await (await raw(m, p, b)).json().catch(() => ({})) as any });
const get = async (m: string, p: string, b?: unknown) => { const r = await raw(m, p, b); return { status: r.status, json: await r.clone().json().catch(() => ({})) as any, text: await r.text() }; };

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'p.db')));
  ctx.store.setSetting('demoMode', true);
  caseId = (await get('POST', '/api/cases', { name: 'Source case', purpose: 'p' })).json.case.id;
  const r = (await get('POST', `/api/cases/${caseId}/lookups`, { value: 'mara.linden@northwind-labs.example' })).json;
  await new Promise<void>((resolve) => { let off: () => void = () => {}; let fin = false; off = ctx.hub.subscribe(r.run.id, (e: RunEvent) => { if (e.t === 'run.done') { fin = true; off(); resolve(); } }); if (fin) off(); });
  const fs = (await get('GET', `/api/cases/${caseId}/findings`)).json.findings;
  await get('POST', '/api/findings/review', { ids: fs.filter((f: any) => f.level >= 3).map((f: any) => f.id), status: 'accepted' });
  await get('POST', `/api/cases/${caseId}/commit`, {});
}, 60_000);

describe('export and import', () => {
  it('round-trips a case into a new one, with every fingerprint intact', async () => {
    const exp = (await get('GET', `/api/cases/${caseId}/export`)).json;
    const imp = (await get('POST', '/api/import', exp)).json;
    expect(imp.case.id).not.toBe(caseId);
    expect(imp.case.name).toMatch(/imported/);
    expect(imp.nodes).toBe(exp.nodes.length);
    expect(imp.findings).toBe(exp.findings.length);
    expect(imp.integrity.altered).toBe(0);
    expect(imp.integrity.checked).toBeGreaterThan(10);
    const verify = (await get('GET', `/api/cases/${imp.case.id}/integrity`)).json;
    expect(verify.audit.ok).toBe(true);
    expect(verify.evidence.altered).toEqual([]);
    // relationships survived, pointing at the new ids
    const snap = (await get('GET', `/api/cases/${imp.case.id}`)).json;
    const ids = new Set(snap.nodes.map((n: any) => n.id));
    expect(snap.edges.length).toBeGreaterThan(0);
    expect(snap.edges.every((e: any) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    const fs = (await get('GET', `/api/cases/${imp.case.id}/findings`)).json.findings;
    expect(fs.every((f: any) => ids.has(f.subjectId) && f.caseId === imp.case.id)).toBe(true);
  });
  it('importing twice makes two independent cases', async () => {
    const exp = (await get('GET', `/api/cases/${caseId}/export`)).json;
    const a = (await get('POST', '/api/import', exp)).json, b = (await get('POST', '/api/import', exp)).json;
    expect(a.case.id).not.toBe(b.case.id);
  });
  it('flags evidence that was edited in the file after export', async () => {
    const exp = (await get('GET', `/api/cases/${caseId}/export`)).json;
    const f = exp.findings.find((x: any) => x.evidence.some((e: any) => e.snippet));
    f.evidence.find((e: any) => e.snippet).snippet = 'Someone rewrote this quote';
    const imp = (await get('POST', '/api/import', exp)).json;
    expect(imp.integrity.altered).toBe(1);
    const verify = (await get('GET', `/api/cases/${imp.case.id}/integrity`)).json;
    expect(verify.evidence.altered.length).toBe(1);
  });
  it('rejects things that are not Plexus exports, and survives hostile ones', async () => {
    expect((await get('POST', '/api/import', { hello: 1 })).status).toBe(400);
    expect((await get('POST', '/api/import', [1, 2])).status).toBe(400);
    const res = await ctx.app.request('/api/import', { method: 'POST', headers: H, body: '{not json' });
    expect(res.status).toBe(400);
    const hostile = { plexus: 1, case: { name: '<img src=x onerror=alert(1)>' }, nodes: [{ id: 'a', type: 'person', value: 'Zed', label: 'Zed' }, { id: 'a2', type: 'bogus', value: 'x' }, null, 5], edges: [{ from: 'a', to: 'nope' }, null], findings: [{ id: 'f', type: 'person', value: 'Q', subjectId: 'a', evidence: 'not an array', score: 'NaN', level: 99, status: 'weird' }] };
    const r = await get('POST', '/api/import', hostile);
    expect(r.status).toBe(200);
    expect(r.json.nodes).toBe(1); expect(r.json.edges).toBe(0); expect(r.json.findings).toBe(1);
    const fs = (await get('GET', `/api/cases/${r.json.case.id}/findings`)).json.findings;
    expect(fs[0].level).toBe(1); expect(fs[0].status).toBe('pending'); expect(fs[0].score).toBe(0);
  });
});

describe('other exports', () => {
  it('writes well-formed GraphML', async () => {
    const r = await get('GET', `/api/cases/${caseId}/graphml`);
    expect(r.status).toBe(200);
    expect(r.text.startsWith('<?xml')).toBe(true);
    const snap = (await get('GET', `/api/cases/${caseId}`)).json;
    expect((r.text.match(/<node /g) ?? []).length).toBe(snap.nodes.length);
    expect((r.text.match(/<edge /g) ?? []).length).toBe(snap.edges.length);
    expect(r.text).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
  it('escapes markup in GraphML and HTML', async () => {
    const cid = (await get('POST', '/api/cases', { name: 'x<script>alert(1)</script>', purpose: '' })).json.case.id;
    await get('POST', `/api/cases/${cid}/lookups`, { value: 'a&b<c>.example', type: 'person', run: false });
    const g = (await get('GET', `/api/cases/${cid}/graphml`)).text;
    expect(g).not.toMatch(/<script>/);
    const h = (await get('GET', `/api/cases/${cid}/report.html`)).text;
    expect(h).not.toMatch(/<script>alert/);
    expect(h).toContain('&lt;script&gt;');
  });
  it('writes a printable HTML report containing the integrity section and fingerprints', async () => {
    const r = await get('GET', `/api/cases/${caseId}/report.html`);
    expect(r.text).toContain('<!doctype html>');
    expect(r.text).toContain('Method and integrity');
    expect(r.text).toMatch(/fingerprint [0-9a-f]{12}/);
    expect(r.text).toContain('@media print');
    const red = (await get('GET', `/api/cases/${caseId}/report.html?redact=1`)).text;
    expect(red).not.toContain('mara.linden@northwind');
  });
  it('writes CSV with formulas defanged', async () => {
    const cid = (await get('POST', '/api/cases', { name: 'csv', purpose: '' })).json.case.id;
    await get('POST', `/api/cases/${cid}/lookups`, { value: '=HYPERLINK("x")', type: 'person', run: false });
    const c = (await get('GET', `/api/cases/${cid}/csv`)).json;
    expect(c.entities).toContain(`"'=HYPERLINK`);
    expect(c.entities.split('\n')[0]).toContain('"type"');
  });
});

describe('redacted reports leak nothing', () => {
  it('masks the case name, purpose, notes, quotes and links', async () => {
    const cid = (await get('POST', '/api/cases', { name: 'jo@secret-corp.example', purpose: 'look into secret-corp.example' })).json.case.id;
    const n = (await get('POST', `/api/cases/${cid}/lookups`, { value: 'jo@secret-corp.example', type: 'email', run: false })).json.node;
    await get('PATCH', `/api/nodes/${n.id}`, { notes: 'phoned jo@secret-corp.example' });
    for (const url of [`/api/cases/${cid}/report?redact=1`, `/api/cases/${cid}/report.html?redact=1`]) {
      const r = await get('GET', url);
      expect(r.text, url).not.toMatch(/secret-corp/);
    }
  });
});

describe('search across cases', () => {
  it('finds an entity in any case, ignores case, escapes wildcards, and needs two characters', async () => {
    const a = (await get('POST', '/api/cases', { name: 'Case A', purpose: '' })).json.case.id;
    await get('POST', `/api/cases/${a}/lookups`, { value: 'Zebulon Quarrel', type: 'person', run: false });
    const hit = (await get('GET', '/api/search?q=zebulon')).json.hits;
    expect(hit.length).toBe(1); expect(hit[0]).toMatchObject({ caseId: a, caseName: 'Case A', label: 'Zebulon Quarrel' });
    expect((await get('GET', '/api/search?q=%25')).json.hits).toEqual([]); // a bare % must not match everything
    expect((await get('GET', '/api/search?q=z')).json.hits).toEqual([]);
    expect((await get('GET', '/api/search?q=nobody-by-this-name')).json.hits).toEqual([]);
  });
});
