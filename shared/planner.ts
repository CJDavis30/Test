import type { EntityType, Finding } from './types';

/**
 * Next best move. Instead of a generic "dig deeper", ask which single check would most reduce what we do not know, and say what it would
 * probably show. For each uncertain finding and each source that could check it and has not yet been asked, we work out how much the
 * answer is expected to sharpen the picture (expected reduction in uncertainty, in bits) and what the confidence would become either way.
 *
 * The model is deliberately simple and stated: a source that is reliable with reliability r confirms a true claim with probability r·c
 * and a false one with probability (1−r)·c/2, where c is how often it has coverage at all. Confidence moves by Bayes' rule.
 */
export interface Candidate { id: string; name: string; reliability: number; accepts: EntityType[]; used: boolean; needsKey: boolean; keySet: boolean; enabled: boolean }
export interface Move {
  findingId: string; type: EntityType; value: string; label: string;
  source: Candidate;
  before: number; ifConfirms: number; ifSilent: number; pConfirm: number;
  /** expected uncertainty removed, in bits */
  gain: number;
  /** what you have to do */
  action: 'lookup' | 'add-key' | 'enable';
  why: string;
}

const COVERAGE = 0.6;
const H = (p: number) => (p <= 0 || p >= 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p)));
const post = (p: number, lr: number) => { const o = (p / (1 - p)) * lr; return o / (1 + o); };

export function expectedGain(p: number, r: number): { gain: number; ifConfirms: number; ifSilent: number; pConfirm: number } {
  p = Math.min(0.995, Math.max(0.005, p)); r = Math.min(0.97, Math.max(0.3, r));
  const hitTrue = COVERAGE * r, hitFalse = COVERAGE * (1 - r) * 0.5;
  const lrHit = hitTrue / hitFalse, lrMiss = (1 - hitTrue) / (1 - hitFalse);
  const pConfirm = p * hitTrue + (1 - p) * hitFalse;
  const ifConfirms = post(p, lrHit), ifSilent = post(p, lrMiss);
  const after = pConfirm * H(ifConfirms) + (1 - pConfirm) * H(ifSilent);
  return { gain: Math.max(0, H(p) - after), ifConfirms, ifSilent, pConfirm };
}

export function bestMoves(findings: (Pick<Finding, 'id' | 'type' | 'value' | 'score' | 'status' | 'evidence' | 'conflictsWith'> & { label?: string })[], sources: Candidate[], limit = 5): Move[] {
  const moves: Move[] = [];
  for (const f of findings) {
    if (f.status === 'rejected' || f.status === 'accepted') continue;
    const used = new Set(f.evidence.map((e) => e.adapter));
    // importance: disputed findings matter more; things already near-certain or near-hopeless matter little (the entropy already says so)
    const weight = f.conflictsWith?.length ? 1.25 : 1;
    for (const s of sources) {
      if (!s.accepts.includes(f.type) || used.has(s.id) || s.used) continue;
      const g = expectedGain(f.score, s.reliability);
      const action: Move['action'] = !s.enabled ? 'enable' : s.needsKey && !s.keySet ? 'add-key' : 'lookup';
      moves.push({
        findingId: f.id, type: f.type, value: f.value, label: f.label ?? f.value, source: s, before: f.score, ifConfirms: g.ifConfirms, ifSilent: g.ifSilent, pConfirm: g.pConfirm, gain: g.gain * weight, action,
        why: f.conflictsWith?.length ? 'Another source disagrees about this, so a deciding vote is worth the most.' : f.score < 0.5 ? 'Weakly supported so far; one more independent source would show whether it is real.' : 'Reasonably supported; another independent source would settle it.',
      });
    }
  }
  // one move per finding: a check you can make right now if it is at least half as informative as the best one that needs a key
  const any = new Map<string, Move>(), now = new Map<string, Move>();
  for (const m of moves.sort((a, b) => b.gain - a.gain)) { if (!any.has(m.findingId)) any.set(m.findingId, m); if (m.action === 'lookup' && !now.has(m.findingId)) now.set(m.findingId, m); }
  const best = new Map<string, Move>();
  for (const [id, m] of any) { const n = now.get(id); best.set(id, n && n.gain >= m.gain * 0.5 ? n : m); }
  return [...best.values()].sort((a, b) => (a.action === 'lookup' ? 0 : 1) - (b.action === 'lookup' ? 0 : 1) || b.gain - a.gain).slice(0, limit);
}
