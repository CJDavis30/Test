import type { Brief, EntityType, Evidence, Finding, Level, NextStep } from './types';
import { LEVEL_LABEL } from './types';
import { nameSimilarity } from './normalize';

// ---------------------------------------------------------------------------
// Reliability: how much do we trust an adapter for a given entity type?
// Starts at the adapter's prior and drifts toward the user's accept/reject history.
// ---------------------------------------------------------------------------

export interface Feedback { accepted: number; rejected: number }
const PRIOR_STRENGTH = 5; // pseudo-observations behind the prior

export function learnedReliability(prior: number, fb?: Feedback): number {
  if (!fb) return prior;
  const n = fb.accepted + fb.rejected;
  if (!n) return prior;
  const r = (fb.accepted + PRIOR_STRENGTH * prior) / (n + PRIOR_STRENGTH);
  return Math.min(0.99, Math.max(0.05, r));
}

export type ReliabilityFn = (adapter: string, type: EntityType) => number;

// ---------------------------------------------------------------------------
// Core belief: 1 - Π(1 - p_family). Sources in the same family count once (the strongest).
// ---------------------------------------------------------------------------

export function levelFor(score: number): Level {
  return score >= 0.85 ? 4 : score >= 0.65 ? 3 : score >= 0.4 ? 2 : 1;
}

export function scoreEvidence(
  type: EntityType,
  evidence: Evidence[],
  rel: ReliabilityFn,
): { score: number; independent: number; reasons: string[] } {
  const byFamily = new Map<string, { p: number; name: string }>();
  for (const e of evidence) {
    const p = Math.min(0.98, Math.max(0, e.weight) * rel(e.adapter, type));
    const cur = byFamily.get(e.family);
    if (!cur || p > cur.p) byFamily.set(e.family, { p, name: e.adapterName });
  }
  let miss = 1;
  for (const { p } of byFamily.values()) miss *= 1 - p;
  const score = Math.min(0.99, 1 - miss);
  const independent = byFamily.size;
  const reasons: string[] = [];
  if (independent >= 2) reasons.push(`${independent} independent sources agree`);
  else if (independent === 1) reasons.push(`Only one source (${[...byFamily.values()][0].name})`);
  const strong = [...byFamily.values()].filter((f) => f.p >= 0.8).map((f) => f.name);
  if (strong.length) reasons.push(`Authoritative: ${strong.slice(0, 3).join(', ')}`);
  const dup = evidence.length - byFamily.size;
  if (dup > 0) reasons.push(`${dup} more from the same data family (counted once)`);
  return { score, independent, reasons };
}

// ---------------------------------------------------------------------------
// Context: re-ranks. It never raises the confidence that something is true.
// ---------------------------------------------------------------------------

const STOP = new Set('the a an of for and or to in on at with is are was were be by from about looking find any all who what where my his her their its this that'.split(' '));

const TYPE_HINTS: { match: RegExp; types: EntityType[]; words: string[] }[] = [
  { match: /employ|work|job|compan|career|business|startup|founder/, types: ['org'], words: ['company', 'employer', 'works', 'organization', 'linkedin', 'founder', 'position', 'registrant'] },
  { match: /address|home|live|resid|where|location|city|travel/, types: ['location'], words: ['address', 'lives', 'location', 'based', 'residence', 'city'] },
  { match: /account|social|profile|handle|username|platform/, types: ['account', 'username'], words: ['profile', 'account', 'handle'] },
  { match: /email|mail/, types: ['email'], words: ['email', 'mail'] },
  { match: /phone|call|number|sms/, types: ['phone'], words: ['phone', 'number', 'mobile'] },
  { match: /money|pay|crypto|wallet|financ|bank|transact/, types: ['wallet'], words: ['wallet', 'payment', 'btc', 'transaction', 'paypal'] },
  { match: /domain|website|site|infra|server|host|dns/, types: ['domain', 'ip', 'url'], words: ['domain', 'hosting', 'dns', 'server', 'registrar'] },
  { match: /family|relative|spouse|friend|associate|connection|network|colleague/, types: ['person'], words: ['family', 'colleague', 'friend', 'associate', 'follows', 'collaborator'] },
  { match: /photo|image|face|picture|avatar/, types: ['image'], words: ['avatar', 'photo', 'image'] },
];

export interface ContextTerms { words: string[]; types: Set<EntityType> }

export function parseContext(context: string): ContextTerms {
  const c = context.toLowerCase();
  const words = c.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));
  const types = new Set<EntityType>();
  for (const h of TYPE_HINTS) {
    if (h.match.test(c)) { h.types.forEach((t) => types.add(t)); words.push(...h.words); }
  }
  return { words: [...new Set(words)], types };
}

