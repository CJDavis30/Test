import { describe, it, expect } from 'vitest';
import { alternation, sittings } from '../shared/forensics/alternation';
import { TEMPLATE } from '../shared/forensics/circadian';

const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const cdf = (() => { const c: number[] = []; let a = 0; for (const p of TEMPLATE) c.push((a += p)); return c; })();

/** A person's sittings: bursts of messages (3–25 minutes) starting at hours drawn from the human day curve, a few per day. */
function person(r: () => number, offset: number, days: number, perDay: number, startDay = 0): { start: number; len: number }[] {
  const out: { start: number; len: number }[] = [];
  for (let d = 0; d < days; d++) for (let k = 0; k < perDay; k++) {
    const u = r(); const lh = Math.max(0, cdf.findIndex((x) => x >= u));
    const utc = (((lh - offset) % 24) + 24) % 24;
    out.push({ start: Date.UTC(2023, 0, 1) + (startDay + d) * 86_400_000 + utc * 3_600_000 + Math.floor(r() * 3_600_000), len: (3 + Math.floor(r() * 22)) * 60_000 });
  }
  return out;
}
const msgs = (s: { start: number; len: number }[], r: () => number) => s.flatMap((x) => { const n = 3 + Math.floor(r() * 6); return Array.from({ length: n }, (_, i) => x.start + Math.floor((x.len * i) / n)); });
/** One person with two accounts: every sitting is on one account or the other, never both, and sittings never overlap in time. */
function oneOperator(seed: number, days = 120, perDay = 8) {
  const r = rng(seed); const all = person(r, -6, days, perDay).sort((a, b) => a.start - b.start);
  const kept: typeof all = []; let end = 0; for (const s of all) if (s.start > end + 60_000) { kept.push(s); end = s.start + s.len; }
  const A: typeof all = [], B: typeof all = []; for (const s of kept) (r() < 0.5 ? A : B).push(s);
  return { a: msgs(A, r), b: msgs(B, r) };
}
function twoPeople(seed: number, days = 120, perDay = 4) {
  const r1 = rng(seed), r2 = rng(seed + 7919);
  return { a: msgs(person(r1, -6, days, perDay), r1), b: msgs(person(r2, -6, days, perDay), r2) };
}

describe('alternation test', () => {
  it('groups bursts of messages into sittings', () => {
    const t0 = Date.UTC(2024, 0, 1, 20);
    expect(sittings([t0, t0 + 60_000, t0 + 5 * 60_000, t0 + 3 * 3_600_000]).length).toBe(2);
    expect(sittings([])).toEqual([]);
  });
  it('says nothing when there is too little activity to judge', () => {
    const o = oneOperator(1, 6, 2); expect(alternation(o.a, o.b)).toBeNull();
  });
  it('detects one person taking turns: strongly positive, and well above zero almost every time', () => {
    let positive = 0, n = 0;
    for (let s = 1; s <= 20; s++) { const o = oneOperator(s); const r = alternation(o.a, o.b); if (!r) continue; n++; if (r.bits > 3) positive++; expect(r.observed).toBeLessThanOrEqual(1); }
    expect(n).toBeGreaterThanOrEqual(15); expect(positive / n).toBeGreaterThanOrEqual(0.8);
  });
  it('shows two independent people with the same hours as negative evidence, never as a link', () => {
    let falseLinks = 0, n = 0;
    for (let s = 1; s <= 40; s++) { const o = twoPeople(s * 13); const r = alternation(o.a, o.b); if (!r) continue; n++; if (r.bits > 3) falseLinks++; }
    expect(n).toBeGreaterThanOrEqual(30);
    expect(falseLinks / n).toBeLessThanOrEqual(0.05); // false-positive rate for calling two people one operator
  });
  it('is capped, so a model mistake cannot manufacture certainty', () => {
    const o = oneOperator(3); const r = alternation(o.a, o.b)!; expect(r.bits).toBeLessThanOrEqual(15);
    const t = twoPeople(5); expect(alternation(t.a, t.b)!.bits).toBeGreaterThanOrEqual(-6);
  });
  it('explains itself in plain words', () => {
    const o = oneOperator(4); const r = alternation(o.a, o.b)!;
    expect(r.detail).toMatch(/sittings/); expect(r.assumption).toMatch(/Capped/);
  });
});
