import type { Finding } from './types';
import type { Stress } from './stress';

/**
 * Case health: how much weight the accepted conclusions can bear, in five plain measures. Not a verdict, a prompt: each measure says
 * what would improve it.
 */
export interface HealthPart { key: string; label: string; /** 0..1 */ value: number; detail: string; tip?: string }
export interface Health { score: number; label: 'Strong' | 'Mixed' | 'Thin' | 'Empty'; parts: HealthPart[] }

export function caseHealth(findings: Finding[], stress: Record<string, Pick<Stress, 'verdict'>> = {}, now = Date.now()): Health {
  const accepted = findings.filter((f) => f.status === 'accepted');
  const pending = findings.filter((f) => f.status === 'pending' || f.status === 'unsure');
  if (accepted.length === 0) return { score: 0, label: 'Empty', parts: [] };
  const fam = (f: Finding) => new Set(f.evidence.filter((e) => e.polarity !== 'against').map((e) => e.family)).size;
  const corroborated = accepted.filter((f) => fam(f) >= 2).length / accepted.length;
  const withStress = accepted.filter((f) => stress[f.id]);
  const robust = withStress.length ? withStress.filter((f) => ['solid', 'sturdy'].includes(stress[f.id].verdict)).length / withStress.length : corroborated;
  const disputed = accepted.filter((f) => f.conflictsWith?.length || f.evidence.some((e) => e.polarity === 'against')).length;
  const dated = accepted.filter((f) => f.when && ['phone', 'location', 'org', 'email'].includes(f.type));
  const fresh = dated.length ? dated.filter((f) => (now - Date.parse(f.when!)) / (365.25 * 86_400_000) < 2).length / dated.length : 1;
  const reviewed = accepted.length / (accepted.length + pending.filter((f) => f.level >= 3).length);
  const parts: HealthPart[] = [
    { key: 'corroboration', label: 'Independent corroboration', value: corroborated, detail: `${Math.round(corroborated * 100)}% of accepted findings are backed by two or more independent sources.`, tip: corroborated < 0.7 ? 'Add API keys for more sources, or run Autopilot to cross-check.' : undefined },
    { key: 'robustness', label: 'Survives a wrong source', value: robust, detail: `${Math.round(robust * 100)}% would still stand if any one source turned out to be wrong.`, tip: robust < 0.7 ? 'Turn on the stress map on the graph to see which conclusions hang on one source.' : undefined },
    { key: 'disputes', label: 'Open disputes', value: 1 - Math.min(1, disputed / accepted.length * 2), detail: disputed ? `${disputed} accepted ${disputed === 1 ? 'finding is' : 'findings are'} disputed by another source or a cross-check.` : 'Nothing accepted is disputed.', tip: disputed ? 'Open the disputed findings and decide which answer you trust.' : undefined },
    { key: 'freshness', label: 'Up to date', value: fresh, detail: dated.length ? `${Math.round(fresh * 100)}% of dated claims about phones, places, jobs and emails are under two years old.` : 'No dated claims to go stale.', tip: fresh < 0.6 ? 'Re-check old phone numbers, addresses and employers before relying on them.' : undefined },
    { key: 'backlog', label: 'Strong leads reviewed', value: reviewed, detail: pending.filter((f) => f.level >= 3).length ? `${pending.filter((f) => f.level >= 3).length} strong finding(s) are still waiting for your decision.` : 'No strong finding is waiting.', tip: reviewed < 0.9 ? 'Review the strong leads still in your list.' : undefined },
  ];
  const score = Math.round((parts[0].value * 0.3 + parts[1].value * 0.25 + parts[2].value * 0.2 + parts[3].value * 0.1 + parts[4].value * 0.15) * 100);
  return { score, label: score >= 75 ? 'Strong' : score >= 50 ? 'Mixed' : 'Thin', parts };
}
