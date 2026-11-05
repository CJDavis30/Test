import type { Claim } from '../../../shared/types';
import { findPlatformRefs } from '../../../shared/forensics/ids';
import { arr, bioClaims, claim, countryName, def, enc, fullIso, getJson, getText, iso, joinPlace, linkClaim, md5, meta, rec, str, toDate, withRecord } from './kit';

/** Names, places and linked accounts that people publish on developer, gaming and social sites. Each looks one exact name up on one site. */
const person = (name: string | undefined, url: string, w = 0.45, why = 'name on profile') => (str(name) ? [claim('person', str(name), why, w, { url, snippet: 'Display name chosen by the owner' })] : []);
const place = (loc: string | undefined, url: string, w = 0.4) => (str(loc) ? [claim('location', str(loc), 'location on profile', w, { url, conflictKey: 'location', snippet: 'Self-reported' })] : []);
const acct = (platform: string, url: string, w: number, attrs: Record<string, string | number | boolean> = {}, snippet?: string) => claim('account', url, `${platform} profile`, w, { url, attrs: { platform, ...attrs }, snippet });
const NAME_OK = (v: string) => /^[\w.\-]{1,40}$/.test(v);

export const codeberg = def({
  id: 'codeberg', name: 'Codeberg', desc: 'Public Codeberg (Forgejo) profile for a username.', homepage: 'https://codeberg.org',
  accepts: ['username'], cap: 'code-profile', family: 'codeberg', rel: 0.8, self: ['username', 'forgejo'],
  asked: (q) => `Looked up the Codeberg profile for ${q}`, check: (_t, v) => `https://codeberg.org/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const p = await getJson<any>(ctx, `https://codeberg.org/api/v1/users/${enc(e.value)}`); if (!p?.login) return [];
    const url = str(p.html_url) || `https://codeberg.org/${p.login}`;
    const out: Claim[] = [acct('Codeberg', url, 0.7, { handle: str(p.login), createdAt: fullIso(p.created) ?? '' }, `Joined ${iso(p.created) ?? 'unknown'}`), ...person(p.full_name, url), ...place(p.location, url)];
    if (str(p.website)) { const c = linkClaim(str(p.website), 'Codeberg profile', 0.65, url); if (c) out.push(c); }
    if (str(p.email) && !/noreply/.test(p.email)) out.push(claim('email', p.email, 'email on profile', 0.6, { url }));
    out.push(...bioClaims(p.description, 'Codeberg', url));
    return withRecord(out, rec('Codeberg profile', [['Username', p.login], ['Name', p.full_name], ['Location', p.location], ['Joined', iso(p.created)], ['Profile page', url]]));
  },
});

export const bitbucket = def({
  id: 'bitbucket', name: 'Bitbucket', desc: 'Public Bitbucket workspace for a username.', homepage: 'https://bitbucket.org',
  accepts: ['username'], cap: 'code-profile', family: 'bitbucket', rel: 0.7, self: ['username', 'atlassian'],
  asked: (q) => `Looked up the Bitbucket workspace named ${q}`, check: (_t, v) => `https://bitbucket.org/${enc(v)}/`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const p = await getJson<any>(ctx, `https://api.bitbucket.org/2.0/workspaces/${enc(e.value)}`); if (!p?.slug) return [];
    const url = str(p.links?.html?.href) || `https://bitbucket.org/${p.slug}/`;
    return withRecord([acct('Bitbucket', url, 0.6, { handle: str(p.slug), createdAt: fullIso(p.created_on) ?? '' }, 'A workspace by this name exists'), ...person(p.name, url, 0.35, 'workspace name')], rec('Bitbucket workspace', [['Workspace', p.slug], ['Name', p.name], ['Created', iso(p.created_on)], ['Page', url]]));
  },
});

export const npm = def({
  id: 'npm', name: 'npm', desc: 'Packages a username publishes on npm, and the public email attached to them.', homepage: 'https://www.npmjs.com',
  accepts: ['username'], cap: 'code-profile', family: 'npm', rel: 0.75, self: ['username', 'sindresorhus'],
  asked: (q) => `Searched npm for packages maintained by ${q}`, check: (_t, v) => `https://www.npmjs.com/~${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const j = await getJson<any>(ctx, `https://registry.npmjs.org/-/v1/search?text=maintainer:${enc(e.value)}&size=25`);
    const mine = arr<any>(j?.objects).map((o) => o.package).filter((p) => arr<any>(p?.maintainers).some((m) => str(m.username).toLowerCase() === e.value.toLowerCase()));
    if (!mine.length) return [];
    const url = `https://www.npmjs.com/~${e.value}`;
    const out: Claim[] = [acct('npm', url, 0.7, { handle: e.value, packages: mine.length }, `Maintains ${mine.length} public package${mine.length === 1 ? '' : 's'}`)];
    const emails = new Set<string>();
    for (const p of mine) for (const m of arr<any>(p.maintainers)) if (str(m.username).toLowerCase() === e.value.toLowerCase() && str(m.email)) emails.add(str(m.email).toLowerCase());
    for (const m of emails) out.push(claim('email', m, 'email on npm packages', 0.6, { url, snippet: 'Published in the npm registry' }));
    const gh = new Set<string>();
    for (const p of mine) { const r = /github\.com\/([\w-]+)\//i.exec(str(p.links?.repository)); if (r) gh.add(r[1]); }
    for (const g of gh) out.push(claim('account', `https://github.com/${g}`, 'repository owner of their packages', 0.45, { url, attrs: { platform: 'GitHub', handle: g }, snippet: 'Their npm packages live in this GitHub account' }));
    return withRecord(out, rec('npm packages', [['Maintainer', e.value], ['Packages', mine.slice(0, 6).map((p) => p.name).join(', ')], ['Public email', [...emails].join(', ')]]));
  },
});

