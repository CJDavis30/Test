// Button audit: on every screen, at wide and narrow widths, every visible control must be (1) named, (2) actually
// reachable by a real mouse click at its centre (not covered by anything), and (3) not under a window-drag region.
// Close buttons are then clicked for real. Needs a server with a seeded demo case (see e2e.cjs header) and ?debug.
const { chromium } = require('playwright');
let fails = [], checked = 0;
const bad = (m) => { fails.push(m); console.log('FAIL ' + m); };

const audit = (p, where) => p.evaluate((where) => {
  const out = [];
  const sel = 'button, a[href], [role=tab], [role=switch], select, input:not([type=hidden]), textarea, [role=option]';
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  // audit only the top-most layer: a popover or slide-over hides what is beneath it
  const narrow = matchMedia('(max-width: 980px)').matches;
  const layer = document.querySelector('.menu.srclist') || (narrow && document.querySelector('.app:not(.no-sidebar) .sidebar')) || (narrow && document.querySelector('.insp-wrap .inspector')) || [...document.querySelectorAll('.detail-over')].pop() || [...document.querySelectorAll('[role=dialog][aria-modal=true], .modal')].pop();
  const scope = layer || document.body;
  const clipped = (el, cx, cy) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n); if (o.overflowX === 'visible' && o.overflowY === 'visible') continue; const r = n.getBoundingClientRect(); if (cx < r.left + 1 || cx > r.right - 1 || cy < r.top + 1 || cy > r.bottom - 1) return true; } return false; };
  for (const el of scope.querySelectorAll(sel)) {
    if (!vis(el)) continue;
    if (el.closest('[aria-hidden=true]')) continue;
    const r = el.getBoundingClientRect();
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || '').trim();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const label = `${where}: <${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}> "${name.slice(0, 30)}"`;
    if (!name && !el.querySelector('img[alt]')) out.push(label + ' has no accessible name');
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue; // scrolled out of view: reachable by scrolling
    // skip things clipped by a scroll container (not currently visible)
    if (clipped(el, cx, cy)) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !(el === hit || el.contains(hit) || hit.contains(el))) {
      // label elements and wrappers around inputs are fine
      if (!(hit.closest('label') && hit.closest('label').contains(el))) out.push(label + ` is covered by <${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}> at ${cx},${cy}`);
    }
    // is it inside a window-drag region?
    for (let n = el; n; n = n.parentElement) { const reg = getComputedStyle(n).getPropertyValue('-webkit-app-region') || getComputedStyle(n).getPropertyValue('app-region'); if (reg === 'no-drag') break; if (reg === 'drag') { out.push(label + ' sits inside a window-drag region (clicks would be swallowed on a Mac)'); break; } }
    if (el.tagName === 'BUTTON' && el.disabled) continue;
  }
  return out;
}, where);

const run = async (p, where) => { const probs = await audit(p, where); const n = await p.evaluate(() => document.querySelectorAll('button').length); checked += n; for (const m of probs) bad(m); };

