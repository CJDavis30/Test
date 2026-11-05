// Seeds a PLEXUS_HOME with a 700-entity case plus a subject holding 400 pending findings (for perf.cjs).
import { Store, uid } from '../../server/store';
import { keyFor } from '../../shared/normalize';
const s = new Store(process.argv[2] + '/plexus.db');
s.setSetting('onboarded', true); s.setSetting('demoMode', true);
const c = s.createCase('Big investigation', 'stress test');
const types = ['person', 'email', 'phone', 'username', 'account', 'org', 'location', 'domain', 'ip', 'url'] as const;
let seed = 7; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const hubs: string[] = [];
const N = 700;
const ids: string[] = [];
for (let i = 0; i < N; i++) {
  const t = types[i % types.length]; const v = t === 'email' ? `user${i}@corp${i % 40}.example` : t === 'domain' ? `host${i}.corp${i % 30}.example` : t === 'ip' ? `10.${i % 250}.${(i * 7) % 250}.${i % 200}` : t === 'phone' ? `+1415555${String(1000 + i).slice(-4)}` : `${t} ${i}`;
  const n = s.upsertNode({ caseId: c.id, type: t, value: v, key: keyFor(t, v), state: i < 8 ? 'seed' : 'confirmed', score: 0.5 + r() * 0.5, level: 1 + Math.floor(r() * 4) });
  ids.push(n.id); if (i < 8) hubs.push(n.id);
}
for (let i = 8; i < N; i++) { s.upsertEdge({ caseId: c.id, from: hubs[Math.floor(r() * hubs.length)], to: ids[i], label: 'related', strength: 0.4 + r() * 0.55, kind: 'evidenced' }); }
for (let k = 0; k < 500; k++) { const a = ids[Math.floor(r() * N)], b = ids[Math.floor(r() * N)]; if (a !== b) s.upsertEdge({ caseId: c.id, from: a, to: b, label: 'cross ' + k, strength: 0.3 + r() * 0.4, kind: 'evidenced' }); }
// a subject with 400 pending findings for the sheet
const subj = ids[0];
s.db.exec('BEGIN');
for (let i = 0; i < 400; i++) {
  const t = types[i % types.length]; const v = `found-${i}.sub${i % 9}.example`;
  s.saveFinding({ id: uid('f_'), caseId: c.id, runId: 'r', subjectId: subj, type: t, value: v, key: keyFor(t, v), relation: 'subdomain', attrs: {}, evidence: [{ id: uid('e'), adapter: 'x', adapterName: 'Src', family: 'x' + i, retrievedAt: Date.now(), weight: 0.6 }], score: r(), rank: r(), level: (1 + Math.floor(r() * 4)) as 1, reasons: ['Only one source reported this (Src), so treat it as a lead, not a fact.'], status: 'pending', createdAt: Date.now() });
}
s.db.exec('COMMIT');
console.log('seeded', c.id);
