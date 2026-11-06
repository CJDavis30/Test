/**
 * What an ordinary web page says about its owner, read without a browser: its title and description, who it links to (a profile
 * page links to the person's other profiles), mail addresses and the follower counts that some sites put in their share tags.
 * Pure, so it is testable on saved pages. Everything here is the page's own statement.
 */
export interface PageFacts {
  title?: string; description?: string; image?: string; siteName?: string; canonical?: string;
  /** visible text, trimmed: where bios and "contact me" lines live */
  text: string;
  links: { href: string; rel: string; label: string }[];
  mailto: string[];
  followers?: number; following?: number; posts?: number;
  /** the site said the page does not exist / is private */
  missing: boolean;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#8217': '’', '#8211': '–', '#8212': '—' };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => { const k = e.toLowerCase(); if (ENT[k] !== undefined) return ENT[k]; if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32); if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10) || 32); return m; });
const attr = (tag: string, name: string) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : undefined; };
const num = (s: string) => { const m = /([\d.,]+)\s*([KkMm])?/.exec(s); if (!m) return undefined; const n = parseFloat(m[1].replace(/,/g, '')); if (!Number.isFinite(n)) return undefined; return Math.round(n * (/k/i.test(m[2] ?? '') ? 1e3 : /m/i.test(m[2] ?? '') ? 1e6 : 1)); };

export function readPage(html: string, baseUrl?: string): PageFacts {
  const src = html.slice(0, 600_000);
  const meta = new Map<string, string>();
  for (const m of src.matchAll(/<meta\b[^>]*>/gi)) { const k = (attr(m[0], 'property') ?? attr(m[0], 'name'))?.toLowerCase(), v = attr(m[0], 'content'); if (k && v && !meta.has(k)) meta.set(k, v); }
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1] ?? '').replace(/\s+/g, ' ').trim());
  const links: PageFacts['links'] = [], mailto = new Set<string>();
  const abs = (h: string) => { try { return new URL(h, baseUrl).toString(); } catch { return undefined; } };
  for (const m of src.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>|<link\b[^>]*>/gi)) {
    const href = attr(m[0], 'href'); if (!href) continue;
    if (/^mailto:/i.test(href)) { const e = decodeURIComponent(href.slice(7).split('?')[0]).trim(); if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) mailto.add(e.toLowerCase()); continue; }
    const full = /^https?:\/\//i.test(href) ? href : abs(href); if (!full || !/^https?:/i.test(full)) continue;
    const rel = (attr(m[0], 'rel') ?? '').toLowerCase();
    links.push({ href: full, rel, label: decode((m[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 80) });
  }
  const text = decode(src.replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 4000);
  const description = meta.get('og:description') ?? meta.get('description') ?? meta.get('twitter:description');
  // "1,234 Followers, 56 Following, 78 Posts" (Instagram and similar share text)
  const share = `${description ?? ''} ${meta.get('og:title') ?? ''}`;
  const f = /([\d.,]+[KkMm]?)\s+Followers/i.exec(share), g = /([\d.,]+[KkMm]?)\s+Following/i.exec(share), p = /([\d.,]+[KkMm]?)\s+(?:Posts|Videos|Tweets)/i.exec(share);
  const missing = /\b(page|profile|user|account|channel)\b[^.]{0,30}\b(not found|doesn['’]?t exist|does not exist|unavailable|has been (suspended|deleted)|no longer available)\b|\b404\b[^.]{0,20}(not found|error)|this account (doesn['’]?t exist|is suspended)|sorry, this page/i.test(`${title} ${text.slice(0, 600)}`);
  return {
    title: title || meta.get('og:title'), description: description ? decode(description).replace(/\s+/g, ' ').trim().slice(0, 500) : undefined, image: meta.get('og:image') ?? meta.get('twitter:image'),
    siteName: meta.get('og:site_name'), canonical: abs(/<link\b[^>]*rel=["']canonical["'][^>]*>/i.exec(src)?.[0] ? attr(/<link\b[^>]*rel=["']canonical["'][^>]*>/i.exec(src)![0], 'href') ?? '' : ''),
    text, links: links.slice(0, 400), mailto: [...mailto].slice(0, 10), followers: f ? num(f[1]) : undefined, following: g ? num(g[1]) : undefined, posts: p ? num(p[1]) : undefined, missing,
  };
}