export const crates = def({
  id: 'crates', name: 'crates.io', desc: 'Public profile of a Rust crate publisher.', homepage: 'https://crates.io',
  accepts: ['username'], cap: 'code-profile', family: 'crates', rel: 0.75, self: ['username', 'dtolnay'],
  asked: (q) => `Looked up ${q} on crates.io`, check: (_t, v) => `https://crates.io/users/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const j = await getJson<any>(ctx, `https://crates.io/api/v1/users/${enc(e.value)}`); const p = j?.user; if (!p?.login) return [];
    const url = str(p.url) || `https://crates.io/users/${p.login}`;
    return withRecord([acct('crates.io', `https://crates.io/users/${p.login}`, 0.65, { handle: str(p.login) }), ...person(p.name, url, 0.4)], rec('crates.io user', [['Login', p.login], ['Name', p.name], ['Profile', url]]));
  },
});

export const dockerhub = def({
  id: 'dockerhub', name: 'Docker Hub', desc: 'Public Docker Hub profile: name, company, location, join date.', homepage: 'https://hub.docker.com',
  accepts: ['username'], cap: 'code-profile', family: 'dockerhub', rel: 0.8, self: ['username', 'docker'],
  asked: (q) => `Looked up the Docker Hub user ${q}`, check: (_t, v) => `https://hub.docker.com/u/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    // Docker Hub now answers with "orgname" for personal accounts too (it redirects /users/ to /orgs/), so accept either shape.
    const p = await getJson<any>(ctx, `https://hub.docker.com/v2/users/${enc(e.value)}/`); const handle = str(p?.username) || str(p?.orgname); if (!handle) return [];
    const url = `https://hub.docker.com/u/${handle}`;
    const out: Claim[] = [acct('Docker Hub', url, 0.7, { handle, createdAt: fullIso(p.date_joined) ?? '' }, `Joined ${iso(p.date_joined) ?? 'unknown'}`), ...person(p.full_name, url), ...place(p.location, url)];
    if (str(p.company)) out.push(claim('org', p.company, 'company on profile', 0.45, { url, snippet: 'Self-reported' }));
    return withRecord(out, rec('Docker Hub profile', [['Username', handle], ['Name', p.full_name], ['Company', p.company], ['Location', p.location], ['Joined', iso(p.date_joined)]]));
  },
});

export const stackexchange = def({
  id: 'stackexchange', name: 'Stack Overflow', desc: 'Stack Overflow profile whose display name matches exactly. Display names are not unique, so this is a lead.', homepage: 'https://stackoverflow.com',
  accepts: ['username'], cap: 'code-profile', family: 'stackexchange', rel: 0.6, self: ['username', 'Jon Skeet'],
  asked: (q) => `Searched Stack Overflow for a user named ${q}`, check: (_t, v) => `https://stackoverflow.com/users?tab=Reputation&filter=all&search=${enc(v)}`,
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://api.stackexchange.com/2.3/users?inname=${enc(e.value)}&site=stackoverflow&pagesize=10&order=desc&sort=reputation`);
    const p = arr<any>(j?.items).find((x) => str(x.display_name).toLowerCase() === e.value.toLowerCase()); if (!p) return [];
    const url = str(p.link);
    const out: Claim[] = [acct('Stack Overflow', url, 0.45, { handle: str(p.display_name), createdAt: p.creation_date ? new Date(p.creation_date * 1000).toISOString() : '', reputation: Number(p.reputation) || 0 }, 'Display names are not unique: another person may share this one'), ...place(p.location, url, 0.35)];
    if (str(p.website_url)) { const c = linkClaim(str(p.website_url), 'Stack Overflow profile', 0.55, url); if (c) out.push(c); }
    return withRecord(out, rec('Stack Overflow profile', [['Display name', p.display_name], ['Location', p.location], ['Joined', p.creation_date ? iso(p.creation_date) : ''], ['Reputation', p.reputation], ['Website', p.website_url]]));
  },
});

export const lichess = def({
  id: 'lichess', name: 'Lichess', desc: 'Public Lichess profile: join date, country, bio and sometimes a real name.', homepage: 'https://lichess.org',
  accepts: ['username'], cap: 'gaming-profile', family: 'lichess', rel: 0.85, self: ['username', 'DrNykterstein'],
  asked: (q) => `Looked up the Lichess player ${q}`, check: (_t, v) => `https://lichess.org/@/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const p = await getJson<any>(ctx, `https://lichess.org/api/user/${enc(e.value)}`); if (!p?.username) return [];
    const url = `https://lichess.org/@/${p.username}`, pr = p.profile ?? {};
    const out: Claim[] = [acct('Lichess', url, 0.75, { handle: str(p.username), createdAt: fullIso(p.createdAt) ?? '', closed: !!p.closed }, `Joined ${iso(p.createdAt) ?? 'unknown'}${p.disabled ? ' · account closed' : ''}`)];
    out.push(...person([str(pr.firstName), str(pr.lastName)].filter(Boolean).join(' ') || pr.realName, url, 0.5, 'name on profile'));
    out.push(...place(joinPlace(pr.location, pr.country ? countryName(pr.country) : ''), url));
    for (const l of String(pr.links ?? '').split(/\s+/).filter(Boolean).slice(0, 6)) { const c = linkClaim(l, 'Lichess profile', 0.7, url); if (c) out.push(c); }
    out.push(...bioClaims(pr.bio, 'Lichess', url));
    return withRecord(out, rec('Lichess profile', [['Username', p.username], ['Name', [pr.firstName, pr.lastName].filter(Boolean).join(' ')], ['Location', pr.location], ['Joined', iso(p.createdAt)], ['Last seen', iso(p.seenAt)], ['Games', p.count?.all]]));
  },
});

