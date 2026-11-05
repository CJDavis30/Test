/**
 * Look-alike and invisible characters. A username or domain can LOOK identical to another and be different ("paypal" with a Cyrillic а),
 * or carry invisible characters that make two "identical" handles different, or hide text with right-to-left controls. This reports every
 * trick it finds, shows the plain-Latin "skeleton" a human would read, and decodes punycode (xn--) domains.
 */

export interface Finding { level: 'info' | 'warn' | 'bad'; text: string }
export interface TextReport {
  length: number; findings: Finding[]; scripts: Record<string, number>; mixedScript: boolean;
  /** what the text looks like to a person reading it, with look-alikes folded to Latin */
  skeleton: string; /** the text with invisible characters removed */ cleaned: string;
  chars: { ch: string; code: string; name: string; script: string; suspicious: boolean }[];
}

// a compact table of the look-alikes that actually show up in impersonation: Cyrillic and Greek letters that match Latin ones
const CONFUSABLE: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ɡ': 'g', 'ӏ': 'l', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b', 'ѵ': 'v',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'Ј': 'J', 'Ѕ': 'S',
  'α': 'a', 'ο': 'o', 'ν': 'v', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'ι': 'i', 'κ': 'k', 'χ': 'x', 'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  'ⅼ': 'l', 'ⅰ': 'i', 'ǀ': 'l', 'ł': 'l', 'ı': 'i', '０': '0', 'ℓ': 'l', '℮': 'e', 'ⲟ': 'o', 'ꓲ': 'I',
};
const INVISIBLE: Record<number, string> = {
  0x200b: 'zero-width space', 0x200c: 'zero-width non-joiner', 0x200d: 'zero-width joiner', 0x2060: 'word joiner', 0xfeff: 'zero-width no-break space (BOM)', 0x00ad: 'soft hyphen', 0x034f: 'combining grapheme joiner', 0x061c: 'Arabic letter mark', 0x180e: 'Mongolian vowel separator',
  0x202a: 'left-to-right embedding', 0x202b: 'right-to-left embedding', 0x202c: 'pop directional formatting', 0x202d: 'left-to-right override', 0x202e: 'right-to-left override', 0x2066: 'left-to-right isolate', 0x2067: 'right-to-left isolate', 0x2068: 'first strong isolate', 0x2069: 'pop directional isolate', 0x200e: 'left-to-right mark', 0x200f: 'right-to-left mark',
  0x00a0: 'no-break space', 0x2007: 'figure space', 0x202f: 'narrow no-break space', 0x3000: 'ideographic space', 0x2800: 'braille blank', 0x3164: 'Hangul filler', 0x115f: 'Hangul choseong filler', 0x1160: 'Hangul jungseong filler',
};
const BIDI = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

const SCRIPTS: [string, RegExp][] = [['Latin', /\p{Script=Latin}/u], ['Cyrillic', /\p{Script=Cyrillic}/u], ['Greek', /\p{Script=Greek}/u], ['Arabic', /\p{Script=Arabic}/u], ['Hebrew', /\p{Script=Hebrew}/u], ['Han', /\p{Script=Han}/u], ['Hiragana', /\p{Script=Hiragana}/u], ['Katakana', /\p{Script=Katakana}/u], ['Hangul', /\p{Script=Hangul}/u], ['Thai', /\p{Script=Thai}/u], ['Devanagari', /\p{Script=Devanagari}/u], ['Armenian', /\p{Script=Armenian}/u], ['Cherokee', /\p{Script=Cherokee}/u]];
const scriptOf = (ch: string): string => { if (/[\p{N}]/u.test(ch)) return 'Number'; if (/\s/u.test(ch) || /[\p{P}\p{S}]/u.test(ch)) return 'Common'; for (const [n, re] of SCRIPTS) if (re.test(ch)) return n; return /\p{L}/u.test(ch) ? 'Other' : 'Common'; };

