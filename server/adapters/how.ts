import { createHash } from 'node:crypto';
import type { EntityType } from '../../shared/types';

/**
 * "What did we ask this source?", in plain words. Shown in the evidence trail so you can see how a finding was found
 * and repeat the check yourself. `q` is the thing that was looked up.
 */
const HOW: Record<string, string | ((type: EntityType, q: string) => string)> = {
  derive: (_t, q) => `Read the shape of ${q} (no lookup needed)`,
  'dns-cloudflare': (t, q) => (t === 'ip' ? `Asked DNS for the name registered to ${q} (reverse lookup)` : `Asked DNS for the address, mail, nameserver and text records of ${q}`),
  'dns-google': (t, q) => (t === 'ip' ? `Asked DNS for the name registered to ${q} (reverse lookup)` : `Asked DNS for the address, mail, nameserver and text records of ${q}`),
  'rdap-domain': (_t, q) => `Looked up the official registration record (RDAP/WHOIS) for ${q}`,
  'rdap-ip': (_t, q) => `Looked up who the network block containing ${q} is registered to`,
  crtsh: (_t, q) => `Searched public TLS certificate logs for names under ${q}`,
  certspotter: (_t, q) => `Searched public TLS certificate logs for names under ${q}`,
  otx: (t, q) => (t === 'ip' ? `Asked AlienVault OTX which names have pointed at ${q}` : `Asked AlienVault OTX for past DNS records of ${q}`),
  hackertarget: (_t, q) => `Asked HackerTarget for known hostnames of ${q}`,
  urlscan: (t, q) => (t === 'ip' ? `Searched urlscan.io public scans served from ${q}` : `Searched urlscan.io public scans of ${q}`),
  wayback: (t, q) => (t === 'url' ? `Searched the Wayback Machine for saved copies of ${q}` : `Searched the Wayback Machine for pages saved under ${q}`),
  internetdb: (_t, q) => `Asked Shodan InternetDB which services are open at ${q}`,
  ipwho: (_t, q) => `Asked an IP-geolocation service where ${q} is`,
  'ip-api': (_t, q) => `Asked an IP-geolocation service where ${q} is`,
  gravatar: (_t, q) => `Looked up the Gravatar profile registered with ${q}`,
  emailrep: (_t, q) => `Asked EmailRep which services ${q} is registered with`,
  hibp: (_t, q) => `Checked Have I Been Pwned for breaches containing ${q}`,
  xposedornot: (_t, q) => `Checked XposedOrNot for breaches containing ${q}`,
  github: (t, q) => (t === 'email' ? `Searched GitHub profiles and public commits that use ${q}` : `Opened the GitHub profile named ${q}`),
  gitlab: (_t, q) => `Opened the GitLab profile named ${q}`,
  'github-activity': (_t, q) => `Read the public activity feed of the GitHub account ${q}, and the timezone in its recent commits`,
  'hn-activity': (_t, q) => `Listed the recent Hacker News posts and comments by ${q}`,
  'bluesky-activity': (_t, q) => `Listed the recent Bluesky posts by ${q}`,
  'wikipedia-activity': (_t, q) => `Listed the recent Wikipedia edits by ${q}`,
  roblox: (t, q) => (t === 'account' ? `Opened the Roblox profile at ${q}` : `Looked up the Roblox account named ${q}`),
  'discord-invite': (_t, q) => `Resolved the Discord invite link ${q}`,
  bluesky: (_t, q) => `Opened the Bluesky profile for ${q}`,
  hackernews: (_t, q) => `Opened the Hacker News profile named ${q}`,
  devto: (_t, q) => `Opened the DEV profile named ${q}`,
  keybase: (_t, q) => `Opened the Keybase profile named ${q} and its signed proofs`,
  reddit: (_t, q) => `Opened the Reddit profile named ${q}`,
  'username-sweep': (_t, q) => `Checked whether the username ${q} is taken on 22 well-known sites`,
  'phone-offline': (_t, q) => `Decoded ${q} using phone numbering-plan rules (offline)`,
  gleif: (_t, q) => `Searched the global company registry (GLEIF) for ${q}`,
  wikidata: (_t, q) => `Searched Wikidata for a notable person or company named ${q}`,
  blockstream: (_t, q) => `Read the public Bitcoin blockchain for ${q}`,
  hunter: (_t, q) => `Asked Hunter for email addresses seen at ${q}`,
};

export function howFor(adapterId: string, type: EntityType, query: string): string | undefined {
  const h = HOW[adapterId];
  if (!h) return undefined;
  return typeof h === 'function' ? h(type, query) : h.replace('{q}', query);
}
/** Lets the test world describe its own made-up sources without the product knowing about them. */
export const extendHow = (more: Record<string, (typeof HOW)[string]>) => { Object.assign(HOW, more); };
export const knownHowIds = () => Object.keys(HOW);

