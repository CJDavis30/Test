/**
 * Work out likely email addresses from a name and a company domain. Companies pick one pattern and use it for everyone, so a single
 * confirmed address ("jane.doe@x.com") tells you the pattern for all the rest. Gravatar (a public avatar service keyed by the MD5 of an
 * address) is the free way to check whether a guess belongs to a real person.
 */
import { md5 } from '../forensics/ids';

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface Guess { email: string; pattern: string; weight: number }

/** Patterns with a rough share of how common each is across companies (they sum above 1: several can apply). */
const PATTERNS: [string, number, (f: string, l: string, m: string, fi: string, li: string) => string][] = [
  ['first.last', 0.34, (f, l) => `${f}.${l}`], ['first', 0.12, (f) => f], ['flast', 0.17, (_f, l, _m, fi) => `${fi}${l}`], ['firstlast', 0.09, (f, l) => `${f}${l}`],
  ['first_last', 0.04, (f, l) => `${f}_${l}`], ['last', 0.03, (_f, l) => l], ['firstl', 0.05, (f, _l, _m, _fi, li) => `${f}${li}`], ['f.last', 0.05, (_f, l, _m, fi) => `${fi}.${l}`],
  ['last.first', 0.02, (f, l) => `${l}.${f}`], ['lastf', 0.02, (f, l, _m, fi) => `${l}${fi}`], ['first-last', 0.02, (f, l) => `${f}-${l}`], ['first.m.last', 0.02, (f, l, m) => (m ? `${f}.${m}.${l}` : '')], ['fmlast', 0.01, (_f, l, m, fi) => (m ? `${fi}${m[0]}${l}` : '')],
];
const PERSONAL = ['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'proton.me', 'hotmail.com'];

export function emailGuesses(opts: { first: string; last: string; middle?: string; domain: string; personal?: boolean; knownPattern?: string }): Guess[] {
  const f = fold(opts.first), l = fold(opts.last), m = fold(opts.middle ?? '');
  if (!f || !l) return [];
  const domains = opts.personal ? PERSONAL : [opts.domain.trim().toLowerCase().replace(/^@/, '')];
  const out: Guess[] = [], seen = new Set<string>();
  for (const dom of domains) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dom)) continue;
    for (const [name, w, fn] of PATTERNS) {
      const local = fn(f, l, m, f[0], l[0]); if (!local) continue;
      const email = `${local}@${dom}`; if (seen.has(email)) continue; seen.add(email);
      out.push({ email, pattern: name, weight: opts.personal ? w * 0.6 : opts.knownPattern ? (name === opts.knownPattern ? 0.95 : w * 0.1) : w });
    }
    if (opts.personal) for (const y of ['', '1', '123', '99', '00', '01']) for (const base of [`${f}${l}`, `${f}.${l}`, `${l}${f}`, `${f[0]}${l}`]) { const e = `${base}${y}@${dom}`; if (!seen.has(e)) { seen.add(e); out.push({ email: e, pattern: `${base === `${f}${l}` ? 'firstlast' : base === `${f}.${l}` ? 'first.last' : base === `${l}${f}` ? 'lastfirst' : 'flast'}${y}`, weight: 0.03 }); } }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Work backwards from a confirmed address and a name to the pattern the company uses. */
export function patternOf(email: string, first: string, last: string): string | null {
  const [local, dom] = email.toLowerCase().split('@'); if (!local || !dom) return null;
  for (const g of emailGuesses({ first, last, middle: '', domain: dom })) if (g.email.split('@')[0] === local) return g.pattern;
  return null;
}

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const gravatarHash = (email: string) => toHex(md5(email.trim().toLowerCase()));
export const gravatarUrl = (email: string, size = 200, fallback = '404') => `https://www.gravatar.com/avatar/${gravatarHash(email)}?s=${size}&d=${fallback}`;
export const gravatarProfileUrl = (email: string) => `https://www.gravatar.com/${gravatarHash(email)}.json`;
