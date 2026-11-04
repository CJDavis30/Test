import { createHash } from 'node:crypto';
import { extractEntities } from '../../../shared/detect';
import type { Claim, EntityType } from '../../../shared/types';
import { RateLimitedError, type Adapter, type AdapterCtx } from '../types';

export const md5 = (s: string) => createHash('md5').update(s).digest('hex');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const iso = (d: unknown): string | undefined => {
  if (d === undefined || d === null || d === '') return undefined;
  const t = typeof d === 'number' ? new Date(d < 1e12 ? d * 1000 : d) : new Date(String(d));
  return isNaN(+t) ? undefined : t.toISOString().slice(0, 10);
};

/**
 * GET JSON. Returns null for 404 (a clean "nothing there"), throws RateLimitedError for 429 and for
 * 403s that look like quota exhaustion, throws for other non-2xx statuses.
 */
export async function getJson<T = any>(ctx: AdapterCtx, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T | null> {
  const res = await ctx.fetch(url, init);
  if (res.status === 404 || res.status === 410) return null;
  if (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || /rate|quota|limit/i.test(await res.clone().text().catch(() => '')))) throw new RateLimitedError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text) as T; } catch { throw new Error('Unexpected non-JSON response'); }
}

export const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Claims for contact details hiding in free-text bios ("reach me at…", links). */
export function bioClaims(text: string | undefined, where: string, url?: string): Claim[] {
  const t = str(text);
  if (!t) return [];
  const out: Claim[] = [];
  for (const e of extractEntities(t).slice(0, 8)) {
    if (e.type === 'email') out.push({ type: 'email', value: e.value, relation: `listed in ${where} bio`, weight: 0.55, url, snippet: `Found in the ${where} bio` });
    else if (e.type === 'url') out.push({ type: 'url', value: e.value, relation: `link in ${where} bio`, weight: 0.45, url });
    else if (e.type === 'phone') out.push({ type: 'phone', value: e.value, relation: `listed in ${where} bio`, weight: 0.4, url });
  }
  return out;
}

export const PLATFORM_URL: Record<string, (u: string) => string> = {
  twitter: (u) => `https://x.com/${u}`, x: (u) => `https://x.com/${u}`, github: (u) => `https://github.com/${u}`,
  reddit: (u) => `https://www.reddit.com/user/${u}`, hackernews: (u) => `https://news.ycombinator.com/user?id=${u}`,
  mastodon: (u) => u, linkedin: (u) => `https://www.linkedin.com/in/${u}`,
};

export function claim(type: EntityType, value: string, relation: string, weight: number, extra: Partial<Claim> = {}): Claim {
  return { type, value, relation, weight, ...extra };
}

/** Drop-in helper to define an adapter with sensible defaults. */
export function adapter(a: Omit<Adapter, 'priority'> & { priority?: number }): Adapter {
  return { priority: 5, ...a };
}

const COUNTRY = typeof Intl !== 'undefined' && (Intl as any).DisplayNames ? new (Intl as any).DisplayNames(['en'], { type: 'region' }) : null;
export const countryName = (code?: string): string => {
  if (!code) return '';
  try { return COUNTRY?.of(code.toUpperCase()) ?? code; } catch { return code; }
};
export const joinPlace = (...parts: (string | undefined)[]) => parts.map((p) => (p ?? '').trim()).filter(Boolean).filter((p, i, a) => a.indexOf(p) === i).join(', ');
