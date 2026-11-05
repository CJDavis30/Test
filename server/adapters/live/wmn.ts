import type { Claim } from '../../../shared/types';
import type { AdapterCtx } from '../types';
import { adapter, arr, rec, str } from './util';
import { SITES } from './sweep';
import { extendHow, extendLookup } from '../how';

/**
 * WhatsMyName: the community-maintained list of how to tell whether a username exists on hundreds of sites. Plexus downloads the
 * current list (cached for a day), and only trusts a site after a made-up name comes back "absent" there, so sites that answer
 * "found" for everything never produce a result. A hit means the name is taken on that site, not that it is the same person.
 * Adult and dating sites in the list are skipped on purpose.
 */
export const WMN_URL = 'https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json';
export interface WmnSite { name: string; uri_check: string; uri_pretty?: string; e_code: number; e_string?: string; m_string?: string; m_code?: number; cat?: string; post_body?: string; headers?: Record<string, string>; valid?: boolean }
const SKIP_CATS = /nsfw|adult|dating|xxx/i;
const CONTROL = 'plx-ctrl-zq9x4k7w2m';
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

let cache: { at: number; sites: WmnSite[] } | null = null;
const trust = new Map<string, { ok: boolean; at: number }>();
export const resetWmn = () => { cache = null; trust.clear(); };

export async function loadWmn(ctx: AdapterCtx): Promise<WmnSite[]> {
  if (cache && Date.now() - cache.at < 24 * 3600_000) return cache.sites;
  const res = await ctx.fetch(WMN_URL, { timeoutMs: 20000 });
  if (!res.ok) throw new Error(`Could not download the WhatsMyName list (HTTP ${res.status})`);
  const text = await res.text();
  if (text.length > 6_000_000) throw new Error('The WhatsMyName list is larger than expected');
  let j: any; try { j = JSON.parse(text); } catch { throw new Error('The WhatsMyName list was not valid JSON'); }
  const mine = new Set(SITES.map((s) => norm(s.name)));
  const sites = arr<WmnSite>(j?.sites).filter((s) => str(s?.name) && typeof s.uri_check === 'string' && s.uri_check.includes('{account}') && /^https:\/\//.test(s.uri_check) && !s.post_body && s.valid !== false && Number.isFinite(s.e_code) && !SKIP_CATS.test(str(s.cat)) && !mine.has(norm(s.name)));
  cache = { at: Date.now(), sites };
  return sites;
}

export type Verdict = 'present' | 'absent' | 'unknown';
export function verdict(s: WmnSite, status: number, body: string): Verdict {
  if (status === 429 || status === 403 || status === 401 || status >= 500 || status === 0) return 'unknown';
  if (s.m_string && body.includes(s.m_string)) return 'absent';
  if (s.m_code !== undefined && status === s.m_code && status !== s.e_code) return 'absent';
  if (status === s.e_code && (!s.e_string || body.includes(s.e_string))) return 'present';
  if (status === 404 || status === 410) return 'absent';
  return 'unknown';
}

async function check(s: WmnSite, user: string, ctx: AdapterCtx): Promise<Verdict> {
  const url = s.uri_check.replace('{account}', encodeURIComponent(user));
  const res = await ctx.fetch(url, { timeoutMs: 8000, headers: { Accept: 'text/html,application/json,*/*', ...(s.headers ?? {}) } });
  const need = !!(s.e_string || s.m_string);
  const body = need ? (await res.text()).slice(0, 400_000) : '';
  if (!need) res.body?.cancel().catch(() => {});
  return verdict(s, res.status, body);
}
async function trusted(s: WmnSite, ctx: AdapterCtx): Promise<boolean> {
  const c = trust.get(s.name); if (c && Date.now() - c.at < 24 * 3600_000) return c.ok;
  const v = await check(s, CONTROL, ctx).catch(() => 'unknown' as Verdict);
  if (v === 'unknown') return false;
  const ok = v === 'absent'; trust.set(s.name, { ok, at: Date.now() }); return ok;
}

export const wmnSweep = adapter({
  id: 'wmn-sweep', name: 'Username sweep: WhatsMyName (600+ sites)', description: 'Checks the same handle on the 600+ sites in the WhatsMyName list (gaming, social, forums, creative, coding, finance and more). A hit means the name is taken there, not that it is the same person.', homepage: 'https://github.com/WebBreacher/WhatsMyName',
  accepts: ['username'], capability: 'username-sweep', family: 'sweep', reliability: 0.55, minIntervalMs: 0, cacheTtlMs: 12 * 3600_000, timeoutMs: 150_000,
  selfTest: { type: 'username', value: 'torvalds' },
  async run(e, ctx) {
    const u = e.value.replace(/^@/, '');
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(u)) return [];
    const sites = await loadWmn(ctx);
    const queue = [...sites], out: Claim[] = [], deadline = Date.now() + 110_000;
    let checked = 0, unknown = 0;
    const worker = async () => {
      for (let s = queue.shift(); s && Date.now() < deadline && !ctx.signal.aborted; s = queue.shift()) {
        try {
          if (!(await trusted(s, ctx))) continue;
          const v = await check(s, u, ctx); checked++;
          if (v === 'unknown') { unknown++; continue; }
          if (v === 'present' && out.length < 90) {
            const url = (s.uri_pretty || s.uri_check).replace('{account}', encodeURIComponent(u));
            out.push({ type: 'account', value: url, relation: 'same handle exists', weight: 0.28, url, attrs: { platform: s.name, category: str(s.cat) }, snippet: `“${u}” is registered on ${s.name}${s.cat ? ` (${s.cat})` : ''}. Name match only.`, record: rec(`${s.name} username`, [['Username', u], ['Site', s.name], ['Category', s.cat], ['Page', url], ['What this means', 'The name is taken on this site. It does not show it is the same person.']]) });
          }
        } catch { unknown++; }
      }
    };
    await Promise.all(Array.from({ length: 14 }, worker));
    void checked; void unknown;
    return out;
  },
});
extendHow({ 'wmn-sweep': (_t, q) => `Checked whether the username ${q} is taken on the 600+ sites in the WhatsMyName list` });
extendLookup({ 'wmn-sweep': (_t, v) => `https://whatsmyname.app/?q=${encodeURIComponent(v)}` });
