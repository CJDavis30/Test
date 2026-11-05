import { describe, it, expect, beforeEach } from 'vitest';
import { keyFor } from '../shared/normalize';
import { makeCtx } from '../server/http';
import { RateLimitedError, type Adapter, type AdapterCtx } from '../server/adapters/types';
import type { EntityType } from '../shared/types';
import * as P from '../server/adapters/live/more-profiles';
import * as N from '../server/adapters/live/more-network';
import * as R from '../server/adapters/live/more-records';
import { wmnSweep, verdict, resetWmn, WMN_URL, type WmnSite } from '../server/adapters/live/wmn';
import { liveAdapters } from '../server/adapters/live/index';
import { linkClaim } from '../server/adapters/live/kit';

type Route = [RegExp | string, { status?: number; body?: unknown; headers?: Record<string, string> }];
function fake(routes: Route[], key?: string): AdapterCtx & { calls: string[]; inits: any[] } {
  const calls: string[] = [], inits: any[] = [];
  const ctx = makeCtx(new AbortController().signal, key);
  const f = async (url: string, init?: any) => {
    calls.push(url); inits.push(init);
    const hit = routes.find(([m]) => (typeof m === 'string' ? url.includes(m) : m.test(url)));
    if (!hit) return new Response('', { status: 404 });
    const { status = 200, body = {}, headers } = hit[1];
    if (status === 429) throw new RateLimitedError();
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  };
  return Object.assign(ctx, { calls, inits, fetch: f as any, json: async (u: string) => (await f(u)).json(), text: async (u: string) => (await f(u)).text() });
}
const run = (a: Adapter, type: EntityType, value: string, ctx: AdapterCtx) => a.run({ type, value, key: keyFor(type, value) }, ctx);
const has = (cs: { type: string; value: string }[], type: string, v: string | RegExp) => cs.some((c) => c.type === type && (typeof v === 'string' ? c.value === v : v.test(c.value)));

