import { inflateSync } from 'node:zlib';
import { latin1, find, type Bytes } from './bytes';

export interface PdfInfo {
  version: string; pages: number; revisions: number; encrypted: boolean;
  info: Record<string, string[]>;              // every value seen per key, oldest first: an edited file often shows two producers
  xmp: Record<string, string>;
  hasJavascript: boolean; hasOpenAction: boolean; hasLaunch: boolean; embeddedFiles: number; links: string[];
  trailing: number;
}

function pdfString(raw: string): string {
  if (raw.startsWith('<')) {
    const h = raw.slice(1, -1).replace(/\s+/g, ''); const bytes = Buffer.from(h.length % 2 ? h + '0' : h, 'hex');
    if (bytes[0] === 0xfe && bytes[1] === 0xff) { const body = bytes.subarray(2, 2 + ((bytes.length - 2) & ~1)); return Buffer.from(body).swap16().toString('utf16le'); }
    return bytes.toString('latin1');
  }
  const body = raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, c: string) => {
    if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8)); if (/^\r?\n$/.test(c)) return '';
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[c] ?? c;
  });
  if (body.startsWith('\xfe\xff')) { const raw = Buffer.from(body.slice(2), 'latin1'); return Buffer.from(raw.subarray(0, raw.length & ~1)).swap16().toString('utf16le'); }
  return body;
}

/** "D:20240131154501+02'00'" → ISO with offset. */
export function pdfDate(s: string): string | undefined {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{0,2}'?)?/.exec(s.trim());
  if (!m) return undefined;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', z = ''] = m;
  let off = 'Z'; const zm = /^([+-])(\d{2})'?(\d{2})?/.exec(z); if (zm) off = `${zm[1]}${zm[2]}:${zm[3] ?? '00'}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}${z ? off : ''}`;
}

const KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];

export function parsePdf(b: Bytes): PdfInfo | null {
  if (latin1(b.subarray(0, 1024)).indexOf('%PDF-') < 0) return null;
  const head = latin1(b.subarray(0, 1024)); const version = /%PDF-(\d\.\d)/.exec(head)?.[1] ?? '';
  let text = latin1(b.length > 60_000_000 ? b.subarray(0, 60_000_000) : b);
  // Modern PDFs pack objects into compressed streams. Inflate them (bounded) so the Info dictionary is still readable.
  let inflated = '';
  if (/\/ObjStm|\/Type\s*\/XRef/.test(text)) {
    let budget = 40_000_000;
    for (const m of text.matchAll(/stream\r?\n/g)) {
      if (budget <= 0) break;
      const s = (m.index ?? 0) + m[0].length, e = text.indexOf('endstream', s); if (e < 0) continue;
      try { const out = inflateSync(Buffer.from(b.subarray(s, e)), { maxOutputLength: 8_000_000 }); budget -= out.length; const t = out.toString('latin1'); if (/\/Producer|\/Author|\/CreationDate|\/Creator|\/Title/.test(t)) inflated += '\n' + t; } catch { /* not a flate stream */ }
    }
  }
  const all = text + inflated;
  const info: Record<string, string[]> = {};
  for (const k of KEYS) {
    const re = new RegExp(`/${k}\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)`, 'g');
    for (const m of all.matchAll(re)) { const v = pdfString(m[1]).trim(); if (v && !(info[k] ??= []).includes(v)) info[k].push(v.slice(0, 400)); }
  }
  const xmp: Record<string, string> = {};
  const xi = all.indexOf('<x:xmpmeta');
  if (xi >= 0) {
    const x = all.slice(xi, all.indexOf('</x:xmpmeta>', xi) + 12 || xi + 60000);
    for (const [k, re] of Object.entries({ creatorTool: /<xmp:CreatorTool>([^<]*)</, producer: /<pdf:Producer>([^<]*)</, created: /<xmp:CreateDate>([^<]*)</, modified: /<xmp:ModifyDate>([^<]*)</, metadataDate: /<xmp:MetadataDate>([^<]*)</, creator: /<dc:creator>[\s\S]*?<rdf:li[^>]*>([^<]*)</, title: /<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)</, documentId: /<xmpMM:DocumentID>([^<]*)</, instanceId: /<xmpMM:InstanceID>([^<]*)</ }))
      { const m = re.exec(x); if (m?.[1]) xmp[k] = m[1].trim(); }
  }
  const links = [...new Set([...all.matchAll(/\/URI\s*\(((?:\\.|[^\\)])*)\)/g)].map((m) => pdfString(`(${m[1]})`)).filter((u) => /^https?:|^mailto:|^file:/i.test(u)))].slice(0, 40);
  const eofs = (text.match(/%%EOF/g) ?? []).length;
  const lastEof = text.lastIndexOf('%%EOF');
  return {
    version, pages: Math.max((all.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length, 0), revisions: Math.max(1, eofs), encrypted: /\/Encrypt\s/.test(text),
    info, xmp, hasJavascript: /\/JavaScript|\/JS\s*[(<]/.test(all), hasOpenAction: /\/OpenAction/.test(all), hasLaunch: /\/Launch/.test(all),
    embeddedFiles: (all.match(/\/Type\s*\/EmbeddedFile/g) ?? []).length, links,
    trailing: lastEof >= 0 ? Math.max(0, text.length - (lastEof + 5)) : 0,
  };
}
void find;