export const chesscom = def({
  id: 'chesscom', name: 'Chess.com', desc: 'Public Chess.com profile: join date, country, location and name.', homepage: 'https://www.chess.com',
  accepts: ['username'], cap: 'gaming-profile', family: 'chesscom', rel: 0.85, self: ['username', 'hikaru'],
  asked: (q) => `Looked up the Chess.com player ${q}`, check: (_t, v) => `https://www.chess.com/member/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const p = await getJson<any>(ctx, `https://api.chess.com/pub/player/${enc(e.value.toLowerCase())}`); if (!p?.username) return [];
    const url = str(p.url) || `https://www.chess.com/member/${p.username}`, cc = str(p.country).split('/').pop();
    const out: Claim[] = [acct('Chess.com', url, 0.75, { handle: str(p.username), createdAt: p.joined ? new Date(p.joined * 1000).toISOString() : '', playerId: Number(p.player_id) || 0 }, `Joined ${p.joined ? iso(p.joined) : 'unknown'}`), ...person(p.name, url, 0.5), ...place(joinPlace(p.location, cc ? countryName(cc) : ''), url)];
    return withRecord(out, rec('Chess.com profile', [['Username', p.username], ['Name', p.name], ['Location', p.location], ['Country', cc ? countryName(cc) : ''], ['Joined', p.joined ? iso(p.joined) : ''], ['Last online', p.last_online ? iso(p.last_online) : ''], ['Status', p.status]]));
  },
});

export const speedrun = def({
  id: 'speedrun', name: 'speedrun.com', desc: 'Speedrunner profiles list their Twitch, YouTube and X accounts, which makes them useful for linking.', homepage: 'https://www.speedrun.com',
  accepts: ['username'], cap: 'gaming-profile', family: 'speedrun', rel: 0.85, self: ['username', 'Frozone'],
  asked: (q) => `Looked up the speedrun.com user ${q}`, check: (_t, v) => `https://www.speedrun.com/users/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const j = await getJson<any>(ctx, `https://www.speedrun.com/api/v1/users?lookup=${enc(e.value)}&max=1`); const p = arr<any>(j?.data)[0]; if (!p?.id) return [];
    const name = str(p.names?.international) || e.value, url = str(p.weblink) || `https://www.speedrun.com/users/${name}`;
    const out: Claim[] = [acct('speedrun.com', url, 0.75, { handle: name, createdAt: fullIso(p.signup) ?? '' }, `Joined ${iso(p.signup) ?? 'unknown'}`), ...place(joinPlace(p.location?.region?.names?.international, p.location?.country?.names?.international), url)];
    for (const k of ['twitch', 'youtube', 'twitter', 'speedrunslive', 'hitbox']) { const u = str(p[k]?.uri); if (u) { const c = linkClaim(u, 'speedrun.com profile', 0.8, url); if (c) out.push(c); } }
    return withRecord(out, rec('speedrun.com profile', [['Name', name], ['Joined', iso(p.signup)], ['Location', joinPlace(p.location?.region?.names?.international, p.location?.country?.names?.international)], ['Twitch', p.twitch?.uri], ['YouTube', p.youtube?.uri], ['X', p.twitter?.uri]]));
  },
});

const xml = (s: string, tag: string) => { const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`).exec(s); return (m?.[1] ?? m?.[2] ?? '').trim(); };
export const steamCommunity = def({
  id: 'steam-community', name: 'Steam Community', desc: 'Public Steam profile: ID, custom URL, real name, location and member-since date. Private profiles show only a name.', homepage: 'https://steamcommunity.com',
  accepts: ['username', 'account'], cap: 'gaming-profile', family: 'steam', rel: 0.85, self: ['username', 'gabelogannewell'],
  asked: (q, t) => (t === 'account' ? `Opened the Steam profile ${q}` : `Looked up the Steam profile named ${q}`), check: (t, v) => (t === 'account' && /^https?:\/\//.test(v) ? v : `https://steamcommunity.com/id/${enc(v)}`),
  async run(e, ctx) {
    let path = '';
    if (e.type === 'account') { const r = findPlatformRefs(e.value).find((x) => x.platform === 'Steam'); if (!r) return []; path = r.kind === 'user' && /^\d{17}$/.test(r.id) ? `profiles/${r.id}` : `id/${enc(r.id)}`; }
    else { if (!NAME_OK(e.value)) return []; path = `id/${enc(e.value)}`; }
    const x = await getText(ctx, `https://steamcommunity.com/${path}?xml=1`); if (!x || /<error>/.test(x) || !xml(x, 'steamID64')) return [];
    const id = xml(x, 'steamID64'), custom = xml(x, 'customURL'), persona = xml(x, 'steamID'), since = xml(x, 'memberSince'), real = xml(x, 'realname'), loc = xml(x, 'location'), priv = xml(x, 'privacyState');
    const url = `https://steamcommunity.com/profiles/${id}`; const created = since ? toDate(since) : undefined;
    const out: Claim[] = [acct('Steam', url, 0.8, { handle: custom || persona, steamId: id, createdAt: created ?? '', privacy: priv }, priv && priv !== 'public' ? 'Profile is private: only the name and picture are visible' : `Member since ${since || 'unknown'}`), ...person(real, url, 0.5, 'real name on profile'), ...place(loc, url)];
    const av = xml(x, 'avatarFull'); if (av) out.push(claim('image', av, 'profile photo', 0.6, { url, attrs: { hash: `steam:${id}` } }));
    out.push(...bioClaims(xml(x, 'summary').replace(/<[^>]+>/g, ' '), 'Steam', url));
    return withRecord(out, rec('Steam profile', [['Name', persona], ['Custom URL', custom], ['Steam ID', id], ['Real name', real], ['Location', loc], ['Member since', since], ['Privacy', priv]]));
  },
});

