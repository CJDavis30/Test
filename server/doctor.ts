import type { Adapter } from './adapters/types';
import { RateLimitedError } from './adapters/types';
import { allAdapters, usable } from './registry';
import { getSecret } from './config';
import { makeCtx } from './http';
import { keyFor } from '../shared/normalize';
import type { Store } from './store';

/**
 * Source Doctor: runs every source against its known-good example and says which work, which are quiet, and which have broken, and why
 * (blocked, address gone, changed format, down, rate limited), so a dead source is a fact on a screen instead of a mystery.
 */
export type Health = 'ok' | 'quiet' | 'blocked' | 'gone' | 'rate' | 'broken' | 'down' | 'needs_key' | 'skipped';
export interface DoctorRow { id: string; name: string; status: Health; ms: number; count: number; detail: string; advice: string; at: number }
export interface DoctorState { running: boolean; total: number; done: number; startedAt?: number; finishedAt?: number; rows: DoctorRow[] }

const WIDE = new Set(['username-sweep', 'wmn-sweep']);

export function classify(err: unknown): { status: Exclude<Health, 'ok' | 'quiet' | 'needs_key' | 'skipped'>; advice: string } {
  const m = String((err as any)?.message ?? err);
  if (err instanceof RateLimitedError || /\b429\b|rate.?limit/i.test(m)) return { status: 'rate', advice: 'The service is limiting requests. It will work again later; a key (if it offers one) raises the limit.' };
  if (/HTTP (401|403)\b|forbidden|unauthori[sz]ed|invalid.*key/i.test(m)) return { status: 'blocked', advice: 'The service refused the request. It may need a key, or block automated lookups from this network. Add a key in Settings, or turn this source off.' };
  if (/HTTP (404|410)\b|ENOTFOUND|getaddrinfo/i.test(m)) return { status: 'gone', advice: 'The address no longer answers. The service may have moved or shut down. Turn this source off.' };
  if (/non-JSON|valid JSON|JSON|Unexpected token|Unexpected end/i.test(m)) return { status: 'broken', advice: 'The service answered in a format Plexus does not expect, which usually means it changed. Turn this source off until it is updated.' };
  if (/HTTP 5\d\d|ECONN|ETIMEDOUT|EAI_AGAIN|Timed out|timeout|aborted|fetch failed|socket|network|certificate/i.test(m)) return { status: 'down', advice: 'The service is unreachable or too slow right now. Try again later; if it stays this way, turn it off.' };
  return { status: 'broken', advice: 'It failed in a way Plexus does not recognise. Details are shown; turn it off if it keeps failing.' };
}

export async function checkOne(store: Store, a: Adapter, opts: { timeoutMs?: number } = {}): Promise<DoctorRow> {
  const base = { id: a.id, name: a.name, at: Date.now() };
  const u = usable(store, a);
  if (!u.ok && u.reason === 'needs_key') return { ...base, status: 'needs_key', ms: 0, count: 0, detail: 'No API key set', advice: 'Add a key in Settings → Sources to use this source.' };
  if (!u.ok && u.reason === 'mode') return { ...base, status: 'skipped', ms: 0, count: 0, detail: 'Not available here', advice: '' };
  if (WIDE.has(a.id)) return { ...base, status: 'skipped', ms: 0, count: 0, detail: 'Checks many sites', advice: 'This one checks hundreds of sites, so test it on its own with its Test button.' };
  const t0 = Date.now();
  try {
    const claims = await a.run({ type: a.selfTest.type, value: a.selfTest.value, key: keyFor(a.selfTest.type, a.selfTest.value) }, makeCtx(AbortSignal.timeout(opts.timeoutMs ?? 25_000), getSecret(a.id)));
    const ms = Date.now() - t0;
    if (claims.length) return { ...base, status: 'ok', ms, count: claims.length, detail: `${claims.length} result${claims.length === 1 ? '' : 's'} for the example`, advice: '' };
    return { ...base, status: 'quiet', ms, count: 0, detail: 'Answered, but found nothing for a known example', advice: 'It may be fine (some examples have no public record) or the service may have changed what it returns. If it never finds anything for real lookups either, turn it off.' };
  } catch (e) {
    const c = classify(e);
    return { ...base, status: c.status, ms: Date.now() - t0, count: 0, detail: String((e as any)?.message ?? e).slice(0, 160), advice: c.advice };
  }
}

class Doctor {
  private s: DoctorState = { running: false, total: 0, done: 0, rows: [] };
  state(store?: Store): DoctorState {
    if (!this.s.rows.length && store) { const saved = store.getSetting<{ rows: DoctorRow[]; finishedAt: number } | null>('doctor', null); if (saved) return { running: false, total: saved.rows.length, done: saved.rows.length, rows: saved.rows, finishedAt: saved.finishedAt }; }
    return { ...this.s, rows: [...this.s.rows] };
  }
  start(store: Store, opts: { adapters?: Adapter[]; concurrency?: number; timeoutMs?: number } = {}): DoctorState {
    if (this.s.running) return this.state();
    const list = opts.adapters ?? allAdapters();
    this.s = { running: true, total: list.length, done: 0, startedAt: Date.now(), rows: [] };
    const queue = [...list];
    const worker = async () => { for (let a = queue.shift(); a; a = queue.shift()) { const row = await checkOne(store, a, { timeoutMs: opts.timeoutMs }); this.s.rows.push(row); this.s.done++; } };
    void Promise.all(Array.from({ length: opts.concurrency ?? 5 }, worker)).then(() => {
      this.s.running = false; this.s.finishedAt = Date.now();
      this.s.rows.sort((x, y) => x.name.localeCompare(y.name));
      try { store.setSetting('doctor', { rows: this.s.rows, finishedAt: this.s.finishedAt }); } catch { /* the report is still on screen */ }
    });
    return this.state();
  }
}
export const doctor = new Doctor();
