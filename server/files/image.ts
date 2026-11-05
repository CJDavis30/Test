import { inflateSync } from 'node:zlib';
import { ascii, u16, u32, latin1, utf8, clean, find, type Bytes } from './bytes';

/** The structure of the picture file itself: how it was saved, what was tacked on, what tools left their mark. */
export interface JpegInfo {
  width: number; height: number; progressive: boolean; subsampling?: string; quality?: { value: number; exact: boolean };
  segments: string[]; hasExif: boolean; hasXmp: boolean; hasIcc: boolean; hasPhotoshop: boolean; adobe: boolean; hasMpf: boolean; hasJumbf: boolean;
  comments: string[]; trailing: number; trailingKind?: string; eoi?: number;
}

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];

/** Estimate the "quality" slider the file was saved at by comparing its quantisation table to the standard one. */
export function jpegQuality(tableZigzag: number[]): { value: number; exact: boolean } {
  const nat = new Array(64).fill(0); tableZigzag.forEach((v, i) => { nat[ZIGZAG[i]] = v; });
  let best = 0, bestDiff = Infinity;
  for (let q = 1; q <= 100; q++) {
    const scale = q < 50 ? 5000 / q : 200 - 2 * q;
    let d = 0;
    for (let i = 0; i < 64; i++) d += Math.abs(Math.min(255, Math.max(1, Math.floor((STD_LUMA[i] * scale + 50) / 100))) - nat[i]);
    if (d < bestDiff) { bestDiff = d; best = q; }
  }
  return { value: best, exact: bestDiff === 0 };
}

export function sniffTrailing(b: Bytes, from: number): string {
  const head = ascii(b, from, 8);
  if (head.startsWith('PK')) return 'a ZIP archive'; if (head.startsWith('Rar!')) return 'a RAR archive'; if (head.startsWith('7z')) return 'a 7-Zip archive';
  if (head.startsWith('%PDF')) return 'a PDF'; if (head.startsWith('\x89PNG')) return 'a PNG image'; if (head.startsWith('\xff\xd8')) return 'another JPEG (a second picture or a thumbnail)';
  if (head.startsWith('MZ')) return 'a Windows program'; if (head.startsWith('\x7fELF')) return 'a Linux program';
  const t = latin1(b.subarray(from, Math.min(b.length, from + 200)));
  if (/^[\x20-\x7e\r\n\t]{20,}$/.test(t.slice(0, 120))) return 'readable text';
  return 'unidentified data';
}

export function parseJpeg(b: Bytes): JpegInfo | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const info: JpegInfo = { width: 0, height: 0, progressive: false, segments: [], hasExif: false, hasXmp: false, hasIcc: false, hasPhotoshop: false, adobe: false, hasMpf: false, hasJumbf: false, comments: [], trailing: 0 };
  let p = 2, quality: JpegInfo['quality'];
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    let m = b[p + 1]; if (m === 0xff) { p++; continue; }
    if (m === 0xd9) { info.eoi = p; break; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { p += 2; continue; }
    const len = u16(b, p + 2), s = p + 4, e = p + 2 + len;
    if (len < 2 || e > b.length) break;
    if (m >= 0xe0 && m <= 0xef) {
      const id = ascii(b, s, 30), n = `APP${m - 0xe0}`;
      info.segments.push(n);
      if (m === 0xe1 && id.startsWith('Exif\0')) info.hasExif = true;
      if (m === 0xe1 && id.startsWith('http://ns.adobe.com/xap/1.0/')) info.hasXmp = true;
      if (m === 0xe2 && id.startsWith('ICC_PROFILE')) info.hasIcc = true;
      if (m === 0xe2 && id.startsWith('MPF')) info.hasMpf = true;
      if (m === 0xed && id.startsWith('Photoshop 3.0')) info.hasPhotoshop = true;
      if (m === 0xee && id.startsWith('Adobe')) info.adobe = true;
      if (m === 0xeb && (id.includes('jumb') || ascii(b, s, 64).includes('c2pa'))) info.hasJumbf = true;
    } else if (m === 0xfe) info.comments.push(clean(utf8(b.subarray(s, e))).slice(0, 300));
    else if (m === 0xdb) {
      let q = s; while (q < e) { const pq = b[q] >> 4, tq = b[q] & 15, n = pq ? 128 : 64; if (q + 1 + n > e) break; if (tq === 0 && !quality) { const t: number[] = []; for (let i = 0; i < 64; i++) t.push(pq ? u16(b, q + 1 + i * 2) : b[q + 1 + i]); quality = jpegQuality(t); } q += 1 + n; }
    } else if ((m >= 0xc0 && m <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(m)) {
      info.progressive = m === 0xc2 || m === 0xc6 || m === 0xca; info.height = u16(b, s + 1); info.width = u16(b, s + 3);
      const nc = b[s + 5];
      if (nc >= 3) { const hv = b[s + 7]; info.subsampling = hv === 0x22 ? '4:2:0' : hv === 0x21 ? '4:2:2' : hv === 0x11 ? '4:4:4' : hv === 0x12 ? '4:4:0' : undefined; }
    } else if (m === 0xda) {
      p = e;       // entropy-coded data follows: skip to the next real marker
      while (p + 1 < b.length && !(b[p] === 0xff && b[p + 1] !== 0x00 && !(b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7))) p++;
      continue;
    }
    p = e;
  }
  info.quality = quality;
  if (info.eoi !== undefined && info.eoi + 2 < b.length) {
    const rest = b.length - (info.eoi + 2);
    if (rest > 16 && !(rest <= 2)) { info.trailing = rest; info.trailingKind = sniffTrailing(b, info.eoi + 2); }
  }
  void find;
  return info;
}

