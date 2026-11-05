import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST, PORT, APP_NAME, writeSecret, HOME } from './config';
import { Store } from './store';
import { Service } from './service';
import { Orchestrator, RunHub, citationIds } from './orchestrator';
import { rescore, ruleBrief, suggestNext } from '../shared/scoring';
import { reliabilityFn } from './registry';
import { loadAdapters } from './adapters/index';
import { allAdapters, getAdapter, sourceInfo, demoMode } from './registry';
import { makeBriefEnhancer, aiSettings, aiReady, listModels, complete, aiLinkHypotheses, DEFAULT_AI } from './ai';
import { inferLinks } from './links';
import { buildReport } from './report';
import { detect, detectMany, extractEntities } from '../shared/detect';
import { keyFor } from '../shared/normalize';
import { makeCtx } from './http';
import { getSecret } from './config';
import { DEMO_SEEDS } from './adapters/demo';
import { ENTITY_TYPES, type EntityType, type FindingStatus, type RunEvent } from '../shared/types';

export async function createApp(store = new Store()) {
  await loadAdapters();
  const svc = new Service(store);
  const hub = new RunHub();
  const enhancer = makeBriefEnhancer(store);
  const orch = new Orchestrator(store, hub, enhancer);
  const app = new Hono();

  // --- security: this is a localhost-only API; defend against DNS rebinding and cross-site writes ---------------
  app.use('/api/*', async (c, next) => {
    const host = (c.req.header('host') ?? '').split(':')[0];
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return c.json({ error: 'forbidden host' }, 403);
    const origin = c.req.header('origin');
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) && !origin.startsWith('app://')) return c.json({ error: 'forbidden origin' }, 403);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-plexus') !== '1') return c.json({ error: 'missing x-plexus header' }, 403);
    await next();
  });
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: String((err as Error).message ?? err) }, 500);
  });

  const body = async <T,>(c: any): Promise<T> => (await c.req.json().catch(() => ({}))) as T;
  const isType = (t: unknown): t is EntityType => typeof t === 'string' && (ENTITY_TYPES as readonly string[]).includes(t);

  // --- meta ---------------------------------------------------------------------------------------------------
  app.get('/api/health', (c) => c.json({ ok: true, app: APP_NAME, demo: demoMode(store), home: HOME }));
  app.post('/api/detect', async (c) => {
    const { text } = await body<{ text: string }>(c);
    return c.json({ items: detectMany(text ?? '') });
  });
  app.post('/api/extract', async (c) => {
    const { text } = await body<{ text: string }>(c);
    return c.json({ items: extractEntities((text ?? '').slice(0, 2_000_000)) });
  });
  app.get('/api/demo/seeds', (c) => c.json({ seeds: DEMO_SEEDS }));

  // --- cases --------------------------------------------------------------------------------------------------
  app.get('/api/cases', (c) => c.json({ cases: store.listCases() }));
  app.post('/api/cases', async (c) => {
    const b = await body<{ name?: string; purpose?: string }>(c);
    return c.json({ case: store.createCase((b.name ?? '').trim() || 'Untitled case', (b.purpose ?? '').trim()) });
  });
  app.get('/api/cases/:id', (c) => {
    const s = svc.snapshot(c.req.param('id'));
    return s ? c.json(s) : c.json({ error: 'not found' }, 404);
  });
  app.patch('/api/cases/:id', async (c) => {
    const b = await body<{ name?: unknown; purpose?: unknown }>(c);
    return c.json({ case: store.updateCase(c.req.param('id'), { name: typeof b.name === 'string' ? b.name.slice(0, 120) : undefined, purpose: typeof b.purpose === 'string' ? b.purpose.slice(0, 1000) : undefined }) });
  });
  app.delete('/api/cases/:id', (c) => { store.deleteCase(c.req.param('id')); return c.json({ ok: true }); });
  app.get('/api/cases/:id/audit', (c) => c.json({ audit: store.listAudit(c.req.param('id')) }));
  app.get('/api/cases/:id/findings', (c) => {
    const status = c.req.query('status')?.split(',') as FindingStatus[] | undefined;
    return c.json({ findings: store.listFindings(c.req.param('id'), { subjectId: c.req.query('subject') || undefined, status }) });
  });

  // --- lookups ------------------------------------------------------------------------------------------------
  app.post('/api/cases/:id/lookups', async (c) => {
    const caseId = c.req.param('id');
    const b = await body<{ type?: string; value?: string; nodeId?: string; context?: string; near?: { x: number; y: number }; run?: boolean }>(c);
    let node = b.nodeId ? store.getNode(b.nodeId) : null;
    if (!node) {
      if (!b.value?.trim()) return c.json({ error: 'value required' }, 400);
      node = svc.seed(caseId, { type: isType(b.type) ? b.type : undefined, value: b.value, near: b.near });
      if (!node) return c.json({ error: 'could not understand that input' }, 400);
    }
    if (b.run === false) return c.json({ node });
    const run = orch.start(node, (b.context ?? '').trim());
    return c.json({ node, run });
  });
  app.get('/api/runs/:id/events', (c) => {
    const id = c.req.param('id');
    return streamSSE(c, async (stream) => {
      if (!hub.has(id)) {
        // Finished long ago (or server restarted): synthesize a terminal event so the client can settle.
        const r = store.getRun(id);
        if (r) {
          const fs = store.listFindings(r.caseId, { subjectId: r.subjectId });
          await stream.writeSSE({ data: JSON.stringify({ t: 'run.started', run: r, sources: r.sources } satisfies RunEvent) });
          await stream.writeSSE({ data: JSON.stringify({ t: 'findings', findings: fs } satisfies RunEvent) });
          await stream.writeSSE({ data: JSON.stringify({ t: 'run.done', run: r, totals: { findings: fs.length, sources: r.sources.length, ok: r.sources.filter((s) => s.state === 'done' || s.state === 'empty').length } } satisfies RunEvent) });
        }
        return;
      }
      let done: () => void = () => {};
      const finished = new Promise<void>((r) => (done = r));
      const queue: RunEvent[] = [];
      let pumping = false;
      const pump = async () => {
        if (pumping) return; pumping = true;
        while (queue.length) {
          const e = queue.shift()!;
          await stream.writeSSE({ data: JSON.stringify(e) });
          if (e.t === 'run.done' || e.t === 'run.error') done();
        }
        pumping = false;
      };
      const off = hub.subscribe(id, (e) => { queue.push(e); void pump(); });
      stream.onAbort(() => { off(); done(); });
      const ka = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }).catch(() => {}), 15_000);
      await finished;
      clearInterval(ka);
      off();
    });
  });
  // Re-derive the brief for a subject from stored findings, optionally biased by the investigator's context.
  app.post('/api/nodes/:id/brief', async (c) => {
    const node = store.getNode(c.req.param('id'));
    if (!node) return c.json({ error: 'not found' }, 404);
    const { context = '' } = await body<{ context?: string }>(c);
    const fs = store.listFindings(node.caseId, { subjectId: node.id });
    rescore(fs, reliabilityFn(store), context);
    const ids = citationIds(fs);
    const rules = ruleBrief({ type: node.type, value: node.value }, fs, ids);
    const have = new Set(store.listNodes(node.caseId).map((n) => `${n.type}:${keyFor(n.type, n.value)}`));
    const next = suggestNext(fs, have);
    const ai = fs.length ? await enhancer({ subject: node, findings: fs, context, fallback: rules, ids }).catch(() => null) : null;
    return c.json({ brief: ai ?? rules, next });
  });
  app.post('/api/runs/:id/cancel', (c) => { hub.cancel(c.req.param('id')); return c.json({ ok: true }); });

  // --- review & graph -----------------------------------------------------------------------------------------
  app.post('/api/findings/review', async (c) => {
    const b = await body<{ ids: string[]; status: FindingStatus }>(c);
    if (!Array.isArray(b.ids) || !['pending', 'accepted', 'rejected', 'unsure'].includes(b.status)) return c.json({ error: 'bad request' }, 400);
    return c.json({ findings: svc.review(b.ids.slice(0, 5000), b.status) });
  });
  app.post('/api/cases/:id/commit', async (c) => {
    const b = await body<{ subjectId?: string }>(c);
    return c.json(svc.commit(c.req.param('id'), b.subjectId));
  });
  app.patch('/api/nodes/:id', async (c) => {
    const b = await body<Record<string, unknown>>(c);
    const patch: Record<string, unknown> = {};
    if (typeof b.label === 'string') patch.label = b.label.slice(0, 200);
    if (typeof b.notes === 'string') patch.notes = b.notes.slice(0, 20000);
    for (const k of ['pinned', 'hidden'] as const) if (typeof b[k] === 'boolean') patch[k] = b[k];
    for (const k of ['x', 'y'] as const) if (typeof b[k] === 'number' && Number.isFinite(b[k] as number)) patch[k] = b[k];
    return c.json({ node: store.patchNode(c.req.param('id'), patch) });
  });
  app.delete('/api/nodes/:id', (c) => {
    const n = store.getNode(c.req.param('id'));
    if (n) { store.audit(n.caseId, 'node.deleted', `${n.type}:${n.value}`); store.deleteNode(n.id); }
    return c.json({ ok: true });
  });
  app.post('/api/nodes/:id/merge', async (c) => {
    const b = await body<{ into: string }>(c);
    const from = store.getNode(c.req.param('id'));
    const n = store.mergeNodes(b.into, c.req.param('id'));
    if (from && n) store.audit(from.caseId, 'node.merged', `${from.value} → ${n.value}`);
    return n ? c.json({ node: n }) : c.json({ error: 'merge failed' }, 400);
  });
  app.get('/api/nodes/:id/evidence', (c) => c.json({ findings: svc.evidenceForNode(c.req.param('id')) }));
  app.post('/api/cases/:id/positions', async (c) => {
    const b = await body<{ items: { id: string; x: number; y: number; pinned?: boolean }[] }>(c);
    store.savePositions((b.items ?? []).filter((i) => Number.isFinite(i.x) && Number.isFinite(i.y)));
    return c.json({ ok: true });
  });
  app.post('/api/cases/:id/edges', async (c) => {
    const b = await body<{ from: string; to: string; label?: string }>(c);
    const e = store.upsertEdge({ caseId: c.req.param('id'), from: b.from, to: b.to, label: (b.label ?? 'related').slice(0, 60), strength: 0.5, kind: 'manual' });
    store.audit(c.req.param('id'), 'edge.manual', `${b.from} → ${b.to}`);
    return c.json({ edge: e });
  });
  app.patch('/api/edges/:id', async (c) => {
    const b = await body<{ label?: unknown }>(c);
    if (typeof b.label !== 'string' || !b.label.trim()) return c.json({ error: 'label required' }, 400);
    store.setEdgeLabel(c.req.param('id'), b.label.trim().slice(0, 60));
    return c.json({ ok: true });
  });
  app.delete('/api/edges/:id', (c) => { store.deleteEdge(c.req.param('id')); return c.json({ ok: true }); });

  app.get('/api/cases/:id/suggestions', async (c) => {
    const caseId = c.req.param('id');
    const nodes = store.listNodes(caseId), edges = store.listEdges(caseId);
    const rules = inferLinks(nodes, edges);
    let ai: Awaited<ReturnType<typeof aiLinkHypotheses>> = [];
    if (c.req.query('ai') === '1' && aiReady(store).ok) {
      const facts = store.listFindings(caseId, { status: ['accepted'] }).map((f) => ({
        node: nodes.find((n) => n.type === f.type && keyFor(n.type, n.value, n.attrs) === f.key)?.id ?? f.subjectId,
        text: `${f.relation}: ${f.value}${f.evidence[0]?.snippet ? ` — ${f.evidence[0].snippet}` : ''}`,
      }));
      const have = new Set(edges.map((e) => `${e.from}|${e.to}`));
      ai = await aiLinkHypotheses(store, nodes, facts, have).catch(() => []);
    }
    return c.json({ suggestions: [...rules, ...ai] });
  });
  app.post('/api/cases/:id/links/accept', async (c) => {
    const b = await body<{ a: string; b: string; label: string; score: number; kind?: 'link' | 'merge' }>(c);
    if (b.kind === 'merge') {
      const n = store.mergeNodes(b.a, b.b);
      return n ? c.json({ merged: n }) : c.json({ error: 'merge failed' }, 400);
    }
    return c.json({ edge: svc.acceptLink(c.req.param('id'), b.a, b.b, b.label, b.score) });
  });

  // --- export -------------------------------------------------------------------------------------------------
  app.get('/api/cases/:id/report', (c) => {
    const id = c.req.param('id');
    const cs = store.getCase(id);
    if (!cs) return c.json({ error: 'not found' }, 404);
    const md = buildReport(cs, store.listNodes(id), store.listEdges(id), store.listFindings(id, { status: ['accepted'] }), { redact: c.req.query('redact') === '1' });
    store.audit(id, 'export.report', c.req.query('redact') === '1' ? 'markdown (redacted)' : 'markdown');
    return c.json({ markdown: md });
  });
  app.get('/api/cases/:id/export', (c) => {
    const id = c.req.param('id');
    const cs = store.getCase(id);
    if (!cs) return c.json({ error: 'not found' }, 404);
    store.audit(id, 'export.json', 'full case');
    return c.json({ plexus: 1, exportedAt: Date.now(), case: cs, nodes: store.listNodes(id), edges: store.listEdges(id), findings: store.listFindings(id), audit: store.listAudit(id) });
  });

  // --- sources & settings -------------------------------------------------------------------------------------
  app.get('/api/sources', (c) => c.json({ sources: sourceInfo(store), demo: demoMode(store) }));
  app.patch('/api/sources/:id', async (c) => {
    const b = await body<{ enabled?: boolean; priority?: number }>(c);
    const id = c.req.param('id');
    if (!getAdapter(id)) return c.json({ error: 'unknown source' }, 404);
    if (typeof b.enabled === 'boolean') store.setSourceEnabled(id, b.enabled);
    if (typeof b.priority === 'number') store.setSourcePriority(id, Math.round(b.priority));
    return c.json({ ok: true });
  });
  app.post('/api/sources/:id/test', async (c) => {
    const a = getAdapter(c.req.param('id'));
    if (!a) return c.json({ error: 'unknown source' }, 404);
    const t0 = Date.now();
    try {
      const key = getSecret(a.id);
      if (a.requiresKey && !a.keyOptional && !key) return c.json({ ok: false, error: 'No API key set', ms: 0 });
      const claims = await a.run({ type: a.selfTest.type, value: a.selfTest.value, key: keyFor(a.selfTest.type, a.selfTest.value) }, makeCtx(AbortSignal.timeout(25_000), key));
      store.recordSource(a.id, true, Date.now() - t0);
      return c.json({ ok: true, ms: Date.now() - t0, count: claims.length, sample: claims.slice(0, 3).map((x) => `${x.type}: ${x.value}`) });
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 200);
      store.recordSource(a.id, false, Date.now() - t0, msg);
      return c.json({ ok: false, error: msg, ms: Date.now() - t0 });
    }
  });
  app.put('/api/secrets/:name', async (c) => {
    const name = c.req.param('name');
    if (name !== 'ai' && !getAdapter(name)) return c.json({ error: 'unknown' }, 404);
    const b = await body<{ value: string | null }>(c);
    writeSecret(name, b.value?.trim() ? b.value.trim() : null);
    return c.json({ ok: true });
  });
  app.get('/api/settings', (c) => c.json({
    demoMode: demoMode(store), ai: aiSettings(store), aiReady: aiReady(store),
    region: store.getSetting('region', 'US'), onboarded: store.getSetting('onboarded', false), crossCheck: store.getSetting('crossCheck', true),
  }));
  app.put('/api/settings', async (c) => {
    const b = await body<{ demoMode?: boolean; ai?: Partial<typeof DEFAULT_AI>; region?: string; onboarded?: boolean; crossCheck?: boolean }>(c);
    if (typeof b.demoMode === 'boolean') store.setSetting('demoMode', b.demoMode);
    if (b.ai) store.setSetting('ai', { ...store.getSetting('ai', DEFAULT_AI), ...b.ai, keySet: undefined });
    if (b.region) store.setSetting('region', b.region);
    if (typeof b.onboarded === 'boolean') store.setSetting('onboarded', b.onboarded);
    if (typeof b.crossCheck === 'boolean') store.setSetting('crossCheck', b.crossCheck);
    return c.json({ ok: true });
  });
  app.get('/api/ai/models', async (c) => {
    try { return c.json({ models: await listModels(store) }); } catch (e: any) { return c.json({ models: [], error: String(e?.message ?? e) }); }
  });
  app.post('/api/ai/test', async (c) => {
    try {
      const r = await complete(store, [{ role: 'user', content: 'Reply with the single word: ok' }], { timeoutMs: 30_000 });
      return c.json({ ok: true, model: r.model });
    } catch (e: any) { return c.json({ ok: false, error: String(e?.message ?? e) }); }
  });
  app.post('/api/cache/clear', (c) => { store.cacheClear(); return c.json({ ok: true }); });

  // --- static web app (production) ---------------------------------------------------------------------------
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = [resolve(here, '../dist/web'), resolve(here, '../web'), resolve(here, '../../dist/web')].find((d) => existsSync(resolve(d, 'index.html')));
  if (dist) {
    const rel = relative(process.cwd(), dist) || '.';
    app.use('/*', serveStatic({ root: rel }));
    app.get('*', (c) => c.html(readFileSync(resolve(dist, 'index.html'), 'utf8')));
  }
  return { app, store, orch, hub, svc };
}

/** Start listening on localhost (used by the CLI entry below and by the desktop shell). */
export function serveApp(app: Hono, port = PORT) {
  return serve({ fetch: app.fetch, port, hostname: HOST });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.removeAllListeners('warning');
  const { app } = await createApp();
  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (i) => {
    console.log(`${APP_NAME} is running at http://localhost:${i.port}  (data: ${HOME})`);
    console.log(`${allAdapters().length} sources registered`);
  });
}
