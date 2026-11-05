import { describe, it, expect } from 'vitest';
import { analyzeUrl, findUrls } from '../shared/forensics/urls';

const f = (r: ReturnType<typeof analyzeUrl>, label: string) => r!.facts.find((x) => x.label === label);
const snowAt = (ms: number) => String((BigInt(ms - 1420070400000) << 22n) + 5n);

describe('Discord links', () => {
  const upload = Date.UTC(2024, 2, 10, 15, 30, 5);
  const att = snowAt(upload), chan = snowAt(Date.UTC(2023, 0, 5, 9, 0, 0));
  const issued = Math.floor(Date.UTC(2024, 2, 14, 7, 22, 26) / 1000), expires = issued + 86400;
  const url = `https://cdn.discordapp.com/attachments/${chan}/${att}/screenshot.png?ex=${expires.toString(16)}&is=${issued.toString(16)}&hm=abcdef0123`;
  it('dates the upload to the second from the attachment ID, and shows when the link was issued and expires', () => {
    const r = analyzeUrl(url)!;
    expect(f(r, 'Uploaded to Discord')!.iso).toBe('2024-03-10T15:30:05Z'); expect(f(r, 'Uploaded to Discord')!.importance).toBe(3);
    expect(f(r, 'Channel created')!.iso).toBe('2023-01-05T09:00:00Z');
    expect(f(r, 'This link was issued')!.iso).toBe('2024-03-14T07:22:26Z');
    expect(f(r, 'This link expires')!.iso).toBe('2024-03-15T07:22:26Z');
    expect(r.warnings.some((w) => /expired/.test(w))).toBe(true);        // long past by now
    expect(f(r, 'File name')!.value).toBe('screenshot.png');
  });
  it('reads the account creation time from an avatar link, and spots animated avatars', () => {
    const uid = snowAt(Date.UTC(2019, 6, 1, 12, 0, 0));
    const r = analyzeUrl(`https://cdn.discordapp.com/avatars/${uid}/a_0123456789abcdef0123456789abcdef.gif?size=256`)!;
    expect(f(r, 'Discord account created')!.iso).toBe('2019-07-01T12:00:00Z');
    expect(f(r, 'Animated avatar')).toBeTruthy();
    expect(r.entities.some((e) => e.type === 'account' && e.value === `https://discord.com/users/${uid}`)).toBe(true);
  });
  it('dates a message link, its channel and its server', () => {
    const r = analyzeUrl(`https://discord.com/channels/${snowAt(Date.UTC(2020, 0, 1))}/${snowAt(Date.UTC(2021, 0, 1))}/${snowAt(Date.UTC(2022, 5, 6, 7, 8, 9))}`)!;
    expect(f(r, 'Message sent')!.iso).toBe('2022-06-06T07:08:09Z');
  });
  it('ignores made-up IDs that decode to impossible dates', () => {
    expect(f(analyzeUrl('https://cdn.discordapp.com/attachments/1/2/x.png')!, 'Uploaded to Discord')).toBeUndefined();
    expect(f(analyzeUrl(`https://cdn.discordapp.com/attachments/${snowAt(0)}/${snowAt(0)}/x.png`)!, 'Uploaded to Discord')).toBeUndefined();
  });
});

describe('other platforms', () => {
  it('X post time, TikTok video time, Instagram post time', () => {
    const tw = analyzeUrl(`https://x.com/jack/status/20`)!;               // very early ID: before the snowflake epoch, so no date, but the account is kept
    expect(tw.entities.some((e) => e.value === 'jack')).toBe(true);
    const tweet = String((BigInt(Date.UTC(2023, 4, 5, 6, 7, 8) - 1288834974657) << 22n) + 1n);
    expect(f(analyzeUrl(`https://twitter.com/someone/status/${tweet}?s=20&t=abc`)!, 'Posted on X')!.iso).toBe('2023-05-05T06:07:08Z');
    const tt = String(BigInt(Math.floor(Date.UTC(2023, 8, 1, 10, 0, 0) / 1000)) << 32n);
    const t = analyzeUrl(`https://www.tiktok.com/@dancer.xo/video/${tt}`)!;
    expect(f(t, 'Posted on TikTok')!.iso).toBe('2023-09-01T10:00:00Z'); expect(t.entities.some((e) => e.type === 'username' && e.value === 'dancer.xo')).toBe(true);
    expect(f(analyzeUrl('https://www.instagram.com/p/CuXyZ123456/')!, 'Posted on Instagram')).toBeTruthy();
  });
  it('reads Wayback links: the time it was saved and where it points', () => {
    const r = analyzeUrl('https://web.archive.org/web/20150312094500/http://old-site.example/about?utm_source=x')!;
    expect(f(r, 'Saved by the Wayback Machine')!.iso).toBe('2015-03-12T09:45:00Z');
    expect(r.final).toContain('old-site.example/about'); expect(f(r, 'Really goes to')).toBeTruthy();
  });
});

