import type { PixelStats } from '@shared/files';

/** Measurements taken in the browser (so the server never needs an image decoder): a look-alike fingerprint, brightness, how much of the picture is bright blue sky. */
async function bitmap(file: Blob): Promise<ImageBitmap | null> {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); } catch { return null; }
}
const ctxOf = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d', { willReadFrequently: true })! }; };

export async function pixelStats(file: Blob): Promise<PixelStats | null> {
  const bmp = await bitmap(file); if (!bmp) return null;
  try {
    // difference hash: 9x8 greyscale, one bit per "is the left pixel darker than its right neighbour"
    const s = ctxOf(9, 8); s.g.drawImage(bmp, 0, 0, 9, 8);
    const d = s.g.getImageData(0, 0, 9, 8).data, grey = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let bits = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += grey((y * 9 + x) * 4) < grey((y * 9 + x + 1) * 4) ? '1' : '0';
    let dhash = ''; for (let i = 0; i < 64; i += 4) dhash += parseInt(bits.slice(i, i + 4), 2).toString(16);
    // brightness and blue-sky share on a 64x64 version
    const t = ctxOf(64, 64); t.g.drawImage(bmp, 0, 0, 64, 64);
    const p = t.g.getImageData(0, 0, 64, 64).data;
    let sum = 0, sky = 0, top = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4, r = p[i], g = p[i + 1], b = p[i + 2], l = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += l;
      if (y < 32) { top++; if (b >= r + 12 && b >= g - 5 && b > 140 && l > 130) sky++; }
    }
    return { luma: Math.round(sum / 4096), sky: Math.round((sky / top) * 1000) / 1000, dhash, width: bmp.width, height: bmp.height };
  } finally { bmp.close(); }
}

/** A re-encoded copy for sending to an AI model: pixels only, so every bit of metadata is gone, and no larger than needed. */
export async function cleanPreview(file: Blob, maxEdge = 1280): Promise<string | null> {
  const bmp = await bitmap(file); if (!bmp) return null;
  try {
    const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const { c, g } = ctxOf(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
    g.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { bmp.close(); }
}
