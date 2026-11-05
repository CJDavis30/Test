// Shared domain model. Used by the server (engine, adapters, store) and the web client.

export const ENTITY_TYPES = [
  'person', 'email', 'phone', 'username', 'domain', 'ip',
  'url', 'org', 'location', 'account', 'image', 'wallet', 'breach',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_LABEL: Record<EntityType, string> = {
  person: 'Person', email: 'Email', phone: 'Phone', username: 'Username',
  domain: 'Domain', ip: 'IP address', url: 'URL', org: 'Organization',
  location: 'Location', account: 'Account', image: 'Image', wallet: 'Wallet', breach: 'Data breach',
};

export type Level = 1 | 2 | 3 | 4;
export const LEVEL_LABEL: Record<Level, string> = { 1: 'Weak', 2: 'Fair', 3: 'Good', 4: 'Strong' };

export type FindingStatus = 'pending' | 'accepted' | 'rejected' | 'unsure';

/** The source's own record, quoted: a title plus the specific fields that matter ("Display name: Mara Linden"). */
export interface EvidenceRecord {
  title: string;
  facts: [label: string, value: string][];
}

/**
 * direct: the source returned this when asked about the thing you searched.
 * cross:  found later by a cross-check: we asked another source about something we'd found and compared its answer.
 */
export type EvidenceKind = 'direct' | 'cross';

/** One independent observation, from one source, backing (or, if polarity is "against", contradicting) a finding. */
export interface Evidence {
  id: string;
  adapter: string;
  adapterName: string;
  /** Sources sharing a family are NOT independent (e.g. two scrapers of the same dataset). */
  family: string;
  url?: string;
  snippet?: string;
  /** What we asked this source, in plain words ("Searched public certificate logs for names under example.com"). */
  how?: string;
  kind?: EvidenceKind;
  /** record: a page for this exact record. lookup: a page where you can repeat the same lookup yourself. */
  urlKind?: 'record' | 'lookup';
  polarity?: 'for' | 'against';
  /** The record the source returned (specific fields), when it has one. */
  record?: EvidenceRecord;
  /** Cross-checks: one line saying what the check showed ("Lists this email as its public email"). */
  verdict?: string;
  /** Cross-checks: which finding we asked about to get this. */
  via?: { findingId: string; label: string };
  retrievedAt: number;
  /** SHA-256 of exactly what Plexus recorded for this observation (source, question, page, quote, record, time). Re-checked on demand to prove it was not altered. */
  hash?: string;
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
  /** Optional per-claim override of what was asked. */
  how?: string;
  /** The source record this claim was read from, with its specific fields. */
  record?: EvidenceRecord;
  attrs?: Record<string, string | number | boolean>;
  /** Claims with the same conflictKey are mutually competing (e.g. "location"). */
  conflictKey?: string;
  /** Optional ISO date the underlying fact refers to (account created, cert issued…). */
  when?: string;
}

/** The outcome of asking one other source about a finding, so you can see what was checked and what it said. */
export interface CrossCheck {
  adapter: string;
  source: string;
  result: 'confirms' | 'contradicts' | 'neutral' | 'failed';
  /** One line: what the check showed. */
  note?: string;
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
  /** Other sources we asked about this finding (or about something it led to), and what each said. */
  checks?: CrossCheck[];
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
  /** Citation id (F1…) → finding id, so [F3] in the summary can link to its row. */
  cites: Record<string, string>;
  /** 'ai' if model-written (citation-validated), 'rules' if deterministic. */
  by: 'ai' | 'rules';
  model?: string;
  confidence: { score: number; level: Level; label: string; independentSources: number };
}

export interface LinkSuggestion {
  id: string;
  a: string;
  b: string;
  label: string;
  reason: string;
  score: number;
  kind: 'link' | 'merge';
  by: 'rules' | 'ai';
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
  /** Trust after learning from the investigator's accept/reject decisions (equals `reliability` until there are any). */
  trust: number;
  decisions: number;
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
  /** Hash-chain link: this entry's fingerprint, covering the one before it. */
  hash?: string;
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
