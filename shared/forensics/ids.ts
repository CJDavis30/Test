/**
 * Platform identifiers are not opaque. Many of them embed facts: a Discord ID is a timestamp plus a worker, a Steam ID names its
 * universe and account type, a Minecraft UUID says whether it was issued by Mojang or derived from the name. Decoding them needs no
 * network, no key and no permission, and is exact.
 */

const BIG = (s: string) => { try { return BigInt(s); } catch { return null; } };

export const EPOCH = { discord: 1420070400000, twitter: 1288834974657, instagram: 1314220021721 };

export interface Snowflake { createdAt: number; iso: string; worker: number; process: number; sequence: number }

/** Discord (and similar) snowflake: 42 bits of milliseconds since an epoch, then 5 bits worker, 5 bits process, 12 bits sequence. */
export function decodeDiscordSnowflake(id: string): Snowflake | null {
  const n = /^\d{15,20}$/.test(id) ? BIG(id) : null; if (n === null) return null;
  const ms = Number(n >> 22n) + EPOCH.discord;
  return { createdAt: ms, iso: new Date(ms).toISOString(), worker: Number((n & 0x3e0000n) >> 17n), process: Number((n & 0x1f000n) >> 12n), sequence: Number(n & 0xfffn) };
}
/** Twitter / X snowflake: same layout, different epoch (and 10 bits of machine). */
export function decodeTwitterSnowflake(id: string): { createdAt: number; iso: string } | null {
  const n = /^\d{15,20}$/.test(id) ? BIG(id) : null; if (n === null) return null;
  const ms = Number(n >> 22n) + EPOCH.twitter;
  return { createdAt: ms, iso: new Date(ms).toISOString() };
}

const IG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Instagram post shortcodes are the media ID written in base 64. The ID's high bits are a timestamp. */
export function instagramShortcodeToId(code: string): bigint | null {
  if (!/^[A-Za-z0-9_-]{6,12}$/.test(code)) return null;
  let id = 0n; for (const ch of code) id = id * 64n + BigInt(IG.indexOf(ch));
  return id;
}
export function instagramIdToShortcode(id: bigint): string { let s = ''; let n = id; if (n === 0n) return 'A'; while (n > 0n) { s = IG[Number(n % 64n)] + s; n /= 64n; } return s; }
export function decodeInstagramPost(code: string): { createdAt: number; iso: string; id: string } | null {
  const id = instagramShortcodeToId(code); if (id === null) return null;
  const ms = Number(id >> 23n) + EPOCH.instagram;
  return { createdAt: ms, iso: new Date(ms).toISOString(), id: id.toString() };
}

export interface Steam64 { accountId: number; universe: number; type: string; instance: number; steam3: string; profileUrl: string }
const STEAM_TYPES = ['Invalid', 'Individual', 'Multiseat', 'GameServer', 'AnonGameServer', 'Pending', 'ContentServer', 'Clan', 'Chat', 'P2P SuperSeeder', 'AnonUser'];
export function decodeSteam64(id: string): Steam64 | null {
  const n = /^7656119\d{10}$/.test(id) ? BIG(id) : null; if (n === null) return null;
  const accountId = Number(n & 0xffffffffn), instance = Number((n >> 32n) & 0xfffffn), type = Number((n >> 52n) & 0xfn), universe = Number(n >> 56n);
  return { accountId, universe, type: STEAM_TYPES[type] ?? `Type ${type}`, instance, steam3: `[U:${universe}:${accountId}]`, profileUrl: `https://steamcommunity.com/profiles/${id}` };
}


