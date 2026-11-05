// Hostile-input tests: every parser that touches text from outside must neither throw nor take noticeable time, whatever it is fed.
import { describe, it, expect } from 'vitest';
import { findPlatformRefs, decodeDiscordSnowflake, decodeSteam64, decodeMinecraftUuid, decodeInstagramPost } from '../shared/forensics/ids';
import { analyzeHeaders } from '../shared/forensics/headers';
import { parseHandle, compareHandles, rarityBits, variants } from '../shared/forensics/username';
import { circadian } from '../shared/forensics/circadian';
import { dstFingerprint } from '../shared/forensics/dst';
import { alternation } from '../shared/forensics/alternation';
import { findBursts } from '../shared/forensics/bursts';
import { youthSignals } from '../shared/safeguards';
import { detect, detectMany } from '../shared/detect';
import { timestampsIn } from '../server/forensics';

const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const ALPHABET = ['a', 'Z', '0', '9', ' ', '\n', '\t', '/', ':', '.', '-', '_', '@', '#', '%', '+', '<', '>', '&', '"', "'", '\\', 'é', '✓', '世', '\u0000', '‮', '😀', 'discord.com/channels/', 'roblox.com/users/', 'https://', 'Received: ', 'Date: ', '2024-01-01T00:00:00Z', '175928847299117063', '7656119', '[', ']', '(', ')'];
const junk = (r: () => number, n: number) => Array.from({ length: n }, () => ALPHABET[Math.floor(r() * ALPHABET.length)]).join('');

describe('parsers survive hostile text', () => {
  const r = rng(1234);
  const inputs = [...Array.from({ length: 400 }, (_, i) => junk(r, 1 + (i % 7) * 40)), '', ' ', '\n'.repeat(10_000), 'a'.repeat(200_000), junk(r, 60_000), '9'.repeat(100_000), 'discord.com/channels/' + '9'.repeat(50_000), ('Received: ' + 'from x by y; ').repeat(5_000)];
  it('every text parser returns instead of throwing, and quickly', () => {
    const t0 = Date.now();
    for (const t of inputs) {
      expect(() => findPlatformRefs(t)).not.toThrow();
      expect(() => analyzeHeaders(t)).not.toThrow();
      expect(() => youthSignals(t)).not.toThrow();
      expect(() => timestampsIn(t)).not.toThrow();
      expect(() => detect(t)).not.toThrow();
      expect(() => detectMany(t.slice(0, 20_000))).not.toThrow();
      expect(() => parseHandle(t.slice(0, 5000))).not.toThrow();
      expect(() => compareHandles(t.slice(0, 500), t.slice(100, 700))).not.toThrow();
      expect(() => variants(t.slice(0, 100))).not.toThrow();
      expect(() => rarityBits(t.slice(0, 500))).not.toThrow();
    }
    expect(Date.now() - t0).toBeLessThan(15_000);
  });
  it('ID decoders accept only what they should, whatever the digits', () => {
    for (const t of inputs.slice(0, 200)) { for (const f of [decodeDiscordSnowflake, decodeSteam64, decodeMinecraftUuid, (x: string) => decodeInstagramPost(x)]) expect(() => f(t.slice(0, 64))).not.toThrow(); }
    expect(decodeDiscordSnowflake('0'.repeat(18))!.createdAt).toBe(1420070400000);
  });
  it('never reports a reference that is not literally in the text', () => {
    for (const t of inputs.slice(0, 300)) for (const ref of findPlatformRefs(t)) expect(t.includes(ref.raw) || t.slice(0, 2_000_000).includes(ref.raw), ref.raw.slice(0, 30)).toBe(true);
  });
  it('numeric analyses handle empty, huge, duplicate and out-of-order timestamps', () => {
    const r2 = rng(5); const wild = [[], [0], [NaN, Infinity, -Infinity, 1], Array.from({ length: 20_000 }, () => Math.floor(r2() * 2e12)), Array(500).fill(1_700_000_000_000), Array.from({ length: 200 }, (_, i) => 1_700_000_000_000 - i * 86_400_000)];
    for (const t of wild) { expect(() => circadian(t)).not.toThrow(); expect(() => dstFingerprint(t)).not.toThrow(); expect(() => alternation(t, wild[3])).not.toThrow(); expect(() => findBursts(t.map((at, i) => ({ id: String(i), at })))).not.toThrow(); }
    const c = circadian(wild[3] as number[])!; expect(c.offsets.reduce((a, b) => a + b.p, 0)).toBeCloseTo(1, 9);
  });
});
