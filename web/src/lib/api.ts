import type { ApEvent, RunEvent } from '@shared/types';

const HEADERS = { 'content-type': 'application/json', 'x-plexus': '1' };

export class ApiError extends Error {}

/** Registered by the app: asks the person for a purpose when a live lookup needs one. Resolves true once it is saved. */
let purposeHandler: ((caseId: string) => Promise<boolean>) | null = null;
export const setPurposeHandler = (h: typeof purposeHandler) => { purposeHandler = h; };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (j as any).error ?? `HTTP ${res.status}`;
    if (msg === 'purpose_required') {
      const m = path.match(/\/api\/cases\/([^/]+)\//);
      if (m && purposeHandler && (await purposeHandler(m[1]))) return call<T>(method, path, body);
      throw new ApiError('A reason for the investigation is needed before live lookups.');
    }
    throw new ApiError(msg);
  }
  return j as T;
}

export const api = {
  get: <T,>(p: string) => call<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  patch: <T,>(p: string, b?: unknown) => call<T>('PATCH', p, b ?? {}),
  put: <T,>(p: string, b?: unknown) => call<T>('PUT', p, b ?? {}),
  del: <T,>(p: string) => call<T>('DELETE', p),
};

/** Subscribe to an Autopilot run. Returns a close function. */
export function streamAutopilot(id: string, onEvent: (e: ApEvent) => void, onEnd?: () => void): () => void {
  const es = new EventSource(`/api/autopilot/${id}/events`);
  let ended = false;
  const end = () => { if (ended) return; ended = true; es.close(); onEnd?.(); };
  es.onmessage = (m) => { try { const e = JSON.parse(m.data) as ApEvent; onEvent(e); if (e.t === 'ap.done' || e.t === 'ap.error') end(); } catch { /* ignore malformed frame */ } };
  es.onerror = () => end();
  return end;
}

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
