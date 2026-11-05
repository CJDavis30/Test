import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Search, Network, Table2, Clock, FileText, Plus, Settings as Cog, Download, Sun, Moon, Monitor, PanelLeft, PanelRight, Maximize2, Wand2, Sparkles, FlaskConical, CornerDownLeft, Eraser, KeyRound, Cpu,
} from 'lucide-react';
import { detect, detectMany } from '@shared/detect';
import { ENTITY_LABEL, type Detected, type EntityType } from '@shared/types';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { EntityGlyph } from '../lib/icons';
import { Kbd, MOD, download } from './ui';

interface Item {
  id: string; label: string; sub?: string; icon: React.ReactNode; group: string; run: (alt: boolean) => void | Promise<void>; keywords?: string;
}

export function TypeChip({ type, onCycle, alts }: { type: EntityType; onCycle?: () => void; alts?: number }) {
  return (
    <span className={`type-chip ${alts ? 'alt' : ''}`} onClick={onCycle} role={alts ? 'button' : undefined} title={alts ? 'Click to change type (Tab)' : undefined}>
      <EntityGlyph type={type} size={13} /> {ENTITY_LABEL[type]}
      {alts ? <span className="faint">⇥</span> : null}
    </span>
  );
}

export function useDetected(text: string, override: EntityType | null) {
  return useMemo(() => {
    const multi = text.includes('\n') ? detectMany(text) : [];
    const one = detect(text);
    if (override && one) return { one: { ...one, type: override } as Detected, multi: [], cycle: [one.type, ...one.alternatives.map((a) => a.type)] };
    return { one, multi, cycle: one ? [one.type, ...one.alternatives.map((a) => a.type)] : [] };
  }, [text, override]);
}

