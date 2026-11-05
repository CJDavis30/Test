import { compareHandles } from './username';
import type { Circadian } from './circadian';
import { alternation } from './alternation';

/**
 * Probabilistic record linkage (Fellegi–Sunter) for investigations: are these two accounts run by the same person?
 *
 * Every signal is expressed as a likelihood ratio in BITS: how much more likely is this observation if the accounts share an
 * operator than if they do not? Bits add (each is log2 of the ratio), so the whole case for a link is a short column of numbers you can
 * check, argue with and re-weigh, and the posterior is just prior odds plus the sum. Nothing is a black box.
 *
 * The assumptions behind each number are stated in the output (see `assumption`) because a probability is only as good as the model
 * that produced it. They are deliberately conservative, and the only things this model can see are what is on the two profiles.
 */

export interface Profile {
  id: string;
  label: string;
  platform?: string;
  handle?: string;
  displayName?: string;
  /** when the account was created, in ms, and how precisely that is known */
  createdAt?: number;
  createdPrecision?: 'second' | 'day';
  /** hash of a CUSTOM avatar (never a platform default) */
  avatarHash?: string;
  /** emails, phone numbers, wallet addresses and links that appear on or are tied to this profile, normalized */
  contacts?: string[];
  /** how strongly each contact is tied to this profile (0..1), where known; a weak tie counts for less */
  contactStrength?: Record<string, number>;
  links?: string[];
  circadian?: Pick<Circadian, 'offsets' | 'strength'>;
  /** raw activity timestamps (ms); used for the alternation test and never sent to the interface */
  activity?: number[];
}

export interface Signal { key: string; label: string; bits: number; detail: string; assumption?: string; group?: 'name' }
export interface Match {
  priorBits: number; evidenceBits: number; totalBits: number; posterior: number;
  signals: Signal[];
  verdict: 'same' | 'likely' | 'unclear' | 'unlikely' | 'different';
  summary: string;
}

/** The window of years in which accounts get created, in seconds. */
const SPAN = 8 * 365.25 * 86400;
/** Assumed habits of one person with several accounts: how often they are made in one sitting (±10 min) or on one day. */
const P_SITTING = 0.05, P_DAY = 0.07;

const log2 = Math.log2;
const odds = (bits: number) => 2 ** bits;
export const bitsToProb = (bits: number) => { const o = odds(bits); return o / (1 + o); };
export const probToBits = (p: number) => log2(p / (1 - p));
/** "1 in N" in words, from bits, to two significant figures. */
export function oneIn(bits: number): string {
  const n = 2 ** Math.min(60, Math.max(0, bits));
  const two = (x: number) => { const d = Math.pow(10, Math.floor(Math.log10(x)) - 1); return Math.round(x / d) * d; };
  if (n < 1000) return `1 in ${Math.max(1, Math.round(n))}`;
  if (n < 1e6) return `1 in ${two(n).toLocaleString('en-US')}`;
  if (n < 1e9) return `1 in ${+(n / 1e6).toPrecision(2)} million`;
  if (n < 1e12) return `1 in ${+(n / 1e9).toPrecision(2)} billion`;
  return '1 in over a trillion';
}

/** Likelihood ratio of the gap between two creation times. */
export function creationTimeBits(a: number, b: number, precision: 'second' | 'day' = 'second'): { bits: number; detail: string; assumption: string } {
  const gap = Math.abs(a - b) / 1000;
  const assumption = `Assumes accounts are created at random over about 8 years, but ${Math.round(P_SITTING * 100)}% of people make a second account in the same sitting (within 10 minutes) and ${Math.round(P_DAY * 100)}% on the same day.`;
  const fmt = (s: number) => (s < 120 ? `${Math.round(s)} seconds` : s < 7200 ? `${Math.round(s / 60)} minutes` : s < 172800 ? `${(s / 3600).toFixed(1)} hours` : `${Math.round(s / 86400)} days`);
  let lr: number;
  if (precision === 'day') {
    const sameDay = new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
    const perDay = 86400 / SPAN;
    lr = sameDay ? (P_SITTING + P_DAY + (1 - P_SITTING - P_DAY) * perDay) / perDay : (1 - P_SITTING - P_DAY) ;
    return { bits: log2(lr), detail: sameDay ? 'Both accounts were created on the same day (only the date is known for one of them).' : `Created ${fmt(gap)} apart (only dates are known).`, assumption };
  }
  const rest = 1 - P_SITTING - P_DAY;
  const f0 = 2 / SPAN; // density of |gap| for unrelated accounts
  const f1 = (gap <= 600 ? P_SITTING / 600 : 0) + (gap <= 43200 ? P_DAY / 43200 : 0) + rest * f0;
  lr = f1 / f0;
  const detail = gap <= 600
    ? `Created only ${fmt(gap)} apart. Unrelated accounts would land this close about ${oneIn(log2(lr))} of the time.`
    : gap <= 43200 ? `Created ${fmt(gap)} apart: the same day.` : `Created ${fmt(gap)} apart, which says nothing either way.`;
  return { bits: log2(lr), detail, assumption };
}

