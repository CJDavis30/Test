import type { Claim } from '../../../shared/types';
import { normalizeDomain } from '../../../shared/normalize';
import type { Adapter } from '../types';
import { adapter, arr, claim, countryName, getJson, iso, joinPlace, str } from './util';

// ---------------------------------------------------------------------------------------------------------------
// DNS over HTTPS (two providers = fallback chain)
// ---------------------------------------------------------------------------------------------------------------
const TYPES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, PTR: 12, MX: 15, TXT: 16, AAAA: 28 };
const SERVICES: [RegExp, string][] = [
  [/google\.com\.?$|googlemail\.com\.?$|google-site-verification/i, 'Google Workspace'],
  [/outlook\.com\.?$|protection\.outlook|microsoft|^ms=/i, 'Microsoft 365'],
  [/protonmail\.ch\.?$|proton\.me/i, 'Proton Mail'], [/zoho\.(com|eu)\.?$/i, 'Zoho Mail'], [/mimecast/i, 'Mimecast'],
  [/sendgrid\.net/i, 'SendGrid'], [/mailgun\.org/i, 'Mailgun'], [/amazonses\.com/i, 'Amazon SES'], [/atlassian-domain-verification/i, 'Atlassian'],
  [/facebook-domain-verification/i, 'Meta'], [/docusign/i, 'DocuSign'], [/stripe-verification/i, 'Stripe'], [/shopify/i, 'Shopify'], [/cloudflare/i, 'Cloudflare'],
];

