import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Network, Table2, Clock, FileText, Plus, Search, Settings as Cog, PanelLeft, PanelRight, Sun, Moon, Monitor, Ellipsis, FlaskConical,
  LoaderCircle, Inbox, Check, Pencil, Trash2, ChevronDown,
} from 'lucide-react';
import { useStore, type View } from '../lib/store';
import { Popover, Kbd, MOD } from './ui';
import { plural } from '../lib/format';

const VIEWS: { id: View; label: string; icon: typeof Network }[] = [
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'timeline', label: 'Timeline', icon: Clock },
  { id: 'report', label: 'Report', icon: FileText },
];

export function Sidebar() {
  const { view, setView, cases, caseId, loadCase, newCase, deleteCase, renameCase, settings, openSettings } = useStore();
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12 8 4l4 8H4Z" /><circle cx="8" cy="4" r="1.3" fill="currentColor" /><circle cx="4" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /></svg>
        </div>
        <span className="brand-name">Plexus</span>
      </div>
      <div className="scroll">
        <div className="side-label" style={{ paddingTop: 4 }}>View</div>
        {VIEWS.map((v) => (
          <button key={v.id} className="side-item" aria-current={view === v.id} onClick={() => setView(v.id)}>
            <v.icon size={16} strokeWidth={1.75} /> {v.label}
          </button>
        ))}
        <div className="side-label">
          Cases
          <button className="btn icon sm ghost" aria-label="New case" onClick={() => void newCase()}><Plus size={14} /></button>
        </div>
        {cases.length === 0 && <div className="faint" style={{ padding: '6px 8px', fontSize: 12.5 }}>Your first case is created when you add something.</div>}
        {cases.map((c) => (
          <div key={c.id} style={{ position: 'relative' }}>
            {editing === c.id ? (
              <input autoFocus className="field" defaultValue={c.name} style={{ height: 30 }}
                onBlur={(e) => { void renameCase(c.id, { name: e.target.value.trim() || c.name }); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
            ) : (
              <button className="side-item" aria-current={c.id === caseId} onClick={() => void loadCase(c.id)} onContextMenu={(e) => { e.preventDefault(); setMenu(c.id); }}>
                <Inbox size={16} strokeWidth={1.75} />
                <span className="truncate">{c.name}</span>
                <span className="more" role="button" aria-label="Case options" onClick={(e) => { e.stopPropagation(); setMenu(menu === c.id ? null : c.id); }}><Ellipsis size={14} /></span>
              </button>
            )}
            {menu === c.id && (
              <Popover onClose={() => setMenu(null)} style={{ position: 'absolute', right: 4, top: 30, zIndex: 20 }}>
                <button className="item" onClick={() => { setEditing(c.id); setMenu(null); }}><Pencil size={14} /> Rename</button>
                <div className="sep" />
                <button className="item danger" onClick={() => { setMenu(null); if (confirm(`Delete “${c.name}” and everything in it?`)) void deleteCase(c.id); }}><Trash2 size={14} /> Delete…</button>
              </Popover>
            )}
          </div>
        ))}
      </div>
      <div className="foot">
        {settings?.demoMode && <button className="demo-chip" onClick={() => openSettings('general')}><FlaskConical size={14} /> Demo data · fictional</button>}
        <button className="side-item" onClick={() => openSettings('general')}><Cog size={16} strokeWidth={1.75} /> Settings <Kbd>{MOD},</Kbd></button>
      </div>
    </aside>
  );
}

export function Toolbar() {
  const s = useStore();
  const { snap, toggle, inspector, theme, setTheme, openSettings, runs, findings } = s;
  const [themeMenu, setThemeMenu] = useState(false);
  const [caseMenu, setCaseMenu] = useState(false);
  const caseName = snap?.case.name ?? 'Plexus';

  const { running, runningCount, pendingBySubject, total } = useMemo(() => {
    const running = Object.entries(runs).filter(([, r]) => r.status === 'running');
    const by = new Map<string, number>();
    let total = 0;
    for (const f of Object.values(findings)) if (f.status === 'pending' || f.status === 'unsure') { by.set(f.subjectId, (by.get(f.subjectId) ?? 0) + 1); total++; }
    return { running, runningCount: running.length, pendingBySubject: by, total };
  }, [runs, findings]);

  const openReview = () => {
    const first = running[0]?.[0] ?? [...pendingBySubject.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (first) s.openSheet(first);
  };
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <header className="toolbar">
      <button className="btn icon ghost" aria-label="Toggle sidebar" onClick={() => toggle('sidebar')}><PanelLeft size={17} strokeWidth={1.75} /></button>
      <div style={{ position: 'relative' }}>
        <button className="title" onClick={() => setCaseMenu(!caseMenu)} disabled={!snap}>
          <span className="truncate">{caseName}</span>{snap && <ChevronDown size={13} className="faint" />}
        </button>
        {caseMenu && snap && <CaseEditor onClose={() => setCaseMenu(false)} />}
      </div>
      <div className="spacer" />
      <button className="cmdk" onClick={() => toggle('palette', true)} aria-label="Search or add">
        <Search size={15} strokeWidth={1.9} />
        <span>Search or add anything</span>
        <Kbd>{MOD}K</Kbd>
      </button>
      <div className="spacer" />
      <AnimatePresence initial={false}>
        {(runningCount > 0 || total > 0) && (
          <motion.button key="pill" initial={{ opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .92 }} transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            className={`pill ${runningCount === 0 ? 'accent' : ''}`} onClick={openReview}>
            {runningCount > 0 ? <><LoaderCircle size={14} className="spin" /> Searching…</> : <><span className="dot" /> {total} to review</>}
          </motion.button>
        )}
      </AnimatePresence>
      <div style={{ position: 'relative' }}>
        <button className="btn icon ghost" aria-label="Appearance" onClick={() => setThemeMenu(!themeMenu)}><ThemeIcon size={16} strokeWidth={1.75} /></button>
        {themeMenu && (
          <Popover onClose={() => setThemeMenu(false)} style={{ position: 'absolute', right: 0, top: 36, zIndex: 30, minWidth: 160 }}>
            {(['auto', 'light', 'dark'] as const).map((t) => (
              <button key={t} className="item" onClick={() => { setTheme(t); setThemeMenu(false); }}>
                {t === 'auto' ? <Monitor size={14} /> : t === 'light' ? <Sun size={14} /> : <Moon size={14} />}
                {t === 'auto' ? 'Match system' : t[0].toUpperCase() + t.slice(1)}
                {theme === t && <Check size={14} style={{ marginLeft: 'auto' }} />}
              </button>
            ))}
          </Popover>
        )}
      </div>
      <button className="btn icon ghost" aria-label="Settings" onClick={() => openSettings('general')}><Cog size={16} strokeWidth={1.75} /></button>
      <button className="btn icon ghost" aria-label="Toggle inspector" aria-pressed={inspector} onClick={() => toggle('inspector')} style={inspector ? { background: 'var(--pressed)' } : undefined}><PanelRight size={17} strokeWidth={1.75} /></button>
    </header>
  );
}

function CaseEditor({ onClose }: { onClose: () => void }) {
  const { snap, renameCase } = useStore();
  const c = snap!.case;
  const name = useRef<HTMLInputElement>(null);
  const purpose = useRef<HTMLTextAreaElement>(null);
  const save = () => void renameCase(c.id, { name: name.current?.value.trim() || c.name, purpose: purpose.current?.value.trim() ?? '' });
  return (
    <Popover onClose={() => { save(); onClose(); }} style={{ position: 'absolute', left: 0, top: 36, zIndex: 30, width: 320, padding: 14 }}>
      <label className="faint" style={{ fontSize: 12 }}>Case name</label>
      <input ref={name} className="field" defaultValue={c.name} style={{ margin: '4px 0 12px' }} onKeyDown={(e) => e.key === 'Enter' && (save(), onClose())} />
      <label className="faint" style={{ fontSize: 12 }}>Purpose <span style={{ color: 'var(--text-3)' }}>· appears in reports and the audit log</span></label>
      <textarea ref={purpose} className="field" rows={3} defaultValue={c.purpose} placeholder="e.g. Verify vendor identity before onboarding" style={{ marginTop: 4 }} />
      <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>Created {new Date(c.createdAt).toLocaleDateString()} · {plural(snap!.nodes.length, 'entity', 'entities')}</div>
    </Popover>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className="toast" layout initial={{ opacity: 0, y: 16, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .96 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }}>
            <span>{t.text}</span>
            {t.action && <button className="btn sm" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
