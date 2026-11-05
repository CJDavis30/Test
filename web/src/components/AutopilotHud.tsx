import { AnimatePresence, motion } from 'motion/react';
import { Rocket, Square, X, Check, Eye, Users, LoaderCircle, Search, ShieldCheck, ArrowRightCircle, Undo2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { dismissAutopilot, startAutopilot, stopAutopilot, undoAutopilot, type ApLine } from '../lib/autopilot';

const ICON: Record<ApLine['kind'], React.ReactNode> = {
  look: <Search size={13} />, follow: <ArrowRightCircle size={13} />, check: <ShieldCheck size={13} />, accept: <Check size={13} />, keep: <Eye size={13} />,
};

/** Autopilot, live: what it is looking at, what it accepted, what it left for you. Nothing it does is hidden. */
export function AutopilotHud() {
  const s = useStore();
  const ap = s.autopilot;
  const reviewLeft = () => {
    const pend = Object.values(s.findings).filter((f) => f.status === 'pending' || f.status === 'unsure');
    const bySubject = new Map<string, number>(); for (const f of pend) bySubject.set(f.subjectId, (bySubject.get(f.subjectId) ?? 0) + 1);
    const top = [...bySubject.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ap?.seed.id;
    if (top) { dismissAutopilot(); s.openSheet(top, 'review'); }
  };
  return (
    <AnimatePresence>
      {ap && (
        <motion.section className="aphud" role="status" aria-live="polite" aria-label="Autopilot" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
          <header>
            <span className="aph-ic">{ap.status === 'running' ? <LoaderCircle size={15} className="spin" /> : <Rocket size={15} />}</span>
            <div className="grow"><b>{ap.status === 'running' ? (ap.summary?.dryRun || ap.limits.subjects === 0 ? 'Autopilot dry run' : 'Autopilot is working') : ap.undone ? 'Autopilot undone' : ap.summary?.dryRun ? 'Dry run finished' : ap.status === 'stopped' ? 'Autopilot stopped' : ap.status === 'error' ? 'Autopilot hit a problem' : 'Autopilot finished'}</b><small className="truncate">from {ap.seed.label}</small></div>
            {ap.status === 'running'
              ? <button className="btn sm" onClick={() => void stopAutopilot()}><Square size={11} /> Stop</button>
              : <button className="btn icon sm ghost" aria-label="Dismiss Autopilot" onClick={dismissAutopilot}><X size={14} /></button>}
          </header>
          <div className="aph-stats"><span><b className="num">{ap.nodes}</b> on the graph</span><span><b className="num">{ap.accepted}</b> accepted</span><span><b className="num">{ap.kept}</b> left for you</span></div>
          {ap.status === 'running' && ap.current && (
            <div className="aph-now">
              <div><small>Step {ap.current.n} of up to {ap.limits.subjects}</small> <b className="truncate">{ap.current.phase === 'judging' ? 'Deciding what is strong enough' : ap.current.phase === 'checking' ? 'Cross-checking' : 'Looking up'} {ap.current.phase === 'looking' ? ap.current.label : ''}</b></div>
              {ap.current.total ? <span className="aph-bar"><i style={{ width: `${Math.min(100, ((ap.current.done ?? 0) / ap.current.total) * 100)}%` }} /></span> : null}
            </div>
          )}
          <ul className="aph-feed" aria-label="What Autopilot has done">
            {ap.lines.slice(-6).map((l) => <li key={l.id} className={l.kind}>{ICON[l.kind]}<span>{l.text}</span></li>)}
          </ul>
          {ap.status === 'error' && <p className="aph-note">{ap.error}</p>}
          {ap.status !== 'running' && ap.status !== 'error' && ap.summary && (
            <>
              {ap.undone ? <p className="aph-note">Everything Autopilot accepted is back in your review list, and what it added to the graph is gone. Your own decisions were not touched.</p>
                : ap.summary.dryRun ? <p className="aph-note"><b>Dry run: nothing was changed.</b> Autopilot would have accepted {ap.summary.accepted} {ap.summary.accepted === 1 ? 'finding' : 'findings'} and left {ap.kept} for you. It looked at the starting point only, since it can only follow leads that are on the graph.</p>
                : <p className="aph-note">Looked up {ap.summary.subjects} {ap.summary.subjects === 1 ? 'thing' : 'things'} in {ap.summary.seconds}s. It only accepted findings that several independent sources agreed on and nothing disputed. Everything else is waiting for your review.</p>}
              <div className="aph-actions">
                {ap.summary.dryRun && !ap.undone && <button className="btn primary sm" onClick={() => void startAutopilot({ nodeId: ap.seed.id })}><Rocket size={13} /> Run it for real</button>}
                {!ap.summary.dryRun && !ap.undone && ap.summary.accepted > 0 && <button className="btn sm" onClick={() => void undoAutopilot()}><Undo2 size={13} /> Undo everything</button>}
                {!ap.summary.dryRun && ap.summary.pending > 0 && <button className="btn primary sm" onClick={reviewLeft}>Review {ap.summary.pending} left</button>}
                <button className="btn sm" onClick={() => { dismissAutopilot(); s.setView('identities'); }}><Users size={13} /> Who is who</button>
              </div>
            </>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
