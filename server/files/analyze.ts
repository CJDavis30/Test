import exifr from 'exifr';
import type { Fact, FactGroup, Flag, FileReport, GeoPoint, Importance, Leak, ProposedEntity, TimeEvidence, DeviceInfo, PixelStats } from '../../shared/files';
import { describePlace, mapLinks, offsetPlausible, validCoord, compass, haversineKm } from '../../shared/forensics/geo';
import { daylightCheck } from '../../shared/forensics/sun';
import { findPlatformRefs } from '../../shared/forensics/ids';
import { ascii, hashes, latin1, utf8, clean, isoFromMs, type Bytes } from './bytes';
import { readZip, isZip } from './zip';
import { parseMp4, type Mp4Info } from './mp4';
import { parsePdf, pdfDate } from './pdf';
import { parseOffice } from './office';
import { parseJpeg, parsePng, parseGif, provenanceHints, sniffTrailing } from './image';
import { parseAudio } from './audio';
import { parseExe } from './exe';
import { scanText, stringsOf } from './leaks';
import { dateFromName, originFromName } from './names';

export interface AnalyzeOpts { pixels?: PixelStats; lastModified?: number; now?: number }

const EDITORS = /(photoshop|lightroom|gimp|snapseed|picsart|canva|pixelmator|affinity|paint\.net|capture one|facetune|vsco|photoscape|fotor|luminar|darktable|rawtherapee|acdsee|sketch|figma|illustrator|after effects|premiere|final cut|davinci|capcut|inshot|kinemaster|filmora|imovie|vegas|handbrake|ffmpeg|lavf|lavc|mencoder|openshot|shotcut|ps express)/i;
const GENERIC_NAME = /^(admin|administrator|user|owner|unknown|none|n\/a|na|author|anonymous|guest|test|root|default|microsoft|microsoft office user|apple|samsung|google|android|iphone|pc|windows user|laptop|computer|office|word|excel|powerpoint|adobe|canon|nikon|sony|your name|name|username|me|my|self|\?+|-+)$/i;

class Report {
  facts: Fact[] = []; flags: Flag[] = []; times: TimeEvidence[] = []; leaks: Leak[] = []; entities: ProposedEntity[] = [];
  location?: GeoPoint; device?: DeviceInfo; dims?: { width: number; height: number }; durationSec?: number; tz?: { offsetMin: number; source: string };
  fact(group: FactGroup, label: string, value: unknown, importance: Importance = 1, note?: string) {
    const v = value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
    if (!v || v === 'undefined' || v === '[object Object]') return;
    if (this.facts.some((f) => f.group === group && f.label === label && f.value === v)) return;
    this.facts.push({ group, label, value: v.slice(0, 600), importance, note });
  }
  flag(id: string, severity: Flag['severity'], title: string, detail: string) { if (!this.flags.some((f) => f.id === id)) this.flags.push({ id, severity, title, detail }); }
  time(label: string, iso: string | undefined, kind: TimeEvidence['kind'], source: string, offsetMin?: number) { if (iso && !this.times.some((t) => t.label === label && t.iso === iso)) this.times.push({ label, iso, kind, source, offsetMin }); }
  entity(type: ProposedEntity['type'], value: string, why: string, confidence: ProposedEntity['confidence']) { const v = value.trim(); if (v && !this.entities.some((e) => e.type === type && e.value.toLowerCase() === v.toLowerCase())) this.entities.push({ type, value: v, why, confidence }); }
}

