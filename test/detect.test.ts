import { describe, it, expect } from 'vitest';
import { detect, detectMany, extractEntities } from '../shared/detect';
import { keyFor, nameSimilarity, normalizeUrl, foldName } from '../shared/normalize';

const t = (s: string) => detect(s)?.type;

describe('detect', () => {
  it.each([
    ['jane@example.com', 'email'],
    ['  Jane.Doe+news@Gmail.com ', 'email'],
    ['@jdoe', 'username'],
    ['example.com', 'domain'],
    ['www.example.com', 'domain'],
    ['https://example.com/', 'domain'],
    ['https://github.com/torvalds', 'url'],
    ['https://github.com/torvalds', 'url'],
    ['185.12.4.9', 'ip'],
    ['2001:db8::1', 'ip'],
    ['+1 (415) 555-2671', 'phone'],
    ['415-555-2671', 'phone'],
    ['0x52908400098527886E0F7030069857D2E4169EE7', 'wallet'],
    ['Jane Doe', 'person'],
    ['Doe, Jane', 'person'],
    ['José Ángel Núñez', 'person'],
    ['Northwind Labs Inc', 'org'],
    ['janedoe92', 'username'],
    ['jane.doe', 'username'],
  ])('%s -> %s', (input, type) => {
    // "github.com/torvalds" has no scheme: treated as domain-with-path -> url expected
    const got = t(input);
    if (input === 'github.com/torvalds') return expect(['url', 'domain']).toContain(got);
    expect(got).toBe(type);
  });

  it('offers alternatives so the UI can offer a correction', () => {
    const d = detect('janedoe92')!;
    expect(d.alternatives.some((a) => a.type === 'person')).toBe(true);
  });

  it('splits pasted multi-line text and dedupes', () => {
    const r = detectMany('a@x.com\nb@y.org\na@x.com\n\nexample.com');
    expect(r.map((x) => x.type)).toEqual(['email', 'email', 'domain']);
  });

  it('extracts entities from free text', () => {
    const r = extractEntities('Contact bob@acme.io or call +1 415 555 2671. See https://acme.io/team. Server 10.0.0.5.');
    const types = r.map((x) => x.type).sort();
    expect(types).toEqual(expect.arrayContaining(['email', 'ip', 'url']));
  });

  it('returns null for blank input', () => expect(detect('   ')).toBeNull());
});

describe('keys', () => {
  it('canonicalizes equal entities to equal keys', () => {
    expect(keyFor('email', 'Jane.Doe+x@gmail.com')).toBe(keyFor('email', 'janedoe@googlemail.com'));
    expect(keyFor('username', '@JDoe')).toBe(keyFor('username', 'jdoe'));
    expect(keyFor('domain', 'https://www.Example.com/a')).toBe('example.com');
    expect(keyFor('phone', '(415) 555-2671')).toBe(keyFor('phone', '+14155552671'));
    expect(keyFor('person', 'Doe, Jane')).toBe(keyFor('person', 'jane doe'));
    expect(foldName('José Núñez')).toBe('jose nunez');
  });
  it('strips tracking params from URLs', () => {
    expect(normalizeUrl('https://a.com/p/?utm_source=x&id=3#frag')).toBe('https://a.com/p?id=3');
  });
});

describe('nameSimilarity', () => {
  it('handles initials, middle names and order', () => {
    expect(nameSimilarity('Jane Doe', 'Doe, Jane')).toBe(1);
    expect(nameSimilarity('Jane Marie Doe', 'Jane Doe')).toBeGreaterThan(0.9);
    expect(nameSimilarity('J. Doe', 'Jane Doe')).toBeGreaterThan(0.9);
  });
  it('keeps different people apart', () => {
    expect(nameSimilarity('Jane Doe', 'Mark Smith')).toBeLessThan(0.6);
    expect(nameSimilarity('Jane Doe', 'John Doe')).toBeLessThan(0.8);
  });
});

describe('detect: tricky shapes', () => {
  it('city/state is a location, not a person', () => {
    expect(detect('Austin, TX')?.type).toBe('location');
    expect(detect('Paris, France')?.type).toBe('location');
  });
  it('schemeless URL with a path is a URL', () => expect(detect('github.com/torvalds')?.type).toBe('url'));
});

it('treats reserved .example domains as domains', () => {
  expect(detect('northwind-labs.example')?.type).toBe('domain');
  expect(detect('mara@northwind-labs.example')?.type).toBe('email');
});

import { safeHttpUrl, safeImageSrc, labelFor } from '../shared/normalize';
describe('untrusted URL handling', () => {
  it('only http(s) may become links', () => {
    expect(safeHttpUrl('https://a.example/x')).toBe('https://a.example/x');
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:x', '//evil', 'not a url', 42, null]) expect(safeHttpUrl(bad as any)).toBeUndefined();
  });
  it('images allow raster/svg data URIs and http(s) only', () => {
    expect(safeImageSrc('data:image/svg+xml;utf8,%3Csvg/%3E')).toBeTruthy();
    expect(safeImageSrc('data:text/html;base64,AAAA')).toBeUndefined();
    expect(safeImageSrc('javascript:alert(1)')).toBeUndefined();
  });
  it('labels never expose raw data URIs', () => {
    expect(labelFor('image', 'data:image/svg+xml;utf8,xxxx')).toBe('Profile photo');
    expect(labelFor('account', 'https://github.com/maralinden', { platform: 'GitHub' })).toBe('GitHub · maralinden');
  });
});

describe('gaming and chat platforms', () => {
  it('recognises profile links as accounts, not generic pages', () => {
    expect(detect('https://www.roblox.com/users/3148802991/profile')).toMatchObject({ type: 'account' });
    expect(detect('https://discord.com/users/175928847299117063')).toMatchObject({ type: 'account', value: 'https://discord.com/users/175928847299117063' });
    expect(detect('https://steamcommunity.com/id/gaben')).toMatchObject({ type: 'account' });
    expect(detect('https://www.twitch.tv/shroud')).toMatchObject({ type: 'account' });
    expect(detect('https://t.me/durov')).toMatchObject({ type: 'account' });
  });
  it('treats a bare Discord-sized number as a possible account, with lower confidence, and leaves phones and short numbers alone', () => {
    const d = detect('175928847299117063')!; expect(d.type).toBe('account'); expect(d.confidence).toBeLessThan(0.9);
    expect(detect('+1 415 555 0142')!.type).toBe('phone');
    expect(detect('12345')!.type).not.toBe('account');
  });
  it('keeps ordinary links, other sites and invites as they were', () => {
    expect(detect('https://example.com/a/b')!.type).toBe('url');
    expect(detect('https://github.com/octocat')!.type).toBe('url');
    expect(detect('https://discord.gg/abcDEF')!.type).toBe('url');
    expect(detect('https://discord.com/channels/111111111111111111/222222222222222222/175928847299117063')!.type).toBe('url');
  });
});
