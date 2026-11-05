/** Small, exact geography helpers: distances, nearest known city, coordinate parsing, and links to check a place by eye. */

const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin(rad(bLon - aLon)) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLon - aLon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compass = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Well-known cities, enough to turn raw numbers into "about 12 km from Lisbon, Portugal". Coordinates are city centres, rounded. */
const CITIES: [string, string, number, number][] = [
  ['New York', 'United States', 40.71, -74.01], ['Los Angeles', 'United States', 34.05, -118.24], ['Chicago', 'United States', 41.88, -87.63], ['Houston', 'United States', 29.76, -95.37],
  ['Phoenix', 'United States', 33.45, -112.07], ['Philadelphia', 'United States', 39.95, -75.17], ['San Antonio', 'United States', 29.42, -98.49], ['San Diego', 'United States', 32.72, -117.16],
  ['Dallas', 'United States', 32.78, -96.8], ['San Francisco', 'United States', 37.77, -122.42], ['Seattle', 'United States', 47.61, -122.33], ['Denver', 'United States', 39.74, -104.99],
  ['Washington', 'United States', 38.91, -77.04], ['Boston', 'United States', 42.36, -71.06], ['Atlanta', 'United States', 33.75, -84.39], ['Miami', 'United States', 25.76, -80.19],
  ['Las Vegas', 'United States', 36.17, -115.14], ['Portland', 'United States', 45.52, -122.68], ['Austin', 'United States', 30.27, -97.74], ['Detroit', 'United States', 42.33, -83.05],
  ['Minneapolis', 'United States', 44.98, -93.27], ['New Orleans', 'United States', 29.95, -90.07], ['Nashville', 'United States', 36.16, -86.78], ['Salt Lake City', 'United States', 40.76, -111.89],
  ['Honolulu', 'United States', 21.31, -157.86], ['Anchorage', 'United States', 61.22, -149.9], ['Orlando', 'United States', 28.54, -81.38], ['Kansas City', 'United States', 39.1, -94.58],
  ['Toronto', 'Canada', 43.65, -79.38], ['Montreal', 'Canada', 45.5, -73.57], ['Vancouver', 'Canada', 49.28, -123.12], ['Calgary', 'Canada', 51.05, -114.07], ['Ottawa', 'Canada', 45.42, -75.7],
  ['Edmonton', 'Canada', 53.55, -113.49], ['Winnipeg', 'Canada', 49.9, -97.14], ['Halifax', 'Canada', 44.65, -63.58],
  ['Mexico City', 'Mexico', 19.43, -99.13], ['Guadalajara', 'Mexico', 20.67, -103.35], ['Monterrey', 'Mexico', 25.69, -100.32], ['Cancún', 'Mexico', 21.16, -86.85],
  ['Havana', 'Cuba', 23.11, -82.37], ['Panama City', 'Panama', 8.98, -79.52], ['San José', 'Costa Rica', 9.93, -84.08], ['Guatemala City', 'Guatemala', 14.63, -90.51], ['Kingston', 'Jamaica', 17.97, -76.79],
  ['São Paulo', 'Brazil', -23.55, -46.63], ['Rio de Janeiro', 'Brazil', -22.91, -43.17], ['Brasília', 'Brazil', -15.79, -47.88], ['Salvador', 'Brazil', -12.97, -38.51], ['Manaus', 'Brazil', -3.12, -60.02],
  ['Buenos Aires', 'Argentina', -34.6, -58.38], ['Córdoba', 'Argentina', -31.42, -64.18], ['Santiago', 'Chile', -33.45, -70.67], ['Lima', 'Peru', -12.05, -77.04], ['Cusco', 'Peru', -13.53, -71.97],
  ['Bogotá', 'Colombia', 4.71, -74.07], ['Medellín', 'Colombia', 6.24, -75.58], ['Caracas', 'Venezuela', 10.49, -66.88], ['Quito', 'Ecuador', -0.18, -78.47], ['La Paz', 'Bolivia', -16.5, -68.15],
  ['Montevideo', 'Uruguay', -34.9, -56.16], ['Asunción', 'Paraguay', -25.26, -57.58],
  ['London', 'United Kingdom', 51.51, -0.13], ['Manchester', 'United Kingdom', 53.48, -2.24], ['Birmingham', 'United Kingdom', 52.49, -1.89], ['Glasgow', 'United Kingdom', 55.86, -4.25],
  ['Edinburgh', 'United Kingdom', 55.95, -3.19], ['Liverpool', 'United Kingdom', 53.41, -2.99], ['Belfast', 'United Kingdom', 54.6, -5.93], ['Cardiff', 'United Kingdom', 51.48, -3.18],
  ['Dublin', 'Ireland', 53.35, -6.26], ['Paris', 'France', 48.86, 2.35], ['Marseille', 'France', 43.3, 5.37], ['Lyon', 'France', 45.76, 4.84], ['Nice', 'France', 43.7, 7.27], ['Toulouse', 'France', 43.6, 1.44],
  ['Bordeaux', 'France', 44.84, -0.58], ['Berlin', 'Germany', 52.52, 13.4], ['Hamburg', 'Germany', 53.55, 9.99], ['Munich', 'Germany', 48.14, 11.58], ['Cologne', 'Germany', 50.94, 6.96],
  ['Frankfurt', 'Germany', 50.11, 8.68], ['Stuttgart', 'Germany', 48.78, 9.18], ['Dresden', 'Germany', 51.05, 13.74], ['Madrid', 'Spain', 40.42, -3.7], ['Barcelona', 'Spain', 41.39, 2.17],
  ['Valencia', 'Spain', 39.47, -0.38], ['Seville', 'Spain', 37.39, -5.99], ['Bilbao', 'Spain', 43.26, -2.93], ['Lisbon', 'Portugal', 38.72, -9.14], ['Porto', 'Portugal', 41.16, -8.63],
  ['Rome', 'Italy', 41.9, 12.5], ['Milan', 'Italy', 45.46, 9.19], ['Naples', 'Italy', 40.85, 14.27], ['Turin', 'Italy', 45.07, 7.69], ['Florence', 'Italy', 43.77, 11.26], ['Venice', 'Italy', 45.44, 12.32],
  ['Palermo', 'Italy', 38.12, 13.36], ['Amsterdam', 'Netherlands', 52.37, 4.9], ['Rotterdam', 'Netherlands', 51.92, 4.48], ['Brussels', 'Belgium', 50.85, 4.35], ['Antwerp', 'Belgium', 51.22, 4.4],
  ['Luxembourg', 'Luxembourg', 49.61, 6.13], ['Zurich', 'Switzerland', 47.38, 8.54], ['Geneva', 'Switzerland', 46.2, 6.14], ['Bern', 'Switzerland', 46.95, 7.45], ['Vienna', 'Austria', 48.21, 16.37],
  ['Salzburg', 'Austria', 47.8, 13.04], ['Prague', 'Czechia', 50.08, 14.44], ['Warsaw', 'Poland', 52.23, 21.01], ['Kraków', 'Poland', 50.06, 19.94], ['Gdańsk', 'Poland', 54.35, 18.65],
  ['Budapest', 'Hungary', 47.5, 19.04], ['Bratislava', 'Slovakia', 48.15, 17.11], ['Ljubljana', 'Slovenia', 46.06, 14.51], ['Zagreb', 'Croatia', 45.81, 15.98], ['Split', 'Croatia', 43.51, 16.44],
  ['Belgrade', 'Serbia', 44.79, 20.45], ['Sarajevo', 'Bosnia and Herzegovina', 43.86, 18.41], ['Bucharest', 'Romania', 44.43, 26.1], ['Sofia', 'Bulgaria', 42.7, 23.32], ['Athens', 'Greece', 37.98, 23.73],
  ['Thessaloniki', 'Greece', 40.64, 22.94], ['Istanbul', 'Turkey', 41.01, 28.98], ['Ankara', 'Turkey', 39.93, 32.86], ['Izmir', 'Turkey', 38.42, 27.14], ['Copenhagen', 'Denmark', 55.68, 12.57],
  ['Stockholm', 'Sweden', 59.33, 18.07], ['Gothenburg', 'Sweden', 57.71, 11.97], ['Oslo', 'Norway', 59.91, 10.75], ['Bergen', 'Norway', 60.39, 5.32], ['Helsinki', 'Finland', 60.17, 24.94],
  ['Reykjavík', 'Iceland', 64.15, -21.94], ['Tallinn', 'Estonia', 59.44, 24.75], ['Riga', 'Latvia', 56.95, 24.11], ['Vilnius', 'Lithuania', 54.69, 25.28], ['Kyiv', 'Ukraine', 50.45, 30.52],
  ['Odesa', 'Ukraine', 46.48, 30.73], ['Lviv', 'Ukraine', 49.84, 24.03], ['Minsk', 'Belarus', 53.9, 27.57], ['Chișinău', 'Moldova', 47.01, 28.86], ['Moscow', 'Russia', 55.76, 37.62],
  ['Saint Petersburg', 'Russia', 59.93, 30.34], ['Novosibirsk', 'Russia', 55.03, 82.92], ['Yekaterinburg', 'Russia', 56.84, 60.6], ['Vladivostok', 'Russia', 43.12, 131.89], ['Tbilisi', 'Georgia', 41.72, 44.79],
  ['Yerevan', 'Armenia', 40.18, 44.51], ['Baku', 'Azerbaijan', 40.41, 49.87], ['Valletta', 'Malta', 35.9, 14.51], ['Nicosia', 'Cyprus', 35.19, 33.38],
  ['Cairo', 'Egypt', 30.04, 31.24], ['Alexandria', 'Egypt', 31.2, 29.92], ['Casablanca', 'Morocco', 33.57, -7.59], ['Marrakesh', 'Morocco', 31.63, -8.01], ['Algiers', 'Algeria', 36.75, 3.06],
  ['Tunis', 'Tunisia', 36.81, 10.18], ['Tripoli', 'Libya', 32.89, 13.19], ['Lagos', 'Nigeria', 6.52, 3.38], ['Abuja', 'Nigeria', 9.08, 7.4], ['Accra', 'Ghana', 5.6, -0.19], ['Dakar', 'Senegal', 14.72, -17.47],
  ['Abidjan', "Côte d'Ivoire", 5.36, -4.01], ['Addis Ababa', 'Ethiopia', 9.03, 38.74], ['Nairobi', 'Kenya', -1.29, 36.82], ['Dar es Salaam', 'Tanzania', -6.79, 39.21], ['Kampala', 'Uganda', 0.35, 32.58],
  ['Kigali', 'Rwanda', -1.94, 30.06], ['Kinshasa', 'DR Congo', -4.44, 15.27], ['Luanda', 'Angola', -8.84, 13.23], ['Lusaka', 'Zambia', -15.39, 28.32], ['Harare', 'Zimbabwe', -17.83, 31.05],
  ['Johannesburg', 'South Africa', -26.2, 28.05], ['Cape Town', 'South Africa', -33.92, 18.42], ['Durban', 'South Africa', -29.86, 31.02], ['Maputo', 'Mozambique', -25.97, 32.57], ['Antananarivo', 'Madagascar', -18.88, 47.51],
  ['Khartoum', 'Sudan', 15.5, 32.56], ['Windhoek', 'Namibia', -22.56, 17.08], ['Gaborone', 'Botswana', -24.63, 25.92],
  ['Dubai', 'United Arab Emirates', 25.2, 55.27], ['Abu Dhabi', 'United Arab Emirates', 24.45, 54.38], ['Riyadh', 'Saudi Arabia', 24.71, 46.68], ['Jeddah', 'Saudi Arabia', 21.49, 39.19], ['Doha', 'Qatar', 25.29, 51.53],
  ['Kuwait City', 'Kuwait', 29.38, 47.99], ['Manama', 'Bahrain', 26.23, 50.59], ['Muscat', 'Oman', 23.59, 58.41], ['Tehran', 'Iran', 35.69, 51.39], ['Baghdad', 'Iraq', 33.31, 44.37], ['Amman', 'Jordan', 31.95, 35.93],
  ['Beirut', 'Lebanon', 33.89, 35.5], ['Damascus', 'Syria', 33.51, 36.28], ['Jerusalem', 'Israel', 31.77, 35.21], ['Tel Aviv', 'Israel', 32.09, 34.78], ['Kabul', 'Afghanistan', 34.53, 69.17],
  ['Karachi', 'Pakistan', 24.86, 67.01], ['Lahore', 'Pakistan', 31.52, 74.36], ['Islamabad', 'Pakistan', 33.68, 73.05], ['Delhi', 'India', 28.61, 77.21], ['Mumbai', 'India', 19.08, 72.88], ['Bengaluru', 'India', 12.97, 77.59],
  ['Kolkata', 'India', 22.57, 88.36], ['Chennai', 'India', 13.08, 80.27], ['Hyderabad', 'India', 17.39, 78.49], ['Ahmedabad', 'India', 23.02, 72.57], ['Jaipur', 'India', 26.91, 75.79], ['Dhaka', 'Bangladesh', 23.81, 90.41],
  ['Kathmandu', 'Nepal', 27.72, 85.32], ['Colombo', 'Sri Lanka', 6.93, 79.86], ['Malé', 'Maldives', 4.18, 73.51], ['Yangon', 'Myanmar', 16.87, 96.2], ['Bangkok', 'Thailand', 13.76, 100.5], ['Chiang Mai', 'Thailand', 18.79, 98.98],
  ['Phuket', 'Thailand', 7.88, 98.39], ['Hanoi', 'Vietnam', 21.03, 105.85], ['Ho Chi Minh City', 'Vietnam', 10.82, 106.63], ['Phnom Penh', 'Cambodia', 11.56, 104.93], ['Vientiane', 'Laos', 17.97, 102.63],
  ['Kuala Lumpur', 'Malaysia', 3.14, 101.69], ['Singapore', 'Singapore', 1.35, 103.82], ['Jakarta', 'Indonesia', -6.21, 106.85], ['Surabaya', 'Indonesia', -7.25, 112.75], ['Denpasar', 'Indonesia', -8.65, 115.22],
  ['Manila', 'Philippines', 14.6, 120.98], ['Cebu', 'Philippines', 10.32, 123.89], ['Hong Kong', 'China', 22.32, 114.17], ['Macau', 'China', 22.2, 113.54], ['Shenzhen', 'China', 22.54, 114.06], ['Guangzhou', 'China', 23.13, 113.26],
  ['Shanghai', 'China', 31.23, 121.47], ['Beijing', 'China', 39.9, 116.41], ['Chengdu', 'China', 30.57, 104.07], ['Chongqing', 'China', 29.56, 106.55], ['Wuhan', 'China', 30.59, 114.31], ['Xi\'an', 'China', 34.34, 108.94],
  ['Hangzhou', 'China', 30.27, 120.16], ['Nanjing', 'China', 32.06, 118.8], ['Tianjin', 'China', 39.34, 117.36], ['Urumqi', 'China', 43.83, 87.62], ['Lhasa', 'China', 29.65, 91.14], ['Taipei', 'Taiwan', 25.03, 121.57],
  ['Seoul', 'South Korea', 37.57, 126.98], ['Busan', 'South Korea', 35.18, 129.08], ['Pyongyang', 'North Korea', 39.04, 125.76], ['Tokyo', 'Japan', 35.68, 139.69], ['Osaka', 'Japan', 34.69, 135.5], ['Kyoto', 'Japan', 35.01, 135.77],
  ['Nagoya', 'Japan', 35.18, 136.91], ['Sapporo', 'Japan', 43.06, 141.35], ['Fukuoka', 'Japan', 33.59, 130.4], ['Ulaanbaatar', 'Mongolia', 47.89, 106.91], ['Almaty', 'Kazakhstan', 43.24, 76.89], ['Astana', 'Kazakhstan', 51.17, 71.43],
  ['Tashkent', 'Uzbekistan', 41.3, 69.24], ['Bishkek', 'Kyrgyzstan', 42.87, 74.59],
  ['Sydney', 'Australia', -33.87, 151.21], ['Melbourne', 'Australia', -37.81, 144.96], ['Brisbane', 'Australia', -27.47, 153.03], ['Perth', 'Australia', -31.95, 115.86], ['Adelaide', 'Australia', -34.93, 138.6],
  ['Canberra', 'Australia', -35.28, 149.13], ['Darwin', 'Australia', -12.46, 130.84], ['Hobart', 'Australia', -42.88, 147.33], ['Auckland', 'New Zealand', -36.85, 174.76], ['Wellington', 'New Zealand', -41.29, 174.78],
  ['Christchurch', 'New Zealand', -43.53, 172.64], ['Suva', 'Fiji', -18.14, 178.44], ['Port Moresby', 'Papua New Guinea', -9.44, 147.18], ['Papeete', 'French Polynesia', -17.54, -149.57],
];

