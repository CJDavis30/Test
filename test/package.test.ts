import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-pkg-'));
process.env.PLEXUS_DEMO_FAST = '1';
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { verifySignature, signer } = await import('../server/signing');
const { fingerprintOf } = await import('../server/integrity');
import type { RunEvent } from '../shared/types';

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>; let caseId: string;
const call = async (m: string, p: string, b?: unknown) => { const r = await ctx.app.request(p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, text: await r.text() }; };
const json = async (m: string, p: string, b?: unknown) => JSON.parse((await call(m, p, b)).text);

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'p.db'))); ctx.store.setSetting('demoMode', true);
  caseId = (await json('POST', '/api/cases', { name: 'Pkg <b>case</b>', purpose: 'test' })).case.id;
  const r = (await json('POST', `/api/cases/${caseId}/lookups`, { value: 'mara.linden@northwind-labs.example' })).run;
  await new Promise<void>((resolve) => { let off = () => {}; let f = false; off = ctx.hub.subscribe(r.id, (e: RunEvent) => { if (e.t === 'run.done') { f = true; off(); resolve(); } }); if (f) off(); });
  const fs = (await json('GET', `/api/cases/${caseId}/findings`)).findings.filter((x: any) => x.level >= 3);
  await json('POST', '/api/findings/review', { ids: fs.map((x: any) => x.id), status: 'accepted' });
}, 60_000);

const parts = (html: string) => {
  const grab = (id: string) => { const m = html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`)); return m![1]; };
  const raw = grab('plexus-payload');
  return { payloadText: JSON.stringify(JSON.parse(raw)), sig: JSON.parse(grab('plexus-signature')) }; // exactly what the page does: parse, then re-serialise
};

describe('signed evidence package', () => {
  it('is one self-contained file whose payload hash and signature verify with plain Node', async () => {
    const html = (await call('GET', `/api/cases/${caseId}/package`)).text;
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=/); expect(html).not.toMatch(/https?:\/\/[^"' ]+\.(js|css)/);   // nothing fetched
    const { payloadText, sig } = parts(html);
    const manifest = JSON.parse(sig.manifest);
    expect(createHash('sha256').update(payloadText).digest('hex')).toBe(manifest.payloadSha256);
    expect(verifySignature(sig.publicKey, sig.manifest, sig.signature)).toBe(true);
    expect(sig.keyFingerprint).toBe(signer().fingerprint);
  });
  it('detects any change to the evidence, the manifest or the key', async () => {
    const { payloadText, sig } = parts((await call('GET', `/api/cases/${caseId}/package`)).text);
    expect(createHash('sha256').update(payloadText.replace('confidence', 'CONFIDENCE').replace(/"score":0\.\d/, '"score":0.1')).digest('hex')).not.toBe(JSON.parse(sig.manifest).payloadSha256);
    expect(verifySignature(sig.publicKey, sig.manifest.replace('payloadSha256', 'payloadSha257'), sig.signature)).toBe(false);
    const other = Buffer.from(sig.publicKey, 'base64'); other[0] ^= 1;
    expect(verifySignature(other.toString('base64'), sig.manifest, sig.signature)).toBe(false);
    expect(verifySignature(sig.publicKey, sig.manifest, sig.signature.slice(0, -4) + 'AAAA')).toBe(false);
  });
  it("carries every evidence item's fingerprint, and each one recomputes from the quoted fields", async () => {
    const { payloadText } = parts((await call('GET', `/api/cases/${caseId}/package`)).text);
    const p = JSON.parse(payloadText); let n = 0;
    for (const f of p.findings) for (const e of f.evidence) { if (!e.hash) continue; n++; expect(fingerprintOf(e), `${f.label} / ${e.adapterName}`).toBe(e.hash); }
    expect(n).toBeGreaterThan(5);
    expect(p.integrity.auditOk).toBe(true);
  });
  it('contains nothing secret, escapes markup in case names, and keeps the signing key off the wire', async () => {
    ctx.store.setSetting('aiKey', 'sk-should-never-appear');
    const html = (await call('GET', `/api/cases/${caseId}/package`)).text;
    expect(html).not.toContain('sk-should-never-appear'); expect(html).not.toMatch(/PRIVATE KEY/);
    expect(html).not.toContain('<b>case</b>'); expect(html).toContain('\\u003cb\\u003ecase');
    expect(JSON.stringify(await json('GET', '/api/signing-key'))).not.toMatch(/PRIVATE/);
  });
  it('a redacted package hides names, quotes and links but is still signed', async () => {
    const html = (await call('GET', `/api/cases/${caseId}/package?redact=1`)).text;
    const { payloadText, sig } = parts(html);
    expect(payloadText).not.toContain('mara.linden@northwind'); expect(payloadText).toMatch(/"redacted":true/);
    expect(verifySignature(sig.publicKey, sig.manifest, sig.signature)).toBe(true);
  });
  it('uses one stable key across exports, stored with owner-only permissions', async () => {
    const a = parts((await call('GET', `/api/cases/${caseId}/package`)).text).sig.publicKey, b = parts((await call('GET', `/api/cases/${caseId}/package`)).text).sig.publicKey;
    expect(a).toBe(b);
    const { statSync } = await import('node:fs'); expect(statSync(join(process.env.PLEXUS_HOME!, 'signing.pem')).mode & 0o077).toBe(0);
  });
});

describe('the page\'s own SHA-256 matches the platform one', () => {
  it('on awkward lengths (so verification works even where WebCrypto is unavailable)', async () => {
    const html = (await call('GET', `/api/cases/${caseId}/package`)).text;
    const src = html.match(/function sha256js\(m\)\{[\s\S]*?\n/)![0].trim();
    const sha256js = new Function(`${src}; return sha256js;`)() as (m: Uint8Array) => string;
    for (const str of ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(1000), 'héllo ✓ 世界']) expect(sha256js(new TextEncoder().encode(str)), str.slice(0, 10)).toBe(createHash('sha256').update(str).digest('hex'));
  });
});
