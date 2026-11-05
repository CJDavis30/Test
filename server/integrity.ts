import { createHash } from 'node:crypto';
import type { Evidence, Finding } from '../shared/types';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The fields that make an observation what it is. Anything not listed here (weights, ids) can change without affecting the record. */
const canonical = (e: Evidence) => JSON.stringify([e.adapter, e.how ?? '', e.url ?? '', e.snippet ?? '', e.record ?? null, e.verdict ?? '', e.kind ?? 'direct', e.polarity ?? 'for', e.retrievedAt]);

export function fingerprint(e: Evidence): Evidence { return { ...e, hash: sha256(canonical(e)) }; }
export const fingerprintOf = (e: Evidence) => sha256(canonical(e));

export interface EvidenceCheck { checked: number; unsealed: number; altered: { findingId: string; value: string; evidenceId: string; source: string }[] }
/** Re-computes every stored fingerprint. "altered" means the stored observation no longer matches the hash taken when it was recorded. */
export function verifyEvidence(findings: Finding[]): EvidenceCheck {
  const out: EvidenceCheck = { checked: 0, unsealed: 0, altered: [] };
  for (const f of findings) for (const e of f.evidence) {
    if (!e.hash) { out.unsealed++; continue; }
    out.checked++;
    if (fingerprintOf(e) !== e.hash) out.altered.push({ findingId: f.id, value: f.value, evidenceId: e.id, source: e.adapterName });
  }
  return out;
}
