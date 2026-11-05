import type { Claim } from '../../../shared/types';
import { arr, claim, countryName, def, enc, fullIso, getJson, getText, iso, joinPlace, rec, str, withRecord } from './kit';

/** Domains and IP addresses: who runs them, what is on them, how old they are, whether anything flags them. */
const ipv4 = (v: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v);
const geoClaims = (j: { city?: string; region?: string; country?: string; lat?: number; lon?: number; org?: string; hostname?: string; tz?: string }, src: string): Claim[] => {
  const out: Claim[] = [];
  const p = joinPlace(j.city, j.region, j.country);
  if (p) out.push(claim('location', p, 'geolocated to', 0.4, { snippet: 'IP geolocation is approximate (usually the ISP or a datacenter, not a person)', conflictKey: 'location', attrs: j.lat !== undefined ? { lat: j.lat, lon: j.lon ?? 0, approximate: true } : undefined }));
  if (str(j.org)) out.push(claim('org', str(j.org).replace(/^AS\d+\s+/i, ''), 'network operator', 0.65, { snippet: `Network operator, per ${src}` }));
  if (str(j.hostname)) out.push(claim('domain', j.hostname!.toLowerCase(), 'reverse DNS name', 0.55, { snippet: `Host name published for this address (${src})` }));
  return out;
};

export const ipinfo = def({
  id: 'ipinfo', name: 'IP geolocation (ipinfo.io)', desc: 'Approximate location, network operator and host name for an IP address.', homepage: 'https://ipinfo.io',
  accepts: ['ip'], cap: 'geoip', family: 'geoip', rel: 0.65, prio: 3, ttl: 24 * 3600_000, self: ['ip', '1.1.1.1'], key: { optional: true, help: 'Optional: a free token raises the daily limit' },
  asked: (q) => `Asked ipinfo.io about ${q}`, check: (_t, v) => `https://ipinfo.io/${enc(v)}`,
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://ipinfo.io/${enc(e.value)}/json${ctx.key ? `?token=${enc(ctx.key)}` : ''}`); if (!j?.ip || j.bogon) return [];
    const [lat, lon] = str(j.loc).split(',').map(Number);
    return withRecord(geoClaims({ city: j.city, region: j.region, country: j.country ? countryName(j.country) : undefined, lat, lon, org: j.org, hostname: j.hostname }, 'ipinfo.io'), rec('IP details (ipinfo.io)', [['IP', j.ip], ['City', j.city], ['Region', j.region], ['Country', j.country], ['Network', j.org], ['Host name', j.hostname], ['Timezone', j.timezone]]));
  },
});

export const ipapiCo = def({
  id: 'ipapi-co', name: 'IP geolocation (ipapi.co)', desc: 'Another fallback for IP location and network.', homepage: 'https://ipapi.co',
  accepts: ['ip'], cap: 'geoip', family: 'geoip', rel: 0.6, prio: 4, ttl: 24 * 3600_000, interval: 1500, self: ['ip', '1.1.1.1'],
  asked: (q) => `Asked ipapi.co about ${q}`, check: (_t, v) => `https://ipapi.co/${enc(v)}/json/`,
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://ipapi.co/${enc(e.value)}/json/`); if (!j?.ip || j.error) return [];
    return withRecord(geoClaims({ city: j.city, region: j.region, country: j.country_name, lat: j.latitude, lon: j.longitude, org: j.org }, 'ipapi.co'), rec('IP details (ipapi.co)', [['IP', j.ip], ['City', j.city], ['Region', j.region], ['Country', j.country_name], ['Network', j.org], ['ASN', j.asn], ['Timezone', j.timezone]]));
  },
});

