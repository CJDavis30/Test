// Pure-ish helpers for the desktop shell. Kept free of Electron imports so they can be unit-tested anywhere.
const http = require('node:http');
const net = require('node:net');
const { execFile } = require('node:child_process');

/** Plexus needs Node >= 22.13 (stable node:sqlite). */
function nodeVersionOk(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]), minor = Number(m[2]);
  return major > 22 || (major === 22 && minor >= 13);
}

/** `git rev-list --left-right --count HEAD...@{u}` prints "<ahead>\t<behind>". */
function parseCounts(out) {
  const m = String(out).trim().match(/^(\d+)\s+(\d+)$/);
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : null;
}

function health(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs, headers: { host: `localhost:${port}` } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { const j = JSON.parse(body); resolve(j && j.app === 'Plexus' ? j : null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function waitForHealth(port, timeoutMs = 20000, alive = () => true) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!alive()) return null;
    const h = await health(port);
    if (h) return h;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function pickPort(preferred = 4317) {
  if (await portFree(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: 60000, ...opts }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(String(stdout)))));
}

/** Compares the checkout with its upstream. Network failures resolve to null (never block startup). */
async function checkForUpdate(repo, git = '/usr/bin/git') {
  try {
    await run(git, ['-C', repo, 'fetch', '--quiet'], { timeout: 25000 });
    const out = await run(git, ['-C', repo, 'rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    const c = parseCounts(out);
    if (!c) return null;
    const branch = (await run(git, ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const log = c.behind ? (await run(git, ['-C', repo, 'log', '--format=%s', '-n', '5', 'HEAD..@{u}']).catch(() => '')).trim().split('\n').filter(Boolean) : [];
    return { ...c, branch, log };
  } catch { return null; }
}

module.exports = { nodeVersionOk, parseCounts, health, waitForHealth, portFree, pickPort, checkForUpdate };
