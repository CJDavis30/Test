import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { complete, extractJson, type Msg } from './ai';
import type { Store } from './store';
import { weatherAt, weatherUrl, type WeatherAt } from '../shared/tools/weather';
import { buildDomainReport, type DomainReport } from '../shared/tools/domain';
import { gravatarHash, gravatarProfileUrl, gravatarUrl } from '../shared/tools/emails';
import { SCREENSHOT_SYSTEM, parseScreenshotReply, type ScreenReading } from '../shared/tools/screenshot';
import { normalizeDomain } from '../shared/normalize';
import { USER_AGENT } from './config';

type F = typeof fetch;
const ua = { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*' };
async function getJson(f: F, url: string, ms = 15000): Promise<any> {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
  try { const r = await f(url, { headers: ua, signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } finally { clearTimeout(to); }
}

export async function weatherFor(f: F, lat: number, lon: number, iso: string): Promise<WeatherAt | null> {
  const j = await getJson(f, weatherUrl(lat, lon, iso));
  return weatherAt(j, iso);
}

export interface GravatarHit { email: string; hash: string; exists: boolean; avatar?: string; displayName?: string; about?: string; accounts?: { name: string; url: string }[]; error?: string }
/** A Gravatar that exists means the address is registered with a real person's avatar. 404 means no Gravatar, which says nothing either way. */
export async function gravatarCheck(f: F, emails: string[], concurrency = 4): Promise<GravatarHit[]> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 40);
  const out: GravatarHit[] = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    for (;;) {
      const i = next++; if (i >= list.length) return;
      const email = list[i], hash = gravatarHash(email);
      try {
        const r = await f(gravatarUrl(email, 128, '404'), { method: 'GET', headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
        if (r.status === 404) { out[i] = { email, hash, exists: false }; continue; }
        if (!r.ok) { out[i] = { email, hash, exists: false, error: `HTTP ${r.status}` }; continue; }
        const hit: GravatarHit = { email, hash, exists: true, avatar: gravatarUrl(email, 200, '404') };
        try { const p = (await getJson(f, gravatarProfileUrl(email), 8000))?.entry?.[0]; if (p) { hit.displayName = p.displayName || p.name?.formatted; hit.about = p.aboutMe; hit.accounts = (p.accounts ?? []).slice(0, 12).map((a: any) => ({ name: String(a.shortname ?? a.domain ?? ''), url: String(a.url ?? '') })).filter((a: any) => a.url); } } catch { /* the avatar alone is the finding */ }
        out[i] = hit;
      } catch (e: any) { out[i] = { email, hash, exists: false, error: String(e?.message ?? e) }; }
    }
  }));
  return out;
}

export async function domainHistory(f: F, raw: string): Promise<DomainReport> {
  const domain = normalizeDomain(raw);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new Error('That is not a domain name');
  const [rdap, certs, cdx] = await Promise.allSettled([
    getJson(f, `https://rdap.org/domain/${encodeURIComponent(domain)}`, 15000),
    getJson(f, `https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json`, 25000),
    getJson(f, `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&fl=timestamp,statuscode&collapse=timestamp:6&limit=3000`, 25000),
  ]);
  const rep = buildDomainReport(domain, { rdap: rdap.status === 'fulfilled' ? rdap.value : undefined, certs: certs.status === 'fulfilled' ? certs.value : undefined, cdx: cdx.status === 'fulfilled' ? cdx.value : undefined });
  const failed = ([['registration record', rdap], ['certificate log', certs], ['Internet Archive', cdx]] as const).filter(([, r]) => r.status === 'rejected').map(([n]) => n);
  if (failed.length) rep.insights.push({ level: 'notice', text: `Could not reach: ${failed.join(', ')}. The timeline is missing that part.` });
  return rep;
}

// ---------------------------------------------------------------------------------------------------------------- redirects
const privateV4 = (ip: string) => { const p = ip.split('.').map(Number); return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224; };
export async function hostIsPublic(host: string): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local$|\.internal$/i.test(h)) return false;
  try {
    const addrs = isIP(h) ? [{ address: h }] : await lookup(h, { all: true });
    return addrs.length > 0 && addrs.every((a) => (isIP(a.address) === 4 ? !privateV4(a.address) : !/^(::1?$|fe80:|fc|fd|::ffff:(10|127|192\.168|172\.(1[6-9]|2\d|3[01])|169\.254)\.)/i.test(a.address)));
  } catch { return false; }
}
export interface Hop { url: string; status: number; location?: string; server?: string; note?: string }
/** Follow a link one hop at a time without downloading the page, refusing anything that points at a private network. */
export async function traceRedirects(f: F, start: string, max = 10): Promise<{ hops: Hop[]; final?: string; stopped?: string }> {
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(start) ? start : 'https://' + start); } catch { throw new Error('That is not a link'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https links can be followed');
  const hops: Hop[] = [];
  for (let i = 0; i < max; i++) {
    if (!(await hostIsPublic(url.hostname))) return { hops, stopped: `Stopped: ${url.hostname} is not a public internet address (Plexus will not contact private networks).` };
    let r: Response;
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
    try {
      r = await f(url.toString(), { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': USER_AGENT }, signal: ctl.signal });
      if (r.status === 405 || r.status === 501) r = await f(url.toString(), { method: 'GET', redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-0' }, signal: ctl.signal });
    } catch (e: any) { clearTimeout(to); hops.push({ url: url.toString(), status: 0, note: String(e?.message ?? e) }); return { hops, stopped: 'Stopped: the server did not answer.' }; }
    clearTimeout(to);
    const loc = r.headers.get('location') ?? undefined;
    hops.push({ url: url.toString(), status: r.status, location: loc, server: r.headers.get('server') ?? undefined });
    if (r.status >= 300 && r.status < 400 && loc) { try { url = new URL(loc, url); } catch { return { hops, stopped: 'Stopped: the redirect address is not valid.' }; } continue; }
    return { hops, final: url.toString() };
  }
  return { hops, stopped: `Stopped after ${max} hops (a loop or a very long chain).` };
}

// ---------------------------------------------------------------------------------------------------------------- screenshot reader
export async function readScreenshot(store: Store, image: string, fetchImpl?: F): Promise<ScreenReading> {
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(image)) throw new Error('Choose a PNG, JPEG, WebP or GIF image');
  if (image.length > 12_000_000) throw new Error('That image is too large (9 MB at most)');
  const msgs: Msg[] = [{ role: 'system', content: SCREENSHOT_SYSTEM }, { role: 'user', content: [{ type: 'text', text: 'Transcribe this screenshot as instructed. JSON only.' }, { type: 'image_url', image_url: { url: image, detail: 'high' } }] }];
  const r = await complete(store, msgs, { vision: true, temperature: 0.1, timeoutMs: 120_000, fetchImpl });
  const reading = parseScreenshotReply(extractJson(r.text));
  if (!reading) throw new Error('The model did not return a readable answer. Try again, or a different vision model in Settings.');
  return reading;
}
