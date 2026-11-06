import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Wrench, Search, Network, Table2, Clock, FileText, Plus, Settings as Cog, Download, Sun, Moon, Monitor, PanelLeft, PanelRight, Maximize2, Wand2, Sparkles, CornerDownLeft, Eraser, KeyRound, Cpu, Upload, Keyboard, Users, ScanSearch, FileSearch, Scale, Rocket, ShieldCheck,
} from 'lucide-react';
import { detect, detectMany } from '@shared/detect';
import { ENTITY_LABEL, type Detected, type EntityType } from '@shared/types';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { pickAndImport } from '../lib/portable';
import { startAutopilot } from '../lib/autopilot';
import { EntityGlyph } from '../lib/icons';
import { Kbd, MOD, download, useDialog } from './ui';
import { TOOLS } from '../tools/registry';
import { RoleSummary, emptyDraft, roleOfDraft, type RoleDraft } from './RolePicker';

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
  const boxRef = useRef<HTMLDivElement>(null);
  useDialog(boxRef, { focus: false });
  const { one, multi, cycle } = useDetected(q, override);
  const [draft, setDraft] = useState<RoleDraft>(emptyDraft());
  const role = one?.type === 'username' && multi.length <= 1 ? roleOfDraft(draft) : undefined;

  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { setActive(0); setOverride(null); }, [q]);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = '24px'; el.style.height = `${Math.min(96, el.scrollHeight)}px`; } }, [q]);

  const nodes = s.snap?.nodes ?? [];
  // Look in the other cases too, so "have I seen this before?" is one keystroke away.
  const [elsewhere, setElsewhere] = useState<{ caseId: string; caseName: string; nodeId: string; type: EntityType; label: string }[]>([]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || t.includes('\n')) { setElsewhere([]); return; }
    let live = true;
    const h = setTimeout(() => { api.get<{ hits: typeof elsewhere }>(`/api/search?q=${encodeURIComponent(t)}`).then((r) => { if (live) setElsewhere(r.hits.filter((x) => x.caseId !== s.caseId).slice(0, 5)); }).catch(() => {}); }, 160);
    return () => { live = false; clearTimeout(h); };
  }, [q, s.caseId]);
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
        run: (alt) => s.submit([{ type: one.type, value: one.value, role }], { run: !alt }),
      });
      out.push({
        id: 'autopilot', group: 'Investigate', label: `Autopilot: ${one.value}`, sub: 'Follow the strongest leads on its own and build the graph live', icon: <Rocket size={15} />, keywords: 'auto build everything',
        run: () => { void startAutopilot({ type: one.type, value: one.value, role }); },
      });
      out.push({
        id: 'autopilot-dry', group: 'Investigate', label: `Autopilot dry run: ${one.value}`, sub: 'See what it would accept, without changing anything', icon: <Rocket size={15} />, keywords: 'preview simulate',
        run: () => { void startAutopilot({ type: one.type, value: one.value, dryRun: true, role }); },
      });
    }
    if (t && multi.length <= 1) {
      const needle = t.toLowerCase();
      for (const n of nodes.filter((n) => n.label.toLowerCase().includes(needle) || n.value.toLowerCase().includes(needle)).slice(0, 6))
        out.push({ id: `n-${n.id}`, group: 'In this case', label: n.label, sub: ENTITY_LABEL[n.type], icon: <EntityGlyph type={n.type} size={15} />, run: () => { s.setView('graph'); s.select([n.id]); void s.openNode(n.id); } });
    }
    for (const h of elsewhere) out.push({ id: `x-${h.nodeId}`, group: 'In other cases', label: h.label, sub: `${ENTITY_LABEL[h.type]} · in “${h.caseName}”`, icon: <EntityGlyph type={h.type} size={15} />, run: async () => { await s.loadCase(h.caseId); s.setView('graph'); s.select([h.nodeId]); window.dispatchEvent(new CustomEvent('plexus:pan', { detail: h.nodeId })); } });
    const cmds: Item[] = [
      { id: 'v-graph', group: 'Go to', label: 'Graph', icon: <Network size={15} />, run: () => s.setView('graph') },
      { id: 'v-table', group: 'Go to', label: 'Table', icon: <Table2 size={15} />, run: () => s.setView('table') },
      { id: 'v-timeline', group: 'Go to', label: 'Timeline', icon: <Clock size={15} />, run: () => s.setView('timeline') },
      { id: 'v-identities', group: 'Go to', label: 'Identities', sub: 'Who is who in this case', icon: <Users size={15} />, run: () => s.setView('identities') },
      { id: 'v-report', group: 'Go to', label: 'Report', icon: <FileText size={15} />, run: () => s.setView('report') },
      { id: 'v-tools', group: 'Go to', label: 'Tools', sub: `${TOOLS.length} tools: photos, places, times, names, links`, icon: <Wrench size={15} />, run: () => { s.setTool(null); s.setView('tools'); } },
      ...TOOLS.map((t): Item => ({ id: `tool-${t.id}`, group: 'Tools', label: t.name, sub: t.blurb.length > 70 ? t.blurb.slice(0, 68) + '…' : t.blurb, icon: t.icon, keywords: t.keywords, run: () => (t.open ? t.open() : s.openTool(t.id)) })),
      { id: 'new', group: 'Case', label: 'New case', icon: <Plus size={15} />, run: () => void s.newCase() },
      { id: 'export', group: 'Case', label: 'Export case as JSON', sub: 'Includes evidence and audit log', icon: <Download size={15} />, keywords: 'download backup', run: async () => {
        if (!s.caseId) return; const j = await api.get<any>(`/api/cases/${s.caseId}/export`); download(`${s.snap?.case.name ?? 'case'}.plexus.json`, JSON.stringify(j, null, 2), 'application/json');
      } },
      { id: 'export-html', group: 'Case', label: 'Save printable report (HTML, PDF-ready)', sub: 'Open it and choose Print → Save as PDF', icon: <FileText size={15} />, keywords: 'pdf print report', run: async () => {
        if (!s.caseId) return; const t = await (await fetch(`/api/cases/${s.caseId}/report.html`)).text(); download(`${s.snap?.case.name ?? 'case'}.report.html`, t, 'text/html');
      } },
      { id: 'export-package', group: 'Case', label: 'Save signed evidence package (HTML)', sub: 'One file that proves it has not been changed, checked in the reader\'s own browser', icon: <ShieldCheck size={15} />, keywords: 'sign verify proof court share tamper', run: async () => {
        if (!s.caseId) return; const t = await (await fetch(`/api/cases/${s.caseId}/package`)).text(); download(`${s.snap?.case.name ?? 'case'}.evidence.html`, t, 'text/html');
      } },
      { id: 'export-graphml', group: 'Case', label: 'Export graph as GraphML', sub: 'Opens in Gephi, yEd and Cytoscape', icon: <Download size={15} />, keywords: 'gephi network', run: async () => {
        if (!s.caseId) return; const t = await (await fetch(`/api/cases/${s.caseId}/graphml`)).text(); download(`${s.snap?.case.name ?? 'case'}.graphml`, t, 'application/graphml+xml');
      } },
      { id: 'export-csv', group: 'Case', label: 'Export entities and relationships as CSV', sub: 'Two files, spreadsheet-safe', icon: <Download size={15} />, keywords: 'spreadsheet excel', run: async () => {
        if (!s.caseId) return; const c = await api.get<{ entities: string; relationships: string }>(`/api/cases/${s.caseId}/csv`); const n = s.snap?.case.name ?? 'case';
        download(`${n}.entities.csv`, c.entities, 'text/csv'); setTimeout(() => download(`${n}.relationships.csv`, c.relationships, 'text/csv'), 250);
      } },
      { id: 'import-case', group: 'Case', label: 'Import a case from a Plexus export…', sub: 'Creates a new case; nothing is overwritten', icon: <Upload size={15} />, keywords: 'open restore load json', run: () => pickAndImport(s) },
      { id: 'tidy', group: 'Graph', label: 'Tidy up the graph layout', sub: 'Forget manual positions and re-organize', icon: <Wand2 size={15} />, keywords: 'layout organize reset', run: () => { s.setView('graph'); setTimeout(() => window.dispatchEvent(new CustomEvent('plexus:tidy')), 80); } },
      { id: 'fit', group: 'Graph', label: 'Fit graph to window', icon: <Maximize2 size={15} />, run: () => { s.setView('graph'); window.dispatchEvent(new CustomEvent('plexus:fit')); } },
      { id: 'ai-links', group: 'Graph', label: 'Suggest links with AI', sub: s.settings?.aiReady.ok ? undefined : 'Turn on AI in Settings first', icon: <Sparkles size={15} />, run: () => { s.setView('graph'); void s.refreshSuggestions(true); s.toast('Looking for connections…'); } },
      { id: 'sidebar', group: 'View', label: 'Toggle sidebar', icon: <PanelLeft size={15} />, run: () => s.toggle('sidebar') },
      { id: 'inspector', group: 'View', label: 'Toggle inspector', icon: <PanelRight size={15} />, run: () => s.toggle('inspector') },
      { id: 'th-l', group: 'Appearance', label: 'Light mode', icon: <Sun size={15} />, run: () => s.setTheme('light') },
      { id: 'th-d', group: 'Appearance', label: 'Dark mode', icon: <Moon size={15} />, run: () => s.setTheme('dark') },
      { id: 'th-a', group: 'Appearance', label: 'Match system appearance', icon: <Monitor size={15} />, run: () => s.setTheme('auto') },
      { id: 'known', group: 'Investigate', label: 'Add things I already know…', sub: 'An email, a username, a phone: Plexus checks everything against all of them', icon: <ShieldCheck size={15} />, keywords: 'known facts anchor confirmed sure belongs same person cross check', run: () => s.setKnownDialog(true) },
      { id: 'filelab', group: 'Forensics', label: 'Analyze a photo, video or file…', sub: 'Location, time, device, edits and hidden text inside it', icon: <FileSearch size={15} />, keywords: 'exif metadata photo image video pdf docx gps location camera hidden geolocate picture', run: () => s.openFileLab() },
      { id: 'decode', group: 'Forensics', label: 'Decode IDs, links and timestamps…', sub: 'Paste a chat log or a pile of links', icon: <ScanSearch size={15} />, keywords: 'discord roblox snowflake timezone activity paste forensics', run: () => s.setDecode(true) },
      ...(s.selection.length === 2 && s.selection.every((id) => ['account', 'username'].includes(nodes.find((n) => n.id === id)?.type ?? '')) ? [{ id: 'compare', group: 'Forensics', label: 'Compare the two selected accounts', sub: 'Match Lab: same operator?', icon: <Scale size={15} />, run: () => s.setMatchLab({ a: s.selection[0], b: s.selection[1] }) } as Item] : []),
      { id: 'keys', group: 'Help', label: 'Keyboard shortcuts', sub: 'Press ? anywhere', icon: <Keyboard size={15} />, keywords: 'help hotkeys', run: () => s.setShortcuts(true) },
      { id: 's-src', group: 'Settings', label: 'Sources & API keys', icon: <KeyRound size={15} />, run: () => s.openSettings('sources') },
      { id: 's-ai', group: 'Settings', label: 'AI model', icon: <Cpu size={15} />, run: () => s.openSettings('ai') },
      { id: 's-gen', group: 'Settings', label: 'Settings', icon: <Cog size={15} />, run: () => s.openSettings('general') },
      { id: 'cache', group: 'Settings', label: 'Clear lookup cache', icon: <Eraser size={15} />, run: async () => { await api.post('/api/cache/clear'); s.toast('Cache cleared'); } },
    ];
    const needle = q.trim().toLowerCase();
    const filtered = needle && multi.length <= 1
      ? cmds.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(needle))
      : multi.length > 1 ? [] : cmds.slice(0, 9);
    return [...out, ...filtered];
  }, [q, one, multi, nodes, s, elsewhere, role]);

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
      <motion.div ref={boxRef} aria-modal="true" className="palette" role="dialog" aria-label="Search or add" style={{ x: '-50%' }} initial={{ opacity: 0, y: -8, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 560, damping: 38 }}>
        <div className="input">
          <Search size={18} strokeWidth={1.8} className="faint" />
          <textarea ref={ref} rows={1} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Paste an email, username, domain, name, phone, IP…" spellCheck={false} autoCorrect="off" autoCapitalize="off" aria-label="Search or add" />
          {one && q.trim() && multi.length <= 1 && <TypeChip type={one.type} alts={cycle.length > 1 ? cycle.length : 0} onCycle={() => { const cur = override ?? one.type; setOverride(cycle[(cycle.indexOf(cur) + 1) % cycle.length]); }} />}
        </div>
        {one?.type === 'username' && q.trim() && multi.length <= 1 && <div className="pal-role"><RoleSummary value={draft} onChange={setDraft} subject={one.value} /></div>}
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
