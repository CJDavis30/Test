import { ascii, u16, u32, u64, i32, utf8, clean, isoFromMs, find, type Bytes } from './bytes';

/** MP4, MOV, M4A, HEIC and 3GP are all ISO "boxes". This reads the ones that carry who, when, where and with what. */
export interface Mp4Track { type: string; codec?: string; lang?: string; width?: number; height?: number; fps?: number }
export interface Mp4Info {
  brand: string; compat: string[];
  created?: string; modified?: string; durationSec?: number; width?: number; height?: number; rotation?: number;
  tracks: Mp4Track[];
  gps?: { lat: number; lon: number; altitude?: number; raw: string; source: string };
  tags: Record<string, string>;          // lower-cased key → value, from udta and Apple/Android "keys" metadata
  xmp?: string;
}

const E1904 = 2082844800;
const qtTime = (s: number) => (s > 0 ? isoFromMs((s - E1904) * 1000) : undefined);

interface Box { type: string; start: number; hdr: number; end: number }
function* boxes(b: Bytes, start: number, end: number): Generator<Box> {
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p), hdr = 8; const type = ascii(b, p + 4, 4);
    if (size === 1) { size = u64(b, p + 8); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr) return;
    const e = Math.min(end, p + size);
    yield { type, start: p, hdr, end: e };
    if (p + size >= end) return;
    p += size;
  }
}