export interface Place { name: string; country: string; lat: number; lon: number; km: number; bearing: number }

export function nearestPlace(lat: number, lon: number): Place {
  let best = CITIES[0], bestKm = Infinity;
  for (const c of CITIES) { const d = haversineKm(lat, lon, c[2], c[3]); if (d < bestKm) { best = c; bestKm = d; } }
  return { name: best[0], country: best[1], lat: best[2], lon: best[3], km: bestKm, bearing: bearingDeg(best[2], best[3], lat, lon) };
}

export function describePlace(lat: number, lon: number): string {
  const p = nearestPlace(lat, lon);
  if (p.km < 15) return `in or next to ${p.name}, ${p.country}`;
  if (p.km > 600) return `far from any major city in the built-in list (nearest is ${p.name}, ${p.country}, about ${Math.round(p.km).toLocaleString('en-US')} km away)`;
  return `about ${Math.round(p.km)} km ${compass(p.bearing)} of ${p.name}, ${p.country}`;
}

export const validCoord = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/** Standard-time zones sit near longitude/15 hours from UTC, though politics bends them by up to about three hours. */
export function offsetPlausible(lon: number, offsetMinutes: number): { ok: boolean; expectedHours: number; diffHours: number } {
  const expected = lon / 15, diff = offsetMinutes / 60 - expected;
  return { ok: Math.abs(diff) <= 3.6, expectedHours: expected, diffHours: diff };
}