export const minecraft = def({
  id: 'minecraft', name: 'Minecraft', desc: 'Minecraft account for a username: its permanent ID and earlier names.', homepage: 'https://playerdb.co',
  accepts: ['username'], cap: 'gaming-profile', family: 'minecraft', rel: 0.85, self: ['username', 'Notch'],
  asked: (q) => `Looked up the Minecraft player ${q}`, check: (_t, v) => `https://namemc.com/profile/${enc(v)}`,
  async run(e, ctx) {
    if (!/^\w{3,16}$/.test(e.value)) return [];
    const j = await getJson<any>(ctx, `https://playerdb.co/api/player/minecraft/${enc(e.value)}`).catch((err) => { if (/HTTP 400/.test(String(err?.message))) return null; throw err; });
    const p = j?.data?.player; if (!j?.success || !p?.id) return [];
    const url = `https://namemc.com/profile/${p.username ?? e.value}`;
    const out: Claim[] = [acct('Minecraft', url, 0.8, { handle: str(p.username), uuid: str(p.id), createdAt: '' }, `Account ID ${p.id}`)];
    for (const h of arr<any>(p.meta?.name_history)) { const n = str(h.name); if (n && n.toLowerCase() !== str(p.username).toLowerCase()) out.push(claim('username', n, 'earlier Minecraft name', 0.5, { url, snippet: 'Names change; the account ID stays', attrs: { former: true, platform: 'Minecraft' } })); }
    if (str(p.avatar)) out.push(claim('image', p.avatar, 'skin', 0.35, { url, attrs: { hash: `minecraft:${p.id}` } }));
    return withRecord(out, rec('Minecraft account', [['Name', p.username], ['Account ID', p.id], ['Earlier names', arr<any>(p.meta?.name_history).map((h) => h.name).join(', ')]]));
  },
});

export const xbox = def({
  id: 'xbox', name: 'Xbox', desc: 'Xbox gamertag: its numeric ID and any bio, location or real name set on the profile.', homepage: 'https://playerdb.co',
  accepts: ['username'], cap: 'gaming-profile', family: 'xbox', rel: 0.75, self: ['username', 'Major Nelson'],
  asked: (q) => `Looked up the Xbox gamertag ${q}`, check: (_t, v) => `https://xboxgamertag.com/search/${enc(v)}`,
  async run(e, ctx) {
    if (!/^[\w ]{1,15}$/.test(e.value)) return [];
    const j = await getJson<any>(ctx, `https://playerdb.co/api/player/xbox/${enc(e.value)}`).catch((err) => { if (/HTTP 400/.test(String(err?.message))) return null; throw err; });
    const p = j?.data?.player; if (!j?.success || !p?.id) return [];
    const url = `https://xboxgamertag.com/search/${enc(str(p.username) || e.value)}`, m = p.meta ?? {};
    const out: Claim[] = [acct('Xbox', url, 0.7, { handle: str(p.username), xuid: str(p.id) }, `Xbox user ID ${p.id}`), ...person(m.realName, url, 0.45, 'real name on profile'), ...place(m.location, url, 0.35)];
    out.push(...bioClaims(m.bio, 'Xbox', url));
    return withRecord(out, rec('Xbox profile', [['Gamertag', p.username], ['User ID', p.id], ['Real name', m.realName], ['Location', m.location], ['Gamerscore', m.gamerscore], ['Bio', m.bio]]));
  },
});

