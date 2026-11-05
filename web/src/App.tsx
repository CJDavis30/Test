import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from './lib/store';
import { api } from './lib/api';
import { Sidebar, Toolbar, Toasts } from './components/Shell';
import { GraphView } from './components/GraphView';
import { Inspector } from './components/Inspector';
import { Sheet } from './components/Sheet';
import { Shortcuts } from './components/Shortcuts';
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

  // Narrow windows turn the sidebar into a drawer: start it closed, and close it again when you pick something.
  const autoClosed = useRef(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 980px)');
    const f = () => {
      const st = useStore.getState();
      if (m.matches && st.sidebar) { autoClosed.current = true; st.toggle('sidebar', false); }
      else if (!m.matches && autoClosed.current) { autoClosed.current = false; st.toggle('sidebar', true); }
    };
    f(); m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  useEffect(() => {
    if (window.matchMedia('(max-width: 980px)').matches && useStore.getState().sidebar) s.toggle('sidebar', false);
  }, [s.caseId, s.sheet?.subjectId, s.view]);
  useEffect(() => { void s.boot().catch((e) => s.toast(`Can't reach the Plexus engine: ${e.message}`)); }, []);
  useEffect(() => { if (s.theme !== 'auto') document.documentElement.dataset.theme = s.theme; }, []);

  // --- global shortcuts ---------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState(); // always the live state: this handler outlives the render that created it
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape' && window.matchMedia('(max-width: 980px)').matches && st.sidebar && !st.sheet && !st.palette && !st.settingsOpen && !st.shortcuts) { st.toggle('sidebar', false); return; }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); st.toggle('palette'); }
      else if (mod && e.key === ',') { e.preventDefault(); st.openSettings(st.settingsOpen ? null : 'general'); }
      else if (e.key === '?' && !mod && !isTyping(e.target)) { e.preventDefault(); st.setShortcuts(!st.shortcuts); }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); st.toggle('sidebar'); }
      else if (mod && e.key.toLowerCase() === 'i' && !e.altKey) { e.preventDefault(); st.toggle('inspector'); }
      else if (mod && e.key.toLowerCase() === 'z' && !st.sheet && !isTyping(e.target)) { e.preventDefault(); void st.undo(); }
      else if (mod && /^[1-4]$/.test(e.key)) { e.preventDefault(); st.setView((['graph', 'table', 'timeline', 'report'] as const)[Number(e.key) - 1]); }
    };
    // Pasting anywhere (outside a field) opens the palette with what you pasted.
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const t = e.clipboardData?.getData('text');
      if (t && t.trim()) { e.preventDefault(); useStore.getState().openPalette(t.trim().slice(0, 20000)); }
    };
    window.addEventListener('keydown', onKey); window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, []);

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

  // While a dialog is open, the window's drag area (toolbar, sidebar header) must not sit under it: on macOS a drag region swallows clicks on anything above it, including the dialog's close button.
  const overlayOpen = !!(s.sheet || s.shortcuts || s.palette || s.settingsOpen || imported || (s.settings && !s.settings.onboarded));
  useEffect(() => { document.body.classList.toggle('overlay-open', overlayOpen); return () => document.body.classList.remove('overlay-open'); }, [overlayOpen]);

  if (!s.booted) return <div className="app" style={{ display: 'grid', placeItems: 'center' }}><div className="skeleton" style={{ width: 160, height: 14 }} /></div>;

  const showInspector = s.inspector && s.view !== 'report';
  return (
    <>
      <div className={`app ${s.sidebar ? '' : 'no-sidebar'}`}>
        <Sidebar />
        <div className="drawer-scrim" onClick={() => s.toggle('sidebar', false)} aria-hidden />
        <Toolbar />
        <div className="main">
          {s.view === 'graph' && <GraphView key={s.caseId ?? 'none'} />}
          {s.view === 'table' && <TableView />}
          {s.view === 'timeline' && <TimelineView />}
          {s.view === 'report' && <ReportView />}
          <AnimatePresence initial={false}>
            {showInspector && (
              <motion.div key="insp" className="insp-wrap" initial={{ width: 0, opacity: 0 }} animate={{ width: 336, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 40 }} style={{ overflow: 'hidden', flex: 'none', display: 'flex' }}>
                <div style={{ width: 336, flex: 'none', display: 'flex' }}><Inspector /></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>{s.sheet && <Sheet key="sheet" />}</AnimatePresence>
      {s.palette && <Palette />}
      {s.settingsOpen && <Settings />}
      {s.shortcuts && <Shortcuts />}
      {s.settings && !s.settings.onboarded && <Onboarding />}
      {imported && <ImportDialog items={imported} onClose={() => setImported(null)} />}
      {dropping && <div className="dropzone">Drop to extract emails, domains, phones and IPs</div>}
      <Toasts />
    </>
  );
}
