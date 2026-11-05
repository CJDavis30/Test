import type { Claim } from '../../../shared/types';
import type { Adapter } from '../types';
import { RateLimitedError } from '../types';
import { adapter, arr, bioClaims, claim, fullIso, getJson, iso, md5, rec, str, withRecord } from './util';

// ---------------------------------------------------------------------------------------------------------------
// Email → profile
// ---------------------------------------------------------------------------------------------------------------
export const gravatar = adapter({
  id: 'gravatar', name: 'Gravatar', description: 'Public profile tied to an email address: name, photo, linked accounts and sites.', homepage: 'https://gravatar.com',
  accepts: ['email'], capability: 'email-profile', family: 'gravatar', reliability: 0.88, cacheTtlMs: 12 * 3600_000,
  selfTest: { type: 'email', value: 'someone@example.com' },
  async run(e, ctx) {
    const hash = md5(e.value.trim().toLowerCase());
    const j = await getJson<any>(ctx, `https://www.gravatar.com/${hash}.json`);
    const p = arr<any>(j?.entry)[0];
    if (!p) return [];
    const url = str(p.profileUrl) || `https://gravatar.com/${hash}`;
    const out: Claim[] = [claim('account', url, 'Gravatar profile', 0.9, { attrs: { platform: 'Gravatar' }, url, snippet: 'Profile registered with this exact email' })];
    const name = str(p.name?.formatted) || str(p.displayName);
    if (name && name.toLowerCase() !== str(p.preferredUsername).toLowerCase()) out.push(claim('person', name, 'name on profile', 0.8, { url, snippet: 'Display name chosen by the owner' }));
    if (str(p.preferredUsername)) out.push(claim('username', p.preferredUsername, 'handle', 0.75, { url }));
    const photo = str(arr<any>(p.photos)[0]?.value) || str(p.thumbnailUrl);
    if (photo) out.push(claim('image', photo, 'profile photo', 0.85, { url, attrs: { hash: `gravatar:${hash}` } }));
    if (str(p.currentLocation)) out.push(claim('location', p.currentLocation, 'location on profile', 0.6, { url, conflictKey: 'location', snippet: 'Self-reported' }));
    for (const a of arr<any>(p.accounts)) {
      const u = str(a.url);
      if (u) out.push(claim('account', u, 'linked account', a.verified ? 0.9 : 0.78, { url: u, attrs: { platform: str(a.shortname) || str(a.domain) }, snippet: a.verified ? 'Verified link on Gravatar' : 'Linked on Gravatar profile' }));
    }
    for (const u of arr<any>(p.urls)) if (str(u.value)) out.push(claim('url', u.value, 'website on profile', 0.6, { url, snippet: str(u.title) || undefined }));
    out.push(...bioClaims(p.aboutMe, 'Gravatar', url));
    return withRecord(out, rec('Gravatar profile', [['Registered with', e.value], ['Display name', name], ['Username', p.preferredUsername], ['Location', p.currentLocation], ['Linked accounts', arr<any>(p.accounts).map((a) => str(a.shortname) || str(a.domain)).filter(Boolean).join(', ')], ['Websites', arr<any>(p.urls).map((u) => str(u.value)).join(', ')], ['About', p.aboutMe]]));
  },
});

