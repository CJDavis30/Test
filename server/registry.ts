import type { Adapter } from './adapters/types';
import type { EntityType, SourceInfo } from '../shared/types';
import { learnedReliability } from '../shared/scoring';
import type { Store } from './store';
import { getSecret } from './config';

const adapters = new Map<string, Adapter>();

export function register(...list: Adapter[]) {
  for (const a of list) adapters.set(a.id, a);
}
export const allAdapters = () => [...adapters.values()];
export const getAdapter = (id: string) => adapters.get(id);

export function demoMode(store: Store): boolean {
  return store.getSetting<boolean>('demoMode', false);
}

export function isEnabled(store: Store, a: Adapter): boolean {
  const st = store.getSourceState(a.id);
  return st?.enabled === null || st?.enabled === undefined ? true : !!st.enabled;
}
export function priorityOf(store: Store, a: Adapter): number {
  const st = store.getSourceState(a.id);
  return st?.priority ?? a.priority;
}
export function hasKey(a: Adapter): boolean {
  return !!(a.requiresKey && getSecret(a.id));
}
export function usable(store: Store, a: Adapter): { ok: boolean; reason?: 'disabled' | 'needs_key' | 'mode' } {
  if (!a.anyMode && !!a.demo !== demoMode(store)) return { ok: false, reason: 'mode' };
  if (!isEnabled(store, a)) return { ok: false, reason: 'disabled' };
  if (a.requiresKey && !a.keyOptional && !hasKey(a)) return { ok: false, reason: 'needs_key' };
  return { ok: true };
}

export function adaptersFor(store: Store, type: EntityType): Adapter[] {
  return allAdapters().filter((a) => a.accepts.includes(type));
}

export function reliabilityFn(store: Store) {
  const fb = store.allFeedback();
  return (adapter: string, type: EntityType) => {
    const a = adapters.get(adapter);
    return learnedReliability(a?.reliability ?? 0.5, fb.get(`${adapter}|${type}`));
  };
}

export function sourceInfo(store: Store): SourceInfo[] {
  const dm = demoMode(store);
  const fb = store.feedbackByAdapter();
  return allAdapters()
    .filter((a) => a.anyMode || !!a.demo === dm)
    .map((a) => {
      const st = store.getSourceState(a.id);
      return {
        id: a.id, name: a.name, description: a.description, homepage: a.homepage, accepts: a.accepts, capability: a.capability,
        requiresKey: a.requiresKey, keyOptional: a.keyOptional, keyHelp: a.keyHelp,
        enabled: isEnabled(store, a), keySet: hasKey(a), priority: priorityOf(store, a),
        health: { ok: st?.ok ?? 0, fail: st?.fail ?? 0, lastError: st?.last_error ?? undefined, lastOkAt: st?.last_ok_at ?? undefined, avgMs: st?.avg_ms ?? undefined },
        reliability: a.reliability, demo: a.demo,
        trust: learnedReliability(a.reliability, fb.get(a.id)), decisions: (fb.get(a.id)?.accepted ?? 0) + (fb.get(a.id)?.rejected ?? 0),
      } satisfies SourceInfo;
    })
    .sort((x, y) => x.capability.localeCompare(y.capability) || x.priority - y.priority);
}
