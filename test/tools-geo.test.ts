import { describe, it, expect } from 'vitest';
import { geohashEncode, geohashDecode, plusCodeEncode, plusCodeDecode, toUtm, toDms, destination, allFormats, travelCheck, readCoordinates } from '../shared/tools/coords';
import { elevationFromShadow, shadowFromElevation, subsolarPoint, sunRing, locateBySun, timesForElevation, maxElevation } from '../shared/tools/sunsolve';
import { sunPosition } from '../shared/forensics/sun';
import { parseCoords, haversineKm } from '../shared/forensics/geo';

describe('coordinate formats', () => {
  it('geohash matches the published examples and round-trips', () => {
    expect(geohashEncode(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(geohashEncode(37.7749, -122.4194, 5)).toBe('9q8yy');
    const d = geohashDecode('u4pruydqqvj')!;
    expect(d.lat).toBeCloseTo(57.64911, 4); expect(d.lon).toBeCloseTo(10.40744, 4);
    expect(geohashDecode('not a hash!')).toBeNull();
  });
  it('plus code: published example decodes to the Googleplex and re-encodes', () => {
    const d = plusCodeDecode('849VCWC8+R9')!;
    expect(d.lat).toBeCloseTo(37.4221, 3); expect(d.lon).toBeCloseTo(-122.0841, 3);
    expect(plusCodeEncode(d.lat, d.lon)).toBe('849VCWC8+R9');
    expect(plusCodeDecode('nope')).toBeNull();
    for (const [la, lo] of [[0.0001, 0.0001], [-33.8568, 151.2153], [64.1466, -21.9426], [-89.9, 179.9]]) { const c = plusCodeEncode(la, lo), back = plusCodeDecode(c)!; expect(Math.abs(back.lat - la)).toBeLessThan(0.00013); expect(Math.abs(back.lon - lo)).toBeLessThan(0.00013); }
  });
  it('UTM matches known points', () => {
    const esb = toUtm(40.748817, -73.985428)!;
    expect(esb.zone).toBe(18); expect(esb.band).toBe('T');
    // reference values from an independent Krüger-series implementation
    expect(Math.abs(esb.easting - 585650.84)).toBeLessThan(0.1); expect(Math.abs(esb.northing - 4511369.0)).toBeLessThan(0.1);
    const syd = toUtm(-33.8568, 151.2153)!;
    expect(syd.zone).toBe(56); expect(syd.band).toBe('H'); expect(syd.hemisphere).toBe('S'); expect(Math.abs(syd.easting - 334900.57)).toBeLessThan(0.1); expect(Math.abs(syd.northing - 6252288.75)).toBeLessThan(0.1);
    expect(toUtm(88, 10)).toBeNull();
  });
  it('DMS, destination and the combined table are sane', () => {
    expect(toDms(37.7749, -122.4194)).toBe('37°46′29.6″N 122°25′09.8″W');
    const p = destination(0, 0, 90, 111.195);
    expect(p.lat).toBeCloseTo(0, 3); expect(p.lon).toBeCloseTo(1, 2);
    const f = allFormats(48.8584, 2.2945);
    expect(f.plusCode).toMatch(/^[2-9CFGHJMPQRVWX]{8}\+[2-9CFGHJMPQRVWX]{2}$/); expect(f.utm).toMatch(/^31U /);
  });
  it('reads Plus Codes and labelled geohashes out of text, plus normal coordinates', () => {
    const r = readCoordinates('meet at 849VCWC8+R9 or geohash: 9q8yy or 37.7749, -122.4194', parseCoords);
    expect(r.map((x) => x.kind).sort()).toEqual(['Plus Code', 'coordinates', 'geohash']);
  });
});

describe('travel plausibility', () => {
  const SF = { lat: 37.7749, lon: -122.4194 }, NYC = { lat: 40.7128, lon: -74.006 }, OAK = { lat: 37.8044, lon: -122.2712 };
  const H = 3600000, t0 = Date.UTC(2025, 5, 1, 12);
  it('SF to New York in two hours is impossible; in nine it needs a plane; SF to Oakland in an hour is easy', () => {
    expect(travelCheck({ ...SF, t: t0 }, { ...NYC, t: t0 + 2 * H }).verdict).toBe('impossible');
    expect(travelCheck({ ...SF, t: t0 }, { ...NYC, t: t0 + 9 * H }).verdict).toBe('flight-needed');
    expect(travelCheck({ ...SF, t: t0 }, { ...OAK, t: t0 + H }).verdict).toBe('easy');
  });
  it('order of the two sightings does not matter and simultaneous far apart is impossible', () => {
    expect(travelCheck({ ...NYC, t: t0 + 2 * H }, { ...SF, t: t0 }).verdict).toBe('impossible');
    expect(travelCheck({ ...SF, t: t0 }, { ...NYC, t: t0 }).verdict).toBe('impossible');
    expect(travelCheck({ ...SF, t: t0 }, { ...SF, t: t0 }).verdict).toBe('easy');
  });
});

describe('sun solver', () => {
  const noon = Date.UTC(2025, 2, 20, 12, 0); // near the March equinox
  it('shadow length and sun height convert both ways', () => {
    expect(elevationFromShadow(1, 1)).toBeCloseTo(45, 6);
    expect(shadowFromElevation(2, 30)).toBeCloseTo(2 / Math.tan(Math.PI / 6), 6);
    expect(shadowFromElevation(2, -3)).toBe(Infinity);
  });
  it('the subsolar point is directly under the sun and the ring has the right radius', () => {
    const s = subsolarPoint(noon);
    expect(sunPosition(noon, s.lat, s.lon).elevation).toBeGreaterThan(89.5);
    const ring = sunRing(noon, 60);
    expect(ring.radiusKm).toBeCloseTo(30 * Math.PI / 180 * 6371.0088, 3);
    expect(Math.abs(haversineKm(s.lat, s.lon, ring.center.lat, ring.center.lon))).toBeLessThan(1);
  });
  it('recovers a known place from the sun height and shadow direction alone', () => {
    const truth = { lat: 48.8584, lon: 2.2945 }, when = Date.UTC(2025, 5, 21, 8, 30);
    const s = sunPosition(when, truth.lat, truth.lon);
    const { points } = locateBySun(when, s.elevation, s.azimuth);
    expect(points.length).toBeGreaterThan(0);
    const best = Math.min(...points.map((p) => haversineKm(p.lat, p.lon, truth.lat, truth.lon)));
    expect(best).toBeLessThan(50);
  });
  it('from a place and a date, finds the morning and afternoon times a shadow of that length occurs', () => {
    const day = Date.UTC(2025, 5, 21), lat = 40.7128, lon = -74.006;
    const hits = timesForElevation(lat, lon, day, 45);
    expect(hits.map((h) => h.side)).toEqual(['morning', 'afternoon']);
    for (const h of hits) expect(Math.abs(sunPosition(h.ms, lat, lon).elevation - 45)).toBeLessThan(0.05);
    expect(timesForElevation(lat, lon, day, 85)).toEqual([]); // the sun never gets that high there
    expect(maxElevation(lat, lon, day).elevation).toBeGreaterThan(70);
  });
});