export const emailrep = adapter({
  id: 'emailrep', name: 'EmailRep', description: 'Reputation, age, and which services an address is registered with.', homepage: 'https://emailrep.io',
  accepts: ['email'], capability: 'email-reputation', family: 'emailrep', reliability: 0.7, keyOptional: true, requiresKey: 'emailrep', keyHelp: 'Optional: free key raises the daily limit', minIntervalMs: 1500,
  selfTest: { type: 'email', value: 'someone@example.com' },
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://emailrep.io/${encodeURIComponent(e.value)}`, { headers: ctx.key ? { Key: ctx.key } : undefined });
    if (!j || j.status === 'fail') { if (/limit|quota/i.test(String(j?.reason))) throw new RateLimitedError(); return []; }
    const d = j.details ?? {};
    const out: Claim[] = [];
    for (const prof of arr<string>(d.profiles)) out.push(claim('account', prof, 'registered with this email', 0.75, { attrs: { platform: prof[0].toUpperCase() + prof.slice(1) }, snippet: 'EmailRep detected an account on this service' }));
    if (d.credentials_leaked || d.data_breach) out.push(claim('breach', 'Unspecified breach (via EmailRep)', 'appeared in', 0.6, { attrs: { classes: d.credentials_leaked ? 'Credentials' : 'Data', note: 'EmailRep does not name the breach' }, snippet: `Reputation: ${str(j.reputation) || 'unknown'}${d.first_seen && d.first_seen !== 'never' ? ` · first seen ${d.first_seen}` : ''}` }));
    return withRecord(out, rec('EmailRep record', [['Address checked', e.value], ['Reputation', j.reputation], ['Registered on', arr<string>(d.profiles).join(', ')], ['First seen', d.first_seen], ['Seen in a data breach', d.data_breach ? 'Yes' : 'No']]));
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Breaches (fallback chain: HIBP if you have a key, otherwise XposedOrNot)
// ---------------------------------------------------------------------------------------------------------------
export const hibp = adapter({
  id: 'hibp', name: 'Have I Been Pwned', description: 'The reference breach index. Returns breach names and what was exposed, never passwords.', homepage: 'https://haveibeenpwned.com/API/Key',
  accepts: ['email'], capability: 'breaches', family: 'hibp', reliability: 0.95, priority: 1, requiresKey: 'hibp', keyHelp: 'Paid key from haveibeenpwned.com', minIntervalMs: 1700,
  selfTest: { type: 'email', value: 'test@example.com' },
  async run(e, ctx) {
    const rows = arr<any>(await getJson(ctx, `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(e.value)}?truncateResponse=false`, { headers: { 'hibp-api-key': ctx.key ?? '' } }));
    return rows.map((b) => claim('breach', str(b.Title) || str(b.Name), 'appeared in', 0.95, {
      attrs: { date: str(b.BreachDate), classes: arr<string>(b.DataClasses).join(', '), count: Number(b.PwnCount) || 0, domain: str(b.Domain) },
      when: iso(b.BreachDate), url: `https://haveibeenpwned.com/PwnedWebsites#${str(b.Name)}`, snippet: `Exposed: ${arr<string>(b.DataClasses).slice(0, 6).join(', ')}`,
      record: rec(`Breach: ${str(b.Title) || str(b.Name)}`, [['Address checked', e.value], ['Breach date', b.BreachDate], ['Exposed data', arr<string>(b.DataClasses).join(', ')], ['Accounts affected', Number(b.PwnCount) ? Number(b.PwnCount).toLocaleString('en-US') : ''], ['Site', b.Domain]]),
    })).filter((c) => c.value);
  },
});

export const xposedornot = adapter({
  id: 'xposedornot', name: 'XposedOrNot', description: 'Free breach index. Returns breach names for an email.', homepage: 'https://xposedornot.com',
  accepts: ['email'], capability: 'breaches', family: 'xposedornot', reliability: 0.8, priority: 2, minIntervalMs: 1200,
  selfTest: { type: 'email', value: 'test@example.com' },
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(e.value)}`);
    const names = arr<any>(j?.breaches).flat().map(str).filter(Boolean);
    return [...new Set(names)].map((n) => claim('breach', n, 'appeared in', 0.85, { snippet: 'Reported by XposedOrNot', url: 'https://xposedornot.com/', record: rec(`Breach: ${n}`, [['Address checked', e.value], ['Breach', n], ['Listed by', 'XposedOrNot']]) }));
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Code & social profiles
// ---------------------------------------------------------------------------------------------------------------
const ghHeaders = (key?: string) => ({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(key ? { Authorization: `Bearer ${key}` } : {}) });

export const github = adapter({
  id: 'github', name: 'GitHub', description: 'Profile details for a username; accounts and commit authorship for an email.', homepage: 'https://github.com',
  accepts: ['username', 'email'], capability: 'code-profile', family: 'github', reliability: 0.85, keyOptional: true, requiresKey: 'github', keyHelp: 'Optional: a token lifts the 60/hour limit', minIntervalMs: 800,
  selfTest: { type: 'username', value: 'torvalds' },
  async run(e, ctx) {
    const out: Claim[] = [];
    if (e.type === 'username') {
      const p = await getJson<any>(ctx, `https://api.github.com/users/${encodeURIComponent(e.value)}`, { headers: ghHeaders(ctx.key) });
      if (!p?.login) return [];
      const url = str(p.html_url) || `https://github.com/${p.login}`;
      out.push(claim('account', url, 'GitHub profile', 0.7, { url, attrs: { platform: 'GitHub', handle: str(p.login), createdAt: fullIso(p.created_at) ?? '', repos: Number(p.public_repos) || 0, followers: Number(p.followers) || 0 }, when: iso(p.created_at), snippet: `${p.public_repos ?? 0} public repos · ${p.followers ?? 0} followers` }));
      if (str(p.name)) out.push(claim('person', p.name, 'name on profile', 0.55, { url, snippet: 'Self-reported' }));
      const company = str(p.company).replace(/^@/, '');
      if (company) out.push(claim('org', company, 'company on profile', 0.5, { url, snippet: 'Self-reported' }));
      if (str(p.location)) out.push(claim('location', p.location, 'location on profile', 0.5, { url, conflictKey: 'location', snippet: 'Self-reported' }));
      if (str(p.email)) out.push(claim('email', p.email, 'public email', 0.8, { url, snippet: 'Email shown on the profile' }));
      if (str(p.blog)) out.push(claim('url', /^https?:/i.test(p.blog) ? p.blog : `https://${p.blog}`, 'website on profile', 0.55, { url }));
      if (str(p.twitter_username)) out.push(claim('account', `https://x.com/${p.twitter_username}`, 'linked account', 0.55, { url, attrs: { platform: 'X' } }));
      if (str(p.avatar_url)) out.push(claim('image', p.avatar_url, 'profile photo', 0.6, { url, attrs: { hash: `github:${p.id}` } }));
      out.push(...bioClaims(p.bio, 'GitHub', url));
      return withRecord(out, rec('GitHub profile', [['Username', p.login], ['Name', p.name], ['Company', p.company], ['Location', p.location], ['Public email', p.email], ['Website', p.blog], ['Joined', iso(p.created_at)], ['Activity', `${p.public_repos ?? 0} public repos · ${p.followers ?? 0} followers`]]));
    } else {
      const s = await getJson<any>(ctx, `https://api.github.com/search/users?q=${encodeURIComponent(`${e.value} in:email`)}`, { headers: ghHeaders(ctx.key) });
      for (const u of arr<any>(s?.items).slice(0, 3)) {
        const r = rec('GitHub search result', [['Searched for', `${e.value} in:email`], ['Matching profile', u.login], ['Profile page', u.html_url]]);
        out.push(claim('account', u.html_url, 'profile with this public email', 0.8, { url: u.html_url, attrs: { platform: 'GitHub' }, record: r }));
        out.push(claim('username', u.login, 'handle', 0.75, { url: u.html_url, record: r }));
      }
      const c = await getJson<any>(ctx, `https://api.github.com/search/commits?q=${encodeURIComponent(`author-email:${e.value}`)}&per_page=30`, { headers: ghHeaders(ctx.key) }).catch(() => null);
      const byLogin = new Map<string, number>(), names = new Map<string, number>();
      for (const it of arr<any>(c?.items)) {
        if (it.author?.login) byLogin.set(it.author.login, (byLogin.get(it.author.login) ?? 0) + 1);
        const n = str(it.commit?.author?.name);
        if (n) names.set(n, (names.get(n) ?? 0) + 1);
      }
      const commitRec = (extra: [string, unknown][]) => rec('GitHub commits authored with this email', [['Searched for', `author-email:${e.value}`], ['Commits seen', arr(c?.items).length], ...extra]);
      for (const [login, n] of byLogin) out.push(claim('username', login, 'commits as', Math.min(0.85, 0.6 + n * 0.03), { snippet: `${n} public commit${n > 1 ? 's' : ''} authored with this email`, url: `https://github.com/${login}`, record: commitRec([['Account on those commits', login], ['Commits by that account', n]]) }));
      for (const [name, n] of names) out.push(claim('person', name, 'commit author name', Math.min(0.75, 0.5 + n * 0.04), { snippet: `Name used on ${n} public commit${n > 1 ? 's' : ''} with this email`, record: commitRec([['Author name on those commits', name], ['Commits with that name', n]]) }));
    }
    return out;
  },
});

