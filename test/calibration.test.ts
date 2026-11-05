// Accuracy benchmark. The demo world has known ground truth (including deliberate false leads), so we can measure
// whether the confidence Plexus shows is honest: does "85%" come true about 85% of the time, are false leads kept low,
// and is the good stuff found? The thresholds below are the contract; the printed table is what to read when tuning.
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-cal-'));
process.env.PLEXUS_DEMO_FAST = '1';
const { createApp } = await import('../server/index');
const { Store } = await import('../server/store');
const { demoGroundTruth } = await import('../server/adapters/demo');
import type { Finding, RunEvent } from '../shared/types';

const H = { 'content-type': 'application/json', 'x-plexus': '1', host: 'localhost:4317' };
let ctx: Awaited<ReturnType<typeof createApp>>;
let caseId: string;
const call = async (method: string, path: string, body?: unknown) => (await (await ctx.app.request(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined })).json()) as any;

async function lookup(value: string): Promise<Finding[]> {
  const json = await call('POST', `/api/cases/${caseId}/lookups`, { value });
  const all = new Map<string, Finding>();
  await new Promise<void>((resolve) => {
    let off: () => void = () => {}; let finished = false;
    off = ctx.hub.subscribe(json.run.id, (e: RunEvent) => {
      if (e.t === 'findings') for (const f of e.findings) all.set(f.id, f);
      if (e.t === 'run.done' || e.t === 'run.error') { finished = true; off(); resolve(); }
    });
    if (finished) off();
  });
  return [...all.values()];
}

const SUBJECTS = ['Mara Linden', 'mara.linden@northwind-labs.example', 'maralinden', 'northwind-labs.example', 'Northwind Labs'];
let rows: { f: Finding; truth: 0 | 1 | null; subject: string }[] = [];

beforeAll(async () => {
  ctx = await createApp(new Store(join(process.env.PLEXUS_HOME!, 'cal.db')));
  ctx.store.setSetting('demoMode', true);
  caseId = (await call('POST', '/api/cases', { name: 'Calibration', purpose: 'benchmark' })).case.id;
  const { keyFor } = await import('../shared/normalize');
  const gt = demoGroundTruth();
  for (const s of SUBJECTS) {
    for (const f of await lookup(s)) {
      const key = `${f.type}|${keyFor(f.type, f.value, f.attrs)}`;
      rows.push({ f, subject: s, truth: gt.ambiguous.has(key) ? null : gt.truth.has(key) ? 1 : 0 });
    }
  }
}, 120_000);

const scored = () => rows.filter((r) => r.truth !== null) as { f: Finding; truth: 0 | 1; subject: string }[];

export function metrics(rs: { f: Finding; truth: 0 | 1 }[]) {
  const n = rs.length;
  const brier = rs.reduce((a, r) => a + (r.f.score - r.truth) ** 2, 0) / n;
  const bins = [[0, 0.4], [0.4, 0.65], [0.65, 0.85], [0.85, 1.01]].map(([lo, hi]) => {
    const b = rs.filter((r) => r.f.score >= lo && r.f.score < hi);
    return { range: `${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%`, n: b.length, meanConf: b.length ? b.reduce((a, r) => a + r.f.score, 0) / b.length : 0, hit: b.length ? b.reduce((a, r) => a + r.truth, 0) / b.length : 0 };
  });
  const ece = bins.reduce((a, b) => a + (b.n / n) * Math.abs(b.meanConf - b.hit), 0);
  return { n, brier, ece, bins };
}

describe('accuracy benchmark (demo world with ground truth)', () => {
  it('prints the calibration table', () => {
    const m = metrics(scored());
    const lines = [`n=${m.n}  Brier=${m.brier.toFixed(3)}  ECE=${m.ece.toFixed(3)}`, ...m.bins.map((b) => `  ${b.range.padEnd(9)} n=${String(b.n).padStart(3)}  says ${(b.meanConf * 100).toFixed(0)}%  true ${(b.hit * 100).toFixed(0)}%`)];
    console.log('\nCALIBRATION\n' + lines.join('\n'));
    expect(m.n).toBeGreaterThan(60);
  });

  it('never rates a deliberate false lead as likely', () => {
    const bad = rows.filter((r) => r.truth === 0 && r.f.level >= 3).map((r) => `${r.f.value} (${r.subject}) ${Math.round(r.f.score * 100)}%`);
    expect(bad).toEqual([]);
  });

  it('is precise where it claims to be sure, and finds most of what is real', () => {
    const rs = scored();
    const sure = rs.filter((r) => r.f.level >= 3);
    const precision = sure.reduce((a, r) => a + r.truth, 0) / sure.length;
    const real = rs.filter((r) => r.truth === 1);
    const recall = real.filter((r) => r.f.level >= 2).length / real.length;
    console.log(`precision@likely=${precision.toFixed(3)} (${sure.length})  recall@possible=${recall.toFixed(3)} (${real.length})`);
    expect(precision).toBeGreaterThanOrEqual(0.97);
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it('ranks truth above falsehood (AUC) and separates them cleanly', () => {
    const rs = scored();
    const pos = rs.filter((r) => r.truth === 1).map((r) => r.f.score), neg = rs.filter((r) => r.truth === 0).map((r) => r.f.score);
    let wins = 0; for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
    const auc = wins / (pos.length * neg.length);
    console.log(`AUC=${auc.toFixed(3)}  best false lead=${Math.max(...neg).toFixed(2)}  worst true finding=${Math.min(...pos).toFixed(2)}`);
    expect(auc).toBeGreaterThanOrEqual(0.98);
    expect(Math.max(...neg)).toBeLessThan(0.4); // every false lead stays in the lowest band
  });

  it('is never overconfident, and confidence is monotone (higher bands are right at least as often)', () => {
    // This demo world is ~95% true, so absolute calibration would just reflect that base rate. What must hold regardless of base rate:
    // a band never claims more than it delivers (overconfidence is the dangerous direction), and bands are ordered.
    const m = metrics(scored());
    const filled = m.bins.filter((b) => b.n >= 3);
    for (const b of filled.filter((x) => !x.range.startsWith('0–'))) expect(b.meanConf - b.hit, `${b.range} overclaims: says ${b.meanConf.toFixed(2)}, true ${b.hit.toFixed(2)}`).toBeLessThanOrEqual(0.1);
    const low = filled.find((x) => x.range.startsWith('0–')); if (low) expect(low.hit, 'the unlikely band must mostly be wrong').toBeLessThanOrEqual(0.4);
    for (let i = 1; i < filled.length; i++) expect(filled[i].hit, `${filled[i].range} should be right at least as often as ${filled[i - 1].range}`).toBeGreaterThanOrEqual(filled[i - 1].hit);
    expect(m.brier).toBeLessThanOrEqual(0.15);
  });

  it('keeps the confidence ordering sensible: more independent sources never score lower than fewer, on average', () => {
    const rs = scored();
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const by = (k: number) => mean(rs.filter((r) => Math.min(3, new Set(r.f.evidence.filter((e) => e.polarity !== 'against').map((e) => e.family)).size) === k).map((r) => r.f.score));
    expect(by(2)).toBeGreaterThan(by(1));
    expect(by(3)).toBeGreaterThanOrEqual(by(2));
  });
});
