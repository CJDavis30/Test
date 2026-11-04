import type { RunEvent } from '@shared/types';

const HEADERS = { 'content-type': 'application/json', 'x-plexus': '1' };

export class ApiError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((j as any).error ?? `HTTP ${res.status}`);
  return j as T;
}

export const api = {
  get: <T,>(p: string) => call<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  patch: <T,>(p: string, b?: unknown) => call<T>('PATCH', p, b ?? {}),
  put: <T,>(p: string, b?: unknown) => call<T>('PUT', p, b ?? {}),
  del: <T,>(p: string) => call<T>('DELETE', p),
};

/** Subscribe to a lookup's progress. Returns a close function. */
export function streamRun(runId: string, onEvent: (e: RunEvent) => void, onEnd?: () => void): () => void {
  const es = new EventSource(`/api/runs/${runId}/events`);
  let ended = false;
  const end = () => { if (ended) return; ended = true; es.close(); onEnd?.(); };
  es.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data) as RunEvent;
      onEvent(e);
      if (e.t === 'run.done' || e.t === 'run.error') end();
    } catch { /* ignore malformed frame */ }
  };
  es.onerror = () => end();
  return end;
}
