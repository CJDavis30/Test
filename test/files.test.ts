import { describe, it, expect } from 'vitest';
import { analyzeFile, sniff } from '../server/files/analyze';
import { parseMp4, parseIso6709 } from '../server/files/mp4';
import { parsePdf, pdfDate } from '../server/files/pdf';
import { jpegQuality, parseJpeg, detectAiPng } from '../server/files/image';
import { dateFromName, originFromName } from '../server/files/names';
import { scanText } from '../server/files/leaks';
import { readZip } from '../server/files/zip';
import { buildExifJpeg, bareJpeg } from './world/makeJpeg';
import { buildDocx, buildMp4, buildPng, buildPdf, buildPe, buildZip } from './world/makeFiles';

const fact = (r: Awaited<ReturnType<typeof analyzeFile>>, label: string) => r.facts.find((f) => f.label === label);
const flag = (r: Awaited<ReturnType<typeof analyzeFile>>, id: string) => r.flags.find((f) => f.id === id);

describe('photos', () => {
  const paris = { lat: 48.8584, lon: 2.2945, alt: 35, heading: 270, utcDate: '2024:05:03', utcTime: [12, 22, 9] as [number, number, number], method: 'GPS' };
  const base = { make: 'Apple', model: 'iPhone 15 Pro', software: '17.4.1', dateTimeOriginal: '2024:05:03 14:22:10', offsetTimeOriginal: '+02:00', bodySerial: 'F2LXQ123', owner: 'Mara Linden', width: 4032, height: 3024, gps: paris };

  it('pulls location, time with timezone, device and owner, and ranks them as the headline', async () => {
    const r = await analyzeFile(buildExifJpeg(base), 'IMG_0001.JPG');
    expect(r.kind).toBe('jpeg');
    expect(r.location!.lat).toBeCloseTo(48.8584, 4); expect(r.location!.lon).toBeCloseTo(2.2945, 4); expect(r.location!.heading).toBe(270);
    expect(r.location!.description).toMatch(/Paris/);
    expect(fact(r, 'GPS location')!.importance).toBe(3);
    expect(fact(r, 'Photo taken')!.value).toMatch(/2024-05-03 14:22:10.*UTC\+02:00/);
    expect(fact(r, 'Camera serial number')!.importance).toBe(3);
    expect(fact(r, 'Camera owner')!.value).toBe('Mara Linden');
    expect(r.tz).toMatchObject({ offsetMin: 120 });
    expect(r.headline.map((f) => f.label)).toEqual(expect.arrayContaining(['GPS location', 'Photo taken', 'Camera serial number', 'Camera owner']));
    expect(r.headline.every((f) => f.importance === 3)).toBe(true);
    expect(fact(r, 'Camera was facing')!.value).toMatch(/west/);
  });
  it('proposes the place, the owner and nothing generic as things to add to a case', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, artist: 'Admin' }), 'a.jpg');
    expect(r.entities.some((e) => e.type === 'location' && e.confidence === 'high')).toBe(true);
    expect(r.entities.some((e) => e.type === 'person' && e.value === 'Mara Linden')).toBe(true);
    expect(r.entities.some((e) => /admin/i.test(e.value))).toBe(false);
  });
  it('works out the timezone from the GPS clock when the camera recorded none', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, offsetTimeOriginal: undefined }), 'a.jpg');
    expect(r.tz).toMatchObject({ offsetMin: 120 });
    expect(r.tz!.source).toMatch(/GPS clock/);
  });
  it('flags a camera clock that disagrees with the satellites', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, dateTimeOriginal: '2024:05:03 17:22:10' }), 'a.jpg');   // 3 hours off
    expect(flag(r, 'clock-vs-gps')?.severity).toBe('warning');
  });
  it('flags a timezone that cannot fit the place', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, offsetTimeOriginal: '+10:00', gps: { ...paris, utcTime: [4, 22, 9] } }), 'a.jpg');
    expect(flag(r, 'tz-vs-place')).toBeTruthy();
  });
  it('catches a bright sky at a time when the sun is far below the horizon', async () => {
    const night = buildExifJpeg({ ...base, dateTimeOriginal: '2024:01:15 02:00:00', offsetTimeOriginal: '+01:00', gps: { ...paris, utcDate: '2024:01:15', utcTime: [1, 0, 0] } });
    expect(flag(await analyzeFile(night, 'a.jpg', { pixels: { luma: 180, sky: 0.5, dhash: '0'.repeat(16), width: 64, height: 64 } }), 'daylight')?.severity).toBe('warning');
    expect(flag(await analyzeFile(night, 'a.jpg', { pixels: { luma: 20, sky: 0, dhash: '0'.repeat(16), width: 64, height: 64 } }), 'daylight')).toBeUndefined();
    expect(flag(await analyzeFile(night, 'a.jpg'), 'daylight')).toBeUndefined();                 // no pixels measured: say nothing
  });
  it('treats 0,0 GPS as a failed fix rather than a place', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, gps: { lat: 0, lon: 0 } }), 'a.jpg');
    expect(r.location).toBeUndefined(); expect(flag(r, 'bad-gps')).toBeTruthy();
  });
  it('notes coarse network positioning', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, gps: { ...paris, method: 'NETWORK' } }), 'a.jpg');
    expect(flag(r, 'coarse-gps')).toBeTruthy();
  });
  it('detects a cropped picture whose old preview was left behind', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, thumbnail: { width: 160, height: 120 }, width: 4000, height: 3000 }), 'a.jpg');   // same 4:3 shape: honest
    const r2 = await analyzeFile(buildExifJpeg({ ...base, thumbnail: { width: 160, height: 160 }, width: 4000, height: 3000 }), 'b.jpg');  // square preview, 4:3 picture: cropped
    expect(flag(r2, 'thumbnail-mismatch')?.severity).toBe('warning');
    expect(flag(r, 'thumbnail-mismatch')).toBeUndefined();
  });
  it('does not call a rotated photo edited', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, thumbnail: { width: 120, height: 160 }, width: 3024, height: 4032 }), 'a.jpg');
    expect(flag(r, 'thumbnail-mismatch')).toBeUndefined();
  });
  it('finds data hidden after the end of the picture', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, trailing: Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(300, 1)]) }), 'a.jpg');
    expect(flag(r, 'appended-data')?.detail).toMatch(/ZIP/);
    expect(fact(r, 'Data after the end of the picture')!.importance).toBe(3);
  });
  it('recognises editing software and Photoshop blocks', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, software: 'Adobe Photoshop 25.0 (Macintosh)', photoshop: true }), 'a.jpg');
    expect(flag(r, 'edited-software')).toBeTruthy(); expect(flag(r, 'photoshop-block')).toBeTruthy();
    expect(fact(r, 'Software')!.importance).toBe(3);
  });
  it('flags a last-changed date that differs from the capture date', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, dateTime: '2024:06:01 09:00:00' }), 'a.jpg');
    expect(fact(r, 'Last changed')!.importance).toBe(2);
  });
  it('flags a modification time before the photo was taken', async () => {
    const r = await analyzeFile(buildExifJpeg({ ...base, dateTime: '2023:01:01 09:00:00' }), 'a.jpg');
    expect(flag(r, 'mod-before-capture')?.severity).toBe('warning');
  });
  it('says plainly when a file has no camera data, and does not read anything into it', async () => {
    const r = await analyzeFile(bareJpeg(800, 600, 60), 'x.jpg');
    expect(flag(r, 'no-metadata')?.severity).toBe('info'); expect(flag(r, 'no-metadata')!.detail).toMatch(/tells you nothing/);
    expect(r.location).toBeUndefined();
  });
  it('reads dates and origin from the file name', async () => {
    expect(dateFromName('IMG_20240503_142210.jpg')).toMatchObject({ iso: '2024-05-03T14:22:10', precision: 'second' });
    expect(dateFromName('IMG-20240503-WA0012.jpg')).toMatchObject({ iso: '2024-05-03T00:00:00', precision: 'day' });
    expect(dateFromName('Screenshot_2024-05-03-14-22-10.png')?.iso).toBe('2024-05-03T14:22:10');
    expect(dateFromName('photo.jpg')).toBeNull(); expect(dateFromName('IMG_99999999_999999.jpg')).toBeNull();
    expect(originFromName('IMG-20240503-WA0012.jpg')).toMatch(/WhatsApp/); expect(originFromName('Screenshot 2024.png')).toMatch(/screenshot/);
    const r = await analyzeFile(buildExifJpeg({ ...base, dateTimeOriginal: '2023:01:01 10:00:00' }), 'IMG_20240503_142210.jpg');
    expect(flag(r, 'name-vs-time')).toBeTruthy();
  });
  it('reports the browser-supplied modified time and notices when it predates the photo', async () => {
    const r = await analyzeFile(buildExifJpeg(base), 'a.jpg', { lastModified: Date.UTC(2020, 0, 1) });
    expect(flag(r, 'disk-before-capture')).toBeTruthy();
  });
  it('estimates JPEG quality from the quantisation table', () => {
    for (const q of [50, 75, 90, 95]) { const j = parseJpeg(bareJpeg(10, 10, q))!; expect(j.quality!.value).toBe(q); expect(j.quality!.exact).toBe(true); }
    expect(jpegQuality(new Array(64).fill(7)).exact).toBe(false);
  });
  it('never throws on damaged or truncated files', async () => {
    const good = buildExifJpeg(base);
    for (const cut of [2, 3, 10, 40, 120, good.length - 5]) await expect(analyzeFile(good.subarray(0, cut), 'x.jpg')).resolves.toBeTruthy();
    await expect(analyzeFile(Buffer.alloc(0), 'empty')).resolves.toBeTruthy();
    await expect(analyzeFile(Buffer.from('\xff\xd8\xff\xe1\x00\x08Exif\0\0'), 'x.jpg')).resolves.toBeTruthy();
  });
});