export const mastodon = def({
  id: 'mastodon', name: 'Mastodon', desc: 'Public Mastodon profile, including the links the owner has verified. Tries well-known servers, or the one you name (@name@server).', homepage: 'https://joinmastodon.org',
  accepts: ['username', 'account'], cap: 'code-profile', family: 'mastodon', rel: 0.8, self: ['username', 'Gargron'],
  asked: (q) => `Looked up ${q} on Mastodon servers`, check: (_t, v) => { const m = /^@?([\w.]+)@([\w.-]+\.[a-z]{2,})$/i.exec(v); return m ? `https://${m[2]}/@${m[1]}` : `https://mastodon.social/@${enc(v)}`; },
  async run(e, ctx) {
    const full = /^@?([\w.]+)@([\w.-]+\.[a-z]{2,})$/i.exec(e.value);
    const targets: [string, string][] = full ? [[full[1], full[2].toLowerCase()]] : /^[\w.]{1,30}$/.test(e.value) ? ['mastodon.social', 'mastodon.online', 'infosec.exchange', 'fosstodon.org', 'hachyderm.io'].map((h) => [e.value, h] as [string, string]) : [];
    const out: Claim[] = [];
    const rows = await Promise.allSettled(targets.map(async ([u, host]) => ({ host, p: await getJson<any>(ctx, `https://${host}/api/v1/accounts/lookup?acct=${enc(u)}`) })));
    // If every server failed that is a network problem, not "no such account": say so instead of reporting nothing found.
    if (rows.length && rows.every((r) => r.status === 'rejected')) throw (rows[0] as PromiseRejectedResult).reason;
    for (const r of rows) {
      if (r.status !== 'fulfilled' || !r.value.p?.url) continue;
      const { p, host } = r.value, url = str(p.url);
      out.push(acct('Mastodon', url, 0.7, { handle: `${str(p.username)}@${host}`, createdAt: fullIso(p.created_at) ?? '', followers: Number(p.followers_count) || 0, bot: !!p.bot }, `Account on ${host}, joined ${iso(p.created_at) ?? 'unknown'}`), ...person(p.display_name, url, 0.45, 'display name'));
      for (const f of arr<any>(p.fields).slice(0, 6)) { const raw = String(f.value ?? '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/)[0]; if (/^https?:\/\//.test(raw) || /^[\w-]+\.[a-z]{2,}/.test(raw)) { const c = linkClaim(raw, 'Mastodon profile', f.verified_at ? 0.9 : 0.7, url); if (c) { c.snippet = f.verified_at ? 'A link the owner has proven they control (verified by Mastodon)' : c.snippet; out.push(c); } } }
      out.push(...bioClaims(String(p.note ?? '').replace(/<[^>]+>/g, ' '), 'Mastodon', url));
      if (str(p.avatar)) out.push(claim('image', p.avatar, 'profile photo', 0.5, { url, attrs: { hash: `mastodon:${host}:${p.id}` } }));
    }
    return out;
  },
});

export const lobsters = def({
  id: 'lobsters', name: 'Lobsters', desc: 'Lobsters profile: join date, who invited them, and the GitHub and X accounts they list.', homepage: 'https://lobste.rs',
  accepts: ['username'], cap: 'code-profile', family: 'lobsters', rel: 0.85, self: ['username', 'jcs'],
  asked: (q) => `Looked up the Lobsters user ${q}`, check: (_t, v) => `https://lobste.rs/u/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const p = await getJson<any>(ctx, `https://lobste.rs/u/${enc(e.value)}.json`); if (!p?.username) return [];
    const url = `https://lobste.rs/u/${p.username}`;
    const out: Claim[] = [acct('Lobsters', url, 0.75, { handle: str(p.username), createdAt: fullIso(p.created_at) ?? '' }, `Joined ${iso(p.created_at) ?? 'unknown'}${p.invited_by_user ? ` · invited by ${p.invited_by_user}` : ''}`)];
    if (str(p.github_username)) out.push(claim('account', `https://github.com/${p.github_username}`, 'GitHub account listed on profile', 0.85, { url, attrs: { platform: 'GitHub', handle: str(p.github_username) }, snippet: 'Written by the owner on their profile' }));
    if (str(p.twitter_username)) out.push(claim('account', `https://x.com/${p.twitter_username}`, 'X account listed on profile', 0.85, { url, attrs: { platform: 'X', handle: str(p.twitter_username) }, snippet: 'Written by the owner on their profile' }));
    if (str(p.homepage)) { const c = linkClaim(str(p.homepage), 'Lobsters profile', 0.65, url); if (c) out.push(c); }
    out.push(...bioClaims(p.about, 'Lobsters', url));
    return withRecord(out, rec('Lobsters profile', [['Username', p.username], ['Joined', iso(p.created_at)], ['Invited by', p.invited_by_user], ['GitHub', p.github_username], ['X', p.twitter_username]]));
  },
});

export const telegram = def({
  id: 'telegram', name: 'Telegram (public page)', desc: 'The public t.me page for a username: name, description and size for channels and groups. Private users show only a name.', homepage: 'https://t.me',
  accepts: ['username'], cap: 'code-profile', family: 'telegram', rel: 0.7, self: ['username', 'telegram'],
  asked: (q) => `Opened the public Telegram page t.me/${q}`, check: (_t, v) => `https://t.me/${enc(v)}`,
  async run(e, ctx) {
    if (!/^[A-Za-z][\w]{4,31}$/.test(e.value)) return [];
    const h = await getText(ctx, `https://t.me/${enc(e.value)}`); if (!h) return [];
    const title = meta(h, 'og:title'), desc = meta(h, 'og:description'), extra = /tgme_page_extra">([^<]+)</.exec(h)?.[1]?.trim();
    const exists = !!(title && !/^Telegram: Contact @/i.test(title)) || /tgme_page_photo/.test(h);
    if (!exists) return [];
    const url = `https://t.me/${e.value}`;
    const out: Claim[] = [acct('Telegram', url, 0.55, { handle: e.value }, extra ? extra : 'A public page exists for this name'), ...person(title && !/^Telegram/.test(title) ? title : undefined, url, 0.4, 'name on the page')];
    const img = meta(h, 'og:image'); if (img && !/telegram\.org\/img\/t_logo/.test(img)) out.push(claim('image', img, 'profile photo', 0.5, { url, attrs: { hash: `telegram:${e.value}` } }));
    out.push(...bioClaims(desc, 'Telegram', url));
    return withRecord(out, rec('Telegram page', [['Name', title], ['Username', `@${e.value}`], ['Size', extra], ['Description', desc]]));
  },
});

export const youtube = def({
  id: 'youtube', name: 'YouTube channel', desc: 'The public YouTube channel for a @handle: its name, description and channel ID.', homepage: 'https://www.youtube.com',
  accepts: ['username'], cap: 'code-profile', family: 'youtube', rel: 0.75, self: ['username', 'YouTube'],
  asked: (q) => `Opened the YouTube channel @${q}`, check: (_t, v) => `https://www.youtube.com/@${enc(v)}`,
  async run(e, ctx) {
    if (!/^[\w.\-]{3,30}$/.test(e.value)) return [];
    const h = await getText(ctx, `https://www.youtube.com/@${enc(e.value)}`, { headers: { cookie: 'CONSENT=YES+1; SOCS=CAI', 'accept-language': 'en' } }); if (!h) return [];
    const title = meta(h, 'og:title'), desc = meta(h, 'og:description'), id = /"channelId":"(UC[\w-]{20,24})"/.exec(h)?.[1] ?? /channel\/(UC[\w-]{20,24})/.exec(h)?.[1];
    if (!title || /^(YouTube|Before you continue)/i.test(title)) return [];
    const url = `https://www.youtube.com/@${e.value}`;
    const out: Claim[] = [acct('YouTube', url, 0.7, { handle: e.value, channelId: id ?? '' }, id ? `Channel ID ${id}` : undefined), ...person(title, url, 0.35, 'channel name')];
    const img = meta(h, 'og:image'); if (img) out.push(claim('image', img, 'channel picture', 0.45, { url, attrs: { hash: `youtube:${id ?? e.value}` } }));
    out.push(...bioClaims(desc, 'YouTube', url));
    return withRecord(out, rec('YouTube channel', [['Handle', `@${e.value}`], ['Channel name', title], ['Channel ID', id], ['Description', desc]]));
  },
});

const NEXT = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
export const linktree = def({
  id: 'linktree', name: 'Linktree', desc: 'A Linktree page lists every account and site its owner chooses to link: one of the best ways to find their other profiles.', homepage: 'https://linktr.ee',
  accepts: ['username'], cap: 'code-profile', family: 'linktree', rel: 0.8, self: ['username', 'linktree'],
  asked: (q) => `Opened the Linktree page linktr.ee/${q}`, check: (_t, v) => `https://linktr.ee/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const h = await getText(ctx, `https://linktr.ee/${enc(e.value)}`); const m = h && NEXT.exec(h); if (!m) return [];
    let d: any; try { d = JSON.parse(m[1]); } catch { return []; }
    const pp = d?.props?.pageProps ?? {}, a = pp.account ?? {}; if (!a.username && !pp.links) return [];
    const url = `https://linktr.ee/${str(a.username) || e.value}`;
    const out: Claim[] = [acct('Linktree', url, 0.65, { handle: str(a.username) || e.value }, 'A Linktree page by this name exists'), ...person(a.pageTitle && a.pageTitle !== a.username ? a.pageTitle : undefined, url, 0.35, 'page title')];
    const urls = new Set<string>();
    for (const l of [...arr<any>(pp.socialLinks), ...arr<any>(pp.links), ...arr<any>(a.socialLinks)]) { const u = str(l?.url); if (u && !urls.has(u)) urls.add(u); }
    for (const u of [...urls].slice(0, 25)) { const c = linkClaim(u, 'Linktree page', 0.8, url); if (c) out.push(c); }
    out.push(...bioClaims(a.description, 'Linktree', url));
    return withRecord(out, rec('Linktree page', [['Username', a.username], ['Title', a.pageTitle], ['Links', urls.size]]));
  },
});