const q = encodeURIComponent;
const dom = (v: string) => v.replace(/^www\./, '');

/**
 * A page where you can repeat this exact lookup yourself. Used when a source did not return a link to one specific record.
 * Offline and simulated sources return nothing: there is no real page to open, and we say so instead of showing a dead link.
 */
const LOOKUP: Record<string, (type: EntityType, v: string) => string | undefined> = {
  'dns-cloudflare': (t, v) => `https://dnschecker.org/all-dns-records-of-domain.php?query=${q(v)}&rtype=ALL`,
  'dns-google': (t, v) => `https://dns.google/resolve?name=${q(v)}&type=${t === 'ip' ? 'PTR' : 'ANY'}`,
  'rdap-domain': (_t, v) => `https://rdap.org/domain/${q(v)}`,
  'rdap-ip': (_t, v) => `https://rdap.org/ip/${q(v)}`,
  crtsh: (_t, v) => `https://crt.sh/?q=${q('%.' + v)}`,
  certspotter: (_t, v) => `https://sslmate.com/ct_search_api/?domain=${q(v)}`,
  otx: (t, v) => `https://otx.alienvault.com/indicator/${t === 'ip' ? 'ip' : 'domain'}/${q(v)}`,
  hackertarget: (_t, v) => `https://api.hackertarget.com/hostsearch/?q=${q(v)}`,
  urlscan: (t, v) => `https://urlscan.io/search/#${q(t === 'ip' ? `ip:"${v}"` : `domain:${v}`)}`,
  wayback: (t, v) => `https://web.archive.org/web/*/${t === 'url' ? v : dom(v) + '/*'}`,
  internetdb: (_t, v) => `https://internetdb.shodan.io/${q(v)}`,
  ipwho: (_t, v) => `https://ipwho.is/${q(v)}`,
  'ip-api': (_t, v) => `https://ip-api.com/#${q(v)}`,
  gravatar: (_t, v) => `https://gravatar.com/${require_md5(v)}`,
  emailrep: (_t, v) => `https://emailrep.io/${q(v)}`,
  hibp: (_t, v) => `https://haveibeenpwned.com/account/${q(v)}`,
  xposedornot: (_t, v) => `https://api.xposedornot.com/v1/check-email/${q(v)}`,
  github: (t, v) => (t === 'email' ? `https://github.com/search?q=${q(v)}&type=users` : `https://github.com/${q(v)}`),
  gitlab: (_t, v) => `https://gitlab.com/${q(v)}`,
  'github-activity': (_t, v) => `https://github.com/${q(v)}`,
  'hn-activity': (_t, v) => `https://news.ycombinator.com/threads?id=${q(v)}`,
  'bluesky-activity': (_t, v) => `https://bsky.app/profile/${q(v.includes('.') ? v : `${v}.bsky.social`)}`,
  'wikipedia-activity': (_t, v) => `https://en.wikipedia.org/wiki/Special:Contributions/${q(v)}`,
  roblox: (t, v) => (t === 'account' && /^https?:\/\/(www\.)?roblox\.com\//i.test(v) ? v : `https://www.roblox.com/search/users?keyword=${q(v)}`),
  'discord-invite': (_t, v) => (/^https?:\/\/(www\.)?discord\.(gg|com)\//i.test(v) ? v : `https://discord.gg/${q(v)}`),
  bluesky: (t, v) => `https://bsky.app/profile/${q(t === 'domain' || v.includes('.') ? v : `${v}.bsky.social`)}`,
  hackernews: (_t, v) => `https://news.ycombinator.com/user?id=${q(v)}`,
  devto: (_t, v) => `https://dev.to/${q(v)}`,
  keybase: (_t, v) => `https://keybase.io/${q(v)}`,
  reddit: (_t, v) => `https://www.reddit.com/user/${q(v)}`,
  gleif: (_t, v) => `https://search.gleif.org/#/search/simpleSearch=${q(v)}`,
  wikidata: (_t, v) => `https://www.wikidata.org/w/index.php?search=${q(v)}`,
  blockstream: (_t, v) => `https://blockstream.info/address/${q(v)}`,
  hunter: (_t, v) => `https://hunter.io/search/${q(v)}`,
};

function require_md5(v: string) { return createHash('md5').update(v.trim().toLowerCase()).digest('hex'); }

/** Lets a source describe its own "repeat this by hand" page without editing the table above. */
export const extendLookup = (more: Record<string, (type: EntityType, v: string) => string | undefined>) => { Object.assign(LOOKUP, more); };

export function lookupUrl(adapterId: string, type: EntityType, query: string): string | undefined {
  try { return LOOKUP[adapterId]?.(type, query); } catch { return undefined; }
}
export const knownLookupIds = () => Object.keys(LOOKUP);
