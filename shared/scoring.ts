import type { Basis, Brief, EntityType, Evidence, Finding, Level, NextStep } from './types';
import { LEVEL_LABEL } from './types';
import { nameSimilarity } from './normalize';
import { classifyName } from './handles';

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

/**
 * How much of a source's own confidence survives, by how it tied the finding to what was searched. A same-name match is, at best, half a
 * clue; a profile's own claims (bio, location, a link) can be lies; the very account you named is exact.
 */
export const BASIS_FACTOR: Record<Basis, number> = { exact: 1, reciprocal: 1, 'self-reported': 0.78, derived: 0.7, 'name-match': 0.55 };
const BASIS_RANK: Record<Basis, number> = { reciprocal: 5, exact: 4, 'self-reported': 3, derived: 2, 'name-match': 1 };
export const BASIS_WORD: Record<Basis, string> = { exact: 'The account you named', reciprocal: 'Confirmed from both sides', 'self-reported': 'Said by the profile itself', derived: 'Worked out from the input', 'name-match': 'Same name only' };

/** The strongest way anything supporting a finding ties it to what was searched, and whether that is all it has (a same-name match). Derived, never stored. */
export function basisOf(evidence: Pick<Evidence, 'basis' | 'polarity'>[]): { basis?: Basis; nameOnly: boolean } {
  let best: Basis | undefined;
  for (const e of evidence) { if (e.polarity === 'against') continue; const b = e.basis ?? 'exact'; if (!best || BASIS_RANK[b] > BASIS_RANK[best]) best = b; }
  return { basis: best, nameOnly: best === 'name-match' };
}

export function scoreEvidence(
  type: EntityType,
  evidence: Evidence[],
  rel: ReliabilityFn,
): { score: number; independent: number; against: number; reasons: string[]; basis?: Basis; nameOnly: boolean } {
  // Evidence is grouped by source family so two views of the same dataset count once. Cross-checks and direct hits share the
  // family map: asking GitHub a second question does not make GitHub a second opinion.
  const pro = new Map<string, { p: number; name: string; direct: boolean }>();
  const con = new Map<string, { p: number; name: string }>();
  let best: Basis | undefined, nameOnly = false, anyPro = false;
  for (const e of evidence) {
    let p = Math.min(0.98, Math.max(0, e.weight) * rel(e.adapter, type) * BASIS_FACTOR[e.basis ?? 'exact']);
    if (e.cap !== undefined) p = Math.min(p, e.cap);
    if (e.polarity === 'against') {
      const cur = con.get(e.family);
      if (!cur || p > cur.p) con.set(e.family, { p, name: e.adapterName });
    } else {
      // Every same-name observation is one fact ("a handle is shared"), however many sources or checks notice it: pool them.
      const fam = e.basis === 'name-match' ? 'name-match' : e.family;
      const cur = pro.get(fam);
      const direct = e.kind !== 'cross';
      if (!cur || p > cur.p) pro.set(fam, { p, name: e.adapterName, direct: direct || !!cur?.direct });
      else if (direct) cur.direct = true;
      anyPro = true;
      const b = e.basis ?? 'exact';
      if (!best || BASIS_RANK[b] > BASIS_RANK[best]) best = b;
    }
  }
  nameOnly = anyPro && best === 'name-match';
  let miss = 1;
  for (const { p } of pro.values()) miss *= 1 - p;
  let missCon = 1;
  for (const { p } of con.values()) missCon *= 1 - p;
  const pFor = 1 - miss, pAgainst = 1 - missCon;
  // Contradictions pull the score down but cannot erase strong, independent support on their own.
  const score = Math.min(0.99, Math.max(0, pFor * (1 - 0.9 * pAgainst)));
  const independent = pro.size;
  const directNames = [...pro.values()].filter((f) => f.direct).map((f) => f.name);
  const reasons: string[] = [];
  if (directNames.length >= 2) reasons.push(`${directNames.length} separate sources report this directly.`);
  else if (directNames.length === 1) reasons.push(`Only one source reported this directly (${directNames[0]}).`);
  const cross = [...pro.values()].filter((f) => !f.direct);
  if (cross.length) reasons.push(`${cross.length} cross-check${cross.length > 1 ? 's' : ''} from other sources back it up: ${cross.map((c) => c.name).slice(0, 3).join(', ')}.`);
  if (con.size) reasons.push(`${con.size} cross-check${con.size > 1 ? 's' : ''} contradict it: ${[...con.values()].map((c) => c.name).slice(0, 3).join(', ')}.`);
  const strong = [...pro.values()].filter((f) => f.p >= 0.8).map((f) => f.name);
  if (strong.length) reasons.push(`Comes from a high-trust source: ${strong.slice(0, 3).join(', ')}.`);
  const dup = evidence.filter((e) => e.polarity !== 'against').length - pro.size;
  if (dup > 0) reasons.push(`${dup} more source${dup > 1 ? 's' : ''} use the same underlying data, so they count as one.`);
  if (nameOnly) reasons.unshift('Found only because the same name exists there. Plenty of strangers share a name, so this is not evidence of the same person until something else (a link, an email, a mention) backs it.');
  return { score, independent, against: con.size, reasons, basis: best, nameOnly };
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
      f.reasons = [...f.reasons.filter((r) => !r.startsWith('Disagrees')), `Disagrees with “${top.value}”, which has stronger support.`];
      f.conflictsWith = [top.id];
      top.conflictsWith = [...(top.conflictsWith ?? []), f.id];
    }
    if (top.conflictsWith?.length)
      top.reasons = [...top.reasons.filter((r) => !r.startsWith('Other sources')), `Other sources gave ${top.conflictsWith.length} different answer${top.conflictsWith.length > 1 ? 's' : ''} for this.`];
  }
}

