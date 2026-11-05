import { keyFor } from '../shared/normalize';
import { csvCell } from '../shared/csv';
import type { CaseInfo, Evidence, Finding, GraphEdge, GraphNode } from '../shared/types';
import { uid, type Store } from './store';
import { verifyEvidence } from './integrity';

// ---------------------------------------------------------------------------------------------------- import
const LIMITS = { nodes: 20_000, edges: 60_000, findings: 60_000, audit: 20_000 };
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class ImportError extends Error {}

/**
 * Creates a NEW case from an export file. Nothing is merged into or overwrites an existing case. Every id is re-issued, so
 * importing the same file twice is safe. Evidence fingerprints are carried over untouched, so the imported case can be
 * re-verified and any change made to the file after it was exported shows up as "altered".
 */
export function importCase(store: Store, raw: any): { case: CaseInfo; nodes: number; edges: number; findings: number; integrity: { checked: number; altered: number; unsealed: number } } {
  if (!raw || typeof raw !== 'object' || raw.plexus !== 1 || !raw.case || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !Array.isArray(raw.findings))
    throw new ImportError('This is not a Plexus export file.');
  if (raw.nodes.length > LIMITS.nodes || raw.edges.length > LIMITS.edges || raw.findings.length > LIMITS.findings) throw new ImportError('This file is larger than Plexus will import.');

  const TYPES = new Set(['person', 'org', 'email', 'phone', 'username', 'account', 'location', 'domain', 'ip', 'url', 'wallet', 'breach', 'image']);
  const STATUS = new Set(['pending', 'accepted', 'rejected', 'unsure']);
  const nid = new Map<string, string>(), fid = new Map<string, string>();
  for (const n of raw.nodes) if (n && typeof n.id === 'string') nid.set(n.id, uid('n_'));
  for (const f of raw.findings) if (f && typeof f.id === 'string') fid.set(f.id, uid('f_'));

  const findings: Finding[] = [];
  for (const f of raw.findings) {
    if (!f || !TYPES.has(f.type) || typeof f.value !== 'string' || !nid.has(f.subjectId) || !fid.has(f.id)) continue;
    const evidence: Evidence[] = (Array.isArray(f.evidence) ? f.evidence : []).slice(0, 200).map((e: any) => ({
      ...e, via: e?.via ? { ...e.via, findingId: fid.get(e.via.findingId) ?? e.via.findingId } : undefined,
    }));
    findings.push({
      id: fid.get(f.id)!, caseId: '', runId: str(f.runId, 60), subjectId: nid.get(f.subjectId)!, type: f.type, value: str(f.value), key: str(f.key) || keyFor(f.type, f.value, f.attrs ?? {}),
      relation: str(f.relation, 120), attrs: f.attrs && typeof f.attrs === 'object' ? f.attrs : {}, evidence, checks: Array.isArray(f.checks) ? f.checks : undefined,
      score: num(f.score), rank: num(f.rank), level: ([1, 2, 3, 4].includes(f.level) ? f.level : 1) as Finding['level'], reasons: Array.isArray(f.reasons) ? f.reasons.map((r: unknown) => str(r, 400)) : [],
      status: STATUS.has(f.status) ? f.status : 'pending', conflictKey: f.conflictKey ? str(f.conflictKey, 120) : undefined,
      conflictsWith: Array.isArray(f.conflictsWith) ? f.conflictsWith.map((x: string) => fid.get(x)).filter(Boolean) as string[] : undefined,
      when: f.when ? str(f.when, 40) : undefined, createdAt: num(f.createdAt, Date.now()),
    });
  }
  const integrity = verifyEvidence(findings);

  return store.tx(() => {
    const name = str(raw.case.name, 200) || 'Imported case';
    const c = store.createCase(`${name} (imported)`, str(raw.case.purpose, 1000));
    const ins = store.db.prepare('INSERT INTO nodes(id,case_id,type,value,key,label,state,attrs,score,level,x,y,pinned,hidden,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let nodes = 0;
    const seenKeys = new Set<string>(), inserted = new Set<string>();
    for (const n of raw.nodes as GraphNode[]) {
      if (!n || !TYPES.has(n.type) || typeof n.value !== 'string' || !nid.has(n.id)) continue;
      const key = keyFor(n.type, n.value, n.attrs ?? {}); if (!key || seenKeys.has(`${n.type}|${key}`)) { nid.delete(n.id); continue; }
      seenKeys.add(`${n.type}|${key}`);
      ins.run(nid.get(n.id)!, c.id, n.type, str(n.value), key, str(n.label) || str(n.value), n.state === 'seed' ? 'seed' : 'confirmed', JSON.stringify(n.attrs && typeof n.attrs === 'object' ? n.attrs : {}),
        n.score ?? null, n.level ?? null, n.x ?? null, n.y ?? null, n.pinned ? 1 : 0, n.hidden ? 1 : 0, n.notes ? str(n.notes, 20000) : '', num(n.createdAt, Date.now()));
      inserted.add(nid.get(n.id)!); nodes++;
    }
    const eIns = store.db.prepare('INSERT OR IGNORE INTO edges(id,case_id,from_id,to_id,label,strength,kind,finding_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
    let edges = 0;
    for (const e of raw.edges as GraphEdge[]) {
      if (!e || !nid.has(e.from) || !nid.has(e.to)) continue;
      eIns.run(uid('e_'), c.id, nid.get(e.from)!, nid.get(e.to)!, str(e.label, 200), Math.min(1, Math.max(0, num(e.strength, 0.5))), ['evidenced', 'inferred', 'manual'].includes(e.kind) ? e.kind : 'manual', e.findingId ? fid.get(e.findingId) ?? null : null, num(e.createdAt, Date.now()));
      edges++;
    }
    let fcount = 0;
    for (const f of findings) { if (!inserted.has(f.subjectId)) continue; store.saveFinding({ ...f, caseId: c.id }); fcount++; }
    store.audit(c.id, 'case.imported', `${nodes} entities, ${edges} relationships, ${fcount} findings from an export dated ${raw.exportedAt ? new Date(raw.exportedAt).toISOString().slice(0, 10) : 'unknown'}. Evidence fingerprints re-checked: ${integrity.checked} intact${integrity.altered.length ? `, ${integrity.altered.length} ALTERED` : ''}${integrity.unsealed ? `, ${integrity.unsealed} unsealed` : ''}. Original activity log not carried over${raw.integrity?.audit?.ok === false ? ' (it was already broken at export)' : ''}.`);
    return { case: store.getCase(c.id)!, nodes, edges, findings: fcount, integrity: { checked: integrity.checked, altered: integrity.altered.length, unsealed: integrity.unsealed } };
  });
}

// ---------------------------------------------------------------------------------------------------- exports
const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** GraphML opens in Gephi, yEd, Cytoscape and Neo4j tooling. */
export function toGraphML(c: CaseInfo, nodes: GraphNode[], edges: GraphEdge[]): string {
  const ids = new Set(nodes.map((n) => n.id));
  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <!-- ${xml(c.name)} · exported from Plexus -->
  <key id="label" for="node" attr.name="label" attr.type="string"/>
  <key id="type" for="node" attr.name="type" attr.type="string"/>
  <key id="value" for="node" attr.name="value" attr.type="string"/>
  <key id="confidence" for="node" attr.name="confidence" attr.type="double"/>
  <key id="state" for="node" attr.name="state" attr.type="string"/>
  <key id="elabel" for="edge" attr.name="label" attr.type="string"/>
  <key id="strength" for="edge" attr.name="strength" attr.type="double"/>
  <key id="kind" for="edge" attr.name="kind" attr.type="string"/>
  <graph id="G" edgedefault="directed">
${nodes.map((n) => `    <node id="${xml(n.id)}"><data key="label">${xml(n.label)}</data><data key="type">${n.type}</data><data key="value">${xml(n.value)}</data>${n.score !== undefined ? `<data key="confidence">${n.score.toFixed(4)}</data>` : ''}<data key="state">${n.state}</data></node>`).join('\n')}
${edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => `    <edge id="${xml(e.id)}" source="${xml(e.from)}" target="${xml(e.to)}"><data key="elabel">${xml(e.label)}</data><data key="strength">${e.strength.toFixed(4)}</data><data key="kind">${e.kind}</data></edge>`).join('\n')}
  </graph>
</graphml>
`;
}

export function toCsv(nodes: GraphNode[], edges: GraphEdge[]): { entities: string; relationships: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const row = (cells: (string | number | undefined)[]) => cells.map((c) => csvCell(String(c ?? ''))).join(',');
  return {
    entities: [row(['type', 'label', 'value', 'confidence', 'state', 'notes']), ...nodes.map((n) => row([n.type, n.label, n.value, n.score !== undefined ? Math.round(n.score * 100) + '%' : '', n.state, n.notes]))].join('\n'),
    relationships: [row(['from', 'relationship', 'to', 'strength', 'kind']), ...edges.map((e) => row([byId.get(e.from)?.label, e.label, byId.get(e.to)?.label, Math.round(e.strength * 100) + '%', e.kind]))].join('\n'),
  };
}

// ---------------------------------------------------------------------------------------------------- HTML report
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s).,;]|$)/g, '$1<em>$2</em>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|[\s(—])(https?:\/\/[^\s<)]+)/g, (_m, p, u) => `${p}<a href="${u}" rel="noreferrer noopener">${u}</a>`);
}

/** A print-ready page (Print → Save as PDF) built from the same Markdown report, so the two never disagree. */
export function markdownToHtml(md: string, title: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null, depth = 0;
  const close = () => { while (depth > 0) { out.push('</li></ul>'); depth--; } if (list === 'ol') out.push('</ol>'); list = null; };
  for (const line of md.split('\n')) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3}) (.*)$/))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (line === '---') { close(); out.push('<hr>'); continue; }
    if ((m = line.match(/^( *)- (.*)$/))) {
      const want = m[1].length >= 2 ? 2 : 1;
      if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; depth = 1; out.push('<li>' + inline(m[2])); continue; }
      if (want === 2 && depth === 1) { out.push('<ul><li>' + inline(m[2])); depth = 2; continue; }
      if (want === 1 && depth === 2) { out.push('</li></ul></li><li>' + inline(m[2])); depth = 1; continue; }
      out.push('</li><li>' + inline(m[2])); continue;
    }
    if ((m = line.match(/^(\d+)\. (.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li value="${m[1]}">${inline(m[2])}</li>`); continue; }
    if (line.trim() === '') { close(); continue; }
    close(); out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{color-scheme:light}body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;color:#111;max-width:780px;margin:40px auto;padding:0 24px}
h1{font-size:28px;letter-spacing:-.03em;margin:0 0 8px}h2{font-size:18px;letter-spacing:-.02em;margin:32px 0 8px;padding-bottom:6px;border-bottom:1px solid #e5e5e8}h3{font-size:15px;margin:20px 0 6px}
ul,ol{padding-left:22px}li{margin:3px 0}code{font:12.5px ui-monospace,Menlo,monospace;background:#f2f2f4;padding:1px 5px;border-radius:5px}a{color:#0a6cff;word-break:break-all}
hr{border:0;border-top:1px solid #e5e5e8;margin:28px 0}em{color:#555}.bar{position:sticky;top:0;background:#fff;padding:10px 0;margin-bottom:12px;border-bottom:1px solid #e5e5e8;display:flex;gap:12px;align-items:center;font-size:13px;color:#555}
.bar button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid #d5d5d9;background:#fff;cursor:pointer}
@media print{.bar{display:none}body{margin:0;max-width:none}a{color:#111;text-decoration:none}h2{break-after:avoid}li{break-inside:avoid}}
</style></head><body><div class="bar"><button onclick="print()">Print or save as PDF</button><span>Prepared with Plexus. Findings are leads, not proof.</span></div>
${out.join('\n')}
</body></html>`;
}