describe('PNG and AI-made images', () => {
  it('reads Stable Diffusion settings and calls the image AI-made', async () => {
    const p = 'a castle on a hill, golden hour\nNegative prompt: blurry\nSteps: 28, Sampler: DPM++ 2M, CFG scale: 7, Seed: 1234567, Size: 512x768, Model hash: abc123def4, Model: dreamshaper_8, Version: v1.8.0';
    const r = await analyzeFile(buildPng({ parameters: p }), 'out.png');
    expect(flag(r, 'ai-generated')?.severity).toBe('warning');
    expect(fact(r, 'Made by AI')!.value).toMatch(/Stable Diffusion/);
    expect(fact(r, 'AI setting: Seed')!.value).toBe('1234567'); expect(fact(r, 'AI prompt')!.value).toMatch(/castle/);
  });
  it('identifies ComfyUI and NovelAI, and ignores ordinary PNGs', () => {
    expect(detectAiPng({ prompt: '{"3":{"class_type":"KSampler"}}', workflow: '{}' })?.tool).toBe('ComfyUI');
    expect(detectAiPng({ Software: 'NovelAI' })?.tool).toBe('NovelAI');
    expect(detectAiPng({ Software: 'Photoshop' })).toBeUndefined();
  });
  it('reads PNG time and text, and finds appended data', async () => {
    const r = await analyzeFile(buildPng({ Author: 'Mara Linden', Software: 'GIMP' }, { time: true, trailing: Buffer.concat([Buffer.from('Rar!'), Buffer.alloc(64)]) }), 'a.png');
    expect(fact(r, 'PNG saved')!.value).toBe('2024-05-03 14:22:10Z');
    expect(fact(r, 'PNG text: Author')!.value).toBe('Mara Linden');
    expect(flag(r, 'appended-data')?.detail).toMatch(/PNG end marker/);
  });
});