/* ---------- time helpers ---------- */
/** "2024:05:03 14:22:10" (EXIF) or ISO, as wall-clock text with no zone. */
function wall(s: unknown): { iso: string; ms: number } | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(s.trim());
  if (!m || +m[1] < 1970 || +m[2] < 1 || +m[2] > 12) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? '.' + m[7].slice(0, 3) : ''}`;
  return { iso, ms: Date.parse(iso + 'Z') };
}
const parseOffset = (s: unknown): number | undefined => { if (typeof s !== 'string') return undefined; const m = /^([+-])(\d{2}):?(\d{2})$/.exec(s.trim()); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : undefined; };
const fmtOffset = (min: number) => `UTC${min < 0 ? '-' : '+'}${String(Math.floor(Math.abs(min) / 60)).padStart(2, '0')}:${String(Math.abs(min) % 60).padStart(2, '0')}`;
const withOffset = (iso: string, min?: number) => (min === undefined ? iso : `${iso}${min < 0 ? '-' : '+'}${String(Math.floor(Math.abs(min) / 60)).padStart(2, '0')}:${String(Math.abs(min) % 60).padStart(2, '0')}`);
const human = (iso: string, off?: number) => `${iso.replace('T', ' ').replace(/\.\d+/, '')}${off !== undefined ? ` (${fmtOffset(off)})` : ''}`;

/* ---------- sniffing ---------- */
export interface Kind { kind: string; label: string; mime?: string }
export function sniff(b: Bytes, name: string): Kind {
  const ext = (/\.([A-Za-z0-9]{1,6})$/.exec(name)?.[1] ?? '').toLowerCase();
  const h4 = ascii(b, 0, 4);
  if (b[0] === 0xff && b[1] === 0xd8) return { kind: 'jpeg', label: 'JPEG photo', mime: 'image/jpeg' };
  if (b[0] === 0x89 && h4.slice(1) === 'PNG') return { kind: 'png', label: 'PNG image', mime: 'image/png' };
  if (h4 === 'GIF8') return { kind: 'gif', label: 'GIF image', mime: 'image/gif' };
  if (h4 === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { kind: 'webp', label: 'WebP image', mime: 'image/webp' };
  if (h4 === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return { kind: 'audio', label: 'WAV audio', mime: 'audio/wav' };
  if (h4 === 'RIFF' && ascii(b, 8, 4) === 'AVI ') return { kind: 'video-other', label: 'AVI video', mime: 'video/x-msvideo' };
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return { kind: 'heic', label: 'HEIC photo', mime: 'image/heic' };
    if (/^avi[fs]$/.test(brand)) return { kind: 'heic', label: 'AVIF image', mime: 'image/avif' };
    if (/^M4A|^M4B/.test(brand)) return { kind: 'mp4', label: 'M4A audio', mime: 'audio/mp4' };
    if (brand === 'qt  ') return { kind: 'mp4', label: 'QuickTime video', mime: 'video/quicktime' };
    return { kind: 'mp4', label: 'MP4 video', mime: 'video/mp4' };
  }
  if (h4 === '\x1aE\xdf\xa3') return { kind: 'video-other', label: ext === 'webm' ? 'WebM video' : 'Matroska video', mime: 'video/x-matroska' };
  if (h4 === '%PDF') return { kind: 'pdf', label: 'PDF document', mime: 'application/pdf' };
  if (h4 === 'II*\0' || h4 === 'MM\0*') return { kind: 'tiff', label: ext === 'dng' ? 'DNG raw photo' : /^(cr2|nef|arw|orf|rw2)$/.test(ext) ? 'Camera raw photo' : 'TIFF image', mime: 'image/tiff' };
  if (h4.slice(0, 2) === 'BM' && ext === 'bmp') return { kind: 'bmp', label: 'BMP image', mime: 'image/bmp' };
  if (h4.slice(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || h4 === 'fLaC') return { kind: 'audio', label: h4 === 'fLaC' ? 'FLAC audio' : 'MP3 audio', mime: h4 === 'fLaC' ? 'audio/flac' : 'audio/mpeg' };
  if (h4 === 'OggS') return { kind: 'audio-other', label: 'Ogg audio/video', mime: 'audio/ogg' };
  if (ascii(b, 0, 2) === 'MZ') return { kind: 'exe', label: 'Windows program', mime: 'application/vnd.microsoft.portable-executable' };
  if (b[0] === 0x7f && h4.slice(1) === 'ELF') return { kind: 'exe', label: 'Linux program' };
  if (ascii(b, 0, 15) === 'SQLite format 3') return { kind: 'sqlite', label: 'SQLite database', mime: 'application/vnd.sqlite3' };
  if (b[0] === 0x1f && b[1] === 0x8b) return { kind: 'archive', label: 'gzip archive' };
  if (h4 === 'Rar!') return { kind: 'archive', label: 'RAR archive' };
  if (h4.slice(0, 2) === '7z') return { kind: 'archive', label: '7-Zip archive' };
  if (isZip(b)) return { kind: 'zip', label: /^(docx|xlsx|pptx)$/.test(ext) ? `${ext.toUpperCase()} document` : /^(odt|ods|odp)$/.test(ext) ? 'OpenDocument file' : ext === 'apk' ? 'Android app' : ext === 'jar' ? 'Java archive' : 'ZIP archive', mime: 'application/zip' };
  if (h4 === '\xd0\xcf\x11\xe0') return { kind: 'ole', label: /^doc$/.test(ext) ? 'Word 97–2003 document' : /^xls$/.test(ext) ? 'Excel 97–2003 workbook' : /^ppt$/.test(ext) ? 'PowerPoint 97–2003 deck' : 'Legacy Office file', mime: 'application/x-ole-storage' };
  const sample = b.subarray(0, 4096);
  let bin = 0; for (const c of sample) if (c === 0 || (c < 9) || (c > 13 && c < 32)) bin++;
  if (sample.length && bin / sample.length < 0.02) return { kind: 'text', label: /^(html?|xhtml)$/.test(ext) ? 'HTML page' : ext === 'json' ? 'JSON data' : ext === 'csv' ? 'CSV table' : /^(txt|log|md)$/.test(ext) ? 'Text file' : 'Text file', mime: 'text/plain' };
  return { kind: 'unknown', label: ext ? `.${ext} file` : 'Unknown file' };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? clean(v) || undefined : Array.isArray(v) ? clean(v.filter((x) => typeof x === 'string').join(', ')) || undefined : undefined);
const decodeCharsetBytes = (v: unknown): string | undefined => {
  if (typeof v === 'string') return clean(v.replace(/^(ASCII|UNICODE|JIS)\0*/i, '')) || undefined;
  if (v && typeof v === 'object') { const arr = Object.keys(v as object).sort((a, b) => +a - +b).map((k) => (v as any)[k]); if (arr.every((x) => typeof x === 'number')) return clean(Buffer.from(arr as number[]).subarray(8).toString('latin1')) || undefined; }
  return undefined;
};
const plausiblePerson = (s?: string) => !!s && !GENERIC_NAME.test(s.trim()) && !/[@\\/<>_0-9]/.test(s) && /^[\p{L}][\p{L}.'’\- ]{2,60}$/u.test(s) && s.trim().split(/\s+/).length >= 2;
const plausibleHandle = (s?: string) => !!s && !GENERIC_NAME.test(s.trim()) && /^[A-Za-z0-9._-]{3,30}$/.test(s) && !/^\d+$/.test(s);

function addPerson(r: Report, name: string | undefined, why: string) {
  if (!name) return;
  if (plausiblePerson(name)) r.entity('person', name, why, 'medium');
  else if (plausibleHandle(name)) r.entity('username', name, `${why} (a single word, so more likely a login name than a person)`, 'low');
}

/* ---------- images ---------- */
async function analyzeImage(b: Buffer, kind: string, r: Report, opts: AnalyzeOpts, name: string) {
  let raw: any = null;
  try { raw = await exifr.parse(b, <any>{ tiff: true, ifd0: true, exif: true, gps: true, ifd1: true, xmp: true, iptc: true, icc: true, jfif: true, ihdr: true, makerNote: false, userComment: true, multiSegment: true, mergeOutput: false, translateValues: false, reviveValues: false, sanitize: true }); } catch { /* unreadable metadata is itself informative */ }
  const ifd0 = raw?.ifd0 ?? {}, ex = raw?.exif ?? {}, gps = raw?.gps ?? {}, iptc = raw?.iptc ?? {}, icc = raw?.icc ?? {};
  const xmp: Record<string, any> = {};
  if (raw) for (const [k, v] of Object.entries(raw)) if (!['ifd0', 'ifd1', 'exif', 'gps', 'interop', 'iptc', 'icc', 'jfif', 'ihdr', 'makerNote'].includes(k) && v && typeof v === 'object') for (const [kk, vv] of Object.entries(v as object)) xmp[`${k}.${kk}`] = vv;
  const hasAnyMeta = !!(raw && (Object.keys(ifd0).length || Object.keys(ex).length || Object.keys(gps).length || Object.keys(xmp).length || Object.keys(iptc).length));

  const jpeg = kind === 'jpeg' ? parseJpeg(b) : null;
  const png = kind === 'png' ? parsePng(b) : null;
  const gif = kind === 'gif' ? parseGif(b) : null;
  let w = num(ex.ExifImageWidth) ?? jpeg?.width ?? png?.width ?? gif?.width ?? num(raw?.ihdr?.ImageWidth) ?? num(ifd0.ImageWidth);
  let h = num(ex.ExifImageHeight) ?? jpeg?.height ?? png?.height ?? gif?.height ?? num(raw?.ihdr?.ImageHeight) ?? num(ifd0.ImageHeight);
  if (jpeg?.width && jpeg.height) { w = jpeg.width; h = jpeg.height; }
  if (w && h) { r.dims = { width: w, height: h }; r.fact('content', 'Size', `${w} × ${h} px (${((w * h) / 1e6).toFixed(1)} megapixels)`, 1); }
  if (num(ifd0.Orientation) && num(ifd0.Orientation) !== 1) r.fact('content', 'Orientation flag', `${ifd0.Orientation} (the picture is stored rotated; viewers turn it)`, 0);

  /* device */
  const make = str(ifd0.Make), model = str(ifd0.Model), software = str(ifd0.Software) ?? str(xmp['xmp.CreatorTool']);
  const serial = str(ex.SerialNumber) ?? str(ex.BodySerialNumber) ?? str(raw?.makerNote?.SerialNumber);
  const lensModel = str(ex.LensModel), lensSerial = str(ex.LensSerialNumber);
  const owner = str(ex.OwnerName) ?? str(ex.CameraOwnerName) ?? str(xmp['aux.OwnerName']);
  if (make || model || serial || lensModel || owner) {
    const dev: DeviceInfo = { make, model, serial, lensModel, lensSerial, owner, software, fingerprint: [make, model, lensModel, owner].map((x) => (x ?? '').toLowerCase()).join('|') };
    r.device = dev;
  }
  if (make || model) r.fact('device', 'Camera', [make, model].filter(Boolean).join(' ').replace(/^(\w+) \1/i, '$1'), 2);
  if (serial) r.fact('device', 'Camera serial number', serial, 3, 'Unique to this camera body. Photos with the same number came from the same device.');
  if (lensModel) r.fact('device', 'Lens', lensModel, 1);
  if (lensSerial) r.fact('device', 'Lens serial number', lensSerial, 2);
  if (owner) { r.fact('who', 'Camera owner', owner, 3, 'The owner name stored in the camera settings.'); addPerson(r, owner, 'camera owner name stored in the photo'); }
  if (str(ifd0.HostComputer)) r.fact('device', 'Device name', str(ifd0.HostComputer), 1);
  const settings = [num(ex.ISO) !== undefined && `ISO ${ex.ISO}`, num(ex.ExposureTime) && `1/${Math.round(1 / (ex.ExposureTime as number))}s`, num(ex.FNumber) && `f/${ex.FNumber}`, num(ex.FocalLength) && `${Math.round(ex.FocalLength)} mm${num(ex.FocalLengthIn35mmFormat) ? ` (${ex.FocalLengthIn35mmFormat} mm equivalent)` : ''}`].filter(Boolean);
  if (settings.length) r.fact('device', 'Exposure', settings.join(' · '), 0);
  if (software) {
    const edited = EDITORS.test(software);
    r.fact('edit', 'Software', software, edited ? 3 : 1, edited ? 'An editing program saved this file.' : 'Usually the phone or camera firmware.');
    if (edited) r.flag('edited-software', 'notice', 'Saved by editing software', `"${software}" last saved this file, so what you are looking at may differ from what the camera recorded.`);
  }

  /* who */
  const artist = str(ifd0.Artist) ?? str(ifd0.XPAuthor) ?? str(xmp['dc.creator']);
  if (artist) { r.fact('who', 'Author / photographer', artist, 3); addPerson(r, artist, 'author or photographer written in the photo'); }
  const copyright = str(ifd0.Copyright) ?? str(xmp['dc.rights']) ?? str(iptc.CopyrightNotice);
  if (copyright) r.fact('who', 'Copyright', copyright, 2);
  for (const [k, label] of [['Byline', 'Byline'], ['Credit', 'Credit'], ['Source', 'Source'], ['WriterEditor', 'Caption writer'], ['Contact', 'Contact']] as const) { const v = str(iptc[k]); if (v) { r.fact('who', label, v, k === 'Byline' ? 3 : 2); if (k === 'Byline') addPerson(r, v, 'byline written in the photo'); } }
  for (const k of ['photoshop.Credit', 'photoshop.Source', 'Iptc4xmpCore.CreatorContactInfo']) if (str(xmp[k])) r.fact('who', k.split('.')[1], str(xmp[k]), 2);

  /* what it says about itself */
  const desc = str(ifd0.ImageDescription) ?? str(xmp['dc.description']) ?? str(iptc['Caption-Abstract']) ?? str(iptc.Headline);
  if (desc && !/^(OLYMPUS|SONY|KODAK|DCIM|Created with|0+$)/i.test(desc)) r.fact('content', 'Description', desc, 2);
  const uc = decodeCharsetBytes(ex.UserComment); if (uc) r.fact('content', 'Comment', uc, 2);
  const xpc = str(ifd0.XPComment) ?? str(ifd0.XPSubject) ?? str(ifd0.XPTitle); if (xpc) r.fact('content', 'Windows comment', xpc, 2);
  const kw = str(iptc.Keywords) ?? str(ifd0.XPKeywords) ?? str(xmp['dc.subject']); if (kw) r.fact('content', 'Keywords', kw, 1);
  if (str(raw?.icc?.ProfileDescription ?? icc.ProfileDescription)) r.fact('content', 'Colour profile', str(icc.ProfileDescription), 0);

  /* when */
  const dto = wall(ex.DateTimeOriginal), dtd = wall(ex.CreateDate ?? ex.DateTimeDigitized), dt0 = wall(ifd0.ModifyDate ?? ifd0.DateTime);
  const offO = parseOffset(ex.OffsetTimeOriginal) ?? parseOffset(ex.OffsetTime), offD = parseOffset(ex.OffsetTimeDigitized);
  const sub = str(ex.SubSecTimeOriginal);
  let captured = dto ?? dtd;
  let capOffset = dto ? offO : offD ?? offO;
  /* GPS clock (UTC) */
  let gpsUtc: number | undefined;
  if (typeof gps.GPSDateStamp === 'string' && typeof gps.GPSTimeStamp !== 'undefined') {
    const t = typeof gps.GPSTimeStamp === 'string' ? gps.GPSTimeStamp.split(':').map(Number) : Array.isArray(gps.GPSTimeStamp) ? gps.GPSTimeStamp.map(Number) : [];
    const d = /^(\d{4})[:\-](\d{2})[:\-](\d{2})/.exec(gps.GPSDateStamp);
    if (d && t.length === 3 && t.every(Number.isFinite)) gpsUtc = Date.UTC(+d[1], +d[2] - 1, +d[3], t[0], t[1], Math.floor(t[2]));
  }
  if (captured) {
    r.fact('when', 'Photo taken', human(captured.iso, capOffset) + (sub ? ` .${sub}` : ''), 3, capOffset === undefined ? 'Local time on the camera. The camera did not record its timezone.' : 'Local time on the camera, with the timezone it was set to.');
    r.time('Photo taken', withOffset(captured.iso, capOffset), 'captured', 'camera clock', capOffset);
  }
  if (dtd && dto && dtd.iso !== dto.iso) { r.fact('when', 'Digitised', human(dtd.iso, offD), 1); r.time('Digitised', withOffset(dtd.iso, offD), 'created', 'camera clock', offD); }
  if (dt0 && (!dto || dt0.iso !== dto.iso)) { r.fact('when', 'Last changed', human(dt0.iso, parseOffset(ex.OffsetTime)), dto ? 2 : 1, dto ? 'Differs from the time the photo was taken: the file was saved again later.' : undefined); r.time('Metadata last changed', dt0.iso, 'modified', 'EXIF'); }
  if (gpsUtc) { r.fact('when', 'GPS clock (UTC)', new Date(gpsUtc).toISOString().replace('.000Z', 'Z').replace('T', ' '), 2, 'Time from the satellites: harder to change than the camera clock.'); r.time('GPS clock', new Date(gpsUtc).toISOString(), 'gps', 'GPS receiver', 0); }
  /* timezone the camera was set to */
  if (captured && capOffset !== undefined) r.tz = { offsetMin: capOffset, source: 'the offset recorded with the capture time' };
  else if (captured && gpsUtc) {
    const raw = (captured.ms - gpsUtc) / 60000, off = Math.round(raw / 15) * 15;
    if (Math.abs(raw - off) <= 6 && Math.abs(off) <= 840) { capOffset = off; r.tz = { offsetMin: off, source: 'the difference between the camera clock and the GPS clock' }; r.fact('when', 'Timezone the camera was set to', fmtOffset(off), 3, 'Worked out from camera time versus GPS time. It shows which part of the world the owner set the camera to.'); }
  }
  if (captured && capOffset !== undefined && r.tz?.source.startsWith('the offset')) r.fact('when', 'Timezone the camera was set to', fmtOffset(capOffset), 2);
  if (captured && gpsUtc && offO !== undefined) {
    const impl = (captured.ms - offO * 60000 - gpsUtc) / 60000;
    if (Math.abs(impl) > 10) r.flag('clock-vs-gps', 'warning', 'Camera clock disagrees with the GPS clock', `The recorded time and timezone put the photo ${Math.abs(Math.round(impl))} minutes ${impl > 0 ? 'after' : 'before'} the satellite time. The camera clock was off, or one of the values was edited.`);
  }

  /* where */
  const lat = num(gps.latitude), lon = num(gps.longitude);
  let alt = num(gps.GPSAltitude); if (alt !== undefined && JSON.stringify(gps.GPSAltitudeRef ?? '') .includes('1') && !JSON.stringify(gps.GPSAltitudeRef).includes('"0":0')) alt = -alt;
  if (lat !== undefined && lon !== undefined && validCoord(lat, lon)) {
    const method = decodeCharsetBytes(gps.GPSProcessingMethod);
    const heading = num(gps.GPSImgDirection), acc = num(gps.GPSHPositioningError);
    const coarse = !!method && /(network|cell|wlan|wifi|wi-fi|manual|fused|passive)/i.test(method);
    r.location = { lat, lon, altitude: alt, heading, accuracyM: acc, source: 'GPS coordinates stored in the photo', method, description: describePlace(lat, lon), links: mapLinks(lat, lon) };
    r.fact('where', 'GPS location', `${lat.toFixed(5)}, ${lon.toFixed(5)}`, 3, `${describePlace(lat, lon)}.${acc ? ` Accurate to about ${Math.round(acc)} m.` : coarse ? ' Taken from phone-network or Wi-Fi positioning, so it may be hundreds of metres off.' : ''}`);
    if (alt !== undefined) r.fact('where', 'Altitude', `${Math.round(alt)} m above sea level`, 1);
    if (heading !== undefined) r.fact('where', 'Camera was facing', `${compass(heading)} (${Math.round(heading)}°)`, 2, 'The direction the lens pointed. Look along this line on a map to find what was in frame.');
    if (method) r.fact('where', 'How the position was found', method, coarse ? 2 : 0);
    if (num(gps.GPSSpeed)) r.fact('where', 'Moving at', `${(gps.GPSSpeed as number).toFixed(1)} ${/K/i.test(String(gps.GPSSpeedRef)) ? 'km/h' : /M/i.test(String(gps.GPSSpeedRef)) ? 'mph' : 'knots'}`, 1);
    r.entity('location', `${lat.toFixed(5)}, ${lon.toFixed(5)}`, `GPS position stored in the photo (${describePlace(lat, lon)})`, coarse ? 'medium' : 'high');
    if (coarse) r.flag('coarse-gps', 'notice', 'Position may be approximate', `The phone found this position with "${method}" rather than satellites, so treat it as a neighbourhood, not a doorstep.`);
  } else if (lat !== undefined || lon !== undefined) r.flag('bad-gps', 'notice', 'GPS values present but unusable', 'The file has GPS fields, but they are empty or at 0°, 0° (the default of a failed fix).');
  const city = str(iptc.City) ?? str(xmp['photoshop.City']), state = str(iptc['Province-State']) ?? str(xmp['photoshop.State']), country = str(iptc['Country-PrimaryLocationName']) ?? str(xmp['photoshop.Country']), subloc = str(iptc['Sub-location']) ?? str(xmp['Iptc4xmpCore.Location']);
  const placeText = [subloc, city, state, country].filter(Boolean).join(', ');
  if (placeText) { r.fact('where', 'Location named in the file', placeText, r.location ? 2 : 3, 'Typed in by a person or an app, not measured, so it can be wrong.'); if (city) r.entity('location', placeText, 'place name written in the photo\'s metadata', 'medium'); }

  /* file-structure checks */
  if (jpeg) {
    if (jpeg.quality) r.fact('content', 'JPEG quality', `about ${jpeg.quality.value}${jpeg.quality.exact ? '' : ' (custom tables)'}${jpeg.subsampling ? `, chroma ${jpeg.subsampling}` : ''}${jpeg.progressive ? ', progressive' : ''}`, 0);
    if (jpeg.hasPhotoshop) { r.fact('edit', 'Photoshop data block', 'present', 2, 'Adobe software wrote its own data block into this file.'); r.flag('photoshop-block', 'notice', 'Passed through Adobe software', 'The file contains a Photoshop resource block, which only Adobe-compatible editors write.'); }
    if (jpeg.comments.length) r.fact('content', 'File comment', jpeg.comments.join(' | '), 1);
    if (jpeg.trailing > 0) { r.fact('edit', 'Data after the end of the picture', `${jpeg.trailing.toLocaleString('en-US')} bytes (${jpeg.trailingKind})`, 3, 'Extra bytes hidden after the image data.'); r.flag('appended-data', 'warning', 'Extra data hidden after the picture', `${jpeg.trailing.toLocaleString('en-US')} bytes follow the end of the image: it looks like ${jpeg.trailingKind}. Photos do not normally have this. It is a classic way to hide a file inside a picture.`); }
    if (kind === 'jpeg' && jpeg.hasExif && !jpeg.segments.includes('APP0') && !jpeg.hasIcc && jpeg.quality && jpeg.quality.value < 70 && !dto) r.flag('recompressed', 'info', 'Heavily compressed', 'Low quality with little metadata is typical of a picture that passed through a messaging app or social site.');
    try {
      const th = await exifr.thumbnail(b);
      if (th && th.length > 100) {
        const tj = parseJpeg(th as Uint8Array);
        if (tj?.width && tj.height && w && h) {
          const ar = tj.width / tj.height, mr = w / h;
          const rotated = Math.abs(ar - 1 / mr) / ar < 0.03 && Math.abs(mr - 1) > 0.05;
          if (Math.abs(ar - mr) / mr > 0.04 && !rotated) { r.fact('edit', 'Embedded preview', `${tj.width}×${tj.height}, but the picture is ${w}×${h}`, 3, 'The preview stored in the file has a different shape from the full picture.'); r.flag('thumbnail-mismatch', 'warning', 'The picture was cropped or changed after it was taken', `The small preview inside the file is ${tj.width}×${tj.height} (shape ${ar.toFixed(2)}) but the picture is ${w}×${h} (shape ${mr.toFixed(2)}). Cameras write both at once; a mismatch means an editor changed the picture and left the old preview behind. Compare them to see what was removed.`); }
          else r.fact('content', 'Embedded preview', `${tj.width}×${tj.height}, matches the picture's shape`, 0);
        }
      }
    } catch { /* no thumbnail */ }
  }
  if (png) {
    if (png.time) { r.fact('when', 'PNG saved', png.time.replace('T', ' '), 2); r.time('PNG saved', png.time.replace('Z', ''), 'modified', 'PNG tIME chunk', 0); }
    for (const [k, v] of Object.entries(png.text)) if (!/^(parameters|prompt|workflow)$/.test(k)) r.fact('content', `PNG text: ${k}`, v.slice(0, 300), /^(author|copyright|software|description|comment|source|creation time)$/i.test(k) ? 2 : 0);
    if (png.trailing > 16) { r.fact('edit', 'Data after the end of the image', `${png.trailing.toLocaleString('en-US')} bytes (${sniffTrailing(b, b.length - png.trailing)})`, 3); r.flag('appended-data', 'warning', 'Extra data hidden after the picture', `${png.trailing.toLocaleString('en-US')} bytes follow the PNG end marker.`); }
    if (png.ai) {
      r.fact('edit', 'Made by AI', png.ai.tool, 3, 'The file carries the generation settings of an AI image tool.');
      for (const [k, v] of Object.entries(png.ai.details)) r.fact('edit', `AI setting: ${k}`, v, 1);
      if (png.ai.prompt) r.fact('content', 'AI prompt', png.ai.prompt, 2);
      r.flag('ai-generated', 'warning', 'This image was made by an AI tool', `The file's own metadata says it came from ${png.ai.tool}. It is not a photograph of a real scene.`);
    }
    if (!hasAnyMeta && !Object.keys(png.text).length && kind === 'png') r.flag('no-metadata', 'info', 'No capture data', 'A PNG with no metadata is typical of screenshots and exported graphics. It tells you nothing about who made it or where.');
  }
  if (gif) { r.fact('content', 'Animation', gif.frames > 1 ? `${gif.frames} frames${gif.loop === 0 ? ', loops forever' : ''}` : 'single frame', 0); if (gif.comments.length) r.fact('content', 'GIF comment', gif.comments.join(' | '), 1); }

  /* provenance and AI declarations */
  const prov = provenanceHints(b);
  if (prov.c2pa) { r.fact('edit', 'Content Credentials (C2PA)', `present${prov.claimTool ? ` · made with ${prov.claimTool}` : ''}${prov.actions.length ? ` · recorded actions: ${prov.actions.join(', ')}` : ''}`, 3, 'A signed history of how the file was made. Plexus detects it but does not verify the signature; use contentcredentials.org/verify.'); r.flag('c2pa', 'info', 'Carries Content Credentials', 'The file has an embedded C2PA manifest (a signed record of its creation and edits). It was detected, not verified here.'); }
  const dst = str(xmp['Iptc4xmpExt.DigitalSourceType']) ?? str(xmp['iptcExt.DigitalSourceType']);
  if ((dst && /algorithmicMedia/i.test(dst)) || prov.aiDeclared) { r.fact('edit', 'Declared as AI-generated', dst ?? 'trainedAlgorithmicMedia', 3); r.flag('ai-declared', 'warning', 'The file declares it was made or altered by AI', 'Its metadata marks the source as algorithmic (AI) media.'); }
  const hist = xmp['xmpMM.History']; if (Array.isArray(hist) && hist.length) { const agents = [...new Set(hist.map((x: any) => str(x?.softwareAgent)).filter(Boolean))]; if (agents.length) r.fact('edit', 'Edit history (XMP)', agents.join(' → '), 2); }
  if (!hasAnyMeta && (kind === 'jpeg' || kind === 'webp' || kind === 'heic')) r.flag('no-metadata', 'info', 'No camera data in this file', 'There is no EXIF, XMP or IPTC data. That is normal for pictures that went through WhatsApp, Discord, social media or a screenshot tool, which strip it, and it is also what deliberate cleaning looks like. It tells you nothing either way.');
  if (hasAnyMeta && !r.location && kind === 'jpeg' && (make || model)) r.fact('where', 'GPS location', 'none stored', 0, 'This photo carries camera data but no location: location tagging was off or stripped.');

  /* time checks that need a place */
  if (r.location && captured) {
    const instant = capOffset !== undefined ? captured.ms - capOffset * 60000 : gpsUtc;
    if (instant) {
      const dl = daylightCheck(instant, r.location.lat, r.location.lon, opts.pixels?.sky);
      r.fact('when', 'Sun at that place and time', dl.note, dl.consistent === false ? 3 : 1);
      if (dl.consistent === false) r.flag('daylight', 'warning', 'The sky does not match the recorded time', dl.note);
    }
    if (capOffset !== undefined) { const p = offsetPlausible(r.location.lon, capOffset); if (!p.ok) r.flag('tz-vs-place', 'warning', 'Timezone does not fit the location', `The camera clock was set to ${fmtOffset(capOffset)}, but the GPS position is near longitude ${r.location.lon.toFixed(1)}°, where clocks are normally about UTC${p.expectedHours >= 0 ? '+' : ''}${p.expectedHours.toFixed(0)}. The photo may have been taken elsewhere than the GPS says, the GPS may have been edited, or the phone was set to another country's time.`); }
  }
  void name;
}

