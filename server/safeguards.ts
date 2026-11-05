import { youthSignals, type Care } from '../shared/safeguards';
import type { Claim } from '../shared/types';
import type { Store } from './store';

const KEY = (caseId: string) => `care:${caseId}`;
export const minorCareOn = (store: Store) => store.getSetting<boolean>('minorCare', true);

export function careOf(store: Store, caseId: string): Care {
  return store.getSetting<Care>(KEY(caseId), { youth: false, reasons: [] });
}

/** What a source returned that says something about the subject's own age: its quotes, the record fields, and short text attributes. Never inferred from behaviour. */
export function textOfClaims(claims: Claim[]): string {
  const bits: string[] = [];
  for (const c of claims) {
    if (c.snippet) bits.push(c.snippet);
    for (const [, v] of c.record?.facts ?? []) bits.push(v);
    for (const [k, v] of Object.entries(c.attrs ?? {})) if (typeof v === 'string' && v.length < 600 && /desc|bio|about|summary/i.test(k)) bits.push(v);
  }
  return bits.join('\n');
}

/** Called as results arrive. Flags the case once, says why, and records it. Never flips a human's decision. */
export function noticeYouth(store: Store, caseId: string, claims: Claim[], source: string): Care | null {
  if (!minorCareOn(store)) return null;
  const cur = careOf(store, caseId);
  if (cur.manual) return null;
  const reasons = youthSignals(textOfClaims(claims));
  if (!reasons.length) return null;
  const merged = [...new Set([...cur.reasons, ...reasons.map((r) => `${source}: ${r}`)])].slice(0, 6);
  if (cur.youth && merged.length === cur.reasons.length) return null;
  const next: Care = { youth: true, reasons: merged };
  store.setSetting(KEY(caseId), next);
  if (!cur.youth) store.audit(caseId, 'safeguard.minor', `possible young person: ${merged.join('; ')}. Real-world linking is held back until a person says otherwise.`);
  return next;
}

/** A person's decision about whether this case involves a young person. Logged, and automatic detection stops changing it. */
export function setCare(store: Store, caseId: string, on: boolean): Care {
  const cur = careOf(store, caseId);
  const next: Care = { youth: on, reasons: cur.reasons, manual: on ? 'on' : 'off' };
  store.setSetting(KEY(caseId), next);
  store.audit(caseId, 'safeguard.override', on ? 'marked as possibly involving a young person' : `marked as NOT involving a young person${cur.reasons.length ? ` (overrode: ${cur.reasons.join('; ')})` : ''}`);
  return next;
}

export class PurposeRequired extends Error { constructor() { super('purpose_required'); } }
/** Live lookups need a reason on the record. Demo data never does; a person can turn the requirement off. */
export function purposeOk(store: Store, caseId: string, demo: boolean): boolean {
  if (demo) return true;
  if (!store.getSetting<boolean>('requirePurpose', true)) return true;
  return !!store.getCase(caseId)?.purpose.trim();
}