export const gitlab = adapter({
  id: 'gitlab', name: 'GitLab', description: 'Public GitLab profile for a username.', homepage: 'https://gitlab.com',
  accepts: ['username'], capability: 'code-profile', family: 'gitlab', reliability: 0.8, minIntervalMs: 500,
  selfTest: { type: 'username', value: 'gitlab-bot' },
  async run(e, ctx) {
    const rows = arr<any>(await getJson(ctx, `https://gitlab.com/api/v4/users?username=${encodeURIComponent(e.value)}`));
    const p = rows[0];
    if (!p) return [];
    const url = str(p.web_url) || `https://gitlab.com/${p.username}`;
    const out = [claim('account', url, 'GitLab profile', 0.65, { url, attrs: { platform: 'GitLab' }, snippet: `State: ${p.state ?? 'unknown'}` })];
    if (str(p.name) && str(p.name).toLowerCase() !== str(p.username).toLowerCase()) out.push(claim('person', p.name, 'name on profile', 0.5, { url }));
    return withRecord(out, rec('GitLab profile', [['Username', p.username], ['Name', p.name], ['Status', p.state], ['Profile page', url]]));
  },
});

export const bluesky = adapter({
  id: 'bluesky', name: 'Bluesky', description: 'Public Bluesky profile for a handle or a domain used as a handle.', homepage: 'https://bsky.app',
  accepts: ['username', 'domain'], capability: 'code-profile', family: 'bluesky', reliability: 0.82, minIntervalMs: 300,
  selfTest: { type: 'username', value: 'bsky.app' },
  async run(e, ctx) {
    const handle = e.type === 'domain' || e.value.includes('.') ? e.value : `${e.value}.bsky.social`;
    const p = await getJson<any>(ctx, `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`).catch((err) => { if (/HTTP 400/.test(String(err?.message))) return null; throw err; });
    if (!p?.handle) return [];
    const url = `https://bsky.app/profile/${p.handle}`;
    const out: Claim[] = [claim('account', url, 'Bluesky profile', e.type === 'domain' ? 0.85 : 0.7, { url, attrs: { platform: 'Bluesky', handle: str(p.handle), createdAt: fullIso(p.createdAt) ?? '', followers: Number(p.followersCount) || 0 }, when: iso(p.createdAt), snippet: `${p.postsCount ?? 0} posts · ${p.followersCount ?? 0} followers` })];
    if (str(p.displayName)) out.push(claim('person', p.displayName, 'display name', 0.5, { url }));
    if (str(p.avatar)) out.push(claim('image', p.avatar, 'profile photo', 0.6, { url, attrs: { hash: `bsky:${p.did}` } }));
    out.push(...bioClaims(p.description, 'Bluesky', url));
    return withRecord(out, rec('Bluesky profile', [['Handle', p.handle], ['Display name', p.displayName], ['Joined', iso(p.createdAt)], ['Followers', p.followersCount], ['Bio', p.description]]));
  },
});