export const bgpview = def({
  id: 'bgpview', name: 'BGPView', desc: 'Which network (ASN) announces an IP address, who owns it, and its reverse DNS name.', homepage: 'https://bgpview.io',
  accepts: ['ip'], cap: 'ip-registration', family: 'bgp', rel: 0.85, ttl: 12 * 3600_000, self: ['ip', '1.1.1.1'],
  asked: (q) => `Asked BGPView which network announces ${q}`, check: (_t, v) => `https://bgpview.io/ip/${enc(v)}`,
  async run(e, ctx) {
    if (!ipv4(e.value)) return [];
    const j = await getJson<any>(ctx, `https://api.bgpview.io/ip/${enc(e.value)}`); const d = j?.data; if (!d) return [];
    const out: Claim[] = [];
    for (const p of arr<any>(d.prefixes).slice(0, 3)) { const a = p.asn; if (str(a?.description) || str(a?.name)) out.push(claim('org', str(a.description) || str(a.name), `operator of AS${a.asn}`, 0.8, { snippet: `Announces ${p.prefix}`, url: `https://bgpview.io/asn/${a.asn}` })); }
    if (str(d.ptr_record)) out.push(claim('domain', d.ptr_record.toLowerCase(), 'reverse DNS name', 0.7, { snippet: 'PTR record' }));
    return withRecord(out, rec('Network (BGP)', [['IP', e.value], ['Prefix', d.prefixes?.[0]?.prefix], ['AS', d.prefixes?.[0]?.asn?.asn], ['Operator', d.prefixes?.[0]?.asn?.description], ['Country', d.rir_allocation?.country_code], ['Allocated', iso(d.rir_allocation?.date_allocated)]]));
  },
});

export const ripestat = def({
  id: 'ripestat', name: 'RIPEstat', desc: 'The abuse contact email for the network an IP belongs to, and who holds it.', homepage: 'https://stat.ripe.net',
  accepts: ['ip'], cap: 'ip-registration', family: 'ripe', rel: 0.85, ttl: 12 * 3600_000, self: ['ip', '1.1.1.1'],
  asked: (q) => `Asked RIPEstat for the abuse contact and holder of ${q}`, check: (_t, v) => `https://stat.ripe.net/app/launchpad/${enc(v)}`,
  async run(e, ctx) {
    if (!ipv4(e.value)) return [];
    const [a, n] = await Promise.allSettled([getJson<any>(ctx, `https://stat.ripe.net/data/abuse-contact-finder/data.json?resource=${enc(e.value)}`), getJson<any>(ctx, `https://stat.ripe.net/data/as-overview/data.json?resource=${enc(e.value)}`)]);
    const out: Claim[] = [];
    if (a.status === 'fulfilled') for (const m of arr<string>(a.value?.data?.abuse_contacts).slice(0, 3)) if (/@/.test(m)) out.push(claim('email', m.toLowerCase(), 'abuse contact for this network', 0.75, { snippet: 'Published in the regional internet registry', url: `https://stat.ripe.net/app/launchpad/${e.value}` }));
    if (n.status === 'fulfilled' && str(n.value?.data?.holder)) out.push(claim('org', str(n.value.data.holder).replace(/^[A-Z0-9-]+\s+-\s+/, ''), 'holder of this network', 0.7, { snippet: `AS${n.value.data.asn ?? ''} holder` }));
    if (a.status === 'rejected' && n.status === 'rejected') throw a.reason;
    return withRecord(out, rec('Network (RIPEstat)', [['IP', e.value], ['Abuse contact', arr<string>(a.status === 'fulfilled' ? a.value?.data?.abuse_contacts : []).join(', ')], ['Holder', n.status === 'fulfilled' ? n.value?.data?.holder : '']]));
  },
});

