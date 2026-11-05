import type { Claim, EntityType, EvidenceRecord } from '../../shared/types';
import { displayFor, keyFor, labelFor } from '../../shared/normalize';
import type { Adapter } from './types';

/**
 * Offline demo world. Everyone here is fictional: .example domains, TEST-NET IPs, 555-01xx numbers.
 * It is deliberately noisy (stale data, a namesake, conflicting cities, single-source claims) so the
 * scoring, conflict handling and review flow have something real to chew on.
 */

type SrcId = 'reg' | 'social' | 'code' | 'breach' | 'archive' | 'broker';
interface Ref { type: EntityType; value: string; attrs?: Record<string, string | number | boolean> }
interface Link {
  a: Ref; b: Ref; rel: string; back: string;
  src: Partial<Record<SrcId, number>>;
  snippet?: string; url?: string; when?: string; conflict?: string;
}

const R = (type: EntityType, value: string, attrs?: Ref['attrs']): Ref => ({ type, value, attrs });

function avatar(name: string, hue: number): string {
  const ini = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue},30%,38%)'/><stop offset='1' stop-color='hsl(${(hue + 40) % 360},34%,22%)'/></linearGradient></defs><rect width='128' height='128' fill='url(#g)'/><text x='64' y='78' font-family='-apple-system,Helvetica,Arial' font-size='46' font-weight='600' fill='white' fill-opacity='.92' text-anchor='middle'>${ini}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const mara = R('person', 'Mara Linden');
const emailWork = R('email', 'mara.linden@northwind-labs.example');
const emailPers = R('email', 'mlinden.design@mailbox.example');
const emailSide = R('email', 'mara@lindenmade.example');
const phoneOld = R('phone', '+14155550142');
const phoneNew = R('phone', '+15125550178');
const uMain = R('username', 'maralinden');
const uReddit = R('username', 'mlinden');
const uHn = R('username', 'marabuilds');
const gh = R('account', 'https://github.com/maralinden', { platform: 'GitHub' });
const dribbble = R('account', 'https://dribbble.com/maralinden', { platform: 'Dribbble' });
const bsky = R('account', 'https://bsky.app/profile/maralinden.bsky.social', { platform: 'Bluesky' });
const linkedin = R('account', 'https://www.linkedin.com/in/mara-linden-design', { platform: 'LinkedIn' });
const hn = R('account', 'https://news.ycombinator.com/user?id=marabuilds', { platform: 'Hacker News' });
const reddit = R('account', 'https://www.reddit.com/user/mlinden', { platform: 'Reddit' });
const nw = R('org', 'Northwind Labs');
const bf = R('org', 'Brightfield Studio');
const lm = R('org', 'Linden Made LLC');
const austin = R('location', 'Austin, TX');
const sf = R('location', 'San Francisco, CA');
const lisbon = R('location', 'Lisbon, Portugal');
const dallas = R('location', 'Dallas, TX');
const theo = R('person', 'Theo Ashby');
const priya = R('person', 'Priya Nair');
const namesake = R('person', 'Mara Lindqvist');
const nwDom = R('domain', 'northwind-labs.example');
const lmDom = R('domain', 'lindenmade.example');
const bfDom = R('domain', 'brightfield.example');
const nwIp = R('ip', '203.0.113.17');
const lmIp = R('ip', '198.51.100.44');
const host = R('org', 'Harborline Cloud');
const registrar = R('org', 'Example Registrar, Inc.');
const img = R('image', avatar('Mara Linden', 205), { hash: 'demo-avatar-mara' });
const wallet = R('wallet', 'bc1qdemo0example0only0mara0linden0xk7p2');
const b1 = R('breach', 'ExampleForum (2019)', { date: '2019-06', classes: 'Emails, Usernames, Password hashes', count: 1_284_000 });
const b2 = R('breach', 'PhotoShare (2021)', { date: '2021-02', classes: 'Emails, Names, IP addresses', count: 312_000 });

const LINKS: Link[] = [
  // identity
  { a: mara, b: emailWork, rel: 'work email', back: 'belongs to', src: { reg: 0.85, code: 0.85, breach: 0.5, social: 0.6 }, snippet: '214 public commits' },
  { a: mara, b: emailPers, rel: 'personal email', back: 'belongs to', src: { breach: 0.7, code: 0.55, broker: 0.5 }, snippet: 'Listed in breach record alongside username "mlinden"' },
  { a: mara, b: emailSide, rel: 'side-project email', back: 'belongs to', src: { reg: 0.8, social: 0.6 }, snippet: 'WHOIS registrant contact for lindenmade.example', when: '2020-09-02' },
  { a: mara, b: phoneNew, rel: 'phone', back: 'belongs to', src: { broker: 0.6, social: 0.5 }, snippet: 'Austin area code 512, reported by 2 aggregators' },
  { a: mara, b: phoneOld, rel: 'former phone', back: 'belonged to', src: { broker: 0.55, breach: 0.65, archive: 0.4 }, snippet: 'San Francisco area code 415, last seen 2019', when: '2019-04-01' },
  { a: mara, b: uMain, rel: 'username', back: 'used by', src: { code: 0.9, social: 0.85, archive: 0.5 } },
  { a: mara, b: uReddit, rel: 'username', back: 'used by', src: { social: 0.5, breach: 0.55 }, snippet: 'Same display name and city on profile' },
  { a: mara, b: uHn, rel: 'username', back: 'used by', src: { social: 0.5, code: 0.55 }, snippet: 'Bio links to maralinden GitHub' },
  { a: mara, b: img, rel: 'profile photo', back: 'photo of', src: { code: 0.9, social: 0.85 } },
  { a: uReddit, b: namesake, rel: 'name on profile', back: 'username of', src: { social: 0.65 }, snippet: 'Profile bio: photographer in Stockholm' },
  { a: mara, b: namesake, rel: 'possible namesake', back: 'possible namesake', src: { broker: 0.3 }, snippet: 'Name match only. Different city, different profession' },
  { a: mara, b: R('person', 'Mara L. Linden'), rel: 'also known as', back: 'also known as', src: { social: 0.7, code: 0.6 } },

  // first hop from the work email: what a good lookup would surface straight away
  { a: emailWork, b: uMain, rel: 'username', back: 'email of', src: { code: 0.8, social: 0.5 }, snippet: 'Same person committing as maralinden' },
  { a: emailWork, b: img, rel: 'avatar', back: 'avatar for', src: { code: 0.8, social: 0.6 }, snippet: 'Linked avatar hash' },
  { a: emailWork, b: gh, rel: 'profile', back: 'email of', src: { code: 0.75 }, snippet: 'Public email on profile' },
  { a: emailWork, b: nw, rel: 'employer', back: 'staff email', src: { reg: 0.7, broker: 0.5 }, snippet: 'Mailbox on the company domain' },
  { a: emailWork, b: austin, rel: 'likely location', back: 'seen here', src: { broker: 0.45 }, snippet: 'Email activity near Austin', conflict: 'location' },
  { a: emailWork, b: linkedin, rel: 'profile', back: 'email of', src: { broker: 0.55, social: 0.5 } },
  { a: emailWork, b: R('person', 'Mara L. Linden'), rel: 'appears as', back: 'email of', src: { social: 0.6, code: 0.55 } },

  // from the main username
  { a: uMain, b: emailWork, rel: 'email', back: 'username', src: { code: 0.8 }, snippet: 'Commit author email' },
  { a: uMain, b: emailPers, rel: 'possible email', back: 'username', src: { broker: 0.45 } },
  { a: uMain, b: img, rel: 'avatar', back: 'avatar for', src: { code: 0.85, social: 0.8 } },
  { a: uMain, b: austin, rel: 'location on profile', back: 'seen here', src: { code: 0.55, social: 0.6 }, conflict: 'location' },
  { a: uMain, b: nw, rel: 'company on profile', back: 'staff handle', src: { code: 0.55, social: 0.6 } },
  { a: uMain, b: uHn, rel: 'similar handle', back: 'similar handle', src: { social: 0.3 }, snippet: 'Cross-links in bio' },

  // accounts (each also hangs off the username)
  { a: uMain, b: gh, rel: 'profile', back: 'handle', src: { code: 0.9 }, url: 'https://github.com/maralinden', snippet: 'GitHub user · 38 repos · joined 2014' , when: '2014-05-19' },
  { a: mara, b: gh, rel: 'account', back: 'owner', src: { code: 0.85, social: 0.6 } },
  { a: uMain, b: dribbble, rel: 'profile', back: 'handle', src: { social: 0.8 }, url: 'https://dribbble.com/maralinden', snippet: 'Dribbble designer profile · Austin, TX', when: '2016-02-08' },
  { a: mara, b: dribbble, rel: 'account', back: 'owner', src: { social: 0.75 } },
  { a: uMain, b: bsky, rel: 'profile', back: 'handle', src: { social: 0.85 }, url: 'https://bsky.app/profile/maralinden.bsky.social', when: '2023-04-11' },
  { a: mara, b: bsky, rel: 'account', back: 'owner', src: { social: 0.8 } },
  { a: mara, b: linkedin, rel: 'account', back: 'owner', src: { broker: 0.6, social: 0.7 }, snippet: 'Head of Design at Northwind Labs' },
  { a: uHn, b: hn, rel: 'profile', back: 'handle', src: { social: 0.6, code: 0.55 }, when: '2018-11-30' },
  { a: mara, b: hn, rel: 'account', back: 'owner', src: { code: 0.5 } },
  { a: uReddit, b: reddit, rel: 'profile', back: 'handle', src: { social: 0.5 } },

  // employment
  { a: mara, b: nw, rel: 'works at', back: 'employee', src: { reg: 0.75, social: 0.75, broker: 0.6, code: 0.5 }, snippet: 'Head of Design since 2021', when: '2021-03-01' },
  { a: mara, b: bf, rel: 'previously at', back: 'former employee', src: { social: 0.55, broker: 0.5, archive: 0.4 }, snippet: 'Senior Designer 2016–2020', when: '2016-06-01' },
  { a: mara, b: lm, rel: 'founder of', back: 'founder', src: { reg: 0.85, broker: 0.5 }, snippet: 'Registered agent and sole member', when: '2020-09-14' },
  { a: nw, b: nwDom, rel: 'website', back: 'owned by', src: { reg: 0.95, social: 0.8 } },
  { a: lm, b: lmDom, rel: 'website', back: 'owned by', src: { reg: 0.85, social: 0.55 } },
  { a: bf, b: bfDom, rel: 'website', back: 'owned by', src: { reg: 0.8, archive: 0.6 } },
  { a: nw, b: austin, rel: 'headquarters', back: 'headquarters of', src: { reg: 0.9, social: 0.7 }, conflict: 'hq' },
  { a: lm, b: austin, rel: 'registered address', back: 'registered address of', src: { reg: 0.85 }, conflict: 'hq' },
  { a: nw, b: theo, rel: 'officer', back: 'officer of', src: { reg: 0.9, social: 0.6 }, snippet: 'Co-founder and CEO' },
  { a: nw, b: priya, rel: 'employee', back: 'works at', src: { social: 0.6, broker: 0.45 } },
  { a: mara, b: theo, rel: 'co-worker', back: 'co-worker', src: { reg: 0.5, social: 0.65 }, snippet: 'Appear together on company filings and team page' },
  { a: mara, b: priya, rel: 'colleague', back: 'colleague', src: { social: 0.6 } },

  // places (deliberate conflict)
  { a: mara, b: austin, rel: 'based in', back: 'resident', src: { social: 0.65, broker: 0.6, code: 0.55 }, conflict: 'location' },
  { a: mara, b: sf, rel: 'based in', back: 'resident', src: { broker: 0.5, archive: 0.45 }, snippet: 'Older records (2016–2019)', conflict: 'location' },
  { a: mara, b: lisbon, rel: 'based in', back: 'resident', src: { social: 0.25 }, snippet: 'One travel post, likely a visit', conflict: 'location' },

  // infrastructure
  { a: nwDom, b: R('domain', 'www.northwind-labs.example'), rel: 'subdomain', back: 'subdomain of', src: { reg: 0.85, archive: 0.6 }, when: '2021-01-12' },
  { a: nwDom, b: R('domain', 'staging.northwind-labs.example'), rel: 'subdomain', back: 'subdomain of', src: { reg: 0.85 }, snippet: 'Certificate transparency log entry', when: '2022-07-03' },
  { a: nwDom, b: R('domain', 'api.northwind-labs.example'), rel: 'subdomain', back: 'subdomain of', src: { reg: 0.85, archive: 0.5 }, when: '2021-06-21' },
  { a: nwDom, b: R('domain', 'mail.northwind-labs.example'), rel: 'subdomain', back: 'subdomain of', src: { reg: 0.85 } },
  { a: nwDom, b: nwIp, rel: 'resolves to', back: 'hosts', src: { reg: 0.95 } },
  { a: nwDom, b: registrar, rel: 'registrar', back: 'registrar of', src: { reg: 0.92 }, snippet: 'Registered 2018-03-12 · expires 2027-03-12', when: '2018-03-12' },
  { a: nwDom, b: R('url', 'https://northwind-labs.example/team'), rel: 'archived page', back: 'page on', src: { archive: 0.8 }, snippet: '41 captures since 2021', when: '2021-04-09' },
  { a: nwDom, b: R('url', 'https://northwind-labs.example/about'), rel: 'archived page', back: 'page on', src: { archive: 0.8 }, when: '2019-08-22' },
  { a: lmDom, b: lmIp, rel: 'resolves to', back: 'hosts', src: { reg: 0.95 } },
  { a: lmDom, b: R('domain', 'shop.lindenmade.example'), rel: 'subdomain', back: 'subdomain of', src: { reg: 0.85 }, when: '2022-11-05' },
  { a: lmDom, b: registrar, rel: 'registrar', back: 'registrar of', src: { reg: 0.9 }, when: '2020-09-02' },
  { a: lmDom, b: mara, rel: 'registrant', back: 'registrant of', src: { reg: 0.8 }, snippet: 'Registrant name and email unredacted', when: '2020-09-02' },
  { a: nwIp, b: host, rel: 'network owner', back: 'operates', src: { reg: 0.9 } },
  { a: nwIp, b: dallas, rel: 'geolocated to', back: 'hosts', src: { reg: 0.5, broker: 0.4 }, snippet: 'IP geolocation is approximate' },
  { a: lmIp, b: host, rel: 'network owner', back: 'operates', src: { reg: 0.9 } },
  { a: nwIp, b: nwDom, rel: 'hosts', back: 'resolves to', src: { archive: 0.7 }, snippet: 'Passive DNS' },

  // leaks & money
  { a: emailPers, b: b1, rel: 'appeared in', back: 'exposed', src: { breach: 0.9 } },
  { a: uReddit, b: b1, rel: 'appeared in', back: 'exposed', src: { breach: 0.8 } },
  { a: emailWork, b: b2, rel: 'appeared in', back: 'exposed', src: { breach: 0.85 } },
  { a: mara, b: wallet, rel: 'payment address', back: 'belongs to', src: { archive: 0.5, social: 0.5 }, snippet: 'Posted as a tip-jar address on personal site' },
];

const SOURCES: Record<SrcId, { id: string; name: string; about: string; family: string; reliability: number; delay: [number, number] }> = {
  reg: { id: 'demo-registry', name: 'Business & domain registry', about: 'Official company filings and domain registration records.', family: 'demo-reg', reliability: 0.9, delay: [350, 900] },
  social: { id: 'demo-social', name: 'Social profiles', about: 'Public profile pages on social and professional networks.', family: 'demo-social', reliability: 0.78, delay: [600, 1500] },
  code: { id: 'demo-code', name: 'Code platforms', about: 'Public activity on code-hosting sites: commits, repositories and profiles.', family: 'demo-code', reliability: 0.85, delay: [450, 1100] },
  breach: { id: 'demo-breach', name: 'Breach database', about: 'Records from data breaches. Shows where an identifier was leaked, never passwords.', family: 'demo-breach', reliability: 0.82, delay: [900, 1700] },
  archive: { id: 'demo-archive', name: 'Web archive', about: 'Old copies of web pages and historical DNS records.', family: 'demo-archive', reliability: 0.7, delay: [1100, 2200] },
  broker: { id: 'demo-broker', name: 'Data aggregators', about: 'Commercial people-data brokers. Wide coverage, but often out of date.', family: 'demo-broker', reliability: 0.55, delay: [1300, 2400] },
};

/** What each kind of source would actually return: a record-shaped excerpt, not a sentence about it. */
function excerpt(src: SrcId, A: Ref, B: Ref, rel: string): string {
  const a = lbl(A), b = lbl(B);
  const t = B.type, at = A.type;
  switch (src) {
    case 'reg':
      if (t === 'org' && /registrar/.test(rel)) return `Registrar: ${b}`;
      if (/registrant/.test(rel) || (at === 'domain' && t === 'person')) return `Registrant name: ${b}`;
      if (t === 'ip') return `DNS A record: ${a} → ${b}`;
      if (t === 'domain' && /subdomain/.test(rel)) return `TLS certificate lists the name ${b}`;
      if (t === 'org') return `Company filing lists ${b}`;
      if (t === 'person') return `Officers / contacts listed: ${b}`;
      if (t === 'location') return `Registered address: ${b}`;
      if (t === 'email') return `Contact email on file: ${b}`;
      return `Record for ${a} lists “${b}”`;
    case 'code':
      if (at === 'email' && t === 'person') return `Commit author “${b}” <${a}>`;
      if (t === 'email') return `Commit author email ${b} on commits by ${a}`;
      if (t === 'account') return `Profile page ${b} lists ${a}`;
      if (t === 'image') return `Avatar image attached to the profile for ${a}`;
      return `Repository metadata and profile bios mention both ${a} and ${b}`;
    case 'social':
      if (t === 'account') return `Public profile found: ${b}`;
      if (t === 'person') return `Profile name field: “${b}”`;
      if (t === 'org') return `Profile “works at” field: “${b}”`;
      if (t === 'location') return `Profile location field: “${b}”`;
      if (t === 'image') return `Profile photo shown next to ${a}`;
      if (t === 'email' || t === 'phone') return `Contact field on the profile: ${b}`;
      return `Profile page shows ${a} together with ${b}`;
    case 'breach':
      return t === 'breach' ? `Appears in the breach “${b}”` : `Leaked record contains ${a} and ${b} in the same row`;
    case 'archive':
      if (t === 'url') return `Saved copy of ${b}`;
      if (t === 'ip') return `Old DNS record: ${a} → ${b}`;
      if (t === 'domain') return `Saved web pages exist under ${b}`;
      return `Saved web page shows ${a} next to ${b}`;
    case 'broker':
      return `Aggregator profile: ${a} ↔ ${b} · last updated 2019 (often out of date)`;
  }
}

/** Link-level detail ("214 public commits") belongs to the one source that could have seen it, not to all of them. */
function detailOwner(l: Link): SrcId {
  const t = l.snippet ?? '';
  const has = (k: SrcId) => l.src[k] !== undefined;
  const pick = (re: RegExp, k: SrcId) => (re.test(t) && has(k) ? k : null);
  return pick(/commit|repo|GitHub|public email on profile/i, 'code') ?? pick(/breach|exposed|leak/i, 'breach') ?? pick(/WHOIS|registrant|registered|filings|agent|officer|certificate|registrar|dns/i, 'reg')
    ?? pick(/archive|capture|passive|older records|last seen/i, 'archive') ?? pick(/aggregator|reported by/i, 'broker') ?? pick(/profile|bio|post|travel|display name|cross-link|team page|title|designer/i, 'social')
    ?? (Object.keys(l.src) as SrcId[]).sort((x, y) => (l.src[y] ?? 0) - (l.src[x] ?? 0))[0];
}
const lbl = (r: Ref) => (r.type === 'phone' || r.type === 'email' ? displayFor(r.type, r.value) : labelFor(r.type, r.value, r.attrs));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAST = process.env.PLEXUS_DEMO_FAST === '1';
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

const same = (r: Ref, type: EntityType, key: string) => r.type === type && keyFor(r.type, r.value, r.attrs) === key;

const RECORD_TITLE: Record<SrcId, string> = { reg: 'Registry record', social: 'Public profile', code: 'Commit & profile data', breach: 'Breach record', archive: 'Saved web page', broker: 'Aggregator profile' };
function recordFor(src: SrcId, A: Ref, B: Ref, rel: string, link: Link, detail: string): EvidenceRecord {
  const facts: [string, string][] = [['Looked up', lbl(A)], ['Contains', lbl(B)], ['Relationship', rel]];
  if (link.when) facts.push(['Date', link.when]);
  if (detail) facts.push(['Detail', detail.replace(/^ · /, '')]);
  if (src === 'broker') facts.push(['Last updated', '2019 (may be out of date)']);
  if (src === 'breach' && B.type === 'breach' && B.attrs) facts.push(['Exposed data', String(B.attrs.classes ?? '')], ['Accounts affected', Number(B.attrs.count ?? 0).toLocaleString('en-US')]);
  return { title: RECORD_TITLE[src], facts: facts.filter(([, v]) => v) };
}

function claimFor(ref: Ref, rel: string, link: Link, w: number, src: SrcId, lookedUp: Ref): Claim {
  const attrs = { ...(ref.attrs ?? {}) };
  const note = excerpt(src, lookedUp, ref, rel);
  // Extra detail from the link ("214 public commits") is shown only on the source that could have seen it, and only if it adds something.
  const words = (link.snippet ?? '').toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  const novel = words.filter((w) => !note.toLowerCase().includes(w)).length > words.length * 0.4;
  const detail = detailOwner(link) === src && link.snippet && novel ? ` · ${link.snippet.replace(/\.$/, '')}` : '';
  return {
    type: ref.type, value: ref.value, relation: rel, weight: w, url: link.url, snippet: note + detail, attrs, record: recordFor(src, lookedUp, ref, rel, link, detail),
    conflictKey: link.conflict === 'hq' ? undefined : link.conflict, when: link.when,
  };
}

function generic(type: EntityType, value: string, key: string, src: SrcId): Claim[] {
  // Unknown inputs still behave plausibly: tiny, deterministic, clearly low-confidence.
  const h = hash(key);
  const out: Claim[] = [];
  if (type === 'email' && (src === 'social' || src === 'code')) {
    const u = value.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (u.length > 2) out.push({ type: 'username', value: u, relation: 'username', weight: 0.4, snippet: 'Same handle as the email local part' });
  }
  if (type === 'email' && src === 'breach' && h % 3 === 0)
    out.push({ type: 'breach', value: 'ExampleForum (2019)', relation: 'appeared in', weight: 0.8, attrs: { date: '2019-06', classes: 'Emails, Usernames', count: 1_284_000 } });
  if (type === 'username' && src === 'social' && h % 2 === 0)
    out.push({ type: 'account', value: `https://dribbble.com/${value}`, relation: 'profile', weight: 0.45, attrs: { platform: 'Dribbble' } });
  if (type === 'person' && src === 'broker')
    out.push({ type: 'location', value: ['Denver, CO', 'Columbus, OH', 'Portland, OR'][h % 3], relation: 'based in', weight: 0.35, conflictKey: 'location' });
  return out;
}

function make(src: SrcId): Adapter {
  const s = SOURCES[src];
  return {
    id: s.id, name: s.name, description: `${s.about} (Simulated, fictional data.)`,
    accepts: ['person', 'email', 'phone', 'username', 'domain', 'ip', 'url', 'org', 'location', 'account', 'wallet'],
    capability: 'demo', family: s.family, reliability: s.reliability, priority: 1, demo: true, selfTest: { type: 'email', value: 'mara.linden@northwind-labs.example' },
    async run(entity) {
      if (!FAST) await sleep(s.delay[0] + (hash(entity.key + s.id) % (s.delay[1] - s.delay[0])));
      const out: Claim[] = [];
      let hit = false;
      for (const l of LINKS) {
        const w = l.src[src];
        if (w === undefined) continue;
        if (same(l.a, entity.type, entity.key)) { hit = true; out.push(claimFor(l.b, l.rel, l, w, src, l.a)); }
        else if (same(l.b, entity.type, entity.key)) { hit = true; out.push(claimFor(l.a, l.back, l, w, src, l.b)); }
      }
      if (!hit) out.push(...generic(entity.type, entity.value, entity.key, src));
      return out;
    },
  };
}

export const demoAdapters: Adapter[] = (Object.keys(SOURCES) as SrcId[]).map(make);

/** Entities worth offering as one-click starting points in the demo. */
export const DEMO_SEEDS = [
  { type: 'email' as const, value: 'mara.linden@northwind-labs.example', label: 'Email' },
  { type: 'username' as const, value: 'maralinden', label: 'Username' },
  { type: 'domain' as const, value: 'northwind-labs.example', label: 'Domain' },
  { type: 'person' as const, value: 'Mara Linden', label: 'Name' },
];
