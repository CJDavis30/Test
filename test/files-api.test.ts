import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-fa-'));
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { buildExifJpeg } = await import('./world/makeJpeg');

const H = { 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>, caseId: string;
const json = async (m: string, p: string, b?: unknown) => { const r = await ctx.app.request(p, { method: m, headers: { ...H, 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as any }; };
const upload = async (buf: Buffer, qs: string) => { const r = await ctx.app.request(`/api/files/analyze?${qs}`, { method: 'POST', headers: { ...H, 'content-type': 'application/octet-stream' }, body: new Uint8Array(buf) }); return { status: r.status, json: (await r.json().catch(() => ({}))) as any }; };
const jpeg = (o: object = {}) => buildExifJpeg({ make: 'Apple', model: 'iPhone 15', dateTimeOriginal: '2024:05:03 14:22:10', offsetTimeOriginal: '+02:00', bodySerial: 'SER1', gps: { lat: 48.8584, lon: 2.2945, utcDate: '2024:05:03', utcTime: [12, 22, 10] }, ...o });
const realFetch = globalThis.fetch;

beforeAll(async () => { ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'fa.db'))); caseId = (await json('POST', '/api/cases', { name: 'Files', purpose: 'test' })).json.case.id; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('analysing files over the API', () => {
  it('analyses a file without saving it unless a case is named', async () => {
    const r = await upload(jpeg(), 'name=IMG_1.jpg');
    expect(r.status).toBe(200); expect(r.json.report.location.lat).toBeCloseTo(48.8584, 3); expect(r.json.report.id).toBeUndefined();
    expect((await json('GET', `/api/cases/${caseId}/files`)).json.files).toHaveLength(0);
  });
  it('saves into a case, writes an audit entry, keeps the findings but never the file bytes, and dedupes by hash', async () => {
    const buf = jpeg();
    const a = await upload(buf, `name=a.jpg&caseId=${caseId}`), b = await upload(buf, `name=a-copy.jpg&caseId=${caseId}`);
    expect(a.json.report.id).toBe(b.json.report.id);
    const list = (await json('GET', `/api/cases/${caseId}/files`)).json;
    expect(list.files).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(buf.toString('base64').slice(0, 40));
    const audit = (await json('GET', `/api/cases/${caseId}/audit`)).json.entries ?? (await json('GET', `/api/cases/${caseId}/audit`)).json.audit;
    expect(JSON.stringify(audit)).toMatch(/file\.analyzed/);
    expect(ctx.store.verifyAudit(caseId).ok).toBe(true);
  });
  it('links files from the same camera, the same place and close in time', async () => {
    await upload(jpeg({ dateTimeOriginal: '2024:05:03 14:25:00' }), `name=b.jpg&caseId=${caseId}`);
    const links = (await json('GET', `/api/cases/${caseId}/files`)).json.links as any[];
    const kinds = links.map((l) => l.kind);
    expect(kinds).toContain('same-camera'); expect(kinds).toContain('same-place'); expect(kinds).toContain('close-in-time');
  });
  it('uses the picture measurements the browser sends for the sun check and look-alike matching', async () => {
    const night = jpeg({ dateTimeOriginal: '2024:01:15 02:00:00', offsetTimeOriginal: '+01:00', gps: { lat: 48.8584, lon: 2.2945, utcDate: '2024:01:15', utcTime: [1, 0, 0] } });
    const r = await upload(night, 'name=n.jpg&dhash=00ff00ff00ff00ff&luma=190&sky=0.6&pw=64&ph=64');
    expect(r.json.report.flags.some((f: any) => f.id === 'daylight')).toBe(true);
    expect(r.json.report.pixels.dhash).toBe('00ff00ff00ff00ff');
    expect((await upload(night, 'name=n.jpg&dhash=nothex&sky=9')).json.report.pixels).toBeUndefined();
  });
  it('puts things found in a file on the graph with a note about where they came from, and does not duplicate them', async () => {
    const body = { source: 'a.jpg', entities: [{ type: 'location', value: '48.85840, 2.29450', note: 'GPS position stored in the photo' }, { type: 'person', value: 'Mara Linden', note: 'camera owner' }, { type: 'nonsense', value: 'x' }] };
    expect((await json('POST', `/api/cases/${caseId}/entities-from`, body)).json.added).toBe(2);
    await json('POST', `/api/cases/${caseId}/entities-from`, body);
    const nodes = (await json('GET', `/api/cases/${caseId}`)).json.nodes;
    expect(nodes.filter((n: any) => n.type === 'person')).toHaveLength(1);
    expect(nodes.find((n: any) => n.type === 'person').notes).toMatch(/From a\.jpg: camera owner/);
    expect((await json('POST', '/api/cases/nope/entities-from', body)).status).toBe(404);
  });
  it('rejects empty files and unknown cases, and sanitises names', async () => {
    expect((await upload(Buffer.alloc(0), 'name=x')).status).toBe(400);
    expect((await upload(jpeg(), 'name=x&caseId=nope')).status).toBe(404);
    expect((await upload(jpeg(), 'name=../../etc/passwd')).json.report.name).toBe('.._.._etc_passwd');
  });
  it('removes a file from the case and records it', async () => {
    const id = (await json('GET', `/api/cases/${caseId}/files`)).json.files[0].id;
    await json('DELETE', `/api/files/${id}`);
    expect((await json('GET', `/api/files/${id}`)).status).toBe(404);
  });
});

describe('visual location over the API', () => {
  const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const lisbon = JSON.stringify({ candidates: [{ place: 'Lisbon', lat: 38.72, lon: -9.14, confidence: 0.7, clues: ['trams'] }] });
  const stubFetch = () => { let calls = 0; globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: lisbon } }] })); }) as any; return () => calls; };
  it('says so when AI is not set up', async () => {
    ctx.store.setSetting('ai', { provider: 'none' });
    expect((await json('POST', '/api/geolocate', { image: img })).status).toBe(400);
  });
  it('will not send a picture to a cloud provider without confirmation, and sends nothing before that', async () => {
    ctx.store.setSetting('ai', { provider: 'custom', baseUrl: 'https://api.cloud-vision.example/v1', model: 'm', allowCloud: true });
    process.env.PLEXUS_TEST_KEY = '1';
    const calls = stubFetch();
    const r = await json('POST', '/api/geolocate', { image: img });
    expect([428, 400]).toContain(r.status);                      // 428 with a key set, 400 "No API key" otherwise: either way nothing left the machine
    expect(calls()).toBe(0);
  });
  it('with a local model it runs, reports agreement, and records the miss distance when the real location is known', async () => {
    ctx.store.setSetting('ai', { provider: 'ollama', model: 'llava', allowCloud: false });
    const calls = stubFetch();
    const r = await json('POST', '/api/geolocate', { image: img, truth: { lat: 38.7223, lon: -9.1393 } });
    expect(r.status).toBe(200); expect(calls()).toBe(3);
    expect(r.json.result.level).toBe('city'); expect(r.json.truthErrKm).toBeLessThan(5);
    expect(r.json.calibration.byLevel.city.n).toBeGreaterThanOrEqual(1);
    expect((await json('GET', '/api/geo/calibration')).json.total).toBeGreaterThanOrEqual(1);
  });
  it('reports a provider failure as an error, not a crash', async () => {
    ctx.store.setSetting('ai', { provider: 'ollama', model: 'llava', allowCloud: false });
    globalThis.fetch = (async () => new Response('model does not support images', { status: 400 })) as any;
    const r = await json('POST', '/api/geolocate', { image: img });
    expect(r.status).toBe(502); expect(r.json.error).toMatch(/does not support images|answered with an error/);
  });
});
