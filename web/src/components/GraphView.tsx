import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Minus, Maximize2, Route, Focus, X, Sparkles, Pin, PinOff, Play, Copy, Trash2, FolderOpen, Link2, Merge, Check, Orbit, Shuffle, Wand2, Rocket, ShieldAlert, History, Pause } from 'lucide-react';
import { startAutopilot } from '../lib/autopilot';
import { LEVEL_LABEL } from '@shared/types';
import { ENTITY_LABEL } from '@shared/types';
import { useStore, keyOfNode } from '../lib/store';
import { api } from '../lib/api';
import { explainRelation } from '@shared/explain';
import { GraphEngine, type Hover, type LayoutMode } from '../lib/graph';
import { neighborhood, shortestPath } from '../lib/graphMath';
import { EntityGlyph } from '../lib/icons';
import { Dots, Kbd, Popover, isTyping } from './ui';
import { Welcome } from './Welcome';

export function GraphView() {
  const s = useStore();
  const { snap, selection, selectedEdge, suggestions, pathFor } = s;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const eng = useRef<GraphEngine | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [menu, setMenu] = useState<{ id: string | null; x: number; y: number } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [stressMap, setStressMap] = useState(false);
  const [minScore, setMinScore] = useState(0);
  useEffect(() => { eng.current?.setMinScore(minScore); }, [minScore]);
  const stress = useStore((st) => st.stress);
  const allFindings = useStore((st) => st.findings);
  const weakIds = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const f of Object.values(allFindings)) { const v = stress[f.id]?.verdict; if (f.status !== 'rejected' && (v === 'single' || v === 'fragile')) byKey.set(`${f.type}:${f.key}`, v); }
    return (snap?.nodes ?? []).filter((n) => n.state === 'confirmed' && byKey.has(keyOfNode(n))).map((n) => n.id);
  }, [allFindings, stress, snap?.nodes]);
  useEffect(() => { eng.current?.setWeak(stressMap ? new Set(weakIds) : null); }, [stressMap, weakIds]);
  const [sugOpen, setSugOpen] = useState(false);
  const [mode, setMode] = useState<LayoutMode>(() => { try { return localStorage.getItem('plexus.layout') === 'free' ? 'free' : 'organized'; } catch { return 'organized'; } });
  const modeRef = useRef(mode); modeRef.current = mode;

  const allNodes = snap?.nodes ?? [];
  const allEdges = snap?.edges ?? [];
  // Replay: watch the investigation grow in the order things were found. Nothing is changed, only what is shown.
  const [replay, setReplay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const replayRef = useRef(false); replayRef.current = replay !== null;
  const order = useMemo(() => [...allNodes].filter((n) => n.state !== 'seed').sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)), [allNodes]);
  const { nodes, edges } = useMemo(() => {
    if (replay === null) return { nodes: allNodes, edges: allEdges };
    const keep = new Set(allNodes.filter((n) => n.state === 'seed').map((n) => n.id));
    for (const n of order.slice(0, replay)) keep.add(n.id);
    return { nodes: allNodes.filter((n) => keep.has(n.id)), edges: allEdges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
  }, [replay, allNodes, allEdges, order]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setReplay((r) => { const next = (r ?? 0) + 1; if (next >= order.length) { setPlaying(false); return order.length; } return next; }), Math.max(120, Math.min(600, 6000 / Math.max(1, order.length))));
    return () => clearInterval(t);
  }, [playing, order.length]);
  const replayWhen = replay !== null && replay > 0 ? order[Math.min(replay, order.length) - 1] : null;
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // --- engine lifecycle ---------------------------------------------------------------------------------------------
  useEffect(() => {
    const c = canvas.current!;
    const e = new GraphEngine(c, {
      onSelect: (ids, add) => useStore.getState().select(ids, add),
      onSelectEdge: (id) => useStore.getState().selectEdge(id),
      onOpen: (id) => { const st = useStore.getState(); const n = st.snap?.nodes.find((x) => x.id === id); if (n?.pinned && false) return; void st.openNode(id); },
      onContext: (id, x, y) => { if (id) useStore.getState().select([id], false); setMenu({ id, x, y }); },
      onHover: setHover,
      onSettle: (items) => {
        const st = useStore.getState();
        if (!st.caseId || !st.snap || replayRef.current) return;
        void api.post(`/api/cases/${st.caseId}/positions`, { items }).catch(() => {});
        // Keep the store's idea of "pinned" in step with what the user did on the canvas, otherwise the next data
        // change would think those nodes are unpinned and let them drift.
        const pinned = new Map(items.map((i) => [i.id, i.pinned]));
        if (st.snap.nodes.some((n) => pinned.has(n.id) && !!n.pinned !== pinned.get(n.id))) {
          useStore.setState({ snap: { ...st.snap, nodes: st.snap.nodes.map((n) => (pinned.has(n.id) ? { ...n, pinned: pinned.get(n.id) } : n)) } });
        }
      },
      onEmptyDouble: () => useStore.getState().openPalette(),
    }, modeRef.current);
    eng.current = e;
    if (location.search.includes('debug')) (window as any).__plexusEngine = e;
    const ro = new ResizeObserver(() => { const r = wrap.current!.getBoundingClientRect(); e.setSize(r.width, r.height, window.devicePixelRatio || 1); });
    ro.observe(wrap.current!);
    const r = wrap.current!.getBoundingClientRect(); e.setSize(r.width, r.height, window.devicePixelRatio || 1);
    const pal = () => e.refreshPalette();
    const mo = new MutationObserver(pal); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', pal);
    const fit = () => e.fit(true);
    const pan = (ev: Event) => e.panTo((ev as CustomEvent<string>).detail);
    window.addEventListener('plexus:fit', fit);
    window.addEventListener('plexus:pan', pan);
    const tidy = () => e.tidy();
    window.addEventListener('plexus:tidy', tidy);
    return () => {
      window.removeEventListener('plexus:tidy', tidy); ro.disconnect(); mo.disconnect(); mq.removeEventListener('change', pal); window.removeEventListener('plexus:fit', fit); window.removeEventListener('plexus:pan', pan); e.destroy(); eng.current = null; };
  }, []);

  useEffect(() => { eng.current?.setMode(mode); try { localStorage.setItem('plexus.layout', mode); } catch { /* storage unavailable */ } }, [mode]);

  // Node positions on the server only matter on load; afterwards the engine owns them.
  useEffect(() => { eng.current?.setData(nodes, edges); }, [nodes, edges]);
  useEffect(() => { eng.current?.setSelection(selection, selectedEdge); }, [selection, selectedEdge]);

  const path = useMemo(() => (pathFor && pathFor.length === 2 ? shortestPath(nodes, edges, pathFor[0], pathFor[1]) : null), [pathFor, nodes, edges]);
  useEffect(() => { eng.current?.setHighlight(path ? { nodes: path.nodes, edges: path.edges } : null); }, [path]);
  useEffect(() => {
    if (focusMode && selection.length) eng.current?.setFocus(new Set(selection.flatMap((id) => [...neighborhood(edges, id, 1)])));
    else eng.current?.setFocus(null);
  }, [focusMode, selection, edges]);

  // --- keyboard -----------------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || s.sheet || s.palette || s.settingsOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useStore.getState();
      const sel = st.selection;
      if (e.key === 'f') { setFocusMode((v) => !v); }
      else if (e.key === 'p' && sel.length === 2) { st.setPath(st.pathFor ? null : [sel[0], sel[1]]); }
      else if (e.key === '0') eng.current?.fit(true);
      else if (e.key === '+' || e.key === '=') eng.current?.zoomBy(1.25);
      else if (e.key === '-') eng.current?.zoomBy(0.8);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); void st.removeNodes(sel); }
      else if (e.key === 'Escape') { st.setPath(null); setFocusMode(false); st.select([], false); st.selectEdge(null); setMenu(null); }
      else if ((e.key === 'Enter' || e.key === 'r') && sel.length === 1) { e.preventDefault(); void (e.key === 'r' ? st.runNode(sel[0]) : st.openNode(sel[0])); }
      else if (e.key === 'l' && sel.length === 2) { void st.addEdge(sel[0], sel[1]); }
      else if (e.key === 'c' && sel.length === 2 && sel.every((id) => ['account', 'username'].includes(st.snap?.nodes.find((n) => n.id === id)?.type ?? ''))) { st.setMatchLab({ a: sel[0], b: sel[1] }); }
      else if (e.key === 'm' && sel.length === 2) { void st.mergeNodes(sel[0], sel[1]); }
      else if (e.key === 'a' && !e.shiftKey) { /* reserved */ }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.sheet, s.palette, s.settingsOpen]);

  useEffect(() => { if (!pathFor) return; if (selection.length !== 2) s.setPath(null); }, [selection]);

  const hn = hover?.kind === 'node' ? nodeMap.get(hover.id) : null;
  const he = hover?.kind === 'edge' ? edges.find((e) => e.id === hover.id) : null;
  const degree = (id: string) => edges.filter((e) => e.from === id || e.to === id).length;

  return (
    <div className="stage" ref={wrap} data-view="graph">
      <canvas ref={canvas} aria-label="Relationship graph" role="img" />
      {allNodes.length === 0 && <Welcome />}

      {allNodes.length > 0 && (
        <>
          <div className="stage-top">
            <AnimatePresence>
              {path && (
                <motion.div className="float-pill" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                  <Route size={14} /> {path.nodes.length - 1} hop{path.nodes.length === 2 ? '' : 's'} · {Math.round(path.strength * 100)}% chain strength
                  <button className="btn icon sm ghost" aria-label="Clear path" onClick={() => s.setPath(null)}><X size={13} /></button>
                </motion.div>
              )}
              {pathFor && !path && <motion.div className="float-pill" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>No connection between these two yet <button className="btn icon sm ghost" onClick={() => s.setPath(null)}><X size={13} /></button></motion.div>}
              {focusMode && selection.length > 0 && (
                <motion.div className="float-pill" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                  <Focus size={14} /> Focus
                  <button className="btn icon sm ghost" aria-label="Exit focus" onClick={() => setFocusMode(false)}><X size={13} /></button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="stage-note">
            {weakIds.length > 0 && (
              <button className="float-pill" aria-pressed={stressMap} onClick={() => setStressMap(!stressMap)} title="Highlight the conclusions that hang on a single source: if that source is wrong, they fall apart"><ShieldAlert size={14} /> {stressMap ? 'Showing' : 'Show'} {weakIds.length} weak {weakIds.length === 1 ? 'point' : 'points'}</button>
            )}
            {order.length > 1 && replay === null && (
              <button className="float-pill" onClick={() => { setReplay(0); setPlaying(true); }} title="Watch the investigation grow in the order things were found"><History size={14} /> Replay</button>
            )}
            {replay !== null && (
              <div className="float-pill replay-bar" role="group" aria-label="Replay the investigation">
                <button className="btn icon sm ghost" aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => { if (!playing && replay >= order.length) setReplay(0); setPlaying(!playing); }}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
                <input type="range" min={0} max={order.length} step={1} value={replay} onChange={(e) => { setPlaying(false); setReplay(Number(e.target.value)); }} aria-label="Replay position" aria-valuetext={`${replay} of ${order.length} things found`} />
                <span className="num replay-when">{replayWhen ? `${replay}/${order.length} · ${new Date(replayWhen.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : `0/${order.length}`}</span>
                <button className="btn icon sm ghost" aria-label="Exit replay" onClick={() => { setPlaying(false); setReplay(null); }}><X size={13} /></button>
              </div>
            )}
            {replay === null && nodes.some((n) => n.score !== undefined) && (
              <label className="float-pill conf-pill" title="Fade everything the evidence supports less than this">
                <span>Confidence</span>
                <input type="range" min={0} max={90} step={5} value={Math.round(minScore * 100)} onChange={(e) => setMinScore(Number(e.target.value) / 100)} aria-label="Minimum confidence to show on the graph" aria-valuetext={minScore === 0 ? 'Showing everything' : `Showing ${Math.round(minScore * 100)} percent and above`} />
                <b className="num">{minScore === 0 ? 'All' : `${Math.round(minScore * 100)}%+`}</b>
              </label>
            )}
            {suggestions.length > 0 && (
              <button className="float-pill" onClick={() => setSugOpen(!sugOpen)}><Sparkles size={14} /> {suggestions.length} suggested {suggestions.length === 1 ? 'link' : 'links'}</button>
            )}
            {selection.length === 2 && !path && <span className="float-pill faint"><Kbd>P</Kbd> trace path · <Kbd>L</Kbd> link · <Kbd>M</Kbd> merge</span>}
            {selection.length === 1 && <span className="float-pill faint"><Kbd>↵</Kbd> open · <Kbd>R</Kbd> run checks · <Kbd>F</Kbd> focus</span>}
          </div>
          {sugOpen && suggestions.length > 0 && (
            <Popover onClose={() => setSugOpen(false)} className="suggest-pop">
              <div className="label">Suggested links</div>
              {suggestions.slice(0, 12).map((g) => {
                const a = nodeMap.get(g.a), b = nodeMap.get(g.b);
                if (!a || !b) return null;
                return (
                  <div className="sug" key={g.id}>
                    <div className="grow">
                      <div style={{ fontWeight: 500 }} className="truncate">{a.label} <span className="faint">{g.kind === 'merge' ? '≈' : '→'}</span> {b.label}</div>
                      <div className="why">{g.label} · {g.reason}{g.by === 'ai' ? ' (AI)' : ''}</div>
                    </div>
                    <div className="row" style={{ gap: 4, alignSelf: 'center' }}>
                      <button className="btn icon sm" aria-label="Accept" title={g.kind === 'merge' ? 'Merge' : 'Add link'} onClick={() => void s.acceptSuggestion(g)}><Check size={13} /></button>
                      <button className="btn icon sm ghost" aria-label="Dismiss" onClick={() => s.dismissSuggestion(g.id)}><X size={13} /></button>
                    </div>
                  </div>
                );
              })}
            </Popover>
          )}

          <div className="zoomctl">
            <button aria-label="Zoom in" onClick={() => eng.current?.zoomBy(1.25)}><Plus size={15} /></button>
            <button aria-label="Zoom out" onClick={() => eng.current?.zoomBy(0.8)}><Minus size={15} /></button>
            <button aria-label="Fit to window" title="Fit to window (0)" onClick={() => eng.current?.fit(true)}><Maximize2 size={14} /></button>
            <button aria-label={`Layout: ${mode === 'organized' ? 'organized' : 'free-form'}. Click to switch`} title={mode === 'organized' ? 'Organized layout. Click for free-form' : 'Free-form layout. Click for organized'} onClick={() => setMode(mode === 'organized' ? 'free' : 'organized')}>{mode === 'organized' ? <Orbit size={15} /> : <Shuffle size={15} />}</button>
            <button aria-label="Tidy up" title="Tidy up: forget manual positions" onClick={() => eng.current?.tidy()}><Wand2 size={14} /></button>
          </div>
        </>
      )}

      {hover && (hn || he) && !menu && (
        <div className="hover-tip" style={{ left: Math.min(hover.x + 14, (wrap.current?.clientWidth ?? 600) - 290), top: hover.y + 16 }}>
          {hn && (<>
            <div className="row" style={{ gap: 6 }}><EntityGlyph type={hn.type} size={13} /><b className="truncate">{hn.label}</b></div>
            <small>{ENTITY_LABEL[hn.type]} · {degree(hn.id)} link{degree(hn.id) === 1 ? '' : 's'}{hn.state === 'seed' ? ' · not yet reviewed' : ''}</small>
            {hn.level && <div style={{ marginTop: 4 }}><Dots level={hn.level} label /></div>}
          </>)}
          {he && (<><b>{nodeMap.get(he.from) && nodeMap.get(he.to) ? explainRelation(he.label, nodeMap.get(he.from)!.label, nodeMap.get(he.to)!.label) : he.label}</b><small>{he.kind === 'inferred' ? 'Inferred link' : he.kind === 'manual' ? 'Added by you' : 'Backed by evidence'} · {LEVEL_LABEL[he.strength >= 0.85 ? 4 : he.strength >= 0.65 ? 3 : he.strength >= 0.4 ? 2 : 1]}</small></>)}
        </div>
      )}

      {menu && <NodeMenu menu={menu} onClose={() => setMenu(null)} eng={eng.current} />}
    </div>
  );
}

function NodeMenu({ menu, onClose, eng }: { menu: { id: string | null; x: number; y: number }; onClose: () => void; eng: GraphEngine | null }) {
  const s = useStore();
  const n = menu.id ? s.snap?.nodes.find((x) => x.id === menu.id) : null;
  const others = s.selection.filter((id) => id !== menu.id);
  if (!menu.id || !n) {
    return (
      <Popover onClose={onClose} className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
        <button className="item" onClick={() => { onClose(); s.openPalette(); }}><Plus size={14} /> Add something…</button>
        <button className="item" onClick={() => { onClose(); eng?.fit(true); }}><Maximize2 size={14} /> Fit to window</button>
        <button className="item" onClick={() => { onClose(); eng?.tidy(); }}><Wand2 size={14} /> Tidy up layout</button>
      </Popover>
    );
  }
  const run = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <Popover onClose={onClose} className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
      <button className="item" onClick={run(() => void s.openNode(n.id))}><FolderOpen size={14} /> Open findings</button>
      <button className="item" onClick={run(() => void s.runNode(n.id))}><Play size={14} /> Run checks again</button>
      <button className="item" onClick={run(() => void startAutopilot({ nodeId: n.id }))}><Rocket size={14} /> Autopilot from here</button>
      <div className="sep" />
      {others.length === 1 && <>
        <button className="item" onClick={run(() => s.setPath([menu.id!, others[0]]))}><Route size={14} /> Trace path to selected</button>
        <button className="item" onClick={run(() => void s.addEdge(menu.id!, others[0]))}><Link2 size={14} /> Link to selected</button>
        <button className="item" onClick={run(() => void s.mergeNodes(menu.id!, others[0]))}><Merge size={14} /> Merge selected into this</button>
        <div className="sep" />
      </>}
      <button className="item" onClick={run(() => (n.pinned ? (eng?.unpin(n.id), void s.patchNode(n.id, { pinned: false })) : (eng?.pin(n.id), void s.patchNode(n.id, { pinned: true }))))}>{n.pinned ? <PinOff size={14} /> : <Pin size={14} />} {n.pinned ? 'Unpin' : 'Pin in place'}</button>
      <button className="item" onClick={run(() => void navigator.clipboard?.writeText(n.value))}><Copy size={14} /> Copy value</button>
      <div className="sep" />
      <button className="item danger" onClick={run(() => void s.removeNodes([n.id]))}><Trash2 size={14} /> Remove from graph</button>
    </Popover>
  );
}
