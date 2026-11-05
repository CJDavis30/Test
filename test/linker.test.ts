import { describe, it, expect } from 'vitest';
import { compareHandles, parseHandle, rarityBits, variants } from '../shared/forensics/username';
import { linkProfiles, creationTimeBits, circadianBits, bitsToProb, probToBits, oneIn, resolveIdentities, type Profile } from '../shared/forensics/linker';
import { circadian, TEMPLATE } from '../shared/forensics/circadian';

describe('handle model', () => {
  it('understands decoration, leetspeak and trailing years', () => {
    expect(parseHandle('xX_MaraLinden_Xx').clean).toBe('maralinden');
    expect(parseHandle('m4r4l1nd3n').core).toBe('maralinden');   // leetspeak folds back to the name
    expect(parseHandle('maralinden2009').core).toBe('maralinden');
    expect(parseHandle('maralinden2009').trailingDigits).toBe('2009');
  });
  it('ranks agreement by how surprising it is: rare > common, identical > folded > shared word > near > different', () => {
    const rare = compareHandles('maralinden', 'maralinden'), common = compareHandles('gamer', 'gamer');
    const folded = compareHandles('maralinden', 'xX_maralinden2009_Xx'), token = compareHandles('maralinden_art', 'bob_maralinden'), near = compareHandles('maralindenn', 'maralinden');
    const diff = compareHandles('maralinden', 'zebulonquarrel');
    expect(rare.bits).toBeGreaterThan(common.bits);
    expect(common.bits).toBeLessThanOrEqual(6);
    expect(rare.bits).toBeGreaterThanOrEqual(folded.bits);
    expect(folded.bits).toBeGreaterThan(token.bits - 0.001);
    expect(token.bits).toBeGreaterThan(0);
    expect(near.kind === 'identical').toBe(false);
    expect(diff.bits).toBeLessThan(0); expect(diff.kind).toBe('different');
  });
  it('caps what a name can prove, because copying a handle is easy', () => {
    expect(compareHandles('maralinden', 'maralinden').bits).toBeLessThanOrEqual(8);
    expect(compareHandles('qzxvkpwjrtmnbq', 'qzxvkpwjrtmnbq').bits).toBeLessThanOrEqual(8);
  });
  it('rates random-looking strings as more surprising than words, and common handle words as nearly nothing', () => {
    expect(rarityBits('xkqzvtrw')).toBeGreaterThan(rarityBits('sunshine'));
    expect(rarityBits('the')).toBe(6);
  });
  it('suggests believable variants without repeating the original', () => {
    const v = variants('maralinden');
    expect(v.length).toBeGreaterThan(5); expect(v).not.toContain('maralinden'); expect(new Set(v).size).toBe(v.length);
    expect(v).toContain('mara_linden'.replace('mara_', 'maralinden_').slice(0, 0) + 'maralinden_');
  });
});

describe('the arithmetic of evidence', () => {
  it('converts between bits and probability both ways', () => {
    expect(bitsToProb(0)).toBeCloseTo(0.5, 12); expect(bitsToProb(10)).toBeCloseTo(1024 / 1025, 9);
    for (const p of [0.01, 0.3, 0.9, 0.999]) expect(bitsToProb(probToBits(p))).toBeCloseTo(p, 9);
  });
  it('says "1 in N" in plain words', () => {
    expect(oneIn(0)).toBe('1 in 1'); expect(oneIn(10)).toMatch(/1 in 1,000/); expect(oneIn(23)).toMatch(/million/); expect(oneIn(35)).toMatch(/billion/);
  });
});