export function rescore(findings: Finding[], rel: ReliabilityFn, context = ''): void {
  const ctx = parseContext(context);
  for (const f of findings) {
    const s = scoreEvidence(f.type, f.evidence, rel);
    f.score = s.score;
    f.level = levelFor(s.score);
    f.reasons = s.reasons;
    f.basis = s.basis; f.nameOnly = s.nameOnly || undefined;
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
  for (const f of live) if (f.score >= 0.4) for (const e of f.evidence) if (e.polarity !== 'against') fams.add(e.family);
  const level = levelFor(score);
  return { score, level, label: LEVEL_LABEL[level], independentSources: fams.size };
}

export function ruleBrief(subject: { type: EntityType; value: string }, findings: Finding[], ids: Map<string, string>): Brief {
  const all = findings.filter((f) => f.status !== 'rejected');
  // Accounts found only because they share the name are strangers until something else ties them in: they are counted, never summarised as fact.
  const nameOnly = all.filter((f) => f.nameOnly);
  const live = all.filter((f) => !f.nameOnly);
  // The name or place a profile gives about itself is a claim. For a username search it is reported as one, and never as "the" name.
  const fromHandle = subject.type === 'username' || subject.type === 'account';
  const cite = (f: Finding) => `[${ids.get(f.id) ?? '?'}]`;
  const people = live.filter((f) => f.type === 'person').sort((a, b) => b.rank - a.rank);
  const org = topByType(live, 'org')[0];
  const loc = topByType(live, 'location')[0];
  const conf = overallConfidence(live);
  // If the investigator searched for a name, that name leads. Other names are aliases, not "the" name.
  const subjectIsName = subject.type === 'person' || subject.type === 'org';
  const name = subject.type === 'person' ? undefined : people.find((p) => !fromHandle || classifyName(p.value) === 'full-name');
  const lead = subjectIsName ? subject.value : fromHandle ? undefined : name?.value;

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
  if (name) parts.push(fromHandle ? `The profile gives the name ${name.value} ${cite(name)}. That is what it says about itself and has not been checked.` : `Most likely name: ${name.value} ${cite(name)}.`);
  if (subject.type === 'person') {
    const aliases = people.filter((f) => f.level >= 2).slice(0, 2);
    if (aliases.length) parts.push(`Also appears as ${aliases.map((f) => `${f.value} ${cite(f)}`).join(' and ')}.`);
  }
  if (org && subject.type !== 'org') parts.push(`Strongest organization: ${org.value} ${cite(org)}.`);
  if (loc) parts.push(fromHandle ? `The profile says it is in ${loc.value} ${cite(loc)}. That is self-reported.` : `Most likely location: ${loc.value} ${cite(loc)}.`);
  if (nameOnly.length) parts.push(`${nameOnly.length} other account${nameOnly.length === 1 ? ' uses' : 's use'} the same name on other sites. Most of those will be different people; none counts until something else ties it in.`);
  const strongAcc = topByType(live, 'account', 3).filter((f) => f.level >= 3);
  if (strongAcc.length) parts.push(`Well-corroborated accounts: ${strongAcc.map((f) => `${String(f.attrs.platform ?? f.value)} ${cite(f)}`).join(', ')}.`);
  if (!live.length) parts.push('No findings yet. Try adding context or enabling more sources.');

  const caveats: string[] = [];
  const conflicts = live.filter((f) => f.conflictsWith?.length && f.level >= 2);
  if (conflicts.length) caveats.push(`${conflicts.length} value${conflicts.length > 1 ? 's' : ''} disagree with each other. Resolve before relying on them.`);
  const thin = live.filter((f) => f.evidence.length === 1 && f.level <= 2).length;
  if (thin > 3) caveats.push(`${thin} findings rest on a single source.`);
  const personGuess = people.filter((f) => f.level <= 2).length;
  void all;
  if (personGuess) caveats.push('Name matches alone can describe different people with the same name.');

  const cites: Record<string, string> = {};
  for (const [fid, cid] of ids) cites[cid] = fid;
  return { headline, summary: parts.join(' '), caveats, cites, by: 'rules', confidence: conf };
}

/** Suggest pivots worth running next: discovered entities that are not yet nodes, ranked. */
/**
 * Is this finding solid enough to search from? A name found only because someone shares it, or a bare alias, or a "real name" that
 * only one profile claims, must never start a new search: that is how a username turns into a made-up last name and a made-up town.
 */
export function pivotWorthy(f: Pick<Finding, 'type' | 'value' | 'score' | 'evidence' | 'basis' | 'nameOnly'>): { ok: boolean; why: string } {
  if (f.nameOnly || f.basis === 'name-match') return { ok: false, why: 'it is only a same-name match' };
  const pro = f.evidence.filter((e) => e.polarity !== 'against' && e.basis !== 'name-match');
  const families = new Set(pro.map((e) => e.family)).size;
  const strongTie = pro.some((e) => e.basis === 'reciprocal' || (e.basis === 'exact' && e.kind !== 'cross'));
  if (f.type === 'person') {
    if (classifyName(f.value) !== 'full-name') return { ok: false, why: 'a single word or handle-like name is an alias, not a real name' };
    return families >= 2 && f.score >= 0.55 ? { ok: true, why: 'two independent sources give this name' } : { ok: false, why: 'a name one profile gives about itself is a claim, not a fact' };
  }
  if (f.type === 'org' || f.type === 'location') return families >= 2 && f.score >= 0.55 ? { ok: true, why: 'independently confirmed' } : { ok: false, why: 'only the profile itself says so' };
  if (f.score < 0.45) return { ok: false, why: 'too weak' };
  if (pro.every((e) => e.basis === 'self-reported') && families < 2 && !strongTie && f.score < 0.6) return { ok: false, why: 'only the profile itself says so' };
  return { ok: true, why: 'solid' };
}

export function suggestNext(findings: Finding[], haveKeys: Set<string>, limit = 6): NextStep[] {
  const pivotable: EntityType[] = ['email', 'username', 'domain', 'phone', 'ip', 'wallet', 'person', 'org'];
  const out: NextStep[] = [];
  for (const f of [...findings].sort((a, b) => b.rank - a.rank)) {
    if (f.status === 'rejected' || !pivotable.includes(f.type)) continue;
    if (f.score < 0.45) continue;
    if (!pivotWorthy(f).ok) continue;
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
