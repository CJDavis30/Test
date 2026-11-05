import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'plexus-int-'));
process.env.PLEXUS_HOME = home;
const { Store, uid } = await import('../server/store');
const { fingerprint, verifyEvidence } = await import('../server/integrity');
import type { Evidence, Finding } from '../shared/types';

const ev = (): Evidence => fingerprint({ id: uid('ev_'), adapter: 'x', adapterName: 'X', family: 'x', how: 'Asked X', snippet: 'Lists jo@example.com', retrievedAt: 1_700_000_000_000, weight: 0.7, kind: 'direct' });
const finding = (e: Evidence[]): Finding => ({ id: 'f1', value: 'Jo', evidence: e } as unknown as Finding);

describe('evidence fingerprints', () => {
  it('seals each observation and re-verifies cleanly', () => {
    const e = ev();
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyEvidence([finding([e])])).toEqual({ checked: 1, unsealed: 0, altered: [] });
  });
  it('catches an edited quote, record, link or timestamp', () => {
    for (const edit of [{ snippet: 'Lists someone@else.com' }, { url: 'https://evil.example' }, { retrievedAt: 1 }, { record: { title: 't', facts: [['a', 'b']] as [string, string][] } }]) {
      const r = verifyEvidence([finding([{ ...ev(), ...edit }])]);
      expect(r.altered.length, JSON.stringify(edit)).toBe(1);
    }
  });
  it('does not flag changes that are not part of the record (weight is recomputed as sources are trusted more or less)', () => {
    expect(verifyEvidence([finding([{ ...ev(), weight: 0.1 }])]).altered).toEqual([]);
  });
  it('reports old, unsealed evidence honestly instead of calling it verified', () => {
    const e = ev(); delete e.hash;
    expect(verifyEvidence([finding([e])])).toMatchObject({ checked: 0, unsealed: 1 });
  });
});

describe('tamper-evident activity log', () => {
  const mk = () => { const s = new Store(join(mkdtempSync(join(tmpdir(), 'plexus-a-')), 'p.db')); const c = s.createCase('T', ''); return { s, id: c.id }; };
  it('links every entry to the one before and verifies', () => {
    const { s, id } = mk();
    s.audit(id, 'a', 'one'); s.audit(id, 'b', 'two'); s.audit(id, 'c', 'three');
    const v = s.verifyAudit(id);
    expect(v.ok).toBe(true); expect(v.count).toBe(4); // plus case.created
  });
  it('detects an edited entry', () => {
    const { s, id } = mk();
    s.audit(id, 'a', 'one'); s.audit(id, 'b', 'two'); s.audit(id, 'c', 'three');
    s.db.prepare("UPDATE audit SET detail='nothing happened' WHERE action='b'").run();
    const v = s.verifyAudit(id);
    expect(v.ok).toBe(false); expect(v.broken?.action).toBe('b');
  });
  it('detects a deleted entry', () => {
    const { s, id } = mk();
    s.audit(id, 'a', 'one'); s.audit(id, 'b', 'two'); s.audit(id, 'c', 'three');
    s.db.prepare("DELETE FROM audit WHERE action='b'").run();
    const v = s.verifyAudit(id);
    expect(v.ok).toBe(false); expect(v.broken?.action).toBe('c');
  });
  it('treats entries from before chaining as legacy, not as tampering', () => {
    const { s, id } = mk();
    s.db.prepare("UPDATE audit SET hash=NULL, prev=NULL").run();
    s.audit(id, 'new', 'after upgrade');
    const v = s.verifyAudit(id);
    expect(v.ok).toBe(true); expect(v.legacy).toBe(1);
  });
});

describe('backups', () => {
  it('writes a consistent copy, keeps only the newest few, and skips an empty database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plexus-b-'));
    const s = new Store(join(dir, 'p.db'));
    expect(s.autoBackup()).toBeNull();
    s.createCase('Keep me', '');
    const b = s.autoBackup();
    expect(b && existsSync(join(dir, 'backups', b.name))).toBe(true);
    expect(s.autoBackup()).toBeNull(); // one was just made
    for (let i = 0; i < 4; i++) { s.makeBackup(2); }
    expect(readdirSync(join(dir, 'backups')).length).toBeLessThanOrEqual(2);
    const copy = new Store(join(dir, 'backups', s.listBackups()[0].name));
    expect(copy.listCases().map((c) => c.name)).toContain('Keep me');
    expect(copy.integrityCheck()).toBe('ok');
  });
});

describe('exports', () => {
  it('defangs spreadsheet formulas in CSV cells', async () => {
    const { csvCell } = await import('../shared/csv');
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    for (const v of ['+1 415 555 0142', '-5', '@SUM(A1)']) expect(csvCell(v).startsWith(`"'`)).toBe(true);
    expect(csvCell('plain, with comma')).toBe('"plain, with comma"');
  });
});