export const gravatarUser = def({
  id: 'gravatar-user', name: 'Gravatar (by name)', desc: 'A Gravatar profile with this exact name, including the accounts its owner has verified.', homepage: 'https://gravatar.com',
  accepts: ['username'], cap: 'code-profile', family: 'gravatar', rel: 0.75, self: ['username', 'matt'],
  asked: (q) => `Looked up the Gravatar profile named ${q}`, check: (_t, v) => `https://gravatar.com/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const j = await getJson<any>(ctx, `https://gravatar.com/${enc(e.value.toLowerCase())}.json`); const p = arr<any>(j?.entry)[0]; if (!p) return [];
    const url = str(p.profileUrl) || `https://gravatar.com/${e.value}`;
    const out: Claim[] = [acct('Gravatar', url, 0.65, { handle: str(p.preferredUsername) || e.value }), ...person(str(p.name?.formatted) || p.displayName, url, 0.5), ...place(p.currentLocation, url, 0.45)];
    for (const a of arr<any>(p.accounts)) { const c = linkClaim(str(a.url), 'Gravatar profile', a.verified ? 0.9 : 0.75, url); if (c) { if (a.verified) c.snippet = 'Verified link on Gravatar'; out.push(c); } }
    for (const u of arr<any>(p.urls)) { const c = linkClaim(str(u.value), 'Gravatar profile', 0.6, url); if (c) out.push(c); }
    const hash = str(p.hash); if (hash && str(arr<any>(p.photos)[0]?.value)) out.push(claim('image', arr<any>(p.photos)[0].value, 'profile photo', 0.8, { url, attrs: { hash: `gravatar:${hash}` } }));
    return withRecord(out, rec('Gravatar profile', [['Name', p.displayName], ['Location', p.currentLocation], ['Linked accounts', arr<any>(p.accounts).map((a) => a.shortname).join(', ')]]));
  },
});

export const codeforces = def({
  id: 'codeforces', name: 'Codeforces', desc: 'Competitive-programming profile: real name, city, organisation and join date are often filled in.', homepage: 'https://codeforces.com',
  accepts: ['username'], cap: 'code-profile', family: 'codeforces', rel: 0.85, self: ['username', 'tourist'],
  asked: (q) => `Looked up the Codeforces handle ${q}`, check: (_t, v) => `https://codeforces.com/profile/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const j = await getJson<any>(ctx, `https://codeforces.com/api/user.info?handles=${enc(e.value)}`).catch((err) => { if (/HTTP 400/.test(String(err?.message))) return null; throw err; });
    const p = arr<any>(j?.result)[0]; if (j?.status !== 'OK' || !p?.handle) return [];
    const url = `https://codeforces.com/profile/${p.handle}`;
    const out: Claim[] = [acct('Codeforces', url, 0.75, { handle: str(p.handle), createdAt: p.registrationTimeSeconds ? new Date(p.registrationTimeSeconds * 1000).toISOString() : '' }, `Registered ${p.registrationTimeSeconds ? iso(p.registrationTimeSeconds) : 'unknown'}`), ...person([str(p.firstName), str(p.lastName)].filter(Boolean).join(' '), url, 0.5), ...place(joinPlace(p.city, p.country), url)];
    if (str(p.organization)) out.push(claim('org', p.organization, 'organisation on profile', 0.5, { url, snippet: 'Self-reported (often a university or employer)' }));
    return withRecord(out, rec('Codeforces profile', [['Handle', p.handle], ['Name', [p.firstName, p.lastName].filter(Boolean).join(' ')], ['City', p.city], ['Country', p.country], ['Organisation', p.organization], ['Registered', p.registrationTimeSeconds ? iso(p.registrationTimeSeconds) : '']]));
  },
});

