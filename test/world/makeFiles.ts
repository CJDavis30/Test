import { deflateSync, crc32 } from 'node:zlib';

/** Builders for small real files used by tests: zip/OOXML, MP4, PNG, PDF, Windows PE. */
export function buildZip(files: Record<string, string>, comment = ''): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8'), comp = deflateSync(data).subarray(2, -4), nb = Buffer.from(name);
    const crc = crc32(data) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0x6000, 10); lh.writeUInt16LE(0x5821, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0x6000, 12); ch.writeUInt16LE(0x5821, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, comp); central.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), cb = Buffer.from(comment);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16); end.writeUInt16LE(cb.length, 20);
  return Buffer.concat([...parts, cd, end, cb]);
}

export function buildDocx(o: { creator?: string; lastModifiedBy?: string; created?: string; modified?: string; company?: string; application?: string; revision?: string; trackedBy?: string; link?: string; macro?: boolean; body?: string }): Buffer {
  const core = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y" xmlns:dcterms="z">${o.creator ? `<dc:creator>${o.creator}</dc:creator>` : ''}${o.lastModifiedBy ? `<cp:lastModifiedBy>${o.lastModifiedBy}</cp:lastModifiedBy>` : ''}${o.revision ? `<cp:revision>${o.revision}</cp:revision>` : ''}${o.created ? `<dcterms:created xsi:type="dcterms:W3CDTF">${o.created}</dcterms:created>` : ''}${o.modified ? `<dcterms:modified xsi:type="dcterms:W3CDTF">${o.modified}</dcterms:modified>` : ''}</cp:coreProperties>`;
  const app = `<Properties><Application>${o.application ?? 'Microsoft Office Word'}</Application>${o.company ? `<Company>${o.company}</Company>` : ''}</Properties>`;
  const doc = `<w:document><w:body>${o.trackedBy ? `<w:ins w:id="1" w:author="${o.trackedBy}"><w:r><w:t>added</w:t></w:r></w:ins>` : ''}<w:p><w:t>${o.body ?? 'Hello'}</w:t></w:p></w:body></w:document>`;
  const rels = o.link ? `<Relationships><Relationship Id="r1" Type="hyperlink" Target="${o.link}" TargetMode="External"/></Relationships>` : '<Relationships/>';
  return buildZip({ '[Content_Types].xml': '<Types/>', 'docProps/core.xml': core, 'docProps/app.xml': app, 'word/document.xml': doc, 'word/_rels/document.xml.rels': rels, ...(o.macro ? { 'word/vbaProject.bin': 'x' } : {}) });
}

