import type { Claim, EntityType } from '../../shared/types';

export class RateLimitedError extends Error {
  constructor(public retryAfterMs = 0, msg = 'Rate limited') { super(msg); }
}
export class AuthError extends Error {
  constructor(msg = 'Invalid or missing API key') { super(msg); }
}
export class NeedsKeyError extends Error {
  constructor(msg = 'API key required') { super(msg); }
}

export interface Entity { type: EntityType; value: string; key: string }

export interface AdapterCtx {
  key?: string;
  signal: AbortSignal;
  fetch(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>;
  json<T = any>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T>;
  text(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<string>;
}

export interface Adapter {
  id: string;
  name: string;
  description: string;
  homepage?: string;
  accepts: EntityType[];
  /** Adapters sharing a capability are a fallback chain (see CAPABILITIES). */
  capability: string;
  /** Independence group. Adapters scraping the same underlying dataset share a family. */
  family: string;
  /** Prior trust in this source's claims, 0..1 (refined by user feedback). */
  reliability: number;
  /** Lower runs first within a chain. */
  priority: number;
  requiresKey?: string;
  keyOptional?: boolean;
  keyHelp?: string;
  /** Minimum ms between calls (rate limiting). */
  minIntervalMs?: number;
  cacheTtlMs?: number;
  /** Used by Settings → Sources → Test. Must be a stable, harmless public example. */
  selfTest: { type: EntityType; value: string };
  /** Offline demo adapters only run in demo mode, and live ones never run in demo mode. */
  demo?: boolean;
  run(entity: Entity, ctx: AdapterCtx): Promise<Claim[]>;
}

/**
 * How a capability chain executes.
 *  first: try adapters in priority order; stop at the first that returns results (fallback on error/empty/rate limit).
 *  all:   run every adapter (corroboration is valuable, or sources return disjoint data).
 */
export const CAPABILITY_MODE: Record<string, 'first' | 'all'> = {
  derive: 'all',
  dns: 'first',
  registration: 'first',
  subdomains: 'first',
  'passive-dns': 'first',
  'web-history': 'first',
  'ip-intel': 'first',
  geoip: 'first',
  'email-profile': 'all',
  'email-reputation': 'first',
  breaches: 'first',
  'code-profile': 'all',
  'username-sweep': 'all',
  'phone-intel': 'all',
  'org-registry': 'all',
  'public-figure': 'all',
  chain: 'all',
  'domain-emails': 'first',
  demo: 'all',
};
