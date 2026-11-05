import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search, Download, Copy, Printer, FileJson, EyeOff, Eye, FileText, Network } from 'lucide-react';
import { ENTITY_LABEL, type EntityType, type Finding } from '@shared/types';
import { keyFor } from '@shared/normalize';
import { useStore, keyOfNode } from '../lib/store';
import { api } from '../lib/api';
import { EntityGlyph } from '../lib/icons';
import { Dots, download } from '../components/ui';
import { explainRelation } from '@shared/explain';
import { ago, fmtDate, plural, TYPE_ORDER, GROUP_LABEL, displayValue } from '../lib/format';

// ------------------------------------------------------------------------------------------------ Table
type SortKey = 'label' | 'type' | 'level' | 'links' | 'created';
export function TableView() {
  const s = useStore();
  const nodes = s.snap?.nodes ?? [], edges = s.snap?.edges ?? [];
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'level', dir: -1 });
  const [types, setTypes] = useState<Set<EntityType>>(new Set());
  const [q, setQ] = useState('');
  const links = useMemo(() => { const m = new Map<string, number>(); for (const e of edges) { m.set(e.from, (m.get(e.from) ?? 0) + 1); m.set(e.to, (m.get(e.to) ?? 0) + 1); } return m; }, [edges]);
  const srcCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of Object.values(s.findings)) if (f.status === 'accepted') { const k = `${f.type}:${f.key}`; m.set(k, Math.max(m.get(k) ?? 0, new Set(f.evidence.map((e) => e.family)).size)); }
    return m;
  }, [s.findings]);
  const present = TYPE_ORDER.filter((t) => nodes.some((n) => n.type === t));
  const rows = useMemo(() => {
    let r = nodes.filter((n) => (!types.size || types.has(n.type)) && (!q || n.label.toLowerCase().includes(q.toLowerCase()) || n.value.toLowerCase().includes(q.toLowerCase())));
    const v = (n: (typeof nodes)[number]) => sort.k === 'label' ? n.label.toLowerCase() : sort.k === 'type' ? n.type : sort.k === 'level' ? (n.score ?? -1) : sort.k === 'links' ? (links.get(n.id) ?? 0) : n.createdAt;
    r = [...r].sort((a, b) => { const x = v(a), y = v(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    return r;
  }, [nodes, types, q, sort, links]);
  const H = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th><button onClick={() => setSort({ k, dir: sort.k === k ? (sort.dir === 1 ? -1 : 1) : k === 'label' || k === 'type' ? 1 : -1 })}>{children}{sort.k === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</button></th>
  );
  return (
    <div className="view"><div className="view-inner" style={{ maxWidth: 1180 }}>
      <div className="view-head"><h1>Entities</h1><span className="faint">{plural(rows.length, 'item')}</span></div>
      <div className="filters">
        {present.map((t) => (
          <button key={t} className="fchip" aria-pressed={types.has(t)} onClick={() => { const n = new Set(types); n.has(t) ? n.delete(t) : n.add(t); setTypes(n); }}>
            <EntityGlyph type={t} size={13} />{GROUP_LABEL[t]}<span className="n num">{nodes.filter((n) => n.type === t).length}</span>
          </button>
        ))}
        <label className="search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter entities" /></label>
      </div>
      {nodes.length === 0 ? <div className="emptystate">Nothing on this case yet. Press <span className="kbd">⌘K</span> to add something.</div> : (
        <table className="tbl">
          <thead><tr><H k="label">Entity</H><H k="type">Type</H><H k="level">Confidence</H><th>Sources</th><H k="links">Links</H><H k="created">Added</H></tr></thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id} aria-selected={s.selection.includes(n.id)} onClick={() => s.select([n.id])} onDoubleClick={() => void s.openNode(n.id)}>
                <td><div className="val"><span className="gl"><EntityGlyph type={n.type} size={14} /></span><span className="truncate selectable">{n.label}</span></div></td>
                <td className="muted">{ENTITY_LABEL[n.type]}</td>
                <td>{n.level ? <Dots level={n.level} label /> : <span className="faint">{n.state === 'seed' ? 'Starting point' : '—'}</span>}</td>
                <td className="num muted">{srcCount.get(keyOfNode(n)) ?? '—'}</td>
                <td className="num muted">{links.get(n.id) ?? 0}</td>
                <td className="muted">{ago(n.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div></div>
  );
}

// ------------------------------------------------------------------------------------------------ Timeline
export function TimelineView() {
  const s = useStore();
  const items = useMemo(() => Object.values(s.findings).filter((f) => f.when && f.status !== 'rejected').sort((a, b) => (b.when! < a.when! ? -1 : 1)), [s.findings]);
  const years = useMemo(() => { const m = new Map<string, Finding[]>(); for (const f of items) { const y = f.when!.slice(0, 4); (m.get(y) ?? m.set(y, []).get(y)!).push(f); } return [...m.entries()]; }, [items]);
  const nodes = s.snap?.nodes ?? [];
  const subject = (f: Finding) => nodes.find((n) => n.id === f.subjectId)?.label ?? '';
  const open = (f: Finding) => {
    const n = nodes.find((x) => `${x.type}:${keyFor(x.type, x.value, x.attrs)}` === `${f.type}:${f.key}`);
    if (n) { s.setView('graph'); s.select([n.id]); window.dispatchEvent(new CustomEvent('plexus:pan', { detail: n.id })); } else s.openSheet(f.subjectId, f.status === 'accepted' ? 'accepted' : 'review');
  };
  return (
    <div className="view"><div className="view-inner">
      <div className="view-head"><h1>Timeline</h1><span className="faint">{plural(items.length, 'dated finding')}</span></div>
      {items.length === 0 ? <div className="emptystate"><h3>No dates yet</h3>Dates show up here when sources report them: account creation, domain registration, first sightings.</div> : (
        <div className="tl">
          {years.map(([y, list]) => (
            <Fragment key={y}>
              <div className="tl-year">{y}</div>
              {list.map((f) => (
                <button key={f.id} className="tl-item" data-pending={f.status !== 'accepted'} onClick={() => open(f)}>
                  <span className="tl-date num">{fmtDate(f.when)}</span>
                  <span className="gl"><EntityGlyph type={f.type} size={14} /></span>
                  <span className="grow" style={{ minWidth: 0 }}><span className="truncate selectable" style={{ display: 'block', fontWeight: 500 }}>{displayValue(f)}</span><span className="muted truncate" style={{ display: 'block', fontSize: 12 }} title={explainRelation(f.relation, subject(f), displayValue(f))}>{explainRelation(f.relation, subject(f), displayValue(f))}</span></span>
                  <Dots level={f.level} />
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div></div>
  );
}

// ------------------------------------------------------------------------------------------------ Report
function inline(t: string, k: string): React.ReactNode[] {
  const out: React.ReactNode[] = []; let i = 0;
  const re = /(\*\*[^*]+\*\*|_[^_]+_|https?:\/\/\S+)/g; let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) out.push(t.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={`${k}${i++}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('_')) out.push(<em key={`${k}${i++}`}>{tok.slice(1, -1)}</em>);
    else out.push(<a key={`${k}${i++}`} href={tok} target="_blank" rel="noreferrer noopener">{tok.length > 60 ? `${tok.slice(0, 58)}…` : tok}</a>);
    last = m.index + tok.length;
  }
  if (last < t.length) out.push(t.slice(last));
  return out;
}
function Markdown({ text }: { text: string }) {
  const lines = text.split('\n'); const out: React.ReactNode[] = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('# ')) out.push(<h1 key={i}>{inline(l.slice(2), `h${i}`)}</h1>);
    else if (l.startsWith('## ')) out.push(<h2 key={i}>{inline(l.slice(3), `h${i}`)}</h2>);
    else if (l.startsWith('### ')) out.push(<h3 key={i}>{inline(l.slice(4), `h${i}`)}</h3>);
    else if (l === '---') out.push(<hr key={i} />);
    else if (/^\d+\. /.test(l)) { const items: string[] = []; while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, '')); out.push(<ol key={i}>{items.map((x, j) => <li key={j}>{inline(x, `o${i}${j}`)}</li>)}</ol>); continue; }
    else if (/^- /.test(l)) {
      const items: { t: string; kids: string[] }[] = [];
      while (i < lines.length && /^( {2})?- /.test(lines[i])) { const sub = lines[i].startsWith('  '); const t = lines[i].replace(/^ *- /, ''); if (sub && items.length) items[items.length - 1].kids.push(t); else items.push({ t, kids: [] }); i++; }
      out.push(<ul key={i}>{items.map((x, j) => <li key={j}>{inline(x.t, `u${i}${j}`)}{x.kids.length > 0 && <ul>{x.kids.map((k, q) => <li key={q}>{inline(k, `k${q}`)}</li>)}</ul>}</li>)}</ul>); continue;
    } else if (l.trim()) out.push(<p key={i}>{inline(l, `p${i}`)}</p>);
    i++;
  }
  return <>{out}</>;
}

export function ReportView() {
  const s = useStore();
  const [md, setMd] = useState('');
  const [redact, setRedact] = useState(false);
  useEffect(() => { if (s.caseId) api.get<{ markdown: string }>(`/api/cases/${s.caseId}/report${redact ? '?redact=1' : ''}`).then((r) => setMd(r.markdown)).catch(() => setMd('')); }, [s.caseId, redact, s.snap?.nodes.length, s.snap?.edges.length]);
  const name = s.snap?.case.name ?? 'report';
  return (
    <div className="view"><div className="view-inner">
      <div className="doc-actions">
        <button className="btn sm" aria-pressed={redact} onClick={() => setRedact(!redact)}>{redact ? <EyeOff size={13} /> : <Eye size={13} />} {redact ? 'Redacted' : 'Redact values'}</button>
        <div className="grow" />
        <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(md); s.toast('Copied Markdown'); }}><Copy size={13} /> Copy</button>
        <button className="btn sm" onClick={() => download(`${name}.md`, md, 'text/markdown')}><Download size={13} /> Markdown</button>
        <button className="btn sm" onClick={async () => { const j = await api.get<any>(`/api/cases/${s.caseId}/export`); download(`${name}.plexus.json`, JSON.stringify(j, null, 2), 'application/json'); }}><FileJson size={13} /> JSON</button>
        <button className="btn sm" onClick={async () => { const t = await (await fetch(`/api/cases/${s.caseId}/report.html${redact ? '?redact=1' : ''}`)).text(); download(`${name}.report.html`, t, 'text/html'); }} title="A standalone page with the integrity section. Open it and choose Print → Save as PDF."><FileText size={13} /> HTML</button>
        <button className="btn sm" onClick={async () => { const t = await (await fetch(`/api/cases/${s.caseId}/graphml`)).text(); download(`${name}.graphml`, t, 'application/graphml+xml'); }} title="Open the graph in Gephi, yEd or Cytoscape"><Network size={13} /> GraphML</button>
        <button className="btn sm primary" onClick={() => window.print()}><Printer size={13} /> Print / PDF</button>
      </div>
      <article className="doc">{md ? <Markdown text={md} /> : <div className="faint">Add and confirm some entities to build a report.</div>}</article>
    </div></div>
  );
}
