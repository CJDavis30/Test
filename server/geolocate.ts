import { complete, extractJson, aiReady, aiSettings, type Msg } from './ai';
import type { Store } from './store';
import { haversineKm, validCoord, describePlace } from '../shared/forensics/geo';

/**
 * Where was this picture taken, judged from what is in it (signs, road markings, plants, buildings, terrain, the light).
 *
 * The honest part: a vision model is a good geolocator on scenes with distinctive clues and a poor one on generic scenes, and it
 * sounds equally sure either way. So its own "confidence" is never shown. Instead it is asked several times independently, and
 * the answer's strength is how closely those readings agree. The picture is sent as pixels only (no metadata), and whenever the
 * photo's real GPS is known the miss distance is recorded, so the app can show its measured accuracy on your own photos.
 */

export interface GeoCandidate { place: string; country?: string; region?: string; lat: number; lon: number; confidence: number; clues: string[] }
export interface GeoSample { candidates: GeoCandidate[]; notEnough: boolean; indoors: boolean; visibleText: { text: string; language?: string }[]; observations: Record<string, string>; notes?: string }
export type GeoLevel = 'city' | 'region' | 'country' | 'none';
export interface GeoConsensus {
  level: GeoLevel; lat?: number; lon?: number; place?: string; spreadKm?: number; votes: number; runs: number; failedRuns: number;
  alternatives: { place: string; lat: number; lon: number; votes: number }[];
  clues: string[]; visibleText: { text: string; language?: string }[]; observations: Record<string, string>; summary: string; indoors: boolean;
}

export const LEVEL_KM: Record<Exclude<GeoLevel, 'none'>, number> = { city: 25, region: 300, country: 1500 };

export const GEO_SYSTEM = `You are a careful geolocation analyst working from a single photograph. Use only what is visible: written signs and their language and script, road markings and signs, driving side, number-plate format and colour, utility poles and wires, street furniture, vegetation, soil and terrain, architecture and building materials, vehicles, flags, climate and the sun and shadows, skyline and landmarks.
Rules:
- Never identify or describe real people. Ignore faces and bodies; describe only the environment.
- Do not guess a precise point unless you can name a specific landmark, street or building you recognise. Otherwise give the centre of the most likely city or area and a lower confidence.
- If the photo is indoors, generic, or has too few clues, say so with "not_enough_information": true rather than inventing a place.
- Offer at most 3 candidates, best first. Give latitude and longitude as decimal degrees.
Reply with JSON only, no commentary, in exactly this shape:
{"not_enough_information": false, "indoors": false, "candidates": [{"place": "City, Country", "country": "", "region": "", "lat": 0, "lon": 0, "confidence": 0.0, "clues": ["short reason", "..."]}], "visible_text": [{"text": "", "language": ""}], "observations": {"driving_side": "", "scripts": "", "vegetation": "", "architecture": "", "road_markings": "", "utility_poles": "", "vehicles_and_plates": "", "terrain_and_climate": "", "sun_and_shadows": ""}, "notes": ""}`;

export function parseGeoReply(text: string): GeoSample | null {
  const j = extractJson(text); if (!j || typeof j !== 'object') return null;
  const cands: GeoCandidate[] = [];
  for (const c of Array.isArray(j.candidates) ? j.candidates.slice(0, 3) : []) {
    const lat = Number(c?.lat), lon = Number(c?.lon);
    if (!validCoord(lat, lon)) continue;
    cands.push({ place: String(c.place ?? '').slice(0, 120), country: c.country ? String(c.country).slice(0, 60) : undefined, region: c.region ? String(c.region).slice(0, 60) : undefined, lat, lon, confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0)), clues: (Array.isArray(c.clues) ? c.clues : []).map((x: unknown) => String(x).slice(0, 160)).slice(0, 8) });
  }
  cands.sort((a, b) => b.confidence - a.confidence);
  const obs: Record<string, string> = {};
  if (j.observations && typeof j.observations === 'object') for (const [k, v] of Object.entries(j.observations)) { const s = Array.isArray(v) ? v.join(', ') : String(v ?? ''); if (s.trim() && !/^(unknown|none|n\/a|not visible|unclear)\.?$/i.test(s.trim())) obs[k] = s.trim().slice(0, 200); }
  const vt = (Array.isArray(j.visible_text) ? j.visible_text : []).map((x: any) => ({ text: String(x?.text ?? '').trim().slice(0, 80), language: x?.language ? String(x.language).slice(0, 30) : undefined })).filter((x: any) => x.text).slice(0, 12);
  return { candidates: cands, notEnough: !!j.not_enough_information || cands.length === 0, indoors: !!j.indoors, visibleText: vt, observations: obs, notes: j.notes ? String(j.notes).slice(0, 300) : undefined };
}