/** Agreement between two timezone posteriors: 24·Σ pₐ(o)·p_b(o), softened for people who travel. */
export function circadianBits(a: NonNullable<Profile['circadian']>, b: NonNullable<Profile['circadian']>): { bits: number; detail: string; assumption: string } | null {
  if (a.strength === 'insufficient' || b.strength === 'insufficient') return null;
  const pb = new Map(b.offsets.map((o) => [o.offset, o.p]));
  const overlap = a.offsets.reduce((s, o) => s + o.p * (pb.get(o.offset) ?? 0), 0);
  const lr = 0.95 * 24 * overlap + 0.05;
  const bits = log2(lr);
  return { bits, detail: bits > 1 ? 'Active at the same hours of the day, which points to the same part of the world.' : bits < -1.5 ? 'Active at very different hours: probably different parts of the world.' : 'Active hours overlap too loosely to say.', assumption: 'Assumes unrelated people are spread evenly across timezones; allows for 5% of people travelling or working odd hours.' };
}

export function linkProfiles(a: Profile, b: Profile, o: { priorOdds?: number } = {}): Match {
  const priorOdds = o.priorOdds ?? 1 / 50;
  const priorBits = log2(priorOdds);
  const signals: Signal[] = [];

  if (a.handle && b.handle) {
    const h = compareHandles(a.handle, b.handle);
    signals.push({ key: 'handle', label: 'Handle', bits: h.bits, detail: h.detail, group: 'name', assumption: 'Surprise is estimated from the handle itself (about 2.8 bits a letter for word-like names, 4.3 for random-looking ones, 6 for very common handle words).' });
  }
  if (a.displayName && b.displayName) {
    const h = compareHandles(a.displayName.replace(/\s+/g, ''), b.displayName.replace(/\s+/g, ''));
    if (h.kind !== 'different') signals.push({ key: 'name', label: 'Display name', bits: h.bits, detail: h.detail.replace('handle', 'name'), group: 'name' });
  }
  if (a.createdAt !== undefined && b.createdAt !== undefined && (a.platform ?? '') !== (b.platform ?? '__') ) {
    const prec = a.createdPrecision === 'day' || b.createdPrecision === 'day' ? 'day' : 'second';
    const t = creationTimeBits(a.createdAt, b.createdAt, prec);
    signals.push({ key: 'created', label: 'Created at about the same time', bits: t.bits, detail: t.detail, assumption: t.assumption });
  }
  if (a.avatarHash && b.avatarHash) {
    if (a.avatarHash === b.avatarHash) signals.push({ key: 'avatar', label: 'Same custom avatar', bits: 18, detail: 'The same profile picture (identical image hash). A custom picture is shared by chance about 1 in 250,000 times.', assumption: 'Capped at 18 bits: stock images and widely reposted pictures exist.' });
  }
  const shared = (a.contacts ?? []).filter((c) => (b.contacts ?? []).includes(c));
  if (shared.length) {
    // being tied to the same email by a weak source is not the same as a profile that lists it, so the weaker tie sets the weight
    const w = Math.max(...shared.map((c) => Math.min(a.contactStrength?.[c] ?? 1, b.contactStrength?.[c] ?? 1)));
    signals.push({ key: 'contact', label: 'Shared contact detail', bits: Math.min(22, (14 + (shared.length - 1) * 2) * w), detail: `Both are tied to ${shared.length === 1 ? shared[0].replace(/^[a-z]+:/, '') : `${shared.length} of the same contact details (${shared.slice(0, 2).map((x) => x.replace(/^[a-z]+:/, '')).join(', ')}…)`}${w < 0.95 ? ` (the ties are only ${Math.round(w * 100)}% certain themselves)` : ''}. An email, number or wallet is rarely shared.`, assumption: 'Treats a contact detail as personal (a shared inbox or family phone would be a false positive) and scales with how certain each tie to the profile is.' });
  }
  const linked = (a.links ?? []).some((l) => !!b.handle && l.toLowerCase().includes(b.handle.toLowerCase()) && (!b.platform || l.toLowerCase().includes(b.platform.toLowerCase()))) || (b.links ?? []).some((l) => !!a.handle && l.toLowerCase().includes(a.handle.toLowerCase()) && (!a.platform || l.toLowerCase().includes(a.platform.toLowerCase())));
  if (linked) signals.push({ key: 'link', label: 'One profile links to the other', bits: 14, detail: 'One profile points to the other. People link their own accounts, but anyone can link anyone.', assumption: 'Self-links are not verified, so this is capped well below certainty.' });
  if (a.activity && b.activity) { const alt = alternation(a.activity, b.activity); if (alt) signals.push({ key: 'alternation', label: 'Takes turns, never at once', bits: alt.bits, detail: alt.detail, assumption: alt.assumption }); }
  if (a.circadian && b.circadian) { const c = circadianBits(a.circadian, b.circadian); if (c) signals.push({ key: 'clock', label: 'Active hours', bits: c.bits, detail: c.detail, assumption: c.assumption }); }

  // Handle and display name usually move together, so do not count both in full.
  const nameBits = signals.filter((s) => s.group === 'name').map((s) => s.bits).sort((x, y) => y - x);
  const evidenceBits = signals.filter((s) => s.group !== 'name').reduce((t, s) => t + s.bits, 0) + (nameBits.length ? nameBits[0] + (nameBits[1] > 0 ? nameBits[1] * 0.5 : Math.min(0, nameBits[1] ?? 0)) : 0);
  const totalBits = priorBits + evidenceBits;
  const posterior = bitsToProb(totalBits);
  const verdict: Match['verdict'] = posterior >= 0.99 ? 'same' : posterior >= 0.9 ? 'likely' : posterior >= 0.5 ? 'unclear' : posterior >= 0.1 ? 'unlikely' : 'different';
  const word = { same: 'Almost certainly the same operator', likely: 'Likely the same operator', unclear: 'Leans toward the same operator, but unproven', unlikely: 'Probably different operators', different: 'Almost certainly different operators' }[verdict];
  return { priorBits, evidenceBits, totalBits, posterior, signals, verdict, summary: `${word} (${posterior >= 0.9999 ? '>99.99' : posterior <= 0.0001 ? '<0.01' : (posterior * 100).toFixed(posterior > 0.995 || posterior < 0.005 ? 2 : 1)}%).` };
}

