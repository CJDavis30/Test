import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Scale, Info } from 'lucide-react';
import { bitsToProb, oneIn } from '@shared/forensics/linker';
import { fmtOffset } from '@shared/forensics/circadian';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { fmtWhen, pctText, signed, type MatchResponse, type Profile } from '../../lib/forensics';
import { useDialog } from '../ui';

const VERDICT_WORD: Record<string, string> = { same: 'Almost certainly the same operator', likely: 'Likely the same operator', unclear: 'Leans the same, but unproven', unlikely: 'Probably different operators', different: 'Almost certainly different operators' };
const verdictFor = (p: number) => (p >= 0.99 ? 'same' : p >= 0.9 ? 'likely' : p >= 0.5 ? 'unclear' : p >= 0.1 ? 'unlikely' : 'different');
const DEFAULT_N = 50;

/**
 * Are these two accounts run by the same person? The answer as arithmetic you can see: odds before looking, then each piece of evidence
 * as bits (every bit doubles the odds), adding up to a probability. Drag the first number to see how much the answer depends on it.
 */
export function MatchLab() {
  const ml = useStore((s) => s.matchLab)!;
  const caseId = useStore((s) => s.caseId);
  const close = () => useStore.getState().setMatchLab(null);
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, { onEscape: close });
  const [data, setData] = useState<MatchResponse | null>(null);
  const [err, setErr] = useState('');
  const [v, setV] = useState(Math.log10(DEFAULT_N)); // the prior as "1 in 10^v"
  const [swap, setSwap] = useState(0);
  useEffect(() => {
    if (!caseId) return; let live = true; setData(null); setErr('');
    api.get<MatchResponse>(`/api/cases/${caseId}/match?a=${ml.a}&b=${ml.b}`).then((r) => { if (live) setData(r); }).catch((e) => { if (live) setErr(e?.message ?? 'Could not compare these'); });
    return () => { live = false; };
  }, [caseId, ml.a, ml.b, swap]);

  const N = Math.round(10 ** v);
  const m = useMemo(() => {
    if (!data) return null;
    const priorBits = Math.log2(1 / N);
    const total = priorBits + data.match.evidenceBits;
    const p = bitsToProb(total);
    // running position for the waterfall
    let run = priorBits; const rows = [{ key: 'prior', label: 'Before looking at anything', bits: priorBits, from: 0, to: priorBits, detail: `Of accounts like these found in the same case, about 1 in ${N.toLocaleString('en-US')} belong to the same person. Drag the slider to change this.` }];
    for (const s of data.match.signals) { rows.push({ key: s.key, label: s.label, bits: s.bits, from: run, to: run + s.bits, detail: s.detail + (s.assumption ? `\n${s.assumption}` : '') }); run += s.bits; }
    const lo = Math.min(0, ...rows.flatMap((r) => [r.from, r.to])) - 2, hi = Math.max(0, ...rows.flatMap((r) => [r.from, r.to])) + 2;
    const next = p < 0.9 ? { to: 'likely', need: Math.log2(0.9 / 0.1) - total } : p < 0.99 ? { to: 'almost certain', need: Math.log2(0.99 / 0.01) - total } : null;
    return { priorBits, total, p, rows, lo, hi, next };
  }, [data, N]);

  const x = (bits: number) => (m ? ((bits - m.lo) / (m.hi - m.lo)) * 100 : 0);
  const prof = (p: Profile) => (
    <div className="ml-prof">
      <b className="truncate">{p.handle ?? p.label}</b>
      <span>{p.platform ?? 'Account'}</span>
      <span className="num">{p.createdAt ? `Created ${fmtWhen(p.createdAt, p.createdPrecision)}` : 'Creation time unknown'}</span>
      {p.circadian && p.circadian.strength !== 'insufficient' ? <span className="num">Clock leans {fmtOffset(p.circadian.offsets[0].offset)}</span> : null}
    </div>
  );

  return (
    <>
      <div className="scrim" onMouseDown={close} />
      <motion.div ref={ref} tabIndex={-1} aria-modal="true" role="dialog" aria-label="Match Lab" className="modal matchlab" style={{ x: '-50%', y: '-50%' }} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
        <button className="btn icon ghost close-x" aria-label="Close Match Lab" onClick={close}><X size={17} /></button>
        <div className="ml-title"><Scale size={18} /><h2>Match Lab</h2><span className="faint">Same operator, or just a similar name?</span></div>
        {err && <div className="emptystate">{err}</div>}
        {!data && !err && <div className="skeleton" style={{ height: 220, margin: '16px 0' }} />}
        {data && m && (<>
          <div className="ml-pair">{prof(data.a)}<div className="ml-vs">vs</div>{prof(data.b)}</div>

          <div className={`ml-answer ${verdictFor(m.p)}`}>
            <div className="ml-big num">{pctText(m.p)}</div>
            <div><b>{VERDICT_WORD[verdictFor(m.p)]}</b><div className="faint">Odds of {oneIn(Math.abs(m.total)).replace('1 in ', '1 to ')} {m.total >= 0 ? 'in favour' : 'against'} · {signed(m.total)} bits in all</div></div>
          </div>

          <div className="ml-water" role="list" aria-label="The evidence, in bits">
            {m.rows.map((r) => (
              <div className="ml-row" role="listitem" key={r.key} title={r.detail}>
                <span className="ml-lab truncate">{r.label}</span>
                <span className="ml-track"><i className="zero" style={{ left: `${x(0)}%` }} /><i className={`seg ${r.bits >= 0 ? 'pos' : 'neg'}`} style={{ left: `${x(Math.min(r.from, r.to))}%`, width: `${Math.max(0.6, x(Math.max(r.from, r.to)) - x(Math.min(r.from, r.to)))}%` }} /></span>
                <span className={`ml-bits num ${r.bits >= 0 ? 'pos' : 'neg'}`}>{signed(r.bits)}</span>
              </div>
            ))}
            <div className="ml-row total"><span className="ml-lab">Total</span><span className="ml-track"><i className="zero" style={{ left: `${x(0)}%` }} /><i className={`seg ${m.total >= 0 ? 'pos' : 'neg'}`} style={{ left: `${x(Math.min(0, m.total))}%`, width: `${Math.max(0.6, Math.abs(x(m.total) - x(0)))}%` }} /></span><span className={`ml-bits num ${m.total >= 0 ? 'pos' : 'neg'}`}>{signed(m.total)}</span></div>
          </div>
          <p className="ml-note"><Info size={13} /> Each bit doubles the odds. Bits to the right favour “same person”, bits to the left favour “different”. Hover a row for the reasoning.</p>

          <div className="ml-prior">
            <label htmlFor="prior">How common are matches before looking? <b>1 in {N.toLocaleString('en-US')}</b></label>
            <input id="prior" type="range" min={0.3} max={6} step={0.05} value={v} onChange={(e) => setV(Number(e.target.value))} aria-label="Prior odds of a match" />
            <div className="ml-scale"><span>1 in 2</span><span>1 in 1,000,000</span></div>
          </div>

          {m.next && <div className="ml-need"><b>To reach “{m.next.to}” it needs {m.next.need.toFixed(1)} more bits.</b> <span className="faint">For scale: a shared email, phone or wallet is worth about +18, the same custom avatar +18, one profile linking to the other +14.</span></div>}

          <details className="ml-how"><summary>How each number is made</summary>
            {data.match.signals.map((s) => <div key={s.key} className="ml-hrow"><b>{s.label} <span className={`num ${s.bits >= 0 ? 'pos' : 'neg'}`}>{signed(s.bits)}</span></b><p>{s.detail}</p>{s.assumption && <p className="faint">{s.assumption}</p>}</div>)}
            <p className="faint">Signals are treated as independent, except name signals, which move together and are not counted twice. This only sees what is on the two profiles; it cannot tell identical twins from one person, or a shared account from a personal one.</p>
          </details>
          <button className="linkish ml-swap" onClick={() => setSwap((x) => x + 1)}>Re-check</button>
        </>)}
      </motion.div>
    </>
  );
}
