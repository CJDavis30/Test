import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-geo-'));
const { Store } = await import('../server/store');
const { parseGeoReply, aggregate, geolocate, recordGeo, calibration } = await import('../server/geolocate');

const reply = (lat: number, lon: number, place = 'Somewhere', conf = 0.6, extra: any = {}) => JSON.stringify({ not_enough_information: false, indoors: false, candidates: [{ place, lat, lon, confidence: conf, clues: ['tram wires', 'Portuguese signs'] }], visible_text: [{ text: 'Rua Augusta', language: 'Portuguese' }], observations: { driving_side: 'right', vegetation: 'unknown' }, ...extra });
const S = (lat: number, lon: number, place?: string) => parseGeoReply(reply(lat, lon, place))!;

describe('reading the model reply', () => {
  it('accepts clean JSON, fenced JSON and chatty replies', () => {
    expect(parseGeoReply(reply(38.7, -9.14, 'Lisbon'))!.candidates[0].place).toBe('Lisbon');
    expect(parseGeoReply('```json\n' + reply(38.7, -9.14) + '\n```')!.candidates).toHaveLength(1);
    expect(parseGeoReply('Sure! Here you go:\n' + reply(38.7, -9.14))!.candidates).toHaveLength(1);
  });
  it('drops impossible coordinates, null island and junk, and treats "no candidates" as not enough information', () => {
    expect(parseGeoReply(JSON.stringify({ candidates: [{ place: 'x', lat: 95, lon: 10, confidence: 1 }, { place: 'y', lat: 0, lon: 0, confidence: 1 }] }))!.notEnough).toBe(true);
    expect(parseGeoReply('no json at all')).toBeNull();
    expect(parseGeoReply(JSON.stringify({ not_enough_information: true, candidates: [{ place: 'z', lat: 10, lon: 10, confidence: 0.9 }] }))!.notEnough).toBe(true);
  });
  it('clamps confidence, caps candidates and removes "unknown" observations', () => {
    const s = parseGeoReply(JSON.stringify({ candidates: [1, 2, 3, 4, 5].map((i) => ({ place: `p${i}`, lat: i, lon: i, confidence: 7 })), observations: { driving_side: 'left', vegetation: 'Unknown', sun_and_shadows: '' } }))!;
    expect(s.candidates).toHaveLength(3); expect(s.candidates[0].confidence).toBe(1);
    expect(s.observations).toEqual({ driving_side: 'left' });
  });
});

describe('agreement is the confidence', () => {
  it('three readings in one city: strong, city-level, with the clues merged', () => {
    const c = aggregate([S(38.7139, -9.1394, 'Lisbon'), S(38.7223, -9.1393, 'Lisbon Baixa'), S(38.7100, -9.1500, 'Lisbon')]);
    expect(c.level).toBe('city'); expect(c.votes).toBe(3); expect(c.spreadKm!).toBeLessThan(10);
    expect(c.summary).toMatch(/3 of 3 independent readings agree within 25 km/);
    expect(c.clues).toContain('tram wires'); expect(c.visibleText[0].text).toBe('Rua Augusta');
  });
  it('neighbouring cities: region level, never city', () => {
    const c = aggregate([S(38.72, -9.14), S(41.15, -8.61), S(37.02, -7.93)]);          // Lisbon, Porto, Faro
    expect(c.level).toBe('region'); expect(c.summary).toMatch(/right area, probably not the right street/);
  });
  it('cities hundreds of kilometres apart: country level only', () => {
    const c = aggregate([S(38.72, -9.14), S(40.42, -3.7), S(41.39, 2.17)]);            // Lisbon, Madrid, Barcelona
    expect(c.level).toBe('country'); expect(c.summary).toMatch(/country or large region only/);
  });
  it('scattered readings give no answer, only candidates to check', () => {
    const c = aggregate([S(38.72, -9.14), S(35.68, 139.69), S(-33.87, 151.21)]);
    expect(c.level).toBe('none'); expect(c.lat).toBeUndefined(); expect(c.summary).toMatch(/disagree/); expect(c.alternatives.length).toBe(3);
  });
  it('two of three agreeing is enough for a city; one of three is not', () => {
    expect(aggregate([S(38.72, -9.14), S(38.71, -9.13), S(35.68, 139.69)]).level).toBe('city');
    expect(aggregate([S(38.72, -9.14), S(35.68, 139.69), S(40.7, -74)]).level).toBe('none');
  });
  it('"not enough information" readings count against certainty', () => {
    const none = parseGeoReply(JSON.stringify({ not_enough_information: true, candidates: [] }))!;
    expect(aggregate([S(38.72, -9.14), none, none]).level).toBe('none');
    expect(aggregate([none, none, none]).summary).toMatch(/did not find enough/);
  });
  it('failed calls are reported and do not crash it', () => {
    const c = aggregate([S(38.72, -9.14), S(38.71, -9.13), null]);
    expect(c.level).toBe('city'); expect(c.failedRuns).toBe(1);
    expect(aggregate([null, null, null]).summary).toMatch(/No reading came back/);
  });
  it('a single run can never reach a conclusion on its own', () => {
    expect(aggregate([S(38.72, -9.14)]).level).toBe('none');       // need >= 2 votes
  });
});