describe('cleaning and unwrapping', () => {
  it('removes trackers, keeps the real parameters, and points out share IDs that identify the sharer', () => {
    const r = analyzeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&si=AbC123xyz&utm_source=newsletter&fbclid=IwAR0abc')!;
    expect(r.cleaned).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
    expect(r.removed).toEqual(expect.arrayContaining(['si', 'utm_source', 'fbclid']));
    expect(f(r, 'Share ID (si)')!.importance).toBe(2); expect(f(r, 'Campaign source')!.value).toBe('newsletter');
  });
  it('follows redirect wrappers to the real destination, up to a limit', () => {
    const r = analyzeUrl('https://www.google.com/url?q=' + encodeURIComponent('https://l.facebook.com/l.php?u=' + encodeURIComponent('https://shady.example/offer?id=7')) + '&sa=U')!;
    expect(r.final).toBe('https://shady.example/offer?id=7'); expect(r.chain.length).toBe(2); expect(r.warnings.some((w) => /redirect wrapper/.test(w))).toBe(true);
    const loop = 'https://a.example/?u=' + encodeURIComponent('https://a.example/?u=' + encodeURIComponent('https://a.example/?u=' + encodeURIComponent('https://a.example/?u=https://b.example/')));
    expect(analyzeUrl(loop)!.chain.length).toBeLessThanOrEqual(3);
  });
  it('finds emails and identifiers in parameters, including base64-hidden ones', () => {
    const hidden = Buffer.from('email=bob@corp.example&id=77').toString('base64');
    const r = analyzeUrl(`https://track.example/click?uid=bob_k&e=${hidden}&email=alice@mail.example`)!;
    expect(r.entities.some((e) => e.type === 'email' && e.value === 'alice@mail.example')).toBe(true);
    expect(r.entities.some((e) => e.type === 'email' && e.value === 'bob@corp.example')).toBe(true);
    expect(r.entities.some((e) => e.type === 'username' && e.value === 'bob_k')).toBe(true);
  });
  it('warns about logins in the link, look-alike domains, bare IPs and plain http', () => {
    expect(analyzeUrl('https://paypal.com@evil.example/login')!.warnings.join(' ')).toMatch(/login/);
    expect(analyzeUrl('https://xn--pypal-4ve.com/')!.warnings.join(' ')).toMatch(/xn--/);
    expect(analyzeUrl('http://203.0.113.9/x')!.warnings.join(' ')).toMatch(/IP address/);
    expect(analyzeUrl('http://example.com/')!.warnings.join(' ')).toMatch(/Not encrypted/);
  });
  it('knows short links and offers a safe preview', () => {
    const r = analyzeUrl('https://bit.ly/3abcXYZ')!;
    expect(f(r, 'Short link')).toBeTruthy(); expect(r.checks[0].url).toBe('https://bit.ly/3abcXYZ+');
  });
  it('rejects non-web input and finds links in text', () => {
    expect(analyzeUrl('javascript:alert(1)')).toBeNull(); expect(analyzeUrl('not a url at all')).toBeNull(); expect(analyzeUrl('')).toBeNull();
    expect(findUrls('see https://a.example/x, and (https://b.example/y). Also https://a.example/x again')).toEqual(['https://a.example/x', 'https://b.example/y']);
  });
  it('always offers ways to check a link by hand', () => {
    const r = analyzeUrl('https://example.org/page')!;
    expect(r.checks.map((c) => c.label)).toEqual(expect.arrayContaining(['Saved copies (Wayback Machine)', 'VirusTotal reputation']));
    expect(r.checks.every((c) => c.url.startsWith('https://'))).toBe(true);
  });
});
