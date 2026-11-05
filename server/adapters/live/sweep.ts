import type { Claim } from '../../../shared/types';
import type { Adapter, AdapterCtx } from '../types';
import { adapter, rec } from './util';

interface Site { name: string; url: string; /** status: 200=exists/404=absent. absent-text: 200 always, the page says so when missing. */ kind?: 'status' | 'absent-text'; text?: string; api?: boolean }

export const SITES: Site[] = [
  { name: 'Dribbble', url: 'https://dribbble.com/{u}' },
  { name: 'Behance', url: 'https://www.behance.net/{u}' },
  { name: 'Medium', url: 'https://medium.com/@{u}' },
  { name: 'Docker Hub', url: 'https://hub.docker.com/v2/users/{u}/', api: true },
  { name: 'PyPI', url: 'https://pypi.org/user/{u}/' },
  { name: 'Codeberg', url: 'https://codeberg.org/{u}' },
  { name: 'Lichess', url: 'https://lichess.org/api/user/{u}', api: true },
  { name: 'Chess.com', url: 'https://api.chess.com/pub/player/{u}', api: true },
  { name: 'Replit', url: 'https://replit.com/@{u}' },
  { name: 'Last.fm', url: 'https://www.last.fm/user/{u}' },
  { name: 'Pastebin', url: 'https://pastebin.com/u/{u}' },
  { name: 'Steam', url: 'https://steamcommunity.com/id/{u}', kind: 'absent-text', text: 'The specified profile could not be found' },
  { name: 'SoundCloud', url: 'https://soundcloud.com/{u}' },
  { name: 'Vimeo', url: 'https://vimeo.com/{u}' },
  { name: 'About.me', url: 'https://about.me/{u}' },
  { name: 'Gravatar', url: 'https://en.gravatar.com/{u}.json', api: true },
  { name: 'Hashnode', url: 'https://hashnode.com/@{u}' },
  { name: 'Mastodon.social', url: 'https://mastodon.social/@{u}' },
  { name: 'Linktree', url: 'https://linktr.ee/{u}' },
  { name: 'Kaggle', url: 'https://www.kaggle.com/{u}' },
  { name: 'CodePen', url: 'https://codepen.io/{u}' },
  { name: 'Scratch', url: 'https://scratch.mit.edu/users/{u}/' },
];

const CONTROL = 'plx-ctrl-zq9x4k7w2m';
const controlCache = new Map<string, { ok: boolean; at: number }>();

async function exists(site: Site, user: string, ctx: AdapterCtx): Promise<boolean | null> {
  const url = site.url.replace('{u}', encodeURIComponent(user));
  const res = await ctx.fetch(url, { timeoutMs: 9000, headers: { Accept: site.api ? 'application/json' : 'text/html,*/*' } });
  if (res.status === 429 || res.status === 403 || res.status >= 500) { res.body?.cancel().catch(() => {}); return null; } // blocked or flaky: unknown, not "absent"
  if (site.kind === 'absent-text') return res.ok && !(await res.text()).includes(site.text!);
  res.body?.cancel().catch(() => {});
  return res.status === 200;
}

/** A site is only trusted if a made-up username comes back "absent". Otherwise it says 200 for everything. */
async function trusted(site: Site, ctx: AdapterCtx): Promise<boolean> {
  const c = controlCache.get(site.name);
  if (c && Date.now() - c.at < 24 * 3600_000) return c.ok;
  const e = await exists(site, CONTROL, ctx).catch(() => null);
  const ok = e === false;
  if (e !== null) controlCache.set(site.name, { ok, at: Date.now() });
  return ok;
}

export const usernameSweep = adapter({
  id: 'username-sweep', name: 'Username sweep', description: `Checks ${SITES.length} well-behaved sites for the same handle. A hit means the name is taken there, not that it is the same person.`,
  accepts: ['username'], capability: 'username-sweep', family: 'sweep', reliability: 0.6, minIntervalMs: 0, cacheTtlMs: 12 * 3600_000,
  selfTest: { type: 'username', value: 'torvalds' },
  async run(e, ctx) {
    const u = e.value.replace(/^@/, '');
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(u)) return [];
    const out: Claim[] = [];
    const queue = [...SITES];
    let blocked = 0;
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        try {
          if (!(await trusted(s, ctx))) continue;
          const hit = await exists(s, u, ctx);
          if (hit === null) { blocked++; continue; }
          if (hit) {
            const url = s.api ? s.url.replace('{u}', encodeURIComponent(u)).replace('api.chess.com/pub/player', 'www.chess.com/member').replace('lichess.org/api/user', 'lichess.org/@').replace('hub.docker.com/v2/users', 'hub.docker.com/u').replace('en.gravatar.com/', 'gravatar.com/').replace(/\.json$/, '').replace(/\/$/, '') : s.url.replace('{u}', encodeURIComponent(u));
            out.push({ type: 'account', value: url, relation: 'same handle exists', weight: 0.3, url, attrs: { platform: s.name }, snippet: `“${u}” is registered on ${s.name}. Name match only.`, record: rec(`${s.name} username check`, [['Checked page', url], ['Result', 'A profile page exists for this username'], ['Reliability check', `A made-up username returns “not found” on ${s.name}, so a hit here is real`], ['Limit', 'Only proves the username is taken, not who owns it']]) });
          }
        } catch { blocked++; }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    void blocked;
    return out;
  },
});

export const sweepAdapters: Adapter[] = [usernameSweep];
