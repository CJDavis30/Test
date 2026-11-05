/**
 * Handles are not random: people reuse them, decorate them (xX_name_Xx), leetspeak them (m4r4), and append years (name2009). This module
 * understands those habits and, crucially, how SURPRISING a shared handle is. Sharing "john" proves nothing; sharing "maralinden9" is
 * a coincidence of about one in a billion. Surprise is measured in bits (each bit halves the chance it happened by accident).
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '8': 'b' };

/** Very common handle words: sharing one is nearly meaningless (about 1 in 64). */
const COMMON = new Set(('the real official gamer gaming pro xx dark king queen boy girl game roblox minecraft cool epic ninja lord master noob yt tv dev just its not mr mrs miss lil big little ' +
  'fire ice wolf dragon shadow ghost killer sniper legend toxic dope swag baby bear cat dog fox hero star sun moon night light angel devil crazy happy sad lol omg fan fans ' +
  'plays play playz live tube music art boss team clan guild squad best top one two').split(' '));

export interface HandleParts {
  raw: string;
  /** lowercase, decorations stripped */
  clean: string;
  /** the same with leetspeak folded to letters and separators and trailing digits removed: the "identity" of a handle */
  core: string;
  tokens: string[];
  trailingDigits: string;
  decorated: boolean;
  leet: boolean;
}

export function parseHandle(raw: string): HandleParts {
  let s = raw.trim().replace(/^@/, '').toLowerCase();
  const before = s;
  s = s.replace(/^(x+[_.-]*)(.+?)([_.-]*x+)$/i, (_m, _a, mid) => mid); // xX_name_Xx
  s = s.replace(/^[~_.-]+|[~_.-]+$/g, '');
  const decorated = s !== before.replace(/^@/, '');
  const trailingDigits = (s.match(/(\d{1,4})$/) ?? [''])[0];
  const noYear = trailingDigits && s.length > trailingDigits.length + 2 ? s.slice(0, -trailingDigits.length) : s;
  const leet = /[a-z][01345789@$!]|[01345789@$!][a-z]/.test(noYear) && /[a-z]/.test(noYear);
  const folded = [...noYear].map((c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');
  const tokens = noYear.split(/[^a-z0-9]+|(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/).map((t) => [...t].map((c) => LEET[c] ?? c).join('')).filter((t) => /^[a-z]{3,}$/.test(t));
  return { raw, clean: s, core: folded, tokens, trailingDigits, decorated, leet };
}

/** Rough bits of surprise of a string: word-like text costs ~2.8 bits a letter, random-looking text ~4.3, very common handle words ~6 in all. */
export function rarityBits(token: string): number {
  const t = token.toLowerCase();
  if (!t) return 0;
  if (COMMON.has(t)) return 6;
  const letters = t.replace(/[^a-z]/g, '');
  if (!letters) return Math.min(30, t.length * 3.3);
  const vowels = (letters.match(/[aeiouy]/g) ?? []).length / letters.length;
  const runs = /[^aeiouy]{5,}/.test(letters) || /(.)\1{3,}/.test(letters);
  const randomish = vowels < 0.12 || vowels > 0.75 || runs || /\d/.test(t) && /[a-z]/.test(t) && t.replace(/\d/g, '').length < t.length * 0.6;
  const per = randomish ? 4.3 : 2.8;
  return Math.min(34, Math.max(2, letters.length * per - (letters.length > 14 ? (letters.length - 14) * 1.2 : 0)) + (t.length - letters.length) * 3.3);
}

const ed = (a: string, b: string): number => {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
};

/**
 * Even a very rare handle is only so convincing. Impersonators, squatters and fans copy handles on purpose, and namesakes pick the obvious
 * one, so the evidence from a name is capped well below what its rarity alone would suggest. Things an impostor cannot copy (when the account
 * was created, shared contact details) are what settle it.
 */
export const HANDLE_CAP = { identical: 8, 'same-core': 7, 'shared-token': 5, near: 4 } as const;

export interface HandleMatch { kind: 'identical' | 'same-core' | 'shared-token' | 'near' | 'different'; bits: number; detail: string }

/** How much does it tell us that these two handles look like this? Positive bits favour "same person", negative favour "different". */
export function compareHandles(a: string, b: string): HandleMatch {
  const A = parseHandle(a), B = parseHandle(b);
  if (!A.core || !B.core) return { kind: 'different', bits: 0, detail: 'One of the handles has no letters to compare.' };
  if (A.clean === B.clean) { const r = rarityBits(A.core); return { kind: 'identical', bits: Math.min(HANDLE_CAP.identical, Math.max(0.5, r - 0.7)), detail: `Identical handle “${A.clean}” (about ${Math.round(r)} bits of surprise). Counted for at most ${HANDLE_CAP.identical} bits: copying a handle is easy, so a matching name alone cannot prove much.` }; }
  if (A.core === B.core) {
    const why = [A.trailingDigits !== B.trailingDigits ? 'different trailing numbers' : '', A.decorated !== B.decorated ? 'decoration added or removed' : '', A.leet !== B.leet ? 'leetspeak' : ''].filter(Boolean).join(', ') || 'punctuation';
    const r = rarityBits(A.core);
    return { kind: 'same-core', bits: Math.min(HANDLE_CAP['same-core'], Math.max(0.5, r - 1.8)), detail: `The same name “${A.core}” written two ways (${why}).` };
  }
  const shared = A.tokens.filter((t) => B.tokens.includes(t) && t.length >= 4).sort((x, y) => y.length - x.length)[0];
  if (shared) { const r = rarityBits(shared); return { kind: 'shared-token', bits: Math.min(HANDLE_CAP['shared-token'], Math.max(0.3, r - 2.8)), detail: `Both contain “${shared}” (${Math.round(r)} bits of surprise${COMMON.has(shared) ? ', but it is a very common handle word' : ''}).` }; }
  const long = A.core.length >= B.core.length ? A.core : B.core, d = ed(A.core, B.core);
  if (long.length >= 7 && d <= Math.max(1, Math.floor(long.length / 6))) { const r = rarityBits(long) * (1 - d / long.length); return { kind: 'near', bits: Math.min(HANDLE_CAP.near, Math.max(0.3, r - 3.2)), detail: `Differ by ${d} letter${d > 1 ? 's' : ''}: “${A.core}” vs “${B.core}”.` }; }
  return { kind: 'different', bits: -1, detail: 'Different handles. Most people reuse a handle only about half the time, so this is only mild evidence against.' };
}

/** Plausible variations of a handle people actually make, most likely first. Useful for deciding what else to look up. */
export function variants(handle: string, limit = 12): string[] {
  const p = parseHandle(handle); if (!p.core) return [];
  const base = p.clean.replace(/\d{1,4}$/, '') || p.clean;
  const set = new Set<string>();
  const add = (s: string) => { if (s && s !== p.clean && s.length >= 3 && s.length <= 30) set.add(s); };
  add(base); add(p.core);
  for (const sep of ['_', '.', '-']) { add(base.replace(/[_.-]/g, sep)); add(`${base}${sep}`); add(`${sep}${base}`); }
  add(base.replace(/[_.-]/g, ''));
  for (const y of ['1', '01', '123', '2', '7', '99', String(new Date().getFullYear()).slice(2)]) add(base + y);
  if (p.trailingDigits) for (const y of ['', '1', '01']) add(base + y);
  add(`real${base}`); add(`${base}official`); add(`its${base}`); add(`${base}yt`);
  add([...base].map((c) => ({ o: '0', i: '1', e: '3', a: '4', s: '5', t: '7' }[c] ?? c)).join(''));
  return [...set].slice(0, limit);
}