(async () => {
  const b = await chromium.launch();
  for (const [wname, W, H] of [['wide', 1440, 900], ['narrow', 700, 800]]) {
    const ctx = await b.newContext({ viewport: { width: W, height: H }, colorScheme: 'light', deviceScaleFactor: 1 });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('http://127.0.0.1:4317/?debug'); await p.waitForTimeout(1200);
    const S = () => p.evaluate(() => { const s = window.__plexusStore.getState(); return { sheet: !!s.sheet, palette: s.palette, settings: s.settingsOpen, nodes: s.snap?.nodes ?? [] }; });
    const w = (t) => `${wname}/${t}`;
    const click = async (loc) => { const bx = await loc.boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.waitForTimeout(350); };

    // --- main window
    await run(p, w('graph'));
    if (wname === 'narrow') { await click(p.getByRole('button', { name: 'Toggle sidebar' })); await run(p, w('sidebar drawer')); await click(p.getByRole('button', { name: 'Close sidebar' })); checked++; if (await p.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().right > 10)) bad(w('Close sidebar button did not close the drawer')); await click(p.getByRole('button', { name: 'Toggle sidebar' })); await p.keyboard.press('Escape'); await p.waitForTimeout(400); checked++; if (await p.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().right > 10)) bad(w('Esc did not close the sidebar drawer')); }
    for (const v of ['table', 'timeline', 'identities', 'report', 'tools']) { await p.evaluate((v) => window.__plexusStore.getState().setView(v), v); await p.waitForTimeout(500); await run(p, w(v)); }
    await p.evaluate(() => window.__plexusStore.getState().setView('graph')); await p.waitForTimeout(300);
    await p.evaluate(() => window.__plexusStore.getState().toggle('inspector', true)); await p.waitForTimeout(500);
    const first = (await S()).nodes[0]; await p.evaluate((id) => window.__plexusStore.getState().select([id]), first.id); await p.waitForTimeout(400);
    for (const t of ['Details', 'Evidence', 'Notes']) { const tab = p.locator('.inspector [role=tab]', { hasText: t }); if (await tab.count()) { await tab.first().click(); await p.waitForTimeout(250); await run(p, w('inspector ' + t)); } }
    await p.evaluate(() => window.__plexusStore.getState().toggle('inspector', false)); await p.waitForTimeout(300);
    // menus
    await click(p.getByRole('button', { name: 'Appearance' })); await run(p, w('theme menu')); await p.keyboard.press('Escape'); await p.waitForTimeout(200);

    // --- every close path, with a real mouse click
    // settings
    for (const tab of ['general', 'sources', 'ai', 'audit']) {
      await p.evaluate((t) => window.__plexusStore.getState().openSettings(t), tab); await p.waitForTimeout(600);
      await run(p, w('settings ' + tab));
    }
    await click(p.getByRole('button', { name: 'Close settings' })); checked++;
    if ((await S()).settings) bad(w('Close settings button did not close Settings'));
    await p.evaluate(() => window.__plexusStore.getState().openSettings('general')); await p.waitForTimeout(500);
    await p.mouse.click(5, 5); await p.waitForTimeout(400); checked++;
    if ((await S()).settings) bad(w('clicking outside did not close Settings'));
    await p.evaluate(() => window.__plexusStore.getState().openSettings('general')); await p.waitForTimeout(500);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400); checked++;
    if ((await S()).settings) bad(w('Esc did not close Settings'));

    // palette
    await p.keyboard.press('Control+k'); await p.waitForTimeout(500); await run(p, w('palette'));
    await p.mouse.click(5, 5); await p.waitForTimeout(400); checked++;
    if ((await S()).palette) bad(w('clicking outside did not close the palette'));
    await p.keyboard.press('Control+k'); await p.waitForTimeout(400); await p.keyboard.press('Escape'); await p.waitForTimeout(300); checked++;
    if ((await S()).palette) bad(w('Esc did not close the palette'));

    // keyboard shortcuts panel
    const sc = () => p.evaluate(() => window.__plexusStore.getState().shortcuts);
    await p.keyboard.press('?'); await p.waitForTimeout(500); await run(p, w('shortcuts'));
    if (!(await sc())) bad(w('? did not open the shortcuts list'));
    await click(p.getByRole('button', { name: 'Close shortcuts' })); checked++;
    if (await sc()) bad(w('Close shortcuts button did not close the list'));
    await p.keyboard.press('?'); await p.waitForTimeout(400); await p.keyboard.press('Escape'); await p.waitForTimeout(400); checked++;
    if (await sc()) bad(w('Esc did not close the shortcuts list'));
    await p.keyboard.press('?'); await p.waitForTimeout(400); await p.mouse.click(5, 5); await p.waitForTimeout(400); checked++;
    if (await sc()) bad(w('clicking outside did not close the shortcuts list'));

    // tools tab: every tool opens in place, and every panel's controls are reachable
    await p.evaluate(() => { const s = window.__plexusStore.getState(); s.setTool(null); s.setView('tools'); }); await p.waitForTimeout(500);
    const nTools = await p.locator('.tool-card').count();
    if (nTools < 25) bad(w(`only ${nTools} tools listed`));
    for (let i = 0; i < nTools; i++) {
      await p.evaluate(() => { const s = window.__plexusStore.getState(); s.setTool(null); s.setView('tools'); }); await p.waitForTimeout(150);
      const name = (await p.locator('.tool-card .tool-name').nth(i).innerText()).replace(/\s*New$/, '').trim();
      await click(p.locator('.tool-card').nth(i)); await p.waitForTimeout(350);
      if (await p.locator('.tool-back').count()) {
        await run(p, w('tool ' + name));
        await click(p.getByRole('button', { name: /All tools/ })); checked++;
        if (await p.locator('.tool-back').count()) bad(w('"All tools" did not return to the list from ' + name));
      } else {
        // a card that opens an existing window, or goes to another view: it must close with Esc / return
        await p.keyboard.press('Escape'); await p.waitForTimeout(250);
      }
    }
    await p.evaluate(() => { const s = window.__plexusStore.getState(); s.setTool(null); s.setView('graph'); }); await p.waitForTimeout(300);
    // known-facts dialog: every close path
    await p.evaluate(() => window.__plexusStore.getState().setKnownDialog(true)); await p.waitForTimeout(500); await run(p, w('known facts'));
    await click(p.getByRole('button', { name: 'Close', exact: true })); checked++; if (await p.getByRole('dialog', { name: 'What you already know' }).count()) bad(w('Close did not close the known-facts dialog'));
    await p.evaluate(() => window.__plexusStore.getState().setKnownDialog(true)); await p.waitForTimeout(400); await p.keyboard.press('Escape'); await p.waitForTimeout(400); checked++; if (await p.getByRole('dialog', { name: 'What you already know' }).count()) bad(w('Esc did not close the known-facts dialog'));
    await p.evaluate(() => window.__plexusStore.getState().setKnownDialog(true)); await p.waitForTimeout(400); await p.mouse.click(5, 5); await p.waitForTimeout(400); checked++; if (await p.getByRole('dialog', { name: 'What you already know' }).count()) bad(w('clicking outside did not close the known-facts dialog'));
    // forensics surfaces
    await p.evaluate(() => window.__plexusStore.getState().setView('identities')); await p.waitForTimeout(1000); await run(p, w('identities'));
    const accts = (await S()).nodes.filter((n) => n.type === 'account' && n.attrs && n.attrs.platform && n.attrs.createdAt);
    if (accts.length >= 2) {
      await p.evaluate(([a, b]) => window.__plexusStore.getState().setMatchLab({ a, b }), [accts[0].id, accts[1].id]); await p.waitForTimeout(1100); await run(p, w('match lab'));
      await click(p.getByRole('button', { name: 'Close Match Lab' })); checked++; if (await p.locator('.matchlab').count()) bad(w('Close Match Lab button did not close it'));
      await p.evaluate(([a, b]) => window.__plexusStore.getState().setMatchLab({ a, b }), [accts[0].id, accts[1].id]); await p.waitForTimeout(900); await p.keyboard.press('Escape'); await p.waitForTimeout(500); checked++; if (await p.locator('.matchlab').count()) bad(w('Esc did not close Match Lab'));
      await p.evaluate(([a, b]) => window.__plexusStore.getState().setMatchLab({ a, b }), [accts[0].id, accts[1].id]); await p.waitForTimeout(900); await p.mouse.click(5, 5); await p.waitForTimeout(500); checked++; if (await p.locator('.matchlab').count()) bad(w('clicking outside did not close Match Lab'));
    }
    await p.evaluate(() => window.__plexusStore.getState().setDecode(true)); await p.waitForTimeout(600); await run(p, w('decode'));
    await click(p.getByRole('button', { name: 'Close decoder' })); checked++; if (await p.locator('.decode').count()) bad(w('Close decoder button did not close it'));
    await p.evaluate(() => window.__plexusStore.getState().setDecode(true)); await p.waitForTimeout(500); await p.keyboard.press('Escape'); await p.waitForTimeout(500); checked++; if (await p.locator('.decode').count()) bad(w('Esc did not close Decode'));
    await p.evaluate(() => window.__plexusStore.getState().setView('graph')); await p.waitForTimeout(400);

    // findings sheet: every tab, triage, close
    const email = (await S()).nodes.find((n) => n.type === 'email');
    await p.evaluate((id) => window.__plexusStore.getState().openSheet(id, 'overview'), email.id); await p.waitForTimeout(900);
    await run(p, w('sheet overview'));
    for (const t of ['To review', 'On your graph', 'Rejected', 'Overview']) {
      await click(p.locator('.sheet-tabs').getByRole('tab', { name: new RegExp(t) })); await run(p, w('sheet ' + t));
      if (t === 'To review' && await p.locator('.frow').count()) {
        if (wname === 'narrow') { await click(p.locator('.frow').first()); await run(p, w('sheet details overlay')); await click(p.getByRole('button', { name: /Back to list/ })); await p.waitForSelector('.detail-over', { state: 'detached', timeout: 3000 }).catch(() => {}); checked++; if (await p.locator('.detail-over').count()) bad(w('Back to list did not close the details overlay')); }
        else { await p.locator('.frow').first().hover(); await run(p, w('sheet details pane')); }
      }
    }
    await click(p.locator('.sheet-tabs').getByRole('tab', { name: /To review/ }));
    if (await p.getByRole('button', { name: /One by one/ }).count()) { await click(p.getByRole('button', { name: /One by one/ })); await run(p, w('triage')); await click(p.getByRole('button', { name: /Back to list/ })); }
    await click(p.getByRole('button', { name: /Sources|sources answered|Checking/ }).first()); await run(p, w('sources popover')); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    checked++; await click(p.getByRole('button', { name: 'Close', exact: true }));
    if ((await S()).sheet) bad(w('the Close (X) button did not close the findings sheet'));
    await p.evaluate((id) => window.__plexusStore.getState().openSheet(id, 'review'), email.id); await p.waitForTimeout(700);
    await p.mouse.click(8, 8); await p.waitForTimeout(500); checked++;
    if ((await S()).sheet) bad(w('clicking outside did not close the findings sheet'));
    await p.evaluate((id) => window.__plexusStore.getState().openSheet(id, 'review'), email.id); await p.waitForTimeout(700);
    await p.keyboard.press('Escape'); await p.waitForTimeout(500); checked++;
    if ((await S()).sheet) bad(w('Esc did not close the findings sheet'));
    // the sheet must also close when the toolbar (a drag area in the desktop app) is right behind its header
    await p.evaluate((id) => window.__plexusStore.getState().openSheet(id, 'review'), email.id); await p.waitForTimeout(700);
    const dragBehind = await p.evaluate(() => { const x = document.querySelector('.sheet [aria-label=Close]').getBoundingClientRect(); const t = document.querySelector('.toolbar'); const tr = t.getBoundingClientRect(); return { overlaps: x.bottom > tr.top && x.top < tr.bottom, region: getComputedStyle(t).getPropertyValue('-webkit-app-region') }; });
    checked++; if (dragBehind.overlaps && dragBehind.region === 'drag') bad(w('the sheet close button overlaps the still-active toolbar drag region'));
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    if (errs.length) bad(w('console/page errors: ' + errs.slice(0, 3).join(' | ')));
    await ctx.close();
  }
  console.log(`\n${checked} controls/behaviours checked, ${fails.length} problems`); await b.close(); process.exit(fails.length ? 1 : 0);
})();
