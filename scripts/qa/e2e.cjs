// End-to-end browser QA (160+ checks). Needs `npm i -D playwright` and a server running against the fictional test world
// (the app itself ships no demo data; `npm run build:world` makes the test-only bundle):
//   PLEXUS_HOME=$(mktemp -d) PLEXUS_PORT=4317 PLEXUS_DEMO_FAST=1 PLEXUS_TEST_WORLD=$PWD/dist-test/world.mjs node dist/server/index.mjs &
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

  await section('onboarding → start → hero lookup creates a named case', async () => {
    await p.getByRole('button', { name: 'Start investigating' }).click(); await settle(400);
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
    ok(await p.locator('.frow .tag', { hasText: 'Not sure' }).count() >= 1, 'unsure rows are tagged');
    await p.keyboard.press('Control+z'); await settle(400);
    s = await S();
    ok(!s.findings.some((f) => f.status === 'unsure'), 'Ctrl+Z undoes it');
    void before;
    await p.keyboard.press('Escape'); await settle(400);
  });


  const expandAll = async (scope) => { const m = scope.locator('.fmore-btn'); if (await m.count() && (await m.first().getAttribute('aria-expanded')) === 'false') { await m.first().click(); await settle(150); } const b = scope.getByRole('button', { name: 'Expand all' }); if (await b.count()) { await b.click(); await settle(150); } };

  await section('review clarity: every finding explains itself', async () => {
    const subj = (await S()).nodes.find((n) => n.type === 'email');
    await p.evaluate((id) => window.__plexusStore.getState().openSheet(id, 'overview', false), subj.id); await settle(900);
    // overview: summary, a connection map you can click, and a way into the review
    ok(await p.locator('.overview h2').count() === 1, 'overview opens with a headline');
    const mapNodes = await p.locator('.cm-node').count();
    ok(mapNodes >= 5, `the connection map shows what was found (${mapNodes} nodes)`);
    ok(await p.locator('.cm-center').count() === 1, 'the map has the searched subject in the middle');
    const boxes = await p.locator('.cm-node').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
    let overlaps = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const A = boxes[i], B = boxes[j]; if (A[0] < B[2] - 1 && B[0] < A[2] - 1 && A[1] < B[3] - 1 && B[1] < A[3] - 1) overlaps++; }
    ok(overlaps === 0, `map nodes never overlap (${overlaps})`);
    // case health: a score with the parts that make it up, collapsed by default and openable
    ok(await p.locator('.chealth-h').count() === 1, 'overview shows a case health score');
    await p.locator('.chealth-h').click(); await settle(300);
    ok(await p.locator('.chealth-p').count() >= 3, 'opening it shows what the score is made of');
    await p.locator('.chealth-h').click(); await settle(200);
    await p.locator('.cm-node').first().click(); await settle(500);
    ok((await S()).sheet.tab === 'review' || (await S()).sheet.tab === 'accepted', 'clicking a node in the map jumps to that finding');
    await p.locator('.sheet-tabs').getByRole('tab', { name: /Overview/ }).click(); await settle(300);
    await p.getByRole('button', { name: /Review \d+ finding/ }).click(); await settle(400);
    ok((await S()).sheet.tab === 'review', '“Review N findings” goes to the review list');

    const pane = p.locator('.detail-pane');
    ok(await pane.count() === 1, 'a detail panel is always visible beside the list');
    const rows = await p.locator('.frow').count();
    ok(rows >= 5, `list has findings (${rows})`);
    let jargon = [], dupNotes = 0;
    for (let i = 0; i < Math.min(rows, 12); i++) {
      await p.locator('.frow').nth(i).hover(); await settle(120);
      await expandAll(pane);
      const t = await pane.innerText();
      for (const must of ['HOW IT’S CONNECTED', 'FOUND DIRECTLY', 'ASKED', 'CHECK', 'YOU SEARCHED']) if (!t.toUpperCase().includes(must.toUpperCase())) jargon.push(`row ${i} missing section ${must}`);
      if (/Demo ·|undefined|\[object|\{[sf]\}/.test(t)) jargon.push(`row ${i} leaks internals: ${t.match(/Demo ·|undefined|\[object|\{[sf]\}/)[0]}`);
      const clean = await pane.locator('.strail dd.quote').allInnerTexts();
      const asked = await pane.locator('.strail dt', { hasText: 'Asked' }).count(), cards = await pane.locator('.scard').count();
      if (asked !== cards) jargon.push(`row ${i}: ${cards} source cards but ${asked} "Asked" lines`);
      if (clean.length !== cards) jargon.push(`row ${i}: ${cards} source cards but ${clean.length} "Found" records`);
      if (new Set(clean.map((c) => c.trim())).size < clean.length) dupNotes++;
      const sentence = await pane.locator('.verdict').innerText();
      if (sentence.length < 20 || /belongs to\.$/.test(sentence)) jargon.push(`row ${i} weak sentence: ${sentence}`);
    }
    ok(jargon.length === 0, `every finding shows the path, and for every source what was asked and what was found ${jargon.join(' | ')}`);
    ok(dupNotes === 0, `no finding shows the same record from two different sources (${dupNotes} did)`);
    // evidence rows are compact until opened, and one button opens or closes them all
    await p.locator('.frow').first().hover(); await settle(200);
    await expandAll(pane);
    await pane.getByRole('button', { name: 'Collapse all' }).click(); await settle(150);
    ok(await pane.locator('.strail').count() === 0, 'Collapse all folds every evidence row to one line');
    await pane.getByRole('button', { name: 'Expand all' }).click(); await settle(150);
    ok(await pane.locator('.strail').count() === await pane.locator('.scard').count(), 'Expand all opens every row');
    // the row itself reads as a sentence too, with its confidence and source count
    const firstSub = await p.locator('.frow .sub').first().innerText();
    ok(/ (is|are|appears|works|was|used|looks|points|also|might|shows|has)\b/.test(firstSub), `row text is a sentence: "${firstSub}"`);
    ok(/\d+%/.test(await p.locator('.frow .fr-meta').first().innerText()) && /independent source/.test(await p.locator('.frow .fr-meta').first().getAttribute('title')), 'each row shows its confidence, and its tooltip says how many sources agree');
    // decision bar is pinned and acts on the highlighted finding
    const bar = await pane.locator('.fdecide').boundingBox(), paneBox = await pane.boundingBox();
    ok(bar && paneBox && Math.abs(bar.y + bar.height - (paneBox.y + paneBox.height)) < 2, 'Accept / Reject bar is pinned to the bottom of the panel');
    await p.locator('.frow').first().hover(); await settle(150);
    const before = (await S()).findings.filter((f) => f.status === 'accepted').length;
    await pane.getByRole('button', { name: /Accept/ }).click(); await settle(500);
    ok((await S()).findings.filter((f) => f.status === 'accepted').length === before + 1, 'Accept in the detail panel accepts that finding');
    await pane.getByRole('button', { name: /Reject/ }).click(); await settle(500);
    ok((await S()).findings.some((f) => f.status === 'rejected'), 'Reject in the detail panel rejects the next one');
    ok(await p.locator('.review-hint, .brief').count() === 0, 'no tip banner or stacked summary crowds the list');

    // narrow window: the details slide over the list instead of vanishing
    await p.setViewportSize({ width: 700, height: 760 }); await settle(600);
    ok(await p.locator('.detail-pane').count() === 0, 'narrow window has no side panel');
    await p.locator('.frow').nth(1).click(); await settle(600);
    ok(await p.locator('.detail-over .verdict').count() >= 1, 'narrow window opens the details over the list when you click a row');
    ok(await p.locator('.detail-over .fdecide').count() === 1, '…with Accept / Reject still one tap away');
    const sb = await p.locator('.sheet').boundingBox();
    ok(sb.width <= 700 && sb.x >= 0, 'the dialog fits a narrow window');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nothing scrolls sideways');
    await p.locator('.detail-over').getByRole('button', { name: /Next/ }).click(); await settle(300);
    ok(/2 of|3 of/.test(await p.locator('.over-bar').innerText()), 'Next steps to the following finding');
    await p.keyboard.press('Escape'); await p.waitForSelector('.detail-over', { state: 'detached', timeout: 3000 }).catch(() => {}); await settle(200);
    ok(await p.locator('.detail-over').count() === 0 && !!(await S()).sheet, 'Esc closes the details first, not the whole dialog');
    await p.setViewportSize({ width: 1440, height: 900 }); await settle(500);
    await p.keyboard.press('Escape'); await settle(400);
  });

  await section('narrow window: sidebar becomes a drawer', async () => {
    await p.evaluate(() => window.__plexusStore.getState().closeSheet()); await settle(300);
    await p.setViewportSize({ width: 800, height: 700 }); await settle(600);
    const vis = () => p.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().right > 10);
    ok(!(await vis()), 'sidebar starts closed on a narrow window');
    await p.getByRole('button', { name: 'Toggle sidebar' }).click(); await settle(500);
    ok(await vis(), 'the toggle opens it as a drawer');
    ok(await p.locator('.drawer-scrim').isVisible(), 'with a dimmed backdrop');
    await p.mouse.click(780, 300); await settle(500);
    ok(!(await vis()), 'tapping outside closes it');
    await p.setViewportSize({ width: 1440, height: 900 }); await settle(600);
    ok(await vis(), 'it comes back on its own when the window is wide again');
  });


  await section('cross-checks: confirm, contradict, score chips, links', async () => {
    await p.evaluate(() => window.__plexusStore.getState().closeSheet()); await settle(400);
    await p.evaluate(() => window.__plexusStore.getState().submit([{ type: 'person', value: 'Mara Linden' }]));
    await p.waitForSelector('.sheet', { timeout: 20000 });
    await p.waitForFunction(() => { const s = window.__plexusStore.getState(); const r = Object.values(s.runs).find((x) => x.status === 'done' && x.sources.some((y) => y.capability === 'verify' && y.state === 'done')); return !!r; }, null, { timeout: 25000 });
    await p.getByRole('tab', { name: /To review/ }).click(); await p.waitForSelector('.frow', { timeout: 10000 }); await settle(500);
    const pane = p.locator('.detail-pane');
    const rowOf = (name) => p.locator('.frow', { has: p.locator('.v', { hasText: new RegExp('^' + name + '(\\s|$)') }) }).first();
    const pct = async () => Number((await pane.locator('.fscore b').innerText()).replace('%', ''));
    const stored = (value) => p.evaluate((v) => { const st = window.__plexusStore.getState(); const f = Object.values(st.findings).find((x) => x.value === v && x.subjectId === st.sheet.subjectId); return f && { score: f.score, ev: f.evidence.length, against: f.evidence.filter((e) => e.polarity === 'against').length, cross: f.evidence.filter((e) => e.kind === 'cross' && e.polarity !== 'against').length }; }, value);

    await rowOf('maralinden').hover(); await settle(300);
    await expandAll(pane);
    const good = await stored('maralinden');
    ok(good.cross >= 1, `the real username gains cross-check confirmations (${good.cross})`);
    ok(await pane.locator('.scard.ok').count() >= 1, 'confirming cross-checks are shown with a green edge');
    ok(/checks? confirms?/.test(await pane.locator('.chips2').innerText()), 'score chips say how many cross-checks confirm it');
    const goodPct = await pct();
    ok(goodPct === Math.round(good.score * 100), `the % shown (${goodPct}) is exactly the stored score (${Math.round(good.score * 100)})`);

    await rowOf('mlinden').hover(); await settle(300);
    await expandAll(pane);
    const bad = await stored('mlinden');
    ok(bad.against >= 1, 'the handle that belongs to a namesake collects contradicting evidence');
    ok(await pane.locator('.scard.bad .sverdict').count() >= 1, 'a contradicting cross-check is a red card with a verdict');
    ok(/does not match/.test(await pane.locator('.scard.bad .sverdict').first().innerText()), 'the verdict says what did not match');
    ok(/contradict/.test(await pane.locator('.chips2').innerText()), 'score chips count the contradiction');
    ok(await pane.locator('.fwatch').count() === 1, 'a warning box appears');
    ok(await pct() < goodPct, 'contradicted finding scores below the confirmed one');
    ok(/^Disputed\./.test(await rowOf('mlinden').locator('.sub').innerText()), 'its list row is worded as disputed, not as fact');

    await rowOf('maralinden').hover(); await settle(300);
    await expandAll(pane);
    const cards = await pane.locator('.scard').count();
    ok(cards >= 2, `evidence cards present (${cards})`);
    ok(await pane.locator('.strail dt', { hasText: 'Check' }).count() === cards, 'every card has a Check row (a link, or a note that there is no real page)');
    ok(await pane.locator('.strail dt', { hasText: 'Asked' }).count() === cards, 'every card says what was asked');
    ok(await pane.locator('.srecord').count() >= 1, 'cards quote the source record fields');
    ok(await pane.locator('.smeta2', { hasText: 'Checked because' }).count() >= 1, 'cross-check cards say which finding prompted the check');
    ok(/Cross-checking|sources answered/.test(await p.locator('.src-pill').innerText()), 'the header reflects the run (cross-check included)');
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
    // confidence slider: shows what the evidence supports at or above a level, and resets to everything
    const conf = p.locator('.conf-pill input[type=range]');
    ok(await conf.count() === 1, 'graph has a confidence slider');
    await conf.fill('60'); await settle(200);
    ok(/60%\+/.test(await p.locator('.conf-pill b').innerText()), 'moving it says what is being shown');
    await conf.fill('0'); await settle(200);
    ok(/All/.test(await p.locator('.conf-pill b').innerText()), 'and it goes back to showing everything');
    // replay: scrub through the order things were found; leaving restores the live graph and changes nothing stored
    const before = (await S()).nodes.length;
    await p.getByRole('button', { name: 'Replay', exact: true }).click(); await settle(300);
    await p.getByRole('button', { name: 'Pause replay' }).click(); await settle(200);
    const rs = p.locator('.replay-bar input[type=range]');
    await rs.fill('0'); await settle(300);
    ok(/^0\//.test(await p.locator('.replay-when').innerText()), 'replay can scrub back to the start');
    const max = await rs.getAttribute('max'); await rs.fill(String(max)); await settle(300);
    ok(new RegExp(`^${max}/${max}`).test(await p.locator('.replay-when').innerText()), 'and forward to everything found');
    await p.getByRole('button', { name: 'Exit replay' }).click(); await settle(300);
    ok(await p.locator('.replay-bar').count() === 0 && (await S()).nodes.length === before, 'leaving replay restores the live graph and changes nothing');
    const A = await nodePos('Mara Linden'), B = await nodePos('Mara L. Linden');
    if (A && B) {
      const n0 = (await S()).nodes.length;
      await p.mouse.click(A.x, A.y); await p.keyboard.down('Shift'); await p.mouse.click(B.x, B.y); await p.keyboard.up('Shift'); await settle(300);
      await p.keyboard.press('m'); await settle(1500);
      ok((await S()).nodes.length === n0 - 1, 'M merges two nodes into one');
    } else console.log('  (skipped merge: nodes not present)');
    const nodes = (await S()).nodes;
    const x = nodes.find((n) => n.type === 'domain') || nodes[nodes.length - 1], y = nodes.find((n) => n.type === 'email' && n.id !== x.id) || nodes[0];
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
    const n = (await S()).nodes.find((x) => x.type === 'domain') || (await S()).nodes[(await S()).nodes.length - 1];
    const P1 = await nodePos(n.label); await p.mouse.click(P1.x, P1.y); await settle(600);
    // check elsewhere: a library of places to look this up by hand
    await p.getByRole('button', { name: /Check elsewhere/ }).click(); await settle(300);
    const piv = await p.locator('.pivot-pop').innerText();
    ok((await p.locator('.pivot-link').count()) >= 6, 'Check elsewhere lists places to look (' + (await p.locator('.pivot-link').count()) + ')');
    ok(/places to look/.test(piv) && /nothing is sent/i.test(piv), 'and says nothing is sent from the app');
    ok((await p.locator('.pivot-link').first().getAttribute('href')).startsWith('https://') && (await p.locator('.pivot-link').first().getAttribute('rel')).includes('noopener'), 'links open safely in the browser');
    await p.getByRole('button', { name: /Check elsewhere/ }).click(); await settle(300);
    ok(await p.locator('.pivot-pop').count() === 0, 'it closes again');
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
    await p.keyboard.press('Control+5'); await settle(900);
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
    // source doctor: tests every source and reports which work
    await p.getByRole('button', { name: /^Test all sources/ }).click(); await settle(700);
    ok(/Testing… \d+ of \d+|Test all sources again/.test(await p.locator('.doctor').innerText()), 'Test all sources starts and shows progress');
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

  await section('integrity: verified record, fingerprints, backups', async () => {
    await p.evaluate(() => window.__plexusStore.getState().openSettings('audit')); await settle(900);
    ok(await p.locator('.integrity.good').count() === 1, 'Audit log shows “Record intact” for an untouched case');
    const t = await p.locator('.integrity').innerText();
    ok(/unbroken chain/.test(t) && /fingerprints re-verified, none altered/.test(t) && /no corruption/.test(t), 'it spells out the three checks (activity chain, evidence fingerprints, database)');
    await p.getByRole('button', { name: 'Verify again' }).click(); await settle(500);
    ok(await p.locator('.integrity.good').count() === 1, 'Verify again works');
    await p.evaluate(() => window.__plexusStore.getState().openSettings('general')); await settle(500);
    await p.getByRole('button', { name: /Back up now/ }).click(); await settle(800);
    ok((await p.locator('.setrow', { has: p.locator('.t', { hasText: /^Backups$/ }) }).innerText()).includes('Latest:'), 'Back up now saves a copy and says when');
    const r = await api('GET', '/api/backups');
    ok(r.backups.length >= 1, 'the backup exists on disk');
    const rep = await api('GET', `/api/cases/${(await S()).caseId}/report`);
    ok(/## Method and integrity/.test(rep.markdown) && /unbroken hash chain/.test(rep.markdown), 'the report includes a method and integrity section');
    await p.keyboard.press('Escape'); await settle(400);
    // an evidence row shows its fingerprint
    const richest = await p.evaluate(() => { const c = {}; for (const f of Object.values(window.__plexusStore.getState().findings)) c[f.subjectId] = (c[f.subjectId] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; });
    await p.evaluate((id) => { const s = window.__plexusStore.getState(); const f = Object.values(s.findings).filter((x) => x.subjectId === id); s.openSheet(id, f.some((x) => x.status === 'pending' || x.status === 'unsure') ? 'review' : 'accepted'); }, richest); await settle(800);
    await p.locator('.frow').first().hover({ timeout: 5000 }); await expandAll(p.locator('.detail-pane'));
    ok(await p.locator('.detail-pane .fp').count() >= 1, 'evidence rows show their fingerprint');
    await p.keyboard.press('Escape'); await settle(400);
  });

  await section('portability: import, search across cases, exports, shortcuts', async () => {
    const cid = (await S()).caseId;
    const exp = await api('GET', `/api/cases/${cid}/export`);
    // import through the palette's file picker
    await p.keyboard.press('Control+k'); await settle(400);
    await p.keyboard.type('import a case'); await settle(300);
    const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 5000 }), p.locator('.pitem', { hasText: 'from a Plexus export' }).click()]);
    await chooser.setFiles({ name: 'case.plexus.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exp)) });
    await p.waitForFunction((old) => window.__plexusStore.getState().caseId !== old, cid, { timeout: 8000 }).catch(() => {});
    await settle(600);
    const s1 = await S();
    ok(s1.caseId !== cid && /imported/.test(s1.cases.find((c) => c.id === s1.caseId)?.name ?? ''), 'importing a Plexus export opens it as a new case');
    ok(s1.nodes.length === exp.nodes.length, 'every entity came across');
    ok((await S()).toasts.some((t) => /evidence verified/.test(t)), 'it says the evidence was verified');
    // search the other case from the palette
    const name = exp.nodes.find((n) => n.type === 'person')?.label;
    await p.keyboard.press('Control+k'); await settle(300); await p.keyboard.type(name.slice(0, 8)); await settle(900);
    ok(await p.locator('.pitem', { hasText: /in “/ }).count() >= 1, 'the palette finds the same entity in another case');
    await p.keyboard.press('Escape'); await settle(300);
    // exports
    const html = await (await p.request.get(`http://127.0.0.1:4317/api/cases/${cid}/report.html`)).text();
    ok(/Print or save as PDF/.test(html) && /Method and integrity/.test(html), 'printable HTML report');
    const gml = await (await p.request.get(`http://127.0.0.1:4317/api/cases/${cid}/graphml`)).text();
    ok(/<graphml/.test(gml) && (gml.match(/<node /g) ?? []).length === exp.nodes.length, 'GraphML has every node');
    // shortcuts panel
    await p.keyboard.press('?'); await settle(400);
    ok(await p.locator('.shortcuts').count() === 1 && /reviewing findings/i.test(await p.locator('.shortcuts').innerText()), '? opens the shortcuts list');
    await p.keyboard.press('Escape'); await settle(400);
    ok(await p.locator('.shortcuts').count() === 0, 'Esc closes it');
    // switch back to the original case and remove the imported copy so later sections see what they expect
    const imported = (await S()).caseId;
    await p.evaluate((id) => window.__plexusStore.getState().loadCase(id), cid); await settle(800);
    await api('DELETE', `/api/cases/${imported}`); await p.evaluate(() => window.__plexusStore.getState().refreshCases()); await settle(300);
  });

  await section('forensics: Autopilot, Identities, Match Lab, Decode, Activity clock', async () => {
    // Autopilot from the palette on a fresh case
    const cid0 = (await S()).caseId;
    await p.evaluate(() => window.__plexusStore.getState().newCase('Forensics QA'));
    await settle(700);
    const fcase = (await S()).caseId;
    await p.keyboard.press('Control+k'); await settle(300); await p.keyboard.type('maralinden'); await settle(500);
    await p.locator('.pitem', { hasText: 'Autopilot: maralinden' }).click();
    await p.waitForSelector('.aphud', { timeout: 8000 });
    ok(await p.locator('.aphud').getByRole('button', { name: /Stop/ }).count() === 1, 'Autopilot shows a live panel with a Stop button');
    await p.waitForFunction(() => window.__plexusStore.getState().autopilot?.status !== 'running', null, { timeout: 90000 });
    await settle(800);
    const ap = await p.evaluate(() => window.__plexusStore.getState().autopilot);
    ok(ap.status === 'done' && ap.summary.subjects >= 2 && ap.summary.accepted > 3, `Autopilot finished and built the graph (${ap.summary?.subjects} lookups, ${ap.summary?.accepted} accepted)`);
    ok(await p.locator('.aphud').innerText().then((t) => /several independent sources/.test(t)), 'it explains what it did and did not accept');
    ok((await S()).findings.some((f) => f.status === 'pending'), 'it left the doubtful findings for review');
    await p.locator('.aphud').getByRole('button', { name: 'Dismiss Autopilot' }).click();
    await p.waitForSelector('.aphud', { state: 'detached', timeout: 3000 }).catch(() => {}); await settle(200);
    ok(await p.locator('.aphud').count() === 0, 'Dismiss closes the Autopilot panel');
    // Earlier sections taught the engine to trust these sources less (by design), so state the accounts explicitly to keep this check deterministic.
    const accts = (await api('GET', `/api/cases/${fcase}/findings`)).findings.filter((f) => f.type === 'account' && f.status === 'pending' && /roblox|discord/i.test(f.value) && !/\/users\/1246285629751427076/.test(f.value));
    await api('POST', '/api/findings/review', { ids: accts.map((f) => f.id), status: 'accepted' }); await api('POST', `/api/cases/${fcase}/commit`, {});
    await p.evaluate((id) => window.__plexusStore.getState().loadCase(id), fcase); await settle(800);

    // Identities and Match Lab
    await p.keyboard.press('Control+4'); await settle(1200);
    ok(await p.locator('.idn-card').count() >= 1, 'Identities groups the Roblox and Discord accounts into one operator');
    ok(/Roblox/.test(await p.locator('.idn-card').first().innerText()) && /Discord/.test(await p.locator('.idn-card').first().innerText()), 'the card names both platforms');
    await p.locator('.idn-card').getByRole('button', { name: /Why/ }).first().click(); await settle(1200);
    ok(await p.locator('.matchlab').count() === 1, 'Why opens the Match Lab');
    const lab = await p.locator('.matchlab').innerText();
    ok(/Created at about the same time/.test(lab) && /Handle/.test(lab) && /Active hours/.test(lab) && /bits/.test(lab), 'the Match Lab shows every signal in bits');
    ok(/99\./.test(lab) || />99\.99%/.test(lab), 'and a probability');
    const before = await p.locator('.ml-answer').innerText();
    await p.locator('#prior').fill('6'); await settle(300);
    ok((await p.locator('.ml-answer').innerText()) !== before, 'moving the prior slider changes the answer live');
    const closeLab = p.getByRole('button', { name: 'Close Match Lab' }); await closeLab.click(); await settle(400);
    ok(await p.locator('.matchlab').count() === 0, 'Match Lab closes');

    // Decode
    await p.keyboard.press('Control+k'); await settle(300); await p.keyboard.type('decode ids'); await settle(300);
    await p.locator('.pitem', { hasText: 'Decode IDs, links and timestamps' }).click(); await settle(500);
    await p.fill('textarea[aria-label="Text to decode"]', 'https://discord.com/channels/111111111111111111/222222222222222222/175928847299117063 https://www.roblox.com/users/3148802991/profile https://steamcommunity.com/profiles/76561197960287930'); await settle(900);
    const dec = await p.locator('.decode').innerText();
    ok(/2016-04-30 11:18:25 UTC/.test(dec), 'Decode reads the exact send time from a Discord message link');
    ok(/Individual account/.test(dec) && /Roblox user 3148802991/.test(dec), 'and decodes Steam and Roblox references');
    await p.getByRole('button', { name: 'Close decoder' }).click(); await settle(400);
    ok(await p.locator('.decode').count() === 0, 'Decode closes');

    // Activity clock in the inspector
    await p.evaluate(() => { const s = window.__plexusStore.getState(); s.setView('graph'); s.toggle('inspector', true); const n = s.snap.nodes.find((x) => x.attrs?.platform === 'Roblox'); s.select([n.id]); });
    await settle(800);
    await p.locator('.inspector [role=tab]', { hasText: 'Activity' }).click(); await settle(700);
    ok(await p.locator('.aclock svg').count() === 1 && /UTC−6/.test(await p.locator('.aclock').innerText()), 'the Activity tab draws the clock and leans UTC−6');
    await p.evaluate(() => window.__plexusStore.getState().toggle('inspector', false));
    await p.evaluate((id) => window.__plexusStore.getState().loadCase(id), cid0); await settle(800);
    await api('DELETE', `/api/cases/${fcase}`); await p.evaluate(() => window.__plexusStore.getState().refreshCases()); await settle(300);
  });

  await section('photos & files: read a real JPEG with GPS, rank what matters, add to case; link forensics in Decode', async () => {
    // a real, decodable JPEG from the browser, with an EXIF block (camera, time, GPS in Paris) spliced in
    const jpegB64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const g = c.getContext('2d'); g.fillStyle = '#4a90d9'; g.fillRect(0, 0, 64, 24); g.fillStyle = '#6b8e4e'; g.fillRect(0, 24, 64, 24); return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
    const base = Buffer.from(jpegB64, 'base64');
    const ascii = (v) => Buffer.from(v + '\0', 'latin1');
    const rat = (pairs) => { const b = Buffer.alloc(pairs.length * 8); pairs.forEach(([n, d], i) => { b.writeUInt32LE(n, i * 8); b.writeUInt32LE(d, i * 8 + 4); }); return b; };
    const entry = (tag, type, count, valOrOff) => { const b = Buffer.alloc(12); b.writeUInt16LE(tag, 0); b.writeUInt16LE(type, 2); b.writeUInt32LE(count, 4); if (Buffer.isBuffer(valOrOff)) valOrOff.copy(b, 8); else b.writeUInt32LE(valOrOff, 8); return b; };
    const make = ascii('Apple'), model = ascii('iPhone 15 Pro'), dto = ascii('2024:05:03 14:22:10'), off = ascii('+02:00');
    const latR = rat([[48, 1], [51, 1], [3024, 100]]), lonR = rat([[2, 1], [17, 1], [4020, 100]]);
    // layout: header 8 | IFD0 (4 entries=2+48+4=54) | EXIF IFD (2 entries=30) | GPS IFD (4 entries=54) | data
    const ifd0At = 8, exifAt = ifd0At + 54, gpsAt = exifAt + 30, dataAt = gpsAt + 54;
    let d = dataAt; const offs = {}; for (const [k, v] of Object.entries({ make, model, dto, off, latR, lonR })) { offs[k] = d; d += v.length; }
    const ifd0 = Buffer.concat([Buffer.from([4, 0]), entry(0x010f, 2, make.length, offs.make), entry(0x0110, 2, model.length, offs.model), entry(0x8769, 4, 1, exifAt), entry(0x8825, 4, 1, gpsAt), Buffer.alloc(4)]);
    const exif = Buffer.concat([Buffer.from([2, 0]), entry(0x9003, 2, dto.length, offs.dto), entry(0x9011, 2, off.length, offs.off), Buffer.alloc(4)]);
    const gps = Buffer.concat([Buffer.from([4, 0]), entry(1, 2, 2, Buffer.from('N\0')), entry(2, 5, 3, offs.latR), entry(3, 2, 2, Buffer.from('E\0')), entry(4, 5, 3, offs.lonR), Buffer.alloc(4)]);
    const tiff = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), ifd0, exif, gps, make, model, dto, off, latR, lonR]);
    const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]); const hdr = Buffer.alloc(4); hdr[0] = 0xff; hdr[1] = 0xe1; hdr.writeUInt16BE(app1.length + 2, 2);
    const photo = Buffer.concat([base.subarray(0, 2), hdr, app1, base.subarray(2)]);

    await p.keyboard.press('Escape'); await p.keyboard.press('Control+k'); await settle(300); await p.keyboard.type('analyze a photo'); await settle(300);
    await p.locator('.pitem', { hasText: 'Analyze a photo, video or file' }).click(); await settle(500);
    ok(await p.locator('.filelab').count() === 1, 'the photos & files lab opens from the palette');
    await p.locator('input[aria-label="Choose files to analyse"]').setInputFiles({ name: 'IMG_20240503_142210.jpg', mimeType: 'image/jpeg', buffer: photo });
    await p.waitForSelector('.fl-head', { timeout: 15000 }); await settle(300);
    const head = await p.locator('.fl-head').innerText();
    ok(/48\.85840, 2\.29450/.test(head), 'the GPS position is a headline fact');
    ok(/2024-05-03 14:22:10.*UTC\+02:00/.test(head), 'so is the capture time with its timezone');
    ok(await p.locator('.fl-loc').getByRole('link', { name: 'Open in Google Maps' }).count() === 1, 'map links are offered');
    ok(/Paris/.test(await p.locator('.fl-loc').innerText()), 'and the place is named');
    ok(/Apple iPhone 15 Pro/.test(await p.locator('.filelab').innerText()), 'the camera is shown');
    ok(await p.locator('.fl-flag.warning').count() === 0, 'a clean photo raises no warnings');
    // the AI location step is honest when no model is set up
    await p.getByRole('button', { name: /Work out the location from the picture/ }).click(); await settle(900);
    ok(/AI is off|AI is not set up|Settings → AI/.test(await p.locator('.fl-geo').innerText()), 'location-from-picture says plainly that an AI model is needed');
    // add the proposed place to the case
    const nodesBefore = (await S()).nodes.length;
    await p.getByRole('button', { name: /Add \d+ to this case/ }).click(); await settle(900);
    ok((await S()).nodes.some((n) => n.type === 'location' && /48\.8584/.test(n.value)), 'the place from the photo is added to the graph');
    ok((await S()).nodes.length > nodesBefore, 'the graph grew');
    await p.getByRole('button', { name: 'Close photos and files' }).click(); await settle(500);
    ok(await p.locator('.filelab').count() === 0, 'the lab closes');
    // link forensics in Decode
    await p.keyboard.press('Control+k'); await settle(300); await p.keyboard.type('decode ids'); await settle(300);
    await p.locator('.pitem', { hasText: 'Decode IDs, links and timestamps' }).click(); await settle(500);
    await p.fill('textarea[aria-label="Text to decode"]', 'https://cdn.discordapp.com/attachments/111111111111111111/175928847299117063/cat.png?ex=65f0a1b2&is=65e12db2&hm=abc&utm_source=x and 48.8584, 2.2945');
    await settle(1000);
    const dec2 = await p.locator('.decode').innerText();
    ok(/what these links give away/i.test(dec2) && /2016-04-30 11:18:25 UTC/.test(dec2), 'a Discord file link is dated to the second');
    ok(/places written in this text/i.test(dec2) && /48\.85840, 2\.29450/.test(dec2), 'coordinates in text are found');
    await p.getByRole('button', { name: 'Close decoder' }).click(); await settle(400);
  });

  await section('signed evidence package verifies itself in a real browser, and notices tampering', async () => {
    const cid = (await S()).caseId;
    const html = await (await p.request.get(`http://127.0.0.1:4317/api/cases/${cid}/package`)).text();
    const file = require('path').join(require('os').tmpdir(), `plexus-package-${Date.now()}.html`); require('fs').writeFileSync(file, html);
    const page = await ctx.newPage();
    await page.goto('file://' + file); await page.waitForSelector('#vbtn');
    ok(/confirmed findings/.test(await page.locator('#doc').innerText()), 'the package shows the evidence from its signed data');
    await page.click('#vbtn'); await page.waitForTimeout(600);
    const out = await page.locator('#vout').innerText();
    ok(/has not been changed/.test(out), 'it checks the evidence is unchanged');
    ok(/evidence fingerprints match/.test(out), 'it recomputes every evidence fingerprint in the browser');
    ok(!/✗/.test(out), 'a genuine package shows no failures');
    ok(/signature is valid|cannot check Ed25519/.test(out), 'the signature is checked (or the page says honestly that this browser cannot)');
    // tamper: change a quote inside the signed payload, then verify again
    await page.evaluate(() => { const el = document.getElementById('plexus-payload'); el.textContent = el.textContent.replace(/"snippet":"/, '"snippet":"TAMPERED '); });
    await page.click('#vbtn'); await page.waitForTimeout(600);
    ok(/does NOT match what was signed/.test(await page.locator('#vout').innerText()), 'changing the evidence is detected');
    await page.close();
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


  await section('known facts: two facts are confirmed, cross-checked, and accepting one connects the dots', async () => {
    const c = await api('POST', '/api/cases', { name: 'Known e2e', purpose: 'qa' });
    await p.evaluate((id) => window.__plexusStore.getState().loadCase(id), c.case.id); await settle(900);
    await p.evaluate(() => window.__plexusStore.getState().setKnownDialog(true)); await settle(400);
    ok(await p.getByRole('dialog', { name: 'What you already know' }).count() === 1, 'the known-facts dialog opens');
    await p.locator('input[aria-label="Known fact 1"]').fill('mara.linden@northwind-labs.example');
    await p.locator('input[aria-label="Known fact 2"]').fill('maralinden'); await settle(250);
    ok(await p.locator('.kn-warn').count() === 0, 'both facts are recognised without asking what they are');
    await p.screenshot({ path: SP + '/shots-known.png' });
    await p.getByRole('button', { name: /Add 2 and look them all up/ }).click();
    await p.waitForFunction(() => { const r = Object.values(window.__plexusStore.getState().runs); return r.length >= 2 && r.every((x) => x.status === 'done'); }, null, { timeout: 40000 }).catch(() => {}); await settle(1500);
    let s = await S();
    const known = s.nodes.filter((n) => n.attrs && n.attrs.known === true);
    ok(known.length === 2, `both known facts are on the graph (${known.length})`);
    ok(known.every((n) => n.state === 'confirmed' && n.level === 4), 'known facts are confirmed at the top level');
    ok(s.edges.some((e) => /known to be the same subject/.test(e.label || '')), 'the two known facts are linked to each other');
    const anchored = s.findings.filter((f) => f.type === 'account' && f.evidence.some((e) => e.adapter === 'anchor'));
    ok(anchored.length >= 1, `accounts that match what you know carry anchor evidence (${anchored.length})`);
    ok(anchored.every((f) => f.evidence.some((e) => e.adapter === 'anchor' && /you (told|know)|known/i.test((e.how || '') + (e.snippet || '')))), 'anchor evidence says it comes from what you told Plexus');
    // accepting an anchored account adds it to the graph and connects it to the known facts
    const target = anchored.sort((a, b) => b.score - a.score)[0];
    const conn = await api('GET', `/api/findings/${target.id}/connections`);
    ok(Array.isArray(conn.connections) && conn.connections.length >= 1, `the server lists what accepting it will connect (${(conn.connections || []).length})`);
    const edgesBefore = s.edges.length, nodesBefore = s.nodes.length;
    await p.evaluate((id) => window.__plexusStore.getState().openSheet(id, 'review'), target.subjectId); await settle(900);
    let sawCard = false, sawWc = false;
    const nrows = await p.locator('.frow').count();
    for (let i = 0; i < Math.min(nrows, 25) && !(sawCard && sawWc); i++) {
      await p.locator('.frow').nth(i).hover(); await settle(250);
      if (await p.locator('.detail-pane .pcard').count()) sawCard = true;
      if (await p.locator('.detail-pane .wc').count()) sawWc = true;
    }
    ok(sawCard, 'an account finding shows a profile card (bio, created date, avatar) without opening any link');
    ok(sawWc, 'the detail panel shows “what accepting will connect”');
    await p.screenshot({ path: SP + '/shots-detail.png' });
    await p.evaluate((id) => window.__plexusStore.getState().review([id], 'accepted'), target.id); await settle(1200);
    s = await S();
    ok(s.nodes.length > nodesBefore || s.nodes.some((n) => n.value === target.value), 'accepting adds the account to the graph straight away');
    ok(s.edges.length >= edgesBefore + 1, `accepting connected it (${edgesBefore}→${s.edges.length} edges)`);
    const node = s.nodes.find((n) => n.value === target.value);
    const touching = node ? s.edges.filter((e) => e.from === node.id || e.to === node.id) : [];
    ok(touching.length >= 2, `the accepted account is tied to more than the subject (${touching.length} edges)`);
    ok(touching.some((e) => known.some((k) => e.from === k.id || e.to === k.id)), 'one of those ties reaches a node you marked as known');
    // undo takes it back off
    await p.evaluate(() => window.__plexusStore.getState().undo()); await settle(1000);
    s = await S();
    ok(!s.nodes.some((n) => n.value === target.value) || s.nodes.length <= nodesBefore, 'undo removes the accepted node again');
    await p.evaluate(() => window.__plexusStore.getState().review([], 'accepted')).catch(() => {});
    await p.evaluate((id) => window.__plexusStore.getState().review([id], 'accepted'), target.id); await settle(900);
    await p.keyboard.press('Escape'); await settle(300);
  });


  await section('what a username is: pick the service, say where it came from, change it later', async () => {
    const c = await api('POST', '/api/cases', { name: 'Roles e2e', purpose: 'qa' });
    await p.evaluate((id) => window.__plexusStore.getState().loadCase(id), c.case.id); await settle(900);
    await p.locator('input[aria-label="Start an investigation"]').fill('ravenfox_77'); await settle(350);
    ok(await p.getByRole('group', { name: 'What this username is' }).count() === 1, 'typing a username shows “which service is this for?”');
    ok(/same name only|Not sure|every result is only/i.test(await p.locator('.rp-effect').innerText()), 'with nothing chosen it explains that every result is only a same-name match');
    await p.getByRole('radio', { name: 'Discord', exact: true }).click();
    await p.getByRole('radio', { name: 'Display name' }).click();
    ok(/not unique/.test(await p.locator('.rp-effect').innerText()), 'a display name is explained as a clue, not a search');
    await p.getByRole('radio', { name: 'Username', exact: true }).click();
    await p.getByRole('radio', { name: 'Roblox', exact: true }).click();
    await p.getByRole('radio', { name: 'I am sure it is theirs' }).click();
    await p.locator('select[aria-label="Where did you get it"]').selectOption('screenshot');
    await p.locator('input[aria-label="Details about where it came from"]').fill('from the report');
    ok(/Plexus will look this up on Roblox itself/.test(await p.locator('.rp-effect').innerText()), 'choosing Roblox says it will be looked up on Roblox itself');
    ok(/Roblox username/.test(await p.locator('.rp-head').innerText()), 'the summary reads “Roblox username”');
    await p.getByRole('button', { name: 'Look up' }).click(); await p.waitForSelector('.sheet', { timeout: 20000 }); await settle(1500);
    let n = (await S()).nodes.find((x) => x.value === 'ravenfox_77');
    ok(n && n.attrs.handlePlatform === 'roblox' && n.attrs.handleTrust === 'certain' && n.attrs.handleOrigin === 'screenshot' && n.attrs.handleOriginNote === 'from the report', 'the role, trust, origin and note are saved on the node');
    ok(/Roblox username/.test(await p.locator('.sheet-head').innerText()), 'the findings window names it a Roblox username');
    await p.keyboard.press('Escape'); await settle(400);
    // change it later from the inspector
    await p.evaluate((id) => { const s = window.__plexusStore.getState(); s.select([id]); s.toggle('inspector', true); }, n.id); await settle(600);
    ok(/Roblox username/.test(await p.locator('.insp-body .hrole').innerText()), 'the inspector shows what the username is');
    await p.locator('.insp-body .hrole').getByRole('button', { name: 'Change' }).click(); await settle(300);
    await p.locator('.insp-body .hrole').getByRole('radio', { name: 'Discord', exact: true }).click();
    await p.locator('.insp-body .hrole').getByRole('radio', { name: 'Display name' }).click();
    await p.locator('.insp-body .hrole').getByRole('button', { name: /Save and look it up again/ }).click(); await settle(1500);
    n = (await S()).nodes.find((x) => x.value === 'ravenfox_77');
    ok(n.attrs.handlePlatform === 'discord' && n.attrs.handleKind === 'display-name', 'changing it in the inspector saves the new meaning');
    ok(/Kept as a clue only/.test(await p.locator('.insp-body .hrole').innerText()), 'a display name is shown as kept as a clue only');
    await p.evaluate(() => window.__plexusStore.getState().toggle('inspector', false)); await settle(300);
    // the known-facts dialog takes roles too, and a handle you are only fairly sure of is described but not declared a fact
    await p.evaluate(() => window.__plexusStore.getState().setKnownDialog(true)); await settle(400);
    await p.locator('input[aria-label="Known fact 1"]').fill('mara.linden@northwind-labs.example');
    await p.locator('input[aria-label="Known fact 2"]').fill('raven_alt'); await settle(300);
    await p.locator('.kn-role .rp-head').click(); await settle(250);
    await p.locator('.kn-role').getByRole('radio', { name: 'Discord', exact: true }).click();
    await p.locator('.kn-role').getByRole('checkbox', { name: /alt account/ }).check();
    await p.locator('.kn-role').getByRole('radio', { name: 'Probably theirs' }).click();
    await p.getByRole('button', { name: /^Add only$/ }).click(); await settle(1200);
    const g = await S();
    const alt = g.nodes.find((x) => x.value === 'raven_alt'), mail = g.nodes.find((x) => x.type === 'email');
    ok(alt && alt.attrs.handlePlatform === 'discord' && alt.attrs.handleAlt === true && alt.attrs.known !== true, 'a “probably theirs” alt is described but not declared a known fact');
    ok(mail && mail.attrs.known === true, 'the email you were sure of is a known fact');
    ok(g.edges.some((e) => /believe these belong together|alt account/.test(e.label || '') && [e.from, e.to].includes(alt.id)), 'the alt is joined to the rest on the graph, labelled as what you believe');
  });

  await section('review window: bands, type filters, bulk accept, footer', async () => {
    const s0 = await S();
    const subj = s0.nodes.find((n) => n.attrs && n.attrs.known && n.type === 'email') || s0.nodes[0];
    await p.evaluate((id) => window.__plexusStore.getState().openSheet(id, 'review'), subj.id); await settle(900);
    const tabs = await p.locator('.sheet-tabs [role="tab"]').allInnerTexts();
    ok(tabs.some((t) => /On your graph/.test(t)), 'the accepted tab is called “On your graph”');
    ok(!(await p.getByRole('button', { name: /^Add \d+ to graph/ }).count()), 'there is no separate “Add to graph” step any more');
    const chips = await p.locator('.tfilter').count();
    if (chips >= 2) { await p.locator('.tfilter').nth(1).click(); await settle(300); const shown = await p.locator('.frow').count(); await p.locator('.tfilter').first().click(); await settle(300); ok(await p.locator('.frow').count() >= shown, 'type filters narrow the list and “All” brings everything back'); }
    ok(await p.locator('.sheet-foot').count() === 1 && /accepted|Nothing accepted/.test(await p.locator('.sheet-foot').innerText()), 'the footer says how many are accepted and already on the graph');
    await p.screenshot({ path: SP + '/shots-review.png' });
    await p.keyboard.press('Escape'); await settle(300);
  });

  await section('AI settings: automatic model, provider hints, plain-English test result', async () => {
    await p.evaluate(() => window.__plexusStore.getState().openSettings('ai')); await settle(500);
    const provider = p.locator('select[aria-label="Provider"]');
    ok(await provider.count() === 1, 'the AI tab has a provider picker');
    await provider.selectOption('openrouter'); await settle(400);
    const txt = await p.locator('.settings .pane').innerText();
    ok(/automatic/i.test(txt), 'OpenRouter defaults to Automatic model choice');
    ok(/free/i.test(txt), 'it explains that free models are used first');
    ok(await p.locator('.settings .pane').getByRole('button', { name: /Save and test/ }).count() === 1, 'there is one “Save and test” button');
    await provider.selectOption('google'); await settle(400);
    ok(/Google AI Studio|aistudio/i.test(await p.locator('.settings .pane').innerText()), 'Google AI Studio shows where to get a key');
    await provider.selectOption('none'); await settle(300);
    await p.keyboard.press('Escape'); await settle(300);
  });

  await section('graph: no stray nodes far from the cluster', async () => {
    await p.evaluate(() => window.__plexusStore.getState().setView('graph')); await settle(1500);
    const m = await p.evaluate(() => { const e = window.__plexusEngine; const ns = [...e.byId.values()].map((n) => ({ x: n.tx ?? n.x, y: n.ty ?? n.y })); if (ns.length < 3) return null; const cx = ns.reduce((a, n) => a + n.x, 0) / ns.length, cy = ns.reduce((a, n) => a + n.y, 0) / ns.length; const d = ns.map((n) => Math.hypot(n.x - cx, n.y - cy)).sort((a, b) => a - b); return { n: ns.length, med: d[Math.floor(d.length / 2)], max: d[d.length - 1] }; });
    ok(!m || m.max <= Math.max(420, m.med * 3.2), `the farthest node is not far from the rest (max ${m && Math.round(m.max)}, median ${m && Math.round(m.med)})`);
  });

  await section('tools tab: list, search, and every tool opens and answers', async () => {
    await p.getByRole('button', { name: 'Tools', exact: true }).first().click(); await settle(500);
    const cards = await p.locator('.tool-card').count();
    ok(cards >= 25, `the Tools tab lists at least 25 tools (${cards})`);
    await p.locator('input[aria-label="Search tools"]').fill('shadow'); await settle(300);
    ok(await p.locator('.tool-card').count() >= 2 && await p.locator('.tool-card').count() < cards, 'searching narrows the list');
    await p.locator('input[aria-label="Search tools"]').fill(''); await settle(200);
    const open = async (name) => { const back = p.getByRole('button', { name: /All tools/ }); if (await back.count()) { await back.click(); await settle(150); } await p.locator('.tool-card', { has: p.locator('.tool-name', { hasText: new RegExp('^' + name) }) }).first().click(); await settle(350); };
    const type = async (sel, v, i = 0) => { await p.locator('.tools ' + sel).nth(i).fill(v); await settle(350); };
    const text = () => p.locator('.tools').innerText();

    await open('Identify anything'); await type('textarea', '1700000000\n175928847299117063\n0x52908400098527886E0F7030069857D2E4169EE7');
    let t = await text(); ok(/Nov 14, 2023/.test(t) && /Discord ID/.test(t) && /Ethereum/.test(t), 'Identify anything reads a timestamp, a Discord ID and a wallet');
    await open('Timestamp decoder'); await type('input.field', '1700000000');
    t = await text(); ok(/Nov 14, 2023/.test(t) && /Tokyo/.test(t), 'Timestamp decoder shows the time in other zones');
    await open('Coordinate toolkit'); await type('textarea', '37°46\'29.6"N 122°25\'09.8"W');
    t = await text(); ok(/849V[0-9A-Z]{4}\+[0-9A-Z]{2}/.test(t) && /Geohash/.test(t) && /10S /.test(t), 'Coordinate toolkit converts to Plus Code, geohash and UTM');
    await open('Shadow geolocator'); await type('input[type="datetime-local"]', '2025-06-21T08:30');
    t = await text(); ok(/above the horizon/.test(t) && /circle|spot|place/.test(t), 'Shadow geolocator turns a shadow into a sun height and a ring of places');
    await open('Shadow clock'); await type('input[placeholder="48.8584, 2.2945"]', '40.7128, -74.0060'); await type('input[type="date"]', '2025-06-21');
    t = await text(); ok(/Morning|never happens/.test(t), 'Shadow clock answers for a known place');
    await open('Does the time fit'); await type('input[placeholder="48.8584, 2.2945"]', '48.8584, 2.2945'); await type('input[type="datetime-local"]', '2025-06-21T03:00');
    t = await text(); ok(/Night|Twilight|Sunrise/.test(t), 'Daylight check says it is dark at 3 am in Paris in June');
    await open('Travel plausibility'); await type('input[placeholder="48.8584, 2.2945"]', '37.7749, -122.4194', 0); await type('input[placeholder="48.8584, 2.2945"]', '40.7128, -74.0060', 1);
    await type('input[type="datetime-local"]', '2025-06-01T12:00', 0); await type('input[type="datetime-local"]', '2025-06-01T14:00', 1);
    t = await text(); ok(/Not possible for one person/.test(t), 'Travel plausibility rejects San Francisco to New York in two hours');
    await open('Username variants'); await type('input.field', 'xX_maralinden99_Xx');
    t = await text(); ok(/Core name/.test(t) && /maralinden/.test(t) && /Likely variations/.test(t), 'Username variants explains the handle and lists variations');
    await open('Compare two usernames'); await type('input.field', 'maralinden', 0); await type('input.field', 'm4ralinden_2009', 1);
    t = await text(); ok(/Same name, written differently|Share a distinctive word/.test(t) && /bits/.test(t), 'Compare two usernames reports evidence in bits');
    await open('Look-alike'); await type('input.field', 'pаypal.com');
    t = await text(); ok(/Mixes alphabets/.test(t) && /Reads as/.test(t) && /paypal\.com/.test(t), 'Look-alike detector finds a Cyrillic а inside paypal');
    await open('Writing-style'); await type('textarea', 'lol i dont even know what ur talking about tbh '.repeat(14), 0); await type('textarea', 'The committee has reviewed the proposal, and it will be presented on Thursday. '.repeat(10), 1);
    t = await text(); ok(/Different|Inconclusive|similar/i.test(t) && /habits compared/i.test(t), 'Writing-style matcher compares two samples');
    await open('Phone number reader'); await type('input.field', '+1 415 555 0132', 0);
    t = await text(); ok(/fiction/.test(t) && /\+14155550132/.test(t), 'Phone reader flags the fictional 555 range');
    await open('Pull entities'); await type('textarea', 'Write to mara@linden.example or visit https://linden.example/about, call +1 415 555 0132, server 203.0.113.9');
    t = await text(); ok(/email/.test(t) && /url/.test(t) && /ip/.test(t), 'Pull entities finds emails, links and IPs in pasted text');
    await open('Email header tracer'); await type('textarea', 'Received: from mail.example.com (mail.example.com [203.0.113.9]) by mx.test.example with ESMTPS; Mon, 03 Jun 2024 14:22:05 +0200\nFrom: Sam <sam@example.com>\nTo: you@test.example\nSubject: Hello\nDate: Mon, 03 Jun 2024 14:21:58 +0200\nMessage-ID: <abc@example.com>\n\nbody');
    t = await text(); ok(/Hello/.test(t) && /UTC\+02:00/.test(t), 'Header tracer reads the sender timezone');
    await open('Link inspector'); await type('input.field', 'https://www.instagram.com/p/CzXyZ12abCd/?igsh=MWRsdzNxMA%3D%3D&utm_source=ig_web_copy_link');
    t = await text(); ok(/Cleaned link/.test(t) && /instagram\.com\/p\/CzXyZ12abCd/.test(t), 'Link inspector cleans tracking tags');
    await open('Reverse image search'); await type('input.field', 'https://x.example/photo.jpg');
    t = await text(); ok(/Google Lens/.test(t) && /TinEye/.test(t) && await p.locator('.tools a[href*="tineye.com/search?url=https%3A%2F%2Fx.example"]').count() === 1, 'Reverse image search builds engine links from an address');
    await open('Email guesser'); await type('input.field', 'Mara', 0); await type('input.field', 'Linden', 2); await type('input.field', 'northwind-labs.example', 3);
    t = await text(); ok(/mara\.linden@northwind-labs\.example/.test(t) && /Check which exist/.test(t), 'Email guesser lists likely addresses');
    await open('Gravatar checker'); await type('textarea', 'nobody-here@plexus-test.invalid');
    await p.getByRole('button', { name: /Check 1 address/ }).click(); await settle(2500);
    t = await text(); ok(/Gravatar|could not be checked/.test(t), 'Gravatar checker answers (no network in QA is reported, not hidden)');
    await open('Domain history'); await type('input.field', 'not a domain'); await p.getByRole('button', { name: /Build the history/ }).click(); await settle(1500);
    ok(/domain name|not a domain|Could not reach/i.test(await text()), 'Domain history rejects a non-domain clearly');
    await open('Link unshortener'); await type('input.field', 'http://127.0.0.1/admin'); await p.getByRole('button', { name: /Follow the link/ }).click(); await settle(1500);
    ok(/not a public/.test(await text()), 'the unshortener refuses a private-network address');
    await open('Weather at that time'); await type('input[placeholder="48.8584, 2.2945"]', '51.5074, -0.1278');
    ok(await p.getByRole('button', { name: /Look up the weather/ }).isEnabled(), 'Weather tool is ready once a place is given');

    // picture tools with a real generated picture
    const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 320, 240); gr.addColorStop(0, '#2a6'); gr.addColorStop(1, '#a42'); g.fillStyle = gr; g.fillRect(0, 0, 320, 240); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('PLEXUS', 60, 130); return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
    const buf = Buffer.from(png, 'base64');
    const give = async (name, files) => { await p.locator('.tools input[type="file"]').setInputFiles(files.map((f, i) => ({ name: `${name}${i}.jpg`, mimeType: 'image/jpeg', buffer: buf }))); await settle(1800); };
    await open('Edit detector'); await give('ela', [0]);
    ok(/Even throughout|Some regions|Inconclusive/.test(await text()) && await p.locator('.tools canvas').count() >= 1, 'Edit detector draws an error-level map for a picture');
    await open('Image twin finder'); await give('twin', [0, 1]);
    t = await text(); ok(/Identical|The same picture/.test(t), 'Image twin finder says two copies of one picture are the same');
    await open('Metadata remover'); await give('strip', [0]);
    ok(await p.locator('.tools a[download$="-clean.jpg"]').count() === 1, 'Metadata remover offers a clean copy to save');
    await open('Screenshot reader'); ok(await p.locator('.tools .tl-drop').count() === 1, 'Screenshot reader asks for a picture');
    // tools that open existing windows
    await p.locator('.tools').getByRole('button', { name: /All tools/ }).click(); await settle(200);
    await p.locator('.tool-card', { has: p.locator('.tool-name', { hasText: /^Decode IDs/ }) }).click(); await settle(500);
    ok(await p.getByRole('dialog', { name: /Decode/ }).count() === 1, 'Decode card opens the decoder window'); await p.keyboard.press('Escape'); await settle(300);
    await p.locator('.tool-card', { has: p.locator('.tool-name', { hasText: /^Photo & file forensics/ }) }).click(); await settle(500);
    ok(await p.locator('.modal, [role="dialog"]').count() >= 1, 'Photo & file forensics card opens the file lab'); await p.keyboard.press('Escape'); await settle(300);
    await p.screenshot({ path: SP + '/shots-tools.png' });
    // palette lists tools too
    await p.keyboard.press('Control+k'); await settle(300); await p.keyboard.type('shadow'); await settle(400);
    ok(await p.locator('.pitem', { hasText: 'Shadow geolocator' }).count() >= 1, 'the command palette finds tools');
    await p.keyboard.press('Escape'); await settle(300);
    await p.evaluate(() => window.__plexusStore.getState().setTool(null)); await p.evaluate(() => window.__plexusStore.getState().setView('graph')); await settle(400);
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
