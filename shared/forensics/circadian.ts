/**
 * Circadian fingerprint: when is this person awake, and what does that say about where they are?
 *
 * Any collection of timestamps (Discord message IDs, commit times, post times, pasted log lines) is a record of when someone was awake.
 * People sleep at night wherever they live, so the quiet hours in UTC reveal their offset from UTC. This is a Bayesian estimate, not a
 * guess from the single quietest hour: every one of the 24 possible offsets gets a probability from how well a typical human
 * day-night pattern fits the observed activity.
 *
 * Honest limits, built into the output: bursts of messages are one sitting, not many independent facts, so activity is first collapsed into
 * sessions; night-shift workers, travellers and teenagers on holiday look like somewhere else; daylight saving shifts a place by an hour.
 */

/** Relative chance of being active in each LOCAL hour (0-23). A broad human day: deep trough 02-06, morning ramp, long afternoon, evening peak. */
const DAY = [0.55, 0.30, 0.15, 0.08, 0.06, 0.07, 0.12, 0.30, 0.55, 0.75, 0.85, 0.90, 0.95, 0.95, 0.95, 1.0, 1.0, 1.0, 1.05, 1.15, 1.25, 1.3, 1.15, 0.85];
const SUM = DAY.reduce((a, b) => a + b, 0);
export const TEMPLATE = DAY.map((x) => x / SUM);

export interface OffsetP { offset: number; p: number }
export interface Circadian {
  /** timestamps used, and the independent sittings they collapse to */
  n: number; sessions: number;
  /** activity by hour of day in UTC */
  histogram: number[];
  offsets: OffsetP[];
  best: OffsetP;
  /** the offsets that together hold at least 80% of the probability */
  credible: number[];
  /** 'strong' needs a clear winner and enough sittings; otherwise it is only a lean */
  strength: 'strong' | 'lean' | 'insufficient';
  /** the quiet stretch, in UTC hours (start inclusive, end exclusive) */
  sleepUtc?: [number, number];
  region: string;
  summary: string;
}

const REGION: Record<number, string> = {
  [-12]: 'Pacific (Baker Island)', [-11]: 'Pacific (Samoa)', [-10]: 'Hawaii', [-9]: 'Alaska', [-8]: 'US and Canada Pacific', [-7]: 'US Mountain', [-6]: 'US Central, Mexico, Central America',
  [-5]: 'US and Canada Eastern, Colombia, Peru', [-4]: 'Atlantic Canada, Venezuela, Chile', [-3]: 'Brazil, Argentina', [-2]: 'Mid-Atlantic', [-1]: 'Azores', 0: 'UK, Ireland, Portugal, West Africa',
  1: 'Central Europe, West Africa', 2: 'Eastern Europe, South Africa, Egypt', 3: 'Moscow, Turkey, East Africa, Arabia', 4: 'Gulf states, Caucasus', 5: 'Pakistan, Central Asia', 6: 'Bangladesh, Kazakhstan',
  7: 'Thailand, Vietnam, western Indonesia', 8: 'China, Singapore, Philippines, western Australia', 9: 'Japan, Korea', 10: 'Eastern Australia', 11: 'Solomon Islands, Vladivostok', 12: 'New Zealand, Fiji',
};
export const regionOf = (o: number) => REGION[o] ?? `UTC${o >= 0 ? '+' : ''}${o}`;
export const fmtOffset = (o: number) => `UTC${o >= 0 ? '+' : '−'}${Math.abs(o)}`;

const SESSION_GAP_MS = 45 * 60_000;

/** Collapse bursts: messages within 45 minutes of each other are one sitting, counted once at its start. */
export function sessionize(times: number[]): number[] {
  const t = [...times].filter(Number.isFinite).sort((a, b) => a - b);
  const out: number[] = []; let last = -Infinity;
  for (const x of t) { if (x - last > SESSION_GAP_MS) out.push(x); last = x; }
  return out;
}

export function circadian(times: number[]): Circadian | null {
  const clean = times.filter(Number.isFinite);
  if (clean.length < 3) return null;
  const starts = sessionize(clean);
  const hist = new Array(24).fill(0);
  for (const s of starts) hist[new Date(s).getUTCHours()]++;
  const raw = new Array(24).fill(0); for (const s of clean) raw[new Date(s).getUTCHours()]++;

  // log-likelihood of each offset (local = UTC + offset), then a flat prior over -12..+12 and softmax
  const offs = Array.from({ length: 25 }, (_, i) => i - 12);
  const ll = offs.map((o) => { let l = 0; for (let u = 0; u < 24; u++) if (hist[u]) l += hist[u] * Math.log(TEMPLATE[(((u + o) % 24) + 24) % 24]); return l; });
  const max = Math.max(...ll);
  const w = ll.map((l) => Math.exp(l - max)); const z = w.reduce((a, b) => a + b, 0);
  // -12 and +12 are the same clock; fold them together so one place does not look like two
  const p = offs.map((o, i) => ({ offset: o, p: w[i] / z }));
  const pm12 = p.find((x) => x.offset === -12)!, pp12 = p.find((x) => x.offset === 12)!;
  pp12.p += pm12.p; p.splice(p.indexOf(pm12), 1);
  const sorted = [...p].sort((a, b) => b.p - a.p);
  const best = sorted[0];
  let acc = 0; const credible: number[] = [];
  for (const x of sorted) { credible.push(x.offset); acc += x.p; if (acc >= 0.8) break; }

  // the quietest 6 hours (circular) of the observed UTC histogram, as a plain-language sleep window
  let bestStart = 0, bestSum = Infinity;
  for (let s = 0; s < 24; s++) { let t = 0; for (let k = 0; k < 6; k++) t += raw[(s + k) % 24]; if (t < bestSum) { bestSum = t; bestStart = s; } }
  const strength: Circadian['strength'] = starts.length < 12 ? 'insufficient' : best.p >= 0.6 && starts.length >= 20 ? 'strong' : 'lean';
  const sleepUtc: [number, number] | undefined = starts.length >= 8 ? [bestStart, (bestStart + 6) % 24] : undefined;
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const summary = strength === 'insufficient'
    ? `Only ${starts.length} separate sittings: too few to say where this person lives. About 20 or more are needed.`
    : `${strength === 'strong' ? 'Most likely' : 'Leans toward'} ${fmtOffset(best.offset)} (${regionOf(best.offset)}), ${Math.round(best.p * 100)}% likely${credible.length > 1 ? `; ${Math.round(acc * 100)}% within ${credible.length} neighbouring offsets` : ''}. ${sleepUtc ? `Quiet ${hh(sleepUtc[0])}–${hh(sleepUtc[1])} UTC.` : ''}`;
  return { n: clean.length, sessions: starts.length, histogram: hist, offsets: sorted, best, credible, strength, sleepUtc, region: regionOf(best.offset), summary };
}
