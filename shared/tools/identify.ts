/**
 * "What is this thing?" Paste any string or number and get every sensible reading of it, best first: a timestamp in one of seven epochs,
 * a Discord/X snowflake, a Steam ID, a UUID, a hash, a JWT, Base64, a crypto address, an IP or MAC address, an IBAN.
 * Each reading says how sure it is, because a 10-digit number is a plausible timestamp AND a plausible phone number.
 */
import { decodeDiscordSnowflake, decodeTwitterSnowflake, decodeSteam64, decodeMinecraftUuid, decodeInstagramPost } from '../forensics/ids';

export interface Reading { kind: string; title: string; confidence: number; facts: [string, string][]; iso?: string; entity?: { type: 'email' | 'phone' | 'username' | 'account' | 'domain' | 'ip' | 'wallet' | 'url' | 'org' | 'person' | 'location' | 'breach' | 'image'; value: string } }

const MIN_OK = Date.UTC(1995, 0, 1), MAX_OK = Date.UTC(2036, 0, 1);
const inRange = (ms: number) => Number.isFinite(ms) && ms >= MIN_OK && ms <= MAX_OK;
const iso = (ms: number) => new Date(ms).toISOString();

const EPOCHS: { name: string; toMs: (n: number) => number; digits: [number, number] }[] = [
  { name: 'Unix seconds', toMs: (n) => n * 1000, digits: [9, 10] },
  { name: 'Unix milliseconds', toMs: (n) => n, digits: [12, 13] },
  { name: 'Unix microseconds', toMs: (n) => n / 1000, digits: [15, 16] },
  { name: 'Mac / iOS absolute time (seconds since 2001)', toMs: (n) => (n + 978307200) * 1000, digits: [8, 10] },
  { name: 'Windows FILETIME (100 ns since 1601)', toMs: (n) => n / 10000 - 11644473600000, digits: [17, 18] },
  { name: 'Chrome / WebKit time (microseconds since 1601)', toMs: (n) => n / 1000 - 11644473600000, digits: [16, 17] },
  { name: 'Excel / Lotus serial day', toMs: (n) => (n - 25569) * 86400000, digits: [5, 5] },
];

/** Every epoch that turns this number into a date between 1995 and 2035. */
export function decodeTimestamp(raw: string | number): { epoch: string; iso: string; ms: number }[] {
  const s = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return [];
  const n = Number(s), digits = s.replace(/^-/, '').split('.')[0].length;
  const out: { epoch: string; iso: string; ms: number }[] = [];
  for (const e of EPOCHS) {
    if (digits < e.digits[0] || digits > e.digits[1]) continue;
    const ms = e.toMs(n);
    if (inRange(ms)) out.push({ epoch: e.name, iso: iso(ms), ms });
  }
  return out;
}

const OUI_HINT = new Set(['00:00:00', 'ff:ff:ff']);
const b64urlDecode = (s: string): string | null => {
  try { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const pad = t + '='.repeat((4 - (t.length % 4)) % 4); const bin = typeof atob === 'function' ? atob(pad) : Buffer.from(pad, 'base64').toString('binary'); return decodeURIComponent(bin.split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')); } catch { try { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const pad = t + '='.repeat((4 - (t.length % 4)) % 4); return typeof atob === 'function' ? atob(pad) : Buffer.from(pad, 'base64').toString('binary'); } catch { return null; } }
};
const printable = (s: string) => s.length > 0 && [...s].filter((c) => { const k = c.charCodeAt(0); return k === 9 || k === 10 || k === 13 || (k >= 32 && k < 127) || k > 160; }).length / s.length > 0.92;

function ibanOk(s: string): boolean {
  const t = s.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(t)) return false;
  const r = (t.slice(4) + t.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0; for (const ch of r) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}
function ipv4(s: string) { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s); if (!m) return null; const p = m.slice(1).map(Number); return p.every((x) => x <= 255) ? p : null; }
function ipKind(p: number[]): string {
  if (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168)) return 'private network (RFC 1918): not routable on the internet';
  if (p[0] === 127) return 'loopback (the device itself)'; if (p[0] === 169 && p[1] === 254) return 'link-local (self-assigned)';
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return 'carrier-grade NAT (shared by many customers)';
  if ((p[0] === 192 && p[1] === 0 && p[2] === 2) || (p[0] === 198 && p[1] === 51 && p[2] === 100) || (p[0] === 203 && p[1] === 0 && p[2] === 113)) return 'documentation range (never a real host)';
  if (p[0] >= 224) return 'multicast / reserved'; return 'public address';
}