/** Decode a punycode label ("bcher-kva" → "bücher"). */
export function punycodeDecode(input: string): string | null {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700; let n = 128, i = 0, bias = 72;
  const out: number[] = []; let b = input.lastIndexOf('-'); if (b < 0) b = 0;
  for (let j = 0; j < b; j++) { if (input.charCodeAt(j) >= 0x80) return null; out.push(input.charCodeAt(j)); }
  const adapt = (delta: number, num: number, first: boolean) => { let k = 0; delta = first ? Math.floor(delta / damp) : delta >> 1; delta += Math.floor(delta / num); for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin)); return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew)); };
  for (let idx = b > 0 ? b + 1 : 0; idx < input.length;) {
    const oldi = i; let w = 1;
    for (let k = base; ; k += base) {
      if (idx >= input.length) return null;
      const c = input.charCodeAt(idx++), digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (digit >= base) return null; i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias; if (digit < t) break; w *= base - t;
    }
    const len = out.length + 1; bias = adapt(i - oldi, len, oldi === 0); n += Math.floor(i / len); i %= len; out.splice(i++, 0, n);
  }
  try { return String.fromCodePoint(...out); } catch { return null; }
}
export const decodeIdn = (domain: string): string => domain.split('.').map((l) => (/^xn--/i.test(l) ? punycodeDecode(l.slice(4)) ?? l : l)).join('.');

export function inspectText(text: string): TextReport {
  const chars: TextReport['chars'] = [], findings: Finding[] = [], scripts: Record<string, number> = {};
  let skeleton = '', cleaned = '';
  const invis: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!, inv = INVISIBLE[cp] ?? (cp >= 0xe0000 && cp <= 0xe007f ? 'tag character (hidden text)' : cp >= 0xfe00 && cp <= 0xfe0f ? 'variation selector' : undefined);
    const sc = scriptOf(ch), look = CONFUSABLE[ch];
    const suspicious = !!inv || !!look || (/[０-９Ａ-Ｚａ-ｚ]/.test(ch));
    chars.push({ ch, code: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'), name: inv ?? (look ? `${sc} look-alike of "${look}"` : sc), script: sc, suspicious });
    if (inv) { invis.push(inv); if (cp !== 0x00a0 && cp !== 0x3000 && !(cp >= 0xfe00 && cp <= 0xfe0f)) { /* removed */ } else cleaned += cp === 0x00a0 || cp === 0x3000 ? ' ' : ''; continue; }
    if (sc !== 'Common' && sc !== 'Number') scripts[sc] = (scripts[sc] ?? 0) + 1;
    skeleton += look ?? ch.normalize('NFKC'); cleaned += ch;
  }
  const real = Object.keys(scripts);
  const mixedScript = real.length > 1;
  if (invis.length) {
    const uniq = [...new Set(invis)];
    findings.push({ level: 'bad', text: `${invis.length} invisible character${invis.length > 1 ? 's' : ''} (${uniq.join(', ')}). Two names that look the same can differ by these.` });
  }
  if ([...text].some((c) => BIDI.has(c.codePointAt(0)!))) findings.push({ level: 'bad', text: 'Contains text-direction controls. They can make text display in a different order from how it is stored (used to disguise file names and links).' });
  if (mixedScript) findings.push({ level: 'bad', text: `Mixes alphabets: ${real.map((s) => `${s} (${scripts[s]})`).join(', ')}. A real name seldom does; an impersonator's look-alike often does.` });
  const folded = chars.filter((c) => CONFUSABLE[c.ch]);
  if (folded.length) findings.push({ level: mixedScript ? 'bad' : 'warn', text: `${folded.length} letter${folded.length > 1 ? 's are' : ' is a'} look-alike${folded.length > 1 ? 's' : ''} for Latin: ${[...new Set(folded.map((c) => `${c.ch} (${c.code})`))].join(', ')}. It reads as "${skeleton}".` });
  if (/[０-９Ａ-Ｚａ-ｚ]/.test(text)) findings.push({ level: 'warn', text: 'Full-width letters (look like normal letters but are different characters).' });
  if (text !== text.normalize('NFC') && !findings.length) findings.push({ level: 'info', text: 'Contains characters written in a decomposed form (an accent stored as a separate mark). Two copies of the same name can differ in storage.' });
  if (/xn--/i.test(text)) { const dec = decodeIdn(text.trim().toLowerCase()); if (dec !== text.trim().toLowerCase()) findings.push({ level: 'warn', text: `Punycode domain: it displays as "${dec}".` }); }
  if (!findings.length) findings.push({ level: 'info', text: 'Plain text: no invisible, look-alike or mixed-alphabet characters.' });
  return { length: [...text].length, findings, scripts, mixedScript, skeleton, cleaned, chars };
}

/** Do two names look the same to a person while being different strings? */
export function lookAlike(a: string, b: string): boolean {
  if (a === b) return false;
  const sk = (s: string) => inspectText(s).skeleton.normalize('NFKC').toLowerCase();
  return sk(a) === sk(b);
}