export function parseIso6709(s: string): { lat: number; lon: number; altitude?: number } | null {
  const m = /^([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?\/?/.exec(s.trim());
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || (lat === 0 && lon === 0)) return null;
  return { lat, lon, altitude: m[3] !== undefined ? +m[3] : undefined };
}

export function parseMp4(b: Bytes): Mp4Info | null {
  if (b.length < 16) return null;
  const first = ascii(b, 4, 4);
  if (!['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'pnot'].includes(first)) return null;
  const info: Mp4Info = { brand: '', compat: [], tracks: [], tags: {} };
  const tag = (k: string, v: string) => { v = clean(v); if (v && !(k in info.tags)) info.tags[k.toLowerCase()] = v.slice(0, 500); };

  const dataValue = (db: Box): string => {
    const kind = u32(b, db.start + db.hdr), p = db.start + db.hdr + 8, n = db.end - p;
    if (kind === 1 || kind === 0) return utf8(b.subarray(p, db.end));
    if (n > 0 && n <= 8 && (kind === 21 || kind === 22 || kind === 65 || kind === 66 || kind === 67)) { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return String(v); }
    return '';
  };

  const meta = (start: number, end: number) => {
    const keys: string[] = [];
    let hdlr = '';
    for (const c of boxes(b, start + 4, end)) {          // "meta" is a full box: 4 bytes of version/flags precede its children
      if (c.type === 'hdlr') hdlr = ascii(b, c.start + c.hdr + 8, 4);
      if (c.type === 'keys') { const n = u32(b, c.start + c.hdr + 4); let p = c.start + c.hdr + 8; for (let i = 0; i < n && p + 8 <= c.end; i++) { const sz = u32(b, p); keys.push(ascii(b, p + 8, sz - 8)); p += sz || 8; } }
      if (c.type === 'ilst') for (const it of boxes(b, c.start + c.hdr, c.end)) {
        const idx = u32(b, it.start + 4);
        const key = hdlr === 'mdta' || (idx >= 1 && idx <= keys.length && keys.length) ? keys[idx - 1] : ascii(b, it.start + 4, 4).replace(/\u00a9/g, '©');
        for (const d of boxes(b, it.start + it.hdr, it.end)) if (d.type === 'data' && key) tag(key.replace(/^com\.apple\.quicktime\./, '').replace(/^com\.android\./, 'android.').replace(/^©/, ''), dataValue(d));
      }
      if (c.type === 'xml ' && c.end - c.start < 200000) { const t = utf8(b.subarray(c.start + c.hdr + 4, c.end)); if (/<x:xmpmeta|<\?xpacket/.test(t)) info.xmp ??= t; }
    }
  };

  const trak = (start: number, end: number) => {
    const t: Mp4Track = { type: '' };
    for (const c of boxes(b, start, end)) {
      if (c.type === 'tkhd') {
        const v = b[c.start + c.hdr], o = c.start + c.hdr + (v === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4);
        const m = o + 8 + 2 + 2 + 2 + 2;
        const a = i32(b, m) / 65536, bb = i32(b, m + 4) / 65536;
        const w = u32(b, m + 36) / 65536, h = u32(b, m + 40) / 65536;
        if (w > 0 && h > 0) { t.width = Math.round(w); t.height = Math.round(h); }
        const rot = Math.round((Math.atan2(bb, a) * 180) / Math.PI);
        if (rot) (t as any).rotation = ((rot % 360) + 360) % 360;
      }
      if (c.type === 'mdia') {
        let timescale = 0, dur = 0;
        for (const m of boxes(b, c.start + c.hdr, c.end)) {
          if (m.type === 'mdhd') {
            const v = b[m.start + m.hdr], o = m.start + m.hdr + 4 + (v === 1 ? 16 : 8);
            timescale = u32(b, o); dur = v === 1 ? u64(b, o + 4) : u32(b, o + 4);
            const lang = u16(b, o + (v === 1 ? 12 : 8));
            if (lang && lang !== 0x55c4) t.lang = String.fromCharCode(((lang >> 10) & 31) + 96, ((lang >> 5) & 31) + 96, (lang & 31) + 96);
          }
          if (m.type === 'hdlr') t.type = ascii(b, m.start + m.hdr + 8, 4);
          if (m.type === 'minf') for (const st of boxes(b, m.start + m.hdr, m.end)) if (st.type === 'stbl') for (const s of boxes(b, st.start + st.hdr, st.end)) {
            if (s.type === 'stsd') t.codec = ascii(b, s.start + s.hdr + 12, 4);
            if (s.type === 'stts' && timescale) {
              const n = u32(b, s.start + s.hdr + 4); let samples = 0, ticks = 0, p = s.start + s.hdr + 8;
              for (let i = 0; i < n && p + 8 <= s.end; i++, p += 8) { samples += u32(b, p); ticks += u32(b, p) * u32(b, p + 4); }
              if (ticks > 0 && t.type === 'vide') t.fps = Math.round((samples / (ticks / timescale)) * 100) / 100;
            }
          }
        }
        void dur;
      }
    }
    if (t.type) info.tracks.push(t);
  };

  const udta = (start: number, end: number) => {
    for (const c of boxes(b, start, end)) {
      if (c.type === 'meta') meta(c.start + c.hdr, c.end);
      else if (c.type === '\u00a9xyz' || c.type === 'xyz ') {
        const len = u16(b, c.start + c.hdr), raw = utf8(b.subarray(c.start + c.hdr + 4, c.start + c.hdr + 4 + len));
        const g = parseIso6709(raw); if (g && !info.gps) info.gps = { ...g, raw: raw.trim(), source: 'video location tag' };
      } else if (c.type.charCodeAt(0) === 0xa9 || ['name', 'titl', 'auth', 'perf', 'dscp', 'cprt', 'yrrc'].includes(c.type)) {
        const len = u16(b, c.start + c.hdr);
        const raw = len > 0 && len <= c.end - c.start - c.hdr - 4 ? utf8(b.subarray(c.start + c.hdr + 4, c.start + c.hdr + 4 + len)) : utf8(b.subarray(c.start + c.hdr + 4, c.end));
        tag(c.type.replace(/\u00a9/g, ''), raw);
      } else if (c.type === 'XMP_' || c.type === 'XMP ') { const t = utf8(b.subarray(c.start + c.hdr, c.end)); if (t.includes('<x:xmpmeta') || t.includes('<?xpacket')) info.xmp ??= t; }
    }
  };

  for (const top of boxes(b, 0, b.length)) {
    if (top.type === 'ftyp') { info.brand = ascii(b, top.start + top.hdr, 4); for (let p = top.start + top.hdr + 8; p + 4 <= top.end; p += 4) info.compat.push(ascii(b, p, 4)); }
    else if (top.type === 'moov') {
      for (const c of boxes(b, top.start + top.hdr, top.end)) {
        if (c.type === 'mvhd') {
          const v = b[c.start + c.hdr], o = c.start + c.hdr + 4;
          if (v === 1) { info.created = qtTime(u64(b, o)); info.modified = qtTime(u64(b, o + 8)); const ts = u32(b, o + 16); if (ts) info.durationSec = Math.round((u64(b, o + 20) / ts) * 100) / 100; }
          else { info.created = qtTime(u32(b, o)); info.modified = qtTime(u32(b, o + 4)); const ts = u32(b, o + 8); if (ts) info.durationSec = Math.round((u32(b, o + 12) / ts) * 100) / 100; }
        }
        if (c.type === 'trak') trak(c.start + c.hdr, c.end);
        if (c.type === 'udta') udta(c.start + c.hdr, c.end);
        if (c.type === 'meta') meta(c.start + c.hdr, c.end);
      }
    } else if (top.type === 'uuid' && ascii(b, top.start + top.hdr, 0) === '' && top.end - top.start < 2_000_000) {
      const t = utf8(b.subarray(top.start + top.hdr + 16, top.end)); if (t.includes('<x:xmpmeta') || t.includes('<?xpacket')) info.xmp ??= t;
    } else if (top.type === 'meta') meta(top.start + top.hdr, top.end);
  }

  const v = info.tracks.find((t) => t.type === 'vide');
  if (v?.width) { info.width = v.width; info.height = v.height; info.rotation = (v as any).rotation; }
  const loc = info.tags['location.iso6709'] ?? info.tags['location.iso6709'];
  if (loc && !info.gps) { const g = parseIso6709(loc); if (g) info.gps = { ...g, raw: loc, source: 'video metadata (location)' }; }
  if (!info.brand && !info.tracks.length && !Object.keys(info.tags).length) return null;
  void find;
  return info;
}
