/**
 * What a username IS. "maralinden" means nothing until you say whose username it is and where you got it: their Roblox username, their
 * Discord display name, an alt, something a stranger told you. Plexus uses that to decide:
 *   - which service is the real home of the name (look it up there, deeply: that account IS the one you named),
 *   - which other services are only "someone with the same name" (almost always a stranger, so they can never be strong on their own),
 *   - how far to trust the handle itself (anything can be a lie: a screenshot, a rumour, a name copied from somewhere).
 */
import { parseHandle, rarityBits } from './forensics/username';

export type HandleKind = 'username' | 'display-name';
export type Trust = 'certain' | 'probable' | 'unsure';
export type OriginKey = 'their-profile' | 'screenshot' | 'chat' | 'friend-list' | 'report' | 'told' | 'bio' | 'other' | 'unknown';

export interface HandleRole {
  platform?: string;          // a PLATFORMS key, or a free-text name for a service Plexus has no entry for
  kind: HandleKind;
  alt?: boolean;              // an alternate account of the same person
  origin?: OriginKey;
  originNote?: string;        // free text: "from the Discord profile their friend sent"
  trust: Trust;
}

export interface PlatformDef {
  key: string; name: string;
  /** adapters (by family) that look the name up on this service itself */
  families: string[];
  /** words people write for it in a bio ("ig", "insta") */
  aliases: string[];
  /** has a display name separate from the unique username */
  displayNames?: boolean;
  profileUrl?: (h: string) => string;
  /** pull a handle out of a profile link on this service */
  fromUrl?: (u: URL) => string | undefined;
  hosts?: RegExp;
}

const seg = (u: URL, i = 0) => decodeURIComponent(u.pathname.split('/').filter(Boolean)[i] ?? '').replace(/^@/, '') || undefined;
const at = (u: URL) => { const s = u.pathname.split('/').filter(Boolean)[0]; return s?.startsWith('@') ? decodeURIComponent(s.slice(1)) : undefined; };
const NOT_USER = /^(share|intent|home|explore|search|hashtag|i|about|help|login|signup|settings|privacy|terms|watch|channel|c|user|users|groups|games|catalog|redirect|people|profile|p|reel|reels|stories|status|story)$/i;
const usable = (s?: string) => (s && !NOT_USER.test(s) ? s : undefined);

