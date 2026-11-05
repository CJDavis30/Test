/**
 * Writing-style matcher. People have habits they cannot see: which small words they lean on, how they punctuate, whether they capitalise,
 * stretch letters ("sooo"), type "ur" or "your". Two writing samples from one person tend to share those habits; two different people
 * usually don't. This is WEAK evidence on its own (short texts, copied phrases and deliberate imitation all fool it), so the result
 * says how much text it had and never claims more than "similar" or "different".
 */

const FUNCTION_WORDS = new Set(('the of and to a in that is was he for it with as his on be at by i this had not are but from or have an they which one you were her all she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three'.split(/\s+/)));
const SHORTHAND = ['lol', 'lmao', 'idk', 'tbh', 'ngl', 'imo', 'btw', 'omg', 'brb', 'rn', 'smh', 'fr', 'bruh', 'bro', 'u', 'ur', 'r', 'pls', 'plz', 'thx', 'ty', 'gonna', 'wanna', 'gotta', 'kinda', 'yeah', 'yep', 'nah', 'ok', 'okay'];

export interface StyleFeatures {
  words: number; chars: number; sentences: number;
  avgWord: number; avgSentence: number; capsStart: number; allCaps: number; lowerI: number; elongated: number; emojiPer100: number;
  rate: Record<string, number>;
  fw: Map<string, number>; tri: Map<string, number>;
}

export function features(text: string): StyleFeatures {
  const t = text.replace(/\r/g, '');
  const words = t.toLowerCase().match(/[a-z']+/g) ?? [];
  const sentences = t.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s));
  const per = (n: number, d = Math.max(1, words.length)) => (n / d) * 100;
  const count = (re: RegExp) => (t.match(re) ?? []).length;
  const rate: Record<string, number> = {
    'exclamation marks': per(count(/!/g)), 'question marks': per(count(/\?/g)), commas: per(count(/,/g)), 'periods': per(count(/\./g)), 'ellipses': per(count(/\.{3}|…/g)), 'semicolons': per(count(/;/g)), 'dashes': per(count(/ - |—|–/g)), 'apostrophes': per(count(/['’]/g)), 'quotes': per(count(/["“”]/g)), 'parentheses': per(count(/[()]/g)), 'double spaces': per(count(/\. {2,}/g)), 'repeated punctuation (!!, ??)': per(count(/[!?]{2,}/g)),
    'shorthand (lol, idk, ur…)': per(words.filter((w) => SHORTHAND.includes(w)).length),
  };
  const fw = new Map<string, number>(); for (const w of words) if (FUNCTION_WORDS.has(w)) fw.set(w, (fw.get(w) ?? 0) + 1);
  const norm = t.toLowerCase().replace(/\s+/g, ' '), tri = new Map<string, number>();
  for (let i = 0; i + 3 <= norm.length; i++) { const g = norm.slice(i, i + 3); tri.set(g, (tri.get(g) ?? 0) + 1); }
  return {
    words: words.length, chars: t.length, sentences: sentences.length,
    avgWord: words.length ? words.join('').length / words.length : 0,
    avgSentence: sentences.length ? words.length / sentences.length : 0,
    capsStart: sentences.length ? sentences.filter((s) => /^[A-Z]/.test(s.replace(/^[^a-z]+/i, ''))).length / sentences.length : 0,
    allCaps: per(count(/\b[A-Z]{3,}\b/g)), lowerI: per(count(/\bi\b(?!['’.])/g)), elongated: per(count(/([a-z])\1{2,}/gi)),
    emojiPer100: per((t.match(/\p{Extended_Pictographic}/gu) ?? []).length),
    rate, fw, tri,
  };
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; const w = b.get(k); if (w) dot += v * w; }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const rel = (x: number, y: number) => (x === 0 && y === 0 ? 1 : 1 - Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y)));

export interface StyleCompare {
  similarity: number; verdict: 'very similar' | 'similar' | 'inconclusive' | 'different' | 'too little text';
  reliability: 'low' | 'fair' | 'good'; words: [number, number];
  rows: { label: string; a: string; b: string; match: number; /** false when both texts score zero: no information either way */ informative: boolean }[];
  notes: string[];
}

export function compareStyle(a: string, b: string): StyleCompare {
  const A = features(a), B = features(b), notes: string[] = [];
  const minWords = Math.min(A.words, B.words);
  const reliability = minWords >= 600 ? 'good' : minWords >= 200 ? 'fair' : 'low';
  const rows: StyleCompare['rows'] = [];
  const row = (label: string, x: number, y: number, fmt: (n: number) => string = (n) => n.toFixed(1)) => rows.push({ label, a: fmt(x), b: fmt(y), match: rel(x, y), informative: !(x === 0 && y === 0) });
  row('Average word length', A.avgWord, B.avgWord); row('Average sentence length (words)', A.avgSentence, B.avgSentence);
  row('Sentences starting with a capital', A.capsStart * 100, B.capsStart * 100, (n) => `${Math.round(n)}%`);
  row('ALL-CAPS words per 100', A.allCaps, B.allCaps); row('Lower-case "i" per 100 words', A.lowerI, B.lowerI); row('Stretched letters (sooo) per 100', A.elongated, B.elongated); row('Emoji per 100 words', A.emojiPer100, B.emojiPer100);
  for (const k of Object.keys(A.rate)) row(`${k[0].toUpperCase()}${k.slice(1)} per 100 words`, A.rate[k], B.rate[k]);
  const used = rows.filter((r) => r.informative), habit = used.length ? used.reduce((s, r) => s + r.match, 0) / used.length : 0;
  const fwA = new Map([...A.fw].map(([k, v]) => [k, v / Math.max(1, A.words)])), fwB = new Map([...B.fw].map(([k, v]) => [k, v / Math.max(1, B.words)]));
  const fwCos = cosine(fwA, fwB), triCos = cosine(A.tri, B.tri);
  // trigram cosine of any two English texts is already high, so spread the useful range
  const tri = Math.max(0, (triCos - 0.55) / 0.45), fwc = Math.max(0, (fwCos - 0.6) / 0.4);
  const similarity = Math.max(0, Math.min(1, 0.4 * habit + 0.3 * fwc + 0.3 * tri));
  if (minWords < 40) { return { similarity, verdict: 'too little text', reliability: 'low', words: [A.words, B.words], rows, notes: ['Under 40 words in one of the samples: style cannot be measured. Paste at least a few hundred words from each.'] }; }
  if (reliability === 'low') notes.push(`Only ${minWords} words in the smaller sample. Style comparison needs about 600 words each to be dependable; treat this as a hint.`);
  if (Math.abs(A.words - B.words) > 4 * Math.min(A.words, B.words)) notes.push('One sample is much longer than the other, which weakens the comparison.');
  notes.push('Copied phrases, quoted text, translation, or someone deliberately imitating another person all fool this. Use it to prioritise leads, never as proof of identity.');
  const verdict = similarity >= 0.75 ? 'very similar' : similarity >= 0.58 ? 'similar' : similarity >= 0.42 ? 'inconclusive' : 'different';
  return { similarity, verdict, reliability, words: [A.words, B.words], rows, notes };
}
