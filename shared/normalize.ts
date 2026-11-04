import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import type { EntityType } from './types';

const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function foldName(s: string): string {
  let t = collapse(fold(s).replace(/[.,'’"()]/g, (m) => (m === ',' ? ',' : '')));
  // "Doe, Jane" -> "jane doe"
  if (t.includes(',')) {
    const [last, ...rest] = t.split(',');
    t = collapse(`${rest.join(' ')} ${last}`);
  }
  return t.replace(/[^\p{L}\p{N}\s-]/gu, '').trim();
}

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|igshid|si$)/i;

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
    let s = u.toString();
    if (u.pathname === '/' && !u.search && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function normalizeEmail(raw: string, forKey = true): string {
  const e = raw.trim().toLowerCase().replace(/^mailto:/, '');
  if (!forKey) return e;
  const [local, domain] = e.split('@');
  if (!domain) return e;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  }
  return `${local.split('+')[0]}@${domain}`;
}

export function normalizePhone(raw: string, region: CountryCode = 'US'): string {
  const p = parsePhoneNumberFromString(raw, region);
  if (p && p.isPossible()) return p.number; // E.164
  return raw.replace(/[^\d+]/g, '');
}

export function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  if (d.startsWith('www.')) d = d.slice(4);
  return d;
}

/** Canonical dedupe key for an entity. Two values with the same (type,key) are the same entity. */
export function keyFor(type: EntityType, value: string, attrs?: Record<string, unknown>): string {
  const v = value.trim();
  switch (type) {
    case 'email': return normalizeEmail(v);
    case 'phone': return normalizePhone(v);
    case 'username': return fold(v.replace(/^@/, ''));
    case 'domain': return normalizeDomain(v);
    case 'ip': return v.toLowerCase();
    case 'url':
    case 'account': return normalizeUrl(v);
    case 'person':
    case 'org':
    case 'location': return foldName(v);
    case 'wallet': return /^0x/i.test(v) ? v.toLowerCase() : v;
    case 'image': return typeof attrs?.hash === 'string' ? (attrs.hash as string) : normalizeUrl(v);
  }
}

export function displayFor(type: EntityType, value: string): string {
  const v = value.trim();
  switch (type) {
    case 'email': return normalizeEmail(v, false);
    case 'username': return v.replace(/^@/, '');
    case 'domain': return normalizeDomain(v);
    case 'phone': {
      const p = parsePhoneNumberFromString(v, 'US');
      return p && p.isPossible() ? p.formatInternational() : v;
    }
    case 'account':
    case 'url':
    case 'image': return v;
    default: return collapse(v);
  }
}

// --- fuzzy name matching ---------------------------------------------------

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const am = new Array<boolean>(la).fill(false);
  const bm = new Array<boolean>(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(lb - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (m / la + m / lb + (m - t / 2) / m) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && a[p] && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

/** 0..1 similarity between two person/org names, tolerant of initials, order and middle names. */
export function nameSimilarity(x: string, y: string): number {
  const a = foldName(x), b = foldName(y);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(' '), tb = b.split(' ');
  // Same first & last token (middle names/initials ignored) is a strong match.
  const f = (t: string[]) => [t[0], t[t.length - 1]];
  const [fa, la] = f(ta), [fb, lb] = f(tb);
  if (ta.length > 1 && tb.length > 1) {
    const lastEq = la === lb;
    const firstEq = fa === fb || (fa.length === 1 && fb.startsWith(fa)) || (fb.length === 1 && fa.startsWith(fb));
    if (lastEq && firstEq) return 0.95;
    if (lastEq) return 0.55 * jaroWinkler(fa, fb) + 0.2;
  }
  return jaroWinkler(a, b) * 0.9;
}

export function initials(name: string): string {
  const t = foldName(name).split(' ').filter(Boolean);
  if (!t.length) return '?';
  return ((t[0][0] ?? '') + (t.length > 1 ? t[t.length - 1][0] : '')).toUpperCase();
}
