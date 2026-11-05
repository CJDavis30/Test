import type { Finding } from './types';
import type { ReliabilityFn } from './scoring';

/**
 * The same idea as the Match Lab, for any finding. Sources are combined as "noisy OR": each independent source has some chance of being
 * right, and the finding is believed unless EVERY source is wrong at once. So each source contributes −log2(1 − its chance of being right)
 * bits, and the total is how surprising it would be for all of them to be wrong together: a plain-language measure of how well backed a
 * finding is.
 */
export interface LedgerRow { family: string; name: string; /** chance this source is right about this claim */ p: number; bits: number }
export interface Ledger { rows: LedgerRow[]; total: number; /** "1 in N" that every independent source is wrong at once */ allWrongOneIn: number; sources: number }

export function ledger(f: Pick<Finding, 'type' | 'evidence'>, rel: ReliabilityFn): Ledger {
  const by = new Map<string, LedgerRow>();
  for (const e of f.evidence) {
    if (e.polarity === 'against') continue;
    const p = Math.min(0.98, Math.max(0, e.weight) * rel(e.adapter, f.type));
    const cur = by.get(e.family);
    if (!cur || p > cur.p) by.set(e.family, { family: e.family, name: e.adapterName, p, bits: -Math.log2(1 - p) });
  }
  const rows = [...by.values()].sort((a, b) => b.bits - a.bits);
  const total = rows.reduce((s, r) => s + r.bits, 0);
  return { rows, total, allWrongOneIn: 2 ** total, sources: rows.length };
}
