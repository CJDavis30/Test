import type { ComponentType, ReactNode } from 'react';
import { Camera, MapPin, ScanSearch, Users, Stethoscope, Fingerprint, Clock, Compass, Sun, Sunrise, Plane, CloudSun, Mail, AtSign, Languages, Eye, Image as ImageIcon, FileText, Globe, Phone, Link2, Eraser, Route, Search, Wand2, Layers, Hash, Brain, Scale, ListPlus, ShieldAlert, Replace, Navigation } from 'lucide-react';
import { useStore } from '../lib/store';
import * as Geo from './geo';
import * as Txt from './text';
import * as Net from './net';
import * as Img from './image';

export type ToolGroup = 'Pictures & files' | 'Where & when' | 'Names & accounts' | 'Links, domains & contacts' | 'Your case';
export const GROUPS: ToolGroup[] = ['Pictures & files', 'Where & when', 'Names & accounts', 'Links, domains & contacts', 'Your case'];

export interface Tool {
  id: string; name: string; blurb: string; group: ToolGroup; icon: ReactNode; keywords: string;
  /** shown on the card: what it needs, so nobody is surprised */
  needs?: 'AI' | 'internet';
  Panel?: ComponentType;
  /** tools that open an existing window instead of a panel */
  open?: () => void;
  badge?: 'new';
}
const i = (C: any) => <C size={18} strokeWidth={1.8} />;

