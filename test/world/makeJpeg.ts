/** Builds small but structurally real JPEG files with EXIF, for tests. The picture data is a stub: only the structure matters here. */
type Val = { t: 1 | 2 | 3 | 4 | 5 | 7; v: string | number[] | number[][] };
type Entries = Record<number, Val>;

export interface JpegSpec {
  make?: string; model?: string; software?: string; artist?: string; copyright?: string; dateTime?: string;
  dateTimeOriginal?: string; offsetTimeOriginal?: string; bodySerial?: string; lensModel?: string; lensSerial?: string; owner?: string;
  width?: number; height?: number; userComment?: string;
  gps?: { lat: number; lon: number; alt?: number; heading?: number; utcDate?: string; utcTime?: [number, number, number]; method?: string };
  thumbnail?: { width: number; height: number };
  xmp?: string; trailing?: Uint8Array; quality?: number; photoshop?: boolean; comment?: string;
}

const dms = (v: number): number[][] => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 10000); return [[d, 1], [m, 1], [s, 10000]]; };

function ifdSize(e: Entries): number {
  let n = 2 + 12 * Object.keys(e).length + 4;
  for (const x of Object.values(e)) n += (len(x) > 4 ? len(x) + (len(x) & 1) : 0);
  return n;
}
function len(x: Val): number {
  if (x.t === 2) return (x.v as string).length + 1;
  if (x.t === 5) return (x.v as number[][]).length * 8;
  if (x.t === 7) return Array.isArray(x.v) ? (x.v as number[]).length : (x.v as string).length;
  const per = x.t === 1 ? 1 : x.t === 3 ? 2 : 4; return (x.v as number[]).length * per;
}
function writeIfd(e: Entries, at: number): Buffer {
  const tags = Object.keys(e).map(Number).sort((a, b) => a - b);
  const out = Buffer.alloc(ifdSize(e)); out.writeUInt16LE(tags.length, 0);
  let dataAt = at + 2 + 12 * tags.length + 4;
  tags.forEach((tag, i) => {
    const x = e[tag], o = 2 + 12 * i, count = x.t === 2 ? (x.v as string).length + 1 : x.t === 5 ? (x.v as number[][]).length : x.t === 7 ? (Array.isArray(x.v) ? (x.v as number[]).length : (x.v as string).length) : (x.v as number[]).length;
    out.writeUInt16LE(tag, o); out.writeUInt16LE(x.t, o + 2); out.writeUInt32LE(count, o + 4);
    const bytes = Buffer.alloc(len(x));
    if (x.t === 2) bytes.write(x.v as string, 'latin1');
    else if (x.t === 7) { if (Array.isArray(x.v)) Buffer.from(x.v as number[]).copy(bytes); else bytes.write(x.v as string, 'latin1'); }
    else if (x.t === 5) (x.v as number[][]).forEach(([n, d], k) => { bytes.writeUInt32LE(n, k * 8); bytes.writeUInt32LE(d, k * 8 + 4); });
    else (x.v as number[]).forEach((n, k) => { if (x.t === 1) bytes[k] = n; else if (x.t === 3) bytes.writeUInt16LE(n, k * 2); else bytes.writeUInt32LE(n, k * 4); });
    if (bytes.length <= 4) bytes.copy(out, o + 8);
    else { out.writeUInt32LE(dataAt, o + 8); bytes.copy(out, dataAt - at); dataAt += bytes.length + (bytes.length & 1); }
  });
  return out;
}

const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

/** A bare JPEG: SOI, quantisation table at the given quality, frame header, scan stub, EOI. */
export function bareJpeg(width: number, height: number, quality = 90, extraSegments: Buffer[] = []): Buffer {
  const scale = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  const nat = STD_LUMA.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
  const zz = ZIGZAG.map((n) => nat[n]);
  const seg = (m: number, body: Buffer) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = m; h.writeUInt16BE(body.length + 2, 2); return Buffer.concat([h, body]); };
  const sof = Buffer.alloc(15); sof[0] = 8; sof.writeUInt16BE(height, 1); sof.writeUInt16BE(width, 3); sof[5] = 3; [[1, 0x22, 0], [2, 0x11, 1], [3, 0x11, 1]].forEach(([id, hv, tq], i) => { sof[6 + i * 3] = id; sof[7 + i * 3] = hv; sof[8 + i * 3] = tq; });
  const sos = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...extraSegments, seg(0xdb, Buffer.from([0, ...zz])), seg(0xc0, sof), seg(0xda, sos), Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]), Buffer.from([0xff, 0xd9])]);
}

