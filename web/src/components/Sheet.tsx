import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X, Check, ChevronUp, ChevronDown, RefreshCw, ArrowLeft, Layers, LoaderCircle, CircleCheck, CircleX, Clock, SkipForward, KeyRound, Minus, Zap, Undo2, CircleHelp, ShieldCheck,
} from 'lucide-react';
import { ENTITY_LABEL, type EntityType, type Finding, type SourceProgress } from '@shared/types';
import { safeImageSrc } from '@shared/normalize';
import { useStore, keyOfNode, type RunState } from '../lib/store';
import { EntityGlyph } from '../lib/icons';
import { TYPE_ORDER, GROUP_LABEL, displayValue, plural } from '../lib/format';
import { Kbd, Popover, isTyping, MOD, useDialog } from './ui';
import { FindingDetail } from './FindingDetail';
import { Avatar } from './ProfileCard';
import { profileOf, type Profile } from '@shared/profile';
import { anchorOf, isKnown } from '@shared/anchors';
import { describeRole, roleFromAttrs } from '@shared/handles';
import { HandleRoleCard } from './HandleRoleCard';
import { Overview } from './Overview';
import { explainRelation, hedge, subjectNoun } from '@shared/explain';

/** Below this width of the dialog body the findings list and the details can't sit side by side. */
const WIDE_AT = 840;

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
  const shown = tab === 'review' ? review : tab === 'accepted' ? accepted : tab === 'rejected' ? rejected : [];

  const [typeFilter, setTypeFilter] = useState<EntityType | null>(null);
  const typeCounts = useMemo(() => TYPE_ORDER.map((t) => ({ type: t, n: shown.filter((f) => f.type === t).length })).filter((x) => x.n), [shown]);
  const filtered = useMemo(() => (typeFilter ? shown.filter((f) => f.type === typeFilter) : shown), [shown, typeFilter]);
  useEffect(() => { if (typeFilter && !typeCounts.some((x) => x.type === typeFilter)) setTypeFilter(null); }, [typeCounts, typeFilter]);
  // the review list is grouped by how sure Plexus is, because that is the order a person wants to decide in; the other tabs by kind of thing
  const [sameOpen, setSameOpen] = useState(false);
  type Group = { key: string; label: string; help: string; level: number; type: EntityType | undefined; items: Finding[]; total?: number };
  const groups = useMemo((): Group[] => {
    const sorted = [...filtered].sort((a, b) => b.rank - a.rank);
    if (tab === 'review') {
      // things found only because they share the name go in their own folded group: most are strangers, and none of them should crowd out the real leads
      const main: Group[] = BANDS.map((b) => ({ key: b.key, label: b.label, help: b.help, level: b.level, type: undefined, items: sorted.filter((f) => !f.nameOnly && f.level === b.level) })).filter((g) => g.items.length);
      const same = sorted.filter((f) => f.nameOnly);
      const open = sameOpen || main.length === 0;
      return same.length ? [...main, { key: 'same', label: 'Same name only', help: 'Most of these are different people', level: 0, type: undefined, items: open ? same : [], total: same.length }] : main;
    }
    return TYPE_ORDER.map((t) => ({ key: t, label: GROUP_LABEL[t], help: '', level: 0, type: t as EntityType | undefined, items: sorted.filter((f) => f.type === t) })).filter((g) => g.items.length);
  }, [filtered, tab, sameOpen]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const knownAnchors = useMemo(() => (s.snap?.nodes ?? []).filter(isKnown).map(anchorOf), [s.snap?.nodes]);
  const profiles = useMemo(() => new Map(flat.map((f) => [f.id, profileOf(f, findings, knownAnchors)])), [flat, findings, knownAnchors]);

  const [cursor, setCursor] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [srcOpen, setSrcOpen] = useState(false);
  const [bodyW, setBodyW] = useState(1000);
  const [detailOpen, setDetailOpen] = useState(false);
  const wide = bodyW >= WIDE_AT;
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setBodyW(el.clientWidth)); ro.observe(el); setBodyW(el.clientWidth);
    return () => ro.disconnect();
  }, [node?.id]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef);
  const scroller = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const cur = flat[Math.min(cursor, flat.length - 1)];
  const flatRef = useRef(flat); flatRef.current = flat;
  const cursorRef = useRef(cursor); cursorRef.current = cursor;
  const wideRef = useRef(wide); wideRef.current = wide;
  const detailRef = useRef(detailOpen); detailRef.current = detailOpen;
  const toAddRef = useRef(toAdd); toAddRef.current = toAdd;

  // Bring a brief that was never computed in this session (e.g. after reload) up to date.
  useEffect(() => { if (findings.length && !run?.brief && run?.status !== 'running' && !run?.briefLoading) void s.refreshBrief(subjectId); }, [subjectId, findings.length === 0]);

  /** Go to a finding wherever it lives: right tab, row highlighted, and on narrow screens its details open. */
  const jumpTo = useCallback((id: string) => {
    const f = useStore.getState().findings[id]; if (!f) return;
    const t = f.status === 'accepted' ? 'accepted' : f.status === 'rejected' ? 'rejected' : 'review';
    useStore.getState().setSheet({ tab: t, triage: false });
    setTimeout(() => {
      const idx = flatRef.current.findIndex((x) => x.id === id);
      if (idx >= 0) setCursor(idx);
      setFlash(id); setTimeout(() => setFlash(null), 1100);
      if (!wideRef.current) setDetailOpen(true);
      rowRefs.current.get(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  }, []);

  const act = useCallback((id: string | undefined, status: Finding['status']) => { if (id) void useStore.getState().review([id], status); }, []);

  const finish = async () => {
    const st = useStore.getState();
    if (toAddRef.current > 0) await st.commit(subjectId);       // anything accepted by an older version that never reached the graph
    st.closeSheet();
    setTimeout(() => window.dispatchEvent(new CustomEvent('plexus:fit')), 450);
  };
  // accepted means correct: it is on the graph already. This only catches findings accepted before that was automatic.
  useEffect(() => { if (toAdd > 0 && run?.status !== 'running') void useStore.getState().commit(subjectId); }, [toAdd, run?.status, subjectId]);

  // --- keyboard -------------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (!st.sheet || st.palette || st.settingsOpen || st.shortcuts) return;
      if (e.key === 'Escape') {
        if (srcOpen) return;
        e.preventDefault();
        if (isTyping(e.target)) { (e.target as HTMLElement).blur(); return; }
        if (detailRef.current) setDetailOpen(false); else if (st.sheet.triage) st.setSheet({ triage: false }); else st.closeSheet();
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
      if (st.sheet.tab === 'overview') {
        if (e.key === 'Enter') { e.preventDefault(); st.setSheet({ tab: 'review' }); }
        return;
      }
      if (e.key === 'ArrowDown' || k === 'j') { e.preventDefault(); setCursor((c) => Math.min(flatRef.current.length - 1, c + 1)); }
      else if (e.key === 'ArrowUp' || k === 'k') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (k === ' ' || e.key === 'Enter') { e.preventDefault(); if (!wideRef.current && flatRef.current.length) setDetailOpen((v) => !v); }
      else if (k === 'a' || k === 'r' || k === 'u') {
        e.preventDefault();
        const f = flatRef.current[Math.min(cursorRef.current, flatRef.current.length - 1)];
        act(f?.id, k === 'a' ? 'accepted' : k === 'r' ? 'rejected' : 'unsure');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [srcOpen, act]);
  useEffect(() => { setCursor((c) => Math.min(c, Math.max(0, flat.length - 1))); }, [flat.length]);
  useEffect(() => { if (flat.length === 0) setDetailOpen(false); }, [flat.length]);
  useEffect(() => { setDetailOpen(false); }, [tab, sheet.triage]);
  useEffect(() => { if (wide) setDetailOpen(false); }, [wide]);
  useEffect(() => { if (cur && !sheet.triage) rowRefs.current.get(cur.id)?.scrollIntoView({ block: 'nearest' }); }, [cur?.id]);

  if (!node) return null;
  const strongPending = review.filter((f) => f.status === 'pending' && f.level >= 3);
  const weakPending = review.filter((f) => f.status === 'pending' && f.level === 1);
  const pendingCount = review.filter((f) => f.status === 'pending').length;
  const srcs = run?.sources ?? [];
  const crossing = srcs.find((x) => x.capability === 'verify');
  const active = srcs.filter((x) => x.state !== 'needs_key' && x.state !== 'skipped' && x.capability !== 'verify');
  const activeDone = active.filter((x) => !['queued', 'running'].includes(x.state)).length;
  const pct = active.length ? (activeDone / active.length) * 100 : 0;
  const subject = { type: node.type, label: node.label };
  const overlay = !wide && detailOpen && !!cur && tab !== 'overview';
  const idx = cur ? flat.findIndex((x) => x.id === cur.id) : -1;
  const TABS = [['overview', 'Overview', null], ['review', 'To review', review.length], ['accepted', 'On your graph', accepted.length], ['rejected', 'Rejected', rejected.length]] as const;

  return (
    <>
      <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => s.closeSheet()} />
      <motion.div ref={dialogRef} tabIndex={-1} aria-modal="true" className="sheet" role="dialog" aria-label={`Findings for ${node.label}`} style={{ x: '-50%', y: '-50%' }}
        initial={{ opacity: 0, scale: .955, y: '-47%' }} animate={{ opacity: 1, scale: 1, y: '-50%' }} exit={{ opacity: 0, scale: .97, y: '-48%' }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
        <div className="sheet-head">
          <span className="subject-chip"><EntityGlyph type={node.type} size={15} /><span className="truncate">{node.label}</span></span>
          <span className="faint head-type" style={{ fontSize: 12 }}>{node.type === 'username' ? describeRole(roleFromAttrs(node.attrs)) : ENTITY_LABEL[node.type]}</span>
          <div className="grow" />
          <button className="src-pill" onClick={() => setSrcOpen(!srcOpen)} aria-expanded={srcOpen} title="Which sources answered">
            {run?.status === 'running' ? <LoaderCircle size={14} className="spin" /> : <Layers size={14} />}
            <span className="src-txt">{srcs.length === 0 ? 'Sources' : run?.status === 'running' ? (crossing?.state === 'running' ? `Cross-checking ${crossing.note ?? ''}` : `Checking ${activeDone} of ${active.length}`) : `${active.filter((x) => x.state === 'done').length} of ${active.length} sources answered`}</span>
          </button>
          <button className="btn icon ghost" aria-label="Run checks again" title="Run checks again" onClick={() => void s.runNode(subjectId, run?.context ?? '', false)} disabled={run?.status === 'running'}><RefreshCw size={15} /></button>
          <button className="btn icon ghost" aria-label="Close" onClick={() => s.closeSheet()}><X size={17} /></button>
        </div>
        {run?.status === 'running' && <div className="progress"><i style={{ width: `${Math.max(6, pct)}%` }} /></div>}
        {srcOpen && <SourcesPopover run={run} onClose={() => setSrcOpen(false)} />}
        {node.type === 'username' && !sheet.triage && (!roleFromAttrs(node.attrs) || (roleFromAttrs(node.attrs)!.kind === 'display-name' && node.attrs.handleSearch !== true)) && <div className="role-banner"><HandleRoleCard node={node} /></div>}

        {!sheet.triage && (
          <div className="sheet-tabs">
            <div className="tabs" role="tablist">
              {TABS.map(([id, label, n]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => s.setSheet({ tab: id })}>{label}{n !== null && <span className="n num">{n}</span>}</button>
              ))}
            </div>
            <div className="grow" />
            {tab === 'review' && pendingCount > 0 && <button className="btn sm outline" title="Go through them one card at a time" onClick={() => s.setSheet({ triage: true })}><Zap size={13} /> <span className="lbl">One by one</span> <Kbd>T</Kbd></button>}
          </div>
        )}

        <div className="sheet-body" ref={bodyRef}>
          {sheet.triage ? (
            <Triage subject={subject} queue={flat.filter((f) => f.status === 'pending')} total={review.length + accepted.length + rejected.length} running={run?.status === 'running'} parked={review.filter((f) => f.status === 'unsure').length}
              onExit={() => s.setSheet({ triage: false })} onFinish={finish} toAdd={accepted.length} act={act} />
          ) : tab === 'overview' ? (
            <div className="ov-scroll">
              <Overview node={subject} run={run} findings={findings} subjectId={subjectId} onOpen={jumpTo} pendingCount={pendingCount} onStart={() => s.setSheet({ tab: 'review' })} />
            </div>
          ) : (
            <div className={`split ${wide ? '' : 'narrow'}`}>
              <div className="left">
                {typeCounts.length > 1 && (
                  <div className="tfilter" role="group" aria-label="Show only">
                    <button className="fchip" aria-pressed={typeFilter === null} onClick={() => setTypeFilter(null)}>All <span className="num">{shown.length}</span></button>
                    {typeCounts.map((x) => <button key={x.type} className="fchip" aria-pressed={typeFilter === x.type} onClick={() => setTypeFilter(typeFilter === x.type ? null : x.type)}><EntityGlyph type={x.type} size={12} /> {GROUP_LABEL[x.type]} <span className="num">{x.n}</span></button>)}
                  </div>
                )}
                <div className="list-scroll" ref={scroller} role="listbox" aria-label="Findings">
                  {flat.length === 0 && <EmptyList run={run} tab={tab} hasAny={findings.length > 0} subjectId={subjectId} />}
                  {groups.map((g) => (
                    <section key={g.key} className={`band ${g.level ? `b${g.level}` : g.key === 'same' ? 'bsame' : ''}`}>
                      <div className="ghead">
                        {g.key === 'same' ? <button className="same-toggle" aria-expanded={g.items.length > 0} onClick={() => setSameOpen(!(sameOpen || groups.length === 1))} title="Accounts that only share the name. Open to look through them."><span className="chev">{g.items.length ? '▾' : '▸'}</span> {g.label}</button>
                          : <>{g.type ? <EntityGlyph type={g.type} size={13} /> : <span className="bdot" style={{ background: `var(--lvl${g.level})` }} />} {g.label}</>} <span className="cnt num">{g.total ?? g.items.length}</span>
                        {g.help && <span className="bhelp">{g.help}</span>}
                        {tab === 'review' && g.level === 4 && g.items.some((f) => f.status === 'pending') && <button className="btn sm band-act" title="Accept every finding in this group: several independent things agree on each" onClick={() => void s.review(g.items.filter((f) => f.status === 'pending').map((f) => f.id), 'accepted', { toast: true })}><Check size={12} /> Accept all {g.items.filter((f) => f.status === 'pending').length}</button>}
                        {tab === 'review' && g.level === 1 && g.items.some((f) => f.status === 'pending') && <button className="btn sm ghost band-act" title="Reject every weak lead" onClick={() => void s.review(g.items.filter((f) => f.status === 'pending').map((f) => f.id), 'rejected', { toast: true })}><X size={12} /> Reject all {g.items.filter((f) => f.status === 'pending').length}</button>}
                      </div>
                      <AnimatePresence initial={false}>
                        {g.items.map((f) => (
                          <Row key={f.id} f={f} tab={tab} subject={subject} profile={profiles.get(f.id)!} isCursor={cur?.id === f.id} flash={flash === f.id}
                            onFocus={() => setCursor(flat.findIndex((x) => x.id === f.id))} onOpen={() => { setCursor(flat.findIndex((x) => x.id === f.id)); if (!wide) setDetailOpen(true); }}
                            reg={(el) => { if (el) rowRefs.current.set(f.id, el); else rowRefs.current.delete(f.id); }} inGraph={nodeKeys.has(`${f.type}:${f.key}`)} />
                        ))}
                      </AnimatePresence>
                    </section>
                  ))}
                </div>
              </div>
              {wide && (
                <aside className="detail-pane" aria-label="Details for the highlighted finding">
                  {cur ? (
                    <FindingDetail key={cur.id} f={cur} subject={subject} onDecide={tab === 'review' ? (st) => act(cur.id, st) : undefined} />
                  ) : <div className="detail-empty">{run?.status === 'running' ? 'Details appear here as soon as the first result arrives.' : 'Pick a finding on the left to see where it came from and how it connects to ' + node.label + '.'}</div>}
                </aside>
              )}
              <AnimatePresence>
                {overlay && cur && (
                  <motion.aside key="ov" className="detail-over" role="dialog" aria-label="Finding details"
                    initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 520, damping: 46 }}>
                    <div className="over-bar">
                      <button className="btn sm ghost" onClick={() => setDetailOpen(false)}><ArrowLeft size={14} /> Back to list</button>
                      <div className="grow" />
                      <span className="faint num">{idx + 1} of {flat.length}</span>
                      <button className="btn icon sm ghost" aria-label="Previous" disabled={idx <= 0} onClick={() => setCursor(Math.max(0, idx - 1))}><ChevronUp size={15} /></button>
                      <button className="btn icon sm ghost" aria-label="Next" disabled={idx >= flat.length - 1} onClick={() => setCursor(Math.min(flat.length - 1, idx + 1))}><ChevronDown size={15} /></button>
                    </div>
                    <div className="over-body"><FindingDetail key={cur.id} f={cur} subject={subject} onDecide={tab === 'review' ? (st) => act(cur.id, st) : undefined} /></div>
                  </motion.aside>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {!sheet.triage && (
          <div className="sheet-foot">
            <div className="hints">
              <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
              <span><Kbd>A</Kbd> accept</span>
              <span><Kbd>R</Kbd> reject</span>
              <span><Kbd>U</Kbd> not sure</span>
            </div>
            <div className="grow" />
            {s.undoStack.length > 0 && <button className="btn ghost sm" onClick={() => void s.undo()}><Undo2 size={13} /> Undo <Kbd>{MOD}Z</Kbd></button>}
            <span className="muted num foot-acc">{accepted.length === 0 ? 'Nothing accepted yet' : `${accepted.length} accepted, already on your graph`}</span>
            <button className="btn primary lg" onClick={() => void finish()}>Done</button>
          </div>
        )}
      </motion.div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ Rows
const BANDS = [
  { key: 'b4', level: 4, label: 'Very likely', help: 'Several independent things agree' },
  { key: 'b3', level: 3, label: 'Likely', help: '' },
  { key: 'b2', level: 2, label: 'Possible', help: 'Worth a look' },
  { key: 'b1', level: 1, label: 'Weak leads', help: 'Probably not it' },
] as const;

const Row = memo(function Row({ f, tab, subject, profile, isCursor, flash, onFocus, onOpen, reg, inGraph }: {
  f: Finding; tab: string; subject: { type: EntityType; label: string }; profile: Profile; isCursor: boolean; flash: boolean; onFocus: () => void; onOpen: () => void; reg: (el: HTMLElement | null) => void; inGraph: boolean;
}) {
  const review = useStore((st) => st.review);
  const sources = new Set(f.evidence.filter((e) => e.polarity !== 'against').map((e) => e.family)).size;
  const matched = f.evidence.filter((e) => e.adapter === 'anchor' && e.polarity !== 'against' && e.family.startsWith('anchor:'));
  const sentence = hedge(explainRelation(f.relation, subjectNoun(subject.type), displayValue(f)), f.level, f.evidence.some((e) => e.polarity === 'against'));
  const conflict = f.conflictsWith?.length;
  const title = profile.rich ? (profile.displayName || profile.handle || displayValue(f)) : displayValue(f);
  const bits = [profile.platform, profile.handle && profile.handle.toLowerCase() !== title.toLowerCase() ? `@${profile.handle.replace(/^@/, '')}` : '', profile.created ? `since ${new Date(profile.created).getUTCFullYear()}` : '', profile.location].filter(Boolean);
  const showAvatar = f.type === 'account' || f.type === 'person' || f.type === 'image' || f.type === 'username';
  return (
    <motion.div ref={reg} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 40, opacity: { duration: .15 } }} style={{ overflow: 'hidden' }}>
      <div className={`frow ${flash ? 'flash' : ''}`} data-cursor={isCursor} onMouseMove={() => !isCursor && onFocus()} onClick={onOpen} role="option" aria-selected={isCursor}>
        <div className="gl">{showAvatar ? <Avatar src={f.type === 'image' ? safeImageSrc(f.value) : profile.avatar} name={title} size={34} type={f.type} /> : <EntityGlyph type={f.type} size={15} />}</div>
        <div className="fr-main">
          <div className="v truncate selectable">
            {title}
            {conflict ? <span className="tag warn" title="Other sources gave a different answer to the same question"><Zap size={10} />Conflict</span> : null}
            {f.nameOnly ? <span className="tag mute" title="Found only because the name is the same. Probably a stranger unless something else ties it in.">Same name only</span> : f.basis === 'reciprocal' ? <span className="tag good" title="Each side points at the other">Confirmed both ways</span> : f.basis === 'self-reported' ? <span className="tag mute" title="This is what the profile says about itself. Anyone can write anything.">Their own claim</span> : null}
            {f.status === 'unsure' && <span className="tag mute">Not sure</span>}
            {inGraph && <span className="tag mute">On graph</span>}
          </div>
          <div className="sub truncate" title={sentence}>{bits.length ? bits.join(' · ') : sentence}</div>
          {matched.length > 0 && <div className="mchip" title={matched.map((m) => m.verdict).join('\n')}><ShieldCheck size={12} /> Matches {matched.length === 1 ? 'something you know' : `${matched.length} things you know`}</div>}
        </div>
        <div className="fr-meta" title={`${Math.round(f.score * 100)}% confidence · ${plural(sources, 'independent source')}`}>
          <span className="pct num" style={{ color: `var(--lvl${f.level})` }}>{Math.round(f.score * 100)}%</span>
          <span className="mbar"><i style={{ width: `${Math.round(f.score * 100)}%`, background: `var(--lvl${f.level})` }} /></span>
        </div>
        <div className="acts" onClick={(e) => e.stopPropagation()}>
          {tab === 'review' ? (<>
            <button className="act no" aria-label="Reject" title="Reject: this is wrong or irrelevant (R)" onClick={() => void review([f.id], 'rejected')}><X size={15} /></button>
            <button className="act ok" aria-label="Accept" title="Accept: this is correct. It goes on the graph and connects (A)" onClick={() => void review([f.id], 'accepted')}><Check size={15} /></button>
          </>) : (
            <button className="act" aria-label="Move back to review" title="Back to review" onClick={() => void review([f.id], 'pending')}><Undo2 size={14} /></button>
          )}
        </div>
      </div>
    </motion.div>
  );
});

function EmptyList({ run, tab, hasAny, subjectId }: { run?: RunState; tab: string; hasAny: boolean; subjectId: string }) {
  const s = useStore();
  if (run?.status === 'running') return (
    <div className="emptystate"><LoaderCircle size={22} className="spin faint" /><h3 style={{ marginTop: 12 }}>Looking…</h3>Results appear here the moment each source answers.</div>
  );
  if (tab === 'review' && hasAny) return <div className="emptystate"><CircleCheck size={26} style={{ color: 'var(--lvl4)' }} /><h3 style={{ marginTop: 10 }}>All reviewed</h3>Accepted findings are ready to add to the graph.</div>;
  if (tab !== 'review') return <div className="emptystate">Nothing here yet.</div>;
  const needKey = run?.sources.filter((x) => x.state === 'needs_key').length ?? 0;
  const errs = run?.sources.filter((x) => x.state === 'error' || x.state === 'rate_limited').length ?? 0;
  const answered = run?.sources.filter((x) => x.state === 'done' || x.state === 'empty').length ?? 0;
  const mostlyDown = errs > 0 && errs >= answered;
  return (
    <div className="emptystate">
      <h3>{mostlyDown ? "Couldn't reach most sources" : 'Nothing found'}</h3>
      {run && !mostlyDown && <>Checked {answered} source{answered === 1 ? '' : 's'} and none had anything on this.</>}
      {mostlyDown && <>{errs} of {errs + answered} sources failed or were rate limited, so this isn't a real “nothing”. Check your connection, then try again.</>}
      {errs > 0 && !mostlyDown && <div style={{ marginTop: 6 }}>{errs} source{errs > 1 ? 's' : ''} failed or were rate limited. Open the sources list above for details.</div>}
      {mostlyDown && <div style={{ marginTop: 12 }}><button className="btn" onClick={() => void s.runNode(subjectId, run?.context ?? '', false)}>Try again</button></div>}
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

function Triage({ queue, total, running, parked, onExit, onFinish, toAdd: reviewedAccepted, act, subject }: {
  subject: { type: EntityType; label: string }; queue: Finding[]; total: number; running: boolean; parked: number; onExit: () => void; onFinish: () => void; toAdd: number; act: (id: string | undefined, st: Finding['status']) => void;
}) {
  const s = useStore();
  const f = queue[0];
  const [dir, setDir] = useState(0);
  const reviewed = Math.max(0, total - queue.length);
  const decide = (st: Finding['status']) => { setDir(st === 'accepted' ? 1 : st === 'rejected' ? -1 : 0); act(f?.id, st); };
  return (
    <div className="triage">
      <div className="tri-top">
        <button className="btn ghost sm" onClick={onExit}><ArrowLeft size={14} /> Back to list</button>
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
              <FindingDetail f={f} subject={subject} />
            </motion.div>
          ) : (
            <motion.div key="done" className="tri-done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center' }}>
              {running ? (<><LoaderCircle size={26} className="spin faint" style={{ margin: '0 auto' }} /><h3>Waiting for more results…</h3><p className="muted">Sources are still answering.</p></>) : (<>
                <CircleCheck size={36} style={{ color: 'var(--lvl4)', margin: '0 auto' }} />
                <h3>All reviewed</h3>
                <p className="muted">{reviewedAccepted > 0 ? `${reviewedAccepted} accepted and already on your graph.` : 'Nothing accepted yet.'}{parked > 0 ? ` ${parked} parked as unsure.` : ''}</p>
                <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                  <button className="btn" onClick={onExit}>Back to list</button>
                  <button className="btn primary lg" onClick={onFinish}>Done</button>
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
          <button className="tri-btn" onClick={() => decide('unsure')}><CircleHelp size={17} /> Not sure <Kbd>U</Kbd></button>
          <button className="tri-btn ok" onClick={() => decide('accepted')}><Check size={17} /> Accept <Kbd>A</Kbd></button>
        </div>
      )}
    </div>
  );
}