/* ---------- video / audio ---------- */
function analyzeVideo(b: Bytes, info: Mp4Info, r: Report, opts: AnalyzeOpts) {
  const isAudio = !info.tracks.some((t) => t.type === 'vide') && info.tracks.some((t) => t.type === 'soun');
  const t = info.tags;
  if (info.width && info.height) { r.dims = { width: info.width, height: info.height }; r.fact('content', 'Size', `${info.width} × ${info.height} px${info.rotation ? `, rotated ${info.rotation}°` : ''}`, 1); }
  if (info.durationSec !== undefined) { r.durationSec = info.durationSec; r.fact('content', 'Length', `${Math.floor(info.durationSec / 60)}:${String(Math.round(info.durationSec % 60)).padStart(2, '0')}`, 1); }
  const v = info.tracks.find((x) => x.type === 'vide');
  if (v) r.fact('content', 'Video', [v.codec, v.fps && `${v.fps} fps`].filter(Boolean).join(' · '), 0);
  const a = info.tracks.find((x) => x.type === 'soun'); if (a) r.fact('content', 'Audio', [a.codec, a.lang && `language "${a.lang}"`].filter(Boolean).join(' · '), 0);
  const lang = info.tracks.map((x) => x.lang).find(Boolean); if (lang && !a?.lang) r.fact('content', 'Language tag', lang, 0);
  const make = t.make ?? t['android.manufacturer'], model = t.model ?? t['android.model'];
  const software = t.software ?? t.too ?? t.swr ?? t.encoder;
  if (make || model) { r.device = { make, model, software, fingerprint: [make, model, '', ''].map((x) => (x ?? '').toLowerCase()).join('|') }; r.fact('device', 'Camera', [make, model].filter(Boolean).join(' '), 2); }
  if (t['android.version']) r.fact('device', 'Android version', t['android.version'], 1, 'The phone was running this Android version when it recorded the clip.');
  if (software) { const ed = EDITORS.test(software); r.fact('edit', 'Software / encoder', software, ed ? 3 : 1, ed ? 'This was processed or exported by an editor or converter.' : undefined); if (ed) r.flag('edited-software', 'notice', 'Processed by editing or converting software', `"${software}" wrote this file, so it was exported or re-encoded after recording.`); }
  const brandNote = info.brand.trim(); if (brandNote) r.fact('file', 'Container', `${brandNote}${info.compat.length ? ` (${[...new Set(info.compat)].slice(0, 5).join(', ')})` : ''}`, 0);
  for (const k of ['author', 'artist', 'performer', 'copyright', 'cprt', 'name', 'nam', 'title', 'titl', 'comment', 'cmt', 'description', 'dscp', 'album', 'alb', 'day']) if (t[k]) { const imp: Importance = /^(author|artist|performer|auth|perf)$/.test(k) ? 3 : /copyright|cprt|comment|cmt/.test(k) ? 2 : 1; r.fact(/^(author|artist|performer|copyright|cprt)$/.test(k) ? 'who' : 'content', k[0].toUpperCase() + k.slice(1), t[k], imp); if (imp === 3) addPerson(r, t[k], 'author named in the video metadata'); }
  const apple = t.creationdate;
  let off: number | undefined, localTs: string | undefined;
  if (apple) { const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}:?\d{2}|Z)$/.exec(apple); if (m) { off = m[2] === 'Z' ? 0 : parseOffset(m[2]); localTs = m[1]; } }
  if (localTs) { r.fact('when', 'Recorded', human(localTs, off), 3, 'Local time and timezone from the phone, as written by Apple devices.'); r.time('Recorded', withOffset(localTs, off), 'captured', 'QuickTime metadata', off); if (off !== undefined) { r.tz = { offsetMin: off, source: 'the offset Apple devices store with the recording time' }; r.fact('when', 'Timezone the phone was set to', fmtOffset(off), 3); } }
  if (info.created) { r.fact('when', 'Container created (UTC)', info.created.replace('.000Z', 'Z').replace('T', ' '), localTs ? 1 : 3, 'Written in UTC by the recorder. Many editors reuse or reset it.'); r.time('Container created', info.created, localTs ? 'created' : 'captured', 'video header', 0); }
  else if (!isAudio) r.flag('no-created', 'info', 'No creation time in the video header', 'The creation time is zero: it was cleared by an editor or exporter, or the recorder never set it.');
  if (info.modified && info.modified !== info.created) { r.fact('when', 'Container modified (UTC)', info.modified.replace('.000Z', 'Z').replace('T', ' '), 1); r.time('Container modified', info.modified, 'modified', 'video header', 0); }
  if (info.created && info.modified && Date.parse(info.modified) < Date.parse(info.created)) r.flag('mod-before-create', 'warning', 'Modified before it was created', 'The header says the file was last changed before it was made. That cannot happen naturally.');
  if (info.gps) {
    const g = info.gps; r.location = { lat: g.lat, lon: g.lon, altitude: g.altitude, source: g.source, description: describePlace(g.lat, g.lon), links: mapLinks(g.lat, g.lon) };
    r.fact('where', 'GPS location', `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}`, 3, `${describePlace(g.lat, g.lon)}.`); if (g.altitude !== undefined) r.fact('where', 'Altitude', `${Math.round(g.altitude)} m`, 1);
    r.entity('location', `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}`, 'GPS position stored in the video', 'high');
    if (off !== undefined) { const p = offsetPlausible(g.lon, off); if (!p.ok) r.flag('tz-vs-place', 'warning', 'Timezone does not fit the location', `The phone's timezone (${fmtOffset(off)}) does not fit longitude ${g.lon.toFixed(1)}°.`); }
    if (localTs && off !== undefined) { const dl = daylightCheck(Date.parse(localTs + 'Z') - off * 60000, g.lat, g.lon, opts.pixels?.sky); r.fact('when', 'Sun at that place and time', dl.note, 1); }
  }
  if (info.xmp) { for (const [label, re] of [['XMP creator tool', /<xmp:CreatorTool>([^<]+)</], ['XMP author', /<dc:creator>[\s\S]*?<rdf:li[^>]*>([^<]+)</]] as const) { const m = re.exec(info.xmp); if (m) r.fact(label === 'XMP author' ? 'who' : 'edit', label, m[1], 2); } }
  void b;
}