/** MD5, dependency-free so this file runs unchanged in the browser and on the server. Only used to reproduce Minecraft's offline UUIDs. */
export function md5(input: string): Uint8Array {
  const msg = new TextEncoder().encode(input);
  const K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const len = msg.length, padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  padded.set(msg); padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, (len * 8) >>> 0, true); dv.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Uint32Array(16); for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0; A = D; D = C; C = B; B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16), o = new DataView(out.buffer);
  o.setUint32(0, a0, true); o.setUint32(4, b0, true); o.setUint32(8, c0, true); o.setUint32(12, d0, true);
  return out;
}
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export interface MinecraftUuid { uuid: string; version: number; kind: 'online' | 'offline' | 'other' }
const hex32 = (u: string) => u.replace(/-/g, '').toLowerCase();
export const dashUuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
export function decodeMinecraftUuid(input: string): MinecraftUuid | null {
  const h = hex32(input); if (!/^[0-9a-f]{32}$/.test(h)) return null;
  const version = parseInt(h[12], 16);
  return { uuid: dashUuid(h), version, kind: version === 4 ? 'online' : version === 3 ? 'offline' : 'other' };
}
/** What a cracked/offline-mode server assigns to a name: MD5("OfflinePlayer:" + name) with the version-3 bits set (Java's UUID.nameUUIDFromBytes). */
export function minecraftOfflineUuid(name: string): string {
  const b = md5(`OfflinePlayer:${name}`);
  b[6] = (b[6] & 0x0f) | 0x30; b[8] = (b[8] & 0x3f) | 0x80;
  return dashUuid(toHex(b));
}

// ---------------------------------------------------------------------------------------------------------------- references in text
export type Platform = 'Discord' | 'Roblox' | 'Steam' | 'Minecraft' | 'X' | 'Instagram' | 'Telegram' | 'TikTok' | 'YouTube' | 'Twitch' | 'Reddit' | 'GitHub';
export interface PlatformRef {
  platform: Platform;
  kind: 'user' | 'message' | 'invite' | 'post' | 'handle';
  /** What it points at: a numeric ID, a vanity name or an invite code. */
  id: string;
  /** A canonical link (or, for IDs with no public page, an identifying string). */
  url: string;
  label: string;
  /** When it was created or posted, when the identifier itself says so. */
  at?: number;
  /** What was decoded, in words. */
  note?: string;
  /** The raw matched text. */
  raw: string;
}

const plausible = (ms: number, min = Date.UTC(2015, 0, 1)) => ms >= min && ms <= Date.now() + 86_400_000;
const when = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

