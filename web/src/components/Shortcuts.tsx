import { useRef } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { useStore } from '../lib/store';
import { Kbd, MOD, useDialog } from './ui';

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  { title: 'Anywhere', rows: [[[`${MOD}K`], 'Search, add or run a command'], [[`${MOD},`], 'Settings'], [[`${MOD}B`], 'Show or hide the sidebar'], [[`${MOD}I`], 'Show or hide the inspector'], [[`${MOD}1`, '–', '4'], 'Graph, Table, Timeline, Report'], [[`${MOD}Z`], 'Undo'], [['?'], 'This list']] },
  { title: 'Reviewing findings', rows: [[['↑', '↓'], 'Move through the list'], [['A'], 'Accept'], [['R'], 'Reject'], [['U'], 'Not sure, decide later'], [['↵'], 'Open details (narrow windows)'], [['T'], 'One finding at a time'], [[`${MOD}↵`], 'Add accepted findings to the graph'], [['Esc'], 'Back, then close']] },
  { title: 'Graph', rows: [[['Click'], 'Select'], [['Shift', 'Click'], 'Add to selection'], [['Drag'], 'Move and pin a node'], [['↵'], 'Open findings'], [['R'], 'Run checks again'], [['F'], 'Focus on the selection'], [['P'], 'Trace the strongest path between two'], [['L'], 'Link two nodes'], [['M'], 'Merge two nodes'], [['⌫'], 'Remove (undoable)'], [['0'], 'Fit to window']] },
];

/** Every shortcut in one place. Open with ? */
export function Shortcuts() {
  const close = () => useStore.getState().setShortcuts(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, { onEscape: close });
  return (
    <>
      <div className="scrim" onMouseDown={close} />
      <motion.div ref={ref} tabIndex={-1} aria-modal="true" role="dialog" aria-label="Keyboard shortcuts" className="modal shortcuts" style={{ x: '-50%', y: '-50%' }}
        initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
        <button className="btn icon ghost close-x" aria-label="Close shortcuts" onClick={close}><X size={17} /></button>
        <h2>Keyboard shortcuts</h2>
        <div className="sc-grid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              {g.rows.map(([keys, what]) => <div className="sc-row" key={what}><span>{what}</span><span className="sc-keys">{keys.map((k, i) => (k === '–' ? <span key={i}>–</span> : <Kbd key={i}>{k}</Kbd>))}</span></div>)}
            </section>
          ))}
        </div>
      </motion.div>
    </>
  );
}
