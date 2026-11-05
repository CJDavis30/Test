/**
 * Coordinates in every format an investigator meets: decimal, degrees-minutes-seconds, geohash, Plus Code (Open Location Code), UTM.
 * Plus the two small calculations that settle alibis: how far apart two sightings are, and whether anyone could travel between them in the time.
 */
import { haversineKm, bearingDeg, compass } from '../forensics/geo';

const RAD = Math.PI / 180, DEG = 180 / Math.PI;

export function toDms(lat: number, lon: number): string {
  const part = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
    return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${v >= 0 ? pos : neg}`;
  };
  return `${part(lat, 'N', 'S')} ${part(lon, 'E', 'W')}`;
}

// ---------------------------------------------------------------------------------------------------------------- geohash
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export function geohashEncode(lat: number, lon: number, precision = 9): string {
  let latR = [-90, 90], lonR = [-180, 180], bit = 0, ch = 0, even = true, out = '';
  while (out.length < precision) {
    const r = even ? lonR : latR, v = even ? lon : lat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
  }
  return out;
}
export function geohashDecode(hash: string): { lat: number; lon: number; errLat: number; errLon: number } | null {
  const h = hash.toLowerCase();
  if (!h || !/^[0-9bcdefghjkmnpqrstuvwxyz]+$/.test(h)) return null;
  let latR = [-90, 90], lonR = [-180, 180], even = true;
  for (const c of h) {
    const v = B32.indexOf(c);
    for (let b = 4; b >= 0; b--) { const r = even ? lonR : latR, mid = (r[0] + r[1]) / 2; if ((v >> b) & 1) r[0] = mid; else r[1] = mid; even = !even; }
  }
  return { lat: (latR[0] + latR[1]) / 2, lon: (lonR[0] + lonR[1]) / 2, errLat: (latR[1] - latR[0]) / 2, errLon: (lonR[1] - lonR[0]) / 2 };
}

// ---------------------------------------------------------------------------------------------------------------- plus code
const OLC = '23456789CFGHJMPQRVWX';
export function plusCodeEncode(lat: number, lon: number): string {
  const la = Math.min(Math.max(lat, -90), 90 - 1e-9), lo = ((lon + 180) % 360 + 360) % 360 - 180;
  let latI = Math.floor((la + 90) * 8000 + 1e-7), lonI = Math.floor((lo + 180) * 8000 + 1e-7);
  const ld: number[] = [], od: number[] = [];
  for (let i = 0; i < 5; i++) { ld.unshift(latI % 20); latI = Math.floor(latI / 20); od.unshift(lonI % 20); lonI = Math.floor(lonI / 20); }
  let s = '';
  for (let i = 0; i < 5; i++) { s += OLC[ld[i]] + OLC[od[i]]; if (i === 3) s += '+'; }
  return s;
}
export function plusCodeDecode(code: string): { lat: number; lon: number } | null {
  const c = code.trim().toUpperCase();
  if (!/^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,}$/.test(c)) return null;
  const d = c.replace('+', '');
  let lat = 0, lon = 0, res = 20;
  for (let i = 0; i < 10; i += 2) { lat += OLC.indexOf(d[i]) * res; lon += OLC.indexOf(d[i + 1]) * res; if (i < 8) res /= 20; }
  // the pair resolution after the 5th pair is 0.000125 degrees
  return { lat: lat - 90 + 0.0000625, lon: lon - 180 + 0.0000625 };
}

// ---------------------------------------------------------------------------------------------------------------- UTM
export interface Utm { zone: number; band: string; hemisphere: 'N' | 'S'; easting: number; northing: number; text: string }
export function toUtm(lat: number, lon: number): Utm | null {
  if (lat < -80 || lat > 84) return null;
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) { if (lon >= 0 && lon < 9) zone = 31; else if (lon >= 9 && lon < 21) zone = 33; else if (lon >= 21 && lon < 33) zone = 35; else if (lon >= 33 && lon < 42) zone = 37; }
  const lon0 = ((zone - 1) * 6 - 180 + 3) * RAD, phi = lat * RAD, lam = lon * RAD;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let northing = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) northing += 10000000;
  const band = 'CDEFGHJKLMNPQRSTUVWXX'[Math.floor((lat + 80) / 8)] ?? 'X';
  const hemisphere = lat < 0 ? 'S' : 'N';
  return { zone, band, hemisphere, easting, northing, text: `${zone}${band} ${Math.round(easting)} ${Math.round(northing)}` };
}

export function destination(lat: number, lon: number, bearing: number, km: number): { lat: number; lon: number } {
  const d = km / 6371.0088, b = bearing * RAD, p1 = lat * RAD, l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * DEG, lon: ((l2 * DEG + 540) % 360) - 180 };
}

export interface CoordFormats { decimal: string; dms: string; geohash: string; plusCode: string; utm: string; iso6709: string }
export function allFormats(lat: number, lon: number): CoordFormats {
  return {
    decimal: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, dms: toDms(lat, lon), geohash: geohashEncode(lat, lon, 9), plusCode: plusCodeEncode(lat, lon),
    utm: toUtm(lat, lon)?.text ?? 'outside UTM range (polar)',
    iso6709: `${lat >= 0 ? '+' : '-'}${Math.abs(lat).toFixed(4)}${lon >= 0 ? '+' : '-'}${Math.abs(lon).toFixed(4)}/`,
  };
}

/** Everything in a pasted blob that is a coordinate: the usual formats plus geohash-looking and Plus Code tokens. */
export function readCoordinates(text: string, parse: (t: string) => { lat: number; lon: number; raw: string }[]): { lat: number; lon: number; raw: string; kind: string }[] {
  const out = parse(text).map((p) => ({ ...p, kind: 'coordinates' }));
  for (const m of text.matchAll(/\b[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,}\b/gi)) { const d = plusCodeDecode(m[0]); if (d) out.push({ ...d, raw: m[0], kind: 'Plus Code' }); }
  for (const m of text.matchAll(/\bgeohash[:\s]+([0-9bcdefghjkmnpqrstuvwxyz]{5,12})\b/gi)) { const d = geohashDecode(m[1]); if (d) out.push({ lat: d.lat, lon: d.lon, raw: m[0], kind: 'geohash' }); }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- travel
export interface TravelCheck { km: number; hours: number; kmh: number; bearing: number; heading: string; verdict: 'impossible' | 'flight-needed' | 'drive-or-fast-train' | 'easy'; note: string }
export function travelCheck(a: { lat: number; lon: number; t: number }, b: { lat: number; lon: number; t: number }): TravelCheck {
  const km = haversineKm(a.lat, a.lon, b.lat, b.lon), hours = Math.abs(b.t - a.t) / 3600000;
  const bearing = a.t <= b.t ? bearingDeg(a.lat, a.lon, b.lat, b.lon) : bearingDeg(b.lat, b.lon, a.lat, a.lon);
  const kmh = hours > 0 ? km / hours : km > 0.2 ? Infinity : 0;
  let verdict: TravelCheck['verdict'], note: string;
  // Allow 30 minutes for getting to and from an airport on any trip that needs one; the fastest airliner cruises near 900 km/h.
  const flyHours = km / 880 + 0.5;
  if (km < 0.3) { verdict = 'easy'; note = 'The two places are the same spot.'; }
  else if (hours < km / 1000 || (kmh > 1100)) { verdict = 'impossible'; note = `${Math.round(km).toLocaleString('en-US')} km in ${hours < 1 ? `${Math.round(hours * 60)} minutes` : `${hours.toFixed(1)} hours`} would take ${Math.round(kmh).toLocaleString('en-US')} km/h, faster than an airliner. One of the two times or places is wrong, or two people were involved.`; }
  else if (hours < flyHours && km > 250) { verdict = 'impossible'; note = `A flight would take about ${flyHours.toFixed(1)} hours door to door, longer than the ${hours.toFixed(1)} available. Not possible for one person.`; }
  else if (kmh > 130 || km > 450) { verdict = 'flight-needed'; note = `${Math.round(km).toLocaleString('en-US')} km in ${hours.toFixed(1)} hours (${Math.round(kmh)} km/h) is only possible by plane or very fast train.`; }
  else if (kmh > 55) { verdict = 'drive-or-fast-train'; note = `${Math.round(km).toLocaleString('en-US')} km in ${hours.toFixed(1)} hours (${Math.round(kmh)} km/h) is a hard drive or a train.`; }
  else { verdict = 'easy'; note = `${Math.round(km * 10) / 10} km in ${hours.toFixed(1)} hours (${Math.round(kmh)} km/h) is comfortably possible by car.`; }
  return { km, hours, kmh, bearing, heading: compass(bearing), verdict, note };
}
