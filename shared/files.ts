import type { EntityType } from './types';
import type { MapLink } from './forensics/geo';

/** What looking inside a file produces. Everything here comes from the file's own bytes; nothing is looked up. */
export type Importance = 0 | 1 | 2 | 3;               // 3 = the headline: the thing you would want to see first
export type FactGroup = 'where' | 'when' | 'who' | 'device' | 'edit' | 'content' | 'file';

export interface Fact { group: FactGroup; label: string; value: string; importance: Importance; note?: string }
export interface Flag { id: string; severity: 'info' | 'notice' | 'warning'; title: string; detail: string }
export interface TimeEvidence { label: string; iso: string; offsetMin?: number; kind: 'captured' | 'created' | 'modified' | 'exported' | 'filename' | 'gps' | 'other'; source: string }
export interface GeoPoint { lat: number; lon: number; altitude?: number; heading?: number; accuracyM?: number; source: string; method?: string; description: string; links: MapLink[] }
export interface Leak { kind: 'email' | 'url' | 'user-path' | 'host' | 'ip' | 'mac' | 'secret' | 'coords'; value: string; context?: string; interesting: boolean }
export interface ProposedEntity { type: EntityType; value: string; why: string; confidence: 'high' | 'medium' | 'low' }
export interface DeviceInfo { make?: string; model?: string; serial?: string; lensModel?: string; lensSerial?: string; owner?: string; software?: string; fingerprint: string }
export interface PixelStats { luma: number; sky: number; dhash: string; width: number; height: number }

export interface FileReport {
  id?: string;
  name: string; size: number; kind: string; label: string; mime?: string;
  sha256: string; sha1: string; md5: string;
  facts: Fact[]; headline: Fact[]; flags: Flag[]; times: TimeEvidence[];
  location?: GeoPoint; device?: DeviceInfo; leaks: Leak[]; entities: ProposedEntity[];
  dims?: { width: number; height: number }; durationSec?: number;
  /** Timezone the device was set to when the file was made, as far as the file shows. */
  tz?: { offsetMin: number; source: string };
  pixels?: PixelStats;
  analyzedAt: number;
}
