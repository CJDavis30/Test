import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from './lib/store';
import { api } from './lib/api';
import { Sidebar, Toolbar, Toasts } from './components/Shell';
import { GraphView } from './components/GraphView';
import { Inspector } from './components/Inspector';
import { Sheet } from './components/Sheet';
import { Palette } from './components/Palette';
import { Settings } from './components/Settings';
import { Onboarding, ImportDialog } from './components/Welcome';
import { TableView, TimelineView, ReportView } from './views/Views';
import { isTyping } from './components/ui';
import { detectMany } from '@shared/detect';
import type { Detected } from '@shared/types';

export function App() {
  const s = useStore();
  const [dropping, setDropping] = useState(false);
  const [imported, setImported] = useState<Detected[] | null>(null);

  useEffect(() => { void s.boot().catch((e) => s.toast(`Can't reach the Plexus engine: ${e.message}`)); }, []);
  useEffect(() => { if (s.theme !== 'auto') document.documentElement.dataset.theme = s.theme; }, []);

  // --- global shortcuts ---------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); s.toggle('palette'); }
      else if (mod && e.key === ',') { e.preventDefault(); s.openSettings(s.settingsOpen ? null : 'general'); }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); s.toggle('sidebar'); }
      else if (mod && e.key.toLowerCase() === 'i' && !e.altKey) { e.preventDefault(); s.toggle('inspector'); }
      else if (mod && e.key.toLowerCase() === 'z' && !s.sheet && !isTyping(e.target)) { e.preventDefault(); void s.undo(); }
      else if (mod && /^[1-4]$/.test(e.key)) { e.preventDefault(); s.setView((['graph', 'table', 'timeline', 'report'] as const)[Number(e.key) - 1]); }
    };
    // Pasting anywhere (outside a field) opens the palette with what you pasted.
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const t = e.clipboardData?.getData('text');
      if (t && t.trim()) { e.preventDefault(); s.openPalette(t.trim().slice(0, 20000)); }
    };
    window.addEventListener('keydown', onKey); window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, [s.sheet, s.settingsOpen]);

  // --- drop a file to extract entities --------------------------------------------------------------------------------
  useEffect(() => {
    let depth = 0;
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); } };
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth++; setDropping(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDropping(false); };
    const drop = async (e: DragEvent) => {
      e.preventDefault(); depth = 0; setDropping(false);
      const f = e.dataTransfer?.files?.[0]; if (!f) return;
      if (f.size > 4_000_000) { s.toast('That file is too large (4 MB max)'); return; }
      const text = await f.text();
      const r = await api.post<{ items: Detected[] }>('/api/extract', { text });
      if (!r.items.length) { const lines = detectMany(text); if (lines.length) return setImported(lines); s.toast('No emails, domains, phones or IPs found in that file'); return; }
      setImported(r.items);
    };
    window.addEventListener('dragover', over); window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);

  if (!s.booted) return <div className="app" style={{ display: 'grid', placeItems: 'center' }}><div className="skeleton" style={{ width: 160, height: 14 }} /></div>;

  const showInspector = s.inspector && s.view !== 'report';
  return (
    <>
      <div className={`app ${s.sidebar ? '' : 'no-sidebar'}`}>
        <Sidebar />
        <Toolbar />
        <div className="main">
          {s.view === 'graph' && <GraphView key={s.caseId ?? 'none'} />}
          {s.view === 'table' && <TableView />}
          {s.view === 'timeline' && <TimelineView />}
          {s.view === 'report' && <ReportView />}
          <AnimatePresence initial={false}>
            {showInspector && (
              <motion.div key="insp" initial={{ width: 0, opacity: 0 }} animate={{ width: 336, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 40 }} style={{ overflow: 'hidden', flex: 'none', display: 'flex' }}>
                <div style={{ width: 336, flex: 'none', display: 'flex' }}><Inspector /></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>{s.sheet && <Sheet key="sheet" />}</AnimatePresence>
      {s.palette && <Palette />}
      {s.settingsOpen && <Settings />}
      {s.settings && !s.settings.onboarded && <Onboarding />}
      {imported && <ImportDialog items={imported} onClose={() => setImported(null)} />}
      {dropping && <div className="dropzone">Drop to extract emails, domains, phones and IPs</div>}
      <Toasts />
    </>
  );
}
