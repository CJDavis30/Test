import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, FileSearch, KeyRound, Upload } from 'lucide-react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { startAutopilot } from '../lib/autopilot';
import { useDetected, TypeChip } from './Palette';
import { Check, Kbd, MOD, useDialog } from './ui';
import { ENTITY_LABEL, type Detected, type EntityType } from '@shared/types';
import { EntityGlyph } from '../lib/icons';

export function Welcome() {
  const s = useStore();
  const [v, setV] = useState('');
  const [override, setOverride] = useState<EntityType | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const { one, cycle } = useDetected(v, override);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => setOverride(null), [v]);
  const go = () => { if (one) { void s.submit([{ type: one.type, value: one.value }]); setV(''); } };
  return (
    <div className="welcome">
      <motion.div className="welcome-inner" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
        <h1>Start with anything you know.</h1>
        <p>An email, a username, a domain, a name, a number. Plexus finds what connects to it and shows you how sure it is.</p>
        <div className="hero-input">
          <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} placeholder="jane@example.com" spellCheck={false} aria-label="Start an investigation"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.shiftKey && one) { void startAutopilot({ type: one.type, value: one.value }); setV(''); }
              else if (e.key === 'Enter') go();
              if (e.key === 'Tab' && one && cycle.length > 1) { e.preventDefault(); setOverride(cycle[(cycle.indexOf(override ?? one.type) + 1) % cycle.length]); }
            }}
            onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t.trim().includes('\n')) { e.preventDefault(); s.openPalette(t); } }} />
          {one && v.trim() && <TypeChip type={one.type} alts={cycle.length > 1 ? cycle.length : 0} onCycle={() => setOverride(cycle[(cycle.indexOf(override ?? one.type) + 1) % cycle.length])} />}
          <button className="btn primary icon" style={{ width: 38, height: 38, borderRadius: 11 }} onClick={go} disabled={!one} aria-label="Look up"><ArrowRight size={18} /></button>
        </div>
        {one && v.trim() && <div className="hero-hint"><b>↵</b> look it up · <b>⇧↵</b> Autopilot: follow the strongest leads on its own and build the graph while you watch</div>}
        <div className="welcome-links">
          <span>Drop a file to extract entities</span>
          <span>·</span>
          <span>Paste a list, one per line, in <Kbd>{MOD}K</Kbd></span>
          <span>·</span><button onClick={() => s.openFileLab()}><FileSearch size={13} /> Analyze a photo or file</button><span>·</span><button onClick={() => s.openSettings('sources')}><KeyRound size={13} /> Sources &amp; API keys</button>
        </div>
      </motion.div>
    </div>
  );
}

export function Onboarding() {
  const s = useStore();
  const boxRef = useRef<HTMLDivElement>(null);
  useDialog(boxRef);
  const keyed = s.sources.filter((x) => x.requiresKey && !x.keyOptional);
  const better = s.sources.filter((x) => x.requiresKey && x.keyOptional);
  const ready = s.sources.filter((x) => x.enabled && !(x.requiresKey && !x.keyOptional && !x.keySet)).length;
  const finish = async (setup: boolean) => {
    await api.put('/api/settings', { onboarded: true });
    await Promise.all([s.refreshSettings(), s.refreshSources()]);
    if (setup) s.openSettings('sources');
  };
  return (
    <>
      <div className="scrim" />
      <motion.div ref={boxRef} tabIndex={-1} aria-modal="true" className="modal" role="dialog" aria-label="Welcome" style={{ x: '-50%' }} initial={{ opacity: 0, scale: .97, y: '-48%' }} animate={{ opacity: 1, scale: 1, y: '-50%' }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
        <img src="/icon.png" width={64} height={64} alt="" draggable={false} style={{ display: 'block', margin: '-6px 0 10px -4px' }} />
        <h2>Welcome to Plexus</h2>
        <p>Enter one fact and Plexus gathers what's publicly connected to it, scores how likely each finding is to be true, and lets you confirm the ones that matter. Everything stays on this Mac.</p>
        <p style={{ fontSize: 12.5, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
          Use Plexus for lawful, authorized work: security research, journalism, fraud and due-diligence checks. Findings are leads, not proof, and a matching name can describe a different person. Every lookup is written to a per-case audit log.
        </p>
        <p style={{ fontSize: 12.5 }}>
          {ready} of {s.sources.length} sources work right now without any setup. {keyed.length > 0 ? `API keys unlock ${keyed.length} more${better.length ? ` and lift rate limits on ${better.length} others` : ''}. Add them in Settings whenever you like; Plexus uses them automatically.` : ''}
        </p>
        <div className="actions">
          <button className="btn lg" onClick={() => void finish(false)}>Start investigating</button>
          <button className="btn primary lg" onClick={() => void finish(true)}><KeyRound size={15} /> Add API keys</button>
        </div>
      </motion.div>
    </>
  );
}

export function ImportDialog({ items, onClose }: { items: Detected[]; onClose: () => void }) {
  const s = useStore();
  const [sel, setSel] = useState(() => new Set(items.map((_, i) => i)));
  const boxRef = useRef<HTMLDivElement>(null);
  useDialog(boxRef, { onEscape: onClose });
  return (
    <>
      <div className="scrim" onMouseDown={onClose} />
      <div ref={boxRef} tabIndex={-1} aria-modal="true" className="modal" role="dialog" aria-label="Import entities" style={{ transform: 'translate(-50%, -50%)' }}>
        <h2>Found {items.length} {items.length === 1 ? 'entity' : 'entities'}</h2>
        <p>Choose what to add to this case.</p>
        <div style={{ maxHeight: 320, overflow: 'auto', margin: '0 -6px' }}>
          {items.map((d, i) => (
            <button key={i} className="checkrow" style={{ width: '100%', textAlign: 'left' }} onClick={() => { const n = new Set(sel); n.has(i) ? n.delete(i) : n.add(i); setSel(n); }}>
              <Check on={sel.has(i)} /><EntityGlyph type={d.type} size={14} /><span className="truncate grow">{d.value}</span><span className="faint">{ENTITY_LABEL[d.type]}</span>
            </button>
          ))}
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn outline" disabled={!sel.size} onClick={() => { void s.submit(items.filter((_, i) => sel.has(i)), { run: false }); onClose(); }}>Add only</button>
          <button className="btn primary" disabled={!sel.size} onClick={() => { void s.submit(items.filter((_, i) => sel.has(i)).slice(0, 25).map((d) => ({ type: d.type, value: d.value }))); onClose(); }}><Upload size={14} /> Add &amp; look up</button>
        </div>
      </div>
    </>
  );
}
