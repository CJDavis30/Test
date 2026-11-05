import type { Claim, EntityType } from '../../../shared/types';
import type { Adapter, AdapterCtx, Entity } from '../types';
import { RateLimitedError } from '../types';
import { adapter } from './util';
import { extendHow, extendLookup } from '../how';

export { arr, str, iso, fullIso, claim, rec, withRecord, getJson, bioClaims, md5, countryName } from './util';

/** A source in one declaration: what it is, what it asked, and the page to repeat the lookup by hand. */
export interface Def {
  id: string; name: string; desc: string; homepage: string;
  accepts: EntityType[]; cap: string; family: string; rel: number;
  self: [EntityType, string];
  asked: (q: string, t: EntityType) => string;
  check: (t: EntityType, v: string) => string;
  key?: { optional?: boolean; help: string };
  interval?: number; prio?: number; ttl?: number;
  run: (e: Entity, ctx: AdapterCtx) => Promise<Claim[]>;
}
export function def(d: Def): Adapter {
  extendHow({ [d.id]: (t, q) => d.asked(q, t as EntityType) });
  extendLookup({ [d.id]: d.check });
  return adapter({
    id: d.id, name: d.name, description: d.desc, homepage: d.homepage, accepts: d.accepts, capability: d.cap, family: d.family, reliability: d.rel,
    priority: d.prio ?? 5, minIntervalMs: d.interval ?? 600, cacheTtlMs: d.ttl,
    ...(d.key ? { requiresKey: d.id, keyOptional: d.key.optional, keyHelp: d.key.help } : {}),
    selfTest: { type: d.self[0], value: d.self[1] }, run: d.run,
  });
}

export const enc = encodeURIComponent;

/** GET text. null for "not there" (404/410), RateLimitedError for 429, an error for anything else that fails. */
export async function getText(ctx: AdapterCtx, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string | null> {
  const res = await ctx.fetch(url, init);
  if (res.status === 404 || res.status === 410) return null;
  if (res.status === 429) throw new RateLimitedError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).slice(0, 2_000_000);
}

/** A meta tag's content (og:title, description, …) from an HTML page. */
export function meta(html: string, name: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name.replace(/[:.]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name.replace(/[:.]/g, '\\$&')}["']`, 'i');
  const m = re.exec(html);
  const v = m?.[1] ?? m?.[2];
  return v ? v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : undefined;
}

/** Hosts whose links mean "this person has an account there". */
const HOSTS: [RegExp, string, (u: URL) => string | null][] = [
  [/(^|\.)(twitter|x)\.com$/, 'X', (u) => seg(u)], [/(^|\.)instagram\.com$/, 'Instagram', (u) => seg(u)], [/(^|\.)tiktok\.com$/, 'TikTok', (u) => seg(u)?.replace(/^@/, '') ?? null],
  [/(^|\.)youtube\.com$/, 'YouTube', (u) => seg(u)], [/(^|\.)twitch\.tv$/, 'Twitch', (u) => seg(u)], [/(^|\.)github\.com$/, 'GitHub', (u) => seg(u)], [/(^|\.)gitlab\.com$/, 'GitLab', (u) => seg(u)],
  [/(^|\.)facebook\.com$/, 'Facebook', (u) => seg(u)], [/(^|\.)linkedin\.com$/, 'LinkedIn', (u) => u.pathname.split('/')[2] ?? null], [/(^|\.)reddit\.com$/, 'Reddit', (u) => u.pathname.split('/')[2] ?? null],
  [/(^|\.)t\.me$/, 'Telegram', (u) => seg(u)], [/(^|\.)snapchat\.com$/, 'Snapchat', (u) => u.pathname.split('/')[2] ?? null], [/(^|\.)pinterest\.com$/, 'Pinterest', (u) => seg(u)],
  [/(^|\.)steamcommunity\.com$/, 'Steam', (u) => u.pathname.split('/')[2] ?? null], [/(^|\.)discord\.(gg|com)$/, 'Discord', (u) => u.pathname.split('/').pop() || null],
  [/(^|\.)spotify\.com$/, 'Spotify', (u) => u.pathname.split('/')[2] ?? null], [/(^|\.)soundcloud\.com$/, 'SoundCloud', (u) => seg(u)], [/(^|\.)patreon\.com$/, 'Patreon', (u) => seg(u)],
  [/(^|\.)ko-fi\.com$/, 'Ko-fi', (u) => seg(u)], [/(^|\.)bsky\.app$/, 'Bluesky', (u) => u.pathname.split('/')[2] ?? null], [/(^|\.)threads\.net$/, 'Threads', (u) => seg(u)?.replace(/^@/, '') ?? null],
  [/(^|\.)medium\.com$/, 'Medium', (u) => seg(u)?.replace(/^@/, '') ?? null], [/(^|\.)roblox\.com$/, 'Roblox', (u) => u.pathname.split('/')[2] ?? null], [/(^|\.)vk\.com$/, 'VK', (u) => seg(u)],
];
const seg = (u: URL) => { const s = u.pathname.split('/').filter(Boolean)[0]; return s && !/^(in|company|channel|c|user|users|watch|hashtag|share|intent|home|explore|login|about|channels)$/i.test(s) ? s : null; };

/** Turns a link someone published into an account claim when the host is a known platform, otherwise a plain link. */
export function linkClaim(raw: string, from: string, weight: number, fromUrl: string): Claim | null {
  let u: URL; try { u = new URL(raw.startsWith('http') ? raw : `https://${raw}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  for (const [re, platform, handle] of HOSTS) if (re.test(u.hostname)) { const h = handle(u); if (h) return { type: 'account', value: u.toString().replace(/[?#].*$/, '').replace(/\/$/, ''), relation: `linked from ${from}`, weight, url: fromUrl, attrs: { platform, handle: h }, snippet: `${platform} account that ${from} links to` }; }
  return { type: 'url', value: u.toString().replace(/\/$/, ''), relation: `link on ${from}`, weight: Math.min(weight, 0.6), url: fromUrl };
}

export const joinPlace = (...p: (string | undefined)[]) => p.map((x) => (x ?? '').trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
export const toDate = (d: unknown): string | undefined => { const t = new Date(String(d)); return isNaN(+t) ? undefined : t.toISOString(); };