export const PLATFORMS: PlatformDef[] = [
  { key: 'roblox', name: 'Roblox', families: ['roblox'], aliases: ['roblox', 'rblx', 'rbx'], displayNames: true, hosts: /(^|\.)roblox\.com$/i, profileUrl: (h) => `https://www.roblox.com/search/users?keyword=${encodeURIComponent(h)}` },
  { key: 'discord', name: 'Discord', families: ['discord'], aliases: ['discord', 'dc', 'disc'], displayNames: true, hosts: /(^|\.)discord(app)?\.com$|^discord\.gg$/i },
  { key: 'steam', name: 'Steam', families: ['steam'], aliases: ['steam'], displayNames: true, hosts: /(^|\.)steamcommunity\.com$/i, profileUrl: (h) => `https://steamcommunity.com/id/${encodeURIComponent(h)}`, fromUrl: (u) => (seg(u, 0) === 'id' ? seg(u, 1) : undefined) },
  { key: 'xbox', name: 'Xbox', families: ['xbox'], aliases: ['xbox', 'gt', 'gamertag', 'xbl'], hosts: /(^|\.)xbox\.com$/i },
  { key: 'playstation', name: 'PlayStation', families: [], aliases: ['psn', 'playstation', 'ps4', 'ps5'], hosts: /(^|\.)playstation\.com$/i },
  { key: 'epic', name: 'Epic Games', families: [], aliases: ['epic', 'fortnite'], hosts: /(^|\.)epicgames\.com$/i },
  { key: 'minecraft', name: 'Minecraft', families: ['minecraft'], aliases: ['minecraft', 'mc', 'ign'], hosts: /(^|\.)namemc\.com$/i, profileUrl: (h) => `https://namemc.com/profile/${encodeURIComponent(h)}`, fromUrl: (u) => (seg(u, 0) === 'profile' ? seg(u, 1) : undefined) },
  { key: 'github', name: 'GitHub', families: ['github'], aliases: ['github', 'gh', 'git'], hosts: /(^|\.)github\.com$/i, profileUrl: (h) => `https://github.com/${encodeURIComponent(h)}`, fromUrl: (u) => usable(seg(u, 0)) },
  { key: 'gitlab', name: 'GitLab', families: ['gitlab'], aliases: ['gitlab'], hosts: /(^|\.)gitlab\.com$/i, profileUrl: (h) => `https://gitlab.com/${encodeURIComponent(h)}`, fromUrl: (u) => usable(seg(u, 0)) },
  { key: 'x', name: 'X (Twitter)', families: [], aliases: ['twitter', 'x', 'tw', 'twt'], displayNames: true, hosts: /(^|\.)(twitter|x)\.com$/i, profileUrl: (h) => `https://x.com/${encodeURIComponent(h)}`, fromUrl: (u) => usable(seg(u, 0)) },
  { key: 'instagram', name: 'Instagram', families: [], aliases: ['instagram', 'insta', 'ig', 'gram'], displayNames: true, hosts: /(^|\.)instagram\.com$/i, profileUrl: (h) => `https://www.instagram.com/${encodeURIComponent(h)}/`, fromUrl: (u) => usable(seg(u, 0)) },
  { key: 'tiktok', name: 'TikTok', families: [], aliases: ['tiktok', 'tik tok', 'tt'], displayNames: true, hosts: /(^|\.)tiktok\.com$/i, profileUrl: (h) => `https://www.tiktok.com/@${encodeURIComponent(h)}`, fromUrl: at },
  { key: 'youtube', name: 'YouTube', families: ['youtube'], aliases: ['youtube', 'yt', 'you tube'], displayNames: true, hosts: /(^|\.)(youtube\.com|youtu\.be)$/i, profileUrl: (h) => `https://www.youtube.com/@${encodeURIComponent(h)}`, fromUrl: at },
  { key: 'twitch', name: 'Twitch', families: [], aliases: ['twitch', 'ttv'], displayNames: true, hosts: /(^|\.)twitch\.tv$/i, profileUrl: (h) => `https://www.twitch.tv/${encodeURIComponent(h)}`, fromUrl: (u) => usable(seg(u, 0)) },
  { key: 'reddit', name: 'Reddit', families: ['reddit'], aliases: ['reddit', 'u/'], hosts: /(^|\.)reddit\.com$/i, profileUrl: (h) => `https://www.reddit.com/user/${encodeURIComponent(h)}`, fromUrl: (u) => (/^(user|u)$/i.test(seg(u, 0) ?? '') ? seg(u, 1) : undefined) },
  { key: 'snapchat', name: 'Snapchat', families: [], aliases: ['snapchat', 'snap', 'sc'], displayNames: true, hosts: /(^|\.)snapchat\.com$/i, profileUrl: (h) => `https://www.snapchat.com/add/${encodeURIComponent(h)}`, fromUrl: (u) => (seg(u, 0) === 'add' ? seg(u, 1) : undefined) },
  { key: 'telegram', name: 'Telegram', families: ['telegram'], aliases: ['telegram', 'tg', 'tele'], hosts: /(^|\.)(t\.me|telegram\.me)$/i, profileUrl: (h) => `https://t.me/${encodeURIComponent(h)}`, fromUrl: (u) => usable(seg(u, 0)) },
  { key: 'bluesky', name: 'Bluesky', families: ['bluesky'], aliases: ['bluesky', 'bsky'], hosts: /(^|\.)bsky\.app$/i, fromUrl: (u) => (seg(u, 0) === 'profile' ? seg(u, 1) : undefined) },
  { key: 'mastodon', name: 'Mastodon', families: ['mastodon'], aliases: ['mastodon', 'fediverse'], fromUrl: at },
  { key: 'spotify', name: 'Spotify', families: [], aliases: ['spotify'], hosts: /(^|\.)spotify\.com$/i, fromUrl: (u) => (seg(u, 0) === 'user' ? seg(u, 1) : undefined) },
  { key: 'soundcloud', name: 'SoundCloud', families: [], aliases: ['soundcloud'], hosts: /(^|\.)soundcloud\.com$/i, fromUrl: (u) => usable(seg(u, 0)) },
  { key: 'facebook', name: 'Facebook', families: [], aliases: ['facebook', 'fb'], hosts: /(^|\.)(facebook|fb)\.com$/i, fromUrl: (u) => usable(seg(u, 0)) },
  { key: 'linkedin', name: 'LinkedIn', families: [], aliases: ['linkedin'], hosts: /(^|\.)linkedin\.com$/i, fromUrl: (u) => (seg(u, 0) === 'in' ? seg(u, 1) : undefined) },
  { key: 'pinterest', name: 'Pinterest', families: [], aliases: ['pinterest'], hosts: /(^|\.)pinterest\.com$/i, fromUrl: (u) => usable(seg(u, 0)) },
  { key: 'cashapp', name: 'Cash App', families: [], aliases: ['cashapp', 'cash app', '$cashtag'], hosts: /(^|\.)cash\.app$/i, fromUrl: (u) => (u.pathname.startsWith('/$') ? u.pathname.slice(2).split('/')[0] : undefined) },
];