export const hackernews = adapter({
  id: 'hackernews', name: 'Hacker News', description: 'Account age, karma and bio for a username.', homepage: 'https://news.ycombinator.com',
  accepts: ['username'], capability: 'code-profile', family: 'hackernews', reliability: 0.7, minIntervalMs: 300,
  selfTest: { type: 'username', value: 'pg' },
  async run(e, ctx) {
    const p = await getJson<any>(ctx, `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(e.value)}.json`);
    if (!p?.id) return [];
    const url = `https://news.ycombinator.com/user?id=${p.id}`;
    const about = String(p.about ?? '').replace(/<[^>]+>/g, ' ');
    return withRecord([claim('account', url, 'Hacker News profile', 0.55, { url, attrs: { platform: 'Hacker News', handle: str(p.id), createdAt: fullIso(p.created) ?? '', karma: Number(p.karma) || 0 }, when: iso(p.created), snippet: `Karma ${p.karma ?? 0}` }), ...bioClaims(about, 'Hacker News', url)], rec('Hacker News profile', [['Username', p.id], ['Joined', iso(p.created)], ['Karma', p.karma], ['About', about]]));
  },
});

export const devto = adapter({
  id: 'devto', name: 'DEV Community', description: 'Profile with linked GitHub/X accounts, location and website.', homepage: 'https://dev.to',
  accepts: ['username'], capability: 'code-profile', family: 'devto', reliability: 0.78, minIntervalMs: 500,
  selfTest: { type: 'username', value: 'ben' },
  async run(e, ctx) {
    const p = await getJson<any>(ctx, `https://dev.to/api/users/by_username?url=${encodeURIComponent(e.value)}`);
    if (!p?.username) return [];
    const url = `https://dev.to/${p.username}`;
    const out: Claim[] = [claim('account', url, 'DEV profile', 0.65, { url, attrs: { platform: 'DEV' }, when: iso(p.joined_at) })];
    if (str(p.name)) out.push(claim('person', p.name, 'name on profile', 0.55, { url }));
    if (str(p.location)) out.push(claim('location', p.location, 'location on profile', 0.5, { url, conflictKey: 'location', snippet: 'Self-reported' }));
    if (str(p.github_username)) out.push(claim('account', `https://github.com/${p.github_username}`, 'linked account', 0.7, { url, attrs: { platform: 'GitHub' }, snippet: 'GitHub username listed on the DEV profile' }));
    if (str(p.twitter_username)) out.push(claim('account', `https://x.com/${p.twitter_username}`, 'linked account', 0.65, { url, attrs: { platform: 'X' } }));
    if (str(p.website_url)) out.push(claim('url', p.website_url, 'website on profile', 0.55, { url }));
    out.push(...bioClaims(p.summary, 'DEV', url));
    return withRecord(out, rec('DEV profile', [['Username', p.username], ['Name', p.name], ['Location', p.location], ['GitHub', p.github_username], ['Twitter / X', p.twitter_username], ['Website', p.website_url], ['Joined', p.joined_at], ['Summary', p.summary]]));
  },
});

