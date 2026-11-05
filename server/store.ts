import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { HOME } from './config';
import { sha256 } from './integrity';
import type {
  AuditEntry, CaseInfo, Evidence, Finding, FindingStatus, GraphEdge, GraphNode, RunInfo, SourceProgress,
} from '../shared/types';

const auditHash = (prev: string, id: string, caseId: string, ts: number, action: string, detail: string) => sha256([prev, id, caseId, ts, action, detail].join('\u241f'));

export const uid = (p = '') => p + randomUUID().replace(/-/g, '').slice(0, 14);

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  type TEXT NOT NULL, value TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, state TEXT NOT NULL,
  attrs TEXT NOT NULL DEFAULT '{}', score REAL, level INTEGER, x REAL, y REAL,
  pinned INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  UNIQUE(case_id, type, key)
);
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, to_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  label TEXT NOT NULL, strength REAL NOT NULL DEFAULT 0.5, kind TEXT NOT NULL, finding_id TEXT, created_at INTEGER NOT NULL,
  UNIQUE(case_id, from_id, to_id, label)
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE, run_id TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL, value TEXT NOT NULL, key TEXT NOT NULL, relation TEXT NOT NULL,
  attrs TEXT NOT NULL DEFAULT '{}', evidence TEXT NOT NULL DEFAULT '[]', checks TEXT,
  score REAL NOT NULL DEFAULT 0, rank REAL NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, reasons TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending', conflict_key TEXT, conflicts_with TEXT, when_at TEXT, created_at INTEGER NOT NULL,
  UNIQUE(case_id, subject_id, type, key)
);
CREATE INDEX IF NOT EXISTS idx_findings_case ON findings(case_id, status);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE, subject_id TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, ts INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  adapter TEXT NOT NULL, type TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(adapter, type)
);
CREATE TABLE IF NOT EXISTS source_state (
  adapter TEXT PRIMARY KEY, enabled INTEGER, priority INTEGER, ok INTEGER NOT NULL DEFAULT 0, fail INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, last_ok_at INTEGER, avg_ms REAL
);
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const j = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export class Store {
  db: DatabaseSync;
  constructor(path = join(HOME, 'plexus.db')) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    // Databases created before cross-checking existed get the new column; a second run finds it already there.
    try { this.db.exec('ALTER TABLE findings ADD COLUMN checks TEXT'); } catch { /* column already exists */ }
    // Audit entries are hash-chained (each covers the one before it) so edits or deletions show up when verified.
    try { this.db.exec('ALTER TABLE audit ADD COLUMN prev TEXT'); } catch { /* column already exists */ }
    try { this.db.exec('ALTER TABLE audit ADD COLUMN hash TEXT'); } catch { /* column already exists */ }
    this.path = path;
  }
  path: string;
  close() { this.db.close(); }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ---- settings ---------------------------------------------------------
  getSetting<T>(key: string, d: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return r ? j(r.value, d) : d;
  }
  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }

  // ---- cases ------------------------------------------------------------
  listCases(): CaseInfo[] {
    const rows = this.db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM nodes n WHERE n.case_id=c.id AND n.hidden=0) AS nc FROM cases c ORDER BY updated_at DESC`).all() as any[];
    return rows.map((r) => ({ id: r.id, name: r.name, purpose: r.purpose, createdAt: r.created_at, updatedAt: r.updated_at, nodeCount: r.nc }));
  }
  getCase(id: string): CaseInfo | null {
    const r = this.db.prepare('SELECT * FROM cases WHERE id=?').get(id) as any;
    return r ? { id: r.id, name: r.name, purpose: r.purpose, createdAt: r.created_at, updatedAt: r.updated_at } : null;
  }
  createCase(name: string, purpose = ''): CaseInfo {
    const id = uid('c_'), now = Date.now();
    this.db.prepare('INSERT INTO cases(id,name,purpose,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, name, purpose, now, now);
    this.audit(id, 'case.created', `${name}${purpose ? ` — ${purpose}` : ''}`);
    return this.getCase(id)!;
  }
  updateCase(id: string, patch: { name?: string; purpose?: string }) {
    const c = this.getCase(id); if (!c) return null;
    this.db.prepare('UPDATE cases SET name=?, purpose=?, updated_at=? WHERE id=?').run(patch.name ?? c.name, patch.purpose ?? c.purpose, Date.now(), id);
    return this.getCase(id);
  }
  touchCase(id: string) { this.db.prepare('UPDATE cases SET updated_at=? WHERE id=?').run(Date.now(), id); }
  deleteCase(id: string) {
    this.db.prepare('DELETE FROM audit WHERE case_id=?').run(id);
    this.db.prepare('DELETE FROM runs WHERE case_id=?').run(id);
    this.db.prepare('DELETE FROM cases WHERE id=?').run(id);
  }

  // ---- nodes ------------------------------------------------------------
  private nodeRow(r: any): GraphNode {
    return {
      id: r.id, caseId: r.case_id, type: r.type, value: r.value, label: r.label, state: r.state, attrs: j(r.attrs, {}),
      score: r.score ?? undefined, level: r.level ?? undefined, x: r.x ?? undefined, y: r.y ?? undefined,
      pinned: !!r.pinned, hidden: !!r.hidden, notes: r.notes || undefined, createdAt: r.created_at,
    };
  }
  listNodes(caseId: string): GraphNode[] {
    return (this.db.prepare('SELECT * FROM nodes WHERE case_id=? AND hidden=0 ORDER BY created_at').all(caseId) as any[]).map((r) => this.nodeRow(r));
  }
  getNode(id: string): GraphNode | null {
    const r = this.db.prepare('SELECT * FROM nodes WHERE id=?').get(id);
    return r ? this.nodeRow(r) : null;
  }
  findNode(caseId: string, type: string, key: string): (GraphNode & { key: string }) | null {
    const r = this.db.prepare('SELECT * FROM nodes WHERE case_id=? AND type=? AND key=?').get(caseId, type, key) as any;
    return r ? { ...this.nodeRow(r), key: r.key } : null;
  }
  upsertNode(n: { caseId: string; type: string; value: string; key: string; label?: string; state: 'seed' | 'confirmed'; attrs?: object; score?: number; level?: number; x?: number; y?: number }): GraphNode {
    const ex = this.findNode(n.caseId, n.type, n.key);
    if (ex) {
      this.db.prepare('UPDATE nodes SET hidden=0, state=CASE WHEN state=\'confirmed\' THEN state ELSE ? END, score=COALESCE(?,score), level=COALESCE(?,level), attrs=? WHERE id=?')
        .run(n.state, n.score ?? null, n.level ?? null, JSON.stringify({ ...ex.attrs, ...(n.attrs ?? {}) }), ex.id);
      return this.getNode(ex.id)!;
    }
    const id = uid('n_');
    this.db.prepare('INSERT INTO nodes(id,case_id,type,value,key,label,state,attrs,score,level,x,y,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, n.caseId, n.type, n.value, n.key, n.label ?? n.value, n.state, JSON.stringify(n.attrs ?? {}), n.score ?? null, n.level ?? null, n.x ?? null, n.y ?? null, Date.now());
    this.touchCase(n.caseId);
    return this.getNode(id)!;
  }
  patchNode(id: string, p: Partial<Pick<GraphNode, 'label' | 'notes' | 'pinned' | 'hidden' | 'x' | 'y'>>) {
    const n = this.getNode(id); if (!n) return null;
    this.db.prepare('UPDATE nodes SET label=?, notes=?, pinned=?, hidden=?, x=?, y=? WHERE id=?')
      .run(p.label ?? n.label, p.notes ?? n.notes ?? '', (p.pinned ?? n.pinned) ? 1 : 0, (p.hidden ?? n.hidden) ? 1 : 0, p.x ?? n.x ?? null, p.y ?? n.y ?? null, id);
    return this.getNode(id);
  }
  savePositions(items: { id: string; x: number; y: number; pinned?: boolean }[]) {
    const st = this.db.prepare('UPDATE nodes SET x=?, y=?, pinned=COALESCE(?,pinned) WHERE id=?');
    this.tx(() => items.forEach((i) => st.run(i.x, i.y, i.pinned === undefined ? null : i.pinned ? 1 : 0, i.id)));
  }
  deleteNode(id: string) { this.db.prepare('DELETE FROM nodes WHERE id=?').run(id); }

  /** Merge node `from` into `into`: rewires edges and findings, keeps attrs. */
  mergeNodes(intoId: string, fromId: string) {
    const into = this.getNode(intoId), from = this.getNode(fromId);
    if (!into || !from || into.id === from.id) return null;
    this.tx(() => {
      this.db.prepare('UPDATE OR IGNORE edges SET from_id=? WHERE from_id=?').run(intoId, fromId);
      this.db.prepare('UPDATE OR IGNORE edges SET to_id=? WHERE to_id=?').run(intoId, fromId);
      this.db.prepare('DELETE FROM edges WHERE from_id=to_id').run();
      this.db.prepare('UPDATE OR IGNORE findings SET subject_id=? WHERE subject_id=?').run(intoId, fromId);
      this.db.prepare('UPDATE nodes SET attrs=?, notes=? WHERE id=?').run(
        JSON.stringify({ ...from.attrs, ...into.attrs, [`alias_${from.type}`]: from.value }),
        [into.notes, from.notes].filter(Boolean).join('\n'), intoId);
      this.db.prepare('DELETE FROM nodes WHERE id=?').run(fromId);
    });
    return this.getNode(intoId);
  }

  // ---- edges ------------------------------------------------------------
  private edgeRow = (r: any): GraphEdge => ({
    id: r.id, caseId: r.case_id, from: r.from_id, to: r.to_id, label: r.label, strength: r.strength, kind: r.kind,
    findingId: r.finding_id ?? undefined, createdAt: r.created_at,
  });
  listEdges(caseId: string): GraphEdge[] {
    return (this.db.prepare('SELECT * FROM edges WHERE case_id=?').all(caseId) as any[]).map(this.edgeRow);
  }
  upsertEdge(e: { caseId: string; from: string; to: string; label: string; strength: number; kind: GraphEdge['kind']; findingId?: string }): GraphEdge {
    const ex = this.db.prepare('SELECT * FROM edges WHERE case_id=? AND from_id=? AND to_id=? AND label=?').get(e.caseId, e.from, e.to, e.label) as any;
    if (ex) {
      this.db.prepare('UPDATE edges SET strength=MAX(strength,?), kind=CASE WHEN kind=\'evidenced\' THEN kind ELSE ? END WHERE id=?').run(e.strength, e.kind, ex.id);
      return this.edgeRow(this.db.prepare('SELECT * FROM edges WHERE id=?').get(ex.id));
    }
    const id = uid('e_');
    this.db.prepare('INSERT INTO edges(id,case_id,from_id,to_id,label,strength,kind,finding_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, e.caseId, e.from, e.to, e.label, e.strength, e.kind, e.findingId ?? null, Date.now());
    return this.edgeRow(this.db.prepare('SELECT * FROM edges WHERE id=?').get(id));
  }
  deleteEdge(id: string) { this.db.prepare('DELETE FROM edges WHERE id=?').run(id); }
  setEdgeLabel(id: string, label: string) { this.db.prepare('UPDATE edges SET label=? WHERE id=?').run(label, id); }

  // ---- findings ---------------------------------------------------------
  private findingRow = (r: any): Finding => ({
    id: r.id, caseId: r.case_id, runId: r.run_id, subjectId: r.subject_id, type: r.type, value: r.value, key: r.key,
    relation: r.relation, attrs: j(r.attrs, {}), evidence: j<Evidence[]>(r.evidence, []), checks: j(r.checks, undefined as any), score: r.score, rank: r.rank,
    level: r.level, reasons: j(r.reasons, []), status: r.status as FindingStatus, conflictKey: r.conflict_key ?? undefined,
    conflictsWith: j(r.conflicts_with, undefined as any), when: r.when_at ?? undefined, createdAt: r.created_at,
  });
  getFinding(id: string) { const r = this.db.prepare('SELECT * FROM findings WHERE id=?').get(id); return r ? this.findingRow(r) : null; }
  listFindings(caseId: string, filter: { subjectId?: string; status?: FindingStatus[] } = {}): Finding[] {
    let sql = 'SELECT * FROM findings WHERE case_id=?'; const args: any[] = [caseId];
    if (filter.subjectId) { sql += ' AND subject_id=?'; args.push(filter.subjectId); }
    if (filter.status?.length) { sql += ` AND status IN (${filter.status.map(() => '?').join(',')})`; args.push(...filter.status); }
    return (this.db.prepare(sql + ' ORDER BY rank DESC').all(...args) as any[]).map(this.findingRow);
  }
  findFinding(caseId: string, subjectId: string, type: string, key: string) {
    const r = this.db.prepare('SELECT * FROM findings WHERE case_id=? AND subject_id=? AND type=? AND key=?').get(caseId, subjectId, type, key);
    return r ? this.findingRow(r) : null;
  }
  saveFinding(f: Finding) {
    this.db.prepare(`INSERT INTO findings(id,case_id,run_id,subject_id,type,value,key,relation,attrs,evidence,checks,score,rank,level,reasons,status,conflict_key,conflicts_with,when_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, relation=excluded.relation, attrs=excluded.attrs, evidence=excluded.evidence, checks=excluded.checks, score=excluded.score,
        rank=excluded.rank, level=excluded.level, reasons=excluded.reasons, status=excluded.status, conflict_key=excluded.conflict_key,
        conflicts_with=excluded.conflicts_with, when_at=excluded.when_at`)
      .run(f.id, f.caseId, f.runId, f.subjectId, f.type, f.value, f.key, f.relation, JSON.stringify(f.attrs), JSON.stringify(f.evidence), f.checks ? JSON.stringify(f.checks) : null,
        f.score, f.rank, f.level, JSON.stringify(f.reasons), f.status, f.conflictKey ?? null, f.conflictsWith ? JSON.stringify(f.conflictsWith) : null, f.when ?? null, f.createdAt);
  }
  setFindingStatus(id: string, status: FindingStatus) { this.db.prepare('UPDATE findings SET status=? WHERE id=?').run(status, id); }
  deleteFindingsForSubject(subjectId: string, statuses: FindingStatus[]) {
    this.db.prepare(`DELETE FROM findings WHERE subject_id=? AND status IN (${statuses.map(() => '?').join(',')})`).run(subjectId, ...statuses);
  }

  // ---- runs -------------------------------------------------------------
  createRun(caseId: string, subjectId: string, context: string): RunInfo {
    const id = uid('r_'), now = Date.now();
    this.db.prepare('INSERT INTO runs(id,case_id,subject_id,context,started_at,status) VALUES(?,?,?,?,?,?)').run(id, caseId, subjectId, context, now, 'running');
    return { id, caseId, subjectId, context, startedAt: now, status: 'running' };
  }
  finishRun(id: string, status: 'done' | 'error', sources: SourceProgress[]) {
    this.db.prepare('UPDATE runs SET status=?, finished_at=?, sources=? WHERE id=?').run(status, Date.now(), JSON.stringify(sources), id);
  }
  getRun(id: string): (RunInfo & { sources: SourceProgress[] }) | null {
    const r = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as any;
    return r ? { id: r.id, caseId: r.case_id, subjectId: r.subject_id, context: r.context, startedAt: r.started_at, finishedAt: r.finished_at ?? undefined, status: r.status, sources: j(r.sources, []) } : null;
  }
  latestRun(subjectId: string) {
    const r = this.db.prepare('SELECT id FROM runs WHERE subject_id=? ORDER BY started_at DESC LIMIT 1').get(subjectId) as any;
    return r ? this.getRun(r.id) : null;
  }

  /** Looks across every case for an entity by name, value or note. */
  searchAll(q: string, limit = 30): { caseId: string; caseName: string; nodeId: string; type: string; label: string; notes?: string }[] {
    const needle = `%${q.trim().toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    return (this.db.prepare(`SELECT n.id, n.case_id, n.type, n.label, n.notes, c.name AS case_name FROM nodes n JOIN cases c ON c.id=n.case_id
      WHERE n.hidden=0 AND (LOWER(n.label) LIKE ? ESCAPE '\\' OR LOWER(n.value) LIKE ? ESCAPE '\\' OR LOWER(n.notes) LIKE ? ESCAPE '\\') ORDER BY c.updated_at DESC, n.created_at DESC LIMIT ?`)
      .all(needle, needle, needle, limit) as any[]).map((r) => ({ caseId: r.case_id, caseName: r.case_name, nodeId: r.id, type: r.type, label: r.label, notes: r.notes || undefined }));
  }

  // ---- audit ------------------------------------------------------------
  audit(caseId: string, action: string, detail: string) {
    const id = uid('a_'), ts = Date.now(), d = detail.slice(0, 2000);
    const last = this.db.prepare('SELECT hash FROM audit WHERE case_id=? ORDER BY rowid DESC LIMIT 1').get(caseId) as { hash: string | null } | undefined;
    const prev = last?.hash ?? '';
    this.db.prepare('INSERT INTO audit(id,case_id,ts,action,detail,prev,hash) VALUES(?,?,?,?,?,?,?)').run(id, caseId, ts, action, d, prev, auditHash(prev, id, caseId, ts, action, d));
  }
  listAudit(caseId: string): AuditEntry[] {
    return (this.db.prepare('SELECT * FROM audit WHERE case_id=? ORDER BY ts DESC, rowid DESC LIMIT 1000').all(caseId) as any[])
      .map((r) => ({ id: r.id, caseId: r.case_id, ts: r.ts, action: r.action, detail: r.detail, hash: r.hash ?? undefined }));
  }
  /** Walks the whole chain. `broken` names the first entry that no longer fits (edited, or the one after a deleted entry). */
  verifyAudit(caseId: string): { ok: boolean; count: number; legacy: number; broken?: { id: string; ts: number; action: string } } {
    const rows = this.db.prepare('SELECT * FROM audit WHERE case_id=? ORDER BY rowid ASC').all(caseId) as any[];
    let expected = '', legacy = 0;
    for (const r of rows) {
      if (!r.hash) { legacy++; expected = ''; continue; }
      if ((r.prev ?? '') !== expected || auditHash(r.prev ?? '', r.id, r.case_id, r.ts, r.action, r.detail) !== r.hash) return { ok: false, count: rows.length, legacy, broken: { id: r.id, ts: r.ts, action: r.action } };
      expected = r.hash;
    }
    return { ok: true, count: rows.length, legacy };
  }

  // ---- safety: integrity check and backups ------------------------------
  integrityCheck(): string {
    try { return (this.db.prepare('PRAGMA integrity_check').all() as any[]).map((r) => Object.values(r)[0]).join('; '); } catch (e: any) { return String(e?.message ?? e); }
  }
  backupDir() { return join(dirname(this.path), 'backups'); }
  listBackups(): { name: string; size: number; at: number }[] {
    try {
      return readdirSync(this.backupDir()).filter((n) => /^plexus-.*\.db$/.test(n)).map((n) => { const st = statSync(join(this.backupDir(), n)); return { name: n, size: st.size, at: st.mtimeMs }; }).sort((a, b) => b.at - a.at);
    } catch { return []; }
  }
  /** A consistent copy of the whole database (VACUUM INTO), keeping the newest `keep`. */
  makeBackup(keep = 10): { name: string; size: number; at: number } {
    mkdirSync(this.backupDir(), { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
    let name = `plexus-${stamp}.db`;
    for (let i = 2; existsSync(join(this.backupDir(), name)); i++) name = `plexus-${stamp}-${i}.db`; // two backups in the same millisecond must never collide
    const file = join(this.backupDir(), name);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
    for (const old of this.listBackups().slice(keep)) { try { unlinkSync(join(this.backupDir(), old.name)); } catch { /* ignore */ } }
    const st = statSync(file);
    return { name, size: st.size, at: st.mtimeMs };
  }
  /** Backs up at most every `everyMs`, and only when there is something worth keeping. */
  autoBackup(everyMs = 6 * 3600_000) {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM cases').get() as any).n;
    if (!n) return null;
    const newest = this.listBackups()[0];
    if (newest && Date.now() - newest.at < everyMs) return null;
    return this.makeBackup();
  }

  // ---- feedback & source state -----------------------------------------
  bumpFeedback(adapter: string, type: string, field: 'accepted' | 'rejected', delta = 1) {
    this.db.prepare(`INSERT INTO feedback(adapter,type,${field}) VALUES(?,?,?) ON CONFLICT(adapter,type) DO UPDATE SET ${field}=MAX(0,${field}+?)`).run(adapter, type, Math.max(0, delta), delta);
  }
  allFeedback(): Map<string, { accepted: number; rejected: number }> {
    const m = new Map<string, { accepted: number; rejected: number }>();
    for (const r of this.db.prepare('SELECT * FROM feedback').all() as any[]) m.set(`${r.adapter}|${r.type}`, { accepted: r.accepted, rejected: r.rejected });
    return m;
  }
  feedbackByAdapter(): Map<string, { accepted: number; rejected: number }> {
    const m = new Map<string, { accepted: number; rejected: number }>();
    for (const r of this.db.prepare('SELECT adapter, SUM(accepted) AS a, SUM(rejected) AS r FROM feedback GROUP BY adapter').all() as any[]) m.set(r.adapter, { accepted: r.a ?? 0, rejected: r.r ?? 0 });
    return m;
  }
  getSourceState(adapter: string) {
    return this.db.prepare('SELECT * FROM source_state WHERE adapter=?').get(adapter) as any | undefined;
  }
  setSourceEnabled(adapter: string, enabled: boolean) {
    this.db.prepare('INSERT INTO source_state(adapter,enabled) VALUES(?,?) ON CONFLICT(adapter) DO UPDATE SET enabled=excluded.enabled').run(adapter, enabled ? 1 : 0);
  }
  setSourcePriority(adapter: string, priority: number) {
    this.db.prepare('INSERT INTO source_state(adapter,priority) VALUES(?,?) ON CONFLICT(adapter) DO UPDATE SET priority=excluded.priority').run(adapter, priority);
  }
  recordSource(adapter: string, ok: boolean, ms: number, error?: string) {
    const ex = this.getSourceState(adapter);
    const avg = ex?.avg_ms ? ex.avg_ms * 0.7 + ms * 0.3 : ms;
    this.db.prepare(`INSERT INTO source_state(adapter,ok,fail,last_error,last_ok_at,avg_ms) VALUES(?,?,?,?,?,?)
      ON CONFLICT(adapter) DO UPDATE SET ok=ok+?, fail=fail+?, last_error=?, last_ok_at=COALESCE(?,last_ok_at), avg_ms=?`)
      .run(adapter, ok ? 1 : 0, ok ? 0 : 1, error ?? null, ok ? Date.now() : null, avg, ok ? 1 : 0, ok ? 0 : 1, ok ? null : (error ?? null), ok ? Date.now() : null, avg);
  }

  // ---- cache ------------------------------------------------------------
  cacheGet<T>(key: string): T | null {
    const r = this.db.prepare('SELECT * FROM cache WHERE key=?').get(key) as any;
    if (!r) return null;
    if (r.expires_at < Date.now()) { this.db.prepare('DELETE FROM cache WHERE key=?').run(key); return null; }
    return j<T>(r.body, null as any);
  }
  cachePut(key: string, ttlMs: number, body: unknown) {
    this.db.prepare('INSERT INTO cache(key,expires_at,body) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at, body=excluded.body')
      .run(key, Date.now() + ttlMs, JSON.stringify(body));
  }
  cacheClear() { this.db.exec('DELETE FROM cache'); }
}