export const TOOLS: Tool[] = [
  // ---- pictures & files
  { id: 'photo-lab', name: 'Photo & file forensics', blurb: 'Everything inside a photo, video, document or program: camera, time, GPS, edits, hidden data. Drop files anywhere in the app.', group: 'Pictures & files', icon: i(Camera), keywords: 'exif metadata gps video pdf office document hidden data file', open: () => useStore.getState().openFileLab() },
  { id: 'photo-location', name: 'Where was this photo taken?', blurb: 'Reads the picture itself (signs, road markings, plants, buildings, light) and asks several times to see how much the answers agree.', group: 'Pictures & files', icon: i(MapPin), needs: 'AI', keywords: 'geolocate geoguessr image location vision background landmarks', open: () => useStore.getState().openFileLab() },
  { id: 'screenshot', name: 'Screenshot reader', blurb: 'Drop a screenshot: Plexus reads the handles, emails, numbers, links and dates on it and offers each one to add to your case.', group: 'Pictures & files', icon: i(Eye), needs: 'AI', badge: 'new', keywords: 'ocr screenshot read text profile chat', Panel: Img.Screenshot },
  { id: 'ela', name: 'Edit detector', blurb: 'Error Level Analysis: shows which parts of a JPEG were pasted in or retouched, as a heat map.', group: 'Pictures & files', icon: i(Layers), badge: 'new', keywords: 'ela edited photoshop tampered manipulated fake forensic', Panel: Img.Ela },
  { id: 'image-compare', name: 'Image twin finder', blurb: 'Is this the same picture as that one, even resized, cropped lightly or flipped? Compares visual fingerprints.', group: 'Pictures & files', icon: i(Replace), badge: 'new', keywords: 'compare duplicate same picture profile photo hash perceptual mirror', Panel: Img.ImageCompareTool },
  { id: 'reverse', name: 'Reverse image search', blurb: 'One click into Google Lens, TinEye, Yandex, Bing, Baidu for a picture address, plus upload shortcuts for local files.', group: 'Pictures & files', icon: i(Search), keywords: 'reverse image search tineye lens yandex source origin', Panel: Net.Reverse },
  { id: 'strip', name: 'Metadata remover', blurb: 'Make a clean copy of a picture with the camera, time, GPS and software details removed, before you share it.', group: 'Pictures & files', icon: i(Eraser), badge: 'new', keywords: 'strip exif remove metadata privacy clean anonymize', Panel: Img.Strip },
  // ---- where & when
  { id: 'coords', name: 'Coordinate toolkit', blurb: 'Reads any coordinate format (degrees, Plus Code, geohash, map links) and converts to all of them, with map links and distances.', group: 'Where & when', icon: i(Compass), badge: 'new', keywords: 'coordinates lat lon dms geohash plus code utm convert map distance bearing', Panel: Geo.Coords },
  { id: 'sun-shadow', name: 'Shadow geolocator', blurb: 'From a shadow and the time, works out where on Earth the sun was at that height, down to a spot if you know the shadow\'s direction.', group: 'Where & when', icon: i(Sun), badge: 'new', keywords: 'shadow sun position locate where chronolocation solar azimuth elevation', Panel: Geo.SunShadow },
  { id: 'shadow-clock', name: 'Shadow clock', blurb: 'If you know the place and day, a shadow\'s length gives the time of day (and whether it is morning or afternoon).', group: 'Where & when', icon: i(Sunrise), badge: 'new', keywords: 'shadow time of day when chronolocation sun length', Panel: Geo.ShadowClock },
  { id: 'daylight', name: 'Does the time fit the place?', blurb: 'Was it light or dark there then? Sun height, direction, sunrise and sunset. Catches wrong timezones and faked timestamps.', group: 'Where & when', icon: i(CloudSun), keywords: 'daylight night sunrise sunset timezone consistency check', Panel: Geo.Daylight },
  { id: 'weather', name: 'Weather at that time', blurb: 'What the weather really was at a place and hour, back to 1940. Test a photo or a claim against it.', group: 'Where & when', icon: i(CloudSun), needs: 'internet', badge: 'new', keywords: 'weather rain snow fog temperature historical verify photo date', Panel: Geo.Weather },
  { id: 'travel', name: 'Travel plausibility', blurb: 'Two sightings, two places, two times: could one person have been at both? Flags the impossible ones.', group: 'Where & when', icon: i(Plane), badge: 'new', keywords: 'alibi travel distance speed impossible two accounts one person', Panel: Geo.Travel },
  { id: 'timestamps', name: 'Timestamp decoder', blurb: 'Reads a number or date in any format (Unix, Windows, Chrome, iOS), shows it in twelve time zones, and which Discord ID it matches.', group: 'Where & when', icon: i(Clock), badge: 'new', keywords: 'timestamp epoch unix filetime webkit convert timezone date', Panel: Txt.Timestamps },
  { id: 'decode', name: 'Decode IDs, links & chat logs', blurb: 'Paste links, IDs or a chat export: exact account creation times, platform IDs, and when the person is awake (and roughly where).', group: 'Where & when', icon: i(ScanSearch), keywords: 'discord snowflake roblox steam chat export activity clock timezone sleep', open: () => useStore.getState().setDecode(true) },
  // ---- names & accounts
  { id: 'identify', name: 'Identify anything', blurb: 'Paste a string you cannot place: Plexus says what it is (ID, token, hash, wallet, MAC, timestamp…) and decodes it.', group: 'Names & accounts', icon: i(Fingerprint), badge: 'new', keywords: 'identify decode what is this id uuid hash jwt base64 wallet bitcoin ethereum mac ip iban snowflake', Panel: Txt.Identify },
  { id: 'handle-variants', name: 'Username variants', blurb: 'How a handle is built (decorated, leetspeak, trailing year) and the likely versions the same person would use elsewhere.', group: 'Names & accounts', icon: i(AtSign), keywords: 'username variants alternatives handles permutations leetspeak', Panel: Txt.HandleVariants },
  { id: 'handle-compare', name: 'Compare two usernames', blurb: 'How much does it prove that two accounts have names like these? Measured in bits of surprise.', group: 'Names & accounts', icon: i(Scale), keywords: 'compare usernames handles same person similar match coincidence bits', Panel: Txt.HandleCompare },
  { id: 'lookalike', name: 'Look-alike & hidden characters', blurb: 'Spots a Cyrillic "а" posing as "a", invisible characters and text-direction tricks in names, domains and links.', group: 'Names & accounts', icon: i(ShieldAlert), badge: 'new', keywords: 'homograph lookalike unicode invisible zero width cyrillic punycode impersonation spoof', Panel: Txt.Lookalike },
  { id: 'style', name: 'Writing-style matcher', blurb: 'Do two accounts write like the same person? Compares small-word habits, punctuation, slang and letter patterns.', group: 'Names & accounts', icon: i(Brain), badge: 'new', keywords: 'stylometry writing style authorship same author compare text', Panel: Txt.Style },
  { id: 'identities', name: 'Identities', blurb: 'Plexus groups accounts that probably belong to one person and shows the evidence in bits.', group: 'Names & accounts', icon: i(Users), keywords: 'identities clusters same person linking', open: () => useStore.getState().setView('identities') },
  // ---- links, domains & contacts
  { id: 'email-guess', name: 'Email guesser', blurb: 'From a name and company, the likely addresses, ranked by how companies write them, then checks which are real.', group: 'Links, domains & contacts', icon: i(Mail), needs: 'internet', badge: 'new', keywords: 'email guess permutator pattern find company address hunter', Panel: Net.EmailGuess },
  { id: 'gravatar', name: 'Gravatar checker', blurb: 'Does an email have a public avatar? If so, you get the picture, a name and sometimes linked accounts.', group: 'Links, domains & contacts', icon: i(ImageIcon), needs: 'internet', badge: 'new', keywords: 'gravatar avatar email profile picture check exists', Panel: Net.Gravatar },
  { id: 'phone', name: 'Phone number reader', blurb: 'Formats, country, validity, and traps (toll-free, premium-rate, fictional 555 numbers). Candidate countries when none is given.', group: 'Links, domains & contacts', icon: i(Phone), badge: 'new', keywords: 'phone number country format carrier validate e164 whatsapp telegram', Panel: Txt.Phone },
  { id: 'domain', name: 'Domain history', blurb: 'When a domain was registered, first got a certificate, and was first archived. Flags names that changed hands.', group: 'Links, domains & contacts', icon: i(Globe), needs: 'internet', badge: 'new', keywords: 'domain whois rdap age registered certificate crt archive wayback history subdomain', Panel: Net.Domain },
  { id: 'redirects', name: 'Link unshortener', blurb: 'Follows a short or suspicious link one hop at a time without opening the page.', group: 'Links, domains & contacts', icon: i(Route), needs: 'internet', badge: 'new', keywords: 'redirect unshorten bitly shortener trace hops final destination', Panel: Net.Redirects },
  { id: 'link-inspect', name: 'Link inspector', blurb: 'What a link gives away: who shared it (tracking tags), hidden redirects, and exact times inside post links. Nothing is opened.', group: 'Links, domains & contacts', icon: i(Link2), keywords: 'url link tracking utm igsh share cleaner redirect parameters', Panel: Txt.LinkInspect },
  { id: 'headers', name: 'Email header tracer', blurb: 'The route an email took, the sender\'s real timezone, the origin server, and whether the story it tells holds together.', group: 'Links, domains & contacts', icon: i(Navigation), keywords: 'email headers received spf dkim dmarc origin ip route phishing', Panel: Txt.Headers },
  // ---- your case
  { id: 'extract', name: 'Pull entities from text', blurb: 'Paste any text and select which emails, links, domains, phone numbers and IPs to add to your case.', group: 'Your case', icon: i(ListPlus), badge: 'new', keywords: 'extract entities bulk import paste text emails phones ips domains', Panel: Txt.Extract },
  { id: 'source-doctor', name: 'Source health', blurb: 'Which sources are working, which need a key, and which are being rate-limited, with a one-click test.', group: 'Your case', icon: i(Stethoscope), keywords: 'sources doctor health test api keys status', open: () => useStore.getState().openSettings('sources') },
  { id: 'wand', name: 'Autopilot', blurb: 'Select something on the graph, then ask Plexus to follow the strongest leads on its own.', group: 'Your case', icon: i(Wand2), keywords: 'autopilot automatic follow leads', open: () => { const s = useStore.getState(); s.setView('graph'); s.toast('Right-click a node and choose Autopilot, or press ⌘K and type "autopilot".'); } },
  { id: 'hash', name: 'Bulk lookups', blurb: 'Press ⌘K and paste a whole list: Plexus recognises every kind of item and searches them all.', group: 'Your case', icon: i(Hash), keywords: 'bulk batch paste many import list', open: () => useStore.getState().openPalette('') },
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);