export const codewars = def({
  id: 'codewars', name: 'Codewars', desc: 'Codewars profile: name, clan and rank.', homepage: 'https://www.codewars.com',
  accepts: ['username'], cap: 'code-profile', family: 'codewars', rel: 0.8, self: ['username', 'jhoffner'],
  asked: (q) => `Looked up the Codewars user ${q}`, check: (_t, v) => `https://www.codewars.com/users/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const p = await getJson<any>(ctx, `https://www.codewars.com/api/v1/users/${enc(e.value)}`); if (!p?.username) return [];
    const url = `https://www.codewars.com/users/${p.username}`;
    const out: Claim[] = [acct('Codewars', url, 0.65, { handle: str(p.username) }, p.ranks?.overall?.name ? `Rank ${p.ranks.overall.name}` : undefined), ...person(p.name, url, 0.45)];
    if (str(p.clan)) out.push(claim('org', p.clan, 'clan on profile', 0.35, { url }));
    return withRecord(out, rec('Codewars profile', [['Username', p.username], ['Name', p.name], ['Clan', p.clan], ['Rank', p.ranks?.overall?.name], ['Honor', p.honor]]));
  },
});

export const huggingface = def({
  id: 'huggingface', name: 'Hugging Face', desc: 'Hugging Face profile: name, join date, and how many models they host.', homepage: 'https://huggingface.co',
  accepts: ['username'], cap: 'code-profile', family: 'huggingface', rel: 0.8, self: ['username', 'julien-c'],
  asked: (q) => `Looked up the Hugging Face user ${q}`, check: (_t, v) => `https://huggingface.co/${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const p = await getJson<any>(ctx, `https://huggingface.co/api/users/${enc(e.value)}/overview`); if (!p?.name) return [];
    const url = `https://huggingface.co/${p.name}`;
    return withRecord([acct('Hugging Face', url, 0.7, { handle: str(p.name), createdAt: fullIso(p.createdAt) ?? '' }, p.createdAt ? `Joined ${iso(p.createdAt)}` : undefined), ...person(p.fullname, url, 0.45)], rec('Hugging Face profile', [['Username', p.name], ['Name', p.fullname], ['Joined', iso(p.createdAt)], ['Models', p.numModels], ['Followers', p.numFollowers]]));
  },
});

export const launchpad = def({
  id: 'launchpad', name: 'Launchpad', desc: 'Launchpad profile (Ubuntu community): name, join date and the timezone they set.', homepage: 'https://launchpad.net',
  accepts: ['username'], cap: 'code-profile', family: 'launchpad', rel: 0.8, self: ['username', 'mark-shuttleworth'],
  asked: (q) => `Looked up the Launchpad user ~${q}`, check: (_t, v) => `https://launchpad.net/~${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const p = await getJson<any>(ctx, `https://api.launchpad.net/1.0/~${enc(e.value.toLowerCase())}`); if (!p?.name) return [];
    const url = str(p.web_link) || `https://launchpad.net/~${p.name}`;
    const out: Claim[] = [acct('Launchpad', url, 0.7, { handle: str(p.name), createdAt: fullIso(p.date_created) ?? '' }, `Joined ${iso(p.date_created) ?? 'unknown'}`), ...person(p.display_name !== p.name ? p.display_name : undefined, url, 0.45)];
    if (str(p.time_zone)) out.push(claim('location', str(p.time_zone).replace(/_/g, ' '), 'timezone set on profile', 0.3, { url, conflictKey: 'location', snippet: 'A timezone the person chose, so only a rough region' }));
    if (str(p.homepage_url)) { const c = linkClaim(str(p.homepage_url), 'Launchpad profile', 0.65, url); if (c) out.push(c); }
    return withRecord(out, rec('Launchpad profile', [['Username', p.name], ['Name', p.display_name], ['Joined', iso(p.date_created)], ['Timezone', p.time_zone]]));
  },
});

export const robloxSearch = def({
  id: 'roblox-search', name: 'Roblox (similar names)', desc: 'Roblox accounts with names close to this one. Mostly useful for spotting impostors and alternate accounts; weighted low.', homepage: 'https://www.roblox.com',
  accepts: ['username'], cap: 'gaming-profile', family: 'roblox-search', rel: 0.5, self: ['username', 'Roblox'], interval: 1200,
  asked: (q) => `Searched Roblox for names similar to ${q}`, check: (_t, v) => `https://www.roblox.com/search/users?keyword=${enc(v)}`,
  async run(e, ctx) {
    if (!NAME_OK(e.value)) return [];
    const j = await getJson<any>(ctx, `https://users.roblox.com/v1/users/search?keyword=${enc(e.value)}&limit=10`);
    const rows = arr<any>(j?.data).filter((r) => str(r.name).toLowerCase() !== e.value.toLowerCase()).slice(0, 5);
    return rows.map((r) => claim('account', `https://www.roblox.com/users/${r.id}/profile`, 'Roblox name similar to this one', 0.2, { url: `https://www.roblox.com/users/${r.id}/profile`, attrs: { platform: 'Roblox', handle: str(r.name), robloxId: String(r.id), lookalike: true }, snippet: 'Similar names are common: this may be an unrelated player, an alternate account or an impostor' }));
  },
});

