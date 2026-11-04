import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import type { Detected, EntityType } from './types';
import { displayFor, normalizeDomain } from './normalize';

const TLDS = new Set(
  ('com net org io co ai app dev edu gov mil int info biz me us uk de fr es it nl se no dk fi pl ru ua cz at ch be ie pt gr ro hu ' +
    'tr il ae sa in cn jp kr hk sg tw th vn id my ph au nz ca mx br ar cl pe za ng ke eg xyz online site tech store shop blog cloud ' +
    'live news media tv fm cc ws to ly gl gg sh so is eu asia name pro mobi tel travel club top vip work space page link click one ' +
    'ink art design agency studio digital solutions systems network services group company email global world today life love fun ' +
    'icu cyou buzz lol wtf onion eth').split(' '),
);

const ORG_SUFFIX = /\b(inc|llc|ltd|gmbh|corp|corporation|company|co|plc|ag|sa|bv|pty|holdings|labs|foundation|university|institute|partners|group|capital|ventures)\.?$/i;

const RE = {
  email: /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i,
  url: /^(https?:\/\/|www\.)\S+$/i,
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/,
  ipv6: /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i,
  btc: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
  eth: /^0x[a-fA-F0-9]{40}$/,
  handle: /^@[\p{L}\p{N}._-]{2,40}$/u,
  bareUser: /^[\p{L}\p{N}_-][\p{L}\p{N}._-]{2,39}$/u,
  domain: /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i,
  name: /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,4}$/u,
};

const REGIONS = new Set(
  ('alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky ' +
    'louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada ohio oklahoma oregon pennsylvania ' +
    'tennessee texas utah vermont virginia washington wisconsin wyoming usa uk england scotland wales ireland canada australia germany france ' +
    'spain italy netherlands sweden norway denmark finland poland india china japan korea brazil mexico argentina israel singapore ontario quebec ' +
    'bavaria catalonia').split(' '),
);
const SCHEMELESS_URL = /^(?:[a-z0-9-]+\.)+[a-z]{2,24}\/\S+$/i;

export function detect(input: string, region: CountryCode = 'US'): Detected | null {
  const raw = input.trim();
  if (!raw) return null;
  const alts: { type: EntityType; value: string }[] = [];
  const done = (type: EntityType, value: string, confidence: number): Detected => ({
    type, value: displayFor(type, value), confidence,
    alternatives: alts.filter((a) => a.type !== type),
  });

  if (RE.email.test(raw)) {
    alts.push({ type: 'username', value: raw.split('@')[0] });
    return done('email', raw, 0.99);
  }
  if (RE.eth.test(raw)) return done('wallet', raw, 0.97);
  if (RE.ipv4.test(raw) || (RE.ipv6.test(raw) && raw.includes(':'))) return done('ip', raw, 0.98);
  if (RE.btc.test(raw)) return done('wallet', raw, 0.9);
  if (!RE.url.test(raw) && SCHEMELESS_URL.test(raw) && TLDS.has(raw.split('/')[0].split('.').pop()!.toLowerCase())) {
    alts.push({ type: 'domain', value: normalizeDomain(raw) });
    return done('url', `https://${raw}`, 0.9);
  }
  if (RE.url.test(raw)) {
    alts.push({ type: 'domain', value: normalizeDomain(raw) });
    const u = (() => { try { return new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`); } catch { return null; } })();
    // A bare site root is really a domain.
    if (u && (u.pathname === '/' || u.pathname === '') && !u.search) return done('domain', normalizeDomain(raw), 0.9);
    return done('url', raw.startsWith('www.') ? `https://${raw}` : raw, 0.95);
  }

  // Phone: leading + or enough digits with phone punctuation.
  const digits = raw.replace(/\D/g, '');
  if (/^[+(]?[\d\s().-]{7,}$/.test(raw) && digits.length >= 7 && digits.length <= 15) {
    const p = parsePhoneNumberFromString(raw, region);
    if (p && p.isPossible()) return done('phone', raw, p.isValid() ? 0.97 : 0.8);
  }

  if (RE.handle.test(raw)) {
    alts.push({ type: 'person', value: raw.slice(1) });
    return done('username', raw, 0.95);
  }

  if (!raw.includes(' ') && RE.domain.test(raw)) {
    const tld = raw.toLowerCase().split('.').pop()!;
    if (TLDS.has(tld)) {
      alts.push({ type: 'username', value: raw });
      // dotted real names like "jane.doe" have non-TLD endings, so this is a domain.
      return done('domain', raw, 0.93);
    }
  }

  if (RE.name.test(raw)) {
    if (ORG_SUFFIX.test(raw)) {
      alts.push({ type: 'person', value: raw });
      return done('org', raw, 0.85);
    }
    alts.push({ type: 'org', value: raw });
    return done('person', raw, 0.8);
  }

  if (RE.bareUser.test(raw) && !raw.includes(' ')) {
    alts.push({ type: 'person', value: raw });
    return done('username', raw, 0.7);
  }

  // "City, ST" / "City, Country" → location. "Doe, Jane" → person.
  const comma = raw.match(/^([\p{L}][\p{L}\s.'-]+),\s*([\p{L}][\p{L}\s.'-]+)$/u);
  if (comma) {
    const right = comma[2].trim();
    const geo = /^[A-Z]{2}$/.test(right) || REGIONS.has(right.toLowerCase());
    if (geo) { alts.push({ type: 'person', value: raw }); return done('location', raw, 0.75); }
    if (!right.includes(' ') && !comma[1].trim().includes(' ')) {
      alts.push({ type: 'location', value: raw });
      return done('person', raw, 0.7);
    }
    alts.push({ type: 'person', value: raw });
    return done('location', raw, 0.55);
  }

  alts.push({ type: 'username', value: raw });
  return done('org', raw, 0.3);
}

/** Split pasted multi-line / delimited text into detected entities (deduplicated). */
export function detectMany(text: string, region: CountryCode = 'US'): Detected[] {
  const parts = text
    .split(/[\n\r;]+|,\s{1}(?=\S+@)|\t/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: Detected[] = [];
  for (const p of parts) {
    const d = detect(p, region);
    if (!d) continue;
    const k = `${d.type}:${d.value.toLowerCase()}`;
    if (!seen.has(k)) { seen.add(k); out.push(d); }
  }
  return out;
}

/** Pull entities out of free text (files, notes). Emails, URLs, IPs, phones, domains. */
export function extractEntities(text: string, region: CountryCode = 'US'): Detected[] {
  const found = new Map<string, Detected>();
  const add = (type: EntityType, value: string, confidence: number) => {
    const d = detect(value, region);
    const t = d && d.type === type ? d : { type, value: displayFor(type, value), confidence, alternatives: [] };
    found.set(`${t.type}:${t.value.toLowerCase()}`, { ...t, confidence });
  };
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) add('email', m[0], 0.97);
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')]+/g)) add('url', m[0].replace(/[.,;]+$/, ''), 0.9);
  for (const m of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) if (RE.ipv4.test(m[0])) add('ip', m[0], 0.9);
  for (const m of text.matchAll(/(?<![\w@])\+?\d[\d\s().-]{7,17}\d/g)) {
    const p = parsePhoneNumberFromString(m[0], region);
    if (p && p.isValid()) add('phone', m[0], 0.85);
  }
  for (const m of text.matchAll(/(?<![@\w/.-])((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/gi)) {
    const tld = m[1].toLowerCase().split('.').pop()!;
    if (TLDS.has(tld) && ![...found.values()].some((f) => f.value.includes(m[1]))) add('domain', m[1], 0.7);
  }
  return [...found.values()];
}