describe('video', () => {
  it('reads time with timezone, location, device and the editor from an iPhone-style clip', async () => {
    const mp4 = buildMp4({ created: Date.UTC(2024, 4, 3, 12, 22, 10), modified: Date.UTC(2024, 4, 3, 12, 25, 0), gps: '+48.8584+002.2945+035.000/', make: 'Apple', model: 'iPhone 15 Pro', software: '17.4.1', creationdate: '2024-05-03T14:22:10+0200' });
    const r = await analyzeFile(mp4, 'IMG_0042.MOV');
    expect(r.kind).toBe('mp4');
    expect(r.location).toMatchObject({ lat: 48.8584, lon: 2.2945 });
    expect(fact(r, 'Recorded')!.value).toMatch(/2024-05-03 14:22:10.*UTC\+02:00/);
    expect(r.tz?.offsetMin).toBe(120);
    expect(fact(r, 'Camera')!.value).toBe('Apple iPhone 15 Pro');
    expect(fact(r, 'Size')!.value).toMatch(/1920 × 1080/);
    expect(fact(r, 'Length')!.value).toBe('0:10');
    expect(r.device?.make).toBe('Apple');
  });
  it('notes a cleared creation time and a header that says it changed before it existed', async () => {
    expect(flag(await analyzeFile(buildMp4({}), 'a.mp4'), 'no-created')).toBeTruthy();
    expect(flag(await analyzeFile(buildMp4({ created: Date.UTC(2024, 4, 3, 12), modified: Date.UTC(2024, 4, 3, 11) }), 'a.mp4'), 'mod-before-create')?.severity).toBe('warning');
  });
  it('recognises a clip re-encoded by an editor, and Android metadata', async () => {
    const r = await analyzeFile(buildMp4({ created: Date.UTC(2024, 4, 3, 12), software: 'Lavf60.3.100', androidVersion: '14' }), 'a.mp4');
    expect(flag(r, 'edited-software')).toBeTruthy(); expect(fact(r, 'Android version')!.value).toBe('14');
  });
  it('parses ISO 6709 positions and rejects nonsense', () => {
    expect(parseIso6709('+37.7749-122.4194/')).toMatchObject({ lat: 37.7749, lon: -122.4194 });
    expect(parseIso6709('+00.0000+000.0000/')).toBeNull(); expect(parseIso6709('+95.0+010.0/')).toBeNull(); expect(parseIso6709('hello')).toBeNull();
    expect(parseMp4(Buffer.from('definitely not a video file at all'))).toBeNull();
  });
});

