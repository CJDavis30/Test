import { readZip, type Zip } from './zip';
import type { Bytes } from './bytes';

export interface OfficeInfo {
  format: 'docx' | 'xlsx' | 'pptx' | 'odf' | 'ooxml';
  props: Record<string, string>;          // creator, lastModifiedBy, created, modified, revision, application, company …
  custom: Record<string, string>;
  trackedAuthors: string[]; commentAuthors: string[];
  externalLinks: string[];                // hyperlinks and linked files; \\server\share paths leak machine names
  media: number; macros: boolean; hiddenSheets: string[]; template?: string; parts: number;
}

const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml: string, name: string) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml); return m ? dec(m[1]).trim() : undefined; };

export function parseOffice(b: Bytes, zip?: Zip | null): OfficeInfo | null {
  const z = zip ?? readZip(b); if (!z) return null;
  const names = z.entries.map((e) => e.name);
  const has = (p: string) => names.some((n) => n.startsWith(p));
  const format: OfficeInfo['format'] | null = has('word/') ? 'docx' : has('xl/') ? 'xlsx' : has('ppt/') ? 'pptx' : names.includes('meta.xml') && names.includes('mimetype') ? 'odf' : has('docProps/') || names.includes('[Content_Types].xml') ? 'ooxml' : null;
  if (!format) return null;
  const out: OfficeInfo = { format, props: {}, custom: {}, trackedAuthors: [], commentAuthors: [], externalLinks: [], media: names.filter((n) => /\/media\//.test(n)).length, macros: names.some((n) => /vbaProject\.bin$/i.test(n)), hiddenSheets: [], parts: names.length };
  const text = (n: string) => z.read(n)?.toString('utf8') ?? '';
  if (format === 'odf') {
    const m = text('meta.xml');
    for (const [k, t] of Object.entries({ creator: 'dc:creator', initialCreator: 'meta:initial-creator', created: 'meta:creation-date', modified: 'dc:date', generator: 'meta:generator', title: 'dc:title', subject: 'dc:subject', editingDuration: 'meta:editing-duration', editingCycles: 'meta:editing-cycles', language: 'dc:language' })) { const v = tag(m, t); if (v) out.props[k] = v; }
    return out;
  }
  const core = text('docProps/core.xml'), app = text('docProps/app.xml');
  for (const [k, t] of Object.entries({ creator: 'dc:creator', lastModifiedBy: 'cp:lastModifiedBy', created: 'dcterms:created', modified: 'dcterms:modified', lastPrinted: 'cp:lastPrinted', revision: 'cp:revision', title: 'dc:title', subject: 'dc:subject', keywords: 'cp:keywords', description: 'dc:description', category: 'cp:category' })) { const v = tag(core, t); if (v) out.props[k] = v; }
  for (const [k, t] of Object.entries({ application: 'Application', appVersion: 'AppVersion', company: 'Company', manager: 'Manager', totalTime: 'TotalTime', pages: 'Pages', words: 'Words', characters: 'Characters', template: 'Template' })) { const v = tag(app, t); if (v) out.props[k] = v; }
  const custom = text('docProps/custom.xml');
  for (const m of custom.matchAll(/<property[^>]*\sname="([^"]+)"[^>]*>([\s\S]*?)<\/property>/g)) { const v = dec(m[2].replace(/<[^>]+>/g, '')).trim(); if (v) out.custom[dec(m[1])] = v.slice(0, 300); }
  if (format === 'docx') {
    const doc = text('word/document.xml');
    out.trackedAuthors = [...new Set([...doc.matchAll(/<w:(?:ins|del|moveFrom|moveTo)\s[^>]*w:author="([^"]*)"/g)].map((m) => dec(m[1])))].slice(0, 20);
    out.commentAuthors = [...new Set([...text('word/comments.xml').matchAll(/w:author="([^"]*)"/g)].map((m) => dec(m[1])))].slice(0, 20);
  }
  if (format === 'xlsx') out.hiddenSheets = [...text('xl/workbook.xml').matchAll(/<sheet\s[^>]*name="([^"]*)"[^>]*state="(?:hidden|veryHidden)"/g)].map((m) => dec(m[1]));
  const ext = new Set<string>();
  for (const n of names.filter((n) => /\.rels$/.test(n))) for (const m of text(n).matchAll(/Target="([^"]+)"[^>]*TargetMode="External"|TargetMode="External"[^>]*Target="([^"]+)"/g)) ext.add(dec(m[1] ?? m[2]));
  out.externalLinks = [...ext].filter((u) => !/^https?:\/\/(schemas\.|www\.w3\.org|purl\.org)/.test(u)).slice(0, 40);
  return out;
}