export interface PngInfo {
  width: number; height: number; bitDepth: number; colorType: number; interlaced: boolean;
  text: Record<string, string>; time?: string; hasExif: boolean; hasC2pa: boolean; hasIcc: boolean; chunks: string[]; trailing: number;
  ai?: { tool: string; details: Record<string, string>; prompt?: string };
}

export function parsePng(b: Bytes): PngInfo | null {
  if (!(b[0] === 0x89 && ascii(b, 1, 3) === 'PNG')) return null;
  const info: PngInfo = { width: 0, height: 0, bitDepth: 0, colorType: 0, interlaced: false, text: {}, hasExif: false, hasC2pa: false, hasIcc: false, chunks: [], trailing: 0 };
  let p = 8;
  const inflate = (d: Bytes) => { try { return inflateSync(Buffer.from(d), { maxOutputLength: 2_000_000 }); } catch { return Buffer.alloc(0); } };
  while (p + 12 <= b.length) {
    const len = u32(b, p), type = ascii(b, p + 4, 4), s = p + 8, e = s + len;
    if (e + 4 > b.length + 4) break;
    if (!info.chunks.includes(type)) info.chunks.push(type);
    const d = b.subarray(s, Math.min(e, b.length));
    if (type === 'IHDR') { info.width = u32(b, s); info.height = u32(b, s + 4); info.bitDepth = b[s + 8]; info.colorType = b[s + 9]; info.interlaced = b[s + 12] === 1; }
    else if (type === 'tEXt') { const z = d.indexOf(0); if (z > 0) info.text[latin1(d.subarray(0, z))] = latin1(d.subarray(z + 1)).slice(0, 20000); }
    else if (type === 'zTXt') { const z = d.indexOf(0); if (z > 0) info.text[latin1(d.subarray(0, z))] = inflate(d.subarray(z + 2)).toString('latin1').slice(0, 20000); }
    else if (type === 'iTXt') {
      const z = d.indexOf(0); if (z > 0) { const comp = d[z + 1]; let q = z + 3; q = d.indexOf(0, q) + 1; q = d.indexOf(0, q) + 1; const body = d.subarray(q); info.text[latin1(d.subarray(0, z))] = (comp ? inflate(body).toString('utf8') : utf8(body)).slice(0, 20000); }
    } else if (type === 'tIME' && len >= 7) info.time = `${u16(b, s)}-${String(b[s + 2]).padStart(2, '0')}-${String(b[s + 3]).padStart(2, '0')}T${String(b[s + 4]).padStart(2, '0')}:${String(b[s + 5]).padStart(2, '0')}:${String(b[s + 6]).padStart(2, '0')}Z`;
    else if (type === 'eXIf') info.hasExif = true;
    else if (type === 'caBX') info.hasC2pa = true;
    else if (type === 'iCCP') info.hasIcc = true;
    else if (type === 'IEND') { if (e + 4 < b.length) info.trailing = b.length - (e + 4); break; }
    p = e + 4;
  }
  info.ai = detectAiPng(info.text);
  return info;
}