// ---------------------------------------------------------------------------------------------------- identities
export interface Identity { id: string; members: Profile[]; /** weakest link inside the group */ weakest: number; links: { a: string; b: string; posterior: number }[] }
export interface Resolution { identities: Identity[]; maybes: { a: Profile; b: Profile; posterior: number }[]; separated: { a: Profile; b: Profile; why: string }[] }

/**
 * Groups profiles into the people behind them. Strongest links merge first, and a merge is refused when it would put two profiles
 * that are known to be different people (cannot-link) into one group, which is how a namesake is kept apart.
 */
export function resolveIdentities(profiles: Profile[], o: { priorOdds?: number; threshold?: number; cannotLink?: [string, string][] } = {}): Resolution {
  const threshold = o.threshold ?? 0.9;
  const P = profiles.slice(0, 150);
  const cannot = new Set((o.cannotLink ?? []).flatMap(([x, y]) => [`${x}|${y}`, `${y}|${x}`]));
  const pairs: { a: Profile; b: Profile; m: Match }[] = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) pairs.push({ a: P[i], b: P[j], m: linkProfiles(P[i], P[j], o) });
  pairs.sort((x, y) => y.m.posterior - x.m.posterior);

  const group = new Map<string, Set<string>>(P.map((p) => [p.id, new Set([p.id])]));
  const links = new Map<string, { a: string; b: string; posterior: number }[]>(P.map((p) => [p.id, []]));
  const separated: Resolution['separated'] = [];
  for (const { a, b, m } of pairs) {
    if (m.posterior < threshold) break;
    const ga = group.get(a.id)!, gb = group.get(b.id)!;
    if (ga === gb) { links.get(a.id)!.push({ a: a.id, b: b.id, posterior: m.posterior }); continue; }
    const clash = [...ga].some((x) => [...gb].some((y) => cannot.has(`${x}|${y}`)));
    if (clash) { separated.push({ a, b, why: 'They look alike, but something shows they are different people, so Plexus kept them apart.' }); continue; }
    const merged = new Set([...ga, ...gb]);
    for (const id of merged) group.set(id, merged);
    links.get(a.id)!.push({ a: a.id, b: b.id, posterior: m.posterior });
  }
  const seen = new Set<Set<string>>(); const identities: Identity[] = [];
  for (const p of P) {
    const g = group.get(p.id)!; if (seen.has(g)) continue; seen.add(g);
    const members = P.filter((x) => g.has(x.id));
    const ls = members.flatMap((x) => links.get(x.id)!);
    identities.push({ id: members[0].id, members, weakest: ls.length ? Math.min(...ls.map((l) => l.posterior)) : 1, links: ls });
  }
  identities.sort((a, b) => b.members.length - a.members.length);
  const maybes = pairs.filter((x) => x.m.posterior >= 0.3 && x.m.posterior < threshold && group.get(x.a.id) !== group.get(x.b.id)).slice(0, 12).map((x) => ({ a: x.a, b: x.b, posterior: x.m.posterior }));
  return { identities, maybes, separated };
}

