import type { Claim } from '../../../shared/types';
import { parseCoords } from '../../../shared/forensics/geo';
import { arr, claim, def, enc, getJson, iso, joinPlace, linkClaim, rec, str, withRecord } from './kit';

/** Public records, research, sanctions, leaks, blockchain names and web search. Names are shared by many people, so most of these are weighted low and say so. */
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const nameParts = (v: string) => { const p = strip(v).split(' ').filter(Boolean); return p.length >= 2 ? { first: p[0], last: p[p.length - 1], all: p } : null; };
const NAMESAKE = 'Names are shared by many people: confirm it is the same person before relying on it';
const q = (v: string) => `"${v.replace(/"/g, '')}"`;

export const ens = def({
  id: 'ens', name: 'ENS (Ethereum names)', desc: 'An .eth name\'s owner-set records: wallet addresses, X, GitHub, Discord and email, all signed on-chain by the owner.', homepage: 'https://ens.domains',
  accepts: ['username', 'domain', 'wallet'], cap: 'chain', family: 'ens', rel: 0.85, self: ['username', 'vitalik.eth'],
  asked: (qq) => `Looked up the Ethereum name or address ${qq}`, check: (_t, v) => `https://app.ens.domains/${enc(v)}`,
  async run(e, ctx) {
    const v = e.value.trim();
    if (!/\.eth$/i.test(v) && !/^0x[0-9a-fA-F]{40}$/.test(v)) return [];
    const j = await getJson<any>(ctx, `https://api.ensdata.net/${enc(v)}`); if (!j || j.error || (!j.address && !j.ens)) return [];
    const name = str(j.ens) || (/\.eth$/i.test(v) ? v : ''), url = `https://app.ens.domains/${name || v}`;
    const out: Claim[] = [];
    if (str(j.address) && /^0x[0-9a-fA-F]{40}$/.test(j.address)) out.push(claim('wallet', j.address, 'address this name points to', 0.9, { url, snippet: 'Set by the name\'s owner on the Ethereum blockchain' }));
    if (name && e.type !== 'domain') out.push(claim('account', url, 'ENS name', 0.8, { url, attrs: { platform: 'ENS', handle: name } }));
    for (const [k, host] of [['twitter', 'https://x.com/'], ['github', 'https://github.com/'], ['reddit', 'https://www.reddit.com/user/'], ['telegram', 'https://t.me/']] as const) {
      const h = str(j[k]).replace(/^@/, ''); if (h && /^[\w.-]{1,40}$/.test(h)) out.push(claim('account', `${host}${h}`, `${k} listed in their ENS records`, 0.85, { url, attrs: { platform: k === 'twitter' ? 'X' : k[0].toUpperCase() + k.slice(1), handle: h }, snippet: 'Published by the owner on the blockchain' }));
    }
    if (str(j.discord)) out.push(claim('username', str(j.discord), 'Discord name listed in their ENS records', 0.8, { url, attrs: { platform: 'Discord' } }));
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(str(j.email))) out.push(claim('email', str(j.email).toLowerCase(), 'email listed in their ENS records', 0.8, { url }));
    if (str(j.url)) { const c = linkClaim(str(j.url), 'ENS records', 0.75, url); if (c) out.push(c); }
    if (str(j.location)) out.push(claim('location', str(j.location), 'location listed in their ENS records', 0.5, { url, conflictKey: 'location' }));
    for (const [coin, a] of Object.entries<any>(j.wallets ?? {})) if (str(a) && !/^0x/i.test(a) && coin !== 'eth') out.push(claim('wallet', str(a), `${coin.toUpperCase()} address in their ENS records`, 0.8, { url }));
    return withRecord(out, rec('ENS records', [['Name', name], ['Address', j.address], ['X', j.twitter], ['GitHub', j.github], ['Discord', j.discord], ['Email', j.email], ['Website', j.url]]));
  },
});

