import { inflateRawSync } from 'node:zlib';
import { u16, u32, ascii, type Bytes } from './bytes';

export interface ZipEntry { name: string; size: number; compressed: number; method: number; offset: number; modified?: string }
export interface Zip { entries: ZipEntry[]; comment: string; read(name: string, limit?: number): Buffer | null }

/** A small, strict zip reader (central directory only). It never extracts to disk and refuses zip bombs. */
export function readZip(b: Bytes): Zip | null {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (u32(b, i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10, true), cdSize = u32(b, eocd + 12, true), cdOff = u32(b, eocd + 16, true), cl = u16(b, eocd + 20, true);
  if (cdOff + cdSize > b.length || count > 20000) return null;
  const entries: ZipEntry[] = [];
  let p = cdOff;
  for (let i = 0; i < count && p + 46 <= b.length; i++) {
    if (u32(b, p, true) !== 0x02014b50) break;
    const method = u16(b, p + 10, true), time = u16(b, p + 12, true), date = u16(b, p + 14, true);
    const compressed = u32(b, p + 20, true), size = u32(b, p + 24, true), nl = u16(b, p + 28, true), el = u16(b, p + 30, true), cm = u16(b, p + 32, true), offset = u32(b, p + 42, true);
    const name = Buffer.from(b.subarray(p + 46, p + 46 + nl)).toString('utf8');
    const y = 1980 + (date >> 9), mo = (date >> 5) & 15, d = date & 31, h = time >> 11, mi = (time >> 5) & 63, s = (time & 31) * 2;
    entries.push({ name, size, compressed, method, offset, modified: mo >= 1 && mo <= 12 && d >= 1 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}` : undefined });
    p += 46 + nl + el + cm;
  }
  return {
    entries, comment: cl ? Buffer.from(b.subarray(eocd + 22, eocd + 22 + cl)).toString('utf8') : '',
    read(name, limit = 8 * 1024 * 1024) {
      const e = entries.find((x) => x.name === name); if (!e || e.size > limit) return null;
      const lo = e.offset; if (u32(b, lo, true) !== 0x04034b50) return null;
      const start = lo + 30 + u16(b, lo + 26, true) + u16(b, lo + 28, true);
      const raw = Buffer.from(b.subarray(start, start + e.compressed));
      try { return e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: limit }) : null; } catch { return null; }
    },
  };
}
export const isZip = (b: Bytes) => ascii(b, 0, 2) === 'PK' && (b[2] === 3 || b[2] === 5);
