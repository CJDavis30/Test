import type { Basis, Claim, Evidence, Finding, GraphNode } from '../shared/types';
import { anchorFamilies, classifyName, nameMatchCap, PLATFORMS, roleFromAttrs, type HandleRole } from '../shared/handles';
import type { Adapter } from './adapters/types';

/**
 * How a result is tied to what was searched. A source that looks a handle up by NAME on some service finds whoever uses that name there,
 * which is usually a stranger; only the service the handle really belongs to (the one you said it was for) returns the account you named.
 * What a profile says about itself (its name, town, links) is the profile's own claim, and anyone can write anything.
 */
export const SELF_CAP = 0.72;
/** Details a profile states about itself: never more than a claim until something independent agrees. */
const SELF_FIELDS = new Set(['person', 'location', 'org', 'email', 'phone', 'url', 'domain']);

export const roleOf = (n: Pick<GraphNode, 'attrs'>): HandleRole | undefined => roleFromAttrs(n.attrs);

/** A display name is a clue to match against profiles, not something to search the internet for, unless asked to. */
export const clueOnly = (n: Pick<GraphNode, 'type' | 'attrs'>): boolean => {
  if (n.type !== 'username') return false;
  const r = roleOf(n);
  return r?.kind === 'display-name' && n.attrs?.handleSearch !== true;
};

const capFor = (b: Basis, subject: Pick<GraphNode, 'value'>): number | undefined => (b === 'name-match' ? nameMatchCap(subject.value) : b === 'self-reported' ? SELF_CAP : undefined);

export function basisFor(subject: Pick<GraphNode, 'type' | 'value' | 'attrs'>, a: Pick<Adapter, 'family' | 'demo' | 'anyMode'>, c: Pick<Claim, 'type' | 'basis'>): { basis?: Basis; cap?: number } {
  if (c.basis) return { basis: c.basis, cap: capFor(c.basis, subject) };
  if (a.demo || a.anyMode) return {};                                  // offline and simulated sources keep their own meaning
  if (subject.type !== 'username' && subject.type !== 'account') return {};
  const anchor = subject.type === 'account' || anchorFamilies(roleOf(subject)).includes(a.family);
  if (anchor) return SELF_FIELDS.has(c.type) ? { basis: 'self-reported', cap: SELF_CAP } : { basis: 'exact' };
  return { basis: 'name-match', cap: nameMatchCap(subject.value) };
}

/** A display name that is not a plain two-word name is an alias: keep it as a handle (display-name), never as a person. */
export function demotePersonAlias(c: Claim, a: Pick<Adapter, 'family' | 'demo' | 'anyMode'>, handles: string[]): Claim {
  if (c.type !== 'person' || a.demo || a.anyMode) return c;
  if (classifyName(c.value, handles) === 'full-name') return c;
  const platform = PLATFORMS.find((p) => p.families.includes(a.family));
  return { ...c, type: 'username', relation: `display name${platform ? ` on ${platform.name}` : ''}`, attrs: { ...(c.attrs ?? {}), handleKind: 'display-name', ...(platform ? { handlePlatform: platform.key } : {}), handleTrust: 'probable', handleOrigin: 'their-profile' }, snippet: c.snippet ?? 'A display name is a nickname, not necessarily a real name' };
}

const RANK: Record<Basis, number> = { reciprocal: 5, exact: 4, 'self-reported': 3, derived: 2, 'name-match': 1 };
const bestDirect = (f: Pick<Finding, 'evidence'>): Basis | undefined => f.evidence.filter((e) => e.kind !== 'cross' && e.polarity !== 'against' && e.basis).map((e) => e.basis!).sort((x, y) => RANK[y] - RANK[x])[0];

/**
 * Basis for what a cross-check found about finding f.
 *   linkback: the other source lists the thing you searched. That is the person's own words pointing back, strong; if the first link also
 *             came from the searched profile it is confirmed from both sides.
 *   also:     it merely shows a detail we found elsewhere: no better tied to the subject than f itself.
 * Offline / demo runs carry no basis at all and stay as they were.
 */
export function crossBasis(f: Pick<Finding, 'evidence'>, kind: 'linkback' | 'also'): { basis?: Basis; cap?: number } {
  const b = bestDirect(f);
  if (!b) return {};
  if (kind === 'linkback') return b === 'name-match' || b === 'derived' ? { basis: 'self-reported', cap: SELF_CAP } : { basis: 'reciprocal', cap: 0.95 };
  // a detail shown elsewhere is no better tied to the subject than the finding itself: it inherits how the finding was found
  if (b === 'name-match') return { basis: 'name-match', cap: Math.min(...f.evidence.filter((e) => e.cap !== undefined && e.basis === 'name-match').map((e) => e.cap!), 0.4) };
  if (b === 'self-reported') return { basis: 'self-reported', cap: SELF_CAP };
  return {};
}
export const withBasis = <T extends Evidence>(ev: T, b: { basis?: Basis; cap?: number }): T => (b.basis ? { ...ev, basis: b.basis, cap: b.cap } : ev);