const CHAIN = (a: string): string | null => /^0x[0-9a-fA-F]{40}$/.test(a) ? 'ethereum' : /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,60}$/.test(a) ? 'bitcoin' : /^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{26,60}$/.test(a) ? 'litecoin' : /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/.test(a) ? 'dogecoin' : /^(bitcoincash:)?[qp][a-z0-9]{40,}$/.test(a) ? 'bitcoin-cash' : null;
export const blockchair = def({
  id: 'blockchair', name: 'Blockchair', desc: 'When a wallet was first and last active and how many transactions it has, on Bitcoin, Ethereum, Litecoin, Dogecoin and Bitcoin Cash.', homepage: 'https://blockchair.com',
  accepts: ['wallet'], cap: 'chain', family: 'blockchair', rel: 0.9, ttl: 3600_000, interval: 1500, self: ['wallet', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
  asked: (qq) => `Asked Blockchair about the wallet ${qq}`, check: (_t, v) => `https://blockchair.com/search?q=${enc(v)}`,
  async run(e, ctx) {
    const chain = CHAIN(e.value); if (!chain) return [];
    const j = await getJson<any>(ctx, `https://api.blockchair.com/${chain}/dashboards/address/${enc(e.value)}?limit=0`); const d = j?.data?.[e.value] ?? j?.data?.[e.value.toLowerCase()] ?? Object.values<any>(j?.data ?? {})[0]; const a = d?.address; if (!a) return [];
    const tx = Number(a.transaction_count ?? d?.transaction_count) || 0, first = str(a.first_seen_receiving) || str(a.first_seen_spending), last = str(a.last_seen_receiving) || str(a.last_seen_spending);
    const url = `https://blockchair.com/${chain}/address/${e.value}`;
    const bal = a.balance !== undefined ? (chain === 'ethereum' ? `${(Number(a.balance) / 1e18).toFixed(4)} ETH` : `${(Number(a.balance) / 1e8).toFixed(4)} ${chain === 'bitcoin' ? 'BTC' : chain.toUpperCase()}`) : '';
    return withRecord([claim('url', url, 'transaction history', 0.65, { url, when: first ? first.slice(0, 10) : undefined, snippet: `${tx.toLocaleString('en-US')} transactions${first ? `, first seen ${first.slice(0, 10)}` : ''}${last ? `, last ${last.slice(0, 10)}` : ''}`, attrs: { txCount: tx, firstSeen: first, lastSeen: last, chain } })], rec('Wallet activity', [['Address', e.value], ['Chain', chain], ['Transactions', tx], ['First active', first.slice(0, 10)], ['Last active', last.slice(0, 10)], ['Balance', bal]]));
  },
});

export const wikiGeosearch = def({
  id: 'wiki-geosearch', name: 'Wikipedia (places nearby)', desc: 'Landmarks and notable places within a kilometre of a point. Useful for checking a photo\'s location by eye.', homepage: 'https://en.wikipedia.org',
  accepts: ['location'], cap: 'places', family: 'wikipedia', rel: 0.85, ttl: 24 * 3600_000, self: ['location', '48.8584, 2.2945'],
  asked: (qq) => `Asked Wikipedia what is within 1 km of ${qq}`, check: (_t, v) => { const c = parseCoords(v)[0]; return c ? `https://en.wikipedia.org/wiki/Special:Nearby#/coord/${c.lat},${c.lon}` : `https://en.wikipedia.org/w/index.php?search=${enc(v)}`; },
  async run(e, ctx) {
    const c = parseCoords(e.value)[0]; if (!c) return [];
    const j = await getJson<any>(ctx, `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${c.lat}%7C${c.lon}&gsradius=1000&gslimit=10&format=json`);
    const rows = arr<any>(j?.query?.geosearch).slice(0, 8);
    if (!rows.length) return [];
    return withRecord(rows.map((r) => claim('location', str(r.title), 'landmark within 1 km', 0.35, { url: `https://en.wikipedia.org/?curid=${r.pageid}`, attrs: { lat: Number(r.lat), lon: Number(r.lon), distanceM: Math.round(Number(r.dist) || 0) }, snippet: `${Math.round(Number(r.dist) || 0)} m away: a Wikipedia article is about this place` })), rec('Nearby on Wikipedia', [['Point', `${c.lat}, ${c.lon}`], ['Nearest', rows.slice(0, 5).map((r) => `${r.title} (${Math.round(r.dist)} m)`).join(' · ')]]));
  },
});

export const nominatim = def({
  id: 'nominatim', name: 'OpenStreetMap (address lookup)', desc: 'Turns an address or place into coordinates and a full address, or coordinates into the street address at that point.', homepage: 'https://nominatim.openstreetmap.org',
  accepts: ['location'], cap: 'places', family: 'osm', rel: 0.85, ttl: 24 * 3600_000, interval: 1200, self: ['location', 'Eiffel Tower, Paris'],
  asked: (qq) => `Asked OpenStreetMap about ${qq}`, check: (_t, v) => { const c = parseCoords(v)[0]; return c ? `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=18/${c.lat}/${c.lon}` : `https://www.openstreetmap.org/search?query=${enc(v)}`; },
  async run(e, ctx) {
    const c = parseCoords(e.value)[0];
    const r = c ? await getJson<any>(ctx, `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.lat}&lon=${c.lon}&zoom=18&addressdetails=1`) : arr<any>(await getJson<any>(ctx, `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${enc(e.value)}&limit=1&addressdetails=1`))[0];
    if (!r || r.error || !str(r.display_name)) return [];
    const a = r.address ?? {}, town = a.city || a.town || a.village || a.hamlet || a.suburb;
    const short = joinPlace(a.road ? `${a.house_number ? a.house_number + ' ' : ''}${a.road}` : str(r.name), town, a.state, a.country) || str(r.display_name);
    const url = `https://www.openstreetmap.org/${r.osm_type ?? 'node'}/${r.osm_id ?? ''}`.replace(/\/$/, '');
    return withRecord([claim('location', short, c ? 'address at these coordinates' : 'resolves to', 0.7, { url, attrs: { lat: Number(r.lat), lon: Number(r.lon), country: str(a.country), postcode: str(a.postcode) }, snippet: str(r.display_name) })], rec('OpenStreetMap', [['Address', short], ['Coordinates', `${Number(r.lat).toFixed(5)}, ${Number(r.lon).toFixed(5)}`], ['Postcode', a.postcode], ['Country', a.country], ['Kind', [r.category, r.type].filter(Boolean).join(' / ')]]));
  },
});

export const openalex = def({
  id: 'openalex', name: 'OpenAlex (researchers)', desc: 'Academic authors with this exact name: their institutions, ORCID iD and publication counts.', homepage: 'https://openalex.org',
  accepts: ['person'], cap: 'public-figure', family: 'openalex', rel: 0.8, ttl: 24 * 3600_000, self: ['person', 'Geoffrey Hinton'],
  asked: (qq) => `Searched OpenAlex for researchers named ${qq}`, check: (_t, v) => `https://openalex.org/authors?search=${enc(v)}`,
  async run(e, ctx) {
    const np = nameParts(e.value); if (!np) return [];
    const j = await getJson<any>(ctx, `https://api.openalex.org/authors?search=${enc(e.value)}&per-page=5`);
    const out: Claim[] = [];
    for (const a of arr<any>(j?.results).filter((r) => strip(str(r.display_name)) === strip(e.value)).slice(0, 2)) {
      const url = str(a.id).replace('api.openalex.org', 'openalex.org') || 'https://openalex.org';
      out.push(claim('account', url, 'researcher profile', 0.4, { url, attrs: { platform: 'OpenAlex', handle: str(a.display_name), works: Number(a.works_count) || 0 }, snippet: `${a.works_count ?? 0} published works, ${a.cited_by_count ?? 0} citations. ${NAMESAKE}` }));
      if (str(a.orcid)) out.push(claim('account', str(a.orcid), 'ORCID iD', 0.5, { url, attrs: { platform: 'ORCID' }, snippet: NAMESAKE }));
      for (const i of arr<any>(a.last_known_institutions ?? (a.last_known_institution ? [a.last_known_institution] : [])).slice(0, 2)) if (str(i?.display_name)) out.push(claim('org', i.display_name, 'last known institution', 0.4, { url, snippet: `Affiliation recorded in publications. ${NAMESAKE}` }));
    }
    return out;
  },
});

export const orcid = def({
  id: 'orcid', name: 'ORCID', desc: 'Researcher IDs with this name: affiliations and any email the researcher chose to make public.', homepage: 'https://orcid.org',
  accepts: ['person'], cap: 'public-figure', family: 'orcid', rel: 0.75, ttl: 24 * 3600_000, self: ['person', 'Josiah Carberry'],
  asked: (qq) => `Searched ORCID for ${qq}`, check: (_t, v) => `https://orcid.org/orcid-search/search?searchQuery=${enc(v)}`,
  async run(e, ctx) {
    const np = nameParts(e.value); if (!np) return [];
    const j = await getJson<any>(ctx, `https://pub.orcid.org/v3.0/expanded-search/?q=${enc(`given-names:${np.first} AND family-name:${np.last}`)}&rows=5`, { headers: { Accept: 'application/json' } });
    const out: Claim[] = [];
    for (const r of arr<any>(j?.['expanded-result']).filter((x) => strip(`${x['given-names']} ${x['family-names']}`) === strip(e.value)).slice(0, 2)) {
      const url = `https://orcid.org/${r['orcid-id']}`;
      out.push(claim('account', url, 'ORCID record', 0.45, { url, attrs: { platform: 'ORCID', handle: str(r['orcid-id']) }, snippet: NAMESAKE }));
      for (const i of arr<string>(r['institution-name']).slice(0, 2)) out.push(claim('org', i, 'affiliation on ORCID', 0.4, { url, snippet: NAMESAKE }));
      for (const m of arr<string>(r.email).slice(0, 2)) out.push(claim('email', m.toLowerCase(), 'public email on ORCID', 0.6, { url, snippet: `Made public by the researcher. ${NAMESAKE}` }));
    }
    return out;
  },
});

export const fec = def({
  id: 'fec', name: 'US campaign donations (FEC)', desc: 'Public US campaign-finance filings list a donor\'s city, employer and occupation. Common names return many unrelated people.', homepage: 'https://www.fec.gov',
  accepts: ['person'], cap: 'public-figure', family: 'fec', rel: 0.6, ttl: 24 * 3600_000, interval: 1500, self: ['person', 'Jane Smith'], key: { optional: true, help: 'Optional: a free key from api.data.gov lifts the shared demo limit' },
  asked: (qq) => `Searched US campaign-finance filings for donors named ${qq}`, check: (_t, v) => `https://www.fec.gov/data/receipts/individual-contributions/?contributor_name=${enc(v)}`,
  async run(e, ctx) {
    const np = nameParts(e.value); if (!np) return [];
    const j = await getJson<any>(ctx, `https://api.open.fec.gov/v1/schedules/schedule_a/?contributor_name=${enc(e.value)}&is_individual=true&per_page=20&sort=-contribution_receipt_date&api_key=${enc(ctx.key || 'DEMO_KEY')}`);
    const rows = arr<any>(j?.results).filter((r) => { const t = strip(str(r.contributor_name)).split(' '); return t.includes(np.first) && t.includes(np.last); });
    if (!rows.length) return [];
    const out: Claim[] = [], seen = new Set<string>();
    for (const r of rows.slice(0, 10)) {
      const place = joinPlace(str(r.contributor_city), str(r.contributor_state)); const emp = str(r.contributor_employer);
      const url = `https://www.fec.gov/data/receipts/individual-contributions/?contributor_name=${enc(e.value)}`;
      if (place && !seen.has('p' + place)) { seen.add('p' + place); out.push(claim('location', place, 'donor address on a public filing', 0.3, { url, conflictKey: 'location', snippet: `${str(r.contribution_receipt_date).slice(0, 4)} filing. ${NAMESAKE}` })); }
      if (emp && !/^(self|none|n\/a|retired|not employed|unemployed|information requested)/i.test(emp) && !seen.has('e' + emp)) { seen.add('e' + emp); out.push(claim('org', emp, 'employer on a public filing', 0.3, { url, snippet: `${str(r.contributor_occupation) || 'occupation not given'}. ${NAMESAKE}` })); }
    }
    return withRecord(out, rec('FEC donor filings', [['Name searched', e.value], ['Matching filings', rows.length], ['Cities', [...seen].filter((s) => s[0] === 'p').map((s) => s.slice(1)).join(' · ')], ['Employers', [...seen].filter((s) => s[0] === 'e').map((s) => s.slice(1)).join(' · ')]]));
  },
});

export const npi = def({
  id: 'npi', name: 'US healthcare providers (NPI)', desc: 'The US registry of healthcare providers lists each one\'s practice address and phone. Only matches doctors, nurses and similar.', homepage: 'https://npiregistry.cms.hhs.gov',
  accepts: ['person'], cap: 'public-figure', family: 'npi', rel: 0.7, ttl: 24 * 3600_000, self: ['person', 'John Smith'],
  asked: (qq) => `Searched the US healthcare provider registry for ${qq}`, check: (_t, v) => `https://npiregistry.cms.hhs.gov/search?firstName=${enc(v.split(' ')[0])}&lastName=${enc(v.split(' ').slice(-1)[0])}`,
  async run(e, ctx) {
    const np = nameParts(e.value); if (!np) return [];
    const j = await getJson<any>(ctx, `https://npiregistry.cms.hhs.gov/api/?version=2.1&first_name=${enc(np.first)}&last_name=${enc(np.last)}&limit=5`);
    const out: Claim[] = [];
    for (const r of arr<any>(j?.results).slice(0, 3)) {
      const b = r.basic ?? {}; if (strip(`${b.first_name} ${b.last_name}`) !== `${np.first} ${np.last}`) continue;
      const url = `https://npiregistry.cms.hhs.gov/provider-view/${r.number}`;
      out.push(claim('url', url, 'registered healthcare provider', 0.35, { url, snippet: `${[b.credential, arr<any>(r.taxonomies)[0]?.desc].filter(Boolean).join(', ')}. ${NAMESAKE}`, attrs: { npi: String(r.number) } }));
      const a = arr<any>(r.addresses).find((x) => x.address_purpose === 'LOCATION') ?? arr<any>(r.addresses)[0];
      if (a) { const place = joinPlace(str(a.city), str(a.state)); if (place) out.push(claim('location', place, 'practice location', 0.35, { url, conflictKey: 'location', snippet: NAMESAKE })); if (str(a.telephone_number)) out.push(claim('phone', str(a.telephone_number), 'practice phone', 0.4, { url, snippet: NAMESAKE })); }
    }
    return out;
  },
});

export const icij = def({
  id: 'icij', name: 'ICIJ Offshore Leaks', desc: 'Whether a name appears in the public Panama, Paradise and Pandora Papers database. Appearing is not evidence of wrongdoing.', homepage: 'https://offshoreleaks.icij.org',
  accepts: ['person', 'org'], cap: 'public-figure', family: 'icij', rel: 0.7, ttl: 24 * 3600_000, interval: 1500, self: ['org', 'Mossack Fonseca'],
  asked: (qq) => `Searched the ICIJ Offshore Leaks database for ${qq}`, check: (_t, v) => `https://offshoreleaks.icij.org/search?q=${enc(v)}&c=&j=&d=`,
  async run(e, ctx) {
    const res = await ctx.fetch('https://offshoreleaks.icij.org/api/v1/reconcile', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `queries=${enc(JSON.stringify({ q0: { query: e.value, limit: 5 } }))}` });
    if (res.status === 404) return []; if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j: any = await res.json().catch(() => null);
    return arr<any>(j?.q0?.result).filter((r) => r.match === true || Number(r.score) >= 90).slice(0, 3).map((r) => claim('url', `https://offshoreleaks.icij.org/nodes/${r.id}`, 'appears in ICIJ Offshore Leaks', 0.3, { url: `https://offshoreleaks.icij.org/nodes/${r.id}`, snippet: `${str(r.name)} (${arr<any>(r.type).map((t) => t.name).join(', ') || 'entry'}). Appearing in this database is not evidence of wrongdoing, and names are often shared.`, attrs: { score: Number(r.score) || 0 } }));
  },
});

