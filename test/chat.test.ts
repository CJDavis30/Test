import { describe, it, expect } from 'vitest';
import { parseChat } from '../shared/forensics/chat';
import { circadian, TEMPLATE } from '../shared/forensics/circadian';

describe('chat export reader', () => {
  it('reads a DiscordChatExporter JSON file into per-speaker UTC timestamps', () => {
    const j = { guild: { name: 'G' }, channel: { name: 'c' }, messages: [
      { id: '1', timestamp: '2024-03-02T03:12:44.123+00:00', author: { id: '10', name: 'mara', nickname: 'Mara' }, content: 'gg' },
      { id: '2', timestamp: '2024-03-02T03:14:01.000+00:00', author: { id: '10', name: 'mara' }, content: 'again' },
      { id: '3', timestamp: '2024-03-02T04:00:00.000-05:00', author: { id: '11', name: 'bob' }, content: 'hi' },
      { id: '4', timestamp: 'not a date', author: { id: '12', name: 'x' }, content: '' }, null, { id: '5' },
    ] };
    const r = parseChat(JSON.stringify(j))!;
    expect(r.format).toBe('discord-json'); expect(r.localTime).toBe(false); expect(r.total).toBe(3);
    expect(r.speakers.map((s) => [s.name, s.messages])).toEqual([['mara', 2], ['bob', 1]]);
    expect(r.speakers[1].times[0]).toBe(Date.parse('2024-03-02T09:00:00Z'));  // the offset is honoured
  });
  it('reads Discord CSV including quoted fields with commas, quotes and newlines', () => {
    const csv = 'AuthorID,Author,Date,Content,Attachments,Reactions\n10,mara,2024-03-02T03:12:44+00:00,"hello, ""world""\nsecond line",,\n11,bob,2024-03-02T03:13:00+00:00,hey,,\n';
    const r = parseChat(csv)!; expect(r.format).toBe('discord-csv'); expect(r.total).toBe(2); expect(r.speakers.map((s) => s.name).sort()).toEqual(['bob', 'mara']);
  });
  it('reads Telegram JSON, uses exact UTC times when present, and says when it cannot', () => {
    const mk = (withUnix: boolean) => JSON.stringify({ name: 'chat', messages: [{ id: 1, type: 'message', date: '2024-03-02T09:12:44', ...(withUnix ? { date_unixtime: '1709370764' } : {}), from: 'Mara', from_id: 'user1', text: 'hi' }, { id: 2, type: 'service', date: '2024-03-02T09:13:00', from: 'Mara', from_id: 'user1' }, { id: 3, type: 'message', date: '2024-03-02T09:15:00', ...(withUnix ? { date_unixtime: '1709370900' } : {}), from: 'Bob', from_id: 'user2', text: 'yo' }] });
    const a = parseChat(mk(true))!; expect(a.localTime).toBe(false); expect(a.total).toBe(2); expect(a.speakers[0].times[0]).toBe(1709370764000);
    const b = parseChat(mk(false))!; expect(b.localTime).toBe(true); expect(b.note).toMatch(/own timezone/);
  });
  it('reads both WhatsApp layouts, works out day/month order, and claims no timezone', () => {
    const android = '12/03/2024, 21:14 - Mara: hi\n12/03/2024, 21:15 - Bob: hey\n13/03/2024, 08:00 - Mara: morning\nmultiline continues here\n';
    const ios = '[3/12/24, 9:14:05 PM] Mara: hi\n[3/12/24, 9:15:00 PM] Bob: hey\n[3/13/24, 8:00:00 AM] Mara: morning\n';
    const a = parseChat(android)!, i = parseChat(ios)!;
    expect(a.localTime && i.localTime).toBe(true); expect(a.speakers.find((s) => s.name === 'Mara')!.times[0]).toBe(Date.UTC(2024, 2, 12, 21, 14));
    expect(i.speakers.find((s) => s.name === 'Mara')!.times[0]).toBe(Date.UTC(2024, 2, 12, 21, 14, 5)); // 9:14 PM, month/day inferred
    expect(a.note).toMatch(/No timezone/);
  });
  it('gives each speaker a usable activity record: a busy simulated speaker yields a confident clock', () => {
    const r0 = (() => { let s = 7; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const cdf: number[] = []; let c = 0; for (const p of TEMPLATE) cdf.push((c += p));
    const msgs = Array.from({ length: 900 }, (_, i) => { const u = r0(); const lh = Math.max(0, cdf.findIndex((x) => x >= u)); return { id: String(i), timestamp: new Date(Date.UTC(2024, 0, 1) + Math.floor(r0() * 300) * 86_400_000 + ((((lh + 5) % 24) + 24) % 24) * 3_600_000 + Math.floor(r0() * 3_600_000)).toISOString(), author: { id: '1', name: 'night_owl' }, content: 'x' }; });
    const r = parseChat(JSON.stringify({ messages: msgs }))!;
    const c1 = circadian(r.speakers[0].times)!; expect(c1.best.offset).toBe(-5);
  });
  it('returns nothing for text that is not a chat export, and survives junk and huge inputs', () => {
    for (const t of ['', 'hello', '{"a":1}', '[1,2,3]', 'AuthorID,Author,Date\n', '{"messages": "no"}', 'x'.repeat(100_000)]) expect(parseChat(t)).toBeNull();
    expect(() => parseChat('{' + '"a":'.repeat(20000))).not.toThrow();
    const big = JSON.stringify({ messages: Array.from({ length: 60_000 }, (_, i) => ({ id: String(i), timestamp: new Date(1_700_000_000_000 + i * 60_000).toISOString(), author: { id: '1', name: 'a' }, content: '' })) });
    const r = parseChat(big)!; expect(r.total).toBe(60_000); expect(r.speakers[0].times.length).toBeLessThanOrEqual(20_000);
  });
});
