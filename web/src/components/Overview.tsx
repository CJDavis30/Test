import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Check, Sparkles, TriangleAlert, X } from 'lucide-react';
import { ENTITY_LABEL, type EntityType, type Finding } from '@shared/types';
import { initials, safeImageSrc } from '@shared/normalize';
import { explainRelation } from '@shared/explain';
import { useStore, type RunState } from '../lib/store';
import { EntityGlyph } from '../lib/icons';
import { TYPE_ORDER, displayValue, plural } from '../lib/format';
import { Dots } from './ui';

const CONTEXT_IDEAS = ['Employer', 'Other accounts', 'Location', 'Associates'];

/** The first screen of a lookup: what was found in a sentence or two, a map of how it all connects, and where to dig next. */
export function Overview({ node, run, findings, subjectId, onOpen, onStart, pendingCount }: {
  node: { label: string; type: EntityType }; run?: RunState; findings: Finding[]; subjectId: string; onOpen: (id: string) => void; onStart: () => void; pendingCount: number;
}) {
  const s = useStore();
  const brief = run?.brief;
  const conf = brief?.confidence;
  const live = findings.filter((f) => f.status !== 'rejected');
  const photo = live.filter((f) => f.type === 'image').sort((a, b) => b.rank - a.rank)[0];
  const searching = run?.status === 'running' && !brief;
  const R = 30, C = 2 * Math.PI * R;

  const summary = useMemo(() => {
    if (!brief) return null;
    return brief.summary.split(/(\[F\d+\])/g).map((p, i) => {
      const m = p.match(/^\[(F\d+)\]$/);
      if (!m) return <span key={i}>{p}</span>;
      const fid = brief.cites[m[1]];
      const f = fid ? useStore.getState().findings[fid] : null;
      if (!f) return null;
      return <button key={i} className="cite" title={displayValue(f)} onClick={() => onOpen(f.id)}>{m[1].slice(1)}</button>;
    });
  }, [brief, onOpen]);

  return (
    <div className="overview">
      <section className="ov-top">
        <div className="photo">
          <svg className="ringsvg" viewBox="0 0 68 68" width="68" height="68" aria-hidden>
            <circle cx="34" cy="34" r={R} fill="none" stroke="var(--line)" strokeWidth="2.5" />
            {conf && <circle cx="34" cy="34" r={R} fill="none" stroke={`var(--lvl${conf.level})`} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - conf.score)} style={{ transition: 'stroke-dashoffset .8s var(--ease)' }} />}
          </svg>
          <div className="img">{photo ? <img src={safeImageSrc(photo.value)} alt="" /> : node.type === 'person' || node.type === 'org' ? initials(node.label) : <EntityGlyph type={node.type} size={24} />}</div>
        </div>
        <div className="ov-text">
          {searching ? (
            <><div className="skeleton" style={{ height: 24, width: '60%', marginBottom: 10 }} /><div className="skeleton" style={{ height: 13, width: '92%', marginBottom: 7 }} /><div className="skeleton" style={{ height: 13, width: '70%' }} /></>
          ) : (
            <>
              <h2 className="selectable">{brief?.headline ?? node.label}</h2>
              <div className="summary selectable">{summary ?? (run?.briefLoading ? 'Summarizing…' : findings.length ? '' : 'Nothing found yet.')}</div>
            </>
          )}
          {brief && brief.caveats.length > 0 && (
            <div className="caveats">{brief.caveats.map((c, i) => <div className="caveat" key={i}><TriangleAlert size={13} />{c}</div>)}</div>
          )}
        </div>
        <div className="ov-meter">
          {conf ? (<>
            <div className="big" style={{ color: `var(--lvl${conf.level})` }}>{Math.round(conf.score * 100)}%</div>
            <Dots level={conf.level} label />
            <small>{plural(conf.independentSources, 'independent source')}</small>
            {brief?.by === 'ai' && <small className="ai"><Sparkles size={11} /> AI-written, citations checked</small>}
          </>) : searching ? <div className="skeleton" style={{ height: 34, width: 90 }} /> : null}
        </div>
      </section>

      <div className="ov-cta">
        <button className="btn primary lg" onClick={onStart} disabled={pendingCount === 0}>
          {pendingCount > 0 ? <>Review {pendingCount} {pendingCount === 1 ? 'finding' : 'findings'} <ChevronRight size={15} /></> : run?.status === 'running' ? 'Waiting for results…' : 'Nothing left to review'}
        </button>
        <ContextBar subjectId={subjectId} run={run} />
      </div>

      <section>
        <div className="ov-title">
          <h3>How it connects</h3>
          <span className="legend"><i className="lg-acc" />Accepted<i className="lg-pen" />To review<i className="lg-uns" />Not sure<span className="faint">· thicker line = more confident</span></span>
        </div>
        <ConnectionMap subject={node} findings={live} onOpen={onOpen} />
      </section>

      {run && run.next.length > 0 && (
        <section>
          <div className="ov-title"><h3>Dig deeper</h3><span className="faint">Look these up next to widen the picture</span></div>
          <div className="nexts">
            {run.next.slice(0, 6).map((n, i) => (
              <button key={i} className="nextchip" title={n.reason} onClick={() => void s.pivot(n, subjectId)}>
                <EntityGlyph type={n.type} size={13} /><span className="truncate">{n.value}</span><ChevronRight size={13} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function ContextBar({ subjectId, run }: { subjectId: string; run?: RunState }) {
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
      <input value={v} onChange={(e) => apply(e.target.value)} placeholder="What are you looking for? e.g. employer, other accounts…" aria-label="Investigation context" />
      {!v && <div className="ctx-sugs">{CONTEXT_IDEAS.slice(0, 3).map((c) => <button key={c} className="ctx-sug" onClick={() => apply(c.toLowerCase())}>{c}</button>)}</div>}
      {v && <button className="btn icon sm ghost" aria-label="Clear" onClick={() => apply('')}><X size={13} /></button>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Connection map
const ROW = 50, PAD = 14, NODE_H = 40;

/**
 * The subject in the middle, everything found fanned out either side in tidy rows (so nothing can overlap),
 * each joined by a curve whose thickness is its confidence. Click a row to see its evidence.
 */
function ConnectionMap({ subject, findings, onOpen }: { subject: { label: string; type: EntityType }; findings: Finding[]; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const two = w >= 620;
  const sorted = useMemo(() => [...findings].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || b.rank - a.rank), [findings]);
  const { left, right } = useMemo(() => {
    if (!two) return { left: [] as Finding[], right: sorted };
    // Whole type-groups go to whichever side is shorter, so related things stay together and both sides stay balanced.
    const byType = TYPE_ORDER.map((t) => sorted.filter((f) => f.type === t)).filter((g) => g.length);
    const l: Finding[] = [], r: Finding[] = [];
    for (const g of byType) (r.length <= l.length ? r : l).push(...g);
    return { left: l, right: r };
  }, [sorted, two]);

  if (findings.length === 0) return <div ref={ref} className="cmap-empty">Connections will appear here as findings come in.</div>;

  const CW = Math.round(Math.min(250, Math.max(150, subject.label.length * 7.6 + 56)));
  const rows = Math.max(left.length, right.length, 1);
  const H = two ? Math.max(rows * ROW + PAD * 2, 150) : 56 + rows * ROW + PAD;
  const cx = two ? w / 2 : 0, cy = two ? H / 2 : 24;
  const colW = two ? Math.min(300, (w - CW) / 2 - 36) : w - 40;
  const place = (list: Finding[], side: 'l' | 'r') => {
    if (!two) return list.map((f, i) => ({ f, side, y: 56 + i * ROW + ROW / 2, x: 40 }));
    const total = list.length * ROW, top = (H - total) / 2;
    return list.map((f, i) => ({ f, side, y: top + i * ROW + ROW / 2, x: side === 'l' ? 0 : w - colW }));
  };
  const placed = [...place(left, 'l'), ...place(right, 'r')];

  return (
    <div ref={ref} className="cmap" style={{ height: H }} role="group" aria-label="Map of everything found and how it connects">
      <svg width={w} height={H} className="cmap-svg" aria-hidden>
        {placed.map(({ f, side, x, y }) => {
          let d: string;
          if (two) {
            const x0 = side === 'l' ? cx - CW / 2 : cx + CW / 2;
            const x1 = side === 'l' ? x + colW : x;
            const mid = (x0 + x1) / 2;
            d = `M${x0},${cy} C${mid},${cy} ${mid},${y} ${x1},${y}`;
          } else d = `M20,${cy + 24} V${y - 12} Q20,${y} 32,${y} H${x}`; // a spine down the left with a short elbow to each row
          const dim = hover && hover !== f.id;
          return <path key={f.id} d={d} fill="none" className={`cm-edge ${f.status}`} style={{ strokeWidth: two ? 1 + f.score * 2.2 : 1.5, opacity: dim ? 0.18 : 1 }} data-hot={hover === f.id} />;
        })}
      </svg>
      <div className="cm-center" style={two ? { left: cx - CW / 2, top: cy - 24, width: CW } : { left: 0, top: 0, maxWidth: '100%' }} title={`${ENTITY_LABEL[subject.type]}: ${subject.label}`}>
        <EntityGlyph type={subject.type} size={15} /><span className="truncate">{subject.label}</span>
      </div>
      {placed.map(({ f, x, y }) => {
        const sentence = explainRelation(f.relation, subject.label, displayValue(f));
        return (
          <button key={f.id} className={`cm-node ${f.status}`} style={{ left: x, top: y - NODE_H / 2, width: colW, height: NODE_H }}
            title={`${displayValue(f)}\n${sentence}\n${Math.round(f.score * 100)}% confidence`}
            onClick={() => onOpen(f.id)} onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(f.id)} onBlur={() => setHover(null)}>
            <span className="cm-gl">{f.type === 'image' ? <img src={safeImageSrc(f.value)} alt="" /> : <EntityGlyph type={f.type} size={13} />}</span>
            <span className="cm-tx"><b className="truncate">{displayValue(f)}</b><small className="truncate">{shortRelation(f.relation)}</small></span>
            {f.status === 'accepted' ? <Check size={13} className="cm-ok" /> : <span className="cm-pct num">{Math.round(f.score * 100)}%</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A few words, not a sentence: "work email", "profile photo". */
function shortRelation(relation: string): string {
  return relation.replace(/[-_]/g, ' ');
}
