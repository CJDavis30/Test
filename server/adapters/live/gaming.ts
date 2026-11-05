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
    // Reach is context for a human reader, not evidence of anything, so it goes in the record and never in a score.
    const count = async (path: string): Promise<number | undefined> => { try { const j = await getJson<any>(ctx, `https://friends.roblox.com/v1/users/${encodeURIComponent(id)}/${path}/count`); return typeof j?.count === 'number' ? j.count : undefined; } catch { return undefined; } };
    const [friends, followers] = [await count('friends'), await count('followers')];
    const created = fullIso(p.created);
    const out: Claim[] = [claim('account', url, 'Roblox profile', 0.92, {
      url, when: iso(p.created),
      attrs: { platform: 'Roblox', handle: str(p.name), displayName: str(p.displayName), createdAt: created ?? '', robloxId: String(p.id), verified: !!p.hasVerifiedBadge, banned: !!p.isBanned },
      snippet: `Roblox account${created ? ` created ${created.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}` : ''}${p.isBanned ? ' · banned' : ''}`,
      record: rec('Roblox profile', [['Username', p.name], ['Display name', p.displayName], ['User ID', p.id], ['Created', created?.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')], ['Verified badge', p.hasVerifiedBadge ? 'Yes' : 'No'], ['Banned', p.isBanned ? 'Yes' : 'No'], ['Friends', friends?.toLocaleString('en-US')], ['Followers', followers?.toLocaleString('en-US')], ['About', str(p.description)]]),
    })];
    out.push(...bioClaims(str(p.description), 'Roblox', url));
    // Earlier usernames are real leads: people reuse handles. They are also freed up and taken by strangers, so the weight stays modest.
    try {
      const h = await getJson<any>(ctx, `https://users.roblox.com/v1/users/${encodeURIComponent(id)}/username-history?limit=10&sortOrder=Desc`);
      const seen = new Set([String(p.name).toLowerCase()]);
      for (const row of arr<any>(h?.data).slice(0, 6)) {
        const old = str(row?.name); if (!old || seen.has(old.toLowerCase())) continue; seen.add(old.toLowerCase());
        out.push(claim('username', old, 'earlier Roblox username', 0.5, { url, attrs: { platform: 'Roblox', former: true }, snippet: `Used to be called “${old}” on Roblox` }));
      }
    } catch { /* history is a bonus */ }
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

/**
 * A Discord invite link resolves, without logging in, to the server's name, its ID (a timestamp: when the server was created), its size and,
 * for many invites, the person who made it. Who made an invite is a real lead; it is not proof the person runs the server.
 */
export const discordInvite = adapter({
  id: 'discord-invite', name: 'Discord invite', description: 'What a public Discord invite link says: server name, when the server was created, its size and who made the invite.', homepage: 'https://discord.com',
  accepts: ['account', 'url'], capability: 'gaming-profile', family: 'discord', reliability: 0.9, minIntervalMs: 800, cacheTtlMs: 3600_000,
  selfTest: { type: 'account', value: 'https://discord.gg/discord-developers' },
  async run(e, ctx) {
    const ref = findPlatformRefs(e.value).find((r) => r.platform === 'Discord' && r.kind === 'invite');
    if (!ref) return [];
    const res = await ctx.fetch(`https://discord.com/api/v9/invites/${encodeURIComponent(ref.id)}?with_counts=true`);
    if (res.status === 404 || res.status === 400) return [];
    if (res.status === 429) throw new (await import('../types')).RateLimitedError();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j: any = await res.json();
    const g = j?.guild; if (!g?.id) return [];
    const { decodeDiscordSnowflake } = await import('../../../shared/forensics/ids');
    const made = decodeDiscordSnowflake(String(g.id))?.iso;
    const url = `https://discord.gg/${ref.id}`;
    const members = Number(j.approximate_member_count) || 0;
    const out: Claim[] = [claim('org', str(g.name), 'Discord server', 0.8, {
      url, when: made, attrs: { platform: 'Discord server', guildId: String(g.id), members, createdAt: made ?? '' },
      snippet: `Discord server${made ? ` created ${made.slice(0, 10)}` : ''}${members ? ` · about ${members.toLocaleString('en-US')} members` : ''}`,
      record: rec('Discord invite', [['Server', g.name], ['Server ID', g.id], ['Created', made?.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')], ['Members', members ? members.toLocaleString('en-US') : ''], ['Online now', j.approximate_presence_count], ['Invite', ref.id], ['Made by', j.inviter?.username]]),
    })];
    const inv = j.inviter;
    if (inv?.id && inv?.username) {
      const handle = str(inv.username);
      out.push(claim('account', `https://discord.com/users/${inv.id}`, 'made this invite', 0.7, {
        url, attrs: { platform: 'Discord', handle, displayName: str(inv.global_name), discordId: String(inv.id), createdAt: decodeDiscordSnowflake(String(inv.id))?.iso ?? '' },
        snippet: `Discord account ${handle} created this invite link`,
        record: rec('Discord invite maker', [['Username', handle], ['Display name', inv.global_name], ['User ID', inv.id], ['Created', decodeDiscordSnowflake(String(inv.id))?.iso?.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')]]),
      }));
    }
    return out;
  },
});

export const gamingAdapters = [roblox, discordInvite];
