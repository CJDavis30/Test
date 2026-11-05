import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PLEXUS_HOME = mkdtempSync(join(tmpdir(), 'plexus-dr-'));
const { Store } = await import('../server/store');

const fresh = () => new Store(join(mkdtempSync(join(tmpdir(), 'plexus-dr1-')), 'p.db'));
const addFinding = (s: InstanceType<typeof Store>, caseId: string, adapter: string, key: string) => {
  const db = (s as any).db;
  const node = `n_${key}`;
  db.prepare('INSERT INTO nodes(id,case_id,type,value,key,label,state,attrs,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(node, caseId, 'username', key, key, key, 'seed', '{}', 1);
  db.prepare('INSERT INTO findings(id,case_id,run_id,subject_id,type,value,key,relation,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(`f_${key}`, caseId, 'r', node, 'username', key, key, 'x', JSON.stringify([{ adapter, adapterName: adapter }]), 1);
};

describe('removing demo leftovers from earlier builds', () => {
  it('deletes the demo case, the saved demo switch and what was learned from fictional sources', () => {
    const s = fresh();
    s.createCase('Northwind — demo', 'Exploring Plexus with fictional data');
    s.setSetting('demoMode', true);
    s.bumpFeedback('demo-social', 'account', 'accepted', 3); s.bumpFeedback('github', 'account', 'accepted', 2);
    const r = s.removeDemoLeftovers();
    expect(r.cases).toBe(1);
    expect(s.listCases()).toEqual([]);
    expect(s.getSetting('demoMode', 'gone')).toBe('gone');
    const fb = s.allFeedback();
    expect([...fb.keys()].some((k) => k.startsWith('demo-'))).toBe(false);
    expect([...fb.keys()].some((k) => k.startsWith('github'))).toBe(true);    // real learning is kept
  });
  it('never touches a case with real evidence, even one that also has some demo evidence', () => {
    const s = fresh();
    const real = s.createCase('Real work', 'Fraud check'), mixed = s.createCase('Mixed', 'Testing');
    addFinding(s, real.id, 'github', 'a');
    addFinding(s, mixed.id, 'demo-social', 'b'); addFinding(s, mixed.id, 'github', 'c');
    expect(s.removeDemoLeftovers().cases).toBe(0);
    expect(s.listCases().map((c) => c.name).sort()).toEqual(['Mixed', 'Real work']);
  });
  it('removes a case that holds nothing but demo evidence, even if it was renamed', () => {
    const s = fresh();
    const c = s.createCase('My renamed practice case', 'x');
    addFinding(s, c.id, 'demo-registry', 'a'); addFinding(s, c.id, 'demo-breach', 'b');
    expect(s.removeDemoLeftovers().cases).toBe(1);
  });
  it('runs once only, so a case you make later with a similar name is safe', () => {
    const s = fresh();
    s.removeDemoLeftovers();
    s.createCase('Northwind — demo copy', 'mine');
    expect(s.removeDemoLeftovers().cases).toBe(0);
    expect(s.listCases().length).toBe(1);
  });
  it('leaves an empty case with an ordinary name alone', () => {
    const s = fresh();
    s.createCase('Ordinary', 'Real purpose');
    expect(s.removeDemoLeftovers().cases).toBe(0);
  });
});
