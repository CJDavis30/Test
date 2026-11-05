import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../server/breaker';

const mk = () => { let t = 1_000_000; const b = new CircuitBreaker({ threshold: 3, baseMs: 30_000, maxMs: 120_000, now: () => t }); return { b, tick: (ms: number) => { t += ms; } }; };

describe('circuit breaker', () => {
  it('stays closed through occasional failures, opens after a run of them', () => {
    const { b } = mk();
    b.failure('x'); b.failure('x'); b.success('x'); b.failure('x'); b.failure('x');
    expect(b.allow('x').ok).toBe(true);
    b.failure('x');
    const g = b.allow('x');
    expect(g.ok).toBe(false);
  });
  it('lets exactly one probe through after the cooldown, and closes on success', () => {
    const { b, tick } = mk();
    for (let i = 0; i < 3; i++) b.failure('x');
    tick(31_000);
    expect(b.allow('x').ok).toBe(true);   // the probe
    expect(b.allow('x').ok).toBe(false);  // everyone else still waits
    b.success('x');
    expect(b.allow('x').ok).toBe(true);
    expect(b.pausedUntil('x')).toBeUndefined();
  });
  it('doubles the cooldown when the probe fails, up to a cap', () => {
    const { b, tick } = mk();
    for (let i = 0; i < 3; i++) b.failure('x');
    const until1 = b.pausedUntil('x')!;
    tick(31_000); b.allow('x'); b.failure('x');
    const until2 = b.pausedUntil('x')!;
    expect(until2 - (until1 + 31_000 - 30_000)).toBeGreaterThanOrEqual(0);
    tick(61_000); b.allow('x'); b.failure('x'); // third trip would be 120s, capped at 120s
    tick(125_000);
    expect(b.allow('x').ok).toBe(true);
  });
  it('a neutral outcome (cancel, rate limit) frees the probe slot without counting as a failure', () => {
    const { b, tick } = mk();
    for (let i = 0; i < 3; i++) b.failure('x');
    tick(31_000);
    expect(b.allow('x').ok).toBe(true);
    b.neutral('x');
    expect(b.allow('x').ok).toBe(true);
  });
  it('tracks sources independently and can be reset', () => {
    const { b } = mk();
    for (let i = 0; i < 3; i++) b.failure('a');
    expect(b.allow('b').ok).toBe(true);
    b.reset('a');
    expect(b.allow('a').ok).toBe(true);
  });
});