export function contextBoost(f: Pick<Finding, 'type' | 'value' | 'relation' | 'evidence' | 'attrs'>, ctx: ContextTerms): number {
  if (!ctx.words.length && !ctx.types.size) return 0;
  let boost = ctx.types.has(f.type) ? 0.12 : 0;
  const hay = `${f.value} ${f.relation} ${Object.values(f.attrs).join(' ')} ${f.evidence.map((e) => e.snippet ?? '').join(' ')}`.toLowerCase();
  let hits = 0;
  for (const w of ctx.words) if (hay.includes(w)) hits++;
  boost += Math.min(0.2, hits * 0.06);
  return Math.min(0.3, boost);
}

// ---------------------------------------------------------------------------
// Conflicts: competing single-valued claims (two different home cities, two employers…).
// ---------------------------------------------------------------------------

export function applyConflicts(findings: Finding[]): void {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    f.conflictsWith = undefined;
    if (!f.conflictKey) continue;
    const k = `${f.subjectId}|${f.conflictKey}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => b.score - a.score);
    const top = g[0];
    for (const f of g.slice(1)) {
      if (nameSimilarity(f.value, top.value) >= 0.88) continue; // same place, different spelling
      f.score = Math.max(0.05, f.score * 0.8);
      f.level = levelFor(f.score);
      f.reasons = [...f.reasons.filter((r) => !r.startsWith('Disagrees')), `Disagrees with “${top.value}”`];
      f.conflictsWith = [top.id];
      top.conflictsWith = [...(top.conflictsWith ?? []), f.id];
    }
    if (top.conflictsWith?.length)
      top.reasons = [...top.reasons.filter((r) => !r.startsWith('Competes')), `Competes with ${top.conflictsWith.length} other value${top.conflictsWith.length > 1 ? 's' : ''}`];
  }
}

export function rescore(findings: Finding[], rel: ReliabilityFn, context = ''): void {
  const ctx = parseContext(context);
  for (const f of findings) {
    const s = scoreEvidence(f.type, f.evidence, rel);
    f.score = s.score;
    f.level = levelFor(s.score);
    f.reasons = s.reasons;
  }
  applyConflicts(findings);
  for (const f of findings) f.rank = f.score + contextBoost(f, ctx);
}

// ---------------------------------------------------------------------------
// Brief (deterministic). The AI brief is validated against these same findings.
// ---------------------------------------------------------------------------

const PLURAL: Partial<Record<EntityType, [string, string]>> = {
  person: ['name', 'names'], email: ['email', 'emails'], phone: ['phone number', 'phone numbers'],
  username: ['username', 'usernames'], account: ['account', 'accounts'], location: ['location', 'locations'],
  org: ['organization', 'organizations'], domain: ['domain', 'domains'], ip: ['IP address', 'IP addresses'],
  url: ['page', 'pages'], image: ['image', 'images'], wallet: ['wallet', 'wallets'], breach: ['breach', 'breaches'],
};

export function topByType(findings: Finding[], type: EntityType, n = 1): Finding[] {
  return findings.filter((f) => f.type === type && f.status !== 'rejected').sort((a, b) => b.rank - a.rank).slice(0, n);
}

export function overallConfidence(findings: Finding[]): Brief['confidence'] {
  const live = findings.filter((f) => f.status !== 'rejected').sort((a, b) => b.score - a.score);
  const top = live.slice(0, 5);
  const score = top.length ? top.reduce((s, f) => s + f.score, 0) / top.length : 0;
  const fams = new Set<string>();
  for (const f of live) if (f.score >= 0.4) for (const e of f.evidence) fams.add(e.family);
  const level = levelFor(score);
  return { score, level, label: LEVEL_LABEL[level], independentSources: fams.size };
}

export function ruleBrief(subject: { type: EntityType; value: string }, findings: Finding[], ids: Map<string, string>): Brief {
  const live = findings.filter((f) => f.status !== 'rejected');
  const cite = (f: Finding) => `[${ids.get(f.id) ?? '?'}]`;
  const people = live.filter((f) => f.type === 'person').sort((a, b) => b.rank - a.rank);
  const org = topByType(live, 'org')[0];
  const loc = topByType(live, 'location')[0];
  const conf = overallConfidence(live);
  // If the investigator searched for a name, that name leads. Other names are aliases, not "the" name.
  const subjectIsName = subject.type === 'person' || subject.type === 'org';
  const name = subject.type === 'person' ? undefined : people[0];
  const lead = subjectIsName ? subject.value : name?.value;

  let headline: string;
  if (subject.type === 'domain' || subject.type === 'ip') {
    headline = [subject.value, org?.value ? `— ${org.value}` : '', loc?.value ? `· ${loc.value}` : ''].filter(Boolean).join(' ');
  } else if (subject.type === 'org') {
    headline = [subject.value, loc ? `· ${loc.value}` : ''].filter(Boolean).join(' ');
  } else if (lead) {
    headline = [lead, org ? `· ${org.value}` : '', loc ? `· ${loc.value}` : ''].filter(Boolean).join(' ');
  } else {
    headline = subject.value;
  }

  const parts: string[] = [];
  const counts = new Map<EntityType, number>();
  for (const f of live) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  const order: EntityType[] = ['person', 'email', 'phone', 'username', 'account', 'org', 'location', 'domain', 'ip', 'url', 'wallet', 'breach', 'image'];
  const tally = order.filter((t) => counts.get(t) && PLURAL[t]).map((t) => {
    const n = counts.get(t)!;
    return `${n} ${PLURAL[t]![n === 1 ? 0 : 1]}`;
  });
  const shown = tally.slice(0, 5);
  const rest = tally.length - shown.length;
  const joined = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0];
  if (tally.length) parts.push(`Found ${joined}${rest > 0 ? `, plus ${rest} other kind${rest > 1 ? 's' : ''} of finding` : ''} across ${conf.independentSources || 1} independent source${conf.independentSources === 1 ? '' : 's'}.`);
  if (name) parts.push(`Most likely name: ${name.value} ${cite(name)}.`);
  if (subject.type === 'person') {
    const aliases = people.filter((f) => f.level >= 2).slice(0, 2);
    if (aliases.length) parts.push(`Also appears as ${aliases.map((f) => `${f.value} ${cite(f)}`).join(' and ')}.`);
  }
  if (org && subject.type !== 'org') parts.push(`Strongest organization: ${org.value} ${cite(org)}.`);
  if (loc) parts.push(`Most likely location: ${loc.value} ${cite(loc)}.`);
  const strongAcc = topByType(live, 'account', 3).filter((f) => f.level >= 3);
  if (strongAcc.length) parts.push(`Well-corroborated accounts: ${strongAcc.map((f) => `${String(f.attrs.platform ?? f.value)} ${cite(f)}`).join(', ')}.`);
  if (!live.length) parts.push('No findings yet. Try adding context or enabling more sources.');

  const caveats: string[] = [];
  const conflicts = live.filter((f) => f.conflictsWith?.length && f.level >= 2);
  if (conflicts.length) caveats.push(`${conflicts.length} value${conflicts.length > 1 ? 's' : ''} disagree with each other. Resolve before relying on them.`);
  const thin = live.filter((f) => f.evidence.length === 1 && f.level <= 2).length;
  if (thin > 3) caveats.push(`${thin} findings rest on a single source.`);
  const personGuess = people.filter((f) => f.level <= 2).length;
  if (personGuess) caveats.push('Name matches alone can describe different people with the same name.');

  const cites: Record<string, string> = {};
  for (const [fid, cid] of ids) cites[cid] = fid;
  return { headline, summary: parts.join(' '), caveats, cites, by: 'rules', confidence: conf };
}

/** Suggest pivots worth running next: discovered entities that are not yet nodes, ranked. */
export function suggestNext(findings: Finding[], haveKeys: Set<string>, limit = 6): NextStep[] {
  const pivotable: EntityType[] = ['email', 'username', 'domain', 'phone', 'ip', 'wallet', 'person', 'org'];
  const out: NextStep[] = [];
  for (const f of [...findings].sort((a, b) => b.rank - a.rank)) {
    if (f.status === 'rejected' || !pivotable.includes(f.type)) continue;
    if (f.score < 0.45) continue;
    if (haveKeys.has(`${f.type}:${f.key}`)) continue;
    const why =
      f.type === 'email' ? 'New email — may reveal more accounts and breaches' :
      f.type === 'username' ? 'Handle seen on a corroborated profile' :
      f.type === 'domain' ? 'Related infrastructure worth pivoting on' :
      f.type === 'phone' ? 'Phone number tied to this subject' :
      f.type === 'org' ? 'Organization link — check people and domains' :
      f.type === 'person' ? 'Possible associate or alias' : 'Related identifier';
    out.push({ type: f.type, value: f.value, reason: why, score: f.score, findingId: f.id });
    if (out.length >= limit) break;
  }
  return out;
}
