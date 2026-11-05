import type { EntityType, Finding, GraphNode } from './types';
import { keyFor, nameSimilarity, foldName } from './normalize';
import { parseHandle, rarityBits } from './forensics/username';

/**
 * Known facts. When you tell Plexus "this email is theirs" and "they use this username", every new finding can be checked against
 * both at once: does this account list that email, is its handle the same name, does it carry the phone number? Each match is
 * independent evidence (two matches support each other), each carries a plain sentence saying exactly what matched where, and a
 * different name counts against. The same matcher decides which dots to join on the graph when a finding is accepted.
 */
export interface Anchor { id: string; type: EntityType; value: string; key: string; attrs?: Record<string, unknown> }
export type HitKind = 'email' | 'phone' | 'handle' | 'display-name' | 'same-account' | 'name' | 'org' | 'domain' | 'place' | 'wallet' | 'link' | 'different-name';
export interface Hit { anchorId: string; kind: HitKind; weight: number; how: string; saw: string }
export interface AnchorHits { anchorId: string; hits: Hit[]; weight: number; how: string; saw: string; against: boolean }

/** What can be read off a finding (or a node and what backs it): text, handles, links, and contact details found on the same page. */
export interface Facts {
  type: EntityType; value: string; key: string;
  platform?: string; handles: { value: string; role: 'handle' | 'display-name' | 'link' }[];
  texts: { label: string; value: string }[]; urls: string[];
  contacts: { type: EntityType; value: string; key: string; where: string }[];
}

const BIO = /bio|about|description|summary|note|status|tagline|headline|comment/i;
const NAMEY = /^(name|real name|display name|full name|nickname|gamertag|username|handle|custom url|channel name|persona)$/i;
const handleLike = (s: string) => /^[A-Za-z0-9._-]{3,40}$/.test(s) && /[A-Za-z]/.test(s);
const lastSegment = (u: string) => { try { const p = new URL(u).pathname.split('/').filter(Boolean); const s = p[p.length - 1]?.replace(/^@/, '').replace(/^~/, ''); return s && handleLike(s) && !/^(profile|user|users|in|id|u|channel|c)$/i.test(s) ? s : ''; } catch { return ''; } };

