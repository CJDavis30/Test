import type { EntityType } from './types';
import { md5 as md5bytes } from './forensics/ids';
const md5 = (s: string) => Array.from(md5bytes(s), (b) => b.toString(16).padStart(2, '0')).join('');
import { mapLinks, parseCoords } from './forensics/geo';

/**
 * "Check elsewhere": places to look something up by hand, for the many sites that need a login, a captcha, or a person's judgement and
 * so cannot be queried automatically. Plexus only builds the links; nothing is sent from here. People-search data brokers are left out
 * on purpose: their results are often wrong and exist mainly to find where someone lives.
 */
export interface Pivot { label: string; url: string; note?: string }
export interface PivotGroup { group: string; links: Pivot[] }

const e = encodeURIComponent;
const q = (v: string) => e(`"${v.replace(/"/g, '')}"`);
const L = (label: string, url: string, note?: string): Pivot => ({ label, url, note });

const search = (v: string): PivotGroup => ({ group: 'Search engines', links: [
  L('Google (exact)', `https://www.google.com/search?q=${q(v)}`), L('Bing (exact)', `https://www.bing.com/search?q=${q(v)}`), L('DuckDuckGo', `https://duckduckgo.com/?q=${q(v)}`),
  L('Yandex', `https://yandex.com/search/?text=${q(v)}`), L('Brave', `https://search.brave.com/search?q=${q(v)}`), L('Google, PDFs and documents', `https://www.google.com/search?q=${q(v)}+(filetype:pdf+OR+filetype:docx+OR+filetype:xlsx)`),
  L('Google, news', `https://www.google.com/search?q=${q(v)}&tbm=nws`), L('Google, forums and Q&A', `https://www.google.com/search?q=${q(v)}+(site:reddit.com+OR+site:quora.com+OR+site:stackoverflow.com)`),
  L('Archive.org full text', `https://archive.org/search?query=${q(v)}&sin=TXT`),
] });

const handle = (v: string): PivotGroup[] => { const u = e(v.replace(/^@/, '')); return [
  search(v.replace(/^@/, '')),
  { group: 'Open the profile directly', links: [
    L('Instagram', `https://www.instagram.com/${u}/`), L('X / Twitter', `https://x.com/${u}`), L('TikTok', `https://www.tiktok.com/@${u}`), L('Facebook', `https://www.facebook.com/${u}`), L('YouTube', `https://www.youtube.com/@${u}`),
    L('Reddit', `https://www.reddit.com/user/${u}`), L('Twitch', `https://www.twitch.tv/${u}`), L('Snapchat', `https://www.snapchat.com/add/${u}`), L('Pinterest', `https://www.pinterest.com/${u}/`), L('Threads', `https://www.threads.net/@${u}`),
    L('Telegram', `https://t.me/${u}`), L('LinkedIn', `https://www.linkedin.com/in/${u}`), L('GitHub', `https://github.com/${u}`), ...(/^[A-Za-z0-9-]{1,32}$/.test(v.replace(/^@/, '')) ? [L('Tumblr', `https://${v.replace(/^@/, '')}.tumblr.com`)] : []), L('Medium', `https://medium.com/@${u}`),
    L('SoundCloud', `https://soundcloud.com/${u}`), L('Spotify', `https://open.spotify.com/user/${u}`), L('Steam', `https://steamcommunity.com/id/${u}`), L('Roblox search', `https://www.roblox.com/search/users?keyword=${u}`),
    L('Xbox gamertag', `https://xboxgamertag.com/search/${u}`), L('Minecraft (NameMC)', `https://namemc.com/profile/${u}`), L('Lichess', `https://lichess.org/@/${u}`), L('Chess.com', `https://www.chess.com/member/${u}`),
    L('Patreon', `https://www.patreon.com/${u}`), L('Ko-fi', `https://ko-fi.com/${u}`), L('Linktree', `https://linktr.ee/${u}`), L('VK', `https://vk.com/${u}`), L('Bluesky', `https://bsky.app/profile/${u}.bsky.social`),
  ] },
  { group: 'Search many sites at once', links: [L('WhatsMyName', `https://whatsmyname.app/?q=${u}`), L('Instant Username Search', `https://instantusername.com/#/${u}`), L('Namechk', `https://namechk.com/`, 'Type the name in yourself'), L('Google: handle plus profile words', `https://www.google.com/search?q=${q(v.replace(/^@/, ''))}+(profile+OR+about+OR+contact)`)] },
  { group: 'Code and writing', links: [L('GitHub users', `https://github.com/search?q=${u}&type=users`), L('GitHub code', `https://github.com/search?q=${q(v.replace(/^@/, ''))}&type=code`, 'Needs a GitHub login'), L('Sourcegraph', `https://sourcegraph.com/search?q=${q(v.replace(/^@/, ''))}`), L('grep.app', `https://grep.app/search?q=${u}`), L('Dev.to', `https://dev.to/${u}`), L('npm', `https://www.npmjs.com/~${u}`), L('PyPI', `https://pypi.org/user/${u}/`)] },
  { group: 'Archives', links: [L('Wayback: Instagram', `https://web.archive.org/web/*/instagram.com/${u}*`), L('Wayback: X', `https://web.archive.org/web/*/x.com/${u}*`), L('Wayback: Facebook', `https://web.archive.org/web/*/facebook.com/${u}*`)] },
]; };

