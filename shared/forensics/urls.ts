import { decodeDiscordSnowflake, decodeTwitterSnowflake, decodeInstagramPost } from './ids';

/** What a link gives away: who shared it, when something was posted, where it really goes. Nothing is fetched. */
export interface UrlFact { label: string; value: string; importance: 0 | 1 | 2 | 3; iso?: string }
export interface UrlReport {
  input: string; final: string; host: string; domain: string; cleaned: string; removed: string[]; chain: string[];
  facts: UrlFact[]; warnings: string[]; entities: { type: 'account' | 'email' | 'domain' | 'username'; value: string; why: string }[]; checks: { label: string; url: string }[];
}

const TRACKERS = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|igshid|igsh|yclid|_hsenc|_hsmi|hsctatracking|ref_src|ref_url|mibextid|si|feature|s|t|trk|trkcampaign|trkinfo|share_id|source_ve_path|spm|scm|sc_cid|cmpid|ocid|oly_enc_id|oly_anon_id|vero_id|wickedid|__s|_ga|_gl|ttclid|twclid|li_fat_id|epik|pp|app|context|ved|ei|sa|usg|sxsrf|gs_lcrp|sourceid|aqs|rlz|client|gws_rd)$/i;
const SHORTENERS: Record<string, string | null> = { 'bit.ly': '+', 'bitly.com': '+', 'tinyurl.com': null, 't.co': null, 'goo.gl': null, 'ow.ly': null, 'is.gd': null, 'buff.ly': null, 'rebrand.ly': null, 'cutt.ly': null, 'shorturl.at': null, 't.ly': null, 'lnkd.in': null, 'youtu.be': null, 'fb.me': null, 'amzn.to': null, 'tiny.cc': null, 'v.gd': null, 'rb.gy': null };
const REDIRECT_PARAMS = /^(url|u|q|target|dest|destination|redirect|redirect_url|redirect_uri|redir|r|to|link|goto|out|continue|next|href|return|returnurl|ru)$/i;
const MULTI_TLD = /\.(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/i;
const IDENTIFYING = /^(email|e-mail|mail|user|username|uid|userid|user_id|login|name|first_?name|last_?name|phone|tel|account|acct|member|profile|handle|customer|cid|contact)$/i;

const domainOf = (host: string) => { const h = host.replace(/^www\./, ''); const p = h.split('.'); return MULTI_TLD.test(h) ? p.slice(-3).join('.') : p.slice(-2).join('.'); };
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const plausible = (ms: number) => ms >= Date.UTC(2009, 0, 1) && ms <= Date.now() + 86400000;
const hexSecs = (v: string | null) => { if (!v || !/^[0-9a-f]{6,8}$/i.test(v)) return null; const s = parseInt(v, 16); return s > 1_300_000_000 && s < 4_200_000_000 ? s * 1000 : null; };

export function analyzeUrl(raw: string, depth = 0): UrlReport | null {
  let u: URL;
  try { u = new URL(raw.trim().replace(/^(?!https?:\/\/|ftp:\/\/)(www\.|[\w-]+\.[a-z]{2,}\/)/i, 'https://$1')); } catch { return null; }
  if (!/^(https?|ftp):$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase(), domain = domainOf(host);
  const r: UrlReport = { input: raw.trim(), final: u.toString(), host, domain, cleaned: '', removed: [], chain: [], facts: [], warnings: [], entities: [], checks: [] };
  const fact = (label: string, value: string, importance: UrlFact['importance'] = 1, when?: number) => { if (value && !r.facts.some((f) => f.label === label && f.value === value)) r.facts.push({ label, value, importance, iso: when ? iso(when) : undefined }); };
  const path = u.pathname, params = u.searchParams;

  if (u.username || u.password) r.warnings.push(`The link contains a login (${u.username}${u.password ? ':••••' : ''}@): sometimes used to disguise the real site, and it may be a leaked credential.`);
  if (/(^|\.)xn--/.test(host)) r.warnings.push('The domain uses international characters (xn--). Look-alike domains use this to imitate real sites.');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) r.warnings.push('The link goes to a bare IP address rather than a name.');
  if (u.protocol === 'http:') r.warnings.push('Not encrypted (http).');
  if (host in SHORTENERS) { fact('Short link', `${host} hides where this goes`, 2); const plus = SHORTENERS[host]; if (plus) r.checks.unshift({ label: 'Preview where it leads (without visiting)', url: `${u.origin}${path}${plus}` }); else r.checks.unshift({ label: 'Preview with urlscan.io', url: `https://urlscan.io/search/#${encodeURIComponent(host + path)}` }); }

  // 1. strip trackers and note the ones that identify the sharer
  const clean = new URL(u.toString());
  for (const [k, v] of [...params.entries()]) {
    if (TRACKERS.test(k) && !(k === 't' && /youtube|youtu\.be/.test(host)) && !(k === 's' && !/twitter|x\.com|t\.co/.test(host)) && !(k === 'app' && false)) {
      r.removed.push(k); clean.searchParams.delete(k);
      if (k === 'si' && /youtu|spotify/.test(host)) fact('Share ID (si)', `${v} — identifies the share, and so potentially the person who shared it`, 2);
      if (/^utm_(source|campaign|medium)$/i.test(k)) fact(`Campaign ${k.slice(4)}`, v, 1);
      if (k === 'igsh' || k === 'igshid') fact('Instagram share ID', `${v} — tied to the account that shared the link`, 2);
      if (k === 'mc_eid') fact('Mailchimp recipient ID', `${v} — identifies the email recipient`, 2);
      if (k === 'fbclid' || k === 'gclid') fact('Ad-click ID', `${k}: ${v.slice(0, 24)}… — ties the click to an ad profile`, 0);
    }
  }
  r.cleaned = clean.toString().replace(/\?$/, '');

  // 2. identifying parameters and hidden payloads
  for (const [k, v] of params.entries()) {
    if (IDENTIFYING.test(k) && v) { fact(`Parameter "${k}"`, v, 2); if (/@/.test(v) && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) r.entities.push({ type: 'email', value: v.toLowerCase(), why: `in the link's "${k}" parameter` }); else if (/^[A-Za-z0-9._-]{3,30}$/.test(v) && /user|uid|login|handle|profile|acct|account|member/i.test(k) && !/^\d+$/.test(v)) r.entities.push({ type: 'username', value: v, why: `in the link's "${k}" parameter` }); }
    if (/^[A-Za-z0-9+/=_-]{16,}$/.test(v) && !/^[0-9a-f]+$/i.test(v)) {
      try { const d = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); if (/^[\x20-\x7e]{6,}$/.test(d) && (/@|https?:|=|{|\buser|\bid\b/i.test(d))) { fact(`Hidden in "${k}"`, `decodes to: ${d.slice(0, 160)}`, 2); for (const m of d.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi) ?? []) r.entities.push({ type: 'email', value: m.toLowerCase(), why: `hidden (base64) in the link's "${k}" parameter` }); } } catch { /* not base64 */ }
    }
  }

  // 3. redirect wrappers: follow the real destination
  if (depth < 3) {
    let inner: string | null = null;
    for (const [k, v] of params.entries()) if (REDIRECT_PARAMS.test(k) && /^https?:\/\//i.test(v)) { inner = v; break; }
    if (!inner && /^(l|lm|m)\.facebook\.com$|^l\.instagram\.com$/.test(host)) inner = params.get('u');
    if (!inner && /archive\.org$/.test(host)) { const m = /^\/web\/(\d{14})(?:[a-z_]{2,3})?\/(https?:\/\/.+)$/i.exec(path + u.search); if (m) { const t = Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[1].slice(8, 10), +m[1].slice(10, 12), +m[1].slice(12, 14)); fact('Saved by the Wayback Machine', iso(t), 3, t); r.warnings.length; inner = m[2]; } }
    if (inner) {
      const sub = analyzeUrl(inner, depth + 1);
      if (sub) { r.chain = [inner, ...sub.chain]; r.final = sub.final; fact('Really goes to', sub.final, 3); r.warnings.push(`This is a redirect wrapper (${host}); the real destination is ${sub.host}.`); r.facts.push(...sub.facts.filter((f) => !r.facts.some((x) => x.label === f.label && x.value === f.value))); r.entities.push(...sub.entities); r.warnings.push(...sub.warnings.filter((w) => !r.warnings.includes(w))); r.removed.push(...sub.removed); }
    }
  }

  // 4. platform-specific times and IDs
  const snow = (id: string, label: string, kind: 'discord' | 'twitter' = 'discord', importance: UrlFact['importance'] = 3) => { const s = kind === 'discord' ? decodeDiscordSnowflake(id) : decodeTwitterSnowflake(id); if (s && plausible(s.createdAt)) { fact(label, iso(s.createdAt), importance, s.createdAt); return s.createdAt; } return null; };
  if (/(^|\.)discord(app)?\.(com|net)$|^cdn\.discordapp\.com$|^media\.discordapp\.net$|(^|\.)discord\.gg$/.test(host)) {
    let m: RegExpExecArray | null;
    if ((m = /^\/attachments\/(\d{15,20})\/(\d{15,20})\/([^/?]+)/.exec(path))) {
      snow(m[2], 'Uploaded to Discord'); snow(m[1], 'Channel created', 'discord', 1); fact('File name', decodeURIComponent(m[3]), 1);
      r.entities.push({ type: 'account', value: `discord:channel:${m[1]}`, why: 'channel the file was posted in' });
    }
    if ((m = /^\/(?:avatars|banners)\/(\d{15,20})\/(a_)?[0-9a-f]{20,}/i.exec(path))) { snow(m[1], 'Discord account created', 'discord', 3); if (m[2]) fact('Animated avatar', 'yes — usually means the account has Discord Nitro (paid)', 2); r.entities.push({ type: 'account', value: `https://discord.com/users/${m[1]}`, why: 'Discord user ID in the image link' }); }
    if ((m = /^\/guilds\/(\d{15,20})\/users\/(\d{15,20})\//.exec(path))) { snow(m[1], 'Server created', 'discord', 2); snow(m[2], 'Account created', 'discord', 3); r.entities.push({ type: 'account', value: `https://discord.com/users/${m[2]}`, why: 'Discord user ID in the link' }); }
    if ((m = /^\/(?:icons|splashes|discovery-splashes)\/(\d{15,20})\//.exec(path))) snow(m[1], 'Server created', 'discord', 2);
    if ((m = /^\/(?:emojis|stickers)\/(\d{15,20})/.exec(path))) snow(m[1], 'Emoji / sticker created', 'discord', 1);
    if ((m = /^\/channels\/(\d{15,20}|@me)\/(\d{15,20})(?:\/(\d{15,20}))?/.exec(path))) { if (m[1] !== '@me') snow(m[1], 'Server created', 'discord', 1); snow(m[2], 'Channel created', 'discord', 1); if (m[3]) snow(m[3], 'Message sent', 'discord', 3); }
    const ex = hexSecs(params.get('ex')), isu = hexSecs(params.get('is'));
    if (isu) fact('This link was issued', iso(isu), 2, isu); if (ex) { fact('This link expires', iso(ex), 1, ex); if (ex < Date.now()) r.warnings.push('This Discord file link has expired. The file may still exist, but this URL no longer opens it.'); }
    if (params.get('hm')) fact('Signature present', 'the link is signed by Discord; changing any part of it will break it', 0);
  }
  if (/(^|\.)(twitter|x)\.com$|^t\.co$/.test(host)) { const m = /^\/(?:([A-Za-z0-9_]{1,15})\/status(?:es)?|i\/web\/status)\/(\d{1,20})/.exec(path); if (m) { snow(m[2], 'Posted on X', 'twitter'); if (m[1]) r.entities.push({ type: 'username', value: m[1], why: 'account in the post link' }); } }
  if (/(^|\.)tiktok\.com$/.test(host)) { const m = /\/(?:@([\w.]+)\/)?video\/(\d{15,20})/.exec(path); if (m) { const t = Number(BigInt(m[2]) >> 32n) * 1000; if (plausible(t)) fact('Posted on TikTok', iso(t), 3, t); if (m[1]) r.entities.push({ type: 'username', value: m[1], why: 'account in the video link' }); } }
  if (/(^|\.)instagram\.com$/.test(host)) { const m = /\/(?:p|reel|tv)\/([\w-]{8,15})/.exec(path); if (m) { const t = decodeInstagramPost(m[1]); if (t && plausible(t.createdAt)) fact('Posted on Instagram', iso(t.createdAt), 3, t.createdAt); } const un = /^\/([A-Za-z0-9._]{2,30})\/?$/.exec(path); if (un && !/^(p|reel|reels|explore|stories|accounts|direct)$/.test(un[1])) r.entities.push({ type: 'username', value: un[1], why: 'Instagram profile in the link' }); }
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) { const v = params.get('v') ?? (host === 'youtu.be' ? path.slice(1) : null); if (v) fact('YouTube video', v, 1); const t = params.get('t') ?? params.get('start'); if (t) fact('Starts at', `${t} seconds`, 0); const h = /^\/@([\w.-]+)/.exec(path); if (h) r.entities.push({ type: 'username', value: h[1], why: 'YouTube handle in the link' }); }
  { const m = /\/(?:@[\w.]+\/|web\/statuses\/|statuses\/)(\d{16,19})(?:\/|$)/.exec(path); if (m && !/(twitter|x|tiktok|instagram|discord)/.test(host)) { const ms = Number(BigInt(m[1]) >> 16n); if (plausible(ms)) fact('Post time, if this is a Mastodon post', iso(ms), 2, ms); } }
  { const gh = /^\/([A-Za-z0-9-]{1,39})(?:\/|$)/.exec(path); if (/(^|\.)github\.com$/.test(host) && gh && !/^(orgs|topics|features|about|pricing|login|settings|marketplace|sponsors|search|explore)$/.test(gh[1])) r.entities.push({ type: 'username', value: gh[1], why: 'GitHub account in the link' }); }
  { const t = /^\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{4,31})\/?$/.exec(path); if (host === 't.me' && t) r.entities.push({ type: 'username', value: t[1], why: 'Telegram name in the link' }); }
  if (/^(open\.spotify\.com)$/.test(host)) { const m = /\/(user|artist|playlist|track|album)\/(\w+)/.exec(path); if (m) fact(`Spotify ${m[1]}`, m[2], 1); if (m?.[1] === 'user') r.entities.push({ type: 'username', value: m[2], why: 'Spotify user in the link' }); }

  r.entities.push({ type: 'domain', value: domain, why: 'domain of the link' });
  r.entities = r.entities.filter((e, i, a) => a.findIndex((x) => x.type === e.type && x.value.toLowerCase() === e.value.toLowerCase()) === i);
  r.removed = [...new Set(r.removed)];
  const fh = (() => { try { return new URL(r.final).hostname; } catch { return host; } })();
  r.checks.push(
    { label: 'Saved copies (Wayback Machine)', url: `https://web.archive.org/web/*/${r.final}` },
    { label: 'urlscan.io history for the domain', url: `https://urlscan.io/domain/${fh}` },
    { label: 'VirusTotal reputation', url: `https://www.virustotal.com/gui/domain/${fh}` },
    { label: 'Who registered the domain', url: `https://who.is/whois/${domainOf(fh)}` },
  );
  return r;
}

/** Every link in a block of text. */
export function findUrls(text: string, max = 12): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"')\]]{4,500}/gi)) { const u = m[0].replace(/[.,;:!?]+$/, ''); if (!out.includes(u)) out.push(u); if (out.length >= max) break; }
  return out;
}
