import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, X } from 'lucide-react';
import { CARE_GUIDANCE } from '@shared/safeguards';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { useDialog } from './ui';

/** Shown across the top of the work area when the case may involve a young person. Says what was seen, what Plexus is holding back, and what to do instead. */
export function CareBanner() {
  const s = useStore();
  const care = s.snap?.case.care;
  const [open, setOpen] = useState(false);
  if (!care?.youth || !s.caseId) return null;
  const set = async (youth: boolean) => {
    const r = await api.put<NonNullable<typeof care>>(`/api/cases/${s.caseId}/care`, { youth });
    const sn = useStore.getState().snap; if (sn) useStore.setState({ snap: { ...sn, case: { ...sn.case, care: r } } });
    s.toast(youth ? 'Marked as possibly involving a young person' : 'Marked as not involving a young person (logged)');
  };
  return (
    <div className="care" role="alert">
      <ShieldAlert size={17} />
      <div className="care-t">
        <b>This may involve a young person.</b> {care.reasons[0] ? <span className="faint">({care.reasons[0]})</span> : null} Plexus is holding back from steps that point toward a real name, number, email or place, and will ask before you accept one.
        {open && <ul>{CARE_GUIDANCE.map((g) => <li key={g}>{g}</li>)}</ul>}
      </div>
      <button className="btn sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'What to do'}</button>
      <button className="btn sm ghost" onClick={() => void set(false)} title="Only if you are sure. This is logged.">Not a minor</button>
    </div>
  );
}

const PURPOSES = ['Scam or fraud', 'Harassment or impersonation', 'Trust and safety report', 'Journalism', 'Due diligence', 'Missing person lead', 'Security research'];

/** Live lookups need a reason on the record. Asked once per case, written into the tamper-evident log. */
export function PurposeDialog() {
  const ask = useStore((s) => s.purposeAsk)!;
  const ref = useRef<HTMLDivElement>(null);
  const done = (ok: boolean) => useStore.getState().purposeAsk?.resolve(ok);
  useDialog(ref, { onEscape: () => done(false) });
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');
  const purpose = [pick, text.trim()].filter(Boolean).join(': ');
  const save = async () => {
    await api.patch(`/api/cases/${ask.caseId}`, { purpose });
    useStore.setState({ cases: useStore.getState().cases.map((c) => (c.id === ask.caseId ? { ...c, purpose } : c)), snap: useStore.getState().snap?.case.id === ask.caseId ? { ...useStore.getState().snap!, case: { ...useStore.getState().snap!.case, purpose } } : useStore.getState().snap });
    done(true);
  };
  return (
    <>
      <div className="scrim" onMouseDown={() => done(false)} />
      <motion.div ref={ref} tabIndex={-1} aria-modal="true" role="dialog" aria-label="What is this investigation for?" className="modal" style={{ x: '-50%', y: '-50%' }} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
        <button className="btn icon ghost close-x" style={{ position: 'absolute', right: 12, top: 12 }} aria-label="Cancel" onClick={() => done(false)}><X size={17} /></button>
        <h2>What is this investigation for?</h2>
        <p>Live lookups reach real services about real people. Plexus asks for a reason once per case and writes it into the tamper-evident activity log. It is for your own accountability, and it never leaves this Mac.</p>
        <div className="purposes" role="radiogroup" aria-label="Purpose">{PURPOSES.map((p) => <button key={p} role="radio" aria-checked={pick === p} className={`purpose ${pick === p ? 'on' : ''}`} onClick={() => setPick(pick === p ? '' : p)}>{p}</button>)}</div>
        <input className="field" style={{ width: '100%', marginTop: 10 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Anything to add (optional unless you chose none above)" aria-label="Purpose details" onKeyDown={(e) => e.key === 'Enter' && purpose && void save()} />
        <div className="actions"><button className="btn" onClick={() => done(false)}>Cancel</button><button className="btn primary" disabled={!purpose} onClick={() => void save()}>Continue</button></div>
      </motion.div>
    </>
  );
}

/** A plain yes/no in the app's own style. */
export function ConfirmDialog() {
  const c = useStore((s) => s.confirmAsk)!;
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, { onEscape: () => c.resolve(false) });
  return (
    <>
      <div className="scrim" onMouseDown={() => c.resolve(false)} />
      <motion.div ref={ref} tabIndex={-1} aria-modal="true" role="alertdialog" aria-label={c.title} className="modal" style={{ x: '-50%', y: '-50%' }} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
        <h2>{c.title}</h2><p>{c.body}</p>
        <div className="actions"><button className="btn primary" onClick={() => c.resolve(false)} autoFocus>Go back</button><button className="btn" onClick={() => c.resolve(true)}>{c.ok}</button></div>
      </motion.div>
    </>
  );
}