export const opensanctions = def({
  id: 'opensanctions', name: 'OpenSanctions', desc: 'Sanctions lists, politically exposed persons and watch lists from around the world. Needs an API key (free for non-commercial use).', homepage: 'https://www.opensanctions.org',
  accepts: ['person', 'org'], cap: 'public-figure', family: 'opensanctions', rel: 0.85, ttl: 12 * 3600_000, self: ['org', 'Wagner Group'], key: { help: 'Key from opensanctions.org/api (free for non-commercial use)' },
  asked: (qq) => `Searched OpenSanctions for ${qq}`, check: (_t, v) => `https://www.opensanctions.org/search/?q=${enc(v)}`,
  async run(e, ctx) {
    if (!ctx.key) return [];
    const j = await getJson<any>(ctx, `https://api.opensanctions.org/search/default?q=${enc(e.value)}&limit=5`, { headers: { Authorization: `ApiKey ${ctx.key}` } });
    return arr<any>(j?.results).filter((r) => strip(str(r.caption)) === strip(e.value) || arr<string>(r.properties?.alias).some((x) => strip(x) === strip(e.value))).slice(0, 3).map((r) => {
      const url = `https://www.opensanctions.org/entities/${r.id}/`; const topics = arr<string>(r.properties?.topics).join(', ');
      return claim('url', url, 'listed on a sanctions or watch list', 0.5, { url, snippet: `${str(r.caption)}${topics ? ` · ${topics}` : ''} · ${arr<string>(r.datasets).slice(0, 3).join(', ')}. ${NAMESAKE}`, attrs: { schema: str(r.schema) } });
    });
  },
});

