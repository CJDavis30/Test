/**
 * Creation-burst detector. Accounts made by one person tend to be made in one go: three accounts in three minutes is a pattern, not a
 * coincidence. A scan statistic slides a window across the account creation times and asks, for every window, how likely so many
 * creations would be if accounts had been made at random over the whole period, then corrects for having looked in many places.
 */
export interface Burst { start: number; end: number; ids: string[]; count: number; expected: number; /** probability under random creation, after correcting for the number of windows examined */ p: number; bits: number; window: number }
export interface Created { id: string; at: number }

/** P(X ≥ k) for X ~ Poisson(mu), computed stably. */
export function poissonTail(k: number, mu: number): number {
  if (k <= 0) return 1;
  let term = Math.exp(-mu), cdf = term;
  for (let i = 1; i < k; i++) { term *= mu / i; cdf += term; }
  return Math.max(0, Math.min(1, 1 - cdf));
}

const WINDOWS = [5 * 60_000, 3_600_000, 86_400_000, 7 * 86_400_000];

export function findBursts(items: Created[], o: { alpha?: number; minCount?: number } = {}): Burst[] {
  const alpha = o.alpha ?? 0.001, minCount = o.minCount ?? 3;
  const t = items.filter((x) => Number.isFinite(x.at)).sort((a, b) => a.at - b.at);
  if (t.length < minCount) return [];
  const span = Math.max(30 * 86_400_000, t[t.length - 1].at - t[0].at);
  const found: Burst[] = [];
  for (const W of WINDOWS) {
    const rate = t.length / span;                    // creations per ms if spread evenly
    const mu = rate * W;
    const tests = Math.max(1, span / W);             // how many independent windows we are effectively looking in
    let i = 0;
    for (let j = 0; j < t.length; j++) {
      while (t[j].at - t[i].at > W) i++;
      const count = j - i + 1;
      if (count < minCount) continue;
      const p = Math.min(1, poissonTail(count, mu) * tests);
      if (p <= alpha) found.push({ start: t[i].at, end: t[j].at, ids: t.slice(i, j + 1).map((x) => x.id), count, expected: mu, p, bits: -Math.log2(Math.max(p, 1e-300)), window: W });
    }
  }
  // keep the most surprising burst for any set of accounts, and drop bursts contained in a better one
  found.sort((a, b) => a.p - b.p || b.count - a.count);
  const kept: Burst[] = [];
  for (const b of found) if (!kept.some((k) => b.ids.every((id) => k.ids.includes(id)))) kept.push(b);
  return kept;
}

export const describeWindow = (ms: number) => (ms <= 5 * 60_000 ? 'five minutes' : ms <= 3_600_000 ? 'an hour' : ms <= 86_400_000 ? 'a day' : 'a week');