describe('PDF', () => {
  it('reads author, tools and dates, and flags edits, mixed producers and scripts', async () => {
    const r = await analyzeFile(buildPdf({ author: 'Mara Linden', creator: 'Microsoft Word', producer: 'Adobe PDF Library 15.0', created: "D:20240503142210+02'00'", modified: "D:20240601090000Z", revisions: 3, js: true, link: 'https://tracker.example/x' }), 'contract.pdf');
    expect(fact(r, 'Author')!.value).toBe('Mara Linden'); expect(fact(r, 'Author')!.importance).toBe(3);
    expect(fact(r, 'Created')!.value).toMatch(/2024-05-03 14:22:10\+02:00/);
    expect(r.tz?.offsetMin).toBe(120);
    expect(flag(r, 'pdf-revisions')!.title).toMatch(/3 times/);
    expect(flag(r, 'pdf-active')?.severity).toBe('warning');
    expect(r.leaks.some((l) => l.value === 'https://tracker.example/x')).toBe(true);
    expect(r.entities.some((e) => e.type === 'person' && e.value === 'Mara Linden')).toBe(true);
  });
  it('parses PDF dates and hex strings', () => {
    expect(pdfDate("D:20240503142210+02'00'")).toBe('2024-05-03T14:22:10+02:00'); expect(pdfDate('D:2024')).toBe('2024-01-01T00:00:00');
    const p = parsePdf(Buffer.from('%PDF-1.4\n<< /Author <FEFF004D00610072006100> /Title <FEFF004D00> >>\n%%EOF'))!;
    expect(p.info.Author[0]).toBe('Mara'); expect(p.info.Title).toBeDefined();   // odd-length hex does not throw
  });
});

describe('Office documents', () => {
  it('shows who made and last saved it, tracked-change authors, company and external links', async () => {
    const r = await analyzeFile(buildDocx({ creator: 'Mara Linden', lastModifiedBy: 'Dev Patel', created: '2024-05-03T12:22:10Z', modified: '2024-05-04T08:00:00Z', company: 'Northwind Labs', trackedBy: 'Priya Rao', link: '\\\\FILESRV01\\finance\\q3.xlsx', macro: true, body: 'see C:\\Users\\mlinden\\Desktop\\draft.docx and mara@northwind.example' }), 'report.docx');
    expect(r.kind).toBe('zip');
    expect(fact(r, 'Created by')!.value).toBe('Mara Linden');
    expect(fact(r, 'Last saved by')!.importance).toBe(3);                                       // a different person saved it last
    expect(fact(r, 'People with tracked changes')!.value).toBe('Priya Rao');
    expect(fact(r, 'Organisation')!.value).toBe('Northwind Labs');
    expect(flag(r, 'macros')?.severity).toBe('warning'); expect(flag(r, 'tracked-changes')).toBeTruthy();
    expect(r.leaks.some((l) => l.kind === 'host' && l.value.includes('FILESRV01'))).toBe(true);
    expect(fact(r, 'Computer user name')!.value).toBe('mlinden');
    expect(r.entities.some((e) => e.type === 'username' && e.value === 'mlinden')).toBe(true);
    expect(r.entities.some((e) => e.type === 'email' && e.value === 'mara@northwind.example')).toBe(true);
    expect(r.entities.some((e) => e.type === 'org' && e.value === 'Northwind Labs')).toBe(true);
  });
  it('reads plain zips and refuses to be fooled by bad central directories', async () => {
    const z = buildZip({ 'a/b.txt': 'hi', 'c.txt': 'yo' }, 'packed by mara');
    const r = await analyzeFile(z, 'x.zip'); expect(fact(r, 'Files inside')!.value).toBe('2'); expect(fact(r, 'Archive comment')!.value).toBe('packed by mara');
    expect(readZip(z)!.read('a/b.txt')!.toString()).toBe('hi');
    expect(readZip(Buffer.from('PK\x03\x04 junk junk junk junk'))).toBeNull();
    await expect(analyzeFile(Buffer.concat([z.subarray(0, 40), Buffer.alloc(40)]), 'x.zip')).resolves.toBeTruthy();
  });
});

