// Plexus desktop shell (Electron, macOS).
//
// The engine (a small local web server) runs as a child process under your system Node, found at install time,
// because that is the Node the project is tested with. If that fails, it falls back to running in-process.
// The window only ever talks to http://localhost:<port>. See scripts/mac/ for install + update.
const { app, BrowserWindow, shell, nativeTheme, Menu, session, dialog, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const lib = require('./lib.cjs');

const ROOT = path.join(__dirname, '..');                       // the "runtime" directory (or the repo when run in dev)
const CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { return {}; } })();
const LOGDIR = path.join(app.getPath('home'), 'Library', 'Logs', 'Plexus');
const PREFERRED_PORT = 4317;

let child = null;
let inProcessServer = null;
let port = PREFERRED_PORT;
let win = null;
let quitting = false;

function log(msg) { try { fs.mkdirSync(LOGDIR, { recursive: true }); fs.appendFileSync(path.join(LOGDIR, 'desktop.log'), `${new Date().toISOString()} ${msg}\n`); } catch { /* logging is best effort */ } }

async function startEngine() {
  // Already running (e.g. a previous window crashed, or you started `npm start`)? Just use it.
  if (await lib.health(PREFERRED_PORT)) { port = PREFERRED_PORT; log('reusing engine already on 4317'); return; }
  port = await lib.pickPort(PREFERRED_PORT);
  const entry = path.join(ROOT, 'dist', 'server', 'index.mjs');
  if (!fs.existsSync(entry)) throw new Error(`Engine bundle missing: ${entry}. Run "npm run build".`);

  const nodeBin = CONFIG.node && fs.existsSync(CONFIG.node) ? CONFIG.node : process.env.PLEXUS_NODE || 'node';
  try {
    fs.mkdirSync(LOGDIR, { recursive: true });
    const out = fs.openSync(path.join(LOGDIR, 'engine.log'), 'a');
    child = spawn(nodeBin, ['--disable-warning=ExperimentalWarning', entry], {
      env: { ...process.env, PLEXUS_PORT: String(port), PATH: `${path.dirname(nodeBin)}:${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin` },
      stdio: ['ignore', out, out],
    });
    let exited = false;
    child.on('exit', (code) => { exited = true; child = null; log(`engine exited (${code})`); if (!quitting) dialog.showErrorBox('Plexus engine stopped', `The local engine exited unexpectedly (code ${code}). Details: ${path.join(LOGDIR, 'engine.log')}`); });
    child.on('error', (e) => { exited = true; log(`engine spawn error: ${e.message}`); });
    if (await lib.waitForHealth(port, 20000, () => !exited)) { log(`engine up on ${port} via ${nodeBin}`); return; }
    log('system-node engine did not come up; trying in-process');
    try { child?.kill(); } catch { /* already gone */ }
    child = null;
  } catch (e) { log(`spawn failed: ${e.message}`); }

  // Fallback: run inside Electron's own Node (needs node:sqlite support in that Electron build).
  process.env.PLEXUS_PORT = String(port);
  const mod = await import(pathToFileURL(entry).href);
  const { app: api } = await mod.createApp();
  inProcessServer = mod.serveApp(api, port);
  if (!(await lib.waitForHealth(port, 10000))) throw new Error('The Plexus engine could not start. See ~/Library/Logs/Plexus/.');
  log('engine up in-process');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640, show: false,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0b' : '#f6f6f7',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs'), spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  const origin = `http://localhost:${port}`;
  // The window may only ever show our own origin; real links open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.loadURL(`${origin}/`);
  win.on('closed', () => { win = null; });
}

// ---- updates ---------------------------------------------------------------------------------------------------
let checking = false;
async function updateFlow({ silent }) {
  if (checking) return;
  checking = true;
  try {
    if (!CONFIG.repo) { if (!silent) dialog.showMessageBox(win ?? undefined, { type: 'info', message: 'Updates aren’t set up for this install', detail: 'Reinstall with scripts/mac/install.sh to enable one-click updates.' }); return; }
    const r = await lib.checkForUpdate(CONFIG.repo);
    if (!r) { if (!silent) dialog.showMessageBox(win ?? undefined, { type: 'warning', message: 'Couldn’t check for updates', detail: 'Make sure you’re online and the source folder is still at:\n' + CONFIG.repo }); return; }
    if (!r.behind) { if (!silent) dialog.showMessageBox(win ?? undefined, { type: 'info', message: 'Plexus is up to date', detail: `Branch ${r.branch}${r.ahead ? ` · ${r.ahead} local change${r.ahead > 1 ? 's' : ''} not pushed` : ''}` }); return; }
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'info', buttons: ['Update and Restart', 'Later'], defaultId: 0, cancelId: 1,
      message: `An update is available (${r.behind} change${r.behind > 1 ? 's' : ''})`,
      detail: `${r.log.map((l) => `• ${l}`).join('\n')}\n\nPlexus will rebuild (about a minute) and reopen. Your cases are not touched.`,
    });
    if (response !== 0) return;
    const script = path.join(CONFIG.repo, 'scripts', 'mac', 'update.sh');
    fs.mkdirSync(LOGDIR, { recursive: true });
    const out = fs.openSync(path.join(LOGDIR, 'update.log'), 'a');
    spawn('/bin/bash', [script, '--relaunch'], { detached: true, stdio: ['ignore', out, out], env: { ...process.env, PATH: `${path.dirname(CONFIG.node || '/usr/local/bin/node')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` } }).unref();
    if (Notification.isSupported()) new Notification({ title: 'Updating Plexus…', body: 'It will reopen by itself.' }).show();
    app.quit();
  } finally { checking = false; }
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' }, { label: 'Check for Updates…', click: () => void updateFlow({ silent: false }) }, { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Open Logs Folder', click: () => shell.openPath(LOGDIR) }] },
  ]));
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); // Plexus needs no camera/location/etc.
    buildMenu();
    try { await startEngine(); }
    catch (e) { log(`fatal: ${e.message}`); dialog.showErrorBox('Plexus couldn’t start', `${e.message}\n\nLogs: ${LOGDIR}`); app.quit(); return; }
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
    // quiet daily check; only speaks up if there is something to install
    const stamp = path.join(app.getPath('userData'), 'last-update-check');
    let last = 0; try { last = Number(fs.readFileSync(stamp, 'utf8')) || 0; } catch { /* first run */ }
    if (Date.now() - last > 20 * 3600 * 1000) { try { fs.writeFileSync(stamp, String(Date.now())); } catch { /* ignore */ } setTimeout(() => void updateFlow({ silent: true }), 6000); }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; try { child?.kill(); } catch { /* gone */ } try { inProcessServer?.close(); } catch { /* gone */ } });
}
