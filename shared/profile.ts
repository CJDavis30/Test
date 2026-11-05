import type { EntityType, Finding } from './types';
import { safeImageSrc } from './normalize';
import { keyFor } from './normalize';
import type { Anchor } from './anchors';

/**
 * A preview of an account (or person, or page) built from what the sources returned, so nobody has to open a link to see who it is:
 * picture, display name, handle, when it was created, bio, location, and any email or phone number that appears on it.
 */
export interface Contact { type: 'email' | 'phone' | 'wallet' | 'username'; value: string; known: boolean; where?: string }
export interface Profile {
  /** true when there is something worth showing beyond the bare value */
  rich: boolean;
  platform?: string; displayName?: string; handle?: string; avatar?: string; bio?: string; location?: string; org?: string;
  created?: string; createdAgo?: string; verified?: boolean; followers?: number; banned?: boolean;
  contacts: Contact[]; links: { label: string; url: string }[]; facts: [string, string][]; pageUrl?: string;
}

const L = {
  bio: /^(bio|about|description|summary|headline|tagline|status|note|about me)$/i,
  created: /(joined|created|member since|registered|account created|first seen|signed up|since)/i,
  location: /^(location|country|city|region|place|time ?zone|lives in)$/i,
  display: /^(display name|real name|full name|name|nickname|persona|channel name)$/i,
  handle: /^(username|handle|custom url|login|gamertag|user ?name|screen name)$/i,
  followers: /^(followers|subscribers|members|follower count)$/i,
  org: /^(company|employer|organi[sz]ation|clan|institution)$/i,
  verified: /^verified/i,
  link: /^(website|homepage|web|url|link|links|profile page|page)$/i,
};
const SKIP = /^(hash|createdat|platform)$/i;

export function ageText(iso: string, now = Date.now()): string {
  const t = Date.parse(iso); if (!Number.isFinite(t) || t > now + 86400000) return '';
  const days = Math.floor((now - t) / 86400000);
  if (days < 1) return 'today'; if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30.44); if (months < 24) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365.25), rest = Math.floor((days - years * 365.25) / 30.44);
  return `${years} year${years === 1 ? '' : 's'}${rest >= 1 && years < 10 ? `, ${rest} month${rest === 1 ? '' : 's'}` : ''} ago`;
}
const toIso = (v: unknown): string | undefined => { if (typeof v !== 'string' || !v.trim()) return undefined; const m = v.replace(/ UTC$/, 'Z').replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2'); const t = Date.parse(m); return Number.isFinite(t) && t > Date.UTC(1990, 0, 1) ? new Date(t).toISOString() : undefined; };

export function profileOf(f: Pick<Finding, 'type' | 'value' | 'attrs' | 'evidence' | 'key'>, siblings: Pick<Finding, 'type' | 'value' | 'key' | 'evidence' | 'attrs'>[] = [], anchors: Anchor[] = [], now = Date.now()): Profile {
  const attrs = f.attrs ?? {};
  const p: Profile = { rich: false, contacts: [], links: [], facts: [] };
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  p.platform = str(attrs.platform); p.handle = str(attrs.handle); p.displayName = str(attrs.displayName);
  if (attrs.verified === true) p.verified = true; if (attrs.banned === true) p.banned = true;
  if (typeof attrs.followers === 'number') p.followers = attrs.followers;
  const created = toIso(attrs.createdAt);
  if (created) p.created = created;
  const seenFact = new Set<string>();
  for (const e of f.evidence ?? []) {
    if (!p.pageUrl && e.url && e.urlKind !== 'lookup') p.pageUrl = e.url;
    for (const [k, v0] of e.record?.facts ?? []) {
      const v = v0?.trim(); if (!v) continue;
      if (L.bio.test(k) && !p.bio) p.bio = v;
      else if (L.created.test(k) && !p.created && toIso(v)) p.created = toIso(v);
      else if (L.location.test(k) && !p.location) p.location = v;
      else if (L.display.test(k) && !p.displayName && k.toLowerCase() !== 'name' ) p.displayName = v;
      else if (L.display.test(k) && !p.displayName) p.displayName = v;
      else if (L.handle.test(k) && !p.handle) p.handle = v;
      else if (L.followers.test(k) && p.followers === undefined && /\d/.test(v)) p.followers = Number(v.replace(/[^\d.]/g, ''));
      else if (L.org.test(k) && !p.org) p.org = v;
      else if (L.verified.test(k)) p.verified = /^(yes|true)/i.test(v);
      else if (/^banned$/i.test(k)) p.banned = /^(yes|true)/i.test(v);
      else if (L.link.test(k)) { if (/^https?:/i.test(v)) p.links.push({ label: k, url: v }); }
      else if (!SKIP.test(k) && !seenFact.has(`${k}|${v}`)) { seenFact.add(`${k}|${v}`); p.facts.push([k, v]); }
    }
  }
  if (f.type === 'person' && !p.displayName) p.displayName = f.value;
  if (f.type === 'username' && !p.handle) p.handle = f.value;
  if (p.created) p.createdAgo = ageText(p.created, now);

  // what other findings say they found on this same page
  const page = (u?: string) => (u ?? '').replace(/[#?].*$/, '').replace(/\/$/, '');
  const mine = new Set((f.evidence ?? []).map((e) => page(e.url)).filter(Boolean));
  const known = new Set(anchors.map((a) => `${a.type}|${a.key}`));
  for (const s of siblings) {
    if (s.type === f.type && s.key === f.key) continue;
    const ev = (s.evidence ?? []).find((e) => e.url && mine.has(page(e.url)));
    if (!ev) continue;
    if (s.type === 'image' && !p.avatar) { const src = safeImageSrc(s.value); if (src) p.avatar = src; }
    else if (s.type === 'email' || s.type === 'phone' || s.type === 'wallet') { if (!p.contacts.some((c) => c.value.toLowerCase() === s.value.toLowerCase())) p.contacts.push({ type: s.type, value: s.value, known: known.has(`${s.type}|${keyFor(s.type as EntityType, s.value)}`), where: ev.adapterName }); }
    else if (s.type === 'person' && !p.displayName) p.displayName = s.value;
    else if (s.type === 'location' && !p.location) p.location = s.value;
    else if (s.type === 'org' && !p.org) p.org = s.value;
    else if (s.type === 'url' && p.links.length < 6) p.links.push({ label: 'link', url: s.value });
    else if (s.type === 'account' && p.links.length < 6 && s.key !== f.key) p.links.push({ label: String((s.attrs as any)?.platform ?? 'account'), url: s.value });
  }
  if (!p.avatar && f.type === 'image') p.avatar = safeImageSrc(f.value);
  // emails and phones that sit in the bio itself
  if (p.bio) {
    for (const m of p.bio.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? []) if (!p.contacts.some((c) => c.value.toLowerCase() === m.toLowerCase())) p.contacts.push({ type: 'email', value: m, known: known.has(`email|${keyFor('email', m)}`), where: 'in the bio' });
  }
  p.links = p.links.filter((l, i, a) => a.findIndex((x) => x.url === l.url) === i).slice(0, 6);
  p.rich = !!(p.displayName || p.handle || p.bio || p.created || p.avatar || p.contacts.length || p.location || p.followers !== undefined || p.org);
  return p;
}
