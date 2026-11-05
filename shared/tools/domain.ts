/**
 * A domain's life story from three free public records: registration (RDAP), every certificate ever issued for it and its subdomains
 * (certificate transparency logs, via crt.sh) and when the Internet Archive first and last saw it. Together they say how old a site really is,
 * what hosts it has had, and whether it changed hands (an archive older than the registration means the name was dropped and re-bought).
 */

export interface DomainEvent { iso: string; kind: 'registered' | 'changed' | 'expires' | 'transfer' | 'cert' | 'archive-first' | 'archive-last'; text: string }
export interface DomainFacts { registrar?: string; nameservers: string[]; status: string[]; registered?: string; updated?: string; expires?: string }
export interface CertSummary { count: number; firstSeen?: string; lastSeen?: string; issuers: string[]; hosts: string[]; byYear: Record<string, number> }
export interface ArchiveSummary { captures: number; first?: string; last?: string; byYear: Record<string, number> }
export interface DomainReport { domain: string; facts: DomainFacts; certs: CertSummary; archive: ArchiveSummary; timeline: DomainEvent[]; insights: { level: 'info' | 'notice' | 'warning'; text: string }[] }

const toIso = (s: unknown): string | undefined => { if (typeof s !== 'string' && typeof s !== 'number') return undefined; const d = new Date(typeof s === 'string' && /^\d{14}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z` : String(s).includes('T') || typeof s === 'number' ? s : `${s}Z`); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); };

export function parseRdap(j: any): DomainFacts {
  const ev = (a: string) => toIso((j?.events ?? []).find((e: any) => String(e.eventAction).toLowerCase() === a)?.eventDate);
  const reg = (j?.entities ?? []).find((e: any) => (e.roles ?? []).includes('registrar'));
  const fn = (reg?.vcardArray?.[1] ?? []).find((r: any) => r[0] === 'fn')?.[3];
  return {
    registrar: typeof fn === 'string' ? fn : reg?.handle, nameservers: (j?.nameservers ?? []).map((n: any) => String(n.ldhName ?? '').toLowerCase()).filter(Boolean),
    status: (j?.status ?? []).map(String), registered: ev('registration'), updated: ev('last changed'), expires: ev('expiration'),
  };
}

export function parseCerts(rows: any, domain: string): CertSummary {
  const list = Array.isArray(rows) ? rows : [];
  const hosts = new Set<string>(), issuers = new Map<string, number>(), byYear: Record<string, number> = {};
  const times: number[] = [];
  for (const r of list) {
    for (const n of String(r.name_value ?? r.common_name ?? '').split(/\s+/)) { const h = n.toLowerCase().replace(/^\*\./, ''); if (h && (h === domain || h.endsWith('.' + domain))) hosts.add(h); }
    const issuer = /O=([^,]+)/.exec(String(r.issuer_name ?? ''))?.[1]?.replace(/"/g, '') ?? String(r.issuer_name ?? '').slice(0, 40);
    if (issuer) issuers.set(issuer, (issuers.get(issuer) ?? 0) + 1);
    const t = Date.parse(toIso(r.not_before) ?? ''); if (Number.isFinite(t)) { times.push(t); const y = new Date(t).getUTCFullYear(); byYear[y] = (byYear[y] ?? 0) + 1; }
  }
  times.sort((a, b) => a - b);
  return { count: list.length, firstSeen: times.length ? new Date(times[0]).toISOString() : undefined, lastSeen: times.length ? new Date(times[times.length - 1]).toISOString() : undefined, issuers: [...issuers.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 4), hosts: [...hosts].sort((a, b) => a.length - b.length || a.localeCompare(b)), byYear };
}

export function parseCdx(rows: any): ArchiveSummary {
  const list: string[][] = Array.isArray(rows) ? rows.filter((r: any) => Array.isArray(r) && /^\d{8,14}$/.test(String(r[0]))) : [];
  const byYear: Record<string, number> = {};
  for (const r of list) { const y = String(r[0]).slice(0, 4); byYear[y] = (byYear[y] ?? 0) + 1; }
  const ts = list.map((r) => String(r[0])).sort();
  return { captures: list.length, first: ts.length ? toIso(ts[0].padEnd(14, '0')) : undefined, last: ts.length ? toIso(ts[ts.length - 1].padEnd(14, '0')) : undefined, byYear };
}

const day = (iso: string) => iso.slice(0, 10);
const NOTABLE = /^(admin|dev|staging|stage|test|beta|vpn|mail|webmail|portal|internal|intranet|git|gitlab|jenkins|jira|login|sso|api|old|backup|db|sql|ftp|panel|cpanel|dashboard)\b/;

export function buildDomainReport(domain: string, input: { rdap?: any; certs?: any; cdx?: any }, now = Date.now()): DomainReport {
  const facts = parseRdap(input.rdap), certs = parseCerts(input.certs, domain), archive = parseCdx(input.cdx);
  const timeline: DomainEvent[] = [];
  const push = (iso: string | undefined, kind: DomainEvent['kind'], text: string) => { if (iso) timeline.push({ iso, kind, text }); };
  push(facts.registered, 'registered', `Registered${facts.registrar ? ` through ${facts.registrar}` : ''}`);
  push(archive.first, 'archive-first', `First saved by the Internet Archive (${archive.captures} saved copies in the sample)`);
  push(certs.firstSeen, 'cert', `First security certificate issued (${certs.count} in total, ${certs.hosts.length} host name${certs.hosts.length === 1 ? '' : 's'})`);
  push(facts.updated, 'changed', 'Registration record last changed');
  push(archive.last, 'archive-last', 'Most recent copy saved by the Internet Archive');
  push(facts.expires, 'expires', Date.parse(facts.expires ?? '') < now ? 'Registration expired' : 'Registration expires');
  timeline.sort((a, b) => a.iso.localeCompare(b.iso));
  const insights: DomainReport['insights'] = [];
  const reg = facts.registered ? Date.parse(facts.registered) : NaN;
  const ageDays = Number.isFinite(reg) ? Math.floor((now - reg) / 86400000) : NaN;
  if (Number.isFinite(ageDays)) {
    if (ageDays < 30) insights.push({ level: 'warning', text: `Registered only ${ageDays} day${ageDays === 1 ? '' : 's'} ago. Very new domains are a common mark of throwaway sites, scams and impersonation.` });
    else if (ageDays < 180) insights.push({ level: 'notice', text: `Registered ${ageDays} days ago (under six months old).` });
    else insights.push({ level: 'info', text: `Registered ${(ageDays / 365).toFixed(1)} years ago.` });
  }
  if (archive.first && Number.isFinite(reg) && Date.parse(archive.first) < reg - 86400000 * 7) insights.push({ level: 'warning', text: `The Internet Archive has copies from ${day(archive.first)}, before the current registration date (${day(facts.registered!)}). The name was probably dropped and bought again: the history before that belongs to a previous owner.` });
  if (certs.firstSeen && Number.isFinite(reg) && Date.parse(certs.firstSeen) < reg - 86400000 * 7) insights.push({ level: 'warning', text: `Certificates exist from ${day(certs.firstSeen)}, before the registration date. Same sign of an earlier owner.` });
  if (facts.expires) { const left = Math.floor((Date.parse(facts.expires) - now) / 86400000); if (left < 0) insights.push({ level: 'warning', text: 'The registration has expired.' }); else if (left < 60) insights.push({ level: 'notice', text: `Expires in ${left} days.` }); }
  const notable = certs.hosts.filter((h) => NOTABLE.test(h.slice(0, -domain.length - 1)));
  if (notable.length) insights.push({ level: 'notice', text: `Host names that point at internal or admin systems appear in certificate logs: ${notable.slice(0, 8).join(', ')}.` });
  if (facts.status.some((s) => /clientHold|serverHold|pendingDelete|redemption/i.test(s))) insights.push({ level: 'warning', text: `Registry status: ${facts.status.join(', ')}. The domain may be suspended or about to be released.` });
  if (!insights.length) insights.push({ level: 'info', text: 'No registration, certificate or archive records were found for this domain.' });
  return { domain, facts, certs, archive, timeline, insights };
}