export const platformByKey = (k?: string) => PLATFORMS.find((p) => p.key === k);
/** A platform from whatever the person typed ("Roblox", "ig", "x"), if Plexus knows it. */
export function platformByName(name: string): PlatformDef | undefined {
  const n = name.trim().toLowerCase();
  return PLATFORMS.find((p) => p.key === n || p.name.toLowerCase() === n || p.aliases.includes(n));
}

export const ORIGINS: { key: OriginKey; label: string; /** how far where you got it can be trusted */ factor: number }[] = [
  { key: 'their-profile', label: 'Their own profile page', factor: 1 },
  { key: 'screenshot', label: 'A screenshot', factor: 0.9 },
  { key: 'chat', label: 'A chat or message they sent', factor: 0.9 },
  { key: 'friend-list', label: 'A friends or followers list', factor: 0.75 },
  { key: 'bio', label: 'Another account\'s bio or links', factor: 0.7 },
  { key: 'report', label: 'A report or complaint', factor: 0.7 },
  { key: 'told', label: 'Someone told me', factor: 0.6 },
  { key: 'other', label: 'Somewhere else', factor: 0.7 },
  { key: 'unknown', label: 'I do not remember', factor: 0.5 },
];
export const TRUSTS: { key: Trust; label: string; factor: number }[] = [
  { key: 'certain', label: 'I am sure it is theirs', factor: 1 },
  { key: 'probable', label: 'Probably theirs', factor: 0.75 },
  { key: 'unsure', label: 'Not sure, could be wrong', factor: 0.45 },
];
export const originLabel = (k?: OriginKey) => ORIGINS.find((o) => o.key === k)?.label ?? 'an unknown place';

/** How far a handle you supplied can be relied on to belong to the person: what you believe, times how good where you got it is. */
export function trustFactor(role?: Pick<HandleRole, 'trust' | 'origin'>): number {
  if (!role) return 0.6;
  const t = TRUSTS.find((x) => x.key === role.trust)?.factor ?? 0.6, o = ORIGINS.find((x) => x.key === (role.origin ?? 'unknown'))?.factor ?? 0.6;
  // certain + their own profile is full trust; certain + hearsay is not
  return Math.max(0.15, Math.min(1, t * (0.55 + 0.45 * o)));
}

