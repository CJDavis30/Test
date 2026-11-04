// Plexus desktop shell (Electron). Runs the local engine in-process and shows the UI in a native window.
//
//   npm run desktop        → build the UI, then launch the app
//   npm run dist:mac       → produce a signed-ready .dmg via electron-builder
//
// NOTE: this file has not been executed in the build sandbox (no macOS / no Electron binary available there).
// First thing to verify on a Mac: that `node:sqlite` loads inside Electron's bundled Node (needs Node >= 22.5).
const { app, BrowserWindow, shell, nativeTheme, Menu, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let server;
const PORT = 4317;

async function startEngine() {
  process.env.PLEXUS_HOME = process.env.PLEXUS_HOME || path.join(app.getPath('userData'), 'data');
  process.env.PLEXUS_PORT = String(PORT);
  // The engine is bundled to plain JS by `npm run build:server`.
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'server', 'index.mjs')).href);
  const { app: api } = await mod.createApp();
  if (!mod.serveApp) throw new Error('engine bundle is missing serveApp()');
  server = mod.serveApp(api, PORT);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar', visualEffectState: 'followWindow',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0b' : '#f6f6f7',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  // Never navigate the app window to anything but our own origin; open real links in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://localhost:${PORT}`)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.loadURL(`http://localhost:${PORT}/`);
}

app.whenReady().then(async () => {
  await startEngine();
  // Deny every permission request (camera, geolocation, notifications…); Plexus needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { try { server?.close(); } catch { /* shutting down */ } });