async function doh(ctx: any, base: string, name: string, type: keyof typeof TYPES, headers?: Record<string, string>): Promise<{ data: string }[]> {
  const j = await getJson<any>(ctx, `${base}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json', ...headers } });
  return arr<any>(j?.Answer).filter((a) => a.type === TYPES[type]).map((a) => ({ data: String(a.data ?? '') }));
}

function dohAdapter(id: string, name: string, base: string, priority: number, headers?: Record<string, string>): Adapter {
  return adapter({
    id, name, description: 'A, AAAA, MX, NS and TXT records, plus reverse DNS for IPs.', homepage: new URL(base).origin,
    accepts: ['domain', 'ip'], capability: 'dns', family: 'dns', reliability: 0.95, priority, cacheTtlMs: 10 * 60_000,
    selfTest: { type: 'domain', value: 'example.com' },
    async run(e, ctx) {
      const out: Claim[] = [];
      if (e.type === 'ip') {
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(e.value)) return out;
        const ptr = e.value.split('.').reverse().join('.') + '.in-addr.arpa';
        for (const r of await doh(ctx, base, ptr, 'PTR', headers)) {
          const d = normalizeDomain(r.data);
          if (d) out.push(claim('domain', d, 'reverse DNS', 0.8, { snippet: `PTR record for ${e.value}` }));
        }
        return out;
      }
      const d = e.value;
      const [a, aaaa, mx, ns, txt] = await Promise.all((['A', 'AAAA', 'MX', 'NS', 'TXT'] as const).map((t) => doh(ctx, base, d, t, headers).catch(() => [])));
      for (const r of [...a, ...aaaa]) out.push(claim('ip', r.data, 'resolves to', 0.95, { snippet: `DNS ${r.data.includes(':') ? 'AAAA' : 'A'} record` }));
      const seen = new Set<string>();
      for (const r of mx) { const host = normalizeDomain(r.data.split(/\s+/).pop() ?? ''); if (host && !seen.has(host)) { seen.add(host); out.push(claim('domain', host, 'mail handled by', 0.9, { snippet: 'MX record' })); } }
      for (const r of ns) { const host = normalizeDomain(r.data); if (host) out.push(claim('domain', host, 'nameserver', 0.9, { snippet: 'NS record' })); }
      const services = new Set<string>();
      for (const r of [...mx, ...txt]) for (const [re, svc] of SERVICES) if (re.test(r.data)) services.add(svc);
      for (const r of txt) {
        for (const m of r.data.matchAll(/include:([a-z0-9._-]+\.[a-z]{2,})/gi)) out.push(claim('domain', m[1], 'sends mail via (SPF)', 0.6, { snippet: 'SPF include' }));
      }
      for (const svc of services) out.push(claim('org', svc, 'uses service', 0.55, { snippet: 'Inferred from MX/TXT records' }));
      return out;
    },
  });
}

export const dnsCloudflare = dohAdapter('dns-cloudflare', 'DNS (Cloudflare)', 'https://cloudflare-dns.com/dns-query', 1);
export const dnsGoogle = dohAdapter('dns-google', 'DNS (Google)', 'https://dns.google/resolve', 2);

// ---------------------------------------------------------------------------------------------------------------
// RDAP (the modern WHOIS): domains and IP ranges
// ---------------------------------------------------------------------------------------------------------------
const vcard = (ent: any): { fn: string; org: string; email: string } => {
  const props = arr<any[]>(ent?.vcardArray?.[1]);
  const pick = (k: string) => str(props.find((p) => p[0] === k)?.[3]);
  return { fn: pick('fn'), org: pick('org'), email: pick('email') };
};
const REDACTED = /redact|privacy|withheld|not disclosed|data protected|proxy|whoisguard|domains by proxy|contact privacy|n\/a/i;

export const rdapDomain = adapter({
  id: 'rdap-domain', name: 'Registration data (RDAP)', description: 'Registrar, dates, nameservers and (when public) the registrant.', homepage: 'https://rdap.org',
  accepts: ['domain'], capability: 'registration', family: 'rdap', reliability: 0.92, cacheTtlMs: 12 * 3600_000,
  selfTest: { type: 'domain', value: 'example.com' },
  async run(e, ctx) {
    const parts = e.value.split('.');
    const reg = parts.length > 2 && !/^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(parts.slice(-2).join('.')) ? parts.slice(-2).join('.') : e.value;
    const j = await getJson<any>(ctx, `https://rdap.org/domain/${encodeURIComponent(reg)}`);
    if (!j) return [];
    const out: Claim[] = [];
    const ev = (a: string) => iso(arr<any>(j.events).find((x) => x.eventAction === a)?.eventDate);
    const created = ev('registration'), expires = ev('expiration'), changed = ev('last changed');
    const snippet = [created && `Registered ${created}`, expires && `expires ${expires}`, changed && `updated ${changed}`].filter(Boolean).join(' · ');
    for (const ent of arr<any>(j.entities)) {
      const roles: string[] = arr(ent.roles);
      const v = vcard(ent);
      if (roles.includes('registrar') && (v.fn || v.org)) out.push(claim('org', v.fn || v.org, 'registrar', 0.9, { snippet, when: created, url: `https://rdap.org/domain/${reg}` }));
      if (roles.includes('registrant')) {
        const name = v.org || v.fn;
        if (name && !REDACTED.test(name)) out.push(claim(v.org ? 'org' : 'person', name, 'registrant', 0.8, { snippet: 'Registrant listed in RDAP', when: created }));
        if (v.email && !REDACTED.test(v.email) && /@/.test(v.email)) out.push(claim('email', v.email, 'registrant contact', 0.75, { snippet: 'Registrant email listed in RDAP', when: created }));
      }
    }
    for (const n of arr<any>(j.nameservers)) { const h = normalizeDomain(str(n.ldhName)); if (h) out.push(claim('domain', h, 'nameserver', 0.85, { snippet: 'RDAP nameserver' })); }
    if (created && !out.some((c) => c.when)) out.push(claim('url', `https://rdap.org/domain/${reg}`, 'registration record', 0.9, { snippet, when: created }));
    return out;
  },
});

