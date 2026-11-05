/** What the weather was, from Open-Meteo's free archive (hourly, back to 1940, no key). Used to test a photo or a claim: "it was pouring" vs "clear sky". */

export const WMO: Record<number, string> = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'heavy freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'violent showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'severe thunderstorm with hail',
};

export interface WeatherAt { iso: string; description: string; tempC?: number; precipMm?: number; cloudPct?: number; windKmh?: number; visibilityKm?: number; isDay?: boolean; sunrise?: string; sunset?: string; sky: 'clear' | 'cloudy' | 'wet' | 'snow' | 'fog' | 'storm' | 'unknown'; consistentWith: string }

export function weatherUrl(lat: number, lon: number, isoDate: string, now = Date.now()): string {
  const d = isoDate.slice(0, 10), age = (now - Date.parse(d + 'T00:00:00Z')) / 86400000;
  const hourly = 'temperature_2m,precipitation,cloud_cover,weather_code,wind_speed_10m,is_day,visibility';
  const base = age > 6 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const range = `&start_date=${d}&end_date=${d}`;
  return `${base}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}${range}&hourly=${hourly}&daily=sunrise,sunset&timezone=GMT`;
}

export function weatherAt(j: any, iso: string): WeatherAt | null {
  const times: string[] = j?.hourly?.time; if (!Array.isArray(times) || !times.length) return null;
  const target = Date.parse(iso.length <= 16 && !iso.endsWith('Z') ? iso + ':00Z' : iso); if (!Number.isFinite(target)) return null;
  let best = -1, bd = Infinity;
  times.forEach((t, i) => { const d = Math.abs(Date.parse(t + 'Z') - target); if (d < bd) { bd = d; best = i; } });
  if (best < 0 || bd > 90 * 60000) return null;
  const h = j.hourly, at = <T,>(k: string) => (Array.isArray(h[k]) ? (h[k][best] as T | null) ?? undefined : undefined);
  const code = at<number>('weather_code'), precip = at<number>('precipitation'), cloud = at<number>('cloud_cover'), vis = at<number>('visibility');
  const description = code !== undefined ? WMO[code] ?? `weather code ${code}` : 'unknown';
  const sky: WeatherAt['sky'] = code === undefined ? 'unknown' : code >= 95 ? 'storm' : code >= 71 && code <= 86 ? 'snow' : code === 45 || code === 48 ? 'fog' : code >= 51 ? 'wet' : (cloud ?? 0) >= 70 || code === 3 ? 'cloudy' : 'clear';
  const consistentWith = ({ clear: 'a bright, sunny or only lightly clouded scene; long hard shadows if the sun was up', cloudy: 'an overcast or grey scene with soft or no shadows', wet: 'wet ground, umbrellas, rain on windows or lenses', snow: 'snow on the ground, trees and rooftops', fog: 'low visibility, flat grey light', storm: 'dark skies, heavy rain, lightning', unknown: 'nothing in particular' } as const)[sky];
  const dayIdx = (j?.daily?.time as string[] | undefined)?.indexOf(times[best].slice(0, 10)) ?? -1;
  return {
    iso: `${times[best]}:00Z`, description, tempC: at<number>('temperature_2m'), precipMm: precip, cloudPct: cloud, windKmh: at<number>('wind_speed_10m'), visibilityKm: vis !== undefined ? vis / 1000 : undefined,
    isDay: at<number>('is_day') === 1 ? true : at<number>('is_day') === 0 ? false : undefined, sunrise: dayIdx >= 0 ? j.daily.sunrise?.[dayIdx] : undefined, sunset: dayIdx >= 0 ? j.daily.sunset?.[dayIdx] : undefined, sky, consistentWith,
  };
}
