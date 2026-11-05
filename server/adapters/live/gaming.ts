import { findPlatformRefs } from '../../../shared/forensics/ids';
import type { Claim } from '../../../shared/types';
import { adapter, arr, bioClaims, claim, fullIso, getJson, iso, rec, str } from './util';

/**
 * Roblox, from its public web API: no key, no login, and only what any visitor to a profile can see. It reports when the account was
 * created to the second, which is the single most useful fact for linking it to other accounts.
 */
export const roblox = adapter({
  id: 'roblox', name: 'Roblox', description: 'Public Roblox profile: when the account was created, display name, bio, verification and groups.', homepage: 'https://www.roblox.com',
  accepts: ['username', 'account'], capability: 'gaming-profile', family: 'roblox', reliability: 0.92, minIntervalMs: 500, cacheTtlMs: 6 * 3600_000,
  selfTest: { type: 'username', value: 'Roblox' },
  async run(e, ctx) {
    let id = '', name = e.value;
    if (e.type === 'account') {
      const ref = findPlatformRefs(e.value).find((r) => r.platform === 'Roblox');
      if (!ref) return [];
      if (ref.kind === 'user') id = ref.id; else name = ref.id;
    }
    if (!id) {
      const res = await ctx.fetch('https://users.roblox.com/v1/usernames/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usernames: [name], excludeBannedUsers: false }) });
      if (res.status === 429) throw new (await import('../types')).RateLimitedError();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      id = String(arr<any>((await res.json())?.data)[0]?.id ?? '');
      if (!id) return [];
    }
    const p = await getJson<any>(ctx, `https://users.roblox.com/v1/users/${encodeURIComponent(id)}`);
    if (!p?.id) return [];
    const url = `https://www.roblox.com/users/${p.id}/profile`;
    const created = fullIso(p.created);
    const out: Claim[] = [claim('account', url, 'Roblox profile', 0.92, {
      url, when: iso(p.created),
      attrs: { platform: 'Roblox', handle: str(p.name), displayName: str(p.displayName), createdAt: created ?? '', robloxId: String(p.id), verified: !!p.hasVerifiedBadge, banned: !!p.isBanned },
      snippet: `Roblox account${created ? ` created ${created.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}` : ''}${p.isBanned ? ' · banned' : ''}`,
      record: rec('Roblox profile', [['Username', p.name], ['Display name', p.displayName], ['User ID', p.id], ['Created', created?.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')], ['Verified badge', p.hasVerifiedBadge ? 'Yes' : 'No'], ['Banned', p.isBanned ? 'Yes' : 'No'], ['About', str(p.description)]]),
    })];
    out.push(...bioClaims(str(p.description), 'Roblox', url));
    // Groups say who a player plays with, but they are noisy: keep the few biggest, at modest weight.
    try {
      const g = await getJson<any>(ctx, `https://groups.roblox.com/v2/users/${encodeURIComponent(id)}/groups/roles`);
      for (const row of arr<any>(g?.data).sort((a, b) => (b.group?.memberCount ?? 0) - (a.group?.memberCount ?? 0)).slice(0, 4)) {
        if (!row.group?.name) continue;
        out.push(claim('org', str(row.group.name), 'member of group', 0.3, { url: `https://www.roblox.com/groups/${row.group.id}`, attrs: { platform: 'Roblox group', members: Number(row.group.memberCount) || 0 }, snippet: `Role: ${str(row.role?.name) || 'member'} · ${Number(row.group.memberCount || 0).toLocaleString('en-US')} members` }));
      }
    } catch { /* groups are a bonus; the profile is the finding */ }
    return out;
  },
});

export const gamingAdapters = [roblox];