/* ---------- documents ---------- */
function analyzePdf(b: Bytes, r: Report) {
  const p = parsePdf(b); if (!p) return;
  const last = (k: string) => p.info[k]?.[p.info[k].length - 1];
  r.fact('file', 'PDF version', `${p.version}${p.pages ? ` · ${p.pages} page${p.pages === 1 ? '' : 's'}` : ''}`, 0);
  const author = last('Author') ?? p.xmp.creator;
  if (author) { r.fact('who', 'Author', p.info.Author && p.info.Author.length > 1 ? p.info.Author.join(' → ') : author, 3); addPerson(r, author, 'author written in the PDF'); }
  const creator = last('Creator') ?? p.xmp.creatorTool, producer = last('Producer') ?? p.xmp.producer;
  if (creator) r.fact('edit', 'Made with', p.info.Creator && p.info.Creator.length > 1 ? p.info.Creator.join(' → ') : creator, 2);
  if (producer) r.fact('edit', 'Converted by', p.info.Producer && p.info.Producer.length > 1 ? p.info.Producer.join(' → ') : producer, 2, 'The program that wrote the PDF file itself.');
  for (const [k, label] of [['CreationDate', 'Created'], ['ModDate', 'Last modified']] as const) {
    const v = last(k); const iso = v ? pdfDate(v) : undefined;
    if (iso) { const off = /([+-]\d{2}:\d{2})$/.exec(iso)?.[1]; r.fact('when', label, iso.replace('T', ' ').replace(/Z$/, ' (UTC)'), k === 'CreationDate' ? 3 : 2); r.time(label, iso, k === 'CreationDate' ? 'created' : 'modified', 'PDF information', off ? parseOffset(off) : undefined); if (off && k === 'CreationDate') r.tz = { offsetMin: parseOffset(off)!, source: 'the offset in the PDF creation date' }; }
  }
  const xc = p.xmp.created && wall(p.xmp.created.replace('Z', '')); if (xc) r.time('Created (XMP)', p.xmp.created, 'created', 'PDF XMP');
  if (last('Title')) r.fact('content', 'Title', last('Title'), 1); if (last('Subject')) r.fact('content', 'Subject', last('Subject'), 1); if (last('Keywords')) r.fact('content', 'Keywords', last('Keywords'), 1);
  if (p.xmp.documentId) r.fact('file', 'Document ID', p.xmp.documentId.replace('uuid:', ''), 1, 'Copies of the same document share this ID.');
  if (p.revisions > 1) r.flag('pdf-revisions', 'notice', `Saved ${p.revisions} times by appending`, 'The PDF was edited and re-saved with changes added to the end rather than rewritten. Earlier versions of pages may still be recoverable inside the file.');
  if (p.info.Producer && p.info.Producer.length > 1) r.flag('pdf-producers', 'warning', 'Handled by different programs over time', `Producer history: ${p.info.Producer.join(' → ')}. An earlier program made it and a later one changed it.`);
  if (p.hasJavascript || p.hasLaunch) r.flag('pdf-active', 'warning', 'Contains active content', `${p.hasJavascript ? 'JavaScript' : ''}${p.hasJavascript && p.hasLaunch ? ' and ' : ''}${p.hasLaunch ? 'a launch action' : ''} is embedded. Do not open it in a reader that runs scripts.`);
  else if (p.hasOpenAction) r.flag('pdf-openaction', 'notice', 'Does something when opened', 'An open action is set (usually jumping to a page or a link).');
  if (p.embeddedFiles) r.fact('content', 'Embedded files', `${p.embeddedFiles}`, 2, 'Other files are attached inside this PDF.');
  if (p.encrypted) r.fact('file', 'Encrypted', 'yes', 1);
  if (p.trailing > 64) r.flag('appended-data', 'warning', 'Extra data after the end of the PDF', `${p.trailing.toLocaleString('en-US')} bytes follow the last end-of-file marker.`);
  for (const u of p.links.slice(0, 20)) r.leaks.push({ kind: 'url', value: u, interesting: true });
}

