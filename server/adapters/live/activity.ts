import type { Claim } from '../../../shared/types';
import { adapter, arr, claim, getJson, rec, str } from './util';

/**
 * Activity adapters: public timestamps become an account's "when are they awake" record, which Plexus turns into a timezone estimate.
 * Each one reports the same account as its profile source (same family, so nothing is counted twice) and adds only what it knows:
 * the times. Only public activity feeds are read. Content is never stored, only when something happened.
 */
const KEEP = 400;
const pack = (ms: number[]) => ms.filter(Number.isFinite).sort((a, b) => a - b).slice(-KEEP).join(',');
const stamp = (v: unknown): number => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v ?? '')));

function activityClaim(url: string, platform: string, handle: string, times: number[], extra: Record<string, string | number | boolean> = {}, snippet?: string): Claim[] {
  if (times.length < 5) return [];
  const span = Math.max(...times) - Math.min(...times);
  return [claim('account', url, `${platform} activity`, 0.3, {
    url, attrs: { platform, handle, activity: pack(times), ...extra },
    snippet: snippet ?? `${times.length} public actions over ${Math.max(1, Math.round(span / 86_400_000))} days`,
    record: rec(`${platform} public activity`, [['Account', handle], ['Actions seen', times.length], ['Earliest', new Date(Math.min(...times)).toISOString().slice(0, 10)], ['Latest', new Date(Math.max(...times)).toISOString().slice(0, 10)], ...Object.entries(extra).map(([k, v]) => [k, v] as [string, unknown])]),
  })];
}

const OFFSET = /^Date:\s.*?([+-])(\d{2})(\d{2})\s*$/m;

/** GitHub: public event times, and the timezone written into the author's own commits (the real offset their computer was set to). */
export const githubActivity = adapter({
  id: 'github-activity', name: 'GitHub activity', description: 'When a GitHub account is active, and the timezone its commits were written in.', homepage: 'https://github.com',
  accepts: ['username'], capability: 'activity', family: 'github', reliability: 0.85, minIntervalMs: 700, keyOptional: true, requiresKey: 'github', keyHelp: 'Optional: a token lifts the 60/hour limit',
  selfTest: { type: 'username', value: 'torvalds' },
  async run(e, ctx) {
    const h: Record<string, string> = { Accept: 'application/vnd.github+json', ...(ctx.key ? { Authorization: `Bearer ${ctx.key}` } : {}) };
    const ev = arr<any>(await getJson(ctx, `https://api.github.com/users/${encodeURIComponent(e.value)}/events/public?per_page=100`, { headers: h }));
    if (!ev.length) return [];
    const login = str(ev[0]?.actor?.login) || e.value;
    const times = ev.map((x) => stamp(x.created_at));
    // commit patches carry the author's UTC offset; read a handful of recent ones
    const shas: { repo: string; sha: string }[] = [];
    for (const x of ev) if (x.type === 'PushEvent') for (const c of arr<any>(x.payload?.commits).slice(0, 2)) if (/^[0-9a-f]{40}$/.test(str(c.sha)) && x.repo?.name) shas.push({ repo: x.repo.name, sha: c.sha });
    const offsets: number[] = [];
    for (const s of shas.slice(0, 8)) {
      try {
        const res = await ctx.fetch(`https://github.com/${s.repo}/commit/${s.sha}.patch`, { timeoutMs: 8000, headers: { Accept: 'text/plain' } });
        if (!res.ok) continue;
        const m = (await res.text()).slice(0, 4000).match(OFFSET);
        if (m) offsets.push((m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])));
      } catch { /* a missing patch is not an error */ }
    }
    const mode = offsets.length ? [...new Set(offsets)].sort((a, b) => offsets.filter((x) => x === b).length - offsets.filter((x) => x === a).length)[0] : undefined;
    const tz = mode === undefined ? undefined : `${mode < 0 ? '-' : '+'}${String(Math.floor(Math.abs(mode) / 60)).padStart(2, '0')}:${String(Math.abs(mode) % 60).padStart(2, '0')}`;
    return activityClaim(`https://github.com/${login}`, 'GitHub', login, times, tz ? { commitTz: tz, commitTzSeen: `${offsets.filter((x) => x === mode).length} of ${offsets.length}` } : {},
      tz ? `${times.length} public actions; commits were written in UTC${tz} (${offsets.filter((x) => x === mode).length} of ${offsets.length} sampled)` : undefined);
  },
});

/** Hacker News posts and comments, via the public Algolia index (one request, with exact times). */
export const hackernewsActivity = adapter({
  id: 'hn-activity', name: 'Hacker News activity', description: 'When a Hacker News account posts and comments.', homepage: 'https://news.ycombinator.com',
  accepts: ['username'], capability: 'activity', family: 'hackernews', reliability: 0.7, minIntervalMs: 500,
  selfTest: { type: 'username', value: 'pg' },
  async run(e, ctx) {
    const r = await getJson<any>(ctx, `https://hn.algolia.com/api/v1/search_by_date?tags=author_${encodeURIComponent(e.value)}&hitsPerPage=200`);
    const hits = arr<any>(r?.hits);
    return activityClaim(`https://news.ycombinator.com/user?id=${encodeURIComponent(str(hits[0]?.author) || e.value)}`, 'Hacker News', str(hits[0]?.author) || e.value, hits.map((x) => stamp(x.created_at_i)));
  },
});

/** Bluesky posts, from the public feed. */
export const blueskyActivity = adapter({
  id: 'bluesky-activity', name: 'Bluesky activity', description: 'When a Bluesky account posts.', homepage: 'https://bsky.app',
  accepts: ['username'], capability: 'activity', family: 'bluesky', reliability: 0.82, minIntervalMs: 400,
  selfTest: { type: 'username', value: 'bsky.app' },
  async run(e, ctx) {
    const handle = e.value.includes('.') ? e.value : `${e.value}.bsky.social`;
    const r = await getJson<any>(ctx, `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=100&filter=posts_no_replies`).catch((err) => { if (/HTTP 400/.test(String(err?.message))) return null; throw err; });
    const posts = arr<any>(r?.feed).filter((x) => x.post?.author?.handle === handle || !x.reason);
    return activityClaim(`https://bsky.app/profile/${handle}`, 'Bluesky', handle, posts.map((x) => stamp(x.post?.record?.createdAt ?? x.post?.indexedAt)));
  },
});

/** Wikipedia edits: a long, timestamped record, and often the most revealing one. */
export const wikipediaActivity = adapter({
  id: 'wikipedia-activity', name: 'Wikipedia edits', description: 'When a Wikipedia editor makes changes.', homepage: 'https://www.wikipedia.org',
  accepts: ['username'], capability: 'activity', family: 'wikipedia', reliability: 0.8, minIntervalMs: 500,
  selfTest: { type: 'username', value: 'Jimbo Wales' },
  async run(e, ctx) {
    const r = await getJson<any>(ctx, `https://en.wikipedia.org/w/api.php?action=query&list=usercontribs&ucuser=${encodeURIComponent(e.value)}&uclimit=500&ucprop=timestamp&format=json&origin=*`);
    const rows = arr<any>(r?.query?.usercontribs);
    return activityClaim(`https://en.wikipedia.org/wiki/User:${encodeURIComponent(e.value.replace(/ /g, '_'))}`, 'Wikipedia', e.value, rows.map((x) => stamp(x.timestamp)));
  },
});

export const activityAdapters = [githubActivity, hackernewsActivity, blueskyActivity, wikipediaActivity];
