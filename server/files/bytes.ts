import { createHash } from 'node:crypto';

export type Bytes = Uint8Array;
export const u8 = (b: Bytes, o: number) => b[o] ?? 0;
export const u16 = (b: Bytes, o: number, le = false) => (le ? u8(b, o) | (u8(b, o + 1) << 8) : (u8(b, o) << 8) | u8(b, o + 1));
export const u32 = (b: Bytes, o: number, le = false) => (le ? (u8(b, o) | (u8(b, o + 1) << 8) | (u8(b, o + 2) << 16) | (u8(b, o + 3) << 24)) >>> 0 : ((u8(b, o) << 24) | (u8(b, o + 1) << 16) | (u8(b, o + 2) << 8) | u8(b, o + 3)) >>> 0);
export const i32 = (b: Bytes, o: number) => u32(b, o) | 0;
export const u64 = (b: Bytes, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
export const ascii = (b: Bytes, o: number, n: number) => { let s = ''; for (let i = o; i < Math.min(b.length, o + n); i++) s += String.fromCharCode(b[i]); return s; };
export const latin1 = (b: Bytes) => ascii(b, 0, b.length);
export const utf8 = (b: Bytes) => Buffer.from(b.buffer, b.byteOffset, b.length).toString('utf8');
export const utf16le = (b: Bytes) => Buffer.from(b.buffer, b.byteOffset, b.length).toString('utf16le');
export function utf16be(b: Bytes): string { const out = Buffer.alloc(b.length - (b.length % 2)); for (let i = 0; i + 1 < b.length; i += 2) { out[i] = b[i + 1]; out[i + 1] = b[i]; } return out.toString('utf16le'); }
export const clean = (s: string) => s.replace(/\u0000+$/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
export const hex = (b: Bytes, o = 0, n = b.length) => Buffer.from(b.subarray(o, o + n)).toString('hex');

export function hashes(b: Bytes) {
  const h = (a: string) => createHash(a).update(b).digest('hex');
  return { sha256: h('sha256'), sha1: h('sha1'), md5: h('md5') };
}
export const find = (b: Bytes, needle: string, from = 0): number => Buffer.from(b.buffer, b.byteOffset, b.length).indexOf(needle, from, 'latin1');
export const startsWith = (b: Bytes, sig: number[] | string, off = 0) => (typeof sig === 'string' ? ascii(b, off, sig.length) === sig : sig.every((x, i) => b[off + i] === x));

/** Seconds since 1904 (QuickTime) or a Unix epoch, to ISO. Zero means "never set" in video files and is dropped. */
export const isoFromMs = (ms: number) => { const d = new Date(ms); return Number.isFinite(ms) && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined; };
