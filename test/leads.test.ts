import { describe, it, expect } from 'vitest';
import { leadsFromText, leadClaims, bioLeadClaims, mentionsIn } from '../shared/leads';
import { classifyName, nameMatchCap, handleSurprise, trustFactor, platformOfUrl, platformByName, cleanRole, describeRole, roleFromAttrs, roleToAttrs, anchorFamilies } from '../shared/handles';

describe('handles: what a username is', () => {
  it('roles survive a round trip through node attributes and are described in words', () => {
    const r = cleanRole({ platform: 'Roblox', kind: 'username', trust: 'certain', origin: 'their-profile', originNote: ' from their page ', alt: true })!;
    expect(r).toMatchObject({ platform: 'roblox', kind: 'username', trust: 'certain', origin: 'their-profile', alt: true, originNote: 'from their page' });
    expect(roleFromAttrs(roleToAttrs(r))).toEqual(r);
    expect(describeRole(r)).toBe('Roblox username · alt account');
    expect(describeRole({ platform: 'discord', kind: 'display-name', trust: 'probable' })).toBe('Discord display name');
    expect(describeRole(undefined)).toMatch(/not specified/);
    expect(anchorFamilies(r)).toEqual(['roblox']);   // the look-alike-names search is a search, not the account you named
    expect(anchorFamilies({ platform: 'roblox', kind: 'display-name', trust: 'certain' })).toEqual([]);   // a display name is not a unique account
    expect(anchorFamilies({ platform: 'discord', kind: 'username', trust: 'certain' })).toEqual(['discord']);
  });
  it('unknown platforms are kept as free text, junk is dropped', () => {
    expect(cleanRole({ platform: 'Some Forum 2', kind: 'username' })!.platform).toBe('Some Forum 2');
    expect(cleanRole({ platform: '<b>x</b>' })!.platform).toBeUndefined();
    expect(cleanRole('nope')).toBeUndefined();
    expect(platformByName('IG')!.key).toBe('instagram'); expect(platformByName('twitter')!.key).toBe('x'); expect(platformByName('nothing')).toBeUndefined();
  });
  it('trust is what you believe times how good the place you got it from is', () => {
    const t = (trust: any, origin: any) => trustFactor({ trust, origin });
    expect(t('certain', 'their-profile')).toBe(1);
    expect(t('certain', 'told')).toBeLessThan(t('certain', 'screenshot'));
    expect(t('unsure', 'their-profile')).toBeLessThan(t('probable', 'their-profile'));
    expect(t('unsure', 'unknown')).toBeGreaterThanOrEqual(0.15);
  });
  it('a same-name hit is worth little, least for common names and short handles, most for long odd ones, never past 0.4', () => {
    const caps = ['john', 'emma', 'gamer', 'mara', 'xyz', 'maralinden', 'ravenfox_77', 'zq9x4k7wmp'].map((h) => [h, nameMatchCap(h)] as const);
    const c = Object.fromEntries(caps);
    expect(c.john).toBeLessThan(0.1); expect(c.emma).toBeLessThan(0.1); expect(c.xyz).toBeLessThan(0.2);
    expect(c.maralinden).toBeGreaterThan(c.mara); expect(c.ravenfox_77).toBeGreaterThan(0.25);
    for (const [, v] of caps) expect(v).toBeLessThan(0.4);
    expect(handleSurprise('john')).toBeLessThan(1);
  });
  it('only a plain two-word name counts as a possible real name', () => {
    expect(classifyName('Mara Linden')).toBe('full-name');
    expect(classifyName('Jean-Luc O\'Brien')).toBe('full-name');
    expect(classifyName('Mara')).toBe('single-name');
    for (const v of ['xX_Mara_Xx', 'mara.builds', 'Mara ♡', 'mara linden 2009', 'ravenfox77', 'THE REAL MARA ✨', 'a b c d e f', '']) expect(classifyName(v)).toBe('handle-like');
    expect(classifyName('Mara Linden', ['maralinden'])).toBe('handle-like');   // it is just the handle with a space
  });
  it('reads the service and handle out of a profile link', () => {
    expect(platformOfUrl('https://www.instagram.com/foo_bar/')).toMatchObject({ platform: { key: 'instagram' }, handle: 'foo_bar' });
    expect(platformOfUrl('https://www.tiktok.com/@qux?lang=en')).toMatchObject({ platform: { key: 'tiktok' }, handle: 'qux' });
    expect(platformOfUrl('https://www.youtube.com/@chan')).toMatchObject({ platform: { key: 'youtube' }, handle: 'chan' });
    expect(platformOfUrl('https://steamcommunity.com/id/gaben')).toMatchObject({ platform: { key: 'steam' }, handle: 'gaben' });
    expect(platformOfUrl('https://www.reddit.com/user/spez')).toMatchObject({ platform: { key: 'reddit' }, handle: 'spez' });
    expect(platformOfUrl('https://x.com/share')!.handle).toBeUndefined();            // not a person's page
    expect(platformOfUrl('https://www.roblox.com/users/123/profile')!.handle).toBeUndefined();
    expect(platformOfUrl('https://example.com/foo')).toBeNull();
  });
});

