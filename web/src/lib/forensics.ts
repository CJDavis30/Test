import type { Circadian } from '@shared/forensics/circadian';
import type { PlatformRef } from '@shared/forensics/ids';
import type { Match, Profile, Resolution } from '@shared/forensics/linker';

export type { Circadian, PlatformRef, Match, Profile, Resolution };
export interface MatchResponse { match: Match; a: Profile; b: Profile }
import type { Burst } from '@shared/forensics/bursts';
import type { DstResult } from '@shared/forensics/dst';
export type { Burst, DstResult };
import type { LookAlike } from '@shared/forensics/linker';
export type { LookAlike };
export type IdentitiesResponse = Resolution & { profiles: number; bursts: Burst[]; lookalikes: LookAlike[] };
import type { HeaderReport } from '@shared/forensics/headers';
export type { HeaderReport };
export interface ChatSummary { format: string; platform: string; total: number; localTime: boolean; note?: string; speakers: { id: string; name: string; messages: number; first: number; last: number; circadian: Circadian | null; dst: DstResult | null }[] }
import type { UrlReport } from '@shared/forensics/urls';
import type { MapLink } from '@shared/forensics/geo';
export type { UrlReport, MapLink };
export interface ScanResponse { refs: PlatformRef[]; links: UrlReport[]; places: { lat: number; lon: number; raw: string; description: string; links: MapLink[] }[]; timestamps: number; circadian: Circadian | null; dst: DstResult | null; headers: HeaderReport | null }

export const fmtWhen = (ms?: number, precision: 'second' | 'day' = 'second') => {
  if (ms === undefined) return 'unknown';
  const d = new Date(ms);
  return precision === 'day' ? d.toISOString().slice(0, 10) : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
};
export const pctText = (p: number) => (p >= 0.9999 ? '>99.99%' : p <= 0.0001 ? '<0.01%' : `${(p * 100).toFixed(p > 0.995 || p < 0.005 ? 2 : 1)}%`);
export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