export const siteFiles = def({
  id: 'site-files', name: 'Website files (security.txt, humans.txt)', desc: 'Contacts and team names a site publishes about itself in its own standard files.', homepage: 'https://securitytxt.org',
  accepts: ['domain'], cap: 'web-files', family: 'site-files', rel: 0.75, ttl: 6 * 3600_000, self: ['domain', 'github.com'],
  asked: (q) => `Read ${q}'s own security.txt and humans.txt`, check: (_t, v) => `https://${enc(v.toLowerCase())}/.well-known/security.txt`,
  async run(e, ctx) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(e.value)) return [];
    const out: Claim[] = [];
    const sec = await getText(ctx, `https://${e.value}/.well-known/security.txt`, { timeoutMs: 8000 }).catch(() => null);
    if (sec && /^\s*Contact\s*:/im.test(sec)) {
      const url = `https://${e.value}/.well-known/security.txt`;
      for (const m of sec.matchAll(/^\s*Contact\s*:\s*(.+)$/gim)) { const v = m[1].trim(); const em = /^mailto:([^\s?]+)/i.exec(v); if (em) out.push(claim('email', em[1].toLowerCase(), 'security contact', 0.8, { url, snippet: 'Published by the site in security.txt' })); else if (/^https?:\/\//i.test(v)) out.push(claim('url', v, 'security contact page', 0.7, { url })); else if (/^\+?[\d ()-]{7,}$/.test(v)) out.push(claim('phone', v, 'security contact phone', 0.7, { url })); }
      for (const m of sec.matchAll(/^\s*(?:Policy|Hiring|Acknowledgments)\s*:\s*(https?:\/\/\S+)/gim)) out.push(claim('url', m[1], 'published by the site', 0.55, { url }));
    }
    const hum = await getText(ctx, `https://${e.value}/humans.txt`, { timeoutMs: 8000 }).catch(() => null);
    if (hum && !/<html/i.test(hum) && /team|developer|thanks|site/i.test(hum)) {
      const url = `https://${e.value}/humans.txt`;
      for (const m of hum.matchAll(/^\s*(?:Name|Developer|Designer|Author|Lead|Contact)\s*:\s*([A-Z][\p{L}.'’ -]{2,40}\s+[A-Z][\p{L}.'’ -]{1,40})\s*$/gmu)) out.push(claim('person', m[1].trim(), 'named in humans.txt', 0.45, { url, snippet: 'The site lists this person as part of its team' }));
      for (const m of hum.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) out.push(claim('email', m[0].toLowerCase(), 'listed in humans.txt', 0.6, { url }));
      for (const m of hum.matchAll(/(?:twitter|x|github)\s*:\s*@?([A-Za-z0-9_-]{2,30})/gi)) out.push(claim('username', m[1], 'listed in humans.txt', 0.5, { url }));
    }
    const seen = new Set<string>();
    return out.filter((c) => { const k = `${c.type}|${c.value.toLowerCase()}`; return seen.has(k) ? false : (seen.add(k), true); }).slice(0, 25);
  },
});

export const waybackCdx = def({
  id: 'wayback-cdx', name: 'Wayback Machine (first capture)', desc: 'When a site or page was first saved by the Internet Archive: often much older than its registration date suggests.', homepage: 'https://web.archive.org',
  accepts: ['domain', 'url'], cap: 'web-first-seen', family: 'wayback', rel: 0.9, ttl: 12 * 3600_000, self: ['domain', 'example.com'],
  asked: (q) => `Asked the Wayback Machine for the earliest saved copy of ${q}`, check: (_t, v) => `https://web.archive.org/web/0*/${v}`,
  async run(e, ctx) {
    const target = e.type === 'domain' ? `${e.value}/*` : e.value;
    const j = await getJson<any>(ctx, `https://web.archive.org/cdx/search/cdx?url=${enc(target)}&output=json&limit=2&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=timestamp:6`);
    const row = arr<any[]>(j)[1]; if (!row?.[0]) return [];
    const ts = String(row[0]), when = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    const url = `https://web.archive.org/web/${ts}/${row[1]}`;
    return withRecord([claim('url', url, 'earliest saved copy', 0.75, { url, when, snippet: `First saved ${when}`, attrs: { firstSeen: when } })], rec('Earliest Wayback capture', [['Target', e.value], ['First saved', when], ['Page', row[1]], ['Copy', url]]));
  },
});

export const greynoise = def({
  id: 'greynoise', name: 'GreyNoise', desc: 'Whether an IP address is part of the internet\'s background scanning, or a known benign service (a search engine, a CDN, a cloud provider).', homepage: 'https://www.greynoise.io',
  accepts: ['ip'], cap: 'ip-noise', family: 'greynoise', rel: 0.8, ttl: 6 * 3600_000, self: ['ip', '8.8.8.8'], key: { optional: true, help: 'Optional: a key raises the community limit' },
  asked: (q) => `Asked GreyNoise about ${q}`, check: (_t, v) => `https://viz.greynoise.io/ip/${enc(v)}`,
  async run(e, ctx) {
    if (!ipv4(e.value)) return [];
    const j = await getJson<any>(ctx, `https://api.greynoise.io/v3/community/${enc(e.value)}`, { headers: ctx.key ? { key: ctx.key } : {} }); if (!j?.ip) return [];
    const out: Claim[] = [];
    if (j.riot && str(j.name)) out.push(claim('org', j.name, 'known benign service', 0.75, { url: str(j.link), snippet: 'GreyNoise lists this address as a well-known, legitimate service' }));
    if (j.noise) out.push(claim('url', str(j.link) || `https://viz.greynoise.io/ip/${e.value}`, 'seen scanning the internet', 0.6, { snippet: `Classified “${str(j.classification) || 'unknown'}”${j.last_seen ? `, last seen ${j.last_seen}` : ''}` }));
    return withRecord(out, rec('GreyNoise', [['IP', e.value], ['Background scanner', j.noise ? 'yes' : 'no'], ['Known benign service', j.riot ? j.name || 'yes' : 'no'], ['Classification', j.classification], ['Last seen', j.last_seen]]));
  },
});

