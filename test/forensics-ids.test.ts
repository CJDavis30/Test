import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { md5, decodeDiscordSnowflake, decodeTwitterSnowflake, decodeSteam64, decodeMinecraftUuid, minecraftOfflineUuid, instagramShortcodeToId, instagramIdToShortcode, decodeInstagramPost, findPlatformRefs, EPOCH } from '../shared/forensics/ids';

describe('platform ID decoding', () => {
  it('has an MD5 that matches the platform one on awkward lengths', () => {
    for (const s of ['', 'a', 'OfflinePlayer:Notch', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'héllo ✓']) expect(Buffer.from(md5(s)).toString('hex'), s.slice(0, 12)).toBe(createHash('md5').update(s).digest('hex'));
  });
  it("decodes Discord's documented example snowflake exactly", () => {
    // From Discord's developer documentation: 175928847299117063 → 2016-04-30 11:18:25.796 UTC, worker 1, process 0, increment 7
    const s = decodeDiscordSnowflake('175928847299117063')!;
    expect(s.iso).toBe('2016-04-30T11:18:25.796Z');
    expect([s.worker, s.process, s.sequence]).toEqual([1, 0, 7]);
  });
  it('round-trips arbitrary snowflakes built from a timestamp', () => {
    const t = Date.UTC(2022, 5, 17, 3, 4, 5, 678);
    const id = ((BigInt(t - EPOCH.discord) << 22n) | (5n << 17n) | (3n << 12n) | 42n).toString();
    const s = decodeDiscordSnowflake(id)!;
    expect(s.createdAt).toBe(t); expect([s.worker, s.process, s.sequence]).toEqual([5, 3, 42]);
    const tw = ((BigInt(t - EPOCH.twitter) << 22n) | 1n).toString();
    expect(decodeTwitterSnowflake(tw)!.createdAt).toBe(t);
  });
  it('rejects things that are not snowflakes', () => { for (const x of ['123', 'abc', '', '12345678901234567890123']) expect(decodeDiscordSnowflake(x)).toBeNull(); });
  it('decodes Steam64 IDs (Gabe Newell: 76561197960287930 is account 22202)', () => {
    const s = decodeSteam64('76561197960287930')!;
    expect(s.accountId).toBe(22202); expect(s.type).toBe('Individual'); expect(s.universe).toBe(1); expect(s.steam3).toBe('[U:1:22202]');
    expect(decodeSteam64('12345')).toBeNull();
  });
  it('tells Mojang accounts from offline-mode ones, and recomputes the offline UUID from a name', () => {
    expect(decodeMinecraftUuid('069a79f4-44e9-4726-a5be-fca90e38aaf5')).toMatchObject({ kind: 'online', version: 4 });
    const off = minecraftOfflineUuid('Notch');
    expect(decodeMinecraftUuid(off)).toMatchObject({ kind: 'offline', version: 3 });
    expect(off).toBe(minecraftOfflineUuid('Notch'));
    expect(off).not.toBe(minecraftOfflineUuid('notch')); // names are case-sensitive here
    expect(off[19]).toMatch(/[89ab]/);
    expect(decodeMinecraftUuid('not-a-uuid')).toBeNull();
  });
  it('decodes Instagram post codes (round trip) into a timestamp', () => {
    const t = Date.UTC(2020, 2, 3, 4, 5, 6);
    const id = (BigInt(t - EPOCH.instagram) << 23n) | 9n;
    const code = instagramIdToShortcode(id);
    expect(instagramShortcodeToId(code)).toBe(id);
    expect(decodeInstagramPost(code)!.createdAt).toBe(t);
  });
});

describe('finding platform references in free text', () => {
  const text = `
    see https://discord.com/channels/111111111111111111/222222222222222222/175928847299117063 and the profile https://www.roblox.com/users/3148802991/profile
    also https://steamcommunity.com/profiles/76561197960287930, invite discord.gg/abcDEF, https://x.com/someone/status/1585641234567890123,
    handle https://github.com/octocat and mc uuid 069a79f4-44e9-4726-a5be-fca90e38aaf5. A stray number 99999999999999999999 and 175928847299117063.
  `;
  const refs = findPlatformRefs(text);
  const get = (p: string, k: string) => refs.find((r) => r.platform === p && r.kind === k);
  it('finds each platform and decodes what it can', () => {
    expect(get('Discord', 'message')!.at).toBe(Date.parse('2016-04-30T11:18:25.796Z'));
    expect(get('Roblox', 'user')!.id).toBe('3148802991');
    expect(get('Steam', 'user')!.note).toMatch(/Individual/);
    expect(get('Discord', 'invite')!.id).toBe('abcDEF');
    expect(get('X', 'post')!.at).toBeGreaterThan(Date.UTC(2022, 0, 1));
    expect(get('GitHub', 'handle')!.id).toBe('octocat');
    expect(get('Minecraft', 'user')!.note).toMatch(/Mojang/);
  });
  it('does not report the same thing twice, and ignores numbers that cannot be IDs', () => {
    expect(new Set(refs.map((r) => `${r.platform}|${r.kind}|${r.id}`)).size).toBe(refs.length);
    expect(refs.some((r) => r.id === '99999999999999999999')).toBe(false);
  });
  it('treats a bare long number as a possible Discord ID but says it is a guess', () => {
    const r = findPlatformRefs('user 175928847299117063 was in the server')[0];
    expect(r.platform).toBe('Discord'); expect(r.note).toMatch(/If this is a Discord ID/);
  });
  it('survives hostile input', () => {
    expect(() => findPlatformRefs('x'.repeat(100_000) + 'discord.com/channels/' + '9'.repeat(5000))).not.toThrow();
    expect(findPlatformRefs('')).toEqual([]);
  });
});