describe('creation-time coincidence', () => {
  const t0 = Date.UTC(2021, 2, 4, 19, 22, 11);
  it('is strong for minutes, modest for the same day, and neutral beyond', () => {
    const sec = creationTimeBits(t0, t0 + 40_000).bits, hr = creationTimeBits(t0, t0 + 2 * 3600_000).bits, far = creationTimeBits(t0, t0 + 30 * 86400_000).bits;
    expect(sec).toBeGreaterThan(12); expect(sec).toBeLessThan(15);
    expect(hr).toBeGreaterThan(6); expect(hr).toBeLessThan(sec);
    expect(far).toBeLessThan(0); expect(far).toBeGreaterThan(-0.5);
  });
  it('treats date-only timestamps with the care they deserve', () => {
    const same = creationTimeBits(Date.UTC(2021, 2, 4), Date.UTC(2021, 2, 4, 23), 'day').bits, diff = creationTimeBits(Date.UTC(2021, 2, 4), Date.UTC(2021, 2, 9), 'day').bits;
    expect(same).toBeGreaterThan(7); expect(same).toBeLessThan(creationTimeBits(t0, t0 + 40_000).bits); expect(diff).toBeLessThan(0);
  });
  it('is a proper likelihood ratio: its average over unrelated pairs is exactly 1 (the defining property)', () => {
    let seed = 99; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const SPAN = 8 * 365.25 * 86400 * 1000; let sum = 0; const N = 600_000;
    for (let i = 0; i < N; i++) sum += 2 ** creationTimeBits(0, r() * SPAN).bits;
    expect(sum / N).toBeGreaterThan(0.9); expect(sum / N).toBeLessThan(1.15);
  });
  it('is calibrated against its own generative model: pairs it calls 99% are the same ~99% of the time', () => {
    let seed = 7; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const SPAN = 8 * 365.25 * 86400 * 1000; const buckets = [{ lo: 0, hi: 0.2, n: 0, same: 0, p: 0 }, { lo: 0.2, hi: 0.8, n: 0, same: 0, p: 0 }, { lo: 0.8, hi: 1.01, n: 0, same: 0, p: 0 }];
    for (let i = 0; i < 200_000; i++) {
      const same = r() < 0.5; let gap: number;
      if (!same) gap = r() * SPAN; else { const u = r(); gap = u < 0.05 ? r() * 600_000 : u < 0.12 ? r() * 43_200_000 : r() * SPAN; }
      const p = bitsToProb(creationTimeBits(0, gap).bits); // prior odds 1: the bits ARE the log posterior odds
      const b = buckets.find((x) => p >= x.lo && p < x.hi)!; b.n++; b.p += p; if (same) b.same++;
    }
    for (const b of buckets) if (b.n > 500) expect(Math.abs(b.p / b.n - b.same / b.n), `${b.lo}-${b.hi}`).toBeLessThan(0.03);
  });
});

describe('linking two profiles', () => {
  const t0 = Date.UTC(2021, 2, 4, 19, 22, 11);
  const roblox: Profile = { id: 'r', label: 'Roblox', platform: 'Roblox', handle: 'maralinden', createdAt: t0, createdPrecision: 'second' };
  const discord: Profile = { id: 'd', label: 'Discord', platform: 'Discord', handle: 'maralinden', createdAt: t0 + 40_000, createdPrecision: 'second' };
  const decoy: Profile = { id: 'x', label: 'Impostor', platform: 'Discord', handle: 'maralinden_', createdAt: Date.UTC(2024, 5, 1), createdPrecision: 'second' };
  it('a matching rare handle plus a creation time seconds apart is conclusive, and a copied handle created years later is not', () => {
    const real = linkProfiles(roblox, discord), fake = linkProfiles(roblox, decoy);
    expect(real.posterior).toBeGreaterThan(0.999); expect(real.verdict).toBe('same');
    expect(fake.posterior).toBeLessThan(0.9); expect(fake.verdict).not.toBe('same');
    expect(real.posterior).toBeGreaterThan(fake.posterior);
  });
  it('the bits add up: posterior bits = prior + the signals, with correlated name signals not double-counted', () => {
    const m = linkProfiles(roblox, discord);
    const handle = m.signals.find((s) => s.key === 'handle')!.bits, created = m.signals.find((s) => s.key === 'created')!.bits;
    expect(m.evidenceBits).toBeCloseTo(handle + created, 9);
    expect(m.totalBits).toBeCloseTo(m.priorBits + m.evidenceBits, 9);
    const withName = linkProfiles({ ...roblox, displayName: 'Mara Linden' }, { ...discord, displayName: 'Mara Linden' });
    const nameOnly = withName.signals.filter((s) => s.group === 'name').map((s) => s.bits).sort((a, b) => b - a);
    expect(withName.evidenceBits).toBeLessThan(handle + created + nameOnly[1]); // second name signal counted at most half
  });
  it('the prior matters: the same evidence is less convincing when matches are rarer', () => {
    expect(linkProfiles(roblox, discord, { priorOdds: 1e-6 }).posterior).toBeLessThan(linkProfiles(roblox, discord, { priorOdds: 1 / 50 }).posterior);
  });
  it('shared contact details, avatar and self-links each add evidence; absence adds none', () => {
    const base = linkProfiles({ id: 'a', label: 'a', handle: 'zzyzx' }, { id: 'b', label: 'b', handle: 'qwerty' });
    const more = linkProfiles({ id: 'a', label: 'a', handle: 'zzyzx', contacts: ['a@b.example'], avatarHash: 'h1' }, { id: 'b', label: 'b', handle: 'qwerty', contacts: ['a@b.example'], avatarHash: 'h1' });
    expect(more.evidenceBits).toBeGreaterThan(base.evidenceBits + 30);
    expect(base.signals.every((s) => s.key === 'handle')).toBe(true);
  });
  it('different timezones count against a link, matching ones for it', () => {
    const mk = (off: number, seed: number) => { let s = seed; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); const cdf: number[] = []; let c = 0; for (const p of TEMPLATE) cdf.push((c += p)); const t: number[] = []; for (let i = 0; i < 200; i++) { const lh = cdf.findIndex((x) => x >= r() * c); t.push(Date.UTC(2023, 0, 1) + Math.floor(r() * 400) * 86400000 + ((((lh < 0 ? 23 : lh) - off) % 24 + 24) % 24) * 3600000); } return circadian(t)!; };
    const us1 = mk(-6, 1), us2 = mk(-6, 2), asia = mk(9, 3);
    expect(circadianBits(us1, us2)!.bits).toBeGreaterThan(3);
    expect(circadianBits(us1, asia)!.bits).toBeLessThan(-3);
    expect(circadianBits({ ...us1, strength: 'insufficient' }, us2)).toBeNull();
  });
});