// ---------------------------------------------------------------------------------------------------- look-alikes
export interface LookAlike { a: Profile; b: Profile; posterior: number; /** why they look alike */ shared: string; /** why they are probably not the same operator */ against: string[] }

/**
 * Same handle (or a copy of it), probably a different operator: the pattern behind impersonation, handle squatting and namesakes.
 * Reported only when the name evidence is strong and something concrete argues against a shared operator.
 */
export function lookAlikes(profiles: Profile[], o: { priorOdds?: number } = {}): LookAlike[] {
  const out: LookAlike[] = [];
  const P = profiles.slice(0, 150);
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], b = P[j];
    if (!a.handle || !b.handle) continue;
    const h = compareHandles(a.handle, b.handle);
    if (h.kind !== 'identical' && h.kind !== 'same-core') continue;
    if (h.bits < 6) continue; // a very common handle is not worth flagging
    const m = linkProfiles(a, b, o);
    if (m.posterior >= 0.9) continue; // confidently the same operator: not a look-alike
    const strong = m.signals.filter((s) => s.key !== 'handle' && s.key !== 'name' && s.key !== 'created' && s.bits <= -2);
    if (strong.length === 0) continue; // years between two accounts is normal; only concrete evidence of a different operator counts
    const against = m.signals.filter((s) => s.key !== 'handle' && s.key !== 'name' && s.bits < -1).map((s) => s.key === 'clock' ? `Active at very different hours (${s.bits.toFixed(1)} bits against).` : s.key === 'alternation' ? `Active at the same moments, as two people are (${s.bits.toFixed(1)} bits against).` : `${s.label}: ${s.detail}`);
    const created = m.signals.find((s) => s.key === 'created');
    if (created && created.bits < 0 && a.createdAt !== undefined && b.createdAt !== undefined) { const days = Math.round(Math.abs(a.createdAt - b.createdAt) / 86_400_000); if (days >= 30) against.push(`Created ${days >= 365 ? `${(days / 365).toFixed(1)} years` : `${days} days`} apart, not in one go.`); }
    if (against.length === 0) continue;
    out.push({ a, b, posterior: m.posterior, shared: h.detail, against });
  }
  return out.sort((x, y) => x.posterior - y.posterior).slice(0, 10);
}