/** Finds platform links and IDs anywhere in free text, and decodes whatever they carry. */
export function findPlatformRefs(text: string): PlatformRef[] {
  const out: PlatformRef[] = [];
  const seen = new Set<string>();
  const add = (r: PlatformRef) => { const k = `${r.platform}|${r.kind}|${r.id}`; if (!seen.has(k)) { seen.add(k); out.push(r); } };
  const T = text.slice(0, 2_000_000);
  let m: RegExpExecArray | null;

  const re = {
    dmsg: /discord(?:app)?\.com\/channels\/(\d{15,20}|@me)\/(\d{15,20})\/(\d{15,20})/gi,
    duser: /discord(?:app)?\.com\/users\/(\d{15,20})/gi,
    dinv: /(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})/gi,
    rob: /roblox\.com\/(?:[a-z]{2}\/)?users\/(\d{1,12})(?:\/profile)?/gi,
    robname: /roblox\.com\/user\.aspx\?(?:id|username)=([A-Za-z0-9_.-]+)/gi,
    steamid: /steamcommunity\.com\/profiles\/(7656119\d{10})/gi,
    steamvan: /steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})/gi,
    tw: /(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{15,20})/gi,
    ig: /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]{6,12})/gi,
    tg: /(?:t\.me|telegram\.me)\/(?!joinchat|\+)([A-Za-z][A-Za-z0-9_]{4,31})/gi,
    tt: /tiktok\.com\/@([A-Za-z0-9_.]{2,24})/gi,
    yt: /youtube\.com\/(?:@|c\/|channel\/|user\/)([A-Za-z0-9_.-]{2,40})/gi,
    tv: /twitch\.tv\/([A-Za-z0-9_]{3,25})(?![A-Za-z0-9_/])/gi,
    rd: /reddit\.com\/u(?:ser)?\/([A-Za-z0-9_-]{3,20})/gi,
    gh: /github\.com\/([A-Za-z0-9-]{1,39})(?![A-Za-z0-9/-])/gi,
    uuid: /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[34][0-9a-f]{3}-?[89ab][0-9a-f]{3}-?[0-9a-f]{12}\b/gi,
    s64: /\b7656119\d{10}\b/g,
    flake: /(?<![\d.])\d{17,20}(?![\d.])/g,
  };

  while ((m = re.dmsg.exec(T))) {
    const s = decodeDiscordSnowflake(m[3]);
    if (s && plausible(s.createdAt)) add({ platform: 'Discord', kind: 'message', id: m[3], url: `https://discord.com/channels/${m[1]}/${m[2]}/${m[3]}`, label: `Discord message ${m[3]}`, at: s.createdAt, note: `Sent ${when(s.createdAt)} (the message ID is a timestamp)`, raw: m[0] });
    const ch = decodeDiscordSnowflake(m[2]); if (ch && plausible(ch.createdAt)) add({ platform: 'Discord', kind: 'user', id: m[2], url: `discord:channel:${m[2]}`, label: `Discord channel ${m[2]}`, at: ch.createdAt, note: `Channel created ${when(ch.createdAt)}`, raw: m[0] });
  }
  while ((m = re.duser.exec(T))) { const s = decodeDiscordSnowflake(m[1]); add({ platform: 'Discord', kind: 'user', id: m[1], url: `https://discord.com/users/${m[1]}`, label: `Discord user ${m[1]}`, at: s && plausible(s.createdAt) ? s.createdAt : undefined, note: s && plausible(s.createdAt) ? `Account created ${when(s.createdAt)} (the ID is a timestamp)` : undefined, raw: m[0] }); }
  while ((m = re.dinv.exec(T))) if (!/^(users|channels|invite|api|developers)$/i.test(m[1])) add({ platform: 'Discord', kind: 'invite', id: m[1], url: `https://discord.gg/${m[1]}`, label: `Discord invite ${m[1]}`, raw: m[0] });
  while ((m = re.rob.exec(T))) add({ platform: 'Roblox', kind: 'user', id: m[1], url: `https://www.roblox.com/users/${m[1]}/profile`, label: `Roblox user ${m[1]}`, raw: m[0] });
  while ((m = re.robname.exec(T))) add({ platform: 'Roblox', kind: /^\d+$/.test(m[1]) ? 'user' : 'handle', id: m[1], url: /^\d+$/.test(m[1]) ? `https://www.roblox.com/users/${m[1]}/profile` : `https://www.roblox.com/user.aspx?username=${m[1]}`, label: `Roblox ${m[1]}`, raw: m[0] });
  while ((m = re.steamid.exec(T))) { const s = decodeSteam64(m[1]); add({ platform: 'Steam', kind: 'user', id: m[1], url: `https://steamcommunity.com/profiles/${m[1]}`, label: `Steam ${m[1]}`, note: s ? `${s.type} account ${s.steam3}` : undefined, raw: m[0] }); }
  while ((m = re.steamvan.exec(T))) add({ platform: 'Steam', kind: 'handle', id: m[1], url: `https://steamcommunity.com/id/${m[1]}`, label: `Steam ${m[1]}`, raw: m[0] });
  while ((m = re.tw.exec(T))) { const s = decodeTwitterSnowflake(m[2]); add({ platform: 'X', kind: 'post', id: m[2], url: `https://x.com/${m[1]}/status/${m[2]}`, label: `X post by @${m[1]}`, at: s && plausible(s.createdAt, Date.UTC(2010, 0, 1)) ? s.createdAt : undefined, note: s ? `Posted ${when(s.createdAt)} (the post ID is a timestamp)` : undefined, raw: m[0] }); add({ platform: 'X', kind: 'handle', id: m[1], url: `https://x.com/${m[1]}`, label: `@${m[1]} on X`, raw: m[0] }); }
  while ((m = re.ig.exec(T))) { const s = decodeInstagramPost(m[1]); if (s && plausible(s.createdAt, Date.UTC(2011, 0, 1))) add({ platform: 'Instagram', kind: 'post', id: m[1], url: `https://www.instagram.com/p/${m[1]}/`, label: `Instagram post ${m[1]}`, at: s.createdAt, note: `Posted ${when(s.createdAt)} (the post code is a timestamp)`, raw: m[0] }); }
  while ((m = re.tg.exec(T))) add({ platform: 'Telegram', kind: 'handle', id: m[1], url: `https://t.me/${m[1]}`, label: `@${m[1]} on Telegram`, raw: m[0] });
  while ((m = re.tt.exec(T))) add({ platform: 'TikTok', kind: 'handle', id: m[1], url: `https://www.tiktok.com/@${m[1]}`, label: `@${m[1]} on TikTok`, raw: m[0] });
  while ((m = re.yt.exec(T))) add({ platform: 'YouTube', kind: 'handle', id: m[1], url: `https://www.youtube.com/@${m[1]}`, label: `${m[1]} on YouTube`, raw: m[0] });
  while ((m = re.tv.exec(T))) if (!/^(videos|directory|downloads|jobs|p|settings)$/i.test(m[1])) add({ platform: 'Twitch', kind: 'handle', id: m[1], url: `https://www.twitch.tv/${m[1]}`, label: `${m[1]} on Twitch`, raw: m[0] });
  while ((m = re.rd.exec(T))) add({ platform: 'Reddit', kind: 'handle', id: m[1], url: `https://www.reddit.com/user/${m[1]}`, label: `u/${m[1]} on Reddit`, raw: m[0] });
  while ((m = re.gh.exec(T))) if (!/^(orgs|topics|features|about|pricing|login|join|sponsors|marketplace|settings|search|notifications|explore)$/i.test(m[1])) add({ platform: 'GitHub', kind: 'handle', id: m[1], url: `https://github.com/${m[1]}`, label: `${m[1]} on GitHub`, raw: m[0] });
  while ((m = re.uuid.exec(T))) { const u = decodeMinecraftUuid(m[0]); if (u) add({ platform: 'Minecraft', kind: 'user', id: u.uuid, url: `minecraft:${u.uuid}`, label: `Minecraft UUID ${u.uuid}`, note: u.kind === 'online' ? 'Issued by Mojang (version 4): a real Minecraft account' : u.kind === 'offline' ? 'Version 3: derived from a player name on an offline-mode server, so the name can be recomputed' : undefined, raw: m[0] }); }
  while ((m = re.s64.exec(T))) { const s = decodeSteam64(m[0]); if (s) add({ platform: 'Steam', kind: 'user', id: m[0], url: s.profileUrl, label: `Steam ${m[0]}`, note: `${s.type} account ${s.steam3}`, raw: m[0] }); }
  // bare long numbers: probably Discord IDs, but only if the date they imply is believable and no URL already explained them
  while ((m = re.flake.exec(T))) {
    if ([...seen].some((k) => k.endsWith(`|${m![0]}`))) continue;
    const d = decodeDiscordSnowflake(m[0]);
    if (d && plausible(d.createdAt) && !/^7656119/.test(m[0])) add({ platform: 'Discord', kind: 'user', id: m[0], url: `https://discord.com/users/${m[0]}`, label: `Discord ID ${m[0]}`, at: d.createdAt, note: `If this is a Discord ID: created ${when(d.createdAt)}. Twitter/X IDs share this format, so check where it came from.`, raw: m[0] });
  }
  return out;
}
