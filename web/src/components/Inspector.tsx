import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, FolderOpen, Pin, PinOff, Copy, Trash2, Route, Link2, Merge, ExternalLink, X, Globe2, ShieldCheck } from 'lucide-react';
import { ENTITY_LABEL, LEVEL_LABEL, type EntityType, type Finding, type GraphNode } from '@shared/types';
import { keyFor, initials, safeHttpUrl, safeImageSrc } from '@shared/normalize';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { EntityGlyph } from '../lib/icons';
import { ago, fmtDate, hostOf, plural, TYPE_ORDER, GROUP_LABEL } from '../lib/format';
import { Dots } from './ui';
import { pivotsFor, pivotCount } from '@shared/pivots';
import { ConnectionPath, SourceCards } from './FindingDetail';
import { explainRelation } from '@shared/explain';
import { displayValue } from '../lib/format';
import { ActivityClock } from './forensics/ActivityClock';
import { ProfileCard } from './ProfileCard';
import { HandleRoleCard } from './HandleRoleCard';
import type { Circadian, DstResult } from '../lib/forensics';

type Tab = 'overview' | 'evidence' | 'activity' | 'notes';

export function Inspector() {
  const s = useStore();
  const { snap, selection, selectedEdge } = s;
  if (!snap) return <aside className="inspector" aria-label="Inspector" />;
  const nodes = snap.nodes;
  if (selectedEdge) return <aside className="inspector" aria-label="Inspector"><EdgePanel id={selectedEdge} /></aside>;
  if (selection.length === 0) return <aside className="inspector" aria-label="Inspector"><CaseOverview /></aside>;
  if (selection.length > 1) return <aside className="inspector" aria-label="Inspector"><MultiPanel ids={selection} /></aside>;
  const node = nodes.find((n) => n.id === selection[0]);
  return <aside className="inspector" aria-label="Inspector">{node ? <NodePanel key={node.id} node={node} /> : null}</aside>;
}

function CaseOverview() {
  const { snap, findings, runs, openSettings } = useStore();
  const nodes = snap!.nodes;
  const pending = Object.values(findings).filter((f) => f.status === 'pending' || f.status === 'unsure').length;
  const counts = TYPE_ORDER.map((t) => [t, nodes.filter((n) => n.type === t).length] as const).filter(([, n]) => n);
  const lastRun = Math.max(0, ...Object.values(runs).map((r) => r.startedAt));
  return (
    <>
      <div className="insp-head"><div><div className="insp-title">{snap!.case.name}</div><div className="insp-sub">{snap!.case.purpose || <button className="faint" onClick={() => document.querySelector<HTMLButtonElement>('.toolbar .title')?.click()}>Add a purpose for this case</button>}</div></div></div>
      <div className="insp-body">
        <div className="sec-title" style={{ marginTop: 6 }}>On the graph</div>
        {counts.length === 0 && <div className="faint">Nothing yet.</div>}
        {counts.map(([t, n]) => (
          <div key={t} className="row" style={{ padding: '5px 0' }}><EntityGlyph type={t} size={14} style={{ color: 'var(--text-2)' }} /><span className="grow">{GROUP_LABEL[t]}</span><span className="num muted">{n}</span></div>
        ))}
        <div className="sec-title">Status</div>
        <dl style={{ margin: 0 }}>
          <div className="kv"><dt>Links</dt><dd className="num">{snap!.edges.length}</dd></div>
          <div className="kv"><dt>To review</dt><dd className="num">{pending}</dd></div>
          {lastRun > 0 && <div className="kv"><dt>Last lookup</dt><dd>{ago(lastRun)}</dd></div>}
        </dl>
        <div className="empty-note faint" style={{ paddingTop: 22 }}>Select something on the graph to see what's known about it.</div>
        <button className="btn ghost sm" onClick={() => openSettings('audit')}>View audit log</button>
      </div>
    </>
  );
}