// ---------------------------------------------------------------------------------------------------------------- storage on a node
type Attrs = Record<string, unknown> | undefined;
export function roleFromAttrs(attrs: Attrs): HandleRole | undefined {
  if (!attrs) return undefined;
  const kind = attrs.handleKind === 'display-name' ? 'display-name' : attrs.handleKind === 'username' ? 'username' : undefined;
  const platform = typeof attrs.handlePlatform === 'string' && attrs.handlePlatform ? attrs.handlePlatform : undefined;
  if (!kind && !platform && attrs.handleTrust === undefined && attrs.handleAlt === undefined) return undefined;
  const trust = attrs.handleTrust === 'certain' || attrs.handleTrust === 'probable' || attrs.handleTrust === 'unsure' ? attrs.handleTrust : 'probable';
  return { platform, kind: kind ?? 'username', alt: attrs.handleAlt === true || undefined, origin: ORIGINS.some((o) => o.key === attrs.handleOrigin) ? (attrs.handleOrigin as OriginKey) : undefined, originNote: typeof attrs.handleOriginNote === 'string' && attrs.handleOriginNote ? attrs.handleOriginNote : undefined, trust };
}
export function roleToAttrs(r: HandleRole): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { handleKind: r.kind, handleTrust: r.trust };
  if (r.platform) out.handlePlatform = r.platform;
  if (r.alt) out.handleAlt = true;
  if (r.origin) out.handleOrigin = r.origin;
  if (r.originNote?.trim()) out.handleOriginNote = r.originNote.trim().slice(0, 200);
  return out;
}
/** Remove every role attribute (used when the role is cleared). */
export const ROLE_ATTR_KEYS = ['handleKind', 'handlePlatform', 'handleAlt', 'handleOrigin', 'handleOriginNote', 'handleTrust'] as const;

export function platformName(role?: Pick<HandleRole, 'platform'>): string | undefined {
  if (!role?.platform) return undefined;
  return platformByKey(role.platform)?.name ?? role.platform;
}
/** "Roblox username", "Discord display name", "alt account on X (Twitter)", "username (platform unknown)". */
export function describeRole(role?: HandleRole): string {
  if (!role) return 'username (platform not specified)';
  const p = platformName(role);
  const what = role.kind === 'display-name' ? 'display name' : 'username';
  return `${p ? `${p} ${what}` : `${what} (platform not specified)`}${role.alt ? ' · alt account' : ''}`;
}

/** The adapters (by family) that ARE this platform: a lookup there is of the very account you named. */
export function anchorFamilies(role?: HandleRole): string[] {
  if (!role?.platform || role.kind !== 'username') return [];
  return platformByKey(role.platform)?.families ?? [];
}

// ---------------------------------------------------------------------------------------------------------------- how much a same-name hit is worth
const COMMON_NAMES = new Set('james john robert michael william david richard joseph thomas charles chris daniel matt anthony mark donald steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel gregory alexander frank patrick raymond jack dennis jerry tyler aaron jose adam nathan henry douglas zachary peter kyle walter ethan jeremy harold keith christian roger noah gerald carl terry sean austin arthur lawrence jesse dylan bryan joe jordan billy bruce albert willie gabriel logan alan juan wayne roy ralph randy eugene vincent russell elijah louis bobby philip johnny alex max sam ben tom tim jim bob mike dave steve josh luke liam mason oliver lucas leo jake finn owen hunter connor evan cole mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna michelle carol amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha katherine christine debra rachel carolyn janet catherine maria heather diane olivia julie joyce victoria ruth virginia lauren kelly christina joan evelyn judith andrea hannah megan cheryl jacqueline martha madison teresa gloria sara janice ann kathryn abigail sophia frances jean alice judy isabella julia grace amber denise danielle marilyn beverly charlotte natalie theresa diana brittany doris kayla alexis lori mia ava ella lily chloe zoe lucy ruby amelia sophie smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson anderson taylor moore jackson martin lee perez thompson white harris sanchez clark ramirez lewis robinson walker young allen king wright torres nguyen hill flores green adams nelson baker hall rivera campbell mitchell carter roberts'.split(' '));
/**
 * How surprising is this handle as a coincidence? 0 (very common: "john", "gamer", short names) to 9 (long, odd, specific).
 * The same scale the known-facts matcher uses, so the two always agree.
 */
