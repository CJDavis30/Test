import { ascii, u16, u32, latin1, clean, isoFromMs, find, type Bytes } from './bytes';

export interface ExeInfo { format: 'PE' | 'ELF' | 'Mach-O'; arch?: string; compiled?: string; pdbPath?: string; version: Record<string, string>; subsystem?: string; signed?: boolean }

const MACHINES: Record<number, string> = { 0x14c: 'x86', 0x8664: 'x64', 0xaa64: 'ARM64', 0x1c0: 'ARM', 0x1c4: 'ARMv7' };

function utf16Value(b: Bytes, key: string): string | undefined {
  const needle = Buffer.from(key, 'utf16le'); const i = Buffer.from(b.buffer, b.byteOffset, b.length).indexOf(needle);
  if (i < 0) return undefined;
  let p = i + needle.length; while (p + 1 < b.length && b[p] === 0 && b[p + 1] === 0) p += 2;
  let q = p; while (q + 1 < b.length && !(b[q] === 0 && b[q + 1] === 0) && q - p < 400) q += 2;
  return clean(Buffer.from(b.subarray(p, q)).toString('utf16le')) || undefined;
}

export function parseExe(b: Bytes): ExeInfo | null {
  if (ascii(b, 0, 2) === 'MZ') {
    const pe = u32(b, 0x3c, true); if (pe <= 0 || ascii(b, pe, 4) !== 'PE\0\0') return null;
    const info: ExeInfo = { format: 'PE', arch: MACHINES[u16(b, pe + 4, true)] ?? `0x${u16(b, pe + 4, true).toString(16)}`, version: {} };
    const ts = u32(b, pe + 8, true); if (ts > 0 && ts < 0xfff00000) info.compiled = isoFromMs(ts * 1000);
    const opt = pe + 24; const magic = u16(b, opt, true); const sub = u16(b, opt + (magic === 0x20b ? 68 : 68), true);
    info.subsystem = ({ 1: 'native', 2: 'Windows GUI', 3: 'Windows console', 9: 'Windows CE', 10: 'EFI' } as Record<number, string>)[sub];
    const i = find(b, 'RSDS'); if (i >= 0) { let e = i + 24; while (e < b.length && b[e] !== 0 && e - i < 400) e++; const path = latin1(b.subarray(i + 24, e)); if (/[\\/]/.test(path) || /\.pdb$/i.test(path)) info.pdbPath = path; }
    for (const k of ['CompanyName', 'FileDescription', 'FileVersion', 'InternalName', 'LegalCopyright', 'OriginalFilename', 'ProductName', 'ProductVersion']) { const v = utf16Value(b, k); if (v) info.version[k] = v; }
    return info;
  }
  if (b[0] === 0x7f && ascii(b, 1, 3) === 'ELF') return { format: 'ELF', arch: ({ 0x3e: 'x86-64', 0xb7: 'ARM64', 0x28: 'ARM', 0x03: 'x86' } as Record<number, string>)[u16(b, 18, b[5] === 1)] ?? undefined, version: {} };
  const m = u32(b, 0); if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m)) return { format: 'Mach-O', version: {} };
  return null;
}