/** Coordinates written in the wild: decimal, degrees-minutes-seconds, ISO 6709 (video files) and map links. */
export function parseCoords(text: string): { lat: number; lon: number; raw: string }[] {
  const out: { lat: number; lon: number; raw: string }[] = [];
  const add = (lat: number, lon: number, raw: string) => { if (validCoord(lat, lon) && !out.some((o) => Math.abs(o.lat - lat) < 1e-5 && Math.abs(o.lon - lon) < 1e-5)) out.push({ lat, lon, raw }); };
  let m: RegExpExecArray | null;
  const maps = /(?:@|[?&]q=|[?&]ll=|[?&]center=|!3d)(-?\d{1,2}\.\d{3,})(?:,|!4d)(-?\d{1,3}\.\d{3,})/g;
  while ((m = maps.exec(text))) add(+m[1], +m[2], m[0]);
  const iso = /(?<![\d.])([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\//g;
  while ((m = iso.exec(text))) add(+m[1], +m[2], m[0]);
  const dms = /(\d{1,3})\s*[°d]\s*(\d{1,2})\s*['′m]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|s|'')?\s*([NS])[\s,;]*(\d{1,3})\s*[°d]\s*(\d{1,2})\s*['′m]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|s|'')?\s*([EW])/gi;
  while ((m = dms.exec(text))) {
    const la = (+m[1] + +m[2] / 60 + +m[3] / 3600) * (/s/i.test(m[4]) ? -1 : 1), lo = (+m[5] + +m[6] / 60 + +m[7] / 3600) * (/w/i.test(m[8]) ? -1 : 1);
    add(la, lo, m[0]);
  }
  const dec = /(?<![\d.])(-?\d{1,2}\.\d{4,})\s*[,;/ ]\s*(-?\d{1,3}\.\d{4,})(?![\d.])/g;
  while ((m = dec.exec(text))) add(+m[1], +m[2], m[0]);
  return out;
}

export interface MapLink { label: string; url: string }
/** Ways to check a place by eye. The first three open a map; Street View and Mapillary show what the ground looks like. */
export function mapLinks(lat: number, lon: number): MapLink[] {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return [
    { label: 'Open in Apple Maps', url: `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(ll)}` },
    { label: 'Open in Google Maps', url: `https://www.google.com/maps/search/?api=1&query=${ll}` },
    { label: 'OpenStreetMap', url: `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=17/${lat.toFixed(5)}/${lon.toFixed(5)}` },
    { label: 'Street View', url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}` },
    { label: 'Mapillary street photos', url: `https://www.mapillary.com/app/?lat=${lat.toFixed(6)}&lng=${lon.toFixed(6)}&z=17` },
    { label: 'Satellite (Google Earth)', url: `https://earth.google.com/web/@${lat.toFixed(6)},${lon.toFixed(6)},0a,800d,35y,0h,0t,0r` },
  ];
}