export function Palette() {
  const s = useStore();
  const [q, setQ] = useState(s.paletteSeed);
  const [active, setActive] = useState(0);
  const [override, setOverride] = useState<EntityType | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const close = () => s.toggle('palette', false);
  const { one, multi, cycle } = useDetected(q, override);

  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { setActive(0); setOverride(null); }, [q]);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = '24px'; el.style.height = `${Math.min(96, el.scrollHeight)}px`; } }, [q]);

  const nodes = s.snap?.nodes ?? [];
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    const t = q.trim();
    if (multi.length > 1) {
      out.push({
        id: 'multi', group: 'Add', label: `Add ${multi.length} entities and look them up`, sub: 'Detected from your pasted text', icon: <Plus size={15} />,
        run: (alt) => s.submit(multi.map((m) => ({ type: m.type, value: m.value })), { run: !alt }),
      });
    } else if (one && t) {
      out.push({
        id: 'lookup', group: 'Investigate', label: one.value, sub: `Look up this ${ENTITY_LABEL[one.type].toLowerCase()}`, icon: <EntityGlyph type={one.type} size={15} />,
        run: (alt) => s.submit([{ type: one.type, value: one.value }], { run: !alt }),
      });
    }
    if (t && multi.length <= 1) {
      const needle = t.toLowerCase();
      for (const n of nodes.filter((n) => n.label.toLowerCase().includes(needle) || n.value.toLowerCase().includes(needle)).slice(0, 6))
        out.push({ id: `n-${n.id}`, group: 'In this case', label: n.label, sub: ENTITY_LABEL[n.type], icon: <EntityGlyph type={n.type} size={15} />, run: () => { s.setView('graph'); s.select([n.id]); void s.openNode(n.id); } });
    }
    const cmds: Item[] = [
      { id: 'v-graph', group: 'Go to', label: 'Graph', icon: <Network size={15} />, run: () => s.setView('graph') },
      { id: 'v-table', group: 'Go to', label: 'Table', icon: <Table2 size={15} />, run: () => s.setView('table') },
      { id: 'v-timeline', group: 'Go to', label: 'Timeline', icon: <Clock size={15} />, run: () => s.setView('timeline') },
      { id: 'v-report', group: 'Go to', label: 'Report', icon: <FileText size={15} />, run: () => s.setView('report') },
      { id: 'new', group: 'Case', label: 'New case', icon: <Plus size={15} />, run: () => void s.newCase() },
      { id: 'export', group: 'Case', label: 'Export case as JSON', sub: 'Includes evidence and audit log', icon: <Download size={15} />, keywords: 'download backup', run: async () => {
        if (!s.caseId) return; const j = await api.get<any>(`/api/cases/${s.caseId}/export`); download(`${s.snap?.case.name ?? 'case'}.plexus.json`, JSON.stringify(j, null, 2), 'application/json');
      } },
      { id: 'tidy', group: 'Graph', label: 'Tidy up the graph layout', sub: 'Forget manual positions and re-organize', icon: <Wand2 size={15} />, keywords: 'layout organize reset', run: () => { s.setView('graph'); setTimeout(() => window.dispatchEvent(new CustomEvent('plexus:tidy')), 80); } },
      { id: 'fit', group: 'Graph', label: 'Fit graph to window', icon: <Maximize2 size={15} />, run: () => { s.setView('graph'); window.dispatchEvent(new CustomEvent('plexus:fit')); } },
      { id: 'ai-links', group: 'Graph', label: 'Suggest links with AI', sub: s.settings?.aiReady.ok ? undefined : 'Turn on AI in Settings first', icon: <Sparkles size={15} />, run: () => { s.setView('graph'); void s.refreshSuggestions(true); s.toast('Looking for connections…'); } },
      { id: 'sidebar', group: 'View', label: 'Toggle sidebar', icon: <PanelLeft size={15} />, run: () => s.toggle('sidebar') },
      { id: 'inspector', group: 'View', label: 'Toggle inspector', icon: <PanelRight size={15} />, run: () => s.toggle('inspector') },
      { id: 'th-l', group: 'Appearance', label: 'Light mode', icon: <Sun size={15} />, run: () => s.setTheme('light') },
      { id: 'th-d', group: 'Appearance', label: 'Dark mode', icon: <Moon size={15} />, run: () => s.setTheme('dark') },
      { id: 'th-a', group: 'Appearance', label: 'Match system appearance', icon: <Monitor size={15} />, run: () => s.setTheme('auto') },
      { id: 's-src', group: 'Settings', label: 'Sources & API keys', icon: <KeyRound size={15} />, run: () => s.openSettings('sources') },
      { id: 's-ai', group: 'Settings', label: 'AI model', icon: <Cpu size={15} />, run: () => s.openSettings('ai') },
      { id: 's-gen', group: 'Settings', label: 'Settings', icon: <Cog size={15} />, run: () => s.openSettings('general') },
      { id: 'demo', group: 'Settings', label: s.settings?.demoMode ? 'Switch to live sources' : 'Switch to demo data', sub: 'Demo uses fictional people — nothing leaves your Mac', icon: <FlaskConical size={15} />, keywords: 'sample', run: async () => {
        await api.put('/api/settings', { demoMode: !s.settings?.demoMode }); await Promise.all([s.refreshSettings(), s.refreshSources()]); s.toast(s.settings?.demoMode ? 'Using live sources' : 'Using demo data');
      } },
      { id: 'cache', group: 'Settings', label: 'Clear lookup cache', icon: <Eraser size={15} />, run: async () => { await api.post('/api/cache/clear'); s.toast('Cache cleared'); } },
    ];
    const needle = q.trim().toLowerCase();
    const filtered = needle && multi.length <= 1
      ? cmds.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(needle))
      : multi.length > 1 ? [] : cmds.slice(0, 9);
    return [...out, ...filtered];
  }, [q, one, multi, nodes, s]);

  const run = async (it: Item, alt = false) => { close(); await it.run(alt); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Tab' && one && cycle.length > 1) {
      e.preventDefault();
      const cur = override ?? one.type; const i = cycle.indexOf(cur);
      setOverride(cycle[(i + 1) % cycle.length]);
    } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (items[active]) void run(items[active], e.altKey); }
    else if (e.key === 'Escape') close();
  };

  // group headers
  let last = '';
  return (
    <>
      <div className="scrim" onMouseDown={close} />
      <motion.div className="palette" role="dialog" aria-label="Search or add" style={{ x: '-50%' }} initial={{ opacity: 0, y: -8, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 560, damping: 38 }}>
        <div className="input">
          <Search size={18} strokeWidth={1.8} className="faint" />
          <textarea ref={ref} rows={1} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Paste an email, username, domain, name, phone, IP…" spellCheck={false} autoCorrect="off" autoCapitalize="off" aria-label="Search or add" />
          {one && q.trim() && multi.length <= 1 && <TypeChip type={one.type} alts={cycle.length > 1 ? cycle.length : 0} onCycle={() => { const cur = override ?? one.type; setOverride(cycle[(cycle.indexOf(cur) + 1) % cycle.length]); }} />}
        </div>
        <div className="list" role="listbox">
          {multi.length > 1 && (
            <div className="multi-preview">
              {multi.slice(0, 12).map((m, i) => <div key={i}><EntityGlyph type={m.type} size={14} /> <span className="truncate">{m.value}</span> <span className="faint" style={{ marginLeft: 'auto' }}>{ENTITY_LABEL[m.type]}</span></div>)}
              {multi.length > 12 && <div className="faint">+ {multi.length - 12} more</div>}
            </div>
          )}
          {items.map((it, i) => {
            const header = it.group !== last ? it.group : null; last = it.group;
            return (
              <div key={it.id}>
                {header && <div className="group">{header}</div>}
                <button className="pitem" role="option" aria-selected={i === active} data-active={i === active} onMouseMove={() => setActive(i)} onClick={(e) => void run(it, e.altKey)}>
                  <span className="gl">{it.icon}</span>
                  <span className="grow"><span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{it.label}</span>{it.sub && <span className="muted truncate" style={{ display: 'block', fontSize: 12 }}>{it.sub}</span>}</span>
                  {i === active && <CornerDownLeft size={14} style={{ opacity: .8 }} />}
                </button>
              </div>
            );
          })}
          {!items.length && <div className="empty-note">Nothing matches.</div>}
        </div>
        <div className="hint">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span><Kbd>↵</Kbd> run</span>
          <span><Kbd>⌥↵</Kbd> add without running</span>
          {one && cycle.length > 1 && <span><Kbd>⇥</Kbd> change type</span>}
          <span style={{ marginLeft: 'auto' }}><Kbd>esc</Kbd></span>
        </div>
      </motion.div>
    </>
  );
}