export function factsOf(f: Pick<Finding, 'type' | 'value' | 'key' | 'attrs' | 'evidence'>, siblings: Pick<Finding, 'type' | 'value' | 'key' | 'evidence'>[] = []): Facts {
  const attrs = f.attrs ?? {};
  const out: Facts = { type: f.type, value: f.value, key: f.key, platform: typeof attrs.platform === 'string' ? attrs.platform : undefined, handles: [], texts: [], urls: [], contacts: [] };
  const addHandle = (v: unknown, role: Facts['handles'][number]['role']) => { const s = typeof v === 'string' ? v.trim().replace(/^@/, '') : ''; if (s && !out.handles.some((h) => h.value.toLowerCase() === s.toLowerCase() && h.role === role)) out.handles.push({ value: s, role }); };
  addHandle(attrs.handle, 'handle'); addHandle(attrs.displayName, 'display-name');
  if (f.type === 'username') addHandle(f.value, 'handle');
  if (f.type === 'account') { const seg = lastSegment(f.value); if (seg) addHandle(seg, 'link'); out.urls.push(f.value); }
  if (f.type === 'url') out.urls.push(f.value);
  out.texts.push({ label: f.type, value: f.value });
  for (const [k, v] of Object.entries(attrs)) if (typeof v === 'string' && v.length > 1 && !/^(platform|createdAt|hash|handle|displayName)$/.test(k)) out.texts.push({ label: k, value: v });
  for (const e of f.evidence ?? []) {
    if (e.url) out.urls.push(e.url);
    if (e.snippet) out.texts.push({ label: 'note', value: e.snippet });
    for (const [label, value] of e.record?.facts ?? []) {
      out.texts.push({ label, value });
      if (NAMEY.test(label)) { if (/display|real|full|^name$|nickname|persona|channel/i.test(label)) { if (handleLike(value)) addHandle(value, 'display-name'); } else addHandle(value, 'handle'); }
    }
  }
  // contact details that other findings say they found on this same page (an email in a bio, a phone number on a profile)
  const pages = new Set(out.urls.map((u) => u.replace(/[#?].*$/, '').replace(/\/$/, '')));
  for (const s of siblings) {
    if (s.key === f.key && s.type === f.type) continue;
    if (!['email', 'phone', 'username', 'person', 'wallet', 'org', 'location', 'domain'].includes(s.type)) continue;
    const there = (s.evidence ?? []).find((e) => e.url && pages.has(e.url.replace(/[#?].*$/, '').replace(/\/$/, '')));
    if (there) out.contacts.push({ type: s.type, value: s.value, key: s.key, where: there.adapterName });
  }
  return out;
}

const digits = (s: string) => s.replace(/\D/g, '');
/** A label from a record, as a word that reads right in "its ___ shows …". Odd or internal labels become "page". */
const labelWord = (l: string) => (BIO.test(l) ? 'bio' : /^(name|real name|display name|username|handle|location|country|city|company|website|email|phone|description)$/i.test(l.trim()) ? l.trim().toLowerCase() : 'page');
const weightOfBits = (bits: number) => 0.85 * (1 - Math.pow(2, -Math.max(0, bits) / 2.5));
/**
 * How strongly does "these two handles match" point at one person? A long, odd handle is unlikely to be chosen twice by chance; a short
 * or ordinary one ("john") is chosen by thousands. The raw text decides identical vs look-alike: "maralinden_" is not "maralinden".
 */
function handleMatch(known: string, other: string): { kind: 'identical' | 'same-core'; weight: number } | null {
  const A = parseHandle(known), B = parseHandle(other);
  if (!A.core || !B.core || A.core !== B.core) return null;
  const exact = known.trim().replace(/^@/, '').toLowerCase() === other.trim().replace(/^@/, '').toLowerCase();
  const eff = Math.min(9, rarityBits(A.core) / 3) * (A.core.length <= 5 ? 0.6 : 1);
  return { kind: exact ? 'identical' : 'same-core', weight: weightOfBits(eff) * (exact ? 1 : 0.6) };
}
const quote = (s: string) => `“${s.length > 70 ? s.slice(0, 67) + '…' : s}”`;
const anchorHandle = (a: Anchor): string => a.type === 'account' ? lastSegment(a.value) : a.type === 'username' ? a.value.replace(/^@/, '') : '';

export function matchAnchors(f: Facts, anchors: Anchor[]): AnchorHits[] {
  const res: AnchorHits[] = [];
  for (const a of anchors) {
    if (a.type === f.type && a.key === f.key) continue;                       // the thing itself
    const hits: Hit[] = [];
    const add = (kind: HitKind, weight: number, how: string, saw: string) => { if (weight > 0.04) hits.push({ anchorId: a.id, kind, weight: Math.min(0.97, weight), how, saw }); };

    if (a.type === 'email') {
      const c = f.contacts.find((x) => x.type === 'email' && x.key === a.key);
      if (c) add('email', 0.95, `${f.platform ? `its ${f.platform} page` : 'its page'} lists ${a.value}`, `${c.where} found ${a.value} on the same page`);
      else {
        const t = f.texts.find((x) => x.value.toLowerCase().includes(a.key));
        if (t) add('email', 0.95, `its ${labelWord(t.label)} shows ${a.value}`, `${t.label}: ${quote(t.value)}`);
      }
      const local = a.key.split('@')[0];
      if (!hits.length && local.length >= 4) for (const h of f.handles) { const m = h.value.toLowerCase() === local ? handleMatch(local, h.value) : null; if (m) { add('handle', m.weight * 0.8, `its ${h.role === 'display-name' ? 'display name' : 'handle'} is the same as the part of ${a.value} before the @`, `${h.value}`); break; } }
    }
    if (a.type === 'phone') {
      const d = digits(a.key), tail = d.slice(-10);
      const c = f.contacts.find((x) => x.type === 'phone' && x.key === a.key);
      if (c) add('phone', 0.93, `its page lists ${a.value}`, `${c.where} found this number on the same page`);
      else if (tail.length >= 8) { const t = f.texts.find((x) => digits(x.value).includes(tail)); if (t) add('phone', 0.9, `its ${labelWord(t.label)} shows ${a.value}`, `${t.label}: ${quote(t.value)}`); }
    }
    if (a.type === 'wallet') { const t = f.texts.find((x) => x.value.includes(a.value)) ; if (t) add('wallet', 0.92, `it shows the wallet ${a.value.slice(0, 10)}…`, `${t.label}: ${quote(t.value)}`); }
    if (a.type === 'domain') {
      const mail = f.contacts.find((x) => x.type === 'email' && x.key.endsWith(`@${a.key}`));
      const url = f.urls.find((u) => { try { return new URL(u).hostname.replace(/^www\./, '') === a.key; } catch { return false; } });
      if (mail) add('domain', 0.5, `it lists an email at ${a.value}`, mail.value); else if (url && f.type !== 'domain') add('domain', 0.45, `it links to ${a.value}`, url);
    }
    if (a.type === 'account' || a.type === 'url') {
      const same = f.urls.some((u) => keyFor('account', u) === a.key);
      if (same && !(a.type === f.type && a.key === f.key)) add('link', 0.8, `it links to ${a.value}`, a.value);
      if (a.type === 'account' && f.type === 'account') { const ah = anchorHandle(a), ap = String(a.attrs?.platform ?? '').toLowerCase(); const fh = f.handles.find((h) => h.role !== 'display-name'); if (ah && fh && ap && ap === (f.platform ?? '').toLowerCase() && fh.value.toLowerCase() === ah.toLowerCase()) add('same-account', 0.97, `it is the same ${f.platform} account you told Plexus about`, `@${fh.value}`); }
    }
    const ah = anchorHandle(a);
    if (ah && (a.type === 'username' || a.type === 'account')) {
      for (const h of f.handles) {
        if (a.type === 'account' && f.type === 'account' && hits.some((x) => x.kind === 'same-account')) break;
        const m = handleMatch(ah, h.value);
        if (!m) continue;
        const w = m.weight * (h.role === 'display-name' ? 0.85 : h.role === 'link' ? 0.9 : 1);
        add(h.role === 'display-name' ? 'display-name' : 'handle', w, `its ${h.role === 'display-name' ? 'display name' : f.platform ? `${f.platform} handle` : 'handle'} ${m.kind === 'identical' ? 'is' : 'is nearly'} ${quote(ah)}, the username you told Plexus about`, `${h.role === 'display-name' ? 'Display name' : 'Handle'}: ${h.value}`);
        break;
      }
      if (!hits.length) { const t = f.texts.find((x) => BIO.test(x.label) && new RegExp(`(^|[^a-z0-9])@?${ah.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(x.value)); if (t) add('handle', 0.5, `its ${labelWord(t.label)} mentions ${quote(ah)}`, `${t.label}: ${quote(t.value)}`); }
    }
    if (a.type === 'person' || a.type === 'org') {
      const pool = [...(f.type === a.type ? [{ label: 'name', value: f.value }] : []), ...f.texts.filter((x) => /name|org|company|employer|organisation|organization|clan/i.test(x.label)), ...f.contacts.filter((x) => x.type === a.type).map((x) => ({ label: 'name', value: x.value }))];
      const best = pool.map((p) => ({ p, sim: nameSimilarity(p.value, a.value) })).sort((x, y) => y.sim - x.sim)[0];
      const multi = foldName(a.value).split(' ').length >= 2;
      if (best && best.sim >= 0.9 && (a.type === 'org' || multi)) add(a.type === 'org' ? 'org' : 'name', a.type === 'org' ? 0.45 : 0.4, `it carries the ${a.type === 'org' ? 'organisation' : 'name'} ${quote(a.value)}`, `${best.p.label}: ${quote(best.p.value)}`);
      else if (a.type === 'person' && multi && f.type === 'person' && best && best.sim < 0.6 && foldName(f.value).split(' ').length >= 2 && !foldName(f.value).split(' ').some((t) => t.length > 2 && foldName(a.value).split(' ').includes(t))) add('different-name', 0.3, `it is under a different name (${quote(f.value)}) than the person you told Plexus about`, f.value);
    }
    if (a.type === 'location') {
      const pool = [...(f.type === 'location' ? [{ label: 'location', value: f.value }] : []), ...f.texts.filter((x) => /location|city|country|region|place/i.test(x.label))];
      const best = pool.map((p) => ({ p, sim: nameSimilarity(p.value, a.value) })).sort((x, y) => y.sim - x.sim)[0];
      if (best && best.sim >= 0.88) add('place', 0.3, `it puts them in ${quote(a.value)} too`, `${best.p.label}: ${quote(best.p.value)}`);
    }
    if (!hits.length) continue;
    const against = hits.filter((h) => h.kind === 'different-name'), pro = hits.filter((h) => h.kind !== 'different-name');
    if (against.length && !pro.length) { res.push({ anchorId: a.id, hits: against, weight: against[0].weight, how: against[0].how, saw: against[0].saw, against: true }); continue; }
    const weight = 1 - pro.reduce((m, h) => m * (1 - h.weight), 1);          // several kinds of match against the same fact reinforce each other
    pro.sort((x, y) => y.weight - x.weight);
    res.push({ anchorId: a.id, hits: pro, weight: Math.min(0.97, weight), how: pro.map((h) => h.how).join('; and '), saw: pro[0].saw, against: false });
  }
  return res;
}

export const anchorOf = (n: Pick<GraphNode, 'id' | 'type' | 'value' | 'attrs'>): Anchor => ({ id: n.id, type: n.type, value: n.value, key: keyFor(n.type, n.value, n.attrs), attrs: n.attrs });
export const isKnown = (n: Pick<GraphNode, 'attrs'>) => n.attrs?.known === true;

/** A few words for the line on the graph, from what matched. */
export const SHORT: Record<HitKind, string> = { email: 'lists this email', phone: 'lists this phone', handle: 'same handle', 'display-name': 'display name matches', 'same-account': 'same account', name: 'same name', org: 'same organisation', domain: 'uses this domain', place: 'same place', wallet: 'shows this wallet', link: 'links to this', 'different-name': 'different name' };
export const shortLabel = (h: AnchorHits) => SHORT[h.hits[0]?.kind ?? 'handle'];