interface Case { a: Adapter; type: EntityType; value: string; routes: Route[]; expect: [string, string | RegExp][]; key?: string }
const CASES: Case[] = [
  { a: P.codeberg, type: 'username', value: 'mara', routes: [['codeberg.org/api/v1/users/mara', { body: { login: 'mara', full_name: 'Mara Linden', location: 'Austin', website: 'https://github.com/maralinden', created: '2020-05-01T10:00:00Z', html_url: 'https://codeberg.org/mara', description: 'mail mara@lindenmade.example' } }]], expect: [['account', 'https://codeberg.org/mara'], ['person', 'Mara Linden'], ['location', 'Austin'], ['account', 'https://github.com/maralinden'], ['email', 'mara@lindenmade.example']] },
  { a: P.bitbucket, type: 'username', value: 'mara', routes: [['workspaces/mara', { body: { slug: 'mara', name: 'Mara L', created_on: '2019-01-02T00:00:00Z', links: { html: { href: 'https://bitbucket.org/mara/' } } } }]], expect: [['account', 'https://bitbucket.org/mara/'], ['person', 'Mara L']] },
  { a: P.npm, type: 'username', value: 'mara', routes: [['registry.npmjs.org/-/v1/search', { body: { objects: [{ package: { name: 'tinylib', maintainers: [{ username: 'mara', email: 'Mara@Lindenmade.example' }], links: { repository: 'git+https://github.com/maralinden/tinylib.git' } } }, { package: { name: 'other', maintainers: [{ username: 'someone', email: 'x@y.example' }] } }] } }]], expect: [['account', 'https://www.npmjs.com/~mara'], ['email', 'mara@lindenmade.example'], ['account', 'https://github.com/maralinden']] },
  { a: P.crates, type: 'username', value: 'mara', routes: [['crates.io/api/v1/users/mara', { body: { user: { login: 'mara', name: 'Mara Linden', url: 'https://github.com/mara' } } }]], expect: [['account', 'https://crates.io/users/mara'], ['person', 'Mara Linden']] },
  { a: P.dockerhub, type: 'username', value: 'mara', routes: [['hub.docker.com/v2/users/mara/', { body: { username: 'mara', full_name: 'Mara Linden', location: 'Austin, TX', company: 'Northwind Labs', date_joined: '2018-03-04T00:00:00Z' } }]], expect: [['account', 'https://hub.docker.com/u/mara'], ['org', 'Northwind Labs'], ['location', 'Austin, TX']] },
  { a: P.stackexchange, type: 'username', value: 'Mara Linden', routes: [['api.stackexchange.com/2.3/users', { body: { items: [{ display_name: 'Mara Lindenberg', link: 'https://stackoverflow.com/users/2/x' }, { display_name: 'Mara Linden', link: 'https://stackoverflow.com/users/1/mara-linden', location: 'Texas', website_url: 'https://lindenmade.example', creation_date: 1500000000, reputation: 4100 }] } }]], expect: [['account', 'https://stackoverflow.com/users/1/mara-linden'], ['location', 'Texas'], ['url', 'https://lindenmade.example']] },
  { a: P.lichess, type: 'username', value: 'mara', routes: [['lichess.org/api/user/mara', { body: { username: 'mara', createdAt: 1500000000000, profile: { firstName: 'Mara', lastName: 'Linden', country: 'US', location: 'Austin', bio: 'hi', links: 'https://twitch.tv/maralinden' } } }]], expect: [['account', 'https://lichess.org/@/mara'], ['person', 'Mara Linden'], ['account', 'https://twitch.tv/maralinden']] },
  { a: P.chesscom, type: 'username', value: 'Mara', routes: [['api.chess.com/pub/player/mara', { body: { username: 'mara', url: 'https://www.chess.com/member/mara', name: 'Mara Linden', location: 'Austin', country: 'https://api.chess.com/pub/country/US', joined: 1500000000, player_id: 7 } }]], expect: [['account', 'https://www.chess.com/member/mara'], ['person', 'Mara Linden'], ['location', /Austin/]] },
  { a: P.speedrun, type: 'username', value: 'mara', routes: [['speedrun.com/api/v1/users', { body: { data: [{ id: 'x', names: { international: 'mara' }, weblink: 'https://www.speedrun.com/users/mara', signup: '2019-06-01T00:00:00Z', twitch: { uri: 'https://www.twitch.tv/maralive' }, twitter: { uri: 'https://twitter.com/maralinden' }, youtube: { uri: 'https://www.youtube.com/@maramakes' }, location: { country: { names: { international: 'United States' } } } }] } }]], expect: [['account', 'https://www.twitch.tv/maralive'], ['account', 'https://twitter.com/maralinden'], ['account', /youtube\.com\/@maramakes/], ['location', 'United States']] },
  { a: P.steamCommunity, type: 'username', value: 'mara', routes: [['steamcommunity.com/id/mara?xml=1', { body: '<profile><steamID64>76561198000000001</steamID64><steamID><![CDATA[Mara]]></steamID><customURL><![CDATA[mara]]></customURL><memberSince>March 4, 2014</memberSince><realname><![CDATA[Mara Linden]]></realname><location><![CDATA[Austin, Texas]]></location><privacyState>public</privacyState><summary><![CDATA[mail mara@lindenmade.example]]></summary></profile>' }]], expect: [['account', 'https://steamcommunity.com/profiles/76561198000000001'], ['person', 'Mara Linden'], ['location', 'Austin, Texas'], ['email', 'mara@lindenmade.example']] },
  { a: P.minecraft, type: 'username', value: 'Notch', routes: [['playerdb.co/api/player/minecraft/Notch', { body: { success: true, data: { player: { username: 'Notch', id: '069a79f4-44e9-4726-a5be-fca90e38aaf5', meta: { name_history: [{ name: 'Notch' }, { name: 'Marcus' }] } } } } }]], expect: [['account', 'https://namemc.com/profile/Notch'], ['username', 'Marcus']] },
  { a: P.xbox, type: 'username', value: 'Mara', routes: [['playerdb.co/api/player/xbox/Mara', { body: { success: true, data: { player: { username: 'Mara', id: '2533274', meta: { realName: 'Mara Linden', location: 'Austin' } } } } }]], expect: [['account', /xboxgamertag\.com/], ['person', 'Mara Linden']] },
  { a: P.mastodon, type: 'username', value: 'mara', routes: [['mastodon.social/api/v1/accounts/lookup?acct=mara', { body: { id: '1', username: 'mara', url: 'https://mastodon.social/@mara', display_name: 'Mara', created_at: '2021-01-01T00:00:00Z', note: '<p>builder</p>', fields: [{ name: 'Web', value: '<a href="https://lindenmade.example">https://lindenmade.example</a>', verified_at: '2024-01-01T00:00:00Z' }] } }]], expect: [['account', 'https://mastodon.social/@mara'], ['url', 'https://lindenmade.example']] },
  { a: P.lobsters, type: 'username', value: 'mara', routes: [['lobste.rs/u/mara.json', { body: { username: 'mara', created_at: '2020-01-01T00:00:00Z', github_username: 'maralinden', twitter_username: 'maralinden', homepage: 'https://lindenmade.example', invited_by_user: 'jcs' } }]], expect: [['account', 'https://github.com/maralinden'], ['account', 'https://x.com/maralinden'], ['url', 'https://lindenmade.example']] },
  { a: P.telegram, type: 'username', value: 'maralinden', routes: [['t.me/maralinden', { body: '<html><head><meta property="og:title" content="Mara Linden"><meta property="og:description" content="builder. mara@lindenmade.example"></head><div class="tgme_page_extra">@maralinden</div></html>' }]], expect: [['account', 'https://t.me/maralinden'], ['person', 'Mara Linden'], ['email', 'mara@lindenmade.example']] },
  { a: P.youtube, type: 'username', value: 'maramakes', routes: [['youtube.com/@maramakes', { body: '<html><meta property="og:title" content="Mara Makes"><meta property="og:description" content="Woodworking. Business: mara@lindenmade.example"><script>{"channelId":"UCabcdefghijklmnopqrstuv"}</script></html>' }]], expect: [['account', 'https://www.youtube.com/@maramakes'], ['email', 'mara@lindenmade.example']] },
  { a: P.linktree, type: 'username', value: 'maralinden', routes: [['linktr.ee/maralinden', { body: `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { account: { username: 'maralinden', pageTitle: 'Mara Linden', description: 'Maker' }, socialLinks: [{ type: 'INSTAGRAM', url: 'https://www.instagram.com/maramakes' }], links: [{ title: 'Shop', url: 'https://shop.lindenmade.example' }, { title: 'TikTok', url: 'https://www.tiktok.com/@maramakes' }] } } })}</script></html>` }]], expect: [['account', 'https://www.instagram.com/maramakes'], ['account', 'https://www.tiktok.com/@maramakes'], ['url', 'https://shop.lindenmade.example'], ['person', 'Mara Linden']] },
  { a: P.gravatarUser, type: 'username', value: 'mara', routes: [['gravatar.com/mara.json', { body: { entry: [{ hash: 'abc', profileUrl: 'https://gravatar.com/mara', displayName: 'Mara Linden', currentLocation: 'Austin', accounts: [{ url: 'https://github.com/maralinden', verified: true, shortname: 'github' }], photos: [{ value: 'https://0.gravatar.com/avatar/abc' }] }] } }]], expect: [['account', 'https://github.com/maralinden'], ['person', 'Mara Linden'], ['location', 'Austin']] },
  { a: P.codeforces, type: 'username', value: 'mara', routes: [['codeforces.com/api/user.info', { body: { status: 'OK', result: [{ handle: 'mara', firstName: 'Mara', lastName: 'Linden', city: 'Austin', country: 'USA', organization: 'UT Austin', registrationTimeSeconds: 1500000000 }] } }]], expect: [['account', 'https://codeforces.com/profile/mara'], ['person', 'Mara Linden'], ['org', 'UT Austin']] },
  { a: P.codewars, type: 'username', value: 'mara', routes: [['codewars.com/api/v1/users/mara', { body: { username: 'mara', name: 'Mara Linden', clan: 'Northwind', ranks: { overall: { name: '3 kyu' } } } }]], expect: [['account', 'https://www.codewars.com/users/mara'], ['org', 'Northwind']] },
  { a: P.huggingface, type: 'username', value: 'mara', routes: [['huggingface.co/api/users/mara/overview', { body: { name: 'mara', fullname: 'Mara Linden', createdAt: '2022-02-02T00:00:00Z', numModels: 3 } }]], expect: [['account', 'https://huggingface.co/mara'], ['person', 'Mara Linden']] },
  { a: P.launchpad, type: 'username', value: 'mara', routes: [['api.launchpad.net/1.0/~mara', { body: { name: 'mara', display_name: 'Mara Linden', date_created: '2012-01-01T00:00:00+00:00', web_link: 'https://launchpad.net/~mara', time_zone: 'America/Chicago' } }]], expect: [['account', 'https://launchpad.net/~mara'], ['person', 'Mara Linden'], ['location', 'America/Chicago'.replace('_', ' ')]] },
  { a: P.robloxSearch, type: 'username', value: 'maralinden', routes: [['users.roblox.com/v1/users/search', { body: { data: [{ id: 1, name: 'maralinden' }, { id: 2, name: 'maralinden_' }, { id: 3, name: 'mara_linden' }] } }]], expect: [['account', 'https://www.roblox.com/users/2/profile'], ['account', 'https://www.roblox.com/users/3/profile']] },
  { a: P.lastfm, type: 'username', value: 'mara', key: 'KEY', routes: [['ws.audioscrobbler.com/2.0/', { body: { user: { name: 'mara', realname: 'Mara Linden', country: 'United States', url: 'https://www.last.fm/user/mara', registered: { unixtime: '1400000000' } } } }]], expect: [['person', 'Mara Linden'], ['location', 'United States']] },
  { a: P.steamApi, type: 'username', value: 'mara', key: 'KEY', routes: [['ResolveVanityURL', { body: { response: { steamid: '76561198000000001', success: 1 } } }], ['GetPlayerSummaries', { body: { response: { players: [{ steamid: '76561198000000001', personaname: 'Mara', realname: 'Mara Linden', timecreated: 1400000000, loccountrycode: 'US', profileurl: 'https://steamcommunity.com/id/mara/' }] } } }]], expect: [['account', 'https://steamcommunity.com/id/mara/'], ['person', 'Mara Linden']] },
  { a: P.faceit, type: 'username', value: 'mara', key: 'KEY', routes: [['open.faceit.com/data/v4/players', { body: { player_id: 'abc', nickname: 'mara', country: 'us', steam_id_64: '76561198000000001', activated_at: '2020-01-01T00:00:00Z', faceit_url: 'https://www.faceit.com/{lang}/players/mara' } }]], expect: [['account', 'https://www.faceit.com/en/players/mara'], ['account', 'https://steamcommunity.com/profiles/76561198000000001']] },

  { a: N.ipinfo, type: 'ip', value: '203.0.113.9', routes: [['ipinfo.io/203.0.113.9/json', { body: { ip: '203.0.113.9', hostname: 'host.provider.example', city: 'Austin', region: 'Texas', country: 'US', loc: '30.26,-97.74', org: 'AS64500 Provider Inc' } }]], expect: [['location', /Austin/], ['org', 'Provider Inc'], ['domain', 'host.provider.example']] },
  { a: N.ipapiCo, type: 'ip', value: '203.0.113.9', routes: [['ipapi.co/203.0.113.9/json', { body: { ip: '203.0.113.9', city: 'Austin', region: 'Texas', country_name: 'United States', org: 'Provider Inc' } }]], expect: [['location', /Austin/], ['org', 'Provider Inc']] },
  { a: N.bgpview, type: 'ip', value: '203.0.113.9', routes: [['api.bgpview.io/ip/', { body: { data: { ptr_record: 'host.provider.example', prefixes: [{ prefix: '203.0.113.0/24', asn: { asn: 64500, name: 'PROVIDER', description: 'Provider Inc' } }], rir_allocation: { country_code: 'US' } } } }]], expect: [['org', 'Provider Inc'], ['domain', 'host.provider.example']] },
  { a: N.ripestat, type: 'ip', value: '203.0.113.9', routes: [['abuse-contact-finder', { body: { data: { abuse_contacts: ['abuse@provider.example'] } } }], ['as-overview', { body: { data: { holder: 'PROVIDER - Provider Inc', asn: 64500 } } }]], expect: [['email', 'abuse@provider.example'], ['org', /Provider Inc/]] },
  { a: N.siteFiles, type: 'domain', value: 'lindenmade.example', routes: [['.well-known/security.txt', { body: 'Contact: mailto:security@lindenmade.example\nContact: https://lindenmade.example/report\nPolicy: https://lindenmade.example/policy\n' }], ['humans.txt', { body: '/* TEAM */\nDeveloper: Mara Linden\nTwitter: @maralinden\n/* SITE */\n' }]], expect: [['email', 'security@lindenmade.example'], ['person', 'Mara Linden'], ['username', 'maralinden']] },
  { a: N.waybackCdx, type: 'domain', value: 'lindenmade.example', routes: [['web.archive.org/cdx/search/cdx', { body: [['timestamp', 'original', 'statuscode'], ['20090312094500', 'http://lindenmade.example/', '200']] }]], expect: [['url', /web\.archive\.org\/web\/20090312094500/]] },
  { a: N.greynoise, type: 'ip', value: '8.8.8.8', routes: [['api.greynoise.io/v3/community/8.8.8.8', { body: { ip: '8.8.8.8', noise: false, riot: true, classification: 'benign', name: 'Google Public DNS', link: 'https://viz.greynoise.io/ip/8.8.8.8' } }]], expect: [['org', 'Google Public DNS']] },
  { a: N.virustotal, type: 'domain', value: 'lindenmade.example', key: 'KEY', routes: [['virustotal.com/api/v3/domains/', { body: { data: { attributes: { last_analysis_stats: { malicious: 2, suspicious: 1, harmless: 60 }, registrar: 'Example Registrar', creation_date: 1300000000 } } } }]], expect: [['url', /virustotal\.com\/gui\/domain/], ['org', 'Example Registrar']] },
  { a: N.shodan, type: 'ip', value: '203.0.113.9', key: 'KEY', routes: [['api.shodan.io/shodan/host/203.0.113.9', { body: { ip_str: '203.0.113.9', org: 'Provider Inc', hostnames: ['a.provider.example'], ports: [22, 443], city: 'Austin', country_name: 'United States' } }]], expect: [['domain', 'a.provider.example'], ['org', 'Provider Inc']] },
  { a: N.securitytrails, type: 'domain', value: 'lindenmade.example', key: 'KEY', routes: [['api.securitytrails.com/v1/domain/lindenmade.example/subdomains', { body: { subdomains: ['www', 'mail', 'vpn'] } }]], expect: [['domain', 'vpn.lindenmade.example']] },
  { a: N.abuseipdb, type: 'ip', value: '203.0.113.9', key: 'KEY', routes: [['api.abuseipdb.com/api/v2/check', { body: { data: { abuseConfidenceScore: 55, totalReports: 12, isp: 'Provider Inc', domain: 'provider.example', countryCode: 'US' } } }]], expect: [['org', 'Provider Inc'], ['domain', 'provider.example']] },

  { a: R.ens, type: 'username', value: 'mara.eth', routes: [['api.ensdata.net/mara.eth', { body: { ens: 'mara.eth', address: '0x1234567890123456789012345678901234567890', twitter: 'maralinden', github: 'maralinden', discord: 'mara#0', email: 'mara@lindenmade.example', url: 'https://lindenmade.example' } }]], expect: [['wallet', '0x1234567890123456789012345678901234567890'], ['account', 'https://x.com/maralinden'], ['account', 'https://github.com/maralinden'], ['email', 'mara@lindenmade.example']] },
  { a: R.blockchair, type: 'wallet', value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', routes: [['api.blockchair.com/bitcoin/dashboards/address/', { body: { data: { '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa': { address: { balance: 6800000000, transaction_count: 4800, first_seen_receiving: '2009-01-03 18:15:05', last_seen_receiving: '2024-05-01 10:00:00' } } } } }]], expect: [['url', /blockchair\.com\/bitcoin\/address/]] },
  { a: R.wikiGeosearch, type: 'location', value: '48.8584, 2.2945', routes: [['en.wikipedia.org/w/api.php', { body: { query: { geosearch: [{ pageid: 1, title: 'Eiffel Tower', lat: 48.8584, lon: 2.2945, dist: 12 }, { pageid: 2, title: 'Champ de Mars', lat: 48.855, lon: 2.298, dist: 400 }] } } }]], expect: [['location', 'Eiffel Tower'], ['location', 'Champ de Mars']] },
  { a: R.nominatim, type: 'location', value: '48.8584, 2.2945', routes: [['nominatim.openstreetmap.org/reverse', { body: { display_name: 'Eiffel Tower, 5, Avenue Anatole France, Paris, France', lat: '48.8582', lon: '2.2945', osm_type: 'way', osm_id: 5013364, address: { road: 'Avenue Anatole France', house_number: '5', city: 'Paris', state: 'Île-de-France', country: 'France', postcode: '75007' } } }]], expect: [['location', /Avenue Anatole France.*Paris.*France/]] },
  { a: R.openalex, type: 'person', value: 'Geoffrey Hinton', routes: [['api.openalex.org/authors', { body: { results: [{ id: 'https://api.openalex.org/A1', display_name: 'Geoffrey E. Hinton', works_count: 1 }, { id: 'https://api.openalex.org/A2', display_name: 'Geoffrey Hinton', orcid: 'https://orcid.org/0000-0000-0000-0001', works_count: 300, cited_by_count: 100000, last_known_institutions: [{ display_name: 'University of Toronto' }] }] } }]], expect: [['org', 'University of Toronto'], ['account', 'https://orcid.org/0000-0000-0000-0001']] },
  { a: R.orcid, type: 'person', value: 'Josiah Carberry', routes: [['pub.orcid.org/v3.0/expanded-search', { body: { 'expanded-result': [{ 'orcid-id': '0000-0002-1825-0097', 'given-names': 'Josiah', 'family-names': 'Carberry', 'institution-name': ['Brown University'], email: ['jcarberry@brown.example'] }] } }]], expect: [['account', 'https://orcid.org/0000-0002-1825-0097'], ['org', 'Brown University'], ['email', 'jcarberry@brown.example']] },
  { a: R.fec, type: 'person', value: 'Jane Smith', routes: [['api.open.fec.gov/v1/schedules/schedule_a', { body: { results: [{ contributor_name: 'SMITH, JANE', contributor_city: 'AUSTIN', contributor_state: 'TX', contributor_employer: 'NORTHWIND LABS', contributor_occupation: 'ENGINEER', contribution_receipt_date: '2022-05-01' }, { contributor_name: 'SMITH, JANET', contributor_city: 'MIAMI', contributor_state: 'FL' }, { contributor_name: 'SMITH, JANE', contributor_employer: 'RETIRED' }] } }]], expect: [['location', 'AUSTIN, TX'], ['org', 'NORTHWIND LABS']] },
  { a: R.npi, type: 'person', value: 'Jane Smith', routes: [['npiregistry.cms.hhs.gov/api/', { body: { results: [{ number: 1234567890, basic: { first_name: 'JANE', last_name: 'SMITH', credential: 'MD' }, addresses: [{ address_purpose: 'LOCATION', city: 'AUSTIN', state: 'TX', telephone_number: '512-555-0100' }], taxonomies: [{ desc: 'Family Medicine' }] }] } }]], expect: [['location', 'AUSTIN, TX'], ['phone', '512-555-0100']] },
  { a: R.leakcheck, type: 'email', value: 'mara@lindenmade.example', routes: [['leakcheck.io/api/public', { body: { success: true, found: 2, fields: ['username', 'password'], sources: [{ name: 'Collection1', date: '2019-01' }, { name: 'SiteX', date: '2021-06' }] } }]], expect: [['breach', 'Collection1'], ['breach', 'SiteX']] },
  { a: R.hudsonrock, type: 'email', value: 'mara@lindenmade.example', routes: [['cavalier.hudsonrock.com', { body: { stealers: [{ date_compromised: '2023-08-14T00:00:00.000Z', operating_system: 'Windows 10 Pro', computer_name: 'DESKTOP-ABC' }] } }]], expect: [['breach', /Infostealer log/]] },
  { a: R.veriphone, type: 'phone', value: '+14155552671', key: 'KEY', routes: [['api.veriphone.io/v2/verify', { body: { status: 'success', phone_valid: true, phone_type: 'mobile', carrier: 'Verizon', phone_region: 'California', country: 'United States' } }]], expect: [['org', 'Verizon'], ['location', /California/]] },
  { a: R.brave, type: 'username', value: 'maralinden', key: 'KEY', routes: [['api.search.brave.com/res/v1/web/search', { body: { web: { results: [{ title: 'maralinden on GitHub', url: 'https://github.com/maralinden', description: 'Mara <strong>Linden</strong>' }, { title: 'x', url: 'javascript:alert(1)' }] } } }]], expect: [['url', 'https://github.com/maralinden']] },
  { a: R.serper, type: 'person', value: 'Mara Linden', key: 'KEY', routes: [['google.serper.dev/search', { body: { organic: [{ title: 'Mara Linden | LinkedIn', link: 'https://www.linkedin.com/in/maralinden', snippet: 'Austin' }] } }]], expect: [['url', 'https://www.linkedin.com/in/maralinden']] },
  { a: R.icij, type: 'org', value: 'Mossack Fonseca', routes: [['offshoreleaks.icij.org/api/v1/reconcile', { body: { q0: { result: [{ id: 12000001, name: 'MOSSACK FONSECA & CO.', score: 95, match: true, type: [{ name: 'Intermediary' }] }, { id: 2, name: 'OTHER', score: 40 }] } } }]], expect: [['url', /offshoreleaks\.icij\.org\/nodes\/12000001/]] },
  { a: R.opensanctions, type: 'org', value: 'Wagner Group', key: 'KEY', routes: [['api.opensanctions.org/search/default', { body: { results: [{ id: 'NK-abc', caption: 'Wagner Group', schema: 'Organization', datasets: ['us_ofac_sdn'], properties: { topics: ['sanction'] } }, { id: 'NK-x', caption: 'Wagner Brothers' }] } }]], expect: [['url', /opensanctions\.org\/entities\/NK-abc/]] },
];

describe('new sources return what their pages say', () => {
  for (const c of CASES) {
    it(`${c.a.id}: ${c.type} ${c.value}`, async () => {
      const out = await run(c.a, c.type, c.value, fake(c.routes, c.key));
      for (const [t, v] of c.expect) expect(has(out, t, v), `${c.a.id} should give ${t} ${v}; got ${out.map((x) => `${x.type}:${x.value}`).join(' | ')}`).toBe(true);
      for (const x of out) { expect(x.weight, `${c.a.id} ${x.type} weight`).toBeGreaterThan(0); expect(x.weight).toBeLessThanOrEqual(0.95); }
    });
    it(`${c.a.id}: says nothing when the name does not exist or the answer is empty`, async () => {
      expect(await run(c.a, c.type, c.value, fake([]))).toEqual([]);
    });
  }
  it('every new source with a key does nothing, quietly, until one is added', async () => {
    for (const c of CASES.filter((x) => x.key)) { const f = fake(c.routes); expect(await run(c.a, c.type, c.value, f)).toEqual([]); expect(f.calls.length, `${c.a.id} must not call out without its key`).toBe(0); }
  });
  it('keys are sent in headers or query as each service expects, and never in the page link shown to people', async () => {
    const f = fake([['api.abuseipdb.com', { body: { data: { isp: 'X', abuseConfidenceScore: 1 } } }]], 'SECRETKEY');
    const out = await run(N.abuseipdb, 'ip', '203.0.113.9', f);
    expect(f.inits[0].headers.Key).toBe('SECRETKEY');
    expect(JSON.stringify(out)).not.toContain('SECRETKEY');
    const g = fake([['api.shodan.io', { body: { ip_str: '1.1.1.1', org: 'Cloudflare' } }]], 'SECRETKEY2');
    const o2 = await run(N.shodan, 'ip', '203.0.113.9', g);
    expect(JSON.stringify(o2)).not.toContain('SECRETKEY2');                       // the key is in the request URL (Shodan requires it) but never in a claim, link or record
  });
  it('rate limits and server errors surface as errors, not as "nothing found"', async () => {
    await expect(run(P.lichess, 'username', 'mara', fake([['lichess.org', { status: 429 }]]))).rejects.toBeInstanceOf(RateLimitedError);
    await expect(run(P.dockerhub, 'username', 'mara', fake([['hub.docker.com', { status: 500 }]]))).rejects.toThrow(/HTTP 500/);
  });
  it('Docker Hub: reads the "orgname" shape it really returns today, as well as the old "username" one', async () => {
    const out = await run(P.dockerhub, 'username', 'jessfraz', fake([['hub.docker.com/v2/users/jessfraz/', { body: { orgname: 'jessfraz', full_name: 'Jess Frazelle', date_joined: '2018-02-04T19:58:35Z', type: 'Organization' } }]]));
    expect(has(out, 'account', 'https://hub.docker.com/u/jessfraz')).toBe(true); expect(has(out, 'person', 'Jess Frazelle')).toBe(true);
  });
  it('Mastodon: when every server fails that is an error, not "nothing found"', async () => {
    await expect(run(P.mastodon, 'username', 'mara', fake([[/mastodon|infosec|fosstodon|hachyderm/, { status: 500 }]]))).rejects.toThrow(/HTTP 500/);
    expect(await run(P.mastodon, 'username', 'mara', fake([]))).toEqual([]);     // all 404: genuinely no such account
  });
  it('refuses names that could break out of a URL path before making any request', async () => {
    for (const a of [P.codeberg, P.dockerhub, P.lichess, P.lobsters, P.codewars]) { const f = fake([]); expect(await run(a, 'username', 'a/../../b?x=1', f)).toEqual([]); expect(f.calls).toHaveLength(0); }
  });
  it('turns links people publish into accounts only for known platforms', () => {
    expect(linkClaim('https://twitter.com/mara?s=1', 'x', 0.8, 'https://p')).toMatchObject({ type: 'account', attrs: { platform: 'X', handle: 'mara' } });
    expect(linkClaim('https://www.linkedin.com/in/mara-l', 'x', 0.8, 'https://p')).toMatchObject({ type: 'account', attrs: { platform: 'LinkedIn', handle: 'mara-l' } });
    expect(linkClaim('https://lindenmade.example/about', 'x', 0.8, 'https://p')).toMatchObject({ type: 'url' });
    expect(linkClaim('javascript:alert(1)', 'x', 0.8, 'https://p')).toBeNull();
    expect(linkClaim('https://twitter.com/intent/tweet', 'x', 0.8, 'https://p')?.type).toBe('url');
  });
});

describe('WhatsMyName sweep', () => {
  const sites: WmnSite[] = [
    { name: 'GoodSite', uri_check: 'https://good.example/u/{account}', e_code: 200, e_string: 'profile-of', m_code: 404, cat: 'social' },
    { name: 'LiarSite', uri_check: 'https://liar.example/{account}', e_code: 200, cat: 'social' },                       // says "found" for everyone: untrusted
    { name: 'TextSite', uri_check: 'https://text.example/{account}', e_code: 200, m_string: 'no such user', cat: 'gaming' },
    { name: 'PostSite', uri_check: 'https://post.example/{account}', e_code: 200, post_body: '{"u":"{account}"}', cat: 'social' },   // needs POST: skipped
    { name: 'AdultSite', uri_check: 'https://adult.example/{account}', e_code: 200, cat: 'xx NSFW' },                       // skipped on purpose
    { name: 'DatingSite', uri_check: 'https://dating.example/{account}', e_code: 200, cat: 'dating' },
    { name: 'BlockedSite', uri_check: 'https://blocked.example/{account}', e_code: 200, cat: 'social' },
    { name: 'Dribbble', uri_check: 'https://dribbble.com/{account}', e_code: 200, cat: 'art' },                             // already covered by the built-in sweep
    { name: 'Insecure', uri_check: 'http://plain.example/{account}', e_code: 200, cat: 'social' },
  ];
  const routes = (user: string): Route[] => [
    [WMN_URL, { body: { sites } }],
    [`good.example/u/${user}`, { body: '<div class="profile-of">x</div>' }], ['good.example/u/plx-ctrl', { status: 404, body: 'nope' }],
    ['liar.example/', { body: 'welcome' }],
    [`text.example/${user}`, { body: 'Hello there' }], ['text.example/plx-ctrl', { body: 'no such user' }],
    ['blocked.example/', { status: 403 }],
  ];
  beforeEach(() => resetWmn());
  it('reports only sites that are trusted and say the name exists, and skips adult, dating, POST-only and duplicate sites', async () => {
    const f = fake(routes('maralinden'));
    const out = await run(wmnSweep, 'username', 'maralinden', f);
    expect(out.map((c) => (c.attrs as any).platform).sort()).toEqual(['GoodSite', 'TextSite']);
    expect(out.every((c) => c.type === 'account' && c.weight <= 0.3)).toBe(true);
    expect(f.calls.some((u) => /adult|dating|post\.example|plain\.example|dribbble/.test(u))).toBe(false);
    expect(out[0].snippet).toMatch(/Name match only/);
  });
  it('a site that answers "found" for a made-up name never produces a result', async () => {
    const out = await run(wmnSweep, 'username', 'maralinden', fake(routes('maralinden')));
    expect(out.some((c) => /liar\.example/.test(c.value))).toBe(false);
  });
  it('verdicts: blocked or odd responses are unknown, never "absent"', () => {
    const s: WmnSite = { name: 'x', uri_check: 'https://x/{account}', e_code: 200, e_string: 'ok', m_string: 'gone', m_code: 404 };
    expect(verdict(s, 200, 'ok here')).toBe('present'); expect(verdict(s, 200, 'ok but gone')).toBe('absent'); expect(verdict(s, 404, '')).toBe('absent');
    expect(verdict(s, 403, '')).toBe('unknown'); expect(verdict(s, 429, '')).toBe('unknown'); expect(verdict(s, 503, '')).toBe('unknown'); expect(verdict(s, 200, 'different page')).toBe('unknown');
  });
  it('refuses unsafe names and surfaces a failed list download as an error', async () => {
    const f = fake(routes('x')); expect(await run(wmnSweep, 'username', 'a/b', f)).toEqual([]); expect(f.calls).toHaveLength(0);
    await expect(run(wmnSweep, 'username', 'maralinden', fake([[WMN_URL, { status: 500 }]]))).rejects.toThrow(/WhatsMyName/);
    resetWmn(); await expect(run(wmnSweep, 'username', 'maralinden', fake([[WMN_URL, { body: 'not json' }]]))).rejects.toThrow(/valid JSON/);
  });
  it('has a long enough time limit and a hard cap on results', () => { expect(wmnSweep.timeoutMs).toBeGreaterThanOrEqual(120_000); });
});

describe('the catalogue', () => {
  it('has ids that are unique and a capability for every source', () => {
    const ids = liveAdapters.map((a) => a.id); expect(new Set(ids).size).toBe(ids.length);
    expect(liveAdapters.length).toBeGreaterThanOrEqual(85);
    for (const a of liveAdapters) expect(a.capability).toBeTruthy();
  });
});
