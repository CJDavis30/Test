/**
 * Pixel-level forensics that run on raw RGBA arrays (so they are testable and work anywhere there is a canvas):
 *  - Error Level Analysis: save a JPEG again at known quality; regions pasted in from elsewhere (or edited and re-saved) tend to change
 *    by a different amount than the rest of the picture. It is a hint, not a verdict: sharp edges and text also light up.
 *  - A tiny perceptual fingerprint (difference hash) and colour layout to say whether two images are the same picture.
 */

export interface Rgba { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

export interface ElaResult { image: Uint8ClampedArray; width: number; height: number; mean: number; max: number; blocks: { x: number; y: number; w: number; h: number; mean: number; ratio: number }[]; verdict: 'uniform' | 'uneven' | 'inconclusive'; note: string }

export function ela(original: Rgba, resaved: Rgba, scale = 20, block = 16): ElaResult {
  const { width, height } = original;
  const out = new Uint8ClampedArray(width * height * 4);
  const err = new Float32Array(width * height);
  let sum = 0, max = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const d = (Math.abs(original.data[o] - resaved.data[o]) + Math.abs(original.data[o + 1] - resaved.data[o + 1]) + Math.abs(original.data[o + 2] - resaved.data[o + 2])) / 3;
    err[i] = d; sum += d; if (d > max) max = d;
    const v = Math.min(255, d * scale);
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
  }
  const mean = sum / (width * height);
  const bs: ElaResult['blocks'] = [];
  for (let by = 0; by + block <= height; by += block) for (let bx = 0; bx + block <= width; bx += block) {
    let s = 0; for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) s += err[(by + y) * width + bx + x];
    bs.push({ x: bx, y: by, w: block, h: block, mean: s / (block * block), ratio: 0 });
  }
  const sorted = [...bs].map((b) => b.mean).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const floor = Math.max(median, 0.25);
  for (const b of bs) b.ratio = b.mean / floor;
  const hot = bs.filter((b) => b.ratio > 3 && b.mean > 1.5);
  const share = hot.length / Math.max(1, bs.length);
  let verdict: ElaResult['verdict'], note: string;
  if (bs.length < 16) { verdict = 'inconclusive'; note = 'The picture is too small for a meaningful error-level map.'; }
  else if (share > 0.02 && share < 0.5) { verdict = 'uneven'; note = `${hot.length} regions (${(share * 100).toFixed(1)}% of the picture) compress very differently from the rest. That can mean they were edited or pasted in, but sharp edges, text and noise do the same. Compare against the bright areas on the map.`; }
  else if (share >= 0.5) { verdict = 'inconclusive'; note = 'Most of the picture lights up: it has probably been saved many times or is very noisy, so error levels cannot separate edits from the rest.'; }
  else { verdict = 'uniform'; note = 'Every region compresses about the same, which is what an untouched single-save photo looks like. It does not prove nothing was changed (a careful edit saved as a whole can look uniform).'; }
  return { image: out, width, height, mean, max, blocks: hot.sort((a, b) => b.ratio - a.ratio).slice(0, 20), verdict, note };
}

/** 9×8 grayscale thumbnail in, 64-bit difference hash out (16 hex chars). */
export function dhash(gray9x8: ArrayLike<number>): string {
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray9x8[y * 9 + x] < gray9x8[y * 9 + x + 1] ? '1' : '0';
  let hex = ''; for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
export function hammingHex(a: string, b: string): number {
  let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d + Math.abs(a.length - b.length) * 4;
}

/** Shrink to w×h by box averaging (RGBA in, grayscale out). */
export function shrinkGray(img: Rgba, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h), cnt = new Float32Array(w * h);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4, g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    const tx = Math.min(w - 1, Math.floor((x / img.width) * w)), ty = Math.min(h - 1, Math.floor((y / img.height) * h)), k = ty * w + tx;
    out[k] += g; cnt[k]++;
  }
  for (let i = 0; i < out.length; i++) out[i] = cnt[i] ? out[i] / cnt[i] : 0;
  return out;
}
export function shrinkRgb(img: Rgba, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3), cnt = new Float32Array(w * h);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4, tx = Math.min(w - 1, Math.floor((x / img.width) * w)), ty = Math.min(h - 1, Math.floor((y / img.height) * h)), k = ty * w + tx;
    out[k * 3] += img.data[i]; out[k * 3 + 1] += img.data[i + 1]; out[k * 3 + 2] += img.data[i + 2]; cnt[k]++;
  }
  for (let k = 0; k < w * h; k++) if (cnt[k]) { out[k * 3] /= cnt[k]; out[k * 3 + 1] /= cnt[k]; out[k * 3 + 2] /= cnt[k]; }
  return out;
}

export interface ImageCompare { hashA: string; hashB: string; hamming: number; colorDiff: number; mirrored: boolean; verdict: 'identical' | 'same-picture' | 'look-alike' | 'different'; note: string; aspect: [number, number] }
export function compareImages(a: Rgba, b: Rgba): ImageCompare {
  const gA = shrinkGray(a, 9, 8), gB = shrinkGray(b, 9, 8);
  const hashA = dhash(gA), hashB = dhash(gB);
  const flip = (g: Float32Array) => { const o = new Float32Array(72); for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) o[y * 9 + x] = g[y * 9 + 8 - x]; return o; };
  const hamming = hammingHex(hashA, hashB), hamFlip = hammingHex(hashA, dhash(flip(gB)));
  const cA = shrinkRgb(a, 8, 8), cB = shrinkRgb(b, 8, 8);
  const colorDiff = (x: Float32Array, y: Float32Array) => { let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); return d / (x.length * 255); };
  const cBflip = new Float32Array(cB.length); for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) for (let k = 0; k < 3; k++) cBflip[(r * 8 + c) * 3 + k] = cB[(r * 8 + 7 - c) * 3 + k];
  const mirrored = hamFlip + 4 < hamming && hamFlip <= 10;
  const cd = mirrored ? colorDiff(cA, cBflip) : colorDiff(cA, cB);
  const best = Math.min(hamming, hamFlip);
  let verdict: ImageCompare['verdict'], note: string;
  if (best <= 1 && cd < 0.02 && !mirrored) { verdict = 'identical'; note = 'Visually identical (possibly different file sizes or formats).'; }
  else if (best <= 8 && cd < 0.12) { verdict = 'same-picture'; note = `The same picture${mirrored ? ' mirrored left-to-right' : ''}, probably resized, recompressed, cropped slightly or lightly edited (${best} of 64 fingerprint bits differ).`; }
  else if (best <= 16) { verdict = 'look-alike'; note = `Similar layout and tones (${best} of 64 bits differ), but not clearly the same picture. Look at both by eye.`; }
  else { verdict = 'different'; note = `Different pictures (${best} of 64 bits differ).`; }
  return { hashA, hashB, hamming: best, colorDiff: cd, mirrored, verdict, note, aspect: [a.width / a.height, b.width / b.height] };
}
