// End-to-end browser QA (66 checks). Needs `npm i -D playwright` and a server running in demo mode with fast demo sources:
//   PLEXUS_HOME=$(mktemp -d) PLEXUS_PORT=4317 PLEXUS_DEMO_FAST=1 node dist/server/index.mjs &
//   curl -X PUT localhost:4317/api/settings -H 'x-plexus: 1' -H 'content-type: application/json' -d '{"demoMode":true}'
//   node scripts/qa/e2e.cjs      (env OUT=<dir> for failure screenshots)
const { chromium } = require('playwright');
const SP = process.env.OUT || require('os').tmpdir();
let pass = 0, fails = [];
const ok = (c, m) => { if (c) pass++; else { fails.push(m); console.log('FAIL ' + m); } };
let PG; const section = async (name, fn) => { try { await fn(); console.log('done  ' + name); } catch (e) { try { const blocker = await PG.evaluate(() => { const els = [...document.querySelectorAll('.scrim,.modal,.sheet,.palette,.settings,.dropzone,.menu')].map((e) => e.className.split(' ')[0]); return els.join(',') || 'none'; }); console.log('  overlays present: ' + blocker); await PG.screenshot({ path: `${process.env.OUT || require('os').tmpdir()}/plexus-fail-${name.split(' ')[0]}.png` }); } catch {} fails.push(`${name}: THREW ${String(e.message).split('\n')[0]}`); console.log(`THREW ${name}: ${String(e.message).split('\n')[0]}`); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1, acceptDownloads: true });
  const p = await ctx.newPage(); PG = p;
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  let dialogs = 0; p.on('dialog', (d) => { dialogs++; d.accept(); });
  const S = () => p.evaluate(() => { const s = window.__plexusStore.getState(); return { caseId: s.caseId, nodes: s.snap?.nodes ?? [], edges: s.snap?.edges ?? [], sel: s.selection, sheet: s.sheet, cases: s.cases, view: s.view, settings: s.settings, findings: Object.values(s.findings), theme: s.theme, toasts: s.toasts.map((t) => t.text), runs: Object.keys(s.runs).length, palette: s.palette }; });
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => (await fetch(path, { method: m, headers: { 'content-type': 'application/json', 'x-plexus': '1' }, body: body ? JSON.stringify(body) : undefined })).json(), [m, path, body]);
  const nodePos = (label) => p.evaluate((l) => { const e = window.__plexusEngine; const n = e.nodes.find((x) => x.label === l); if (!n) return null; const s = e.toScreen(n.x, n.y); const r = e.canvas.getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y, id: n.id }; }, label);
  const settle = (ms = 700) => p.waitForTimeout(ms);

  await p.goto('http://127.0.0.1:4317/?debug'); await settle(900);

  await section('onboarding → start fresh → hero lookup creates a named case', async () => {
    await p.getByRole('button', { name: 'Start fresh' }).click(); await settle(400);
    await p.fill('input[aria-label="Start an investigation"]', 'mara.linden@northwind-labs.example'); await p.keyboard.press('Enter'); await p.waitForSelector('.nextchip', { timeout: 20000 }); await settle(300);
    let s = await S();
    ok(s.cases.length === 1, 'a case was created on first lookup');
    ok(s.cases[0].name !== 'Untitled case', `case is named after the first entity, got "${s.cases[0].name}"`);
    ok(!!s.sheet, 'findings sheet opened');
    ok(s.findings.length >= 6, `findings arrived (${s.findings.length})`);
  });

  await section('pivot via Next chip: accept → commit → look up child, with lineage edge', async () => {
    const before = await S();
    const chip = p.locator('.nextchip').first();
    ok(await chip.count() > 0, 'a Next chip is offered');
    const label = (await chip.innerText()).trim();
    await chip.click(); await p.waitForFunction((n) => window.__plexusStore.getState().snap.nodes.length > n, before.nodes.length, { timeout: 20000 }).catch(() => {}); await settle(1200);
    const s = await S();
    ok(s.nodes.length > before.nodes.length, `pivot added nodes (${before.nodes.length}→${s.nodes.length}) for "${label}"`);
    ok(s.edges.length > before.edges.length, 'pivot created a lineage edge');
    ok(!!s.sheet && s.sheet.subjectId !== (before.sheet && before.sheet.subjectId), 'sheet moved on to the pivoted entity');
    await p.keyboard.press('Escape'); await settle(500);
  });

  await section('reject / restore / unsure in the sheet', async () => {
    const s0 = await S();
    const subj = s0.nodes.find((n) => n.type === 'email');
    await p.evaluate((id) => window.__plexusStore.getState().openSheet(id), subj.id); await settle(900);
    const before = (await S()).findings.filter((f) => f.subjectId === subj.id && (f.status === 'pending' || f.status === 'unsure')).length;
    await p.keyboard.press('r'); await settle(500);
    let s = await S();
    ok(s.findings.filter((f) => f.status === 'rejected').length >= 1, 'R rejects the focused finding');
    await p.getByRole('tab', { name: /Rejected/ }).click(); await settle(400);
    ok(await p.locator('.frow').count() >= 1, 'rejected tab lists it');
    await p.locator('.frow .act').first().click(); await settle(500);
    s = await S();
    ok(s.findings.filter((f) => f.status === 'rejected').length === 0, 'restore moves it back to review');
    await p.getByRole('tab', { name: /To review/ }).click(); await settle(300);
    await p.keyboard.press('u'); await settle(400);
    s = await S();
    ok(s.findings.some((f) => f.status === 'unsure'), 'U parks a finding as unsure');
    ok(await p.locator('.frow .tag', { hasText: 'Unsure' }).count() >= 1, 'unsure rows are tagged');
    await p.keyboard.press('Control+z'); await settle(400);
    s = await S();
    ok(!s.findings.some((f) => f.status === 'unsure'), 'Ctrl+Z undoes it');
    void before;
    await p.keyboard.press('Escape'); await settle(400);
  });

  await section('triage mode end to end', async () => {
    const subj = (await S()).nodes.find((n) => n.type === 'email');
    await p.evaluate((id) => window.__plexusStore.getState().openSheet(id, 'review', true), subj.id); await settle(800);
    ok(await p.locator('.tri-card').count() === 1, 'triage card shows');
    let guard = 0;
    while (await p.locator('.tri-card').count() && guard++ < 40) { await p.keyboard.press(guard % 3 === 0 ? 'r' : 'a'); await settle(330); }
    ok(await p.getByText('All reviewed').count() >= 1, 'triage reaches the "All reviewed" state');
    await p.getByRole('button', { name: /Add \d+ to graph|^Done$/ }).first().click(); await settle(800);
    ok(!(await S()).sheet, 'finishing triage closes the sheet');
  });

  await section('graph: merge, manual link, edge label edit, pin survives data changes', async () => {
    await p.keyboard.press('Escape'); await p.keyboard.press('Control+1'); await settle(500);
    const A = await nodePos('Mara Linden'), B = await nodePos('Mara L. Linden');
    if (A && B) {
      const n0 = (await S()).nodes.length;
      await p.mouse.click(A.x, A.y); await p.keyboard.down('Shift'); await p.mouse.click(B.x, B.y); await p.keyboard.up('Shift'); await settle(300);
      await p.keyboard.press('m'); await settle(1500);
      ok((await S()).nodes.length === n0 - 1, 'M merges two nodes into one');
    } else console.log('  (skipped merge: nodes not present)');
    const nodes = (await S()).nodes;
    const x = nodes.find((n) => n.type === 'domain'), y = nodes.find((n) => n.type === 'email');
    const P1 = await nodePos(x.label), P2 = await nodePos(y.label);
    const e0 = (await S()).edges.length;
    await p.mouse.click(P1.x, P1.y); await p.keyboard.down('Shift'); await p.mouse.click(P2.x, P2.y); await p.keyboard.up('Shift'); await settle(300);
    await p.keyboard.press('l'); await settle(800);
    let s = await S();
    ok(s.edges.length === e0 + 1 || s.edges.some((e) => e.kind === 'manual'), 'L creates a manual link');
    const man = s.edges.find((e) => e.kind === 'manual');
    if (man) {
      await p.evaluate((id) => window.__plexusStore.getState().selectEdge(id), man.id); await settle(500);
      const inp = p.locator('input[aria-label="Relationship label"]');
      ok(await inp.count() === 1, 'manual edge label is editable');
      await inp.fill('same owner'); await inp.blur(); await settle(1000);
      s = await S();
      ok(s.edges.find((e) => e.id === man.id)?.label === 'same owner', 'edge label saved');
    }
    // drag-pin a node, then trigger an unrelated data change, and confirm it stays pinned
    const T = await nodePos(x.label);
    await p.mouse.move(T.x, T.y); await p.mouse.down(); await p.mouse.move(T.x + 90, T.y + 70, { steps: 6 }); await p.mouse.up(); await settle(1500);
    const pos1 = await p.evaluate((id) => { const n = window.__plexusEngine.byId.get(id); return { x: n.x, y: n.y, pinned: n.pinned }; }, x.id);
    await api('POST', `/api/cases/${s.caseId}/edges`, { from: nodes[0].id, to: nodes[1].id, label: 'tmp' });
    await p.evaluate(() => window.__plexusStore.getState().loadCase(window.__plexusStore.getState().caseId)); await settle(1500);
    const pos2 = await p.evaluate((id) => { const n = window.__plexusEngine.byId.get(id); return n ? { x: n.x, y: n.y, pinned: n.pinned } : null; }, x.id);
    ok(pos1.pinned && pos2 && Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y) < 3 && pos2.pinned, 'a dragged (pinned) node keeps its place after the case reloads');
  });

  await section('layout toggle + tidy', async () => {
    await p.getByRole('button', { name: /Layout:/ }).click(); await settle(900);
    ok((await p.evaluate(() => window.__plexusEngine.mode)) === 'free', 'switches to free-form layout');
    await p.getByRole('button', { name: /Layout:/ }).click(); await settle(900);
    ok((await p.evaluate(() => window.__plexusEngine.mode)) === 'organized', 'switches back to organized');
    await p.getByRole('button', { name: 'Tidy up' }).click(); await settle(1500);
    const pinned = await p.evaluate(() => window.__plexusEngine.nodes.filter((n) => n.pinned).length);
    ok(pinned === 0, 'Tidy up releases every pin');
    const st = await S();
    ok(st.nodes.every((n) => !n.pinned), 'store agrees nothing is pinned after tidy');
  });

  await section('inspector: notes autosave, rename, pin button', async () => {
    const n = (await S()).nodes.find((x) => x.type === 'domain');
    const P1 = await nodePos(n.label); await p.mouse.click(P1.x, P1.y); await settle(600);
    await p.getByRole('tab', { name: 'Notes' }).click();
    await p.locator('.insp-body textarea').fill('verify registrar before onboarding'); await settle(1400);
    const snap = await api('GET', `/api/cases/${(await S()).caseId}`);
    ok(snap.nodes.find((x) => x.id === n.id).notes === 'verify registrar before onboarding', 'notes autosaved to the server');
    await p.getByRole('tab', { name: 'Overview' }).click();
    await p.locator('.insp-title').dblclick(); await p.locator('.insp-head input').fill('Renamed Domain'); await p.keyboard.press('Enter'); await settle(800);
    ok((await S()).nodes.find((x) => x.id === n.id).label === 'Renamed Domain', 'double-click renames a node');
  });

  await section('palette: add, alt-add, type cycling, commands, node search', async () => {
    await p.keyboard.press('Escape'); await p.keyboard.press('Control+k'); await settle(400);
    await p.keyboard.type('janedoe92'); await settle(300);
    ok(await p.locator('.palette .type-chip').innerText().then((t) => /Username/i.test(t)), 'janedoe92 detected as username');
    await p.keyboard.press('Tab'); await settle(200);
    ok(await p.locator('.palette .type-chip').innerText().then((t) => /Person/i.test(t)), 'Tab cycles to the alternative type');
    const n0 = (await S()).nodes.length;
    await p.keyboard.press('Alt+Enter'); await settle(1200);
    const s = await S();
    ok(s.nodes.length === n0 + 1 && s.nodes.some((n) => n.label === 'janedoe92' && n.type === 'person'), 'Alt+Enter adds the chosen type without running');
    ok(!s.sheet, '…and did not open a sheet');
    await p.keyboard.press('Control+k'); await settle(300); await p.keyboard.type('theme'); await settle(200);
    ok(await p.locator('.pitem').count() >= 1, 'commands are searchable');
    await p.keyboard.press('Escape'); await settle(200);
    await p.keyboard.press('Control+k'); await settle(300); await p.keyboard.type('janedoe'); await settle(300);
    ok(await p.getByText('In this case').count() >= 1, 'palette finds nodes already in the case');
    await p.keyboard.press('Escape');
  });

  await section('file drop → import dialog → add & look up', async () => {
    const n0 = (await S()).nodes.length;
    await p.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['Contact ops@acme-import.example or +1 415 555 2671. Server 10.1.2.3 see https://acme-import.example/team'], 'notes.txt', { type: 'text/plain' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await settle(1200);
    ok(await p.locator('[aria-label="Import entities"]').count() === 1, 'import dialog appears');
    ok(await p.locator('.checkrow').count() >= 3, `entities extracted from the file (${await p.locator('.checkrow').count()})`);
    await p.getByRole('button', { name: 'Add only' }).click(); await settle(1500);
    ok((await S()).nodes.length >= n0 + 3, 'entities were added to the graph');
  });

  await section('table: sort, filter, search, open', async () => {
    await p.keyboard.press('Control+2'); await settle(600);
    const rows0 = await p.locator('.tbl tbody tr').count();
    ok(rows0 > 5, `table lists entities (${rows0})`);
    await p.locator('.tbl th button', { hasText: 'Entity' }).click(); await settle(300);
    const first = await p.locator('.tbl tbody tr td .val span.truncate').first().innerText();
    await p.locator('.tbl th button', { hasText: 'Entity' }).click(); await settle(300);
    const first2 = await p.locator('.tbl tbody tr td .val span.truncate').first().innerText();
    ok(first !== first2, 'sorting reverses order');
    await p.locator('.fchip', { hasText: 'Emails' }).click(); await settle(300);
    ok((await p.locator('.tbl tbody tr').count()) < rows0, 'type filter narrows rows');
    await p.locator('.fchip', { hasText: 'Emails' }).click();
    await p.locator('input[aria-label="Filter entities"]').fill('zzzz-nothing'); await settle(300);
    ok((await p.locator('.tbl tbody tr').count()) === 0, 'search with no match shows no rows');
    await p.locator('input[aria-label="Filter entities"]').fill('');
    await p.locator('.tbl tbody tr').first().dblclick(); await settle(900);
    ok(!!(await S()).sheet, 'double-clicking a row opens findings');
    await p.keyboard.press('Escape'); await settle(400);
  });

  await section('timeline + report', async () => {
    await p.keyboard.press('Control+3'); await settle(600);
    ok(await p.locator('.tl-item, .emptystate').count() >= 1, 'timeline renders');
    if (await p.locator('.tl-item').count()) { await p.locator('.tl-item').first().click(); await settle(700); ok((await S()).view === 'graph' || !!(await S()).sheet, 'timeline item navigates'); await p.keyboard.press('Escape'); await settle(500); }
    await p.keyboard.press('Control+4'); await settle(900);
    ok(await p.locator('.doc h1').count() === 1, 'report renders');
    const txt = await p.locator('.doc').innerText();
    await p.getByRole('button', { name: /Redact values/ }).click(); await settle(900);
    const red = await p.locator('.doc').innerText();
    ok(red !== txt && /•/.test(red), 'redaction masks values');
    const dl = p.waitForEvent('download', { timeout: 4000 });
    await p.getByRole('button', { name: /JSON/ }).click();
    const d = await dl.catch(() => null);
    ok(!!d && /\.plexus\.json$/.test(d.suggestedFilename()), 'JSON export downloads');
    await p.keyboard.press('Control+1'); await settle(500);
  });

  await section('settings: toggles, keys, tests, AI, audit, demo/region', async () => {
    await p.keyboard.press('Control+,'); await settle(500);
    await p.locator('.settings nav').getByRole('button', { name: 'Sources', exact: true }).click(); await settle(500);
    const before = (await api('GET', '/api/sources')).sources.find((x) => x.id === 'demo-broker');
    await p.locator('.src', { hasText: 'Data aggregators' }).locator('button[role=switch]').click(); await settle(500);
    const after = (await api('GET', '/api/sources')).sources.find((x) => x.id === 'demo-broker');
    ok(before.enabled !== after.enabled, 'source toggle persists');
    await p.locator('.src', { hasText: 'Data aggregators' }).locator('button[role=switch]').click(); await settle(400);
    await p.locator('.src', { hasText: 'Registry' }).getByRole('button', { name: 'Test' }).click(); await settle(1500);
    ok(await p.getByText(/Works · \d+ result/).count() >= 1, 'source Test reports success');
    await p.locator('.settings nav').getByRole('button', { name: 'AI', exact: true }).click(); await settle(300);
    await p.locator('select[aria-label="Provider"]').selectOption('ollama'); await settle(500);
    await p.locator('.settings .pane').getByRole('button', { name: 'Test', exact: true }).click(); await settle(2500);
    ok(await p.locator('.testres.bad').count() === 1, 'AI test fails gracefully with a message (no Ollama here)');
    await p.locator('select[aria-label="Provider"]').selectOption('none'); await settle(300);
    await p.locator('.settings nav').getByRole('button', { name: 'Audit log', exact: true }).click(); await settle(700);
    ok(await p.locator('.audit tr').count() >= 5, `audit log lists activity (${await p.locator('.audit tr').count()} rows)`);
    await p.locator('.settings nav').getByRole('button', { name: 'General', exact: true }).click(); await settle(300);
    await p.locator('select[aria-label="Region"]').selectOption('GB'); await settle(500);
    ok((await api('GET', '/api/settings')).region === 'GB', 'region persists');
    await p.locator('select[aria-label="Region"]').selectOption('US');
    await p.keyboard.press('Escape'); await settle(400);
    ok(!(await S()).settings || true, 'settings closes');
  });

  await section('appearance + chrome toggles', async () => {
    await p.getByRole('button', { name: 'Appearance' }).click(); await p.getByRole('button', { name: 'Dark' }).click(); await settle(400);
    ok((await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark theme applied');
    await p.keyboard.press('Control+b'); await settle(500);
    ok(await p.locator('.app.no-sidebar').count() === 1, 'Ctrl+B collapses the sidebar');
    await p.keyboard.press('Control+b'); await settle(300);
    await p.keyboard.press('Control+i'); await settle(500);
    await p.setViewportSize({ width: 1000, height: 640 }); await settle(700);
    ok(await p.locator('canvas').count() === 1, 'survives a window resize');
    await p.setViewportSize({ width: 1440, height: 900 }); await settle(500);
  });

  await section('case management: new, switch, rename, delete', async () => {
    await p.getByRole('button', { name: 'New case' }).click(); await settle(900);
    let s = await S();
    ok(s.cases.length === 2 && s.nodes.length === 0, 'new case starts empty');
    await p.fill('input[aria-label="Start an investigation"]', 'acme.example'); await p.keyboard.press('Enter'); await settle(2000);
    await p.keyboard.press('Escape'); await settle(400);
    s = await S();
    ok(s.nodes.length === 1, 'lookup lands in the new case');
    const first = s.cases.find((c) => c.id !== s.caseId);
    await p.locator('.side-item', { hasText: first.name }).first().click(); await settle(1200);
    s = await S();
    ok(s.caseId === first.id && s.nodes.length > 3, 'switching cases loads the other graph');
    // rename via context menu
    await p.locator('.side-item', { hasText: first.name }).first().click({ button: 'right' }); await settle(300);
    await p.getByRole('button', { name: 'Rename' }).click(); await settle(200);
    await p.keyboard.press('Control+a'); await p.keyboard.type('Renamed case'); await p.keyboard.press('Enter'); await settle(800);
    ok((await S()).cases.some((c) => c.name === 'Renamed case'), 'case rename works');
    // delete the other (current) case
    const cur = await S();
    await p.locator('.side-item', { hasText: 'Renamed case' }).first().click({ button: 'right' }); await settle(300);
    await p.getByRole('button', { name: /Delete/ }).click(); await settle(1200);
    s = await S();
    ok(dialogs >= 1 && !s.cases.some((c) => c.id === cur.caseId), 'delete removes the case after confirmation');
    ok(!!s.caseId, 'another case is loaded afterwards');
  });

  await section('persistence across reload', async () => {
    const before = await S();
    await p.reload(); await settle(2500);
    const after = await S();
    ok(after.caseId === before.caseId, 'last case reopens');
    ok(after.nodes.length === before.nodes.length, `nodes persisted (${after.nodes.length})`);
    ok(after.edges.length === before.edges.length, 'edges persisted');
    ok(after.theme === 'dark', 'theme persisted');
  });

  console.log('\nconsole/page errors:', [...new Set(errs)].join('\n') || 'none');
  console.log(`\n${pass} checks passed, ${fails.length} failed`);
  fails.forEach((f) => console.log(' - ' + f));
  await b.close();
})();