const email = (v: string): PivotGroup[] => { const [user, dom] = v.split('@'); return [
  search(v),
  { group: 'Accounts and exposure', links: [
    L('Have I Been Pwned', `https://haveibeenpwned.com/account/${e(v)}`), L('Epieos (Google, Gravatar, more)', `https://epieos.com/?q=${e(v)}&t=email`), L('EmailRep', `https://emailrep.io/${e(v)}`),
    L('Gravatar', `https://gravatar.com/${md5(v.trim().toLowerCase())}`), L('Intelligence X', `https://intelx.io/?s=${e(v)}`, 'Free tier is limited'), L('DeHashed', `https://dehashed.com/search?query=${e(v)}`, 'Paid'),
    L('GitHub (commits and users)', `https://github.com/search?q=${e(v)}&type=users`), L('Hunter verifier', `https://hunter.io/email-verifier/${e(v)}`), L('Skymem', `https://www.skymem.info/srch?q=${e(v)}`),
  ] },
  { group: 'The username part', links: [L(`Search “${user}”`, `https://www.google.com/search?q=${q(user)}`), L(`WhatsMyName: ${user}`, `https://whatsmyname.app/?q=${e(user)}`)] },
  ...(dom ? [{ group: 'The domain part', links: [L(`Who runs ${dom}`, `https://who.is/whois/${e(dom)}`), L('Mail setup (MX)', `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${e(dom)}&run=toolpage`), L(`Search ${dom}`, `https://www.google.com/search?q=site:${e(dom)}`)] }] : []),
]; };

const phone = (v: string): PivotGroup[] => { const digits = v.replace(/[^\d]/g, ''); const us = /^\+?1?(\d{3})(\d{3})(\d{4})$/.exec(v.replace(/[^\d+]/g, '')); return [
  search(v),
  { group: 'Is the number on a messaging app? (opens the app, shows a profile if it is)', links: [L('WhatsApp', `https://wa.me/${digits}`), L('Telegram', `https://t.me/+${digits}`), L('Signal', `https://signal.me/#p/+${digits}`), L('Viber', `viber://add?number=${digits}`, 'Opens the Viber app')] },
  { group: 'Number lookups', links: [L('Truecaller', `https://www.truecaller.com/search/${us ? 'us' : 'in'}/${digits.replace(/^1(?=\d{10}$)/, '')}`, 'Needs a login'), L('Sync.me', `https://sync.me/search/?number=${e(v)}`), L('NumLookup', `https://www.numlookup.com/`, 'Type the number in yourself'), ...(us ? [L('Google, US formats', `https://www.google.com/search?q=${e(`"${us[1]}-${us[2]}-${us[3]}" OR "(${us[1]}) ${us[2]}-${us[3]}"`)}`)] : [])] },
]; };

const domain = (v: string): PivotGroup[] => { const d = e(v); return [
  search(v),
  { group: 'Who owns it and how old is it', links: [L('WHOIS (who.is)', `https://who.is/whois/${d}`), L('ICANN lookup', `https://lookup.icann.org/en/lookup?name=${d}`), L('DomainTools', `https://whois.domaintools.com/${d}`), L('Wayback Machine', `https://web.archive.org/web/*/${d}`), L('SpyOnWeb (shared analytics IDs)', `https://spyonweb.com/${d}`)] },
  { group: 'Infrastructure', links: [L('crt.sh certificates', `https://crt.sh/?q=${e('%.' + v)}`), L('DNS (Robtex)', `https://www.robtex.com/dns-lookup/${d}`), L('SecurityTrails', `https://securitytrails.com/domain/${d}/dns`), L('ViewDNS reverse IP', `https://viewdns.info/reverseip/?host=${d}&t=1`), L('DNSlytics', `https://dnslytics.com/domain/${d}`), L('Mail setup (MX)', `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${d}&run=toolpage`), L('Shodan', `https://www.shodan.io/search?query=hostname%3A${d}`, 'Needs a login'), L('Censys', `https://search.censys.io/search?resource=hosts&q=${d}`)] },
  { group: 'Reputation and technology', links: [L('urlscan', `https://urlscan.io/domain/${d}`), L('VirusTotal', `https://www.virustotal.com/gui/domain/${d}`), L('AlienVault OTX', `https://otx.alienvault.com/indicator/domain/${d}`), L('BuiltWith (technology)', `https://builtwith.com/${d}`), L('SimilarWeb', `https://www.similarweb.com/website/${d}/`), L('Hunter (emails at this domain)', `https://hunter.io/search/${d}`)] },
  { group: 'Pages and people', links: [L('Everything on the site', `https://www.google.com/search?q=site:${d}`), L('Documents on the site', `https://www.google.com/search?q=site:${d}+(filetype:pdf+OR+filetype:docx+OR+filetype:xlsx)`), L('Mentions elsewhere', `https://www.google.com/search?q=${q(v)}+-site:${d}`), L('security.txt', `https://${v.toLowerCase()}/.well-known/security.txt`), L('humans.txt', `https://${v.toLowerCase()}/humans.txt`)] },
]; };