export const leakcheck = def({
  id: 'leakcheck', name: 'LeakCheck (public)', desc: 'Which breaches an email appeared in, and which kinds of data leaked, without showing the data.', homepage: 'https://leakcheck.io',
  accepts: ['email'], cap: 'breaches', family: 'leakcheck', rel: 0.75, prio: 3, interval: 1500, self: ['email', 'test@example.com'],
  asked: (qq) => `Asked LeakCheck whether ${qq} appears in breaches`, check: (_t, v) => `https://leakcheck.io/?q=${enc(v)}`,
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://leakcheck.io/api/public?check=${enc(e.value)}`); if (!j?.success || !Number(j.found)) return [];
    const fields = arr<string>(j.fields).join(', ');
    return arr<any>(j.sources).slice(0, 25).map((s) => claim('breach', str(s.name), 'appeared in', 0.8, { url: 'https://leakcheck.io/', snippet: `${str(s.date) ? `Leaked ${str(s.date)}. ` : ''}${fields ? `Data types: ${fields}` : 'Reported by LeakCheck'}`, record: rec(`Breach: ${str(s.name)}`, [['Address checked', e.value], ['Breach', s.name], ['Date', s.date], ['Data types', fields], ['Listed by', 'LeakCheck']]) }));
  },
});

export const hudsonrock = def({
  id: 'hudsonrock', name: 'Hudson Rock (infostealers)', desc: 'Whether an email address shows up in logs stolen from infected computers, and when. Only the fact and date are used, never the stolen data.', homepage: 'https://www.hudsonrock.com',
  accepts: ['email'], cap: 'infostealers', family: 'hudsonrock', rel: 0.75, interval: 2000, self: ['email', 'test@example.com'],
  asked: (qq) => `Asked Hudson Rock whether ${qq} appears in infostealer logs`, check: (_t, v) => `https://www.hudsonrock.com/search?q=${enc(v)}`,
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${enc(e.value)}`); const st = arr<any>(j?.stealers); if (!st.length) return [];
    return st.slice(0, 5).map((s, i) => claim('breach', `Infostealer log${st.length > 1 ? ` ${i + 1}` : ''}`, 'appeared in', 0.7, { url: 'https://www.hudsonrock.com/', when: str(s.date_compromised).slice(0, 10) || undefined, snippet: `Malware on a computer${str(s.operating_system) ? ` running ${str(s.operating_system)}` : ''} stole this address${str(s.date_compromised) ? ` around ${str(s.date_compromised).slice(0, 10)}` : ''}`, record: rec('Infostealer exposure', [['Address checked', e.value], ['Date compromised', str(s.date_compromised).slice(0, 10)], ['Operating system', s.operating_system], ['Computer name', s.computer_name], ['Malware', s.malware_path ? 'present' : ''], ['Listed by', 'Hudson Rock']]) }));
  },
});

export const veriphone = def({
  id: 'veriphone', name: 'Veriphone', desc: 'Whether a phone number is real, its line type (mobile, landline, VoIP) and carrier. Needs a free API key.', homepage: 'https://veriphone.io',
  accepts: ['phone'], cap: 'phone-intel', family: 'veriphone', rel: 0.8, ttl: 24 * 3600_000, self: ['phone', '+14155552671'], key: { help: 'Free key from veriphone.io (1,000 lookups a month)' },
  asked: (qq) => `Asked Veriphone about ${qq}`, check: (_t, v) => `https://veriphone.io/?phone=${enc(v)}`,
  async run(e, ctx) {
    if (!ctx.key) return [];
    const j = await getJson<any>(ctx, `https://api.veriphone.io/v2/verify?phone=${enc(e.value)}&key=${enc(ctx.key)}`); if (!j || j.status !== 'success') return [];
    const out: Claim[] = [];
    if (str(j.carrier)) out.push(claim('org', j.carrier, 'phone carrier', 0.7, { snippet: `Line type: ${str(j.phone_type) || 'unknown'}` }));
    const place = joinPlace(str(j.phone_region), str(j.country)); if (place) out.push(claim('location', place, 'number registered in', 0.4, { conflictKey: 'location', snippet: 'Where the number block was issued, not where the person is' }));
    return withRecord(out, rec('Phone line (Veriphone)', [['Number', j.international_number || e.value], ['Valid', j.phone_valid ? 'yes' : 'no'], ['Type', j.phone_type], ['Carrier', j.carrier], ['Region', j.phone_region], ['Country', j.country]]));
  },
});

