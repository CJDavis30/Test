/**
 * Circuit breaker for sources. A source that keeps failing (down, blocked, broken) is paused for a while instead of
 * making every lookup wait for its timeout; the next source in the fallback chain answers straight away. After the
 * cooldown it gets one trial call: success closes the circuit, failure doubles the cooldown (up to a cap).
 * Rate limits, missing keys and user cancellations are not failures of the source and never trip it.
 */
export interface BreakerOptions { threshold: number; baseMs: number; maxMs: number; now: () => number }

interface State { fails: number; trips: number; openUntil: number; probing: boolean }

export class CircuitBreaker {
  private s = new Map<string, State>();
  constructor(private o: BreakerOptions = { threshold: 3, baseMs: 30_000, maxMs: 15 * 60_000, now: Date.now }) {}

  private st(id: string): State { let x = this.s.get(id); if (!x) { x = { fails: 0, trips: 0, openUntil: 0, probing: false }; this.s.set(id, x); } return x; }

  /** May this source be called now? While open: no. Once the cooldown is over exactly one caller gets through to probe. */
  allow(id: string): { ok: true } | { ok: false; until: number; fails: number } {
    const x = this.st(id), t = this.o.now();
    if (x.openUntil === 0) return { ok: true };
    if (t < x.openUntil) return { ok: false, until: x.openUntil, fails: x.fails };
    if (x.probing) return { ok: false, until: t + 1000, fails: x.fails }; // someone else is already probing
    x.probing = true;
    return { ok: true };
  }
  success(id: string) { const x = this.st(id); x.fails = 0; x.trips = 0; x.openUntil = 0; x.probing = false; }
  failure(id: string) {
    const x = this.st(id);
    x.fails++;
    if (x.probing || x.fails >= this.o.threshold) {
      x.trips++;
      x.openUntil = this.o.now() + Math.min(this.o.maxMs, this.o.baseMs * 2 ** (x.trips - 1));
      x.probing = false;
    }
  }
  /** The call ended without telling us anything about the source's health (cancelled, rate-limited): release a probe slot. */
  neutral(id: string) { const x = this.st(id); if (x.probing) { x.probing = false; } }
  reset(id?: string) { if (id) this.s.delete(id); else this.s.clear(); }
  pausedUntil(id: string): number | undefined { const x = this.s.get(id); return x && x.openUntil > this.o.now() ? x.openUntil : undefined; }
}

export const breaker = new CircuitBreaker();

export class PausedError extends Error {
  constructor(public until: number, public fails: number) { super(`Paused after ${fails} failures in a row`); }
}