/** Turn independent readings into one answer whose strength is their agreement. Pure, so it can be tested exactly. */
export function aggregate(samples: (GeoSample | null)[]): GeoConsensus {
  const runs = samples.length, ok = samples.filter((s): s is GeoSample => !!s), failedRuns = runs - ok.length;
  const tops = ok.filter((s) => !s.notEnough).map((s) => ({ ...s.candidates[0], s }));
  const base = { runs, failedRuns, alternatives: [] as GeoConsensus['alternatives'], clues: [] as string[], visibleText: [] as GeoConsensus['visibleText'], observations: {} as Record<string, string>, indoors: ok.length > 0 && ok.filter((s) => s.indoors).length > ok.length / 2 };
  for (const s of ok) { for (const [k, v] of Object.entries(s.observations)) base.observations[k] ??= v; for (const t of s.visibleText) if (!base.visibleText.some((x) => x.text.toLowerCase() === t.text.toLowerCase())) base.visibleText.push(t); }
  base.visibleText = base.visibleText.slice(0, 12);
  if (!tops.length) return { ...base, level: 'none', votes: 0, summary: ok.length ? `The model did not find enough in the picture to place it (${ok.length - tops.length} of ${runs} readings said so).` : 'No reading came back from the model.' };
  const need = Math.max(2, Math.ceil(0.6 * runs));
  const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => haversineKm(a.lat, a.lon, b.lat, b.lon);
  for (const level of ['city', 'region', 'country'] as const) {
    const km = LEVEL_KM[level];
    let best: typeof tops = [];
    for (const t of tops) { const g = tops.filter((u) => dist(t, u) <= km); if (g.length > best.length) best = g; }
    if (best.length >= need) {
      // the medoid: the reading closest to all the others in the group
      const medoid = best.reduce((m, c) => (best.reduce((s, x) => s + dist(c, x), 0) < best.reduce((s, x) => s + dist(m, x), 0) ? c : m));
      const spread = Math.max(...best.map((x) => dist(medoid, x)));
      const rest = tops.filter((t) => !best.includes(t));
      const alts: GeoConsensus['alternatives'] = [];
      for (const t of rest) { const a = alts.find((x) => dist(x, t) <= km); if (a) a.votes++; else alts.push({ place: t.place, lat: t.lat, lon: t.lon, votes: 1 }); }
      const clues = [...new Set(best.flatMap((x) => x.clues.map((c) => c.trim())))].slice(0, 10);
      const word = level === 'city' ? 'within 25 km' : level === 'region' ? 'within 300 km' : 'within 1,500 km';
      const summary = `${best.length} of ${runs} independent readings agree ${word}${best.length === runs ? '' : `; ${runs - best.length} did not`}. ${level === 'city' ? 'This is a strong lead: check it by eye.' : level === 'region' ? 'It is the right area, probably not the right street.' : 'It narrows it to a country or large region only.'}`;
      return { ...base, level, lat: medoid.lat, lon: medoid.lon, place: medoid.place || describePlace(medoid.lat, medoid.lon), spreadKm: Math.round(spread * 10) / 10, votes: best.length, alternatives: alts.sort((a, b) => b.votes - a.votes).slice(0, 3), clues, summary };
    }
  }
  const alts: GeoConsensus['alternatives'] = [];
  for (const t of tops) { const a = alts.find((x) => dist(x, t) <= 300); if (a) a.votes++; else alts.push({ place: t.place, lat: t.lat, lon: t.lon, votes: 1 }); }
  return { ...base, level: 'none', votes: Math.max(...alts.map((a) => a.votes)), alternatives: alts.sort((a, b) => b.votes - a.votes).slice(0, 3), clues: [...new Set(tops.flatMap((t) => t.clues))].slice(0, 8), summary: `The ${tops.length} readings disagree about where this is, so there is no answer to trust. The candidates below are guesses to check by hand, not findings.` };
}

export function visionStatus(store: Store): { ok: boolean; why?: string; provider: string; local: boolean; model?: string } {
  const s = aiSettings(store), r = aiReady(store);
  const local = s.provider === 'ollama' || /^https?:\/\/(localhost|127\.|\[::1\])/.test(s.baseUrl ?? '');
  return { ok: r.ok, why: r.why, provider: s.provider, local, model: s.visionModel || r.model };
}

export async function geolocate(store: Store, imageDataUrl: string, opts: { runs?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<GeoConsensus> {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl) || imageDataUrl.length > 8_000_000) throw new Error('The picture has to be a JPEG, PNG or WebP under about 6 MB');
  const runs = Math.max(1, Math.min(5, opts.runs ?? 3));
  const msgs: Msg[] = [{ role: 'system', content: GEO_SYSTEM }, { role: 'user', content: [{ type: 'text', text: 'Where was this photo taken? Reply with the JSON only.' }, { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }] }];
  const results = await Promise.allSettled(Array.from({ length: runs }, (_, i) => complete(store, msgs, { vision: true, temperature: i === 0 ? 0.2 : 0.7, timeoutMs: opts.timeoutMs ?? 120_000, fetchImpl: opts.fetchImpl })));
  const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (first && results.every((r) => r.status === 'rejected')) throw new Error(String(first.reason?.message ?? first.reason));
  return aggregate(results.map((r) => (r.status === 'fulfilled' ? parseGeoReply(r.value.text) : null)));
}

/* ---- measured accuracy ---- */
export interface GeoRecord { level: GeoLevel; errKm: number; at: number }
export function recordGeo(store: Store, c: GeoConsensus, truth: { lat: number; lon: number }): GeoRecord | null {
  if (c.lat === undefined || c.lon === undefined) return null;
  const rec: GeoRecord = { level: c.level, errKm: Math.round(haversineKm(c.lat, c.lon, truth.lat, truth.lon) * 10) / 10, at: Date.now() };
  store.setSetting('geoCalibration', [rec, ...store.getSetting<GeoRecord[]>('geoCalibration', [])].slice(0, 300));
  return rec;
}
export function calibration(list: GeoRecord[]) {
  const out: Record<string, { n: number; right: number; medianKm: number; target: number }> = {};
  for (const level of ['city', 'region', 'country'] as const) {
    const rows = list.filter((r) => r.level === level); if (!rows.length) continue;
    const e = rows.map((r) => r.errKm).sort((a, b) => a - b);
    out[level] = { n: rows.length, right: rows.filter((r) => r.errKm <= LEVEL_KM[level]).length, medianKm: e[Math.floor(e.length / 2)], target: LEVEL_KM[level] };
  }
  return { total: list.length, byLevel: out, misses: list.filter((r) => r.level === 'none').length };
}