// -- sources that need a key (the person adds it in Settings) ------------------------------------------------------------------
export const lastfm = def({
  id: 'lastfm', name: 'Last.fm', desc: 'Last.fm profile: real name, country and join date. Needs a free API key.', homepage: 'https://www.last.fm/api',
  accepts: ['username'], cap: 'code-profile', family: 'lastfm', rel: 0.8, self: ['username', 'rj'], key: { help: 'Free key from last.fm/api/account/create' },
  asked: (q) => `Looked up the Last.fm user ${q}`, check: (_t, v) => `https://www.last.fm/user/${enc(v)}`,
  async run(e, ctx) {
    if (!ctx.key || !NAME_OK(e.value)) return [];
    const j = await getJson<any>(ctx, `https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${enc(e.value)}&api_key=${enc(ctx.key)}&format=json`); const p = j?.user; if (!p?.name) return [];
    const url = str(p.url) || `https://www.last.fm/user/${p.name}`; const reg = p.registered?.unixtime ? new Date(Number(p.registered.unixtime) * 1000).toISOString() : '';
    return withRecord([acct('Last.fm', url, 0.7, { handle: str(p.name), createdAt: reg }, reg ? `Joined ${reg.slice(0, 10)}` : undefined), ...person(p.realname, url, 0.5, 'real name on profile'), ...place(p.country && p.country !== 'None' ? p.country : '', url, 0.4)], rec('Last.fm profile', [['Username', p.name], ['Real name', p.realname], ['Country', p.country], ['Joined', reg.slice(0, 10)], ['Scrobbles', p.playcount]]));
  },
});

export const steamApi = def({
  id: 'steam-api', name: 'Steam Web API', desc: 'The official Steam API: the exact day an account was created, country and current game. Needs a free key.', homepage: 'https://steamcommunity.com/dev/apikey',
  accepts: ['username', 'account'], cap: 'gaming-profile', family: 'steam', rel: 0.95, self: ['username', 'gabelogannewell'], key: { help: 'Free key from steamcommunity.com/dev/apikey' },
  asked: (q) => `Asked the Steam Web API about ${q}`, check: (t, v) => (t === 'account' && /^https?:\/\//.test(v) ? v : `https://steamcommunity.com/id/${enc(v)}`),
  async run(e, ctx) {
    if (!ctx.key) return [];
    let id = '';
    if (e.type === 'account') { const r = findPlatformRefs(e.value).find((x) => x.platform === 'Steam' && /^\d{17}$/.test(x.id)); if (r) id = r.id; }
    if (!id) { if (!NAME_OK(e.value)) return []; const v = await getJson<any>(ctx, `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${enc(ctx.key)}&vanityurl=${enc(e.value)}`); id = str(v?.response?.steamid); }
    if (!id) return [];
    const j = await getJson<any>(ctx, `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${enc(ctx.key)}&steamids=${id}`); const p = arr<any>(j?.response?.players)[0]; if (!p?.steamid) return [];
    const url = str(p.profileurl) || `https://steamcommunity.com/profiles/${id}`; const created = p.timecreated ? new Date(p.timecreated * 1000).toISOString() : '';
    const out: Claim[] = [acct('Steam', url, 0.9, { handle: str(p.personaname), steamId: id, createdAt: created }, created ? `Account created ${created.slice(0, 10)}` : 'Profile is private: creation date hidden'), ...person(p.realname, url, 0.5, 'real name on profile'), ...place(p.loccountrycode ? countryName(p.loccountrycode) : '', url, 0.45)];
    if (str(p.avatarfull)) out.push(claim('image', p.avatarfull, 'profile photo', 0.6, { url, attrs: { hash: `steam:${id}` } }));
    return withRecord(out, rec('Steam profile (official API)', [['Name', p.personaname], ['Steam ID', id], ['Real name', p.realname], ['Country', p.loccountrycode], ['Created', created.slice(0, 10)], ['Playing', p.gameextrainfo]]));
  },
});

export const faceit = def({
  id: 'faceit', name: 'FACEIT', desc: 'FACEIT player: country, join date and the Steam account they linked, which makes it a strong bridge. Needs a free server-side API key.', homepage: 'https://developers.faceit.com',
  accepts: ['username'], cap: 'gaming-profile', family: 'faceit', rel: 0.9, self: ['username', 's1mple'], key: { help: 'Free key from developers.faceit.com (server-side API key)' },
  asked: (q) => `Looked up the FACEIT player ${q}`, check: (_t, v) => `https://www.faceit.com/en/players/${enc(v)}`,
  async run(e, ctx) {
    if (!ctx.key || !NAME_OK(e.value)) return [];
    const p = await getJson<any>(ctx, `https://open.faceit.com/data/v4/players?nickname=${enc(e.value)}`, { headers: { Authorization: `Bearer ${ctx.key}` } }); if (!p?.player_id) return [];
    const url = str(p.faceit_url).replace('{lang}', 'en') || `https://www.faceit.com/en/players/${p.nickname}`;
    const out: Claim[] = [acct('FACEIT', url, 0.8, { handle: str(p.nickname), faceitId: str(p.player_id), createdAt: fullIso(p.activated_at) ?? '' }, p.activated_at ? `Joined ${iso(p.activated_at)}` : undefined), ...place(p.country ? countryName(p.country) : '', url, 0.4)];
    if (str(p.steam_id_64)) out.push(claim('account', `https://steamcommunity.com/profiles/${p.steam_id_64}`, 'Steam account linked to this FACEIT player', 0.9, { url, attrs: { platform: 'Steam', steamId: str(p.steam_id_64) }, snippet: 'FACEIT requires the player to link and prove this Steam account' }));
    return withRecord(out, rec('FACEIT player', [['Nickname', p.nickname], ['Country', p.country], ['Joined', iso(p.activated_at)], ['Steam ID', p.steam_id_64]]));
  },
});

export const profileAdapters = [codeberg, bitbucket, npm, crates, dockerhub, stackexchange, lichess, chesscom, speedrun, steamCommunity, minecraft, xbox, mastodon, lobsters, telegram, youtube, linktree, gravatarUser, codeforces, codewars, huggingface, launchpad, robloxSearch, lastfm, steamApi, faceit];
void md5;