export function buildExifJpeg(s: JpegSpec = {}): Buffer {
  const ifd0: Entries = {}, exif: Entries = {}, gps: Entries = {};
  const a = (e: Entries, tag: number, v?: string) => { if (v !== undefined) e[tag] = { t: 2, v }; };
  a(ifd0, 0x010f, s.make); a(ifd0, 0x0110, s.model); a(ifd0, 0x0131, s.software); a(ifd0, 0x0132, s.dateTime); a(ifd0, 0x013b, s.artist); a(ifd0, 0x8298, s.copyright);
  a(exif, 0x9003, s.dateTimeOriginal); a(exif, 0x9011, s.offsetTimeOriginal); a(exif, 0xa431, s.bodySerial); a(exif, 0xa434, s.lensModel); a(exif, 0xa435, s.lensSerial); a(exif, 0xa430, s.owner);
  if (s.userComment) exif[0x9286] = { t: 7, v: 'ASCII\0\0\0' + s.userComment };
  if (s.width && s.height) { exif[0xa002] = { t: 4, v: [s.width] }; exif[0xa003] = { t: 4, v: [s.height] }; }
  if (s.gps) {
    const g = s.gps;
    gps[1] = { t: 2, v: g.lat < 0 ? 'S' : 'N' }; gps[2] = { t: 5, v: dms(g.lat) }; gps[3] = { t: 2, v: g.lon < 0 ? 'W' : 'E' }; gps[4] = { t: 5, v: dms(g.lon) };
    if (g.alt !== undefined) { gps[5] = { t: 1, v: [g.alt < 0 ? 1 : 0] }; gps[6] = { t: 5, v: [[Math.round(Math.abs(g.alt) * 100), 100]] }; }
    if (g.utcTime) gps[7] = { t: 5, v: g.utcTime.map((x) => [x, 1]) };
    if (g.heading !== undefined) { gps[16] = { t: 2, v: 'T' }; gps[17] = { t: 5, v: [[Math.round(g.heading * 100), 100]] }; }
    if (g.method) gps[27] = { t: 7, v: 'ASCII\0\0\0' + g.method };
    if (g.utcDate) gps[29] = { t: 2, v: g.utcDate };
  }
  const hasExif = Object.keys(exif).length > 0, hasGps = Object.keys(gps).length > 0;
  // layout: header(8) | IFD0 | EXIF IFD | GPS IFD | IFD1 + thumbnail
  if (hasExif) ifd0[0x8769] = { t: 4, v: [0] };
  if (hasGps) ifd0[0x8825] = { t: 4, v: [0] };
  const s0 = ifdSize(ifd0), exifAt = 8 + s0, gpsAt = exifAt + (hasExif ? ifdSize(exif) : 0), after = gpsAt + (hasGps ? ifdSize(gps) : 0);
  if (hasExif) ifd0[0x8769] = { t: 4, v: [exifAt] };
  if (hasGps) ifd0[0x8825] = { t: 4, v: [gpsAt] };
  const parts: Buffer[] = [];
  let thumb: Buffer | null = null, ifd1: Buffer | null = null;
  const i0 = writeIfd(ifd0, 8);
  if (s.thumbnail) {
    thumb = bareJpeg(s.thumbnail.width, s.thumbnail.height, 70);
    const e1: Entries = { 0x0201: { t: 4, v: [0] }, 0x0202: { t: 4, v: [thumb.length] } };
    const at1 = after, tAt = at1 + ifdSize(e1);
    e1[0x0201] = { t: 4, v: [tAt] }; ifd1 = writeIfd(e1, at1);
    i0.writeUInt32LE(at1, 2 + 12 * Object.keys(ifd0).length);       // IFD0 "next IFD" pointer
  }
  parts.push(i0);
  if (hasExif) parts.push(writeIfd(exif, exifAt));
  if (hasGps) parts.push(writeIfd(gps, gpsAt));
  if (ifd1 && thumb) parts.push(ifd1, thumb);
  const tiff = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]), ...parts]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const hdr = (m: number, body: Buffer) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = m; h.writeUInt16BE(body.length + 2, 2); return Buffer.concat([h, body]); };
  const segs: Buffer[] = [];
  if (tiff.length > 8) segs.push(hdr(0xe1, app1));
  if (s.xmp) segs.push(hdr(0xe1, Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(s.xmp, 'utf8')])));
  if (s.photoshop) segs.push(hdr(0xed, Buffer.from('Photoshop 3.0\0' + '8BIM', 'latin1')));
  if (s.comment) segs.push(hdr(0xfe, Buffer.from(s.comment, 'latin1')));
  const img = bareJpeg(s.width ?? 4000, s.height ?? 3000, s.quality ?? 92, segs);
  return s.trailing ? Buffer.concat([img, Buffer.from(s.trailing)]) : img;
}
