import type { Finding, Level } from './types';
import { levelFor, scoreEvidence, type ReliabilityFn } from './scoring';

/**
 * Stress test: "what if one of the sources is wrong?"
 *
 * Every conclusion is re-scored once per independent source with that source's evidence removed. A conclusion that
 * survives the loss of any single source is robust; one that collapses when a single source is wrong is a single point of
 * failure, however confident it looks today. This is the question a careful analyst asks, answered for every finding.
 */
export interface StressDrop { family: string; name: string; after: number; drop: number }
export interface Stress {
  base: number;
  /** thin: too little to stress · single: one source holds it up · fragile: losing one source breaks it · sturdy: loses a level at worst · solid: unmoved */
  verdict: 'thin' | 'single' | 'fragile' | 'sturdy' | 'solid';
  families: number;
  drops: StressDrop[];
  weakest?: StressDrop;
  /** The lowest the score can fall to if any ONE source turns out to be wrong. */
  survives: number;
  /** If the cross-check that contradicts this finding were itself wrong. */
  ifContradictionWrong?: number;
  headline: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function stressTest(f: Pick<Finding, 'type' | 'evidence' | 'score' | 'level'>, rel: ReliabilityFn): Stress {
  const pro = f.evidence.filter((e) => e.polarity !== 'against');
  const names = new Map<string, string>();
  for (const e of pro) if (!names.has(e.family) || e.kind !== 'cross') names.set(e.family, e.adapterName);
  const families = names.size;
  const full = scoreEvidence(f.type, f.evidence, rel).score;
  // conflict demotion is applied on top of the raw score; carry it through so the numbers shown match the numbers on screen
  const k = full > 0 ? Math.min(1, f.score / full) : 1;
  const base = f.score;

  const drops: StressDrop[] = [...names.entries()].map(([family, name]) => {
    const after = scoreEvidence(f.type, f.evidence.filter((e) => e.family !== family), rel).score * k;
    return { family, name, after, drop: Math.max(0, base - after) };
  }).sort((a, b) => b.drop - a.drop || a.name.localeCompare(b.name));
  const weakest = drops[0];
  const survives = drops.length ? Math.min(...drops.map((d) => d.after)) : 0;

  let ifContradictionWrong: number | undefined;
  if (f.evidence.some((e) => e.polarity === 'against')) ifContradictionWrong = scoreEvidence(f.type, f.evidence.filter((e) => e.polarity !== 'against'), rel).score * k;

  let verdict: Stress['verdict'];
  if (families === 0 || f.level <= 1) verdict = 'thin';
  else if (families === 1) verdict = 'single';
  else {
    const worstLevel: Level = levelFor(survives);
    verdict = worstLevel <= f.level - 2 || survives < 0.4 ? 'fragile' : worstLevel === f.level ? 'solid' : 'sturdy';
  }

  let headline: string;
  switch (verdict) {
    case 'thin': headline = families === 0 ? 'Nothing to stress: no supporting evidence.' : 'Too little evidence to stress-test. Treat it as a lead.'; break;
    case 'single': headline = `Rests entirely on ${weakest.name}. If that one source is wrong, nothing is left.`; break;
    case 'fragile': headline = `Hinges on ${weakest.name}: if it is wrong, ${pct(base)} falls to ${pct(weakest.after)}.`; break;
    case 'sturdy': headline = `Holds up if any one source is wrong, at worst ${pct(survives)} (from ${pct(base)}).`; break;
    default: headline = `Unmoved if any one source is wrong: never below ${pct(survives)}.`;
  }
  return { base, verdict, families, drops, weakest, survives, ifContradictionWrong, headline };
}

export interface Dependency { family: string; name: string; /** conclusions that lose at least one level if this source is wrong */ weakens: Finding[]; /** conclusions that would be left with nothing */ collapses: Finding[] }

/** Across the whole case: which sources are your accepted conclusions leaning on hardest? */
export function dependencies(accepted: Finding[], rel: ReliabilityFn): Dependency[] {
  const by = new Map<string, Dependency>();
  for (const f of accepted) {
    const s = stressTest(f, rel);
    for (const d of s.drops) {
      const lost = levelFor(d.after) < f.level;
      if (!lost) continue;
      const dep = by.get(d.family) ?? by.set(d.family, { family: d.family, name: d.name, weakens: [], collapses: [] }).get(d.family)!;
      dep.weakens.push(f);
      if (d.after < 0.2) dep.collapses.push(f);
    }
  }
  return [...by.values()].sort((a, b) => b.weakens.length - a.weakens.length || b.collapses.length - a.collapses.length);
}