export const rdapIp = adapter({
  id: 'rdap-ip', name: 'Network ownership (RDAP)', description: 'Who the IP block is allocated to, and in which country.', homepage: 'https://rdap.org',
  accepts: ['ip'], capability: 'ip-registration', family: 'rdap', reliability: 0.9, cacheTtlMs: 12 * 3600_000,
  selfTest: { type: 'ip', value: '1.1.1.1' },
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://rdap.org/ip/${encodeURIComponent(e.value)}`);
    if (!j) return [];
    const out: Claim[] = [];
    const cidr = arr<any>(j.cidr0_cidrs)[0];
    const range = cidr ? `${cidr.v4prefix ?? cidr.v6prefix}/${cidr.length}` : `${j.startAddress ?? ''}–${j.endAddress ?? ''}`;
    const owner = arr<any>(j.entities).map(vcard).map((v) => v.org || v.fn).find((n) => n && !REDACTED.test(n)) ?? str(j.name);
    if (owner) out.push(claim('org', owner, 'network owner', 0.85, { snippet: `Allocation ${range}${j.name ? ` (${j.name})` : ''}`, attrs: { range } }));
    if (str(j.country)) out.push(claim('location', countryName(j.country), 'registered in', 0.35, { snippet: 'Country of the registered allocation (not the physical host)', conflictKey: 'location' }));
    return out;
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Certificate transparency & passive DNS
// ---------------------------------------------------------------------------------------------------------------
function hostsUnder(domain: string, names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) for (const n of String(raw).split(/\s+/)) {
    const h = n.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
    if (h !== domain && h.endsWith(`.${domain}`) && /^[a-z0-9.-]+$/.test(h)) out.add(h);
  }
  return [...out];
}

export const crtsh = adapter({
  id: 'crtsh', name: 'Certificate transparency (crt.sh)', description: 'Every hostname that has ever had a public TLS certificate.', homepage: 'https://crt.sh',
  accepts: ['domain'], capability: 'subdomains', family: 'ct-logs', reliability: 0.88, priority: 1, minIntervalMs: 1500, cacheTtlMs: 12 * 3600_000,
  selfTest: { type: 'domain', value: 'example.com' },
  async run(e, ctx) {
    const rows = arr<any>(await getJson(ctx, `https://crt.sh/?q=${encodeURIComponent('%.' + e.value)}&output=json`, { timeoutMs: 28_000 }));
    const first = new Map<string, string>();
    for (const r of rows) for (const h of hostsUnder(e.value, [String(r.name_value ?? ''), String(r.common_name ?? '')])) {
      const d = iso(r.not_before) ?? iso(r.entry_timestamp);
      if (d && (!first.get(h) || d < first.get(h)!)) first.set(h, d); else if (!first.has(h)) first.set(h, '');
    }
    return [...first.entries()].slice(0, 400).map(([h, d]) => claim('domain', h, 'subdomain', 0.85, { snippet: 'Seen in a public TLS certificate', when: d || undefined, url: `https://crt.sh/?q=${encodeURIComponent(h)}` }));
  },
});

export const certspotter = adapter({
  id: 'certspotter', name: 'Certificate transparency (Cert Spotter)', description: 'Second CT-log index; used if crt.sh is down or empty.', homepage: 'https://sslmate.com/certspotter',
  accepts: ['domain'], capability: 'subdomains', family: 'ct-logs', reliability: 0.88, priority: 2, keyOptional: true, requiresKey: 'certspotter', keyHelp: 'Optional: raises rate limits', minIntervalMs: 1200,
  selfTest: { type: 'domain', value: 'example.com' },
  async run(e, ctx) {
    const rows = arr<any>(await getJson(ctx, `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(e.value)}&include_subdomains=true&expand=dns_names`, { headers: ctx.key ? { Authorization: `Bearer ${ctx.key}` } : {} }));
    const first = new Map<string, string>();
    for (const r of rows) for (const h of hostsUnder(e.value, arr<string>(r.dns_names))) { const d = iso(r.not_before) ?? ''; if (!first.has(h) || (d && d < first.get(h)!)) first.set(h, d); }
    return [...first.entries()].slice(0, 400).map(([h, d]) => claim('domain', h, 'subdomain', 0.85, { snippet: 'Seen in a public TLS certificate', when: d || undefined }));
  },
});

export const hackertarget = adapter({
  id: 'hackertarget', name: 'Passive DNS (HackerTarget)', description: 'Known hostnames for a domain (free tier: ~50 lookups/day).', homepage: 'https://hackertarget.com',
  accepts: ['domain'], capability: 'passive-dns', family: 'passive-dns-ht', reliability: 0.7, priority: 2, minIntervalMs: 2000,
  selfTest: { type: 'domain', value: 'example.com' },
  async run(e, ctx) {
    const t = await ctx.text(`https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(e.value)}`);
    if (/API count exceeded|limit/i.test(t)) { const { RateLimitedError } = await import('../types'); throw new RateLimitedError(); }
    if (/^error|no records/i.test(t.trim())) return [];
    return t.split('\n').map((l) => l.split(',')).filter((p) => p[0]).map(([h, ip]) => hostsUnder(e.value, [h])[0] && claim('domain', hostsUnder(e.value, [h])[0], 'subdomain', 0.7, { snippet: `Passive DNS${ip ? ` · ${ip}` : ''}`, attrs: ip ? { ip } : undefined })).filter(Boolean) as Claim[];
  },
});

export const otx = adapter({
  id: 'otx', name: 'Passive DNS (AlienVault OTX)', description: 'Historical DNS observations for domains and IPs.', homepage: 'https://otx.alienvault.com',
  accepts: ['domain', 'ip'], capability: 'passive-dns', family: 'passive-dns-otx', reliability: 0.72, priority: 1, keyOptional: true, requiresKey: 'otx', keyHelp: 'Optional: free key avoids throttling', minIntervalMs: 1000,
  selfTest: { type: 'domain', value: 'example.com' },
  async run(e, ctx) {
    const headers = ctx.key ? { 'X-OTX-API-KEY': ctx.key } : undefined;
    const path = e.type === 'domain' ? `domain/${encodeURIComponent(e.value)}` : `${e.value.includes(':') ? 'IPv6' : 'IPv4'}/${encodeURIComponent(e.value)}`;
    const j = await getJson<any>(ctx, `https://otx.alienvault.com/api/v1/indicators/${path}/passive_dns`, { headers });
    const out: Claim[] = [];
    const seen = new Set<string>();
    for (const r of arr<any>(j?.passive_dns).slice(0, 600)) {
      const host = str(r.hostname).toLowerCase(), addr = str(r.address), when = iso(r.first);
      if (e.type === 'domain') {
        if (hostsUnder(e.value, [host])[0] && !seen.has(host)) { seen.add(host); out.push(claim('domain', host, 'subdomain', 0.6, { snippet: 'Passive DNS observation', when })); }
        if (host === e.value && /^\d+\.\d+\.\d+\.\d+$/.test(addr) && !seen.has(addr)) { seen.add(addr); out.push(claim('ip', addr, 'resolved to (historic)', 0.6, { snippet: `Seen ${iso(r.first) ?? '?'} → ${iso(r.last) ?? '?'}`, when })); }
      } else if (host && !seen.has(host)) { seen.add(host); out.push(claim('domain', host, 'hosted on this IP', 0.6, { snippet: 'Passive DNS observation', when })); }
    }
    return out;
  },
});

export const urlscan = adapter({
  id: 'urlscan', name: 'Web scans (urlscan.io)', description: 'Pages, IPs and servers seen in public scans.', homepage: 'https://urlscan.io',
  accepts: ['domain', 'ip'], capability: 'web-scans', family: 'urlscan', reliability: 0.78, keyOptional: true, requiresKey: 'urlscan', keyHelp: 'Optional: free key for higher quota', minIntervalMs: 1500,
  selfTest: { type: 'domain', value: 'example.com' },
  async run(e, ctx) {
    const q = e.type === 'domain' ? `domain:${e.value}` : `ip:"${e.value}"`;
    const j = await getJson<any>(ctx, `https://urlscan.io/api/v1/search/?q=${encodeURIComponent(q)}&size=60`, { headers: ctx.key ? { 'API-Key': ctx.key } : undefined });
    const out: Claim[] = [];
    const seen = new Set<string>();
    for (const r of arr<any>(j?.results)) {
      const p = r.page ?? {}, t = r.task ?? {};
      const when = iso(t.time);
      const push = (c: Claim) => { const k = `${c.type}|${c.value}`; if (!seen.has(k)) { seen.add(k); out.push(c); } };
      if (e.type === 'domain') {
        if (str(p.ip)) push(claim('ip', p.ip, 'served from', 0.65, { snippet: `Scan ${when ?? ''}${p.server ? ` · ${p.server}` : ''}`, when, url: r.result }));
        const host = str(p.domain).toLowerCase();
        if (hostsUnder(e.value, [host])[0]) push(claim('domain', host, 'subdomain', 0.6, { when, url: r.result }));
        if (str(p.url)) push(claim('url', p.url, 'scanned page', 0.6, { snippet: p.title ? `“${str(p.title).slice(0, 90)}”` : undefined, when, url: r.result }));
      } else if (str(p.domain)) push(claim('domain', p.domain, 'seen on this IP', 0.6, { when, url: r.result, snippet: p.title ? `“${str(p.title).slice(0, 90)}”` : undefined }));
    }
    return out.slice(0, 100);
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Web history
// ---------------------------------------------------------------------------------------------------------------
const ASSET = /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map|webp|mp4|mp3|pdf|xml|txt|json)(\?|$)/i;
export const wayback = adapter({
  id: 'wayback', name: 'Web archive (Wayback Machine)', description: 'Archived pages and subdomains with first-seen dates.', homepage: 'https://web.archive.org',
  accepts: ['domain', 'url'], capability: 'web-history', family: 'wayback', reliability: 0.8, cacheTtlMs: 12 * 3600_000, minIntervalMs: 1000,
  selfTest: { type: 'domain', value: 'example.com' },
  async run(e, ctx) {
    const target = e.type === 'domain' ? `url=${encodeURIComponent(e.value)}&matchType=domain` : `url=${encodeURIComponent(e.value)}`;
    const rows = arr<string[]>(await getJson(ctx, `https://web.archive.org/cdx/search/cdx?${target}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=urlkey&limit=400`, { timeoutMs: 28_000 }));
    const out: Claim[] = [];
    const hosts = new Map<string, string>();
    const pages: { url: string; ts: string }[] = [];
    for (const [ts, original] of rows.slice(1)) {
      let u: URL;
      try { u = new URL(original); } catch { continue; }
      const when = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      if (e.type === 'domain' && host !== e.value && host.endsWith(`.${e.value}`) && (!hosts.has(host) || when < hosts.get(host)!)) hosts.set(host, when);
      if (!ASSET.test(u.pathname) && u.pathname.length < 60) pages.push({ url: `${u.protocol}//${u.hostname}${u.pathname}`, ts: when });
    }
    for (const [h, when] of hosts) out.push(claim('domain', h, 'subdomain', 0.6, { snippet: 'Seen in the Wayback Machine', when, url: `https://web.archive.org/web/*/${h}` }));
    pages.sort((a, b) => a.url.length - b.url.length);
    const seen = new Set<string>();
    for (const p of pages) {
      const key = p.url.replace(/\/$/, '');
      if (seen.has(key) || seen.size >= 25) continue;
      seen.add(key);
      out.push(claim('url', key, 'archived page', 0.75, { snippet: `First captured ${p.ts}`, when: p.ts, url: `https://web.archive.org/web/${p.ts.replace(/-/g, '')}/${key}` }));
    }
    return out;
  },
});

// ---------------------------------------------------------------------------------------------------------------
// IP intelligence: open ports (Shodan InternetDB) and geolocation (two providers = fallback)
// ---------------------------------------------------------------------------------------------------------------
export const internetdb = adapter({
  id: 'internetdb', name: 'Open ports (Shodan InternetDB)', description: 'Open ports, hostnames and known CVEs for an IP. Free, no key.', homepage: 'https://internetdb.shodan.io',
  accepts: ['ip'], capability: 'ip-ports', family: 'shodan', reliability: 0.82, cacheTtlMs: 6 * 3600_000,
  selfTest: { type: 'ip', value: '1.1.1.1' },
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://internetdb.shodan.io/${encodeURIComponent(e.value)}`);
    if (!j) return [];
    const out: Claim[] = [];
    for (const h of arr<string>(j.hostnames)) { const d = normalizeDomain(h); if (d) out.push(claim('domain', d, 'hostname', 0.8, { snippet: 'Hostname reported for this IP' })); }
    const ports = arr<number>(j.ports);
    if (ports.length) out.push(claim('url', `tcp://${e.value}`, 'open ports', 0.85, { snippet: `Open: ${ports.slice(0, 20).join(', ')}${arr(j.tags).length ? ` · tags: ${arr(j.tags).join(', ')}` : ''}`, attrs: { ports: ports.join(',') } }));
    for (const v of arr<string>(j.vulns).slice(0, 10)) out.push(claim('url', `https://nvd.nist.gov/vuln/detail/${v}`, 'possible vulnerability', 0.4, { snippet: 'Inferred from service banners; may be a false positive' }));
    return out;
  },
});

const geo = (j: { city?: string; region?: string; country?: string; lat?: number; lon?: number; org?: string; isp?: string; domain?: string }): Claim[] => {
  const out: Claim[] = [];
  const place = joinPlace(j.city, j.region, j.country);
  if (place) out.push(claim('location', place, 'geolocated to', 0.45, { snippet: 'IP geolocation is approximate (usually the ISP or datacenter, not a person)', conflictKey: 'location', attrs: j.lat !== undefined ? { lat: j.lat, lon: j.lon ?? 0 } : undefined }));
  const org = str(j.org) || str(j.isp);
  if (org) out.push(claim('org', org, 'network operator', 0.7, { snippet: 'ISP / network operator' }));
  if (str(j.domain)) out.push(claim('domain', j.domain!, 'operator domain', 0.6));
  return out;
};

export const ipwho = adapter({
  id: 'ipwho', name: 'IP geolocation (ipwho.is)', description: 'Approximate location, ISP and ASN.', homepage: 'https://ipwho.is',
  accepts: ['ip'], capability: 'geoip', family: 'geoip', reliability: 0.6, priority: 1, cacheTtlMs: 24 * 3600_000,
  selfTest: { type: 'ip', value: '1.1.1.1' },
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://ipwho.is/${encodeURIComponent(e.value)}`);
    if (!j || j.success === false) { if (/limit/i.test(String(j?.message))) { const { RateLimitedError } = await import('../types'); throw new RateLimitedError(); } return []; }
    return geo({ city: j.city, region: j.region, country: j.country, lat: j.latitude, lon: j.longitude, org: j.connection?.org, isp: j.connection?.isp, domain: j.connection?.domain });
  },
});

export const ipapi = adapter({
  id: 'ip-api', name: 'IP geolocation (ip-api.com)', description: 'Fallback geolocation provider.', homepage: 'https://ip-api.com',
  accepts: ['ip'], capability: 'geoip', family: 'geoip', reliability: 0.6, priority: 2, minIntervalMs: 1500, cacheTtlMs: 24 * 3600_000,
  selfTest: { type: 'ip', value: '1.1.1.1' },
  async run(e, ctx) {
    // The free tier is HTTP-only. We send nothing but the IP.
    const j = await getJson<any>(ctx, `http://ip-api.com/json/${encodeURIComponent(e.value)}?fields=status,message,country,regionName,city,lat,lon,isp,org`);
    if (!j || j.status !== 'success') return [];
    return geo({ city: j.city, region: j.regionName, country: j.country, lat: j.lat, lon: j.lon, org: j.org, isp: j.isp });
  },
});

export const networkAdapters: Adapter[] = [dnsCloudflare, dnsGoogle, rdapDomain, rdapIp, crtsh, certspotter, otx, hackertarget, urlscan, wayback, internetdb, ipwho, ipapi];
