import { haversineKm } from './geo';

/** What is compared between files in a case. */
export interface FileBrief {
  id: string; name: string; sha256: string; dhash?: string; deviceFp?: string; serial?: string; people: string[];
  lat?: number; lon?: number; capturedMs?: number;
}
export interface FileLink { a: string; b: string; kind: 'identical' | 'look-alike' | 'same-camera' | 'probably-same-camera' | 'same-person' | 'same-place' | 'close-in-time'; detail: string; strength: 'strong' | 'moderate' | 'weak' }

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0; for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function linkFiles(files: FileBrief[]): FileLink[] {
  const out: FileLink[] = [];
  for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
    const a = files[i], b = files[j];
    const push = (kind: FileLink['kind'], detail: string, strength: FileLink['strength']) => out.push({ a: a.id, b: b.id, kind, detail, strength });
    if (a.sha256 === b.sha256) { push('identical', 'Byte-for-byte identical files', 'strong'); continue; }
    if (a.dhash && b.dhash) { const d = hamming(a.dhash, b.dhash); if (d <= 6) push('look-alike', `The pictures look the same (${d} of 64 visual bits differ): the same image saved, resized or recompressed`, d <= 2 ? 'strong' : 'moderate'); }
    if (a.serial && b.serial && a.serial === b.serial) push('same-camera', `Same camera body serial number (${a.serial})`, 'strong');
    else if (a.deviceFp && b.deviceFp && a.deviceFp === b.deviceFp && a.deviceFp.split('|').filter(Boolean).length >= 3) push('probably-same-camera', 'Same make, model and lens; the files carry no serial number to be sure', 'weak');
    const pa = new Set(a.people.map(norm).filter((x) => x.length > 2));
    const shared = b.people.map(norm).find((x) => pa.has(x));
    if (shared) push('same-person', `Both name "${shared}" as author or owner`, 'moderate');
    if (a.lat !== undefined && b.lat !== undefined && a.lon !== undefined && b.lon !== undefined) {
      const km = haversineKm(a.lat, a.lon!, b.lat, b.lon!);
      if (km < 0.15) push('same-place', `Taken within ${Math.max(10, Math.round(km * 1000))} m of each other`, 'moderate');
    }
    if (a.capturedMs && b.capturedMs) {
      const min = Math.abs(a.capturedMs - b.capturedMs) / 60000;
      if (min <= 10 && min >= 0) push('close-in-time', `Taken ${min < 1 ? 'within a minute' : `${Math.round(min)} minutes`} apart`, 'weak');
    }
  }
  return out;
}