export function handleSurprise(handle: string): number {
  const p = parseHandle(handle);
  if (!p.core) return 0;
  // a bare common first name or surname ("john", "emma", "smith") is shared by thousands
  if (COMMON_NAMES.has(p.core)) return 0.3;
  return Math.max(0, Math.min(9, rarityBits(p.core) / 3) * (p.core.length <= 5 ? 0.6 : 1) + (p.trailingDigits && p.core.length >= 5 ? 0.4 : 0));
}
/**
 * The most a same-name hit can ever say: somebody else uses the name too, usually. A very common handle caps near 6%, a long and odd one
 * near 36%. Never enough to call it the same person without something else (a link, an email, a bio that mentions the other account).
 */
export function nameMatchCap(handle: string): number {
  const eff = handleSurprise(handle);
  return Math.round((0.06 + 0.3 * (1 - Math.pow(2, -eff / 3))) * 1000) / 1000;
}

// ---------------------------------------------------------------------------------------------------------------- is this a real name?
export type NameKind = 'full-name' | 'single-name' | 'handle-like';
/**
 * Display names are mostly not names: "xX_Mara_Xx", "Mara", "mara.builds". Only two or more plain words that read as a person's name
 * ("Mara Linden") are treated as a possible real name; the rest are aliases, and nobody's last name or town is looked up from them.
 */
export function classifyName(value: string, handles: string[] = []): NameKind {
  const v = value.trim().replace(/\s+/g, ' ');
  if (!v) return 'handle-like';
  const lower = v.toLowerCase();
  if (handles.some((h) => h && h.toLowerCase().replace(/[^a-z0-9]/g, '') === lower.replace(/[^a-z0-9]/g, ''))) return 'handle-like';
  if (/[\d_@#$%^&*+=<>{}|\\~`]/.test(v) || /[\u{1F300}-\u{1FAFF}☀-➿⭐❤]/u.test(v)) return 'handle-like';
  const words = v.split(' ');
  if (words.length === 1) return /^[\p{Lu}][\p{L}'’-]{1,}$/u.test(v) && v.length <= 14 ? 'single-name' : 'handle-like';
  if (words.length > 4) return 'handle-like';
  const ok = words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w) && w.length >= 2) && words.filter((w) => /^\p{Lu}/u.test(w)).length >= 2;
  return ok ? 'full-name' : 'handle-like';
}

// ---------------------------------------------------------------------------------------------------------------- leads inside a link
/** The service and handle a profile link points at, if Plexus knows the service. */
export function platformOfUrl(raw: string): { platform: PlatformDef; handle?: string } | null {
  let u: URL; try { u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  const p = PLATFORMS.find((x) => x.hosts?.test(u.hostname));
  if (!p) return null;
  const handle = p.fromUrl?.(u);
  return { platform: p, handle: handle && /^[\w.\-]{2,40}$/.test(handle) ? handle : undefined };
}

/** Read a role from untrusted input (an API body): anything unexpected is dropped, never trusted. */
export function cleanRole(x: unknown): HandleRole | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const kind: HandleKind = o.kind === 'display-name' ? 'display-name' : 'username';
  const trust: Trust = o.trust === 'certain' || o.trust === 'unsure' ? o.trust : 'probable';
  const rawPlatform = typeof o.platform === 'string' ? o.platform.trim().slice(0, 40) : '';
  const known = rawPlatform ? platformByName(rawPlatform) : undefined;
  const platform = known?.key ?? (rawPlatform && /^[\p{L}\p{N} ._&+-]+$/u.test(rawPlatform) ? rawPlatform : undefined);
  const origin = ORIGINS.find((v) => v.key === o.origin)?.key;
  const note = typeof o.originNote === 'string' ? o.originNote.trim().slice(0, 200) : '';
  return { platform, kind, trust, alt: o.alt === true || undefined, origin, originNote: note || undefined };
}
