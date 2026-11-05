import { IdClock, describeEstimate } from '../shared/forensics/idclock';
import type { Claim } from '../shared/types';
import type { PlatformRef } from '../shared/forensics/ids';
import type { Store } from './store';

/** Platforms whose numeric account IDs grow in order, and which attribute carries the ID. */
const PLATFORMS: Record<string, string> = { Roblox: 'robloxId', GitHub: 'githubId' };
const KEY = (p: string) => `idclock:${p}`;
const load = (store: Store, platform: string) => new IdClock(store.getSetting<{ id: number; at: number }[]>(KEY(platform), []));

/** Every profile with a known ID and creation time teaches the clock. Returns how many anchors were added. */
export function learnIds(store: Store, claims: Claim[]): number {
  const by = new Map<string, IdClock>(); let n = 0;
  for (const c of claims) {
    const platform = typeof c.attrs?.platform === 'string' ? c.attrs.platform : '';
    const attr = PLATFORMS[platform]; if (!attr) continue;
    const id = Number(c.attrs?.[attr]); const at = Date.parse(String(c.attrs?.createdAt ?? ''));
    if (!Number.isFinite(id) || !Number.isFinite(at)) continue;
    const clock = by.get(platform) ?? by.set(platform, load(store, platform)).get(platform)!;
    clock.add(id, at); n++;
  }
  for (const [p, c] of by) store.setSetting(KEY(p), c.anchors);
  return n;
}

/** "around Mar 2021 (±5 months…)" for a Roblox or GitHub user reference, once enough accounts have been seen. */
export function estimateNote(store: Store, ref: PlatformRef): string | undefined {
  if (ref.kind !== 'user' || !PLATFORMS[ref.platform] || !/^\d{1,12}$/.test(ref.id)) return undefined;
  const e = load(store, ref.platform).estimate(Number(ref.id));
  return e ? `${ref.platform} account ${describeEstimate(e).replace(/^around/, 'created around')}` : undefined;
}
export const clockSize = (store: Store, platform: string) => load(store, platform).size;