function evidenceOf(node: GraphNode, findings: Record<string, Finding>): Finding[] {
  const key = keyFor(node.type, node.value, node.attrs);
  return Object.values(findings).filter((f) => f.type === node.type && f.key === key && f.status !== 'rejected').sort((a, b) => b.score - a.score);
}

function NodePanel({ node }: { node: GraphNode }) {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const fs = useMemo(() => evidenceOf(node, s.findings), [node, s.findings]);
  const edges = s.snap!.edges.filter((e) => e.from === node.id || e.to === node.id);
  const pendingCount = Object.values(s.findings).filter((f) => f.subjectId === node.id && (f.status === 'pending' || f.status === 'unsure')).length;
  const photo = node.type === 'image' ? node.value : Object.values(s.findings).filter((f) => f.subjectId === node.id && f.type === 'image' && f.status !== 'rejected').sort((a, b) => b.rank - a.rank)[0]?.value;
  const attrs = Object.entries(node.attrs).filter(([k]) => !['hash'].includes(k) && !k.startsWith('alias_') && !k.startsWith('handle'));
  const aliases = Object.entries(node.attrs).filter(([k]) => k.startsWith('alias_'));
  const running = s.runs[node.id]?.status === 'running';

  return (
    <>
      <div className="insp-head">
        <div className="insp-avatar">{photo ? <img src={safeImageSrc(photo)} alt="" /> : node.type === 'person' || node.type === 'org' ? initials(node.label) : <EntityGlyph type={node.type} size={20} />}</div>
        <div style={{ minWidth: 0 }}>
          {editing ? (
            <input autoFocus className="field" defaultValue={node.label} onBlur={(e) => { void s.patchNode(node.id, { label: e.target.value.trim() || node.label }); setEditing(false); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }} />
          ) : (
            <div className="insp-title selectable" onDoubleClick={() => setEditing(true)} title="Double-click to rename">{node.label}</div>
          )}
          <div className="insp-sub"><span>{ENTITY_LABEL[node.type]}</span>{node.level ? <Dots level={node.level} label /> : <span className="faint">· {node.state === 'seed' ? 'Starting point' : 'Unrated'}</span>}</div>
        </div>
      </div>
      <div className="insp-actions">
        <button className="btn sm primary" onClick={() => void s.openNode(node.id)}><FolderOpen size={13} /> {pendingCount > 0 ? `Review ${pendingCount}` : 'Findings'}</button>
        <button className="btn sm" disabled={running} onClick={() => void s.runNode(node.id)}><Play size={13} /> Run checks</button>
        <button className={`btn sm ${node.attrs.known ? 'known-on' : ''}`} aria-pressed={node.attrs.known === true} title={node.attrs.known ? 'You told Plexus you know this belongs to them. Click to undo.' : 'Tell Plexus you are sure this belongs to them, so it checks everything against it'} onClick={() => void s.setKnown(node.id, node.attrs.known !== true)}><ShieldCheck size={13} /> {node.attrs.known ? 'Known' : 'I know this'}</button>
        <CheckElsewhere type={node.type} value={node.value} />
        <button className="btn sm ghost icon" aria-label={node.pinned ? 'Unpin' : 'Pin'} title={node.pinned ? 'Unpin' : 'Pin in place'} onClick={() => void s.patchNode(node.id, { pinned: !node.pinned })}>{node.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
        <button className="btn sm ghost icon" aria-label="Copy value" title="Copy value" onClick={() => { void navigator.clipboard?.writeText(node.value); s.toast('Copied'); }}><Copy size={14} /></button>
        <button className="btn sm ghost icon danger" aria-label="Remove" title="Remove from graph" onClick={() => void s.removeNodes([node.id])}><Trash2 size={14} /></button>
      </div>
      <div className="tabs" role="tablist">
        {((node.type === 'account' || node.type === 'username' ? ['overview', 'evidence', 'activity', 'notes'] : ['overview', 'evidence', 'notes']) as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}{t === 'evidence' && fs.length ? <span className="faint num"> {fs.reduce((n, f) => n + f.evidence.length, 0)}</span> : null}</button>)}
      </div>
      <div className="insp-body selectable">
        {tab === 'overview' && (<>
          {fs[0] && ['account', 'person', 'username', 'image'].includes(node.type) && <div style={{ marginBottom: 12 }}><ProfileCard f={fs[0]} compact /></div>}
          {node.type === 'username' && <HandleRoleCard node={node} />}
          <dl style={{ margin: 0 }}>
            <div className="kv"><dt>Value</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{node.type === 'image' ? 'Image' : node.value}</dd></div>
            {attrs.map(([k, v]) => <div className="kv" key={k}><dt>{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</dt><dd>{typeof v === 'number' ? v.toLocaleString() : String(v)}</dd></div>)}
            {aliases.map(([k, v]) => <div className="kv" key={k}><dt>Also known as</dt><dd>{String(v)}</dd></div>)}
            <div className="kv"><dt>Added</dt><dd>{ago(node.createdAt)}</dd></div>
          </dl>
          <div className="sec-title">Connections <span className="num">{edges.length}</span></div>
          {edges.length === 0 && <div className="faint">Not connected yet. Run checks, then accept findings to link them here.</div>}
          {edges.map((e) => {
            const other = s.snap!.nodes.find((n) => n.id === (e.from === node.id ? e.to : e.from));
            if (!other) return null;
            return (
              <button key={e.id} className="conn" onClick={() => { s.select([other.id]); window.dispatchEvent(new CustomEvent('plexus:pan', { detail: other.id })); }}>
                <span className="gl"><EntityGlyph type={other.type} size={13} /></span>
                <span className="grow" style={{ minWidth: 0 }}><span className="truncate" style={{ display: 'block' }}>{other.label}</span><small className="truncate" style={{ display: 'block' }} title={e.why ?? (e.from === node.id ? explainRelation(e.label, node.label, other.label) : explainRelation(e.label, other.label, node.label))}>{e.why ?? (e.from === node.id ? explainRelation(e.label, node.label, other.label) : explainRelation(e.label, other.label, node.label))}{e.kind === 'inferred' ? ' (inferred)' : e.kind === 'manual' && !e.why ? ' (added by you)' : ''}</small></span>
                <Dots level={e.strength >= 0.85 ? 4 : e.strength >= 0.65 ? 3 : e.strength >= 0.4 ? 2 : 1} />
              </button>
            );
          })}
        </>)}
        {tab === 'evidence' && (<>
          {fs.length === 0 && <div className="empty-note">{node.state === 'seed' ? 'This is something you entered, so there is no evidence to show. Evidence appears on the things found from it.' : 'No stored evidence for this item.'}</div>}
          {fs.map((f) => {
            const subj = s.snap!.nodes.find((n) => n.id === f.subjectId);
            return (
              <div key={f.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row" style={{ marginBottom: 6 }}><Dots level={f.level} label /></div>
                {subj && <ConnectionPath subject={{ type: subj.type, label: subj.label }} f={f} subjectId={f.subjectId} />}
                {subj && <p className="plain selectable" style={{ fontSize: 13 }}>{explainRelation(f.relation, subj.label, displayValue(f))}</p>}
                <SourceCards f={f} />
                {f.reasons.length > 0 && <ul className="why" style={{ marginTop: 10, fontSize: 12.5 }}>{f.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              </div>
            );
          })}
        </>)}
        {tab === 'activity' && <ActivityTab node={node} />}
        {tab === 'notes' && <Notes node={node} />}
      </div>
    </>
  );
}

function Notes({ node }: { node: GraphNode }) {
  const s = useStore();
  const [v, setV] = useState(node.notes ?? '');
  const t = useRef<number>(0);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <>
      <textarea className="field" rows={10} value={v} placeholder="Jot down what you know, what to verify, why this matters…" style={{ marginTop: 10 }}
        onChange={(e) => { setV(e.target.value); clearTimeout(t.current); t.current = window.setTimeout(() => void s.patchNode(node.id, { notes: e.target.value }), 600); }} />
      <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Saved automatically · included in the report</div>
    </>
  );
}

function MultiPanel({ ids }: { ids: string[] }) {
  const s = useStore();
  const nodes = ids.map((id) => s.snap!.nodes.find((n) => n.id === id)).filter(Boolean) as GraphNode[];
  const two = nodes.length === 2;
  return (
    <>
      <div className="insp-head"><div><div className="insp-title">{nodes.length} selected</div><div className="insp-sub">Shift-click or drag a box to add more</div></div></div>
      <div className="insp-actions">
        {two && <button className="btn sm" onClick={() => s.setPath([ids[0], ids[1]])}><Route size={13} /> Trace path</button>}
        {two && <button className="btn sm" onClick={() => void s.addEdge(ids[0], ids[1])}><Link2 size={13} /> Link</button>}
        {two && <button className="btn sm" onClick={() => void s.mergeNodes(ids[0], ids[1])}><Merge size={13} /> Merge</button>}
        <button className="btn sm" onClick={() => nodes.slice(0, 10).forEach((n) => void s.runNode(n.id, '', false))}><Play size={13} /> Run checks</button>
        <button className="btn sm danger" onClick={() => void s.removeNodes(ids)}><Trash2 size={13} /> Remove</button>
        <button className="btn sm ghost icon" aria-label="Clear selection" onClick={() => s.select([])}><X size={14} /></button>
      </div>
      <div className="insp-body">
        {nodes.slice(0, 80).map((n) => (
          <button key={n.id} className="conn" onClick={() => s.select([n.id])}>
            <span className="gl"><EntityGlyph type={n.type} size={13} /></span>
            <span className="grow truncate">{n.label}</span><small>{ENTITY_LABEL[n.type]}</small>
          </button>
        ))}
        {nodes.length > 80 && <div className="faint" style={{ padding: 8 }}>+ {nodes.length - 80} more</div>}
      </div>
    </>
  );
}

function EdgePanel({ id }: { id: string }) {
  const s = useStore();
  const e = s.snap!.edges.find((x) => x.id === id);
  if (!e) return null;
  const a = s.snap!.nodes.find((n) => n.id === e.from), b = s.snap!.nodes.find((n) => n.id === e.to);
  const f = e.findingId ? s.findings[e.findingId] : undefined;
  const lvl = e.strength >= 0.85 ? 4 : e.strength >= 0.65 ? 3 : e.strength >= 0.4 ? 2 : 1;
  return (
    <>
      <div className="insp-head"><div style={{ minWidth: 0, flex: 1 }}>
        {e.kind === 'evidenced' ? <div className="insp-title">{e.label}</div> : (
          <input className="field" defaultValue={e.label} aria-label="Relationship label" style={{ fontWeight: 600, marginBottom: 4 }}
            onBlur={async (ev) => { const v = ev.target.value.trim(); if (v && v !== e.label) { await api.patch(`/api/edges/${e.id}`, { label: v }); await s.loadCase(s.caseId!); s.selectEdge(e.id); } }}
            onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()} />
        )}
        <div className="insp-sub"><Dots level={lvl as 1 | 2 | 3 | 4} label /> <span>· {e.kind === 'evidenced' ? 'backed by evidence' : e.kind === 'inferred' ? 'inferred' : 'added by you'}</span></div></div></div>
      <div className="insp-body selectable">
        {a && b && <p className="plain" style={{ marginTop: 6 }}>{explainRelation(e.label, a.label, b.label)}</p>}
        {[a, b].map((n) => n && (
          <button key={n.id} className="conn" onClick={() => s.select([n.id])}><span className="gl"><EntityGlyph type={n.type} size={13} /></span><span className="grow truncate">{n.label}</span><small>{ENTITY_LABEL[n.type]}</small></button>
        ))}
        {f && (<><div className="sec-title">Evidence · {plural(f.evidence.length, 'source')}</div>
          {f.evidence.map((ev) => <div key={ev.id} style={{ padding: '4px 0' }}><div style={{ fontWeight: 600 }}>{ev.adapterName}</div><div className="muted" style={{ fontSize: 12.5 }}>{ev.snippet || 'Match found.'}</div></div>)}</>)}
        {e.kind === 'inferred' && <p className="muted" style={{ fontSize: 12.5 }}>You accepted this link based on a structural hint, not a direct record. It is shown dashed on the graph.</p>}
        <button className="btn sm danger" style={{ marginTop: 16 }} onClick={async () => { await api.del(`/api/edges/${e.id}`); await s.loadCase(s.caseId!); }}><Trash2 size={13} /> Remove link</button>
      </div>
    </>
  );
}

/** When this account is active, from timestamps you have attached (pasted logs, message links, commit times). */
function ActivityTab({ node }: { node: GraphNode }) {
  const s = useStore();
  const [data, setData] = useState<{ count: number; circadian: Circadian | null; dst?: DstResult | null } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; api.get<{ count: number; circadian: Circadian | null; dst: DstResult | null }>(`/api/nodes/${node.id}/activity`).then((r) => { if (live) setData(r); }).catch(() => {}); return () => { live = false; }; }, [node.id]);
  const others = (s.snap?.nodes ?? []).filter((n) => (n.type === 'account' || n.type === 'username') && n.id !== node.id);
  const add = async () => { setBusy(true); try { const r = await api.post<{ count: number; circadian: Circadian | null; dst: DstResult | null }>(`/api/nodes/${node.id}/activity`, { text }); setData(r); setText(''); s.toast('Timestamps added'); } finally { setBusy(false); } };
  return (
    <>
      <div className="sec-title">Active hours</div>
      {typeof node.attrs.commitTz === 'string' && <div className="commit-tz"><b>Commits are written in UTC{node.attrs.commitTz.replace('-', '−')}</b> ({String(node.attrs.commitTzSeen ?? '')} sampled). That is the offset this person's computer was set to, read from the commits themselves, so it is direct evidence of their timezone.</div>}
      {data?.circadian ? <ActivityClock c={data.circadian} dst={data.dst} size={200} compact /> : <div className="faint" style={{ marginBottom: 8 }}>{data?.count ? `${data.count} timestamps so far: not enough yet.` : 'No timestamps yet. Paste message links, a chat export or a log and Plexus will work out when this person is awake, and roughly where.'}</div>}
      <textarea className="field" style={{ width: '100%', minHeight: 84, marginTop: 10, font: '12px var(--mono)' }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste Discord message links, ISO times, Unix times…" aria-label="Timestamps to add" />
      <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => void add()} disabled={!text.trim() || busy}>Add timestamps</button>
        {others.length > 0 && <select className="field" style={{ height: 28 }} defaultValue="" onChange={(e) => { if (e.target.value) s.setMatchLab({ a: node.id, b: e.target.value }); }} aria-label="Compare with another account"><option value="">Compare with…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
      </div>
    </>
  );
}


/** Hundreds of places to look something up by hand: sites that need a login or a person's judgement. Plexus only builds the links. */
function CheckElsewhere({ type, value }: { type: EntityType; value: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const groups = useMemo(() => pivotsFor(type, value), [type, value]);
  useEffect(() => {
    if (!open) return;
    // close on a click anywhere outside this button and its panel (the button itself toggles)
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  if (!groups.length) return null;
  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)} title="Open this in other tools and sites"><Globe2 size={13} /> Check elsewhere</button>
      {open && (
        <div className="menu pivot-pop" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0 }}>
          <div className="pivot-head">{pivotCount(groups)} places to look, opened in your browser. Nothing is sent from here.</div>
          {groups.map((g) => (
            <div key={g.group} className="pivot-group"><div className="pivot-title">{g.group}</div>
              <div className="pivot-links">{g.links.map((l) => <a key={l.url + l.label} className="pivot-link" href={l.url} target="_blank" rel="noreferrer noopener" title={l.note ?? l.url}>{l.label}{l.note ? <small>{l.note}</small> : null}</a>)}</div></div>
          ))}
        </div>
      )}
    </span>
  );
}
