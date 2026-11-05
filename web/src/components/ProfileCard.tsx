import { useMemo, useState } from 'react';
import { BadgeCheck, CalendarDays, MapPin, Users, Building2, Mail, Phone, Wallet, ExternalLink, Link2, ShieldCheck } from 'lucide-react';
import type { Finding } from '@shared/types';
import { profileOf, type Profile } from '@shared/profile';
import { anchorOf, isKnown } from '@shared/anchors';
import { safeHttpUrl } from '@shared/normalize';
import { useStore } from '../lib/store';
import { EntityGlyph } from '../lib/icons';
import { hostOf } from '../lib/format';

/** Picture, or the first letter on a colour taken from the name, so every card has a face even when no picture was found. */
export function Avatar({ src, name, size = 44, type }: { src?: string; name: string; size?: number; type?: Finding['type'] }) {
  const [bad, setBad] = useState(false);
  const initial = (name.replace(/^[@~]/, '').trim()[0] ?? '?').toUpperCase();
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  if (src && !bad) return <img className="avatar" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" onError={() => setBad(true)} style={{ width: size, height: size }} />;
  return <span className="avatar ph" style={{ width: size, height: size, background: `hsl(${h} 38% 46%)`, fontSize: size * 0.42 }} aria-hidden>{type && !/[A-Za-z0-9]/.test(initial) ? <EntityGlyph type={type} size={size * 0.45} /> : initial}</span>;
}

/** The profile for a finding, built from what its sources returned and what else was found on the same page. */
export function useProfile(f: Finding | undefined): Profile | null {
  const findings = useStore((s) => s.findings), nodes = useStore((s) => s.snap?.nodes);
  return useMemo(() => {
    if (!f) return null;
    const sibs = Object.values(findings).filter((x) => x.subjectId === f.subjectId);
    return profileOf(f, sibs, (nodes ?? []).filter(isKnown).map(anchorOf));
  }, [f, findings, nodes]);
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const CIcon = { email: Mail, phone: Phone, wallet: Wallet, username: Users } as const;

export function ProfileCard({ f, compact = false }: { f: Finding; compact?: boolean }) {
  const p = useProfile(f);
  const [more, setMore] = useState(false);
  if (!p || !p.rich) return null;
  const title = p.displayName || p.handle || f.value;
  const page = safeHttpUrl(p.pageUrl);
  const showHandle = p.handle && p.handle.toLowerCase() !== title.toLowerCase();
  return (
    <section className={`pcard ${compact ? 'compact' : ''}`} aria-label={`Preview of ${title}`}>
      <div className="pc-top">
        <Avatar src={p.avatar} name={title} size={compact ? 40 : 56} type={f.type} />
        <div className="pc-id">
          <div className="pc-name selectable truncate">{title}{p.verified && <BadgeCheck size={15} className="pc-ver" aria-label="Verified" />}</div>
          <div className="pc-sub truncate">{showHandle && <span className="selectable">@{(p.handle ?? '').replace(/^@/, '')}</span>}{p.platform && <span className="pc-plat">{p.platform}</span>}{p.banned && <span className="pc-ban">Banned</span>}</div>
        </div>
        {page && !compact && <a className="btn sm ghost pc-open" href={page} target="_blank" rel="noreferrer noopener" title={page}>Open <ExternalLink size={12} /></a>}
      </div>
      <div className="pc-facts">
        {p.created && <span className="pc-fact" title={`Account created ${new Date(p.created).toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC')}`}><CalendarDays size={13} /> Created {fmtDay(p.created)}{p.createdAgo ? <small> · {p.createdAgo}</small> : null}</span>}
        {p.location && <span className="pc-fact"><MapPin size={13} /> {p.location}</span>}
        {p.followers !== undefined && <span className="pc-fact"><Users size={13} /> {p.followers.toLocaleString('en-US')} followers</span>}
        {p.org && <span className="pc-fact"><Building2 size={13} /> {p.org}</span>}
      </div>
      {p.bio && <blockquote className="pc-bio selectable">{p.bio.length > (compact ? 140 : 320) ? `${p.bio.slice(0, compact ? 137 : 317)}…` : p.bio}</blockquote>}
      {p.contacts.length > 0 && (
        <div className="pc-contacts"><span className="pc-lab">On this account</span>
          {p.contacts.map((c) => { const I = CIcon[c.type]; return <span key={c.value} className={`pc-chip ${c.known ? 'known' : ''}`} title={c.known ? 'This is one of the things you told Plexus you know' : c.where ? `Found by ${c.where}` : undefined}><I size={12} /><span className="selectable">{c.value}</span>{c.known ? <><ShieldCheck size={12} /><small>you know this</small></> : null}</span>; })}
        </div>
      )}
      {!compact && p.links.length > 0 && <div className="pc-links">{p.links.map((l) => { const u = safeHttpUrl(l.url); return u ? <a key={l.url} className="pc-chip link" href={u} target="_blank" rel="noreferrer noopener" title={u}><Link2 size={12} />{hostOf(u)}</a> : null; })}</div>}
      {!compact && p.facts.length > 0 && (
        <div className="pc-more">
          <button className="linkish" onClick={() => setMore(!more)}>{more ? 'Hide' : 'Show'} {p.facts.length} more detail{p.facts.length === 1 ? '' : 's'}</button>
          {more && <dl className="pc-dl">{p.facts.slice(0, 12).map(([k, v]) => <div key={k + v}><dt>{k}</dt><dd className="selectable">{v}</dd></div>)}</dl>}
        </div>
      )}
    </section>
  );
}
