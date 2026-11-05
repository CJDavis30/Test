/**
 * The sun as a clue. A shadow gives the sun's height above the horizon; the date and time say where the sun was over the Earth; together they
 * narrow where on Earth the picture could have been taken (a ring, and with a shadow direction too, a point). The reverse also works:
 * from a place and a date, what time of day matches the shadow.
 */
import { sunPosition } from '../forensics/sun';
import { haversineKm } from '../forensics/geo';

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const angDiff = (a: number, b: number) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };

/** Sun height in degrees from an object and the shadow it casts (both in the same unit). */
export const elevationFromShadow = (objectHeight: number, shadowLength: number): number => Math.atan2(objectHeight, shadowLength) * DEG;
/** Shadow length for a given sun height. */
export const shadowFromElevation = (objectHeight: number, elevation: number): number => (elevation <= 0 ? Infinity : objectHeight / Math.tan(elevation * RAD));

/** The point on Earth where the sun is directly overhead at that moment. */
export function subsolarPoint(whenMs: number): { lat: number; lon: number } {
  const lat = sunPosition(whenMs, 0, 0).declination;
  let best = { lon: 0, e: -90 };
  for (let lon = -180; lon <= 180; lon += 2) { const e = sunPosition(whenMs, lat, lon).elevation; if (e > best.e) best = { lon, e }; }
  let lo = best.lon - 2, hi = best.lon + 2;
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (sunPosition(whenMs, lat, m1).elevation < sunPosition(whenMs, lat, m2).elevation) lo = m1; else hi = m2;
  }
  return { lat, lon: ((lo + hi) / 2 + 540) % 360 - 180 };
}

export interface SunRing { center: { lat: number; lon: number }; radiusKm: number; elevation: number }
/** Every place where the sun stood at this height at this moment lies on a circle around the subsolar point. */
export function sunRing(whenMs: number, elevation: number): SunRing {
  return { center: subsolarPoint(whenMs), radiusKm: (90 - elevation) * RAD * 6371.0088, elevation };
}
/** Points along that circle, for drawing or for picking likely continents. */
export function ringPoints(ring: SunRing, n = 36): { lat: number; lon: number }[] {
  const c = ring.center, d = ring.radiusKm / 6371.0088, out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < n; i++) {
    const b = (i / n) * 2 * Math.PI;
    const p2 = Math.asin(Math.sin(c.lat * RAD) * Math.cos(d) + Math.cos(c.lat * RAD) * Math.sin(d) * Math.cos(b));
    const l2 = c.lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(c.lat * RAD), Math.cos(d) - Math.sin(c.lat * RAD) * Math.sin(p2));
    out.push({ lat: p2 * DEG, lon: ((l2 * DEG + 540) % 360) - 180 });
  }
  return out;
}

export interface SunFix { lat: number; lon: number; elevationErr: number; azimuthErr: number }
/**
 * Where on Earth does the sun have this height and (optionally) this compass direction at this moment? With both there is one answer
 * (plus a mirror-image one near the poles); with only the height it is the whole ring, so we return `ring` instead of points.
 */
export function locateBySun(whenMs: number, elevation: number, azimuth?: number): { ring: SunRing; points: SunFix[] } {
  const ring = sunRing(whenMs, elevation);
  if (azimuth === undefined) return { ring, points: [] };
  const cost = (la: number, lo: number) => { const s = sunPosition(whenMs, la, lo); return { e: Math.abs(s.elevation - elevation), a: angDiff(s.azimuth, azimuth), c: Math.abs(s.elevation - elevation) + angDiff(s.azimuth, azimuth) * 0.5 }; };
  // seed from the ring: the answer lies on it, so walk its points and keep those whose azimuth is close
  const seeds = ringPoints(ring, 720).map((p) => ({ ...p, c: cost(p.lat, p.lon).c })).sort((a, b) => a.c - b.c);
  const picked: { lat: number; lon: number; c: number }[] = [];
  for (const s of seeds) { if (picked.length >= 3) break; if (s.c > 40) break; if (picked.every((p) => haversineKm(p.lat, p.lon, s.lat, s.lon) > 600)) picked.push(s); }
  const points: SunFix[] = [];
  for (const s of picked) {
    let { lat, lon } = s, step = 1, c = cost(lat, lon).c;
    for (let i = 0; i < 80 && step > 1e-4; i++) {
      let improved = false;
      for (const [dl, dn] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) {
        const la = Math.max(-89.9, Math.min(89.9, lat + dl)), lo = lon + dn, cc = cost(la, lo).c;
        if (cc < c) { c = cc; lat = la; lon = ((lo + 540) % 360) - 180; improved = true; }
      }
      if (!improved) step /= 2;
    }
    const k = cost(lat, lon);
    if (k.e < 1.5 && k.a < 6) points.push({ lat, lon, elevationErr: k.e, azimuthErr: k.a });
  }
  return { ring, points };
}

export interface SunMoment { utc: string; ms: number; azimuth: number; elevation: number; side: 'morning' | 'afternoon'; solarLocalHour: number }
/** At a known place, on a date, when was the sun at this height? Usually twice a day (morning and afternoon); the shadow's direction tells which. */
export function timesForElevation(lat: number, lon: number, dayStartUtcMs: number, elevation: number): SunMoment[] {
  const out: SunMoment[] = [];
  let prev = sunPosition(dayStartUtcMs, lat, lon).elevation;
  for (let m = 1; m <= 1440; m++) {
    const t = dayStartUtcMs + m * 60000, s = sunPosition(t, lat, lon);
    if ((prev - elevation) * (s.elevation - elevation) <= 0 && prev !== s.elevation) {
      const frac = (elevation - prev) / (s.elevation - prev), tt = t - 60000 + frac * 60000, p = sunPosition(tt, lat, lon);
      const hour = (((tt / 3600000) % 24) + 24 + lon / 15) % 24;
      out.push({ utc: new Date(tt).toISOString(), ms: tt, azimuth: p.azimuth, elevation: p.elevation, side: s.elevation > prev ? 'morning' : 'afternoon', solarLocalHour: hour });
    }
    prev = s.elevation;
  }
  return out;
}

/** Highest the sun gets at a place on a date (solar noon), so you can tell whether a shadow that short is even possible there. */
export function maxElevation(lat: number, lon: number, dayStartUtcMs: number): { elevation: number; utc: string } {
  let best = { elevation: -90, utc: '' };
  for (let m = 0; m < 1440; m += 2) { const t = dayStartUtcMs + m * 60000, e = sunPosition(t, lat, lon).elevation; if (e > best.elevation) best = { elevation: e, utc: new Date(t).toISOString() }; }
  return best;
}