/** Image generators write their settings into the file. Their presence is strong; their absence proves nothing. */
export function detectAiPng(text: Record<string, string>): PngInfo['ai'] {
  const params = text.parameters;
  if (params && /Steps:\s*\d+/.test(params)) {
    const d: Record<string, string> = {};
    for (const k of ['Steps', 'Sampler', 'CFG scale', 'Seed', 'Size', 'Model', 'Model hash', 'Version', 'Denoising strength']) { const m = new RegExp(`${k}:\\s*([^,\\n]+)`).exec(params); if (m) d[k] = m[1].trim(); }
    return { tool: /Version:\s*(?:v|f)?\d|Model hash/.test(params) ? 'Stable Diffusion (AUTOMATIC1111 / Forge)' : 'Stable Diffusion', details: d, prompt: params.split(/\nNegative prompt:/)[0].slice(0, 600) };
  }
  if (text.prompt && text.workflow) return { tool: 'ComfyUI', details: {}, prompt: undefined };
  if (text.prompt && /"class_type"/.test(text.prompt)) return { tool: 'ComfyUI', details: {} };
  if (text.invokeai_metadata || text['sd-metadata']) return { tool: 'InvokeAI', details: {} };
  if (/NovelAI/i.test(text.Software ?? '') || (text.Comment && /"uc"\s*:/.test(text.Comment))) return { tool: 'NovelAI', details: {} };
  if (text.Software && /(midjourney|dall[·-]?e|firefly|leonardo|stable ?diffusion|dream ?studio|imagen)/i.test(text.Software)) return { tool: text.Software, details: {} };
  if (text.Description && /Made with Google AI|Imagen|Gemini/i.test(text.Description)) return { tool: 'Google AI', details: {} };
  return undefined;
}

export interface GifInfo { width: number; height: number; frames: number; comments: string[]; apps: string[]; loop?: number; version: string }
export function parseGif(b: Bytes): GifInfo | null {
  const sig = ascii(b, 0, 6); if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  const info: GifInfo = { width: u16(b, 6, true), height: u16(b, 8, true), frames: 0, comments: [], apps: [], version: sig.slice(3) };
  let p = 13; if (b[10] & 0x80) p += 3 * (1 << ((b[10] & 7) + 1));
  const skip = () => { while (p < b.length && b[p] !== 0) p += b[p] + 1; p++; };
  while (p < b.length) {
    const t = b[p++];
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xfe) { const s = p; skip(); info.comments.push(clean(latin1(b.subarray(s + 1, Math.min(p - 1, s + 1 + b[s]))))); }
      else if (label === 0xff) { const n = b[p]; info.apps.push(clean(ascii(b, p + 1, n))); if (ascii(b, p + 1, 8) === 'NETSCAPE') info.loop = u16(b, p + n + 3, true); skip(); }
      else skip();
    } else if (t === 0x2c) { info.frames++; const f = b[p + 8]; p += 9; if (f & 0x80) p += 3 * (1 << ((f & 7) + 1)); p++; skip(); }
    else break;
  }
  return info;
}

/** Strong signs the file carries "Content Credentials" (C2PA) or declares that AI made it. */
export function provenanceHints(b: Bytes): { c2pa: boolean; claimTool?: string; aiDeclared: boolean; actions: string[] } {
  const hay = latin1(b.length > 6_000_000 ? Buffer.concat([b.subarray(0, 3_000_000), b.subarray(b.length - 3_000_000)]) : b);
  const c2pa = /c2pa/.test(hay) && /jumb|c2pa\.(?:claim|actions|hash)/.test(hay);
  const actions = [...new Set([...hay.matchAll(/c2pa\.(created|edited|opened|placed|cropped|filtered|color_adjustments|resized|transcoded|published|converted|drawing)/g)].map((m) => m[1]))];
  const tool = /"claim_generator(?:_info)?"[\s\S]{0,80}?"(?:name"\s*:\s*")?([A-Za-z][\w .\-/]{2,60})/.exec(hay)?.[1];
  const aiDeclared = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia/.test(hay);
  return { c2pa, claimTool: tool?.trim(), aiDeclared, actions };
}
