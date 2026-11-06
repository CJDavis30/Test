/**
 * Leads: what a profile says about where else its owner can be found. "ig: foo", "snap - bar", "discord: baz#0001", a Linktree, an
 * Instagram link, a Twitch URL. Every lead is the profile's OWN statement (anyone can write anything), so each one is kept as a
 * self-reported claim, labelled with the platform it names, and checked from the other side before it is trusted.
 */
import type { Claim } from './types';
import { PLATFORMS, platformByKey, platformOfUrl, type PlatformDef } from './handles';
import { extractEntities } from './detect';

export interface Lead {
  platform?: PlatformDef;
  handle?: string;
  url?: string;
  via: 'mention' | 'link' | 'hub';
  /** the words that said so, quoted */
  quote: string;
}

/** Pages that exist only to list someone's other accounts. Reading one is the fastest way to a person's whole footprint. */
export const HUB_HOSTS = /(^|\.)(linktr\.ee|linktree\.com|beacons\.ai|carrd\.co|bio\.link|allmylinks\.com|lnk\.bio|campsite\.bio|solo\.to|tap\.bio|linkin\.bio|many\.link|withkoji\.com|stan\.store|msha\.ke|taplink\.cc|link\.space|shor\.by|direct\.me|bio\.site|flowcode\.com|snipfeed\.co)$/i;

const STOP = new Set(['me', 'dm', 'dms', 'here', 'bio', 'link', 'links', 'below', 'above', 'off', 'private', 'no', 'none', 'na', 'n/a', 'soon', 'open', 'ask', 'on', 'my', 'the', 'is', 'in', 'at', 'to', 'for', 'and', 'or', 'not', 'yes', 'idk', 'tba', 'tbd', 'just', 'ig', 'tt', 'yt', 'dc', 'sc', 'gt', 'tg', 'gh', 'fb', 'tw', 'mc', 'https', 'http', 'www', 'join', 'server', 'pls', 'please', 'add', 'hmu', 'message', 'msg', 'username', 'name', 'user', 'handle', 'tag', 'id', 'code', 'lol', 'follow', 'sub', 'subscribe', 'profile', 'page', 'channel', 'account', 'acc', 'us', 'you', 'if', 'when', 'only', 'closed', 'inactive', 'deleted', 'banned', 'hacked', 'main', 'alt']);
// two- and three-letter aliases are common words and initials: they only count when the handle follows a colon, equals sign or @
const SHORT_ALIAS = (a: string) => a.length <= 3;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ALIASES = PLATFORMS.flatMap((p) => p.aliases.map((a) => ({ alias: a, p }))).sort((a, b) => b.alias.length - a.alias.length);
const ALT = ALIASES.map((a) => esc(a.alias)).join('|');
const MENTION = new RegExp(`(?<![A-Za-z0-9_])(${ALT})(?![A-Za-z0-9_])\\s*(?:(:|=|-|–|—|→|➜|»|>>|\\bis\\b|\\bat\\b)\\s*)?@?([A-Za-z0-9][A-Za-z0-9_.\\-]{1,31})`, 'gi');
const HANDLE_AT = new RegExp(`(?<![A-Za-z0-9_@.])@([A-Za-z0-9_.]{3,30})`, 'g');