function analyzeOffice(b: Bytes, zip: ReturnType<typeof readZip>, r: Report): string {
  const o = parseOffice(b, zip); if (!o) return '';
  const p = o.props;
  const creator = p.creator ?? p.initialCreator;
  if (creator) { r.fact('who', 'Created by', creator, 3); addPerson(r, creator, 'author stored in the document'); }
  if (p.lastModifiedBy) { r.fact('who', 'Last saved by', p.lastModifiedBy, creator && p.lastModifiedBy !== creator ? 3 : 2, creator && p.lastModifiedBy !== creator ? 'A different person (or account) saved it last.' : undefined); addPerson(r, p.lastModifiedBy, 'last person to save the document'); }
  if (p.company) { r.fact('who', 'Organisation', p.company, 2, 'The company name the software was registered to.'); r.entity('org', p.company, 'company name stored in the document', 'medium'); }
  if (p.manager) r.fact('who', 'Manager', p.manager, 2);
  for (const [k, label, kind] of [['created', 'Created', 'created'], ['modified', 'Last saved', 'modified'], ['lastPrinted', 'Last printed', 'other']] as const) if (p[k]) { const iso = p[k].replace(/Z$/, ''); r.fact('when', label, `${p[k].replace('T', ' ').replace('Z', ' (UTC)')}`, k === 'created' ? 3 : 2); r.time(label, iso, kind as any, 'document properties', p[k].endsWith('Z') ? 0 : undefined); }
  if (p.application) r.fact('edit', 'Made with', `${p.application}${p.appVersion ? ` ${p.appVersion}` : p.generator ? '' : ''}`, 2); if (p.generator) r.fact('edit', 'Made with', p.generator, 2);
  if (p.template) r.fact('edit', 'Template', p.template, 1);
  if (p.revision) r.fact('edit', 'Revision', `${p.revision}`, 1); if (p.totalTime) r.fact('edit', 'Time spent editing', `${p.totalTime} minutes`, 1);
  if (p.editingDuration) r.fact('edit', 'Time spent editing', p.editingDuration, 1);
  if (p.title) r.fact('content', 'Title', p.title, 1); if (p.subject) r.fact('content', 'Subject', p.subject, 1); if (p.keywords) r.fact('content', 'Keywords', p.keywords, 1); if (p.description) r.fact('content', 'Comments', p.description, 2);
  if (p.words) r.fact('content', 'Size', `${p.words} words${p.pages ? `, ${p.pages} pages` : ''}`, 0);
  for (const [k, v] of Object.entries(o.custom).slice(0, 12)) r.fact('content', `Custom property: ${k}`, v, 2);
  if (o.trackedAuthors.length) { r.fact('who', 'People with tracked changes', o.trackedAuthors.join(', '), 3, 'Names attached to insertions and deletions inside the text.'); o.trackedAuthors.forEach((a) => addPerson(r, a, 'author of a tracked change inside the document')); r.flag('tracked-changes', 'notice', 'Tracked changes are still inside', `Edits by ${o.trackedAuthors.join(', ')} are stored in the document, including text that was deleted.`); }
  if (o.commentAuthors.length) { r.fact('who', 'People who commented', o.commentAuthors.join(', '), 2); o.commentAuthors.forEach((a) => addPerson(r, a, 'author of a comment in the document')); }
  if (o.macros) r.flag('macros', 'warning', 'Contains macros', 'A VBA macro project is embedded. Do not enable macros in a file you do not trust.');
  if (o.hiddenSheets.length) r.flag('hidden-sheets', 'notice', 'Hidden sheets', `Sheets that are hidden from view: ${o.hiddenSheets.join(', ')}.`);
  if (o.media) r.fact('content', 'Embedded images', `${o.media}`, 1, 'Pictures inside the document keep their own metadata and can be extracted and analysed.');
  for (const u of o.externalLinks) r.leaks.push({ kind: /^\\\\|^file:/i.test(u) ? 'host' : 'url', value: u, context: /^\\\\|^file:/i.test(u) ? 'a linked file on the author\'s network or disk' : undefined, interesting: true });
  // the readable text of the parts, so paths and emails inside the content are found too
  let text = ''; for (const e of zip!.entries) if (/\.(xml|rels)$/.test(e.name) && e.size < 3_000_000 && !/theme|styles|fontTable|settings/.test(e.name)) text += '\n' + (zip!.read(e.name)?.toString('utf8') ?? '');
  return text.replace(/<[^>]+>/g, ' ');
}

