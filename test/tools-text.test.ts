import { describe, it, expect } from 'vitest';
import { identify, decodeTimestamp } from '../shared/tools/identify';
import { emailGuesses, patternOf, gravatarHash, gravatarUrl } from '../shared/tools/emails';
import { inspectText, punycodeDecode, decodeIdn, lookAlike } from '../shared/tools/textinspect';
import { compareStyle, features } from '../shared/tools/stylometry';
import { readPhone } from '../shared/tools/phone';
import { reverseImageLinks } from '../shared/tools/reverse';

describe('identify anything', () => {
  it('reads a Unix timestamp in seconds and in milliseconds, and says which epochs fit', () => {
    expect(decodeTimestamp('1700000000')[0]).toMatchObject({ epoch: 'Unix seconds', iso: '2023-11-14T22:13:20.000Z' });
    expect(decodeTimestamp('1700000000000').some((d) => d.epoch === 'Unix milliseconds' && d.iso.startsWith('2023-11-14'))).toBe(true);
    expect(decodeTimestamp('133000000000000000').some((d) => d.epoch.startsWith('Windows FILETIME'))).toBe(true);
    expect(decodeTimestamp('12')).toEqual([]);
    expect(decodeTimestamp('hello')).toEqual([]);
  });
  it('decodes a Discord snowflake as an account creation time and offers an account entity', () => {
    const r = identify('175928847299117063');
    const d = r.find((x) => x.title.startsWith('Discord'))!;
    expect(d.iso).toBe('2016-04-30T11:18:25.796Z');
    expect(d.entity).toEqual({ type: 'account', value: 'https://discord.com/users/175928847299117063' });
  });
  it('recognises Steam64, UUIDs (version-aware), hashes, MACs and IPs', () => {
    expect(identify('76561198000000000')[0].kind).toBe('steam');
    expect(identify('069a79f4-44e9-4726-a5be-fca90e38aaf5')[0].title).toMatch(/Minecraft online-mode/);
    expect(identify('d41d8cd98f00b204e9800998ecf8427e')[0].title).toMatch(/MD5/);
    expect(identify('da39a3ee5e6b4b0d3255bfef95601890afd80709')[0].title).toMatch(/SHA-1/);
    const mac = identify('02:1a:2b:3c:4d:5e')[0];
    expect(mac.kind).toBe('mac'); expect(mac.facts.find((f) => f[0].startsWith('Randomised'))![1]).toMatch(/^Yes/);
    expect(identify('10.0.0.5')[0].facts[0][1]).toMatch(/private/);
    expect(identify('203.0.113.9')[0].facts[0][1]).toMatch(/documentation/);
    expect(identify('8.8.8.8')[0].facts[0][1]).toMatch(/public/);
    expect(identify('999.1.1.1').some((r) => r.kind === 'ip')).toBe(false);
  });
  it('decodes a JWT without a key, including its issue and expiry times', () => {
    const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: 'u1', iat: 1700000000, exp: 1700003600 })}.sig`;
    const r = identify(jwt)[0];
    expect(r.kind).toBe('jwt');
    expect(r.facts.find((f) => f[0] === 'exp')![1]).toContain('2023-11-14 23:13:20 UTC');
    expect(identify(`${b({ alg: 'none' })}.${b({ a: 1 })}.`)[0].facts.some((f) => f[0] === 'Warning')).toBe(true);
  });
  it('validates IBANs by checksum, spots wallets, base64 and hex text', () => {
    expect(identify('GB82 WEST 1234 5698 7654 32')[0].kind).toBe('iban');
    expect(identify('GB82 WEST 1234 5698 7654 33').some((r) => r.kind === 'iban')).toBe(false);
    expect(identify('0x52908400098527886E0F7030069857D2E4169EE7')[0].kind).toBe('wallet');
    expect(identify('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')[0].title).toMatch(/Bitcoin/);
    expect(identify('SGVsbG8sIHdvcmxkISBUaGlzIGlzIGEgdGVzdA==')[0]).toMatchObject({ kind: 'base64' });
    expect(identify('68656c6c6f20776f726c64')[0].facts[0][1]).toBe('hello world');
    expect(identify('')).toEqual([]);
  });
  it('time-based UUIDs reveal when and where they were made', () => {
    const r = identify('c232ab00-9414-11ec-b3c8-9f6bdeced846')[0]; // v1
    expect(r.facts.some((f) => f[0].startsWith('Created'))).toBe(true);
  });
});

describe('email guesser', () => {
  it('lists the common patterns for a company, most likely first, and folds accents', () => {
    const g = emailGuesses({ first: 'Zoë', last: "O'Brien", domain: 'acme.com' });
    expect(g[0]).toMatchObject({ email: 'zoe.obrien@acme.com', pattern: 'first.last' });
    expect(g.map((x) => x.email)).toContain('zobrien@acme.com');
    expect(new Set(g.map((x) => x.email)).size).toBe(g.length);
  });
  it('a known address teaches the pattern and reorders the rest', () => {
    expect(patternOf('jdoe@acme.com', 'Jane', 'Doe')).toBe('flast');
    const g = emailGuesses({ first: 'Sam', last: 'Lee', domain: 'acme.com', knownPattern: 'flast' });
    expect(g[0].email).toBe('slee@acme.com');
  });
  it('personal-provider mode tries the habits people have there; bad input gives nothing', () => {
    const g = emailGuesses({ first: 'Mara', last: 'Linden', domain: '', personal: true });
    expect(g.some((x) => x.email === 'maralinden@gmail.com')).toBe(true); expect(g.some((x) => x.email === 'mara.linden99@outlook.com')).toBe(true);
    expect(emailGuesses({ first: '', last: 'x', domain: 'a.com' })).toEqual([]);
    expect(emailGuesses({ first: 'a', last: 'b', domain: 'not a domain' })).toEqual([]);
  });
  it('Gravatar hash is the MD5 of the trimmed lower-case address (published example)', () => {
    expect(gravatarHash('  MyEmailAddress@example.com ')).toBe('0bc83cb571cd1c50ba6f3e8a78ef1346');
    expect(gravatarUrl('MyEmailAddress@example.com', 80)).toBe('https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=80&d=404');
  });
});

describe('look-alike and invisible characters', () => {
  it('finds a Cyrillic а hidden in "paypal" and shows what it looks like', () => {
    const r = inspectText('pаypal.com');
    expect(r.mixedScript).toBe(true); expect(r.skeleton).toBe('paypal.com');
    expect(r.findings.some((f) => f.level === 'bad' && /Mixes alphabets/.test(f.text))).toBe(true);
    expect(lookAlike('pаypal.com', 'paypal.com')).toBe(true); expect(lookAlike('paypal.com', 'paypal.com')).toBe(false); expect(lookAlike('paypal.com', 'paypa1.com')).toBe(false);
  });
  it('finds invisible characters and direction controls, and removes them', () => {
    const r = inspectText('mara​linden‮');
    expect(r.cleaned).toBe('maralinden');
    expect(r.findings.filter((f) => f.level === 'bad').length).toBe(2);
    expect(inspectText('hello world').findings[0].level).toBe('info');
    expect(inspectText('').length).toBe(0);
  });
  it('decodes punycode domains', () => {
    expect(punycodeDecode('bcher-kva')).toBe('bücher');
    expect(decodeIdn('xn--bcher-kva.example')).toBe('bücher.example');
    expect(decodeIdn('xn--80ak6aa92e.com')).toBe('аррӏе.com');
    expect(punycodeDecode('!!')).toBeNull();
  });
});

const A = (n: number) => Array.from({ length: n }, (_, i) => ['lol i dont even know what ur talking about tbh', 'yeah thats kinda what i said lol', 'idk man its fine whatever', 'omg no way thats so funny lol', 'i gotta go brb'][i % 5]).join('\n');
const A2 = (n: number) => Array.from({ length: n }, (_, i) => ['lol thats not what i meant tbh', 'i dont know ur just messing with me lol', 'yeah idk its whatever', 'omg i cant even', 'gotta go brb i think'][i % 5]).join('\n');
const B = (n: number) => Array.from({ length: n }, (_, i) => ['The committee has reviewed the proposal, and it will be presented to the board on Thursday.', 'We appreciate your patience; further details will follow in due course.', 'Please find the attached document, which outlines the revised schedule (see Appendix B).', 'Regrettably, the meeting has been postponed until further notice.', 'Thank you for your continued support of the programme.'][i % 5]).join(' ');
describe('writing-style matcher', () => {
  it('two samples with the same habits score higher than samples with different habits', () => {
    const same = compareStyle(A(60), A2(60)), diff = compareStyle(A(60), B(60));
    expect(same.similarity).toBeGreaterThan(diff.similarity + 0.2);
    expect(same.verdict).not.toBe('different'); expect(compareStyle(A(60), A(60)).verdict).toBe('very similar'); expect(diff.verdict).toBe('different');
  });
  it('refuses to judge tiny samples and flags thin ones', () => {
    expect(compareStyle('hi there', 'hello').verdict).toBe('too little text');
    const thin = compareStyle(A(10), A2(10));
    expect(thin.reliability).toBe('low'); expect(thin.notes.join(' ')).toMatch(/600 words/);
  });
  it('measures simple habits correctly', () => {
    const f = features('SO COOL!!! sooo good... lol i think. Yes!');
    expect(f.rate['repeated punctuation (!!, ??)']).toBeGreaterThan(0); expect(f.elongated).toBeGreaterThan(0); expect(f.allCaps).toBeGreaterThan(0); expect(f.lowerI).toBeGreaterThan(0);
  });
});

describe('phone reader', () => {
  it('formats a number and warns about fiction ranges and toll-free numbers', () => {
    const r = readPhone('+1 415 555 0132');
    expect(r.e164).toBe('+14155550132'); expect(r.flags.some((f) => /fiction/.test(f.text))).toBe(true);
    expect(readPhone('+1 800 275 2273').flags.some((f) => /toll-free/.test(f.text))).toBe(true);
    expect(readPhone('+44 7911 123456').valid).toBe(true);
  });
  it('without a country code lists the countries it could belong to', () => {
    const r = readPhone('07911 123456', 'US');
    expect(r.candidates.some((c) => c.country === 'GB')).toBe(true);
    expect(readPhone('nonsense').valid).toBe(false);
  });
});

describe('reverse image links', () => {
  it('builds links for every engine with the address encoded', () => {
    const l = reverseImageLinks('https://x.test/a b.jpg?x=1&y=2');
    expect(l.length).toBeGreaterThanOrEqual(5);
    for (const k of l) expect(k.url).toContain(encodeURIComponent('https://x.test/a b.jpg?x=1&y=2'));
  });
});