describe('identity resolution', () => {
  const t0 = Date.UTC(2021, 2, 4, 19, 22, 11);
  const P = (id: string, handle: string, platform: string, createdAt: number, extra: Partial<Profile> = {}): Profile => ({ id, label: `${platform} ${handle}`, platform, handle, createdAt, createdPrecision: 'second', ...extra });
  const profiles = [
    P('rob', 'maralinden', 'Roblox', t0), P('dis', 'maralinden', 'Discord', t0 + 41_000), P('gh', 'mara-linden', 'GitHub', Date.UTC(2014, 4, 19, 10), { contacts: ['mara@x.example'] }),
    P('mail', 'maralinden', 'Steam', Date.UTC(2017, 0, 5), { contacts: ['mara@x.example'] }),
    P('ns', 'mlinden', 'Reddit', Date.UTC(2019, 8, 9, 4)), P('ns2', 'mlinden', 'Instagram', Date.UTC(2019, 8, 9, 4, 2)),
    P('z', 'zebulonq', 'Twitch', Date.UTC(2020, 1, 1)),
  ];
  it('puts the same operator together, keeps strangers and look-alikes apart, and lists the maybes', () => {
    const r = resolveIdentities(profiles);
    const idOf = (id: string) => r.identities.find((i) => i.members.some((m) => m.id === id))!;
    expect(idOf('rob')).toBe(idOf('dis'));          // handle + minutes apart
    expect(idOf('ns')).toBe(idOf('ns2')); // a second person, linked to each other by time
    expect(idOf('z').members.length).toBe(1);
    expect(idOf('ns')).not.toBe(idOf('rob'));
    expect(r.identities.length).toBeGreaterThanOrEqual(3);
  });
  it('refuses to merge people it has been told are different, even if they look identical', () => {
    const r = resolveIdentities(profiles, { cannotLink: [['rob', 'dis']] });
    expect(r.identities.find((i) => i.members.some((m) => m.id === 'rob'))!.members.map((m) => m.id)).not.toContain('dis');
    expect(r.separated.length).toBeGreaterThan(0);
  });
  it('is stable: the same input gives the same groups regardless of order', () => {
    const a = resolveIdentities(profiles), b = resolveIdentities([...profiles].reverse());
    const sig = (r: ReturnType<typeof resolveIdentities>) => r.identities.map((i) => i.members.map((m) => m.id).sort().join('+')).sort().join('|');
    expect(sig(a)).toBe(sig(b));
  });
});
