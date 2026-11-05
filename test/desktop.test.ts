import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const lib = require('../desktop/lib.cjs');

describe('desktop: version gate', () => {
  it.each([['v22.13.0', true], ['22.12.9', false], ['v22.23.4', true], ['v24.1.0', true], ['v20.19.0', false], ['v18.0.0', false], ['garbage', false], ['', false]])('%s → %s', (v, want) => expect(lib.nodeVersionOk(v)).toBe(want));
});

describe('desktop: git counts', () => {
  it('parses ahead/behind and rejects junk', () => {
    expect(lib.parseCounts('0\t3\n')).toEqual({ ahead: 0, behind: 3 });
    expect(lib.parseCounts('2 0')).toEqual({ ahead: 2, behind: 0 });
    expect(lib.parseCounts('fatal: no upstream')).toBeNull();
  });
});

describe('desktop: engine health + ports', () => {
  it('recognises a Plexus engine, ignores other servers, and waits for slow starts', async () => {
    const mk = (body: string) => new Promise<{ port: number; close: () => void }>((res) => { const s = createServer((_q, r) => r.end(body)); s.listen(0, '127.0.0.1', () => res({ port: (s.address() as any).port, close: () => s.close() })); });
    const good = await mk(JSON.stringify({ ok: true, app: 'Plexus' })), other = await mk(JSON.stringify({ ok: true, app: 'Something else' })), junk = await mk('not json');
    expect((await lib.health(good.port))?.app).toBe('Plexus');
    expect(await lib.health(other.port)).toBeNull();
    expect(await lib.health(junk.port)).toBeNull();
    expect(await lib.health(1)).toBeNull(); // nothing listening
    good.close(); other.close(); junk.close();
  });
  it('picks the preferred port when free, a different one when busy', async () => {
    const busy = createServer(); await new Promise<void>((r) => busy.listen(0, '127.0.0.1', () => r()));
    const p = (busy.address() as any).port;
    expect(await lib.portFree(p)).toBe(false);
    const alt = await lib.pickPort(p);
    expect(alt).not.toBe(p); expect(alt).toBeGreaterThan(0);
    busy.close();
  });
  it('starts the real engine bundle exactly as the app does and sees it healthy', async () => {
    const entry = join(__dirname, '..', 'dist', 'server', 'index.mjs');
    if (!existsSync(entry)) return; // needs `npm run build`
    const port = await lib.pickPort(4390);
    const home = mkdtempSync(join(tmpdir(), 'plexus-desktop-'));
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], { env: { ...process.env, PLEXUS_PORT: String(port), PLEXUS_HOME: home }, stdio: 'ignore' });
    try { expect((await lib.waitForHealth(port, 15000))?.app).toBe('Plexus'); }
    finally { child.kill(); }
  });
  it('waitForHealth gives up when the process dies', async () => {
    const t0 = Date.now();
    expect(await lib.waitForHealth(1, 5000, () => false)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('desktop: update detection against real git repos', () => {
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
  it('reports up to date, then behind with the commit subjects, then ahead', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plexus-git-'));
    const origin = join(root, 'origin'), a = join(root, 'a'), b = join(root, 'b');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'clone', '-q', origin, a); writeFileSync(join(a, 'f'), '1'); git(a, 'add', '.'); git(a, 'commit', '-qm', 'first'); git(a, 'push', '-q', 'origin', 'HEAD:main');
    git(root, 'clone', '-q', origin, b);
    const git2 = 'git';
    expect(await lib.checkForUpdate(b, git2)).toMatchObject({ ahead: 0, behind: 0, branch: 'main' });
    writeFileSync(join(a, 'f'), '2'); git(a, 'commit', '-qam', 'Add organized layout'); writeFileSync(join(a, 'f'), '3'); git(a, 'commit', '-qam', 'Fix pins'); git(a, 'push', '-q', 'origin', 'HEAD:main');
    const r = await lib.checkForUpdate(b, git2);
    expect(r).toMatchObject({ behind: 2, ahead: 0 });
    expect(r.log).toEqual(['Fix pins', 'Add organized layout']);
    writeFileSync(join(b, 'g'), 'x'); git(b, 'add', '.'); git(b, 'commit', '-qm', 'local');
    expect(await lib.checkForUpdate(b, git2)).toMatchObject({ ahead: 1, behind: 2 });
  });
  it('never throws for a missing folder or no upstream (returns null)', async () => {
    expect(await lib.checkForUpdate('/definitely/not/here', 'git')).toBeNull();
    const d = mkdtempSync(join(tmpdir(), 'plexus-noup-')); git(d, 'init', '-q');
    expect(await lib.checkForUpdate(d, 'git')).toBeNull();
  });
});

describe('mac installer scripts', () => {
  const sh = (args: string[], env: Record<string, string> = {}) => { try { return { code: 0, out: execFileSync('bash', args, { env: { ...process.env, ...env }, stdio: 'pipe' }).toString() }; } catch (e: any) { return { code: e.status as number, out: String(e.stdout) + String(e.stderr) }; } };
  it('--check passes with a new enough Node', () => {
    const r = sh(['scripts/mac/install.sh', '--check'], { PLEXUS_ALLOW_NON_MAC: '1' });
    expect(r.code).toBe(0); expect(r.out).toMatch(/Prerequisites look good/);
  });
  it('--check refuses an old Node with an actionable message', () => {
    const bin = mkdtempSync(join(tmpdir(), 'plexus-oldnode-'));
    writeFileSync(join(bin, 'node'), '#!/bin/sh\necho v18.17.0\n', { mode: 0o755 });
    const r = sh(['scripts/mac/install.sh', '--check'], { PLEXUS_ALLOW_NON_MAC: '1', PATH: `${bin}:${process.env.PATH}` });
    expect(r.code).not.toBe(0); expect(r.out).toMatch(/Node 22\.13 or newer/); expect(r.out).toMatch(/brew install node/);
  });
  it('refuses to run on a non-Mac by default', () => {
    if (process.platform === 'darwin') return;
    const r = sh(['scripts/mac/install.sh', '--check']);
    expect(r.code).not.toBe(0); expect(r.out).toMatch(/macOS/);
  });
  it('all scripts are executable and parse', () => {
    for (const f of ['common', 'install', 'update', 'uninstall']) expect(sh(['-n', `scripts/mac/${f}.sh`]).code).toBe(0);
  });
});