function fakeStore() {
  const s = new Store(join(mkdtempSync(join(tmpdir(), 'plexus-geo1-')), 'p.db'));
  s.setSetting('ai', { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'vision-test', allowCloud: true });
  return s;
}
const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('asking the model', () => {
  it('sends the picture as pixels only, three times, varying the temperature, with no metadata in the prompt', async () => {
    const calls: any[] = [];
    const f = (async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: reply(38.72, -9.14, 'Lisbon') } }] })); }) as any;
    const c = await geolocate(fakeStore(), img, { fetchImpl: f });
    expect(calls).toHaveLength(3); expect(c.level).toBe('city');
    expect(calls[0].model).toBe('vision-test');
    expect(calls.map((x) => x.temperature)).toEqual([0.2, 0.7, 0.7]);
    const user = calls[0].messages[1].content;
    expect(user.find((p: any) => p.type === 'image_url').image_url.url).toBe(img);
    expect(JSON.stringify(calls[0].messages)).not.toMatch(/gps|exif|latitude of the photo/i);
    expect(calls[0].messages[0].content).toMatch(/Never identify or describe real people/);
  });
  it('uses the vision model when one is set', async () => {
    const s = fakeStore(); s.setSetting('ai', { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'text-only', visionModel: 'sees-images', allowCloud: true });
    const calls: any[] = [];
    await geolocate(s, img, { fetchImpl: (async (_u: string, i: any) => { calls.push(JSON.parse(i.body)); return new Response(JSON.stringify({ choices: [{ message: { content: reply(1, 1) } }] })); }) as any });
    expect(calls[0].model).toBe('sees-images');
  });
  it('survives some failed calls, and reports the error if all fail', async () => {
    let n = 0;
    const flaky = (async () => (++n === 2 ? new Response('boom', { status: 500 }) : new Response(JSON.stringify({ choices: [{ message: { content: reply(38.72, -9.14) } }] })))) as any;
    const c = await geolocate(fakeStore(), img, { fetchImpl: flaky });
    expect(c.failedRuns).toBe(1); expect(c.level).toBe('city');
    await expect(geolocate(fakeStore(), img, { fetchImpl: (async () => new Response('nope', { status: 401 })) as any })).rejects.toThrow(/rejected the API key/);
  });
  it('refuses anything that is not a small image data URL', async () => {
    await expect(geolocate(fakeStore(), 'https://evil.example/x.jpg')).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(geolocate(fakeStore(), 'data:text/html;base64,PGgxPg==')).rejects.toThrow();
    await expect(geolocate(fakeStore(), 'data:image/jpeg;base64,' + 'A'.repeat(9_000_000))).rejects.toThrow();
  });
});

describe('measured accuracy on photos with known locations', () => {
  it('records miss distances and reports how often each claimed level was right', () => {
    const s = fakeStore();
    const lisbon = aggregate([S(38.72, -9.14), S(38.71, -9.13), S(38.73, -9.15)]);
    recordGeo(s, lisbon, { lat: 38.7223, lon: -9.1393 });        // a hit
    recordGeo(s, lisbon, { lat: 41.15, lon: -8.61 });            // a miss: it was actually Porto (~275 km)
    const cal = calibration(s.getSetting('geoCalibration', []));
    expect(cal.byLevel.city).toMatchObject({ n: 2, right: 1 }); expect(cal.byLevel.city.medianKm).toBeGreaterThan(200);
    expect(recordGeo(s, aggregate([S(38.72, -9.14), S(35.68, 139.69), S(40.7, -74)]), { lat: 1, lon: 1 })).toBeNull();   // no answer, nothing to score
  });
});
