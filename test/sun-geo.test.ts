import { describe, it, expect } from 'vitest';
import { sunPosition, daylightCheck, phaseOf } from '../shared/forensics/sun';
import { haversineKm, nearestPlace, describePlace, parseCoords, offsetPlausible, mapLinks, bearingDeg } from '../shared/forensics/geo';

describe('sun position', () => {
  it('matches known geometry: equinox noon at the equator is overhead', () => {
    const p = sunPosition(Date.UTC(2024, 2, 20, 12, 7), 0, 0);
    expect(p.elevation).toBeGreaterThan(88.5);
  });
  it('winter solstice noon in London is about 15 degrees up, due south', () => {
    const p = sunPosition(Date.UTC(2024, 11, 21, 12, 0), 51.5, -0.12);
    expect(p.elevation).toBeGreaterThan(14.4); expect(p.elevation).toBeLessThan(15.6);
    expect(Math.abs(p.azimuth - 180)).toBeLessThan(3);
  });
  it('is below the horizon at local midnight and above it at local noon', () => {
    expect(sunPosition(Date.UTC(2024, 5, 21, 0, 0), 40.7, -74).elevation).toBeGreaterThan(0);       // ~20:00 local on the solstice: the sun is still up
    expect(sunPosition(Date.UTC(2024, 5, 21, 5, 0), 40.7, -74).elevation).toBeLessThan(-20);       // ~01:00 local
    expect(sunPosition(Date.UTC(2024, 5, 21, 16, 0), 40.7, -74).elevation).toBeGreaterThan(60);     // noon-ish
    expect(sunPosition(Date.UTC(2024, 0, 15, 4, 0), 40.7, -74).elevation).toBeLessThan(-30);        // 23:00 local
  });
  it('rises in the east and sets in the west', () => {
    expect(sunPosition(Date.UTC(2024, 2, 20, 6, 0), 0, 0).azimuth).toBeLessThan(100);
    expect(sunPosition(Date.UTC(2024, 2, 20, 18, 0), 0, 0).azimuth).toBeGreaterThan(260);
  });
  it('names the phase of day', () => { expect(phaseOf(40)).toBe('day'); expect(phaseOf(2)).toBe('golden'); expect(phaseOf(-6)).toBe('twilight'); expect(phaseOf(-30)).toBe('night'); });
});

describe('daylight consistency', () => {
  const night = Date.UTC(2024, 0, 15, 4, 0); // 23:00 in New York
  it('flags bright sky when the sun is far below the horizon', () => {
    const r = daylightCheck(night, 40.7, -74, 0.5);
    expect(r.consistent).toBe(false); expect(r.note).toMatch(/below the horizon/);
  });
  it('agrees when bright sky meets a high sun', () => expect(daylightCheck(Date.UTC(2024, 5, 21, 16), 40.7, -74, 0.5).consistent).toBe(true));
  it('says nothing when the picture shows no sky, or cannot be measured', () => {
    expect(daylightCheck(night, 40.7, -74, 0.02).consistent).toBeNull();
    expect(daylightCheck(night, 40.7, -74).consistent).toBeNull();
  });
  it('never calls a dark picture at noon inconsistent', () => expect(daylightCheck(Date.UTC(2024, 5, 21, 16), 40.7, -74, 0).consistent).toBeNull());
});

describe('geography', () => {
  it('distance and bearing are right', () => {
    expect(haversineKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeGreaterThan(340); expect(haversineKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeLessThan(346);
    expect(haversineKm(0, 0, 0, 0)).toBe(0);
    expect(Math.round(bearingDeg(0, 0, 10, 0))).toBe(0); expect(Math.round(bearingDeg(0, 0, 0, 10))).toBe(90);
  });
  it('finds the nearest known city and describes it', () => {
    expect(nearestPlace(48.8584, 2.2945).name).toBe('Paris');            // the Eiffel Tower
    expect(nearestPlace(-33.8568, 151.2153).name).toBe('Sydney');         // the Opera House
    expect(describePlace(40.75, -73.99)).toMatch(/New York/);
    expect(describePlace(-40, -120)).toMatch(/far from any major city/);
  });
  it('parses coordinates written five ways, and rejects nonsense', () => {
    expect(parseCoords('shot at 48.8584, 2.2945 yesterday')[0]).toMatchObject({ lat: 48.8584, lon: 2.2945 });
    expect(parseCoords('+37.7749-122.4194/')[0]).toMatchObject({ lat: 37.7749, lon: -122.4194 });
    expect(parseCoords('https://www.google.com/maps/@51.50135,-0.14189,17z')[0]).toMatchObject({ lat: 51.50135, lon: -0.14189 });
    const d = parseCoords(`40°26'46"N 79°58'56"W`)[0]; expect(d.lat).toBeCloseTo(40.4461, 3); expect(d.lon).toBeCloseTo(-79.9822, 3);
    expect(parseCoords('1.2.3.4 and version 10.20.30')).toEqual([]);
    expect(parseCoords('0.0000, 0.0000')).toEqual([]);                    // the "null island" default of broken GPS
    expect(parseCoords('95.5000, 10.5000')).toEqual([]);
  });
  it('checks a timezone offset against the longitude', () => {
    expect(offsetPlausible(-74, -300).ok).toBe(true);                      // New York, UTC-5
    expect(offsetPlausible(80, 480).ok).toBe(true);                        // western China keeps Beijing time: 3 hours off solar, allowed
    expect(offsetPlausible(-74, 600).ok).toBe(false);                      // UTC+10 in New York is not plausible
  });
  it('builds map links with the coordinates in them', () => {
    const l = mapLinks(48.8584, 2.2945); expect(l.length).toBeGreaterThanOrEqual(5);
    expect(l.every((x) => /^https:\/\//.test(x.url) && x.url.includes('48.8584') || x.url.includes('48.85840'))).toBe(true);
  });
});
