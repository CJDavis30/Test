import { ascii, u16, u32, latin1, utf8, utf16le, utf16be, clean, type Bytes } from './bytes';

export interface AudioInfo { format: string; tags: Record<string, string>; durationSec?: number; sampleRate?: number; channels?: number; hasCover?: boolean }

function id3text(d: Bytes): string {
  const enc = d[0], body = d.subarray(1);
  if (enc === 1) { const le = body[0] === 0xff; return clean((le ? utf16le(body.subarray(2)) : utf16be(body.subarray(2)))); }
  if (enc === 2) return clean(utf16be(body));
  return clean(enc === 3 ? utf8(body) : latin1(body));
}
const syncsafe = (b: Bytes, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const ID3_NAMES: Record<string, string> = { TIT2: 'title', TPE1: 'artist', TALB: 'album', TPE2: 'album artist', TCOM: 'composer', TYER: 'year', TDRC: 'recorded', TDRL: 'released', TCON: 'genre', TENC: 'encoded by', TSSE: 'encoder settings', TCOP: 'copyright', TPUB: 'publisher', TOWN: 'owner', TXXX: 'custom', COMM: 'comment', WXXX: 'link', WOAR: 'artist page', WOAS: 'source page', TOPE: 'original artist', TRCK: 'track', TDEN: 'encoded', TDTG: 'tagged' };

export function parseAudio(b: Bytes): AudioInfo | null {
  if (ascii(b, 0, 3) === 'ID3') {
    const info: AudioInfo = { format: 'MP3 / ID3', tags: {} };
    const ver = b[3], end = Math.min(b.length, 10 + syncsafe(b, 6));
    let p = 10;
    if (b[5] & 0x40) p += ver === 4 ? syncsafe(b, p) : u32(b, p);        // skip an extended header
    while (p + 10 <= end) {
      const id = ascii(b, p, 4); if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = ver === 4 ? syncsafe(b, p + 4) : u32(b, p + 4); if (!size || p + 10 + size > b.length) break;
      const d = b.subarray(p + 10, p + 10 + size);
      if (id === 'APIC') info.hasCover = true;
      else if (id === 'PRIV') { const z = d.indexOf(0); const owner = latin1(d.subarray(0, z)); if (owner && !/^(WM\/|www\.amazon)/.test(owner)) info.tags[`private (${owner.slice(0, 40)})`] = `${d.length - z - 1} bytes`; }
      else if (id === 'TXXX' || id === 'WXXX') { const t = id3text(d); const z = utf16le(d.subarray(1)).length; void z; const parts = t.split(/\u0000/); if (t) info.tags[`${ID3_NAMES[id]}: ${parts[0] || ''}`.replace(/: $/, '')] = parts.slice(1).join(' ') || t; }
      else if (id === 'COMM') { const t = clean(id3text(d.subarray(0, 1).length ? Uint8Array.from([d[0], ...d.subarray(4)]) : d)); if (t) info.tags.comment = t; }
      else if (ID3_NAMES[id]) { const t = id3text(d); if (t) info.tags[ID3_NAMES[id]] = t; }
      p += 10 + size;
    }
    return info;
  }
  if (ascii(b, 0, 4) === 'fLaC') {
    const info: AudioInfo = { format: 'FLAC', tags: {} };
    let p = 4;
    while (p + 4 <= b.length) {
      const last = b[p] & 0x80, type = b[p] & 0x7f, len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3], s = p + 4;
      if (type === 0 && len >= 18) { info.sampleRate = (b[s + 10] << 12) | (b[s + 11] << 4) | (b[s + 12] >> 4); info.channels = ((b[s + 12] >> 1) & 7) + 1; const total = (b[s + 13] & 15) * 2 ** 32 + u32(b, s + 14); if (info.sampleRate) info.durationSec = Math.round(total / info.sampleRate); }
      if (type === 4) { let q = s; const vl = u32(b, q, true); q += 4 + vl; const n = u32(b, q, true); q += 4; for (let i = 0; i < n && q + 4 <= s + len; i++) { const l = u32(b, q, true); const kv = utf8(b.subarray(q + 4, q + 4 + l)); const eq = kv.indexOf('='); if (eq > 0) info.tags[kv.slice(0, eq).toLowerCase()] = kv.slice(eq + 1).slice(0, 400); q += 4 + l; } }
      if (type === 6) info.hasCover = true;
      p = s + len; if (last) break;
    }
    return info;
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') {
    const info: AudioInfo = { format: 'WAV', tags: {} };
    let p = 12, bytesPerSec = 0, dataLen = 0;
    while (p + 8 <= b.length) {
      const id = ascii(b, p, 4), len = u32(b, p + 4, true), s = p + 8;
      if (id === 'fmt ') { info.channels = u16(b, s + 2, true); info.sampleRate = u32(b, s + 4, true); bytesPerSec = u32(b, s + 8, true); }
      else if (id === 'data') dataLen = len;
      else if (id === 'LIST' && ascii(b, s, 4) === 'INFO') { let q = s + 4; const names: Record<string, string> = { IART: 'artist', ICMT: 'comment', ISFT: 'software', ICRD: 'created', INAM: 'title', IENG: 'engineer', ICOP: 'copyright', ISRC: 'source', IPRD: 'product', ITCH: 'technician' }; while (q + 8 <= s + len) { const k = ascii(b, q, 4), l = u32(b, q + 4, true); if (names[k]) info.tags[names[k]] = clean(latin1(b.subarray(q + 8, q + 8 + l))); q += 8 + l + (l & 1); } }
      else if (id === 'bext') { const g = (o: number, n: number) => clean(latin1(b.subarray(s + o, s + o + n))); if (g(0, 256)) info.tags.description = g(0, 256); if (g(256, 32)) info.tags.originator = g(256, 32); if (g(288, 32)) info.tags['originator reference'] = g(288, 32); if (g(320, 10)) info.tags['origination date'] = `${g(320, 10)} ${g(330, 8)}`.trim(); }
      p = s + len + (len & 1);
    }
    if (bytesPerSec && dataLen) info.durationSec = Math.round(dataLen / bytesPerSec);
    return info;
  }
  if (b.length > 128 && ascii(b, b.length - 128, 3) === 'TAG') {
    const g = (o: number, n: number) => clean(latin1(b.subarray(b.length - 128 + o, b.length - 128 + o + n)));
    const tags: Record<string, string> = {}; for (const [k, o, n] of [['title', 3, 30], ['artist', 33, 30], ['album', 63, 30], ['year', 93, 4], ['comment', 97, 30]] as [string, number, number][]) if (g(o, n)) tags[k] = g(o, n);
    if (Object.keys(tags).length) return { format: 'MP3 / ID3v1', tags };
  }
  return null;
}