const webClaims = (rows: { title?: string; url?: string; snippet?: string }[], who: string): Claim[] => rows.filter((r) => /^https?:\/\//.test(str(r.url))).slice(0, 8).map((r) => claim('url', str(r.url), 'web page that mentions this', 0.25, { url: str(r.url), snippet: `${str(r.title)}${str(r.snippet) ? `: ${str(r.snippet).slice(0, 160)}` : ''} (${who})` }));
const WEB_TYPES = ['email', 'username', 'person', 'phone', 'org', 'wallet'] as const;
export const brave = def({
  id: 'brave', name: 'Brave Search', desc: 'Web pages that mention an email, name, username or number, as a lead generator. Needs an API key.', homepage: 'https://brave.com/search/api/',
  accepts: [...WEB_TYPES], cap: 'web-search', family: 'brave', rel: 0.5, ttl: 6 * 3600_000, interval: 1100, self: ['username', 'torvalds'], key: { help: 'Free key from brave.com/search/api (2,000 searches a month)' },
  asked: (qq) => `Searched the web with Brave for “${qq}”`, check: (_t, v) => `https://search.brave.com/search?q=${enc(q(v))}`,
  async run(e, ctx) {
    if (!ctx.key) return [];
    const j = await getJson<any>(ctx, `https://api.search.brave.com/res/v1/web/search?q=${enc(q(e.value))}&count=10`, { headers: { 'X-Subscription-Token': ctx.key, Accept: 'application/json' } });
    return webClaims(arr<any>(j?.web?.results).map((r) => ({ title: r.title, url: r.url, snippet: String(r.description ?? '').replace(/<[^>]+>/g, '') })), 'Brave');
  },
});

export const serper = def({
  id: 'serper', name: 'Google results (Serper)', desc: 'Google search results for an exact email, name, username or number, through Serper.dev. Needs an API key.', homepage: 'https://serper.dev',
  accepts: [...WEB_TYPES], cap: 'web-search', family: 'serper', rel: 0.5, ttl: 6 * 3600_000, interval: 1100, self: ['username', 'torvalds'], key: { help: 'Free key from serper.dev (2,500 searches to start)' },
  asked: (qq) => `Searched Google (through Serper) for “${qq}”`, check: (_t, v) => `https://www.google.com/search?q=${enc(q(v))}`,
  async run(e, ctx) {
    if (!ctx.key) return [];
    const res = await ctx.fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': ctx.key, 'content-type': 'application/json' }, body: JSON.stringify({ q: q(e.value), num: 10 }) });
    if (res.status === 429) { const { RateLimitedError } = await import('../types'); throw new RateLimitedError(); } if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status}`); if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j: any = await res.json().catch(() => null);
    return webClaims(arr<any>(j?.organic).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet })), 'Google');
  },
});

export const recordAdapters = [ens, blockchair, wikiGeosearch, nominatim, openalex, orcid, fec, npi, icij, opensanctions, leakcheck, hudsonrock, veriphone, brave, serper];
void iso;
