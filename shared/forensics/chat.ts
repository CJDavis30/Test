/**
 * Chat export reader. Investigators are handed exports, not APIs: a Discord server dump, a Telegram history, a WhatsApp text. Each is a
 * long record of who spoke when. This turns one into per-speaker timestamp lists (and says what it could and could not read) so each speaker
 * can get an activity clock and be added to the case as an account.
 *
 * Formats: DiscordChatExporter (JSON and CSV), Telegram Desktop (JSON), WhatsApp (text, both common layouts). Telegram and WhatsApp
 * record times in the exporter's local time, not UTC; where that is the case the result says so and no timezone is claimed.
 */
export interface Speaker { id: string; name: string; messages: number; first: number; last: number; times: number[] }
export interface ChatResult {
  format: 'discord-json' | 'discord-csv' | 'telegram-json' | 'whatsapp-text';
  platform: 'Discord' | 'Telegram' | 'WhatsApp';
  speakers: Speaker[];
  total: number;
  /** true when the export's times are in the exporter's own timezone, so UTC hours (and any timezone estimate) are not meaningful */
  localTime: boolean;
  note?: string;
}

const MAX_TIMES = 20_000;
const cap = (a: number[]) => (a.length > MAX_TIMES ? a.slice(-MAX_TIMES) : a);

function finish(by: Map<string, { name: string; times: number[] }>): Speaker[] {
  return [...by.entries()].map(([id, v]) => { const t = v.times.filter(Number.isFinite).sort((a, b) => a - b); return { id, name: v.name, messages: t.length, first: t[0] ?? 0, last: t[t.length - 1] ?? 0, times: cap(t) }; }).filter((s) => s.messages > 0).sort((a, b) => b.messages - a.messages);
}
const add = (by: Map<string, { name: string; times: number[] }>, id: string, name: string, t: number) => { const cur = by.get(id) ?? by.set(id, { name, times: [] }).get(id)!; if (name && !cur.name) cur.name = name; cur.times.push(t); };

function discordJson(j: any): ChatResult | null {
  if (!Array.isArray(j?.messages) || !j.messages.some((m: any) => m?.author && m?.timestamp)) return null;
  const by = new Map<string, { name: string; times: number[] }>(); let total = 0;
  for (const m of j.messages) { const t = Date.parse(m?.timestamp); if (!m?.author || !Number.isFinite(t)) continue; total++; add(by, String(m.author.id ?? m.author.name), String(m.author.name ?? m.author.nickname ?? ''), t); }
  return { format: 'discord-json', platform: 'Discord', speakers: finish(by), total, localTime: false };
}
function telegramJson(j: any): ChatResult | null {
  if (!Array.isArray(j?.messages) || !j.messages.some((m: any) => m?.from_id || m?.date_unixtime)) return null;
  const by = new Map<string, { name: string; times: number[] }>(); let total = 0; let unix = 0;
  for (const m of j.messages) {
    if (m?.type && m.type !== 'message') continue;
    const t = m?.date_unixtime ? Number(m.date_unixtime) * 1000 : Date.parse(m?.date);
    if (!Number.isFinite(t) || !m?.from) continue;
    if (m?.date_unixtime) unix++;
    total++; add(by, String(m.from_id ?? m.from), String(m.from), t);
  }
  const utc = unix > 0 && unix === total;
  return { format: 'telegram-json', platform: 'Telegram', speakers: finish(by), total, localTime: !utc, note: utc ? undefined : 'This Telegram export records times in the exporter\'s own timezone, so hours are local to them, not UTC.' };
}

function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length && rows.length < 400_000; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function discordCsv(text: string): ChatResult | null {
  const first = text.slice(0, 400).split('\n')[0];
  if (!/^"?AuthorID"?,"?Author"?,"?Date"?/i.test(first)) return null;
  const rows = csvRows(text).slice(1); const by = new Map<string, { name: string; times: number[] }>(); let total = 0;
  for (const r of rows) { const t = Date.parse(r[2]); if (!Number.isFinite(t) || !r[0]) continue; total++; add(by, r[0], r[1] ?? '', t); }
  return { format: 'discord-csv', platform: 'Discord', speakers: finish(by), total, localTime: false };
}

const WA = [
  /^\[(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\]\s+([^:]{1,80}?):\s/,
  /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s+-\s+([^:]{1,80}?):\s/,
];
function whatsapp(text: string): ChatResult | null {
  const lines = text.split(/\r?\n/);
  const hits: { a: number; b: number; y: number; h: number; mi: number; s: number; name: string }[] = [];
  for (const line of lines) {
    for (const re of WA) {
      const m = line.replace(/^‎| /g, ' ').match(re); if (!m) continue;
      let h = Number(m[4]); const ap = m[7]?.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
      let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])]; let y = c;
      if (a > 31) { y = a; a = c; } // year first
      hits.push({ a, b, y: y < 100 ? 2000 + y : y, h, mi: Number(m[5]), s: Number(m[6] ?? 0), name: m[8].trim() }); break;
    }
  }
  if (hits.length < 3) return null;
  // is the first number the day or the month? whichever can exceed 12 tells us
  const dayFirst = hits.some((x) => x.a > 12) || !hits.some((x) => x.b > 12);
  const by = new Map<string, { name: string; times: number[] }>();
  for (const x of hits) { const day = dayFirst ? x.a : x.b, mon = dayFirst ? x.b : x.a; const t = Date.UTC(x.y, mon - 1, day, x.h, x.mi, x.s); if (Number.isFinite(t) && mon >= 1 && mon <= 12 && day >= 1 && day <= 31) add(by, x.name, x.name, t); }
  return { format: 'whatsapp-text', platform: 'WhatsApp', speakers: finish(by), total: hits.length, localTime: true, note: `WhatsApp records times in the exporter's phone timezone, so hours are local to them (dates read as ${dayFirst ? 'day/month' : 'month/day'}). No timezone is claimed.` };
}

export function parseChat(text: string): ChatResult | null {
  const t = text.trim(); if (!t) return null;
  let r: ChatResult | null = null;
  if (t[0] === '{') { try { const j = JSON.parse(t); r = discordJson(j) ?? telegramJson(j); } catch { /* not JSON */ } }
  r = r ?? discordCsv(t) ?? whatsapp(t);
  return r && r.speakers.length ? r : null;
}
