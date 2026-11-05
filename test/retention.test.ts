import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-ret-'));
const { Store } = await import('../server/store');

const DAY = 86400_000;
const age = (s: InstanceType<typeof Store>, id: string, days: number) => (s as any).db.prepare('UPDATE cases SET updated_at=? WHERE id=?').run(Date.now() - days * DAY, id);

describe('retention', () => {
  it('deletes only cases idle longer than the limit, and leaves recent ones alone', () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), 'plexus-ret1-')), 'p.db'));
    const old = s.createCase('Old case'), fresh = s.createCase('Fresh case');
    age(s, old.id, 120); age(s, fresh.id, 5);
    const gone = s.purgeExpired(90);
    expect(gone.map((g) => g.name)).toEqual(['Old case']);
    expect(s.listCases().map((c) => c.name)).toEqual(['Fresh case']);
  });
  it('does nothing when off or when nothing is old enough', () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), 'plexus-ret2-')), 'p.db'));
    const c = s.createCase('Ancient'); age(s, c.id, 4000);
    expect(s.purgeExpired(0)).toEqual([]);
    expect(s.purgeExpired(NaN)).toEqual([]);
    expect(s.listCases().length).toBe(1);
    const s2 = new Store(join(mkdtempSync(join(tmpdir(), 'plexus-ret3-')), 'p.db'));
    s2.createCase('New');
    expect(s2.purgeExpired(30)).toEqual([]);
  });
  it('removes the old backups, since they would keep the deleted data, and logs name and date but no contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plexus-ret4-'));
    const s = new Store(join(dir, 'p.db'));
    const old = s.createCase('Secret investigation'), keep = s.createCase('Keeper');
    s.makeBackup(); s.makeBackup();
    expect(s.listBackups().length).toBe(2);
    age(s, old.id, 200); age(s, keep.id, 1);
    s.purgeExpired(90);
    const backups = s.listBackups();
    expect(backups.length).toBe(1);                                   // one fresh copy of what remains
    const log = s.getSetting<any[]>('purgeLog', []);
    expect(log[0]).toMatchObject({ name: 'Secret investigation', afterDays: 90 });
    expect(Object.keys(log[0]).sort()).toEqual(['afterDays', 'id', 'lastActive', 'name', 'purgedAt']);
    // the fresh backup must not contain the purged case
    const copy = new Store(join(dir, 'backups', backups[0].name));
    expect(copy.listCases().map((c) => c.name)).toEqual(['Keeper']);
    expect(readdirSync(join(dir, 'backups')).filter((n) => n.endsWith('.db')).length).toBe(1);
  });
  it('cascades: nothing of a purged case is left behind', () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), 'plexus-ret5-')), 'p.db'));
    const c = s.createCase('Gone');
    s.audit(c.id, 'x', 'y');
    age(s, c.id, 100); s.purgeExpired(30);
    const left = (t: string) => ((s as any).db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE case_id=?`).get(c.id) as any).n;
    expect([left('audit'), left('nodes'), left('edges')]).toEqual([0, 0, 0]);
  });
});