export const virustotal = def({
  id: 'virustotal', name: 'VirusTotal', desc: 'How many security vendors flag a domain or IP, who registered it and when. Needs a free API key.', homepage: 'https://www.virustotal.com',
  accepts: ['domain', 'ip'], cap: 'web-scans', family: 'virustotal', rel: 0.8, ttl: 6 * 3600_000, interval: 16000, self: ['domain', 'example.com'], key: { help: 'Free key from virustotal.com (4 lookups a minute)' },
  asked: (q) => `Asked VirusTotal about ${q}`, check: (t, v) => `https://www.virustotal.com/gui/${t === 'ip' ? 'ip-address' : 'domain'}/${enc(v)}`,
  async run(e, ctx) {
    if (!ctx.key) return [];
    const j = await getJson<any>(ctx, `https://www.virustotal.com/api/v3/${e.type === 'ip' ? 'ip_addresses' : 'domains'}/${enc(e.value)}`, { headers: { 'x-apikey': ctx.key } }); const a = j?.data?.attributes; if (!a) return [];
    const st = a.last_analysis_stats ?? {}, bad = Number(st.malicious) || 0, sus = Number(st.suspicious) || 0;
    const url = `https://www.virustotal.com/gui/${e.type === 'ip' ? 'ip-address' : 'domain'}/${e.value}`;
    const out: Claim[] = [claim('url', url, 'security reputation report', 0.55, { url, snippet: bad || sus ? `${bad} vendors say malicious, ${sus} suspicious (of ${Object.values(st).reduce((s: number, x) => s + Number(x || 0), 0)})` : 'No vendor flags it', attrs: { malicious: bad, suspicious: sus } })];
    if (str(a.registrar)) out.push(claim('org', a.registrar, 'domain registrar', 0.6, { url }));
    if (str(a.as_owner)) out.push(claim('org', a.as_owner, 'network operator', 0.65, { url }));
    return withRecord(out, rec('VirusTotal', [['Target', e.value], ['Flagged malicious', bad], ['Flagged suspicious', sus], ['Registrar', a.registrar], ['Created', a.creation_date ? iso(a.creation_date) : ''], ['Network owner', a.as_owner], ['Categories', Object.values(a.categories ?? {}).slice(0, 4).join(', ')], ['Reputation', a.reputation]]));
  },
});

export const shodan = def({
  id: 'shodan', name: 'Shodan', desc: 'Open ports, services, host names and known weaknesses for an IP address. Needs an API key.', homepage: 'https://www.shodan.io',
  accepts: ['ip'], cap: 'ip-ports', family: 'shodan', rel: 0.9, ttl: 6 * 3600_000, self: ['ip', '8.8.8.8'], key: { help: 'API key from account.shodan.io' },
  asked: (q) => `Asked Shodan about ${q}`, check: (_t, v) => `https://www.shodan.io/host/${enc(v)}`,
  async run(e, ctx) {
    if (!ctx.key) return [];
    const j = await getJson<any>(ctx, `https://api.shodan.io/shodan/host/${enc(e.value)}?key=${enc(ctx.key)}`); if (!j?.ip_str) return [];
    const url = `https://www.shodan.io/host/${e.value}`;
    const out: Claim[] = [];
    for (const h of arr<string>(j.hostnames).slice(0, 10)) out.push(claim('domain', h.toLowerCase(), 'host name seen on this address', 0.7, { url }));
    if (str(j.org)) out.push(claim('org', j.org, 'organisation', 0.65, { url }));
    const loc = joinPlace(j.city, j.country_name); if (loc) out.push(claim('location', loc, 'geolocated to', 0.4, { url, conflictKey: 'location', snippet: 'Approximate' }));
    const vulns = arr<string>(j.vulns).length;
    return withRecord(out, rec('Shodan host', [['IP', e.value], ['Organisation', j.org], ['Open ports', arr<number>(j.ports).slice(0, 15).join(', ')], ['Operating system', j.os], ['Known vulnerabilities', vulns || 'none listed'], ['Last seen', iso(j.last_update)]]));
  },
});

