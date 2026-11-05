/** Turn a vision model's reading of a screenshot into entities Plexus can use. The model only transcribes what is written; Plexus validates each item. */
import { detect } from '../detect';
import type { EntityType } from '../types';

export const SCREENSHOT_SYSTEM = `You transcribe text and facts from a screenshot for an investigator. Read only what is written on screen. Never identify people from their faces or bodies and ignore photos of people. Do not guess: if a value is cut off or unclear, leave it out.
List: the app or website shown, usernames and handles (with the platform if clear), display names, email addresses, phone numbers, links, numeric IDs, dates and times (copy exactly as written, including any timezone), places, organisations, message text that names someone, and anything that looks like an account setting (joined date, follower counts, verification badges).
Reply with JSON only, in exactly this shape:
{"platform": "", "kind": "profile|chat|post|settings|email|document|other", "items": [{"type": "username|email|phone|url|name|org|place|id|date|text", "value": "", "context": "where on the screen / what it is next to"}], "summary": "one or two plain sentences of what the screenshot shows"}`;

export interface ScreenItem { type: 'username' | 'email' | 'phone' | 'url' | 'name' | 'org' | 'place' | 'id' | 'date' | 'text'; value: string; context?: string; entity?: { type: EntityType; value: string }; valid: boolean }
export interface ScreenReading { platform?: string; kind: string; items: ScreenItem[]; summary: string }

export function parseScreenshotReply(j: any): ScreenReading | null {
  if (!j || typeof j !== 'object') return null;
  const items: ScreenItem[] = [], seen = new Set<string>();
  for (const it of Array.isArray(j.items) ? j.items.slice(0, 80) : []) {
    const type = String(it?.type ?? '').toLowerCase() as ScreenItem['type'], value = String(it?.value ?? '').trim().slice(0, 300);
    if (!value || !['username', 'email', 'phone', 'url', 'name', 'org', 'place', 'id', 'date', 'text'].includes(type)) continue;
    const key = `${type}:${(type === 'username' ? value.replace(/^@/, '') : value).toLowerCase()}`; if (seen.has(key)) continue; seen.add(key);
    let entity: ScreenItem['entity'], valid = true;
    if (type === 'email') { const d = detect(value); valid = d?.type === 'email'; if (valid) entity = { type: 'email', value: d!.value }; }
    else if (type === 'phone') { const d = detect(value); valid = d?.type === 'phone'; if (valid) entity = { type: 'phone', value: d!.value }; }
    else if (type === 'url') { const d = detect(value); valid = !!d && (d.type === 'url' || d.type === 'domain' || d.type === 'account'); if (valid) entity = { type: d!.type === 'domain' ? 'domain' : d!.type === 'account' ? 'account' : 'url', value: d!.value }; }
    else if (type === 'username') { const v = value.replace(/^@/, ''); valid = /^[\w.\-]{2,40}$/.test(v); if (valid) entity = { type: 'username', value: v }; }
    else if (type === 'name') { valid = /^[\p{L}][\p{L} .'’-]{1,60}$/u.test(value) && value.includes(' '); if (valid) entity = { type: 'person', value }; }
    else if (type === 'org') entity = { type: 'org', value };
    else if (type === 'place') entity = { type: 'location', value };
    items.push({ type, value, context: it?.context ? String(it.context).slice(0, 120) : undefined, entity, valid });
  }
  return { platform: j.platform ? String(j.platform).slice(0, 60) : undefined, kind: String(j.kind ?? 'other').slice(0, 20), items, summary: String(j.summary ?? '').slice(0, 400) };
}