const ip = (v: string): PivotGroup[] => { const i = e(v); return [
  { group: 'Whose is it', links: [L('ARIN', `https://whois.arin.net/rest/ip/${i}`), L('RIPEstat', `https://stat.ripe.net/app/launchpad/${i}`), L('Hurricane Electric BGP', `https://bgp.he.net/ip/${i}`), L('ipinfo', `https://ipinfo.io/${i}`), L('Robtex', `https://www.robtex.com/ip-lookup/${i}`)] },
  { group: 'What is on it', links: [L('Shodan', `https://www.shodan.io/host/${i}`), L('Censys', `https://search.censys.io/hosts/${i}`), L('urlscan', `https://urlscan.io/ip/${i}`), L('Domains on this IP', `https://viewdns.info/reverseip/?host=${i}&t=1`)] },
  { group: 'Reputation', links: [L('AbuseIPDB', `https://www.abuseipdb.com/check/${i}`), L('GreyNoise', `https://viz.greynoise.io/ip/${i}`), L('VirusTotal', `https://www.virustotal.com/gui/ip-address/${i}`), L('AlienVault OTX', `https://otx.alienvault.com/indicator/ip/${i}`), L('IPQualityScore', `https://www.ipqualityscore.com/free-ip-lookup-proxy-vpn-test/lookup/${i}`)] },
  search(v),
]; };

const person = (v: string): PivotGroup[] => [
  search(v),
  { group: 'People and professional', links: [L('LinkedIn', `https://www.linkedin.com/search/results/people/?keywords=${e(v)}`, 'Needs a login'), L('Facebook', `https://www.facebook.com/search/people/?q=${e(v)}`, 'Needs a login'), L('X / Twitter', `https://x.com/search?q=${e(v)}&f=user`), L('Wikipedia', `https://en.wikipedia.org/w/index.php?search=${e(v)}`), L('Wikidata', `https://www.wikidata.org/w/index.php?search=${e(v)}`)] },
  { group: 'Research and records', links: [L('Google Scholar', `https://scholar.google.com/scholar?q=${q(v)}`), L('OpenAlex', `https://openalex.org/authors?search=${e(v)}`), L('ORCID', `https://orcid.org/orcid-search/search?searchQuery=${e(v)}`), L('Patents (Google)', `https://patents.google.com/?inventor=${e(v)}`), L('Court cases (CourtListener)', `https://www.courtlistener.com/?q=${q(v)}`), L('Company officer search', `https://opencorporates.com/officers?q=${e(v)}`), L('SEC filings', `https://www.sec.gov/edgar/search/#/q=${q(v)}`), L('US campaign donations (FEC)', `https://www.fec.gov/data/receipts/individual-contributions/?contributor_name=${e(v)}`)] },
  { group: 'Watch lists and leaks', links: [L('OpenSanctions', `https://www.opensanctions.org/search/?q=${e(v)}`), L('ICIJ Offshore Leaks', `https://offshoreleaks.icij.org/search?q=${e(v)}`), L('Interpol notices', `https://www.interpol.int/How-we-work/Notices/View-Red-Notices#${e(v)}`, 'Type the name in yourself')] },
];

const org = (v: string): PivotGroup[] => [
  search(v),
  { group: 'Company records', links: [L('OpenCorporates', `https://opencorporates.com/companies?q=${e(v)}`), L('GLEIF', `https://search.gleif.org/#/search/simpleSearch=${e(v)}`), L('SEC filings', `https://www.sec.gov/edgar/search/#/q=${q(v)}`), L('UK Companies House', `https://find-and-update.company-information.service.gov.uk/search?q=${e(v)}`), L('Crunchbase', `https://www.crunchbase.com/textsearch?q=${e(v)}`), L('LinkedIn companies', `https://www.linkedin.com/search/results/companies/?keywords=${e(v)}`, 'Needs a login')] },
  { group: 'Risk', links: [L('OpenSanctions', `https://www.opensanctions.org/search/?q=${e(v)}`), L('ICIJ Offshore Leaks', `https://offshoreleaks.icij.org/search?q=${e(v)}`), L('Court cases', `https://www.courtlistener.com/?q=${q(v)}`)] },
  { group: 'Reference', links: [L('Wikipedia', `https://en.wikipedia.org/w/index.php?search=${e(v)}`), L('Wikidata', `https://www.wikidata.org/w/index.php?search=${e(v)}`)] },
];

