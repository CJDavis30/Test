/**
 * Alternation test: one person can only be in one place at a time.
 *
 * Two accounts run by two people are active at overlapping times as often as chance and their daily rhythms allow. Two accounts run by
 * ONE person take turns: their sittings almost never overlap. For each account's sittings (bursts of activity) we compute how many would
 * be expected to overlap the other's if the two were independent, given when each is typically awake, and compare that with what was
 * observed. Zero overlap where dozens were expected is strong evidence of a single operator; heavy overlap is strong evidence of two.
 *
 * It needs dense activity: with only a few sittings, overlap is rare for everyone and nothing can be concluded, so it says so.
 */
import { sessionize } from './circadian';

export interface Sitting { start: number; end: number }
export interface Alternation {
  /** sittings compared, per account */
  a: number; b: number;
  observed: number;
  /** how many of A's sittings would overlap one of B's if they were unrelated */
  expected: number;
  bits: number;
  detail: string;
  assumption: string;
}

const GAP = 20 * 60_000;

/** Group timestamps into sittings: runs with no gap longer than 20 minutes. A single message is a one-minute sitting. */
export function sittings(times: number[]): Sitting[] {
  const t = [...times].filter(Number.isFinite).sort((x, y) => x - y);
  const out: Sitting[] = [];
  for (const x of t) { const last = out[out.length - 1]; if (last && x - last.end <= GAP) last.end = x; else out.push({ start: x, end: x }); }
  return out.map((s) => ({ start: s.start, end: Math.max(s.end, s.start + 60_000) }));
}

const overlaps = (a: Sitting, bs: Sitting[]): boolean => {
  // bs sorted by start; binary search the first that could overlap
  let lo = 0, hi = bs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bs[m].end < a.start) lo = m + 1; else hi = m; }
  return lo < bs.length && bs[lo].start <= a.end;
};

/** Fraction of each UTC hour-of-day that this account's sittings cover, averaged over the days it was observed. */
function coverage(S: Sitting[]): { byHour: number[]; meanLen: number; days: number } {
  const byHour = new Array(24).fill(0);
  let total = 0;
  for (const s of S) {
    total += s.end - s.start;
    for (let t = s.start; t < s.end; ) { const h = new Date(t).getUTCHours(); const next = Math.min(s.end, Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate(), h + 1)); byHour[h] += next - t; t = next; }
  }
  const span = Math.max(86_400_000, S[S.length - 1].end - S[0].start);
  const days = span / 86_400_000;
  return { byHour: byHour.map((x) => x / (days * 3_600_000)), meanLen: total / S.length, days };
}

export function alternation(timesA: number[], timesB: number[]): Alternation | null {
  const A = sittings(timesA), B = sittings(timesB);
  if (A.length < 20 || B.length < 20) return null;
  const cb = coverage(B);
  const lo = B[0].start, hi = B[B.length - 1].end;
  // only compare where B was observed at all
  const inRange = A.filter((s) => s.end >= lo && s.start <= hi);
  if (inRange.length < 20) return null;
  let observed = 0, expected = 0;
  for (const s of inRange) {
    const dur = s.end - s.start;
    const h = new Date(s.start).getUTCHours();
    // chance an unrelated account is mid-sitting at some point of this one: its coverage at that hour, widened by how long both sittings run
    expected += Math.min(1, cb.byHour[h] * (1 + (dur + cb.meanLen) / cb.meanLen));
    if (overlaps(s, B)) observed++;
  }
  if (expected < 5) return null;
  // H1 (one operator): overlap thinned to 10% of chance (people do juggle devices). H0: Poisson(expected). LR = e^{0.9·μ}·0.1^{O}
  const raw = (0.9 * expected) * Math.LOG2E - observed * Math.log2(10);
  const bits = Math.max(-6, Math.min(15, raw));
  const pct = (x: number) => `${Math.round(x)}`;
  return {
    a: inRange.length, b: B.length, observed, expected, bits,
    detail: observed === 0
      ? `Across ${inRange.length} sittings, never active at the same moment as the other account, where about ${pct(expected)} overlaps would be expected by chance. One person taking turns looks exactly like this.`
      : `${observed} of ${inRange.length} sittings overlapped the other account; about ${pct(expected)} would be expected by chance.${observed >= expected * 0.6 ? ' That is normal for two people.' : ''}`,
    assumption: 'Assumes one person juggling two accounts overlaps a tenth as often as chance (multiple devices exist), and that each account\'s usual hours explain the rest. Needs about 20+ sittings each and enough overlap expected by chance to be meaningful. Capped between −6 and +15 bits.',
  };
}
