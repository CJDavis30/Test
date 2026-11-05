/**
 * Where the sun is, for a place and a moment (NOAA's low-precision algorithm, good to about 0.1 degree). Used as a consistency check:
 * a photo cannot show a bright blue sky when the sun is far below the horizon at the place and time its file claims.
 * Elevation here ignores atmospheric refraction, which only matters within a degree of the horizon.
 */
const RAD = Math.PI / 180, DEG = 180 / Math.PI;

export interface SunPos { elevation: number; azimuth: number; declination: number }

export function sunPosition(when: number | Date, lat: number, lon: number): SunPos {
  const ms = typeof when === 'number' ? when : when.getTime();
  const jd = ms / 86400000 + 2440587.5, t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 * DEG * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const utcMin = ((ms / 60000) % 1440 + 1440) % 1440;
  const solarTime = (((utcMin + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  let H = solarTime / 4 - 180; if (H < -180) H += 360;
  const cosZen = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(H * RAD);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen))) * DEG;
  const elevation = 90 - zen;
  const sinZen = Math.sin(zen * RAD);
  let azimuth = 0;
  if (Math.abs(Math.cos(lat * RAD) * sinZen) > 1e-9) {
    const a = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat * RAD) * Math.cos(zen * RAD) - Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * sinZen)))) * DEG;
    azimuth = H > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { elevation, azimuth, declination: decl };
}

export type Phase = 'day' | 'golden' | 'twilight' | 'night';
export const phaseOf = (elevation: number): Phase => (elevation > 6 ? 'day' : elevation > -0.8 ? 'golden' : elevation > -12 ? 'twilight' : 'night');

export interface DaylightCheck {
  elevation: number; azimuth: number; phase: Phase;
  /** null when the picture cannot say (indoors, dark, no sky); false only when it clearly contradicts the sun. */
  consistent: boolean | null; note: string;
}

/**
 * `sky` is the share of the upper half of the picture that looks like bright daytime sky (measured in the browser). A large share of
 * bright sky while the sun is well below the horizon means the claimed time or place is wrong. The reverse is not tested: a dark
 * picture at noon proves nothing (indoors, a tunnel, a night-mode lens).
 */
export function daylightCheck(when: number, lat: number, lon: number, sky?: number): DaylightCheck {
  const { elevation, azimuth } = sunPosition(when, lat, lon);
  const phase = phaseOf(elevation);
  const e = Math.round(elevation);
  if (sky === undefined) return { elevation, azimuth, phase, consistent: null, note: `The sun was ${e >= 0 ? `${e}° above` : `${-e}° below`} the horizon there at that time (${phase}).` };
  if (sky >= 0.2 && elevation < -8) return { elevation, azimuth, phase, consistent: false, note: `The picture shows bright daytime sky, but the sun was ${-e}° below the horizon at the recorded place and time. The clock, timezone or location in the file is wrong, or the file was altered.` };
  if (sky >= 0.2 && elevation > 6) return { elevation, azimuth, phase, consistent: true, note: `Bright sky matches the sun being ${e}° above the horizon at the recorded place and time.` };
  return { elevation, azimuth, phase, consistent: null, note: `The sun was ${e >= 0 ? `${e}° above` : `${-e}° below`} the horizon there at that time (${phase}); the picture shows too little sky to compare.` };
}