export const keybase = adapter({
  id: 'keybase', name: 'Keybase', description: 'Cryptographically verified links between accounts (the strongest identity proof available for free).', homepage: 'https://keybase.io',
  accepts: ['username'], capability: 'code-profile', family: 'keybase', reliability: 0.92, minIntervalMs: 500,
  selfTest: { type: 'username', value: 'chris' },
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${encodeURIComponent(e.value)}&fields=basics,profile,proofs_summary`);
    const t = arr<any>(j?.them).find(Boolean);
    if (!t?.basics?.username) return [];
    const url = `https://keybase.io/${t.basics.username}`;
    const out: Claim[] = [claim('account', url, 'Keybase profile', 0.8, { url, attrs: { platform: 'Keybase' } })];
    if (str(t.profile?.full_name)) out.push(claim('person', t.profile.full_name, 'name on profile', 0.6, { url }));
    if (str(t.profile?.location)) out.push(claim('location', t.profile.location, 'location on profile', 0.55, { url, conflictKey: 'location' }));
    for (const pr of arr<any>(t.proofs_summary?.all)) {
      const link = str(pr.service_url);
      if (link && pr.state === 1) out.push(claim('account', link, 'cryptographically proven account', 0.93, { url, attrs: { platform: str(pr.proof_type) }, snippet: `Signed proof on ${pr.proof_type}: ${pr.nametag}` }));
    }
    return withRecord(out, rec('Keybase profile', [['Username', t.basics.username], ['Name', t.profile?.full_name], ['Location', t.profile?.location], ['Verified proofs', arr<any>(t.proofs_summary?.all).filter((x) => x.state === 1).map((x) => `${x.proof_type}: ${x.nametag}`).join(', ')]]));
  },
});

export const reddit = adapter({
  id: 'reddit', name: 'Reddit', description: 'Account existence, age and karma. Reddit often blocks unauthenticated lookups.', homepage: 'https://reddit.com',
  accepts: ['username'], capability: 'code-profile', family: 'reddit', reliability: 0.5, minIntervalMs: 1500,
  selfTest: { type: 'username', value: 'spez' },
  async run(e, ctx) {
    const res = await ctx.fetch(`https://www.reddit.com/user/${encodeURIComponent(e.value)}/about.json`);
    if (res.status === 404) return [];
    if (res.status === 403 || res.status === 429) throw new RateLimitedError(0, 'Reddit blocked the request');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const p = (await res.json())?.data;
    if (!p?.name || p.is_suspended) return [];
    const url = `https://www.reddit.com/user/${p.name}`;
    return [claim('account', url, 'Reddit profile', 0.45, { url, attrs: { platform: 'Reddit', handle: str(p.name), createdAt: fullIso(p.created_utc) ?? '', karma: (Number(p.link_karma) || 0) + (Number(p.comment_karma) || 0) }, when: iso(p.created_utc), snippet: 'A matching username is not proof it is the same person', record: rec('Reddit profile', [['Username', p.name], ['Account created', iso(p.created_utc)], ['Karma', (Number(p.link_karma) || 0) + (Number(p.comment_karma) || 0)]]) })];
  },
});

export const identityAdapters: Adapter[] = [gravatar, emailrep, hibp, xposedornot, github, gitlab, bluesky, hackernews, devto, keybase, reddit];
