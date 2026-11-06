import { USER_AGENT } from './config';
import { AuthError, RateLimitedError, type AdapterCtx } from './adapters/types';

const DEFAULT_TIMEOUT = 15_000;

export function makeCtx(signal: AbortSignal, key?: string): AdapterCtx {
  const f: AdapterCtx['fetch'] = async (url, init = {}) => {
    const { timeoutMs = DEFAULT_TIMEOUT, ...rest } = init;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    const onAbort = () => ctl.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(url, {
        ...rest,
        signal: ctl.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*', ...(rest.headers as Record<string, string> | undefined) },
        redirect: (rest as RequestInit).redirect ?? 'follow',
      });
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        throw new RateLimitedError(Number.isFinite(ra) ? ra * 1000 : 0);
      }
      if (res.status === 401 || (res.status === 403 && key)) throw new AuthError(`HTTP ${res.status} — check the API key`);
      return res;
    } finally {
      clearTimeout(to);
      signal.removeEventListener('abort', onAbort);
    }
  };
  return {
    key,
    signal,
    fetch: f,
    json: async (url, init) => {
      const res = await f(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    text: async (url, init) => {
      const res = await f(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
  };
}

/** Serialises calls per key with a minimum spacing, so we are a polite client. */
export class Throttle {
  private last = new Map<string, number>();
  private chain = new Map<string, Promise<void>>();
  async wait(key: string, minMs: number): Promise<void> {
    if (!minMs) return;
    const prev = this.chain.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      const gap = (this.last.get(key) ?? 0) + minMs - Date.now();
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      this.last.set(key, Date.now());
    });
    this.chain.set(key, next.catch(() => {}));
    return next;
  }
}
