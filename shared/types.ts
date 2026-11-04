// Shared domain model. Used by the server (engine, adapters, store) and the web client.

export const ENTITY_TYPES = [
  'person', 'email', 'phone', 'username', 'domain', 'ip',
  'url', 'org', 'location', 'account', 'image', 'wallet',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_LABEL: Record<EntityType, string> = {
  person: 'Person', email: 'Email', phone: 'Phone', username: 'Username',
  domain: 'Domain', ip: 'IP address', url: 'URL', org: 'Organization',
  location: 'Location', account: 'Account', image: 'Image', wallet: 'Wallet',
};

export type Level = 1 | 2 | 3 | 4;
export const LEVEL_LABEL: Record<Level, string> = { 1: 'Weak', 2: 'Fair', 3: 'Good', 4: 'Strong' };

export type FindingStatus = 'pending' | 'accepted' | 'rejected' | 'unsure';

/** One independent observation, from one source, backing a finding. */
export interface Evidence {
  id: string;
  adapter: string;
  adapterName: string;
  /** Sources sharing a family are NOT independent (e.g. two scrapers of the same dataset). */
  family: string;
  url?: string;
  snippet?: string;
  retrievedAt: number;
  /** How strongly this single observation supports the claim, 0..1. */
  weight: number;
}

/** A claim an adapter returns. The orchestrator turns claims into Findings. */
export interface Claim {
  type: EntityType;
  value: string;
  /** Edge label from the subject: "has email", "registered at"… */
  relation: string;
  weight: number;
  url?: string;
  snippet?: string;
  attrs?: Record<string, string | number | boolean>;
  /** Claims with the same conflictKey are mutually competing (e.g. "location"). */
  conflictKey?: string;
  /** Optional ISO date the underlying fact refers to (account created, cert issued…). */
  when?: string;
}

export interface Finding {
  id: string;
  caseId: string;
  runId: string;
  subjectId: string;
  type: EntityType;
  value: string;
  key: string;
  relation: string;
  attrs: Record<string, string | number | boolean>;
  evidence: Evidence[];
  /** Calibrated belief that the claim is true. */
  score: number;
  /** Ordering score = score + context relevance. Never shown as confidence. */
  rank: number;
  level: Level;
  reasons: string[];
  status: FindingStatus;
  conflictKey?: string;
  conflictsWith?: string[];
  when?: string;
  createdAt: number;
}

export interface GraphNode {
  id: string;
  caseId: string;
  type: EntityType;
  value: string;
  label: string;
  /** pending = seeded or inferred, not yet reviewed; confirmed = user accepted. */
  state: 'seed' | 'confirmed';
  attrs: Record<string, string | number | boolean>;
  score?: number;
  level?: Level;
  x?: number;
  y?: number;
  pinned?: boolean;
  hidden?: boolean;
  notes?: string;
  createdAt: number;
}

export interface GraphEdge {
  id: string;
  caseId: string;
  from: string;
  to: string;
  label: string;
  strength: number;
  /** inferred = proposed by AI/heuristics, evidenced = backed by accepted findings. */
  kind: 'evidenced' | 'inferred' | 'manual';
  findingId?: string;
  createdAt: number;
}

export interface CaseInfo {
  id: string;
  name: string;
  purpose: string;
  createdAt: number;
  updatedAt: number;
  nodeCount?: number;
}

export type SourceState = 'queued' | 'running' | 'done' | 'empty' | 'error' | 'rate_limited' | 'skipped' | 'needs_key';

export interface SourceProgress {
  adapter: string;
  name: string;
  capability: string;
  state: SourceState;
  count: number;
  ms?: number;
  error?: string;
  cached?: boolean;
  /** When a source was skipped because an earlier one in its fallback chain succeeded. */
  note?: string;
}

export interface Brief {
  headline: string;
  summary: string;
  caveats: string[];
  /** 'ai' if model-written (citation-validated), 'rules' if deterministic. */
  by: 'ai' | 'rules';
  model?: string;
  confidence: { score: number; level: Level; label: string; independentSources: number };
}

export interface NextStep {
  type: EntityType;
  value: string;
  reason: string;
  score: number;
  findingId?: string;
}

export interface RunInfo {
  id: string;
  caseId: string;
  subjectId: string;
  context: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'done' | 'error';
}

export type RunEvent =
  | { t: 'run.started'; run: RunInfo; sources: SourceProgress[] }
  | { t: 'source'; progress: SourceProgress }
  | { t: 'findings'; findings: Finding[] }
  | { t: 'brief'; brief: Brief; next: NextStep[] }
  | { t: 'run.done'; run: RunInfo; totals: { findings: number; sources: number; ok: number } }
  | { t: 'run.error'; message: string };

export interface CaseSnapshot {
  case: CaseInfo;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Pending/unsure findings that have not been decided (resumable review). */
  findings: Finding[];
}

export interface SourceInfo {
  id: string;
  name: string;
  description: string;
  homepage?: string;
  accepts: EntityType[];
  capability: string;
  requiresKey?: string;
  keyOptional?: boolean;
  keyHelp?: string;
  enabled: boolean;
  keySet: boolean;
  priority: number;
  health: { ok: number; fail: number; lastError?: string; lastOkAt?: number; avgMs?: number };
  reliability: number;
  demo?: boolean;
}

export interface AiSettings {
  provider: 'openrouter' | 'google' | 'openai' | 'ollama' | 'custom' | 'none';
  model: string; // '' = auto
  baseUrl?: string;
  keySet: boolean;
  allowCloud: boolean;
}

export interface AuditEntry {
  id: string;
  caseId: string;
  ts: number;
  action: string;
  detail: string;
}

export interface Detected {
  type: EntityType;
  value: string;
  confidence: number;
  alternatives: { type: EntityType; value: string }[];
}