export function identify(input: string): Reading[] {
  const t = input.trim();
  if (!t) return [];
  const out: Reading[] = [];
  const add = (r: Reading) => out.push(r);
  const digitsOnly = /^-?\d+(\.\d+)?$/.test(t);

  // numbers: timestamps and snowflakes
  if (digitsOnly) {
    for (const d of decodeTimestamp(t)) add({ kind: 'timestamp', title: `Timestamp: ${d.epoch}`, confidence: d.epoch === 'Unix seconds' || d.epoch === 'Unix milliseconds' ? 0.85 : 0.5, iso: d.iso, facts: [['Date (UTC)', d.iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')], ['Epoch', d.epoch]] });
    if (/^\d{15,20}$/.test(t)) {
      const dc = decodeDiscordSnowflake(t), tw = decodeTwitterSnowflake(t);
      if (dc && inRange(dc.createdAt)) add({ kind: 'snowflake', title: 'Discord ID (snowflake)', confidence: dc.createdAt > Date.UTC(2015, 4, 13) ? 0.8 : 0.3, iso: dc.iso, facts: [['Created', dc.iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')], ['Worker / process', `${dc.worker} / ${dc.process}`], ['Sequence', String(dc.sequence)]], entity: { type: 'account', value: `https://discord.com/users/${t}` } });
      if (tw && inRange(tw.createdAt) && tw.createdAt > Date.UTC(2010, 10, 4)) add({ kind: 'snowflake', title: 'X / Twitter post or user ID (snowflake)', confidence: 0.45, iso: tw.iso, facts: [['Created', tw.iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')], ['Link', `https://x.com/i/status/${t}`]] });
    }
    const st = decodeSteam64(t);
    if (st) add({ kind: 'steam', title: 'Steam ID (64-bit)', confidence: 0.97, facts: [['Account ID', String(st.accountId)], ['Steam3', st.steam3], ['Type', st.type], ['Profile', st.profileUrl]], entity: { type: 'account', value: st.profileUrl } });
    if (/^\d{9,12}$/.test(t) && !st) add({ kind: 'number', title: 'Could also be a phone number or a Roblox user ID', confidence: 0.2, facts: [['Digits', String(t.length)], ['Roblox profile (if an ID)', `https://www.roblox.com/users/${t}/profile`]] });
  }

  // identifiers with a fixed shape
  const dashed = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
  // 32 bare hex digits are far more often a hash than a UUID, unless the version and variant digits fit
  const bareUuid = /^[0-9a-f]{12}[1-5][0-9a-f]{3}[89ab][0-9a-f]{15}$/i.test(t);
  const uuid = dashed || bareUuid ? decodeMinecraftUuid(t) : null;
  if (uuid) {
    const h = uuid.uuid.replace(/-/g, ''), v = uuid.version;
    const facts: [string, string][] = [['UUID', uuid.uuid], ['Version', String(v)]];
    if (v === 1) { const ts = (BigInt('0x' + h.slice(13, 16) + h.slice(8, 12) + h.slice(0, 8)) - 122192928000000000n) / 10000n; if (inRange(Number(ts))) facts.push(['Created (time-based UUID)', iso(Number(ts)).replace('T', ' ').replace(/\.\d+Z$/, ' UTC')], ['Machine (node)', h.slice(20).replace(/(..)(?=.)/g, '$1:')]); }
    add({ kind: 'uuid', confidence: dashed ? 0.95 : 0.35, title: v === 4 ? 'UUID (random). A Minecraft online-mode player ID has this shape.' : v === 3 ? 'UUID (name-based). A Minecraft offline-mode (cracked) player ID has this shape.' : `UUID version ${v}`, facts });
  }
  const hexOnly = /^[0-9a-f]+$/i.test(t);
  if (hexOnly && !uuid) {
    const kinds: Record<number, string> = { 32: 'MD5 (or NTLM)', 40: 'SHA-1', 56: 'SHA-224', 64: 'SHA-256 (or a 32-byte key / Ethereum private key)', 96: 'SHA-384', 128: 'SHA-512' };
    if (kinds[t.length]) add({ kind: 'hash', title: `Hash: ${kinds[t.length]}`, confidence: 0.6, facts: [['Length', `${t.length} hex characters`], ['Note', 'A hash cannot be reversed; search it to see if it is a known value (file hash lookups, leaked-password sets).']] });
    if (t.length % 2 === 0 && t.length >= 6 && t.length <= 200) { const txt = t.match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join(''); if (printable(txt) && /[a-z]{3}/i.test(txt)) add({ kind: 'hex', title: 'Hex-encoded text', confidence: 0.55, facts: [['Decoded', txt]] }); }
  }
  const mac = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.exec(t);
  if (mac) { const b = parseInt(t.slice(0, 2), 16); add({ kind: 'mac', title: 'MAC address', confidence: 0.95, facts: [['Address', t.toLowerCase().replace(/-/g, ':')], ['Maker prefix (OUI)', t.slice(0, 8).toLowerCase().replace(/-/g, ':')], ['Randomised (privacy) address', b & 2 ? 'Yes: the locally-administered bit is set, so this is not tied to the hardware maker' : 'No: a burned-in hardware address'], ['Multicast', b & 1 ? 'Yes' : 'No']].filter(([k]) => !(OUI_HINT.has(t.slice(0, 8).toLowerCase()) && k === 'x')) as [string, string][] }); }
  const ip = ipv4(t);
  if (ip) add({ kind: 'ip', title: 'IPv4 address', confidence: 0.97, facts: [['Class', ipKind(ip)], ['As a number', String(((ip[0] * 256 + ip[1]) * 256 + ip[2]) * 256 + ip[3])], ['Hex', ip.map((x) => x.toString(16).padStart(2, '0')).join('')]], entity: { type: 'ip', value: t } });
  if (/^[0-9a-f:]{3,39}$/i.test(t) && (t.match(/:/g) ?? []).length >= 2 && !mac) add({ kind: 'ip', title: 'IPv6 address', confidence: 0.85, facts: [['Address', t.toLowerCase()]], entity: { type: 'ip', value: t.toLowerCase() } });

  // addresses and accounts
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) add({ kind: 'wallet', title: 'Ethereum-style address (works on Ethereum, Polygon, BNB Chain, Base...)', confidence: 0.95, facts: [['Explorer', `https://etherscan.io/address/${t}`], ['Note', 'The same address exists on every EVM chain; check each.']], entity: { type: 'wallet', value: t } });
  if (/^(bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(t)) add({ kind: 'wallet', title: `Bitcoin address (${t.startsWith('bc1p') ? 'Taproot' : t.startsWith('bc1') ? 'SegWit' : t.startsWith('3') ? 'script' : 'legacy'})`, confidence: 0.9, facts: [['Explorer', `https://mempool.space/address/${t}`]], entity: { type: 'wallet', value: t } });
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(t)) add({ kind: 'wallet', title: 'Tron address', confidence: 0.8, facts: [['Explorer', `https://tronscan.org/#/address/${t}`]], entity: { type: 'wallet', value: t } });
  if (/^(4|8)[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/.test(t)) add({ kind: 'wallet', title: 'Monero address', confidence: 0.8, facts: [['Note', 'Monero hides amounts and links; there is no public explorer.']], entity: { type: 'wallet', value: t } });
  if (ibanOk(t)) add({ kind: 'iban', title: `IBAN (valid checksum), country ${t.slice(0, 2).toUpperCase()}`, confidence: 0.97, facts: [['Bank code part', t.replace(/\s/g, '').slice(4, 12)]] });
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(t)) add({ kind: 'email', title: 'Email address', confidence: 0.98, facts: [['Domain', t.split('@')[1].toLowerCase()], ['Local part', t.split('@')[0]]], entity: { type: 'email', value: t.toLowerCase() } });

  // containers
  const jwt = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/.exec(t);
  if (jwt) {
    const [h, p] = t.split('.'), head = b64urlDecode(h), body = b64urlDecode(p);
    const facts: [string, string][] = [];
    try { const hj = JSON.parse(head ?? ''); facts.push(['Algorithm', String(hj.alg)], ['Type', String(hj.typ ?? '')]); if (hj.alg === 'none') facts.push(['Warning', 'alg "none": the token is unsigned']); } catch { /* ignore */ }
    try { const pj = JSON.parse(body ?? ''); for (const [k, v] of Object.entries(pj).slice(0, 14)) facts.push([k, ['iat', 'exp', 'nbf', 'auth_time'].includes(k) && typeof v === 'number' ? `${v} → ${iso(v * 1000).replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}` : typeof v === 'object' ? JSON.stringify(v) : String(v)]); } catch { /* ignore */ }
    add({ kind: 'jwt', title: 'JSON Web Token (login token). Its contents are readable by anyone.', confidence: 0.98, facts, iso: (() => { try { const v = JSON.parse(body ?? '').iat; return typeof v === 'number' ? iso(v * 1000) : undefined; } catch { return undefined; } })() });
  }
  if (!jwt && /^[A-Za-z0-9+/_-]{8,}={0,2}$/.test(t) && t.length % 4 !== 1 && !hexOnly && !digitsOnly && !/^[A-Za-z]+$/.test(t)) {
    const dec = b64urlDecode(t); if (dec && printable(dec) && dec.length >= 4) add({ kind: 'base64', title: 'Base64-encoded text', confidence: 0.6, facts: [['Decoded', dec.length > 600 ? dec.slice(0, 600) + '…' : dec]] });
  }
  if (/^%[0-9a-f]{2}|%[0-9a-f]{2}.*%[0-9a-f]{2}/i.test(t)) { try { add({ kind: 'url-encoded', title: 'URL-encoded text', confidence: 0.7, facts: [['Decoded', decodeURIComponent(t)]] }); } catch { /* ignore */ } }
  if (/^[A-Za-z0-9_-]{6,12}$/.test(t) && !digitsOnly && !hexOnly) { const ig = decodeInstagramPost(t); if (ig && inRange(ig.createdAt) && /[A-Z]/.test(t) && /[a-z]/.test(t) && t.length >= 9) add({ kind: 'instagram', title: 'Possibly an Instagram post code', confidence: 0.3, iso: ig.iso, facts: [['Would date to', ig.iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')], ['Link', `https://www.instagram.com/p/${t}/`]] }); }
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(t) && !ip && !/^\d+(\.\d+)+$/.test(t)) add({ kind: 'domain', title: 'Domain name', confidence: 0.7, facts: [['Registered domain (guess)', t.toLowerCase().split('.').slice(-2).join('.')]], entity: { type: 'domain', value: t.toLowerCase() } });
  if (/^@?[A-Za-z0-9_.]{3,32}$/.test(t) && !digitsOnly && !hexOnly && out.length === 0) add({ kind: 'handle', title: 'Looks like a username or handle', confidence: 0.3, facts: [['Try', 'Handle lab, or search it across platforms']], entity: { type: 'username', value: t.replace(/^@/, '') } });

  return out.sort((a, b) => b.confidence - a.confidence);
}
