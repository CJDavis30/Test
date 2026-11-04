import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X, Check, RefreshCw, TriangleAlert, ChevronRight, CircleHelp, ArrowLeft, Layers, LoaderCircle, CircleCheck, CircleX, Clock, SkipForward, KeyRound, Minus, ExternalLink, Zap, Sparkles, Undo2,
} from 'lucide-react';
import { ENTITY_LABEL, LEVEL_LABEL, type EntityType, type Finding, type SourceProgress } from '@shared/types';
import { initials } from '@shared/normalize';
import { useStore, keyOfNode, type RunState } from '../lib/store';
import { EntityGlyph } from '../lib/icons';
import { TYPE_ORDER, GROUP_LABEL, displayValue, hostOf, ago, fmtDate, plural } from '../lib/format';
import { Dots, Kbd, Popover, isTyping, MOD } from './ui';

const CONTEXT_IDEAS = ['Employer', 'Other accounts', 'Location', 'Associates', 'Infrastructure', 'Money'];
const srcLetter = (n: string) => n.replace(/^Demo · /, '').trim()[0]?.toUpperCase() ?? '?';

export function Sheet() {
  const s = useStore();
  // Keep the last open state while the exit animation plays (the store has already cleared it by then).
  const last = useRef(s.sheet);
  if (s.sheet) last.current = s.sheet;
  const sheet = last.current!;
  const subjectId = sheet.subjectId;
  const node = s.snap?.nodes.find((n) => n.id === subjectId);
  const run = s.runs[subjectId];
  const all = s.findings;
  const findings = useMemo(() => Object.values(all).filter((f) => f.subjectId === subjectId), [all, subjectId]);
  const nodeKeys = useMemo(() => new Set((s.snap?.nodes ?? []).map(keyOfNode)), [s.snap?.nodes]);

  const review = useMemo(() => findings.filter((f) => f.status === 'pending' || f.status === 'unsure'), [findings]);
  const accepted = useMemo(() => findings.filter((f) => f.status === 'accepted'), [findings]);
  const rejected = useMemo(() => findings.filter((f) => f.status === 'rejected'), [findings]);
  const toAdd = useMemo(() => accepted.filter((f) => !nodeKeys.has(`${f.type}:${f.key}`)).length, [accepted, nodeKeys]);
  const tab = sheet.tab;
  const shown = tab === 'review' ? review : tab === 'accepted' ? accepted : rejected;

  const groups = useMemo(() => TYPE_ORDER.map((t) => ({ type: t, items: shown.filter((f) => f.type === t).sort((a, b) => b.rank - a.rank) })).filter((g) => g.items.length), [shown]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [srcOpen, setSrcOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const cur = flat[Math.min(cursor, flat.length - 1)];

  // Bring a brief that was never computed in this session (e.g. after reload) up to date.
  useEffect(() => { if (findings.length && !run?.brief && run?.status !== 'running' && !run?.briefLoading) void s.refreshBrief(subjectId); }, [subjectId, findings.length === 0]);

  const jumpTo = useCallback((id: string) => {
    const f = useStore.getState().findings[id]; if (!f) return;
    const t = f.status === 'accepted' ? 'accepted' : f.status === 'rejected' ? 'rejected' : 'review';
    useStore.getState().setSheet({ tab: t, triage: false });
    setTimeout(() => {
      const idx = flatRef.current.findIndex((x) => x.id === id);
      if (idx >= 0) setCursor(idx);
      setFlash(id); setTimeout(() => setFlash(null), 1100);
      rowRefs.current.get(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  }, []);
  const flatRef = useRef(flat); flatRef.current = flat;

  const act = useCallback((id: string | undefined, status: Finding['status']) => { if (id) void useStore.getState().review([id], status); }, []);

  // --- keyboard -------------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (!st.sheet || st.palette || st.settingsOpen) return;
      if (e.key === 'Escape') {
        if (srcOpen) return;
        e.preventDefault();
        if (isTyping(e.target)) { (e.target as HTMLElement).blur(); return; }
        if (expanded) setExpanded(null); else if (st.sheet.triage) st.setSheet({ triage: false }); else st.closeSheet();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); void st.undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void finish(); return; }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const inTriage = st.sheet.triage;
      const k = e.key.toLowerCase();
      if (k === 't') { e.preventDefault(); st.setSheet({ triage: !inTriage, tab: 'review' }); return; }
      if (inTriage) {
        const q = flatRef.current.filter((f) => f.status === 'pending');
        const top = q[0];
        if (k === 'a') { e.preventDefault(); act(top?.id, 'accepted'); }
        else if (k === 'r') { e.preventDefault(); act(top?.id, 'rejected'); }
        else if (k === 'u') { e.preventDefault(); act(top?.id, 'unsure'); }
        else if (e.key === 'ArrowLeft' || k === 'z') { e.preventDefault(); void st.undo(); }
        return;
      }
      if (e.key === 'ArrowDown' || k === 'j') { e.preventDefault(); setCursor((c) => Math.min(flatRef.current.length - 1, c + 1)); }
      else if (e.key === 'ArrowUp' || k === 'k') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (k === ' ') { e.preventDefault(); const id = flatRef.current[Math.min(cursorRef.current, flatRef.current.length - 1)]?.id; if (id) setExpanded((x) => (x === id ? null : id)); }
      else if (k === 'a' || k === 'r' || k === 'u') {
        e.preventDefault();
        const f = flatRef.current[Math.min(cursorRef.current, flatRef.current.length - 1)];
        act(f?.id, k === 'a' ? 'accepted' : k === 'r' ? 'rejected' : 'unsure');
      } else if (k === 'p' && e.shiftKey) { /* reserved */ }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, srcOpen, act, toAdd]);
  const cursorRef = useRef(cursor); cursorRef.current = cursor;
  useEffect(() => { setCursor((c) => Math.min(c, Math.max(0, flat.length - 1))); }, [flat.length]);
  useEffect(() => { if (cur && !sheet.triage) rowRefs.current.get(cur.id)?.scrollIntoView({ block: 'nearest' }); }, [cur?.id]);

  const finish = async () => {
    const st = useStore.getState();
    if (toAddRef.current > 0) {
      const { added } = await st.commit(subjectId);
      st.toast(added > 0 ? `Added ${added} to the graph` : 'Graph updated');
      st.closeSheet();
      setTimeout(() => window.dispatchEvent(new CustomEvent('plexus:fit')), 450);
    } else st.closeSheet();
  };
  const toAddRef = useRef(toAdd); toAddRef.current = toAdd;

  if (!node) return null;
  const strongPending = review.filter((f) => f.status === 'pending' && f.level >= 3);
  const weakPending = review.filter((f) => f.status === 'pending' && f.level === 1);
  const done = run?.status === 'done';
  const srcs = run?.sources ?? [];
  const finished = srcs.filter((x) => !['queued', 'running'].includes(x.state)).length;
  const active = srcs.filter((x) => x.state !== 'needs_key' && x.state !== 'skipped');
  const activeDone = active.filter((x) => !['queued', 'running'].includes(x.state)).length;
  const pct = active.length ? (activeDone / active.length) * 100 : 0;
  void finished;

  return (
    <>
      <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => s.closeSheet()} />
      <motion.div className="sheet" role="dialog" aria-label={`Findings for ${node.label}`} style={{ x: '-50%', y: '-50%' }}
        initial={{ opacity: 0, scale: .955, y: '-47%' }} animate={{ opacity: 1, scale: 1, y: '-50%' }} exit={{ opacity: 0, scale: .97, y: '-48%' }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
        <div className="sheet-head">
          <span className="subject-chip"><EntityGlyph type={node.type} size={15} /><span className="truncate">{node.label}</span></span>
          <span className="faint" style={{ fontSize: 12 }}>{ENTITY_LABEL[node.type]}</span>
          <div className="grow" />
          <button className="src-pill" onClick={() => setSrcOpen(!srcOpen)} aria-expanded={srcOpen}>
            {run?.status === 'running' ? <LoaderCircle size={14} className="spin" /> : <Layers size={14} />}
            {srcs.length === 0 ? 'Sources' : run?.status === 'running' ? `Checking ${activeDone} of ${active.length}` : `${active.filter((x) => x.state === 'done').length} of ${active.length} sources answered`}
          </button>
          <button className="btn icon ghost" aria-label="Run checks again" title="Run checks again" onClick={() => void s.runNode(subjectId, run?.context ?? '', false)} disabled={run?.status === 'running'}><RefreshCw size={15} /></button>
          <button className="btn icon ghost" aria-label="Close" onClick={() => s.closeSheet()}><X size={17} /></button>
        </div>
        {run?.status === 'running' && <div className="progress"><i style={{ width: `${Math.max(6, pct)}%` }} /></div>}
        {srcOpen && <SourcesPopover run={run} onClose={() => setSrcOpen(false)} />}

        <div className="sheet-body">
          {sheet.triage ? (
            <Triage queue={flat.filter((f) => f.status === 'pending')} total={review.length + accepted.length + rejected.length} running={run?.status === 'running'} parked={review.filter((f) => f.status === 'unsure').length}
              onExit={() => s.setSheet({ triage: false })} onFinish={finish} toAdd={toAdd} act={act} />
          ) : (
            <>
              <Brief node={node} run={run} findings={findings} onJump={jumpTo} subjectId={subjectId} />
              <ContextBar subjectId={subjectId} run={run} />
              <div className="list-head">
                <div className="tabs" role="tablist">
                  {([['review', 'To review', review.length], ['accepted', 'Accepted', accepted.length], ['rejected', 'Rejected', rejected.length]] as const).map(([id, label, n]) => (
                    <button key={id} role="tab" aria-selected={tab === id} onClick={() => s.setSheet({ tab: id })}>{label}<span className="n num">{n}</span></button>
                  ))}
                </div>
                <div className="grow" />
                {tab === 'review' && strongPending.length > 0 && <button className="btn sm" onClick={() => void s.review(strongPending.map((f) => f.id), 'accepted', { toast: true })}>Accept {strongPending.length} strong</button>}
                {tab === 'review' && weakPending.length > 0 && <button className="btn sm ghost" onClick={() => void s.review(weakPending.map((f) => f.id), 'rejected', { toast: true })}>Reject {weakPending.length} weak</button>}
                {tab === 'review' && review.some((f) => f.status === 'pending') && <button className="btn sm outline" onClick={() => s.setSheet({ triage: true })}><Zap size={13} /> Triage <Kbd>T</Kbd></button>}
              </div>
              <div className="list-scroll" ref={scroller}>
                {flat.length === 0 && <EmptyList run={run} tab={tab} hasAny={findings.length > 0} />}
                {groups.map((g) => (
                  <section key={g.type}>
                    <div className="ghead">
                      <EntityGlyph type={g.type} size={13} /> {GROUP_LABEL[g.type]} <span className="cnt num">{g.items.length}</span>
                      {tab === 'review' && (
                        <span className="acts">
                          {g.items.some((f) => f.status === 'pending' && f.level >= 3) && <button className="btn sm ghost" onClick={() => void s.review(g.items.filter((f) => f.status === 'pending' && f.level >= 3).map((f) => f.id), 'accepted', { toast: true })}>Accept strong</button>}
                          {g.items.some((f) => f.status === 'pending' && f.level === 1) && <button className="btn sm ghost" onClick={() => void s.review(g.items.filter((f) => f.status === 'pending' && f.level === 1).map((f) => f.id), 'rejected', { toast: true })}>Reject weak</button>}
                        </span>
                      )}
                    </div>
                    <AnimatePresence initial={false}>
                      {g.items.map((f) => (
                        <Row key={f.id} f={f} tab={tab} isCursor={cur?.id === f.id && !sheet.triage} isOpen={expanded === f.id} flash={flash === f.id}
                          onFocus={() => setCursor(flat.findIndex((x) => x.id === f.id))} onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
                          reg={(el) => { if (el) rowRefs.current.set(f.id, el); else rowRefs.current.delete(f.id); }} inGraph={nodeKeys.has(`${f.type}:${f.key}`)} />
                      ))}
                    </AnimatePresence>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>

        {!sheet.triage && (
          <div className="sheet-foot">
            <div className="hints">
              <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
              <span><Kbd>A</Kbd> accept</span>
              <span><Kbd>R</Kbd> reject</span>
              <span><Kbd>U</Kbd> unsure</span>
              <span><Kbd>Space</Kbd> evidence</span>
            </div>
            <div className="grow" />
            {s.undoStack.length > 0 && <button className="btn ghost sm" onClick={() => void s.undo()}><Undo2 size={13} /> Undo <Kbd>{MOD}Z</Kbd></button>}
            <span className="muted num">{accepted.length} accepted</span>
            <button className="btn primary lg" onClick={() => void finish()}>{toAdd > 0 ? `Add ${toAdd} to graph` : 'Done'}</button>
          </div>
        )}
      </motion.div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Brief
function Brief({ node, run, findings, onJump, subjectId }: { node: { label: string; type: EntityType }; run?: RunState; findings: Finding[]; onJump: (id: string) => void; subjectId: string }) {
  const s = useStore();
  const brief = run?.brief;
  const live = findings.filter((f) => f.status !== 'rejected');
  const photo = live.filter((f) => f.type === 'image').sort((a, b) => b.rank - a.rank)[0];
  const conf = brief?.confidence;
  const searching = run?.status === 'running' && !brief;
  const top = (t: EntityType) => live.filter((f) => f.type === t).sort((a, b) => b.rank - a.rank)[0];
  const chips = (['person', 'email', 'phone', 'username', 'org', 'location'] as EntityType[]).map(top).filter(Boolean).filter((f) => f.value.toLowerCase() !== node.label.toLowerCase());
  const R = 34, C = 2 * Math.PI * R;

  const summary = useMemo(() => {
    if (!brief) return null;
    const parts = brief.summary.split(/(\[F\d+\])/g);
    return parts.map((p, i) => {
      const m = p.match(/^\[(F\d+)\]$/);
      if (!m) return <span key={i}>{p}</span>;
      const fid = brief.cites[m[1]];
      const f = fid ? useStore.getState().findings[fid] : null;
      if (!f) return null;
      return <button key={i} className="cite" title={`${f.value}`} onClick={() => onJump(f.id)}>{m[1].slice(1)}</button>;
    });
  }, [brief, onJump]);

  return (
    <div className="brief">
      <div className="photo">
        <svg className="ringsvg" viewBox="0 0 76 76" width="76" height="76" aria-hidden>
          <circle cx="38" cy="38" r={R} fill="none" stroke="var(--line)" strokeWidth="2.5" />
          {conf && <circle cx="38" cy="38" r={R} fill="none" stroke={`var(--lvl${conf.level})`} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - conf.score)} style={{ transition: 'stroke-dashoffset .8s var(--ease)' }} />}
        </svg>
        <div className="img">{photo ? <img src={photo.value} alt="" /> : node.type === 'person' || node.type === 'org' ? initials(node.label) : <EntityGlyph type={node.type} size={26} />}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        {searching ? (
          <><div className="skeleton" style={{ height: 26, width: '62%', margin: '4px 0 12px' }} /><div className="skeleton" style={{ height: 14, width: '92%', marginBottom: 7 }} /><div className="skeleton" style={{ height: 14, width: '70%' }} /></>
        ) : (
          <>
            <h2 className="selectable">{brief?.headline ?? node.label}</h2>
            <div className="summary selectable">{summary ?? (run?.briefLoading ? 'Summarizing…' : findings.length ? '' : 'No findings yet.')}</div>
          </>
        )}
      </div>
      <div className="meter">
        {conf ? (<>
          <div className="big" style={{ color: `var(--lvl${conf.level})` }}>{conf.label}</div>
          <Dots level={conf.level} />
          <small>{plural(conf.independentSources, 'independent source')}</small>
          {brief?.by === 'ai' && <small style={{ marginTop: 4, display: 'inline-flex', gap: 4, alignItems: 'center' }}><Sparkles size={11} /> Written by AI, citations checked</small>}
        </>) : searching ? <div className="skeleton" style={{ height: 40, width: 110, marginLeft: 'auto' }} /> : null}
      </div>
      {brief && brief.caveats.length > 0 && (
        <div className="caveats">{brief.caveats.map((c, i) => <div className="caveat" key={i}><TriangleAlert size={13} />{c}</div>)}</div>
      )}
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((f) => (
            <button key={f.id} className="chipf" onClick={() => onJump(f.id)} title={`${ENTITY_LABEL[f.type]} · ${LEVEL_LABEL[f.level]}`}>
              <EntityGlyph type={f.type} size={14} /><span className="truncate">{displayValue(f)}</span><Dots level={f.level} />
            </button>
          ))}
        </div>
      )}
      {run && run.next.length > 0 && (
        <div className="nexts">
          <span className="lab">Next</span>
          {run.next.slice(0, 4).map((n, i) => (
            <button key={i} className="nextchip" title={n.reason} onClick={() => void s.pivot(n, subjectId)}>
              <EntityGlyph type={n.type} size={13} /><span className="truncate">{n.value}</span><ChevronRight size={13} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ContextBar({ subjectId, run }: { subjectId: string; run?: RunState }) {
  const s = useStore();
  const [v, setV] = useState(run?.context ?? '');
  const timer = useRef<number>(0);
  const apply = (val: string) => {
    setV(val); s.setContext(subjectId, val);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { if (useStore.getState().runs[subjectId]?.status !== 'running') void useStore.getState().refreshBrief(subjectId); }, 900);
  };
  return (
    <div className="ctxbar">
      <Sparkles size={15} className="faint" />
      <input value={v} onChange={(e) => apply(e.target.value)} placeholder="What are you looking for? e.g. employer, other accounts, where they live…" aria-label="Investigation context" />
      {!v && <div className="ctx-sugs">{CONTEXT_IDEAS.slice(0, 4).map((c) => <button key={c} className="ctx-sug" onClick={() => apply(c.toLowerCase())}>{c}</button>)}</div>}
      {v && <button className="btn icon sm ghost" aria-label="Clear" onClick={() => apply('')}><X size={13} /></button>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Rows
const Row = memo(function Row({ f, tab, isCursor, isOpen, flash, onFocus, onToggle, reg, inGraph }: {
  f: Finding; tab: string; isCursor: boolean; isOpen: boolean; flash: boolean; onFocus: () => void; onToggle: () => void; reg: (el: HTMLElement | null) => void; inGraph: boolean;
}) {
  const review = useStore((st) => st.review);
  const names = [...new Set(f.evidence.map((e) => e.adapterName))];
  const sub = f.conflictsWith?.length
    ? <><span className="tag warn"><Zap size={10} />Disagrees</span>{f.reasons.find((r) => r.startsWith('Disagrees')) ?? f.relation}</>
    : <>{f.status === 'unsure' && <span className="tag mute">Unsure</span>}{f.relation}{f.when ? ` · ${fmtDate(f.when)}` : ''}{f.evidence.find((e) => e.snippet)?.snippet ? ` · ${f.evidence.find((e) => e.snippet)!.snippet}` : ''}</>;
  return (
    <motion.div ref={reg} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 40, opacity: { duration: .15 } }} style={{ overflow: 'hidden' }}>
      <div className={`frow ${flash ? 'flash' : ''}`} data-cursor={isCursor} onMouseMove={() => !isCursor && onFocus()} onClick={onToggle} role="option" aria-selected={isCursor}>
        <Dots level={f.level} />
        <div className="gl">{f.type === 'image' ? <img src={f.value} alt="" /> : <EntityGlyph type={f.type} size={15} />}</div>
        <div style={{ minWidth: 0 }}>
          <div className="v truncate selectable">{displayValue(f)}{inGraph && <span className="tag mute" style={{ marginLeft: 8 }}>On graph</span>}</div>
          <div className="sub truncate">{sub}</div>
        </div>
        <div className="srcs" title={names.join(', ')}>
          <span className="srcstack">{names.slice(0, 3).map((n) => <i key={n}>{srcLetter(n)}</i>)}</span>
          <span className="num">{f.evidence.length}</span>
        </div>
        <div className="acts" onClick={(e) => e.stopPropagation()}>
          {tab === 'review' ? (<>
            <button className="act no" aria-label="Reject" title="Reject (R)" onClick={() => void review([f.id], 'rejected')}><X size={15} /></button>
            <button className="act ok" aria-label="Accept" title="Accept (A)" onClick={() => void review([f.id], 'accepted')}><Check size={15} /></button>
          </>) : (
            <button className="act" aria-label="Move back to review" title="Back to review" onClick={() => void review([f.id], 'pending')}><Undo2 size={14} /></button>
          )}
        </div>
      </div>
      {isOpen && <Evidence f={f} />}
    </motion.div>
  );
});

function Evidence({ f }: { f: Finding }) {
  return (
    <div className="evidence selectable">
      {f.reasons.length > 0 && <div className="reasons">{f.reasons.map((r) => <span key={r} className="reason">{r}</span>)}</div>}
      {f.evidence.map((e) => (
        <div className="ev" key={e.id}>
          <span className="nm truncate">{e.adapterName}</span>
          <span className="sn">{e.snippet || <span className="faint">Match found, no excerpt</span>}{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer noopener">{hostOf(e.url)} <ExternalLink size={10} style={{ verticalAlign: -1 }} /></a></>}</span>
          <span className="meta"><span className="wbar"><i style={{ width: `${Math.round(e.weight * 100)}%` }} /></span>{ago(e.retrievedAt)}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyList({ run, tab, hasAny }: { run?: RunState; tab: string; hasAny: boolean }) {
  const s = useStore();
  if (run?.status === 'running') return (
    <div className="emptystate"><LoaderCircle size={22} className="spin faint" /><h3 style={{ marginTop: 12 }}>Looking…</h3>Results appear here the moment each source answers.</div>
  );
  if (tab === 'review' && hasAny) return <div className="emptystate"><CircleCheck size={26} style={{ color: 'var(--lvl4)' }} /><h3 style={{ marginTop: 10 }}>All reviewed</h3>Accepted findings are ready to add to the graph.</div>;
  if (tab !== 'review') return <div className="emptystate">Nothing here yet.</div>;
  const needKey = run?.sources.filter((x) => x.state === 'needs_key').length ?? 0;
  const errs = run?.sources.filter((x) => x.state === 'error' || x.state === 'rate_limited').length ?? 0;
  return (
    <div className="emptystate">
      <h3>Nothing found</h3>
      {run && <>Checked {run.sources.filter((x) => x.state === 'done' || x.state === 'empty').length} sources and none had anything on this.</>}
      {errs > 0 && <div style={{ marginTop: 6 }}>{errs} source{errs > 1 ? 's' : ''} failed or were rate limited. Open the sources list above for details.</div>}
      {needKey > 0 && <div style={{ marginTop: 10 }}><button className="btn" onClick={() => s.openSettings('sources')}><KeyRound size={14} /> {needKey} more source{needKey > 1 ? 's' : ''} available with API keys</button></div>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Sources popover
const STATE_ICON: Record<SourceProgress['state'], React.ReactNode> = {
  queued: <Clock size={14} className="faint" />, running: <LoaderCircle size={14} className="spin" />, done: <CircleCheck size={15} style={{ color: 'var(--lvl4)' }} />,
  empty: <Minus size={15} className="faint" />, error: <CircleX size={15} style={{ color: 'var(--danger)' }} />, rate_limited: <Clock size={14} style={{ color: 'var(--lvl2)' }} />,
  skipped: <SkipForward size={14} className="faint" />, needs_key: <KeyRound size={14} className="faint" />,
};
function SourcesPopover({ run, onClose }: { run?: RunState; onClose: () => void }) {
  const s = useStore();
  const list = run?.sources ?? [];
  const order = ['running', 'done', 'empty', 'rate_limited', 'error', 'queued', 'skipped', 'needs_key'];
  const sorted = [...list].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.name.localeCompare(b.name));
  return (
    <Popover onClose={onClose} className="srclist">
      <div className="label">Sources for this lookup</div>
      {sorted.length === 0 && <div className="empty-note">No sources have run yet.</div>}
      {sorted.map((x) => (
        <div className="srcrow" key={x.adapter}>
          <span className="st">{STATE_ICON[x.state]}</span>
          <div className="grow"><div className="truncate" style={{ fontWeight: 500 }}>{x.name}</div>
            <small className="truncate">{x.error ?? x.note ?? (x.state === 'done' ? `${plural(x.count, 'result')}${x.cached ? ' · cached' : ''}` : x.state === 'empty' ? 'Nothing found' : x.state === 'running' ? 'Checking…' : x.state === 'queued' ? 'Waiting' : '')}</small></div>
          {x.ms !== undefined && <small className="num">{x.ms < 1000 ? `${x.ms}ms` : `${(x.ms / 1000).toFixed(1)}s`}</small>}
          {x.state === 'needs_key' && <button className="btn sm" onClick={() => { onClose(); s.openSettings('sources'); }}>Add key</button>}
        </div>
      ))}
    </Popover>
  );
}

// ------------------------------------------------------------------------------------------------ Triage
const TRI_VARIANTS = {
  enter: { opacity: 0, scale: .96, y: 14 },
  center: { opacity: 1, scale: 1, y: 0, x: 0, rotate: 0 },
  exit: (d: number) => ({ opacity: 0, x: d * 180, rotate: d * 5, transition: { duration: .22 } }),
};

function Triage({ queue, total, running, parked, onExit, onFinish, toAdd, act }: {
  queue: Finding[]; total: number; running: boolean; parked: number; onExit: () => void; onFinish: () => void; toAdd: number; act: (id: string | undefined, st: Finding['status']) => void;
}) {
  const s = useStore();
  const f = queue[0];
  const [dir, setDir] = useState(0);
  const reviewed = Math.max(0, total - queue.length);
  const decide = (st: Finding['status']) => { setDir(st === 'accepted' ? 1 : st === 'rejected' ? -1 : 0); act(f?.id, st); };
  return (
    <div className="triage">
      <div className="tri-top">
        <button className="btn ghost sm" onClick={onExit}><ArrowLeft size={14} /> List</button>
        <div className="tri-bar"><i style={{ width: `${total ? (reviewed / total) * 100 : 0}%` }} /></div>
        <span className="num">{Math.min(reviewed + 1, total)} of {total}</span>
      </div>
      <div className="tri-stage">
        {queue.length > 1 && <div className="tri-stack" />}
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          {f ? (
            <motion.div key={f.id} className="tri-card selectable" custom={dir}
              variants={TRI_VARIANTS} initial="enter" animate="center" exit="exit"
              transition={{ type: 'spring', stiffness: 440, damping: 34 }}>
              <div className="typ"><EntityGlyph type={f.type} size={16} /> {ENTITY_LABEL[f.type]} · {f.relation}</div>
              {f.type === 'image' ? <img src={f.value} alt="" style={{ width: 120, height: 120, borderRadius: 20, margin: '14px 0', objectFit: 'cover' }} /> : <div className="big">{displayValue(f)}</div>}
              <div className="row" style={{ marginBottom: 14 }}><Dots level={f.level} label /><span className="faint">· {plural(f.evidence.length, 'source')}</span>{f.when && <span className="faint">· {fmtDate(f.when)}</span>}</div>
              {f.conflictsWith?.length ? <div className="caveat" style={{ marginBottom: 12 }}><TriangleAlert size={13} />{f.reasons.find((r) => r.startsWith('Disagrees')) ?? 'Conflicts with another value'}</div> : null}
              <div className="reasons" style={{ marginBottom: 16 }}>{f.reasons.map((r) => <span key={r} className="reason">{r}</span>)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {f.evidence.slice(0, 5).map((e) => (
                  <div className="ev" key={e.id} style={{ gridTemplateColumns: '156px 1fr auto' }}>
                    <span className="nm truncate">{e.adapterName}</span>
                    <span className="sn">{e.snippet || <span className="faint">Match found</span>}{e.url && <> · <a href={e.url} target="_blank" rel="noreferrer noopener">{hostOf(e.url)}</a></>}</span>
                    <span className="meta">{ago(e.retrievedAt)}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div key="done" className="tri-done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center' }}>
              {running ? (<><LoaderCircle size={26} className="spin faint" style={{ margin: '0 auto' }} /><h3>Waiting for more results…</h3><p className="muted">Sources are still answering.</p></>) : (<>
                <CircleCheck size={36} style={{ color: 'var(--lvl4)', margin: '0 auto' }} />
                <h3>All reviewed</h3>
                <p className="muted">{toAdd > 0 ? `${toAdd} accepted and ready to add.` : 'Nothing accepted yet.'}{parked > 0 ? ` ${parked} parked as unsure.` : ''}</p>
                <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                  <button className="btn" onClick={onExit}>Back to list</button>
                  <button className="btn primary lg" onClick={onFinish}>{toAdd > 0 ? `Add ${toAdd} to graph` : 'Done'}</button>
                </div>
              </>)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {f && (
        <div className="tri-btns">
          <button className="tri-btn" onClick={() => void s.undo()} disabled={!s.undoStack.length} aria-label="Undo last"><ArrowLeft size={16} /> <Kbd>←</Kbd></button>
          <button className="tri-btn" onClick={() => decide('rejected')}><X size={17} /> Reject <Kbd>R</Kbd></button>
          <button className="tri-btn" onClick={() => decide('unsure')}><CircleHelp size={17} /> Unsure <Kbd>U</Kbd></button>
          <button className="tri-btn ok" onClick={() => decide('accepted')}><Check size={17} /> Accept <Kbd>A</Kbd></button>
        </div>
      )}
    </div>
  );
}