const url = (v: string): PivotGroup[] => { const u = e(v); return [
  { group: 'History and copies', links: [L('Wayback Machine', `https://web.archive.org/web/*/${v}`), L('archive.today', `https://archive.ph/newest/${v}`), L('Google cache search', `https://www.google.com/search?q=cache:${u}`)] },
  { group: 'Reputation', links: [L('urlscan', `https://urlscan.io/search/#${e(`page.url:"${v}"`)}`), L('VirusTotal', `https://www.virustotal.com/gui/search/${u}`)] },
  search(v),
]; };

const account = (v: string): PivotGroup[] => /^https?:\/\//i.test(v) ? [{ group: 'This profile', links: [L('Open it', v), L('Wayback Machine', `https://web.archive.org/web/*/${v}`), L('archive.today', `https://archive.ph/newest/${v}`)] }, search(v)] : [search(v)];

const wallet = (v: string): PivotGroup[] => { const a = e(v); const evm = /^0x[0-9a-fA-F]{40}$/.test(v); return [
  { group: 'Explorers', links: [L('Blockchair', `https://blockchair.com/search?q=${a}`), ...(evm ? [L('Etherscan', `https://etherscan.io/address/${a}`), L('DeBank', `https://debank.com/profile/${a}`), L('ENS', `https://app.ens.domains/${a}`)] : [L('Blockstream', `https://blockstream.info/address/${a}`), L('WalletExplorer', `https://www.walletexplorer.com/address/${a}`)])] },
  { group: 'Reports', links: [L('Chainabuse', `https://www.chainabuse.com/address/${a}`), L('Bitcoin Abuse', `https://www.bitcoinabuse.com/reports/${a}`), L('Google', `https://www.google.com/search?q=${q(v)}`)] },
]; };

const location = (v: string): PivotGroup[] => { const c = parseCoords(v)[0]; return [
  { group: 'On the map', links: c ? mapLinks(c.lat, c.lon).map((m) => L(m.label, m.url)) : [L('Google Maps', `https://www.google.com/maps/search/?api=1&query=${e(v)}`), L('Apple Maps', `https://maps.apple.com/?q=${e(v)}`), L('OpenStreetMap', `https://www.openstreetmap.org/search?query=${e(v)}`)] },
  { group: 'Around it', links: c ? [L('Wikipedia, nearby', `https://en.wikipedia.org/wiki/Special:Nearby#/coord/${c.lat},${c.lon}`), L('Wikimedia Commons photos nearby', `https://commons.wikimedia.org/wiki/Special:Nearby#/coord/${c.lat},${c.lon}`), L('Weather record (Open-Meteo)', `https://open-meteo.com/en/docs/historical-weather-api#latitude=${c.lat}&longitude=${c.lon}`)] : [L('Wikipedia', `https://en.wikipedia.org/w/index.php?search=${e(v)}`)] },
  search(v),
]; };

const image = (v: string): PivotGroup[] => { const u = e(v); return /^https?:\/\//i.test(v) ? [{ group: 'Find this picture elsewhere', links: [L('Google Lens', `https://lens.google.com/uploadbyurl?url=${u}`), L('TinEye', `https://tineye.com/search?url=${u}`), L('Yandex Images', `https://yandex.com/images/search?rpt=imageview&url=${u}`), L('Bing Visual Search', `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${u}`)] }] : [{ group: 'Find this picture elsewhere', links: [L('Google Lens', 'https://lens.google.com/'), L('TinEye', 'https://tineye.com/'), L('Yandex Images', 'https://yandex.com/images/'), L('Bing Visual Search', 'https://www.bing.com/visualsearch')] }]; };

export function pivotsFor(type: EntityType, value: string): PivotGroup[] {
  const v = value.trim(); if (!v) return [];
  const f: Partial<Record<EntityType, (v: string) => PivotGroup[]>> = { username: handle, email, phone, domain, ip, person, org, url, account, wallet, location, image };
  return (f[type]?.(v) ?? [search(v)]).filter((g) => g.links.length);
}
export const pivotCount = (g: PivotGroup[]) => g.reduce((n, x) => n + x.links.length, 0);