const cleanHandle = (h: string) => h.replace(/[.\-_]+$/g, '').replace(/#\d{4}$/, '');

/** Every service-and-handle a bit of text names. */
export function mentionsIn(text: string): Lead[] {
  const out: Lead[] = [], seen = new Set<string>();
  const t = text.replace(/\s+/g, ' ');
  for (const m of t.matchAll(MENTION)) {
    const alias = m[1].toLowerCase(), sep = m[2], hRaw = m[3];
    const def = ALIASES.find((a) => a.alias === alias)?.p; if (!def) continue;
    if (SHORT_ALIAS(alias) && !(sep === ':' || sep === '=' || /^@/.test(t.slice(m.index! + m[1].length).trim()))) continue;
    if (!sep && !/^@/.test(t.slice(m.index! + m[1].length).trim())) continue;       // "snap foo" is too loose: needs a separator or an @
    const handle = cleanHandle(hRaw);
    // "tiktok is down" is a sentence, "my insta is foo_bar" is a handle: after a word, the handle must look like one (digit, underscore, dot) or carry an @
    if ((sep === 'is' || sep === 'at') && !/^@/.test(t.slice(m.index! + m[0].length - hRaw.length - 1, m.index! + m[0].length - hRaw.length)) && !/[0-9_.]/.test(handle)) continue;
    if (handle.length < 2 || STOP.has(handle.toLowerCase()) || /^\d+$/.test(handle) || /^https?$/i.test(handle)) continue;
    if (handle.includes('.') && /\.(com|net|org|io|gg|tv|me|co|app|xyz|ly|ee|gl)$/i.test(handle)) continue; // a domain, not a handle (links are read separately)
    const k = `${def.key}:${handle.toLowerCase()}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ platform: def, handle, via: 'mention', quote: t.slice(Math.max(0, m.index! - 12), m.index! + m[0].length + 12).trim() });
  }
  return out;
}

/** The leads in a piece of text: links to services and link hubs, and "ig: foo" style mentions. */
export function leadsFromText(text: string, max = 24): Lead[] {
  if (!text?.trim()) return [];
  const out: Lead[] = [], seen = new Set<string>();
  const push = (l: Lead) => { const k = `${l.platform?.key ?? 'x'}|${(l.handle ?? '').toLowerCase()}|${l.url?.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase() ?? ''}`; if (!seen.has(k)) { seen.add(k); out.push(l); } };
  for (const url of [...text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"')]+|\b(?:[a-z0-9-]+\.)+(?:com|tv|gg|me|app|ee|cash|social|co|io|so|bio|ai)\/[^\s<>"')]+/gi)].map((m) => m[0].replace(/[.,;:!?)]+$/, ''))) {
    const full = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    let host = ''; try { host = new URL(full).hostname.replace(/^www\./, ''); } catch { continue; }
    if (HUB_HOSTS.test(host)) { push({ url: full, via: 'hub', quote: url }); continue; }
    const hit = platformOfUrl(full);
    if (hit) push({ platform: hit.platform, handle: hit.handle, url: full, via: 'link', quote: url });
  }
  for (const m of mentionsIn(text)) push(m);
  // a bare "@name" next to no platform word is too ambiguous to follow; it is left as text
  void HANDLE_AT;
  return out.slice(0, max);
}

const profileOf = (l: Lead): string | undefined => l.url ?? (l.platform && l.handle ? l.platform.profileUrl?.(l.handle) : undefined);

/**
 * Claims for each lead. A named handle becomes a handle (with its platform filled in, trust "not sure", origin "a bio", so it is
 * something to check, not a fact). A link becomes an account to read. All of it is self-reported and never stronger than the profile's word.
 */
export function leadClaims(leads: Lead[], where: string, pageUrl?: string, weights: { mention?: number; link?: number; hub?: number } = {}): Claim[] {
  const out: Claim[] = [];
  const w = { mention: 0.5, link: 0.6, hub: 0.55, ...weights };
  for (const l of leads) {
    const plat = l.platform;
    const roleAttrs = (p: PlatformDef | undefined) => ({ handleKind: 'username', handleTrust: 'unsure', handleOrigin: 'bio', handleOriginNote: `Named in ${where}`, ...(p ? { handlePlatform: p.key } : {}) });
    if (l.via === 'hub' && l.url) { out.push({ type: 'url', value: l.url, relation: `link hub in ${where}`, weight: w.hub, url: pageUrl, basis: 'self-reported', snippet: `${where} points to a page that lists other accounts: ${l.quote}`, attrs: { hub: true } }); continue; }
    if (l.via === 'mention' && plat && l.handle) {
      out.push({ type: 'username', value: l.handle, relation: `says they are ${l.handle} on ${plat.name}`, weight: w.mention, url: pageUrl, basis: 'self-reported', snippet: `${where}: “${l.quote}”`, attrs: roleAttrs(plat) as Record<string, string> });
      continue;
    }
    const url = profileOf(l);
    if (l.via === 'link' && url && plat) {
      const claim: Claim = { type: 'account', value: url, relation: `links to ${plat.name}`, weight: w.link, url: pageUrl, basis: 'self-reported', snippet: `${where} links to ${plat.name}: ${l.quote}`, attrs: { platform: plat.name, ...(l.handle ? { handle: l.handle } : {}) } };
      out.push(claim);
      if (l.handle) out.push({ type: 'username', value: l.handle, relation: `${plat.name} handle in a link`, weight: w.link * 0.9, url: pageUrl, basis: 'self-reported', snippet: `${where} links to ${plat.name}: ${l.quote}`, attrs: roleAttrs(plat) as Record<string, string> });
    }
  }
  return out;
}

/** Contact details and leads in one bio, as claims. (Emails and phone numbers: the profile's own word, so self-reported.) */
export function bioLeadClaims(text: string | undefined, where: string, url?: string): Claim[] {
  const t = (text ?? '').trim(); if (!t) return [];
  const out: Claim[] = [];
  for (const e of extractEntities(t).slice(0, 8)) {
    if (e.type === 'email') out.push({ type: 'email', value: e.value, relation: `listed in ${where} bio`, weight: 0.55, url, snippet: `Found in the ${where} bio` });
    else if (e.type === 'phone') out.push({ type: 'phone', value: e.value, relation: `listed in ${where} bio`, weight: 0.4, url });
  }
  const leads = leadsFromText(t);
  const linkUrls = new Set(leads.map((l) => l.url).filter(Boolean) as string[]);
  for (const e of extractEntities(t)) if (e.type === 'url' && !linkUrls.has(e.value) && !leads.some((l) => l.url && e.value.replace(/\/$/, '') === l.url.replace(/\/$/, ''))) out.push({ type: 'url', value: e.value, relation: `link in ${where} bio`, weight: 0.45, url });
  out.push(...leadClaims(leads, `the ${where} bio`, url));
  return out;
}

export { platformByKey };
