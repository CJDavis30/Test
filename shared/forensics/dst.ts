import { TEMPLATE, sessionize, fmtOffset } from './circadian';

/**
 * Daylight-saving fingerprint. Places on the same UTC offset in winter can differ in summer: Chicago springs forward in March, Mexico City
 * no longer does, London and Berlin change on different days than New York, and the southern hemisphere changes in October. If activity
 * drifts one hour earlier in UTC when summer arrives, the person lives somewhere that changes its clocks, and the dates narrow down where.
 *
 * Four regimes are compared against the activity: no change, the US/Canada rule, the EU rule, and the southern-hemisphere rule. Each is
 * scored with the same human day curve used for the timezone estimate, jointly with every possible standard offset.
 */
export type DstRegime = 'none' | 'us' | 'eu' | 'south';
export type DstGroup = 'none' | 'north' | 'south';
export interface DstResult {
  regimes: { regime: DstRegime; p: number }[];
  /** the question that can actually be answered: do the clocks change, and in which hemisphere? */
  groups: { group: DstGroup; p: number }[];
  best: { regime: DstRegime; p: number };
  group: { group: DstGroup; p: number };
  /** within the northern group, which rule fits better (the two differ only in a few weeks, so this is weak) */
  rule?: { regime: 'us' | 'eu'; p: number };
  sessions: number; strength: 'strong' | 'lean' | 'insufficient'; bestOffset: number; summary: string;
}

const nthSunday = (y: number, m: number, n: number): number => { const first = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (n - 1) * 7; };
const lastSunday = (y: number, m: number): number => { const last = new Date(Date.UTC(y, m + 1, 0)); return last.getUTCDate() - last.getUTCDay(); };

/** Is daylight time in force at this UTC instant under the regime? (Transition hours are approximated to the nearest whole day: ±1 day is within the noise.) */
export function inDst(t: number, regime: DstRegime): boolean {
  if (regime === 'none') return false;
  const d = new Date(t), y = d.getUTCFullYear();
  if (regime === 'us') return t >= Date.UTC(y, 2, nthSunday(y, 2, 2), 9) && t < Date.UTC(y, 10, nthSunday(y, 10, 1), 8);
  if (regime === 'eu') return t >= Date.UTC(y, 2, lastSunday(y, 2), 1) && t < Date.UTC(y, 9, lastSunday(y, 9), 1);
  // south: starts first Sunday of October, ends first Sunday of April, so it spans the new year
  return t >= Date.UTC(y, 9, nthSunday(y, 9, 1), 16) || t < Date.UTC(y, 3, nthSunday(y, 3, 1), 16);
}

const NAME: Record<DstRegime, string> = { none: 'no daylight saving', us: 'US/Canada daylight saving', eu: 'European daylight saving', south: 'southern-hemisphere daylight saving' };
export const regimeName = (r: DstRegime) => NAME[r];

export function dstFingerprint(times: number[]): DstResult | null {
  const starts = sessionize(times.filter(Number.isFinite));
  if (starts.length < 3) return null;
  const regimes: DstRegime[] = ['none', 'us', 'eu', 'south'];
  const ll: { regime: DstRegime; offset: number; l: number }[] = [];
  for (const regime of regimes) for (let o = -12; o <= 12; o++) {
    let l = 0;
    for (const t of starts) { const lh = ((new Date(t).getUTCHours() + o + (inDst(t, regime) ? 1 : 0)) % 24 + 24) % 24; l += Math.log(TEMPLATE[lh]); }
    ll.push({ regime, offset: o, l });
  }
  const max = Math.max(...ll.map((x) => x.l));
  const z = ll.reduce((a, x) => a + Math.exp(x.l - max), 0);
  const pReg = new Map<DstRegime, number>(regimes.map((r) => [r, 0]));
  for (const x of ll) pReg.set(x.regime, pReg.get(x.regime)! + Math.exp(x.l - max) / z);
  const out = regimes.map((regime) => ({ regime, p: pReg.get(regime)! })).sort((a, b) => b.p - a.p);
  const bestOffset = [...ll].filter((x) => x.regime === out[0].regime).sort((a, b) => b.l - a.l)[0].offset;
  const gp = (g: DstGroup) => (g === 'none' ? pReg.get('none')! : g === 'south' ? pReg.get('south')! : pReg.get('us')! + pReg.get('eu')!);
  const groups = (['none', 'north', 'south'] as DstGroup[]).map((group) => ({ group, p: gp(group) })).sort((a, b) => b.p - a.p);
  const northTotal = pReg.get('us')! + pReg.get('eu')!;
  const rule = northTotal > 0.5 ? (pReg.get('us')! >= pReg.get('eu')! ? { regime: 'us' as const, p: pReg.get('us')! / northTotal } : { regime: 'eu' as const, p: pReg.get('eu')! / northTotal }) : undefined;
  // it can only tell groups apart if activity spans both halves of the year
  const winter = starts.filter((t) => !inDst(t, 'us') && !inDst(t, 'eu')).length, summer = starts.length - winter;
  const strength: DstResult['strength'] = starts.length < 80 || Math.min(winter, summer) < 25 ? 'insufficient' : groups[0].p >= 0.8 ? 'strong' : 'lean';
  const WORD: Record<DstGroup, string> = { none: 'the clocks do not change', north: 'the clocks change in spring and autumn (northern hemisphere)', south: 'the clocks change in October and April (southern hemisphere)' };
  const summary = strength === 'insufficient'
    ? 'Not enough activity across both summer and winter to tell whether the clocks change where this person lives.'
    : `${strength === 'strong' ? 'Suggests' : 'Leans toward'} ${WORD[groups[0].group]} (${Math.round(groups[0].p * 100)}%)${groups[0].group === 'north' && rule && rule.p >= 0.7 ? `; closer to the ${rule.regime === 'us' ? 'US/Canada' : 'European'} dates (${Math.round(rule.p * 100)}% of that)` : ''}.`;
  return { regimes: out, groups, best: out[0], group: groups[0], rule, sessions: starts.length, strength, bestOffset: -bestOffset, summary };
}