const box = (type: string, ...payload: Buffer[]) => { const body = Buffer.concat(payload); const h = Buffer.alloc(8); h.writeUInt32BE(body.length + 8, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

export function buildMp4(o: { created?: number; modified?: number; gps?: string; make?: string; model?: string; software?: string; creationdate?: string; width?: number; height?: number; durationSec?: number; androidVersion?: string }): Buffer {
  const E1904 = 2082844800;
  const mvhd = box('mvhd', Buffer.concat([u32(0), u32(o.created ? o.created / 1000 + E1904 : 0), u32(o.modified ? o.modified / 1000 + E1904 : 0), u32(1000), u32((o.durationSec ?? 10) * 1000), Buffer.alloc(80)]));
  const matrix = Buffer.alloc(36); matrix.writeInt32BE(0x10000, 0); matrix.writeInt32BE(0x10000, 16); matrix.writeInt32BE(0x40000000, 32);
  const tkhd = box('tkhd', Buffer.concat([u32(0x0f), u32(0), u32(0), u32(1), u32(0), u32(1000), Buffer.alloc(8), Buffer.alloc(8), matrix, u32((o.width ?? 1920) * 65536), u32((o.height ?? 1080) * 65536)]));
  const hdlr = box('hdlr', Buffer.concat([u32(0), u32(0), Buffer.from('vide'), Buffer.alloc(12), Buffer.from('VideoHandle\0')]));
  const mdhd = box('mdhd', Buffer.concat([u32(0), u32(0), u32(0), u32(30000), u32(300000), Buffer.from([0x55, 0xc4, 0, 0])]));
  const stsd = box('stsd', Buffer.concat([u32(0), u32(1), box('avc1', Buffer.alloc(78))]));
  const stts = box('stts', Buffer.concat([u32(0), u32(1), u32(300), u32(1000)]));
  const trak = box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', box('stbl', stsd, stts))));
  const kv: [string, string][] = [];
  if (o.make) kv.push(['com.apple.quicktime.make', o.make]); if (o.model) kv.push(['com.apple.quicktime.model', o.model]); if (o.software) kv.push(['com.apple.quicktime.software', o.software]);
  if (o.creationdate) kv.push(['com.apple.quicktime.creationdate', o.creationdate]); if (o.gps) kv.push(['com.apple.quicktime.location.ISO6709', o.gps]); if (o.androidVersion) kv.push(['com.android.version', o.androidVersion]);
  const keys = box('keys', u32(0), u32(kv.length), ...kv.map(([k]) => box('mdta', Buffer.from(k))));
  const ilst = box('ilst', ...kv.map(([, v], i) => { const idx = Buffer.alloc(8); idx.writeUInt32BE(v.length + 24 + 8 - 8, 0); const d = box('data', u32(1), u32(0), Buffer.from(v)); const h = Buffer.alloc(8); h.writeUInt32BE(8 + d.length, 0); h.writeUInt32BE(i + 1, 4); return Buffer.concat([h, d]); }));
  const meta = box('meta', u32(0), box('hdlr', Buffer.concat([u32(0), u32(0), Buffer.from('mdta'), Buffer.alloc(12)])), keys, ilst);
  const xyz = o.gps ? box('\u00a9xyz', Buffer.concat([Buffer.from([0, o.gps.length, 0x15, 0xc7]), Buffer.from(o.gps)])) : Buffer.alloc(0);
  const moov = box('moov', mvhd, trak, box('udta', xyz), kv.length ? meta : Buffer.alloc(0));
  return Buffer.concat([box('ftyp', Buffer.from('qt  '), u32(0), Buffer.from('qt  ')), moov, box('mdat', Buffer.alloc(64))]);
}

function crcPng(b: Buffer) { return crc32(b) >>> 0; }
export function buildPng(text: Record<string, string> = {}, o: { trailing?: Buffer; time?: boolean } = {}): Buffer {
  const chunk = (type: string, data: Buffer) => { const t = Buffer.concat([Buffer.from(type), data]); const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crcPng(t)); return Buffer.concat([l, t, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(512, 0); ihdr.writeUInt32BE(768, 4); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  for (const [k, v] of Object.entries(text)) parts.push(chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'latin1')])));
  if (o.time) parts.push(chunk('tIME', Buffer.from([0x07, 0xe8, 5, 3, 14, 22, 10])));
  parts.push(chunk('IDAT', deflateSync(Buffer.alloc(16))), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([...parts, ...(o.trailing ? [o.trailing] : [])]);
}

export function buildPdf(o: { author?: string; creator?: string; producer?: string; created?: string; modified?: string; revisions?: number; js?: boolean; link?: string }): Buffer {
  const info = `<< ${o.author ? `/Author (${o.author})` : ''} ${o.creator ? `/Creator (${o.creator})` : ''} ${o.producer ? `/Producer (${o.producer})` : ''} ${o.created ? `/CreationDate (${o.created})` : ''} ${o.modified ? `/ModDate (${o.modified})` : ''} >>`;
  let s = `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${o.js ? '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>' : ''} >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R ${o.link ? `/Annots [<< /Subtype /Link /A << /S /URI /URI (${o.link}) >> >>]` : ''} >>\nendobj\n4 0 obj\n${info}\nendobj\ntrailer\n<< /Info 4 0 R /Root 1 0 R >>\nstartxref\n0\n%%EOF\n`;
  for (let i = 1; i < (o.revisions ?? 1); i++) s += `5 0 obj\n<< >>\nendobj\ntrailer\n<< /Prev 0 >>\nstartxref\n0\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}

export function buildPe(o: { compiled?: number; pdb?: string; company?: string }): Buffer {
  const b = Buffer.alloc(0x400); b.write('MZ', 0); b.writeUInt32LE(0x80, 0x3c); b.write('PE\0\0', 0x80, 'latin1'); b.writeUInt16LE(0x8664, 0x84); b.writeUInt16LE(3, 0x86); b.writeUInt32LE(Math.floor((o.compiled ?? 0) / 1000), 0x88); b.writeUInt16LE(0xf0, 0x94);
  b.writeUInt16LE(0x20b, 0x98); b.writeUInt16LE(3, 0x98 + 68);
  let tail = Buffer.alloc(0);
  if (o.pdb) tail = Buffer.concat([tail, Buffer.from('RSDS'), Buffer.alloc(20), Buffer.from(o.pdb + '\0')]);
  if (o.company) tail = Buffer.concat([tail, Buffer.from('CompanyName', 'utf16le'), Buffer.alloc(2), Buffer.from(o.company, 'utf16le'), Buffer.alloc(4)]);
  return Buffer.concat([b, tail]);
}
