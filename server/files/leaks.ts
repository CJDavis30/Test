import { latin1, type Bytes } from './bytes';
import { parseCoords } from '../../shared/forensics/geo';
import type { Leak } from '../../shared/files';

/** Text hiding inside files: the Windows user name in a build path, an email in a comment, a server name in a link. */

const NOISE_HOST = /(^|\.)(w3\.org|purl\.org|adobe\.com|openxmlformats\.org|schemas\.microsoft\.com|microsoft\.com|xmlsoap\.org|apple\.com|iptc\.org|useplus\.org|cipa\.jp|verisign\.com|digicert\.com|sectigo\.com|comodoca\.com|globalsign\.com|symcloud\.com|symantec\.com|thawte\.com|letsencrypt\.org|mozilla\.org|xmlns\.com|oasis-open\.org|openoffice\.org|libreoffice\.org|ns\.adobe\.com|exiftool\.org|ffmpeg\.org|videolan\.org|google\.com\/schemas|example\.(com|org)|localhost)$/i;
const NOISE_EMAIL_TLD = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ttf|ico|bmp|dll|exe|so|pdb|h|c|cpp|json|xml)$/i;
const GENERIC_USERS = /^(public|default|default user|all users|shared|guest|user|users|administrator|admin|runner|runneradmin|vagrant|ubuntu|root|build|builder|buildbot|appveyor|jenkins|circleci|travis|azureuser|ec2-user|docker|node|app|www-data|systemprofile|localservice|networkservice|test|tester|john|jane|name|username|your-?name|appdata|temp)$/i;

const SECRETS: [string, RegExp][] = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g], ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g], ['GitHub token', /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g], ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g], ['OpenAI-style key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g], ['Discord webhook', /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/g],
  ['Discord bot token', /\b[MNO][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,}\b/g], ['Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g],
];
const mask = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-3)}` : `${s.slice(0, 3)}…`);

const isPrivateIp = (ip: string) => { const [a, b] = ip.split('.').map(Number); return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127); };

/** Printable text from a binary: Latin-1 runs and UTF-16LE runs (how Windows stores strings). */
export function stringsOf(b: Bytes, max = 6_000_000): string {
  const view = b.length > max ? Buffer.concat([b.subarray(0, max - 1_000_000), b.subarray(b.length - 1_000_000)]) : b;
  const ascii = latin1(view).replace(/[^\x20-\x7e\r\n\t]+/g, '\n');
  const u16: string[] = [];
  let run = '';
  for (let i = 0; i + 1 < view.length; i += 2) {
    const c = view[i] | (view[i + 1] << 8);
    if (c >= 0x20 && c < 0x7f) run += String.fromCharCode(c); else { if (run.length >= 6) u16.push(run); run = ''; }
    if (u16.length > 20000) break;
  }
  if (run.length >= 6) u16.push(run);
  return ascii + '\n' + u16.join('\n');
}

export function scanText(text: string, opts: { documentLike?: boolean } = {}): Leak[] {
  const out: Leak[] = [], seen = new Set<string>();
  const add = (l: Leak) => { const k = `${l.kind}|${l.value.toLowerCase()}`; if (seen.has(k) || out.length >= 120) return; seen.add(k); out.push(l); };
  const ctx = (i: number, n: number) => text.slice(Math.max(0, i - 25), Math.min(text.length, i + n + 25)).replace(/\s+/g, ' ').trim();
  let m: RegExpExecArray | null;

  for (const re of [/[A-Za-z]:\\Users\\([^\\/:*?"<>|\r\n\0]{1,40})\\/g, /[A-Za-z]:\\Documents and Settings\\([^\\/:*?"<>|\r\n\0]{1,40})\\/g]) {
    while ((m = re.exec(text))) { const u = m[1].trim(); if (u) add({ kind: 'user-path', value: u, context: ctx(m.index, m[0].length), interesting: !GENERIC_USERS.test(u) }); }
  }
  const mac = /(?<![\w/])\/Users\/([A-Za-z0-9._-]{1,40})\//g; while ((m = mac.exec(text))) add({ kind: 'user-path', value: m[1], context: ctx(m.index, m[0].length), interesting: !GENERIC_USERS.test(m[1]) });
  const lin = /(?<![\w/])\/home\/([a-z_][a-z0-9_-]{0,31})\//g; while ((m = lin.exec(text))) add({ kind: 'user-path', value: m[1], context: ctx(m.index, m[0].length), interesting: !GENERIC_USERS.test(m[1]) });
  const unc = /\\\\([A-Za-z0-9_.-]{2,40})\\([A-Za-z0-9_$.\- ]{1,40})/g; while ((m = unc.exec(text))) add({ kind: 'host', value: `\\\\${m[1]}\\${m[2]}`, context: 'network share path: names a machine on the author\'s network', interesting: true });

  const email = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  while ((m = email.exec(text))) { const e = m[0]; const host = e.split('@')[1]; if (NOISE_EMAIL_TLD.test(e) || NOISE_HOST.test(host) || /^(noreply|no-reply|donotreply)@/i.test(e)) continue; add({ kind: 'email', value: e.toLowerCase(), context: ctx(m.index, e.length), interesting: true }); }

  const url = /\b(?:https?|ftp):\/\/[^\s"'<>)\]\\]{4,240}/gi;
  while ((m = url.exec(text))) {
    let host = ''; try { host = new URL(m[0]).hostname; } catch { continue; }
    if (NOISE_HOST.test(host) || /^(ocsp|crl|crl\d?|s\d?\.symcb)\./.test(host)) continue;
    add({ kind: 'url', value: m[0].replace(/[.,;:]+$/, ''), interesting: true });
  }
  const mc = /(?<![0-9A-Fa-f:-])((?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2})(?![0-9A-Fa-f:-])/g;
  while ((m = mc.exec(text))) { const v = m[1].toUpperCase().replace(/-/g, ':'); if (!/^(00:){5}00$|^(FF:){5}FF$/.test(v)) add({ kind: 'mac', value: v, context: 'hardware (MAC) address of a network card', interesting: true }); }
  if (opts.documentLike) {
    const ip = /(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?![\d.])/g;
    while ((m = ip.exec(text))) { const o = m[1].split('.').map(Number); if (o.some((x) => x > 255)) continue; add({ kind: 'ip', value: m[1], context: ctx(m.index, m[0].length), interesting: !isPrivateIp(m[1]) }); }
  }
  for (const [label, re] of SECRETS) { re.lastIndex = 0; while ((m = re.exec(text))) add({ kind: 'secret', value: `${label}: ${mask(m[0])}`, context: 'a live credential may be inside this file. Do not use it; tell its owner.', interesting: true }); }
  for (const c of parseCoords(text).slice(0, 5)) add({ kind: 'coords', value: `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, context: c.raw, interesting: true });
  return out;
}
