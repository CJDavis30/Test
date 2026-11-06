import type { Claim } from '../../../shared/types';
import { readPage } from '../../../shared/pagefacts';
import { leadsFromText, leadClaims, HUB_HOSTS } from '../../../shared/leads';
import { platformOfUrl } from '../../../shared/handles';
import { hostIsPublic } from '../../netsafe';
import { RateLimitedError, type Adapter, type AdapterCtx } from '../types';
import { adapter, rec } from './util';
import { extendHow, extendLookup } from '../how';

/**
 * Reads the page itself. A profile or link-hub page lists the owner's other profiles in plain sight; Plexus follows those, then checks
 * the other side for a link back. Redirects are followed one at a time and never into a private network. Everything it returns is the
 * page's own statement, so it is labelled self-reported.
 */
const MAX_HOPS = 4;

async function fetchPage(ctx: AdapterCtx, start: string): Promise<{ html: string; url: string; status: number } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let u: URL; try { u = new URL(url); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || !(await hostIsPublic(u.hostname))) return null;
    const res = await ctx.fetch(url, { timeoutMs: 12_000, redirect: 'manual', headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } } as any);
    if (res.status === 429) throw new RateLimitedError();
    if (res.status >= 300 && res.status < 400) { const loc = res.headers.get('location'); res.body?.cancel().catch(() => {}); if (!loc) return null; url = new URL(loc, url).toString(); continue; }
    if (res.status === 404 || res.status === 410) { res.body?.cancel().catch(() => {}); return { html: '', url, status: res.status }; }
    if (!res.ok) { res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
    const type = res.headers.get('content-type') ?? '';
    if (type && !/html|xml|text/i.test(type)) { res.body?.cancel().catch(() => {}); return null; }
    return { html: (await res.text()).slice(0, 700_000), url, status: res.status };
  }
  return null;
}

export const pageReader: Adapter = adapter({
  id: 'page-reader', name: 'Reads the linked page', description: 'Opens a profile or link page and reads what the owner wrote there: bio, links to their other accounts, contact details. Follows redirects safely and never contacts private networks.',
  accepts: ['account', 'url'], capability: 'profile-page', family: 'page', reliability: 0.6, minIntervalMs: 900, cacheTtlMs: 6 * 3600_000,
  selfTest: { type: 'url', value: 'https://github.com/torvalds' },
  async run(e, ctx) {
    const got = await fetchPage(ctx, /^[a-z]+:\/\//i.test(e.value) ? e.value : `https://${e.value}`);
    if (!got || !got.html) return [];
    const page = readPage(got.html, got.url);
    if (page.missing) return [];
    let host = ''; try { host = new URL(got.url).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
    const where = page.siteName ?? (platformOfUrl(got.url)?.platform.name ?? host);
    const out: Claim[] = [];
    const record = rec(`${where} page`, [['Title', page.title], ['Description', page.description], ['Followers', page.followers?.toLocaleString('en-US')], ['Following', page.following?.toLocaleString('en-US')], ['Posts', page.posts?.toLocaleString('en-US')], ['Links to', [...new Set(page.links.map((l) => platformOfUrl(l.href)?.platform.name).filter(Boolean))].join(', ')]]);
    // text the owner wrote: share description plus the visible text near the top. Leads come from both, and from every outbound link.
    const own = [page.description, page.title, page.text.slice(0, 1800)].filter(Boolean).join('\n');
    const pageHost = host;
    const hrefs = page.links.filter((l) => { try { return new URL(l.href).hostname.replace(/^www\./, '') !== pageHost || HUB_HOSTS.test(pageHost); } catch { return false; } });
    const relMe = new Set(page.links.filter((l) => /\bme\b/.test(l.rel)).map((l) => l.href));
    const leads = leadsFromText(`${own}\n${hrefs.map((l) => l.href).join('\n')}`, 40);
    for (const c of leadClaims(leads, `the page at ${host}`, got.url, { link: 0.62, mention: 0.5, hub: 0.55 })) {
      // a link the owner marked rel="me" is how Mastodon, GitHub and others say "this is also me": strongest self-reported tie
      if (c.type === 'account' && relMe.has(c.value)) c.weight = Math.max(c.weight, 0.78);
      out.push({ ...c, record });
    }
    for (const m of page.mailto) out.push({ type: 'email', value: m, relation: 'email on this page', weight: 0.6, url: got.url, basis: 'self-reported', snippet: `Listed on the ${where} page`, record });
    return out.map((c) => ({ ...c, basis: c.basis ?? 'self-reported' }));
  },
});

extendHow({ 'page-reader': (t, q) => `Opened ${q} and read what the owner wrote there (bio, links to other accounts, contact details)` });
extendLookup({ 'page-reader': (_t, v) => (/^https?:\/\//i.test(v) ? v : `https://duckduckgo.com/?q=${encodeURIComponent(v)}`) });
export const pageAdapters: Adapter[] = [pageReader];