export const securitytrails = def({
  id: 'securitytrails', name: 'SecurityTrails', desc: 'A far larger list of a domain\'s subdomains than certificates alone give. Needs a free API key.', homepage: 'https://securitytrails.com',
  accepts: ['domain'], cap: 'subdomains-extra', family: 'securitytrails', rel: 0.9, ttl: 12 * 3600_000, self: ['domain', 'example.com'], key: { help: 'Free key from securitytrails.com (50 lookups a month)' },
  asked: (q) => `Asked SecurityTrails for the subdomains of ${q}`, check: (_t, v) => `https://securitytrails.com/domain/${enc(v)}/dns`,
  async run(e, ctx) {
    if (!ctx.key) return [];
    const j = await getJson<any>(ctx, `https://api.securitytrails.com/v1/domain/${enc(e.value)}/subdomains?children_only=false&include_inactive=false`, { headers: { APIKEY: ctx.key, accept: 'application/json' } });
    const subs = arr<string>(j?.subdomains).slice(0, 50);
    if (!subs.length) return [];
    return withRecord(subs.map((s) => claim('domain', `${s}.${e.value}`, 'subdomain', 0.75, { url: `https://securitytrails.com/domain/${e.value}/dns`, snippet: 'Listed by SecurityTrails' })), rec('Subdomains (SecurityTrails)', [['Domain', e.value], ['Subdomains found', subs.length], ['Examples', subs.slice(0, 8).join(', ')]]));
  },
});

export const abuseipdb = def({
  id: 'abuseipdb', name: 'AbuseIPDB', desc: 'Community abuse reports for an IP address, plus its provider and usage type. Needs a free API key.', homepage: 'https://www.abuseipdb.com',
  accepts: ['ip'], cap: 'ip-reputation', family: 'abuseipdb', rel: 0.75, ttl: 6 * 3600_000, self: ['ip', '8.8.8.8'], key: { help: 'Free key from abuseipdb.com (1,000 checks a day)' },
  asked: (q) => `Asked AbuseIPDB about ${q}`, check: (_t, v) => `https://www.abuseipdb.com/check/${enc(v)}`,
  async run(e, ctx) {
    if (!ctx.key) return [];
    const j = await getJson<any>(ctx, `https://api.abuseipdb.com/api/v2/check?ipAddress=${enc(e.value)}&maxAgeInDays=90`, { headers: { Key: ctx.key, Accept: 'application/json' } }); const d = j?.data; if (!d) return [];
    const url = `https://www.abuseipdb.com/check/${e.value}`;
    const out: Claim[] = [claim('url', url, 'abuse reports', 0.5, { url, snippet: `${d.totalReports ?? 0} reports in 90 days, abuse score ${d.abuseConfidenceScore ?? 0}%`, attrs: { abuseScore: Number(d.abuseConfidenceScore) || 0 } })];
    if (str(d.isp)) out.push(claim('org', d.isp, 'internet provider', 0.65, { url }));
    if (str(d.domain)) out.push(claim('domain', d.domain, 'provider domain', 0.6, { url }));
    return withRecord(out, rec('AbuseIPDB', [['IP', e.value], ['Abuse score', `${d.abuseConfidenceScore}%`], ['Reports (90 days)', d.totalReports], ['Provider', d.isp], ['Usage', d.usageType], ['Country', d.countryCode], ['Tor exit', d.isTor ? 'yes' : 'no'], ['Last reported', iso(d.lastReportedAt)]]));
  },
});

export const networkMore = [ipinfo, ipapiCo, bgpview, ripestat, siteFiles, waybackCdx, greynoise, virustotal, shodan, securitytrails, abuseipdb];
void fullIso;