describe('programs and strings', () => {
  it('shows the compile time and the build path, which leaks the developer account', async () => {
    const r = await analyzeFile(buildPe({ compiled: Date.UTC(2023, 8, 14, 7, 30), pdb: 'C:\\Users\\jsmith\\source\\repos\\Loader\\x64\\Release\\Loader.pdb', company: 'Acme Utilities' }), 'setup.exe');
    expect(fact(r, 'Compiled')!.value).toMatch(/2023-09-14 07:30:00/);
    expect(fact(r, 'Build path')!.importance).toBe(3);
    expect(fact(r, 'Computer user name')!.value).toBe('jsmith');
    expect(r.entities.some((e) => e.type === 'username' && e.value === 'jsmith')).toBe(true);
    expect(fact(r, 'Company Name')!.value).toBe('Acme Utilities');
    expect(flag(r, 'executable')).toBeTruthy();
  });
  it('finds paths, emails and secrets, masks the secrets, and skips boilerplate', () => {
    const text = `C:\\Users\\Public\\x.dll C:\\Users\\kowalski\\AppData /Users/mara/Library /home/deploy/app mail bob@corp.example icon@2x.png http://www.w3.org/1999/xhtml https://github.com/torvalds key AKIAIOSFODNN7EXAMPLE token ghp_${'a'.repeat(36)} 00:1A:2B:3C:4D:5E`;
    const l = scanText(text, { documentLike: true });
    expect(l.find((x) => x.kind === 'user-path' && x.value === 'kowalski')!.interesting).toBe(true);
    expect(l.find((x) => x.kind === 'user-path' && x.value === 'Public')!.interesting).toBe(false);
    expect(l.some((x) => x.kind === 'user-path' && x.value === 'mara')).toBe(true);
    expect(l.some((x) => x.kind === 'email' && x.value === 'bob@corp.example')).toBe(true);
    expect(l.some((x) => x.value.includes('icon@2x'))).toBe(false); expect(l.some((x) => /w3\.org/.test(x.value))).toBe(false);
    expect(l.some((x) => x.kind === 'url' && x.value === 'https://github.com/torvalds')).toBe(true);
    const sec = l.filter((x) => x.kind === 'secret'); expect(sec.length).toBe(2);
    expect(sec.every((s) => !s.value.includes('IOSFODNN7EXAMPLE') && !s.value.includes('a'.repeat(12)))).toBe(true);
    expect(l.some((x) => x.kind === 'mac' && x.value === '00:1A:2B:3C:4D:5E')).toBe(true);
  });
  it('identifies file types by content, not by name', () => {
    expect(sniff(buildExifJpeg({}), 'notes.txt').kind).toBe('jpeg');
    expect(sniff(buildPdf({}), 'photo.jpg').kind).toBe('pdf');
    expect(sniff(Buffer.from('hello world\n'), 'a.bin').kind).toBe('text');
    expect(sniff(Buffer.from([0, 1, 2, 3, 250, 251, 0, 0, 9, 9]), 'a.bin').kind).toBe('unknown');
  });
  it('never throws on random bytes', async () => {
    let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) & 255;
    for (let i = 0; i < 40; i++) { const b = Buffer.from(Array.from({ length: 50 + i * 37 }, rnd)); await expect(analyzeFile(b, 'junk.bin')).resolves.toBeTruthy(); }
    for (const head of ['\xff\xd8\xff', '\x89PNG\r\n\x1a\n', 'GIF89a', '%PDF-', 'PK\x03\x04', 'MZ', '\x00\x00\x00\x18ftypqt  ', 'ID3\x03', 'fLaC', 'RIFF\x00\x00\x00\x00WAVE'])
      for (let i = 0; i < 10; i++) await expect(analyzeFile(Buffer.concat([Buffer.from(head, 'latin1'), Buffer.from(Array.from({ length: 200 }, rnd))]), 'x')).resolves.toBeTruthy();
  });
});
