import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { Claim } from '../../../shared/types';
import { nameSimilarity } from '../../../shared/normalize';
import type { Adapter } from '../types';
import { adapter, arr, claim, countryName, getJson, iso, joinPlace, rec, str, withRecord } from './util';

// ---------------------------------------------------------------------------------------------------------------
// Phone numbers: fully offline (libphonenumber metadata)
// ---------------------------------------------------------------------------------------------------------------
export const phone = adapter({
  id: 'phone-offline', name: 'Phone number analysis', description: 'Validity, country and line type from numbering-plan metadata. Offline.',
  accepts: ['phone'], capability: 'phone-intel', family: 'libphonenumber', reliability: 0.9, priority: 0, anyMode: true,
  selfTest: { type: 'phone', value: '+14155552671' },
  async run(e) {
    const p = parsePhoneNumberFromString(e.value, 'US');
    if (!p) return [];
    const out: Claim[] = [];
    const type = (p.getType() ?? '').toString().replace(/_/g, ' ').toLowerCase();
    const country = p.country ? countryName(p.country) : '';
    const snippet = [p.isValid() ? 'Valid numbering-plan format' : 'Format looks possible but not assigned', type && `line type: ${type}`, `calling code +${p.countryCallingCode}`].filter(Boolean).join(' · ');
    if (country) out.push(claim('location', country, 'number registered in', 0.45, { snippet, attrs: { lineType: type || 'unknown', e164: p.number, national: p.formatNational() } }));
    return withRecord(out, rec('Phone number analysis', [['Number', p.formatInternational()], ['Country', country], ['Line type', type || 'unknown'], ['Valid numbering-plan format', p.isValid() ? 'Yes' : 'No']]));
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Companies & public figures
// ---------------------------------------------------------------------------------------------------------------
export const gleif = adapter({
  id: 'gleif', name: 'Company registry (GLEIF)', description: 'Legal entity records: official name, jurisdiction, registered address and status.', homepage: 'https://www.gleif.org',
  accepts: ['org'], capability: 'org-registry', family: 'gleif', reliability: 0.88, minIntervalMs: 600, cacheTtlMs: 24 * 3600_000,
  selfTest: { type: 'org', value: 'Apple Inc.' },
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalName%5D=${encodeURIComponent(e.value)}&page%5Bsize%5D=5`, { headers: { Accept: 'application/vnd.api+json' } });
    let rows = arr<any>(j?.data);
    if (!rows.length) rows = arr<any>((await getJson<any>(ctx, `https://api.gleif.org/api/v1/lei-records?filter%5Bfulltext%5D=${encodeURIComponent(e.value)}&page%5Bsize%5D=3`, { headers: { Accept: 'application/vnd.api+json' } }))?.data);
    const out: Claim[] = [];
    for (const r of rows.slice(0, 3)) {
      const en = r.attributes?.entity ?? {};
      const legal = str(en.legalName?.name);
      if (!legal || nameSimilarity(legal, e.value) < 0.6) continue;
      const url = `https://search.gleif.org/#/record/${r.id}`;
      const w = nameSimilarity(legal, e.value) >= 0.95 ? 0.8 : 0.55;
      const a = en.headquartersAddress ?? en.legalAddress ?? {};
      const place = joinPlace(str(a.city), str(a.region).replace(/^[A-Z]{2}-/, ''), countryName(str(a.country)));
      const record = rec('GLEIF legal-entity record', [['Legal name', legal], ['LEI', r.id], ['Status', en.status], ['Jurisdiction', en.jurisdiction], ['Registered address', place]]);
      out.push(claim('org', legal, 'registered legal entity', w, { url, attrs: { lei: str(r.id), status: str(en.status), jurisdiction: str(en.jurisdiction) }, snippet: `LEI ${r.id} · ${str(en.status) || 'status unknown'} · ${str(en.jurisdiction)}`, record }));
      if (place) out.push(claim('location', place, 'registered address', w, { url, conflictKey: 'org-hq', snippet: 'Official legal / headquarters address', record }));
    }
    return out;
  },
});

export const wikidata = adapter({
  id: 'wikidata', name: 'Public figures (Wikidata)', description: 'Flags when a name matches a notable person or organization. Shown weak on purpose: name collisions are common.', homepage: 'https://www.wikidata.org',
  accepts: ['person', 'org'], capability: 'public-figure', family: 'wikidata', reliability: 0.4, minIntervalMs: 600,
  selfTest: { type: 'person', value: 'Ada Lovelace' },
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(e.value)}&language=en&format=json&limit=5&type=item&origin=*`);
    const out: Claim[] = [];
    for (const r of arr<any>(j?.search)) {
      if (!str(r.description) || nameSimilarity(str(r.label), e.value) < 0.95) continue;
      out.push(claim('url', `https://www.wikidata.org/wiki/${r.id}`, 'possible public-figure match', 0.2, { snippet: `${r.label} — ${r.description}. Name match only; may be a different person.`, url: `https://www.wikidata.org/wiki/${r.id}` }));
      if (out.length >= 2) break;
    }
    return out;
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Bitcoin
// ---------------------------------------------------------------------------------------------------------------
export const blockstream = adapter({
  id: 'blockstream', name: 'Bitcoin (Blockstream)', description: 'Balance, activity and addresses spent together with this one (the common-input heuristic).', homepage: 'https://blockstream.info',
  accepts: ['wallet'], capability: 'chain', family: 'btc-chain', reliability: 0.9, minIntervalMs: 800,
  selfTest: { type: 'wallet', value: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' },
  async run(e, ctx) {
    if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(e.value)) return [];
    const a = await getJson<any>(ctx, `https://blockstream.info/api/address/${encodeURIComponent(e.value)}`);
    if (!a) return [];
    const cs = a.chain_stats ?? {};
    const bal = ((Number(cs.funded_txo_sum) || 0) - (Number(cs.spent_txo_sum) || 0)) / 1e8;
    const out: Claim[] = [claim('url', `https://blockstream.info/address/${e.value}`, 'on-chain activity', 0.95, { snippet: `${cs.tx_count ?? 0} transactions · balance ${bal} BTC · received ${((Number(cs.funded_txo_sum) || 0) / 1e8).toFixed(4)} BTC` })];
    const txs = arr<any>(await getJson(ctx, `https://blockstream.info/api/address/${encodeURIComponent(e.value)}/txs`).catch(() => []));
    const co = new Map<string, { n: number; when?: string; tx: string }>();
    for (const t of txs.slice(0, 25)) {
      const inputs = [...new Set(arr<any>(t.vin).map((v) => str(v.prevout?.scriptpubkey_address)).filter(Boolean))];
      if (inputs.length < 2 || !inputs.includes(e.value)) continue;
      for (const o of inputs) if (o !== e.value) { const c = co.get(o) ?? { n: 0, when: iso(t.status?.block_time), tx: str(t.txid) }; c.n++; co.set(o, c); }
    }
    for (const [addr, c] of [...co].slice(0, 10)) out.push(claim('wallet', addr, 'spent together with', Math.min(0.7, 0.5 + c.n * 0.05), { when: c.when, snippet: `Inputs of the same transaction (${c.tx.slice(0, 10)}…). Common-input heuristic: likely same owner, but CoinJoins break it.`, url: `https://blockstream.info/tx/${c.tx}` }));
    return out;
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Hunter (key)
// ---------------------------------------------------------------------------------------------------------------
export const hunter = adapter({
  id: 'hunter', name: 'Hunter', description: 'Email addresses, names and roles found publicly for a company domain.', homepage: 'https://hunter.io',
  accepts: ['domain'], capability: 'domain-emails', family: 'hunter', reliability: 0.8, requiresKey: 'hunter', keyHelp: 'Free tier: 25 searches/month', minIntervalMs: 1000,
  selfTest: { type: 'domain', value: 'stripe.com' },
  async run(e, ctx) {
    const j = await getJson<any>(ctx, `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(e.value)}&limit=30&api_key=${encodeURIComponent(ctx.key ?? '')}`);
    const d = j?.data;
    if (!d) return [];
    const out: Claim[] = [];
    if (str(d.organization)) out.push(claim('org', d.organization, 'organization', 0.7, { snippet: d.pattern ? `Email pattern: ${d.pattern}@${e.value}` : undefined }));
    for (const m of arr<any>(d.emails)) {
      const w = Math.min(0.9, (Number(m.confidence) || 50) / 100 * 0.9);
      const src = arr<any>(m.sources)[0];
      out.push(claim('email', str(m.value), 'email at this domain', w, { snippet: [str(m.position), src?.uri && `source: ${src.uri}`].filter(Boolean).join(' · ') || undefined, url: str(src?.uri) || undefined }));
      const name = [str(m.first_name), str(m.last_name)].filter(Boolean).join(' ');
      if (name) out.push(claim('person', name, 'works at this domain', Math.min(0.6, w), { snippet: str(m.position) || undefined }));
    }
    return out.filter((c) => c.value);
  },
});

export const miscAdapters: Adapter[] = [phone, gleif, wikidata, blockstream, hunter];