/* ---------- main ---------- */
const ORDER: FactGroup[] = ['where', 'when', 'who', 'device', 'edit', 'content', 'file'];

export async function analyzeFile(buf: Buffer, name: string, opts: AnalyzeOpts = {}): Promise<FileReport> {
  const now = opts.now ?? Date.now();
  const k = sniff(buf, name);
  const r = new Report();
  const hs = hashes(buf);
  r.fact('file', 'Type', k.label, 1); r.fact('file', 'Size', `${buf.length.toLocaleString('en-US')} bytes`, 0); r.fact('file', 'SHA-256', hs.sha256, 1, 'A fingerprint of this exact file. Search for it, or compare copies.');
  let leakText = '', documentLike = false;

  try {
    if (['jpeg', 'png', 'gif', 'webp', 'heic', 'tiff', 'bmp'].includes(k.kind)) { await analyzeImage(buf, k.kind, r, opts, name); leakText = stringsOf(buf.subarray(0, Math.min(buf.length, 3_000_000))); }
    else if (k.kind === 'mp4') { const m = parseMp4(buf); if (m) analyzeVideo(buf, m, r, opts); else r.flag('unreadable', 'notice', 'Could not read the video structure', 'The file looks like a video container but its structure is damaged or unusual.'); leakText = stringsOf(buf.subarray(0, Math.min(buf.length, 2_000_000))); if (m?.xmp) leakText += '\n' + m.xmp; }
    else if (k.kind === 'pdf') { analyzePdf(buf, r); documentLike = true; leakText = latin1(buf.subarray(0, Math.min(buf.length, 6_000_000))); }
    else if (k.kind === 'zip') {
      const z = readZip(buf);
      if (z) {
        const t = analyzeOffice(buf, z, r);
        if (t) { leakText = t; documentLike = true; }
        else { r.fact('content', 'Files inside', `${z.entries.length}`, 1, z.entries.slice(0, 8).map((e) => e.name).join(', ')); const newest = z.entries.map((e) => e.modified).filter(Boolean).sort().pop(); if (newest) { r.fact('when', 'Newest file inside dated', newest.replace('T', ' '), 2, 'Zip entries carry the local time of the computer that packed them.'); r.time('Newest entry', newest, 'created', 'zip directory'); } if (z.comment) r.fact('content', 'Archive comment', z.comment, 2); leakText = z.entries.map((e) => e.name).join('\n') + '\n' + z.comment; }
      }
    }
    else if (k.kind === 'audio') { const a = parseAudio(buf); if (a) { r.fact('content', 'Format', a.format, 0); if (a.durationSec) { r.durationSec = a.durationSec; r.fact('content', 'Length', `${Math.floor(a.durationSec / 60)}:${String(a.durationSec % 60).padStart(2, '0')}`, 1); } for (const [tk, tv] of Object.entries(a.tags)) { const imp: Importance = /^(artist|owner|originator|engineer|technician|composer|encoded by)/.test(tk) ? 3 : /^(comment|copyright|publisher|software|encoder|link|description|private)/.test(tk) ? 2 : 1; r.fact(/^(artist|owner|originator|engineer|technician|composer|encoded by|copyright|publisher)/.test(tk) ? 'who' : 'content', tk[0].toUpperCase() + tk.slice(1), tv, imp); if (/^(artist|composer|engineer|technician)$/.test(tk)) addPerson(r, tv, `${tk} named in the audio tags`); } if (a.hasCover) r.fact('content', 'Cover image', 'embedded', 0); leakText = Object.values(a.tags).join('\n'); } }
    else if (k.kind === 'exe') {
      const e = parseExe(buf);
      if (e) {
        r.fact('file', 'Built for', `${e.format}${e.arch ? ` · ${e.arch}` : ''}${e.subsystem ? ` · ${e.subsystem}` : ''}`, 1);
        if (e.compiled) { r.fact('when', 'Compiled', e.compiled.replace('T', ' ').replace('.000Z', ' UTC'), 3, 'The build time stamped by the compiler. Some build systems set it to a fixed or random value.'); r.time('Compiled', e.compiled, 'created', 'program header', 0); if (Date.parse(e.compiled) > now + 86400000) r.flag('future-date', 'warning', 'Compile time is in the future', 'The stamped build time is later than today, so it was forged or randomised by the build tool.'); }
        if (e.pdbPath) { r.fact('who', 'Build path', e.pdbPath, 3, 'The folder on the developer\'s computer where this was built. It often contains their Windows user name.'); }
        for (const [vk, vv] of Object.entries(e.version)) r.fact(/Company|Copyright/.test(vk) ? 'who' : 'content', vk.replace(/([a-z])([A-Z])/g, '$1 $2'), vv, /Company|Copyright|Original/.test(vk) ? 2 : 1);
        if (e.version.CompanyName) r.entity('org', e.version.CompanyName, 'company name inside the program', 'medium');
        r.flag('executable', 'notice', 'This is a program', 'Never run a program you did not expect. Everything shown here was read without running it.');
      }
      leakText = stringsOf(buf, 8_000_000);
    }
    else if (k.kind === 'text') { const t = utf8(buf.subarray(0, Math.min(buf.length, 3_000_000))); leakText = t; documentLike = true; const lines = t.split(/\r?\n/).length; r.fact('content', 'Lines', lines.toLocaleString('en-US'), 0); if (/^\s*<!doctype html|^\s*<html/i.test(t)) { for (const [lab, re] of [['Page author', /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i], ['Generator', /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i], ['Title', /<title[^>]*>([^<]+)/i], ['Description', /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i]] as const) { const m = re.exec(t); if (m) { r.fact(lab === 'Page author' ? 'who' : 'content', lab, clean(m[1]), lab === 'Page author' ? 3 : 1); if (lab === 'Page author') addPerson(r, clean(m[1]), 'author named in the page'); } } } }
    else if (k.kind === 'sqlite') { r.flag('sqlite', 'info', 'A database file', 'This looks like an app or browser database (chat history, browser history, contacts). Open it with a database viewer; strings from it are scanned below.'); leakText = stringsOf(buf, 8_000_000); }
    else { leakText = stringsOf(buf, 4_000_000); }
  } catch (e: any) { r.flag('parse-error', 'notice', 'Part of the file could not be read', String(e?.message ?? e).slice(0, 200)); }

  /* names and file-system clues (the browser supplies the file's own modified time) */
  const nd = dateFromName(name);
  if (nd) { r.fact('when', 'Date in the file name', `${nd.iso.replace('T', ' ')}${nd.precision === 'day' ? ' (day only)' : ''}`, 1, nd.how); r.time('File name', nd.iso, 'filename', 'file name'); }
  const origin = originFromName(name); if (origin) r.fact('file', 'The name suggests', origin, 2);
  if (opts.lastModified && opts.lastModified > 86400000) { r.fact('when', 'File last modified on disk', new Date(opts.lastModified).toISOString().replace('.000Z', 'Z').replace('T', ' '), 1, 'When the file was last written on the computer it was uploaded from, not when it was made.'); r.time('File modified on disk', new Date(opts.lastModified).toISOString(), 'modified', 'file system'); }

  /* cross-checks between the times */
  const cap = r.times.find((t) => t.kind === 'captured');
  const capMs = cap ? Date.parse(cap.iso.length > 19 ? cap.iso : cap.iso + 'Z') : undefined;
  if (capMs && capMs > now + 86400000) r.flag('future-date', 'warning', 'Recorded time is in the future', 'The file says it was made after today, so its clock or its metadata is wrong.');
  if (nd && nd.precision === 'second' && capMs && Math.abs(Date.parse(nd.iso + 'Z') - Date.parse((cap!.iso.slice(0, 19)) + 'Z')) > 2 * 86400000) r.flag('name-vs-time', 'notice', 'File name and capture time disagree', `The name says ${nd.iso.slice(0, 10)} but the file says it was captured ${cap!.iso.slice(0, 10)}. The file was renamed, or one of the dates is wrong.`);
  for (const t of r.times) if (t.kind === 'modified' && cap && Date.parse(t.iso.length > 19 ? t.iso : t.iso + 'Z') < (capMs ?? 0) - 120000 && t.source !== 'file system' && t.kind === 'modified') r.flag('mod-before-capture', 'warning', 'Changed before it was taken', `"${t.label}" (${t.iso.slice(0, 19)}) is earlier than the capture time. That cannot happen naturally, so a date was edited.`);
  if (opts.lastModified && capMs && opts.lastModified < capMs - 86400000) r.flag('disk-before-capture', 'notice', 'The file on disk is older than the photo', 'The computer says the file was last written before the photo was taken. The file\'s dates were reset, or the clock of the device that held it was wrong.');

  /* strings */
  if (leakText) { for (const l of scanText(leakText, { documentLike })) if (!r.leaks.some((x) => x.kind === l.kind && x.value.toLowerCase() === l.value.toLowerCase())) r.leaks.push(l); }
  r.leaks.sort((a, b) => Number(b.interesting) - Number(a.interesting));
  const userPaths = r.leaks.filter((l) => l.kind === 'user-path' && l.interesting);
  for (const l of userPaths.slice(0, 4)) { r.fact('who', 'Computer user name', l.value, 3, `Found in a file path (${l.context}). It is the account name of the person who made this file.`); r.entity('username', l.value, `computer account name found in a file path inside the file`, 'medium'); }
  const secrets = r.leaks.filter((l) => l.kind === 'secret'); if (secrets.length) r.flag('secrets', 'warning', `Contains ${secrets.length === 1 ? 'a credential' : `${secrets.length} credentials`}`, `${secrets.map((s) => s.value.split(':')[0]).join(', ')} found inside the file. Do not use them: report them to their owner.`);
  for (const l of r.leaks) {
    if (l.kind === 'email' && l.interesting) r.entity('email', l.value, 'email address found inside the file', 'medium');
    if (l.kind === 'url') { try { const u = new URL(l.value); r.entity('domain', u.hostname.replace(/^www\./, ''), 'link found inside the file', 'low'); } catch { /* ignore */ } }
    if (l.kind === 'coords') { const [la, lo] = l.value.split(',').map(Number); if (!r.location) r.entity('location', l.value, 'coordinates written in the file text', 'low'); void la; void lo; }
  }
  for (const ref of findPlatformRefs(leakText.slice(0, 400000)).filter((x) => x.kind !== 'message').slice(0, 8)) r.entity('account', ref.url.startsWith('http') ? ref.url : ref.label, `${ref.platform} reference found inside the file`, 'low');
  for (const e of r.entities.filter((x) => x.type === 'email')) { const m = /^([^@]+)@/.exec(e.value); if (m && plausibleHandle(m[1])) r.entity('username', m[1], `the part before @ in ${e.value}`, 'low'); }

  /* rank and assemble */
  const facts = r.facts.map((f, i) => ({ f, i })).sort((a, b) => b.f.importance - a.f.importance || ORDER.indexOf(a.f.group) - ORDER.indexOf(b.f.group) || a.i - b.i).map((x) => x.f);
  const grouped = [...r.facts].sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || b.importance - a.importance);
  void facts;
  const headline = r.facts.filter((f) => f.importance === 3).sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group)).slice(0, 8);
  const sev = { warning: 0, notice: 1, info: 2 };
  return {
    name, size: buf.length, kind: k.kind, label: k.label, mime: k.mime, sha256: hs.sha256, sha1: hs.sha1, md5: hs.md5,
    facts: grouped, headline, flags: r.flags.sort((a, b) => sev[a.severity] - sev[b.severity]), times: r.times, location: r.location, device: r.device,
    leaks: r.leaks.slice(0, 80), entities: r.entities.slice(0, 30), dims: r.dims, durationSec: r.durationSec, tz: r.tz, pixels: opts.pixels, analyzedAt: now,
  };
}
void isoFromMs; void haversineKm;
