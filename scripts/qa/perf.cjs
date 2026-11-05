// Stress test: 700-node graph + 400-result sheet. Seed first:  npx tsx scripts/qa/seedbig.ts <empty PLEXUS_HOME dir>, then serve that home.
const { chromium } = require('playwright');
const SP = process.env.OUT || require('os').tmpdir();
(async () => {
  const b = await chromium.launch(); const errs = [];
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  const t0 = Date.now();
  await p.goto('http://127.0.0.1:4317/?debug'); await p.waitForFunction(() => window.__plexusEngine && window.__plexusEngine.nodes.length > 600, null, { timeout: 30000 });
  console.log('load → graph ready:', Date.now() - t0, 'ms');
  await p.waitForTimeout(1500);
  const m = await p.evaluate(() => {
    const e = window.__plexusEngine; const t = performance.now(); for (let i = 0; i < 30; i++) e.draw(performance.now()); const draw = (performance.now() - t) / 30;
    const pts = e.nodes.map((n) => [n.x, n.y]); let min = 1e9; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    return { nodes: e.nodes.length, links: e.links.length, drawMs: +draw.toFixed(2), minNodeDistance: Math.round(min), k: +e.cam.k.toFixed(3) };
  });
  console.log('graph:', JSON.stringify(m));
  await p.screenshot({ path: `${SP}/plexus-perf-graph.png` });
  // pan/zoom frame rate
  const fps = await p.evaluate(async () => { const e = window.__plexusEngine; let frames = 0; const t = performance.now(); return await new Promise((res) => { const tick = () => { e.zoomBy(frames % 2 ? 1.02 : 0.98); frames++; if (performance.now() - t > 1500) res(Math.round(frames / 1.5)); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }); });
  console.log('zoom/pan fps (700 nodes, 1200 links):', fps);
  // sheet with 400 findings
  const subj = await p.evaluate(() => window.__plexusStore.getState().snap.nodes[0].id);
  const t1 = Date.now();
  await p.evaluate((id) => window.__plexusStore.getState().openSheet(id), subj);
  await p.waitForSelector('.frow'); console.log('sheet w/ 400 findings first paint:', Date.now() - t1, 'ms; rows in DOM:', await p.locator('.frow').count());
  await p.waitForTimeout(800);
  const scrollFps = await p.evaluate(async () => { const el = document.querySelector('.list-scroll'); let frames = 0; const t = performance.now(); return await new Promise((res) => { const tick = () => { el.scrollTop += 40; frames++; if (performance.now() - t > 1500) res(Math.round(frames / 1.5)); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }); });
  console.log('sheet scroll fps:', scrollFps);
  const t2 = Date.now(); await p.keyboard.press('Shift+A').catch(() => {}); 
  await p.getByRole('button', { name: /Accept \d+ strong/ }).first().click(); await p.waitForTimeout(100);
  console.log('bulk accept ~200 → UI settled in ~', Date.now() - t2, 'ms');
  await p.screenshot({ path: `${SP}/plexus-perf-sheet.png` });
  console.log('errors:', errs.join('\n') || 'none'); await b.close();
})();
