import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-doc-'));
const { Store } = await import('../server/store');
const { classify, checkOne, doctor } = await import('../server/doctor');
const { RateLimitedError } = await import('../server/adapters/types');
const { adapter } = await import('../server/adapters/live/util');
import type { Adapter } from '../server/adapters/types';

const mk = (id: string, run: Adapter['run'], extra: Partial<Adapter> = {}): Adapter => adapter({ id, name: id, description: '', accepts: ['username'], capability: 'x', family: id, reliability: 0.8, selfTest: { type: 'username', value: 'x' }, run, ...extra });
const store = () => new Store(join(mkdtempSync(join(tmpdir(), 'plexus-doc1-')), 'p.db'));

describe('Source Doctor', () => {
  it('names what is wrong, in plain words', () => {
    expect(classify(new RateLimitedError()).status).toBe('rate');
    expect(classify(new Error('HTTP 403')).status).toBe('blocked');
    expect(classify(new Error('HTTP 401')).status).toBe('blocked');
    expect(classify(new Error('HTTP 404')).status).toBe('gone');
    expect(classify(new Error('getaddrinfo ENOTFOUND api.dead.example')).status).toBe('gone');
    expect(classify(new Error('Unexpected non-JSON response')).status).toBe('broken');
    expect(classify(new Error('HTTP 503')).status).toBe('down');
    expect(classify(new Error('Timed out after 25000ms')).status).toBe('down');
    expect(classify(new Error('fetch failed')).status).toBe('down');
    expect(classify(new Error('something odd')).status).toBe('broken');
    for (const e of ['HTTP 403', 'HTTP 404', 'HTTP 503', 'x']) expect(classify(new Error(e)).advice.length).toBeGreaterThan(20);
  });
  it('rates each source: working, quiet, or failing and why', async () => {
    const s = store();
    expect((await checkOne(s, mk('good', async () => [{ type: 'account', value: 'u', relation: 'r', weight: 0.5 }]))).status).toBe('ok');
    const quiet = await checkOne(s, mk('quiet', async () => [])); expect(quiet.status).toBe('quiet'); expect(quiet.advice).toMatch(/changed/);
    const dead = await checkOne(s, mk('dead', async () => { throw new Error('HTTP 404'); })); expect(dead.status).toBe('gone'); expect(dead.detail).toBe('HTTP 404');
    expect((await checkOne(s, mk('shut', async () => { throw new Error('HTTP 403'); }))).status).toBe('blocked');
  });
  it('does not run a keyed source without its key, and does not run the wide sweeps', async () => {
    const s = store(); let called = 0;
    const keyed = await checkOne(s, mk('needs-key', async () => { called++; return []; }, { requiresKey: 'needs-key' })); expect(keyed.status).toBe('needs_key'); expect(called).toBe(0);
    const wide = await checkOne(s, mk('wmn-sweep', async () => { called++; return []; })); expect(wide.status).toBe('skipped'); expect(called).toBe(0);
  });
  it('runs a whole list in the background, reports progress, and remembers the result', async () => {
    const s = store();
    const list = [mk('a', async () => [{ type: 'account', value: 'u', relation: 'r', weight: 0.5 }]), mk('b', async () => { throw new Error('HTTP 500'); }), mk('c', async () => [])];
    const st = doctor.start(s, { adapters: list, concurrency: 2 });
    expect(st.running).toBe(true); expect(st.total).toBe(3);
    for (let i = 0; i < 50 && doctor.state().running; i++) await new Promise((r) => setTimeout(r, 20));
    const done = doctor.state();
    expect(done.running).toBe(false); expect(done.done).toBe(3);
    expect(done.rows.map((r) => `${r.id}:${r.status}`)).toEqual(['a:ok', 'b:down', 'c:quiet']);
    expect(doctor.state(s).rows).toHaveLength(3);
    expect(s.getSetting<any>('doctor', null).rows).toHaveLength(3);
  });
});