describe('leads in a bio', () => {
  const BIO = 'builder | ig: foo_bar | snap - baz.q | tiktok @qux | discord: Rae#1234 | yt: Chan Nel | https://www.twitch.tv/streamer1 | my stuff https://linktr.ee/ravenfox';
  it('finds platform handles with and without a link, and link hubs', () => {
    const l = leadsFromText(BIO);
    const by = (k: string) => l.find((x) => x.platform?.key === k);
    expect(by('instagram')).toMatchObject({ handle: 'foo_bar', via: 'mention' });
    expect(by('snapchat')).toMatchObject({ handle: 'baz.q' });
    expect(by('tiktok')).toMatchObject({ handle: 'qux' });
    expect(by('discord')).toMatchObject({ handle: 'Rae' });                          // the #1234 tag is not part of the name
    expect(by('youtube')!.handle).toBe('Chan');
    expect(by('twitch')).toMatchObject({ handle: 'streamer1', via: 'link' });
    expect(l.find((x) => x.via === 'hub')!.url).toBe('https://linktr.ee/ravenfox');
  });
  it('does not mistake ordinary words for handles', () => {
    for (const t of ['I love my insta is the best', 'just chilling, add me!', 'x marks the spot', 'gt 3 wins today', 'discord: join my server', 'ig me', 'snap out of it', 'follow me on tiktok pls', 'tiktok is down', 'my x is gone', 'dc is cool', 'youtube.com is blocked']) expect(mentionsIn(t), t).toEqual([]);
  });
  it('turns them into self-reported claims: a handle with its platform and a low "not sure" trust, a link into an account to read', () => {
    const cs = bioLeadClaims(BIO + ' mail raven@example.test', 'Roblox', 'https://www.roblox.com/users/1/profile');
    const ig = cs.find((c) => c.type === 'username' && c.value === 'foo_bar')!;
    expect(ig).toMatchObject({ basis: 'self-reported', relation: 'says they are foo_bar on Instagram', attrs: { handlePlatform: 'instagram', handleKind: 'username', handleTrust: 'unsure', handleOrigin: 'bio' } });
    expect(ig.snippet).toMatch(/Roblox.*ig: foo_bar/);
    const tw = cs.find((c) => c.type === 'account' && /twitch/.test(c.value))!;
    expect(tw).toMatchObject({ basis: 'self-reported', attrs: { platform: 'Twitch', handle: 'streamer1' } });
    expect(cs.find((c) => c.type === 'url' && /linktr\.ee/.test(c.value))!.attrs).toMatchObject({ hub: true });
    expect(cs.find((c) => c.type === 'email')!.value).toBe('raven@example.test');
    expect(new Set(cs.map((c) => `${c.type}|${c.value}`)).size).toBe(cs.length);       // no duplicates
  });
  it('empty or plain bios produce nothing', () => {
    expect(leadsFromText('')).toEqual([]); expect(bioLeadClaims('just a guy who likes bikes', 'GitHub')).toEqual([]);
    expect(leadClaims([], 'x')).toEqual([]);
  });
});
