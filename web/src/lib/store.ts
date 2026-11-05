import { create } from 'zustand';
import type {
  Brief, CaseInfo, CaseSnapshot, EntityType, Finding, FindingStatus, GraphEdge, GraphNode, LinkSuggestion, NextStep,
  RunEvent, SourceInfo, SourceProgress, AiSettings,
} from '@shared/types';
import { keyFor } from '@shared/normalize';
import { contextBoost, parseContext } from '@shared/scoring';
import { api, streamRun } from './api';

export type View = 'graph' | 'table' | 'timeline' | 'report';
export type SheetTab = 'review' | 'accepted' | 'rejected';
export type SettingsTab = 'general' | 'sources' | 'ai' | 'audit';

export interface RunState {
  runId: string;
  status: 'running' | 'done' | 'error';
  sources: SourceProgress[];
  brief: Brief | null;
  next: NextStep[];
  context: string;
  startedAt: number;
  error?: string;
  briefLoading?: boolean;
}

export interface Settings {
  demoMode: boolean;
  ai: AiSettings;
  aiReady: { ok: boolean; why?: string; model?: string };
  region: string;
  onboarded: boolean;
  crossCheck: boolean;
}

export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }

interface State {
  booted: boolean;
  cases: CaseInfo[];
  caseId: string | null;
  snap: { case: CaseInfo; nodes: GraphNode[]; edges: GraphEdge[] } | null;
  findings: Record<string, Finding>;
  runs: Record<string, RunState>;
  suggestions: LinkSuggestion[];
  settings: Settings | null;
  sources: SourceInfo[];

  view: View;
  sheet: { subjectId: string; tab: SheetTab; triage: boolean } | null;
  selection: string[];
  selectedEdge: string | null;
  sidebar: boolean;
  inspector: boolean;
  palette: boolean;
  paletteSeed: string;
  settingsOpen: SettingsTab | null;
  theme: 'auto' | 'light' | 'dark';
  toasts: Toast[];
  undoStack: { label: string; run: () => Promise<void> | void }[];
  focusNodeId: string | null;
  pathFor: string[] | null;
}

interface Actions {
  boot(): Promise<void>;
  refreshSettings(): Promise<void>;
  refreshSources(): Promise<void>;
  loadCase(id: string): Promise<void>;
  newCase(name?: string, purpose?: string): Promise<string>;
  renameCase(id: string, patch: { name?: string; purpose?: string }): Promise<void>;
  deleteCase(id: string): Promise<void>;
  submit(items: { type?: EntityType; value: string }[], opts?: { context?: string; open?: boolean; run?: boolean }): Promise<void>;
  openNode(id: string): Promise<void>;
  pivot(step: NextStep, fromSubject: string): Promise<void>;
  runNode(nodeId: string, context?: string, open?: boolean): Promise<void>;
  openSheet(subjectId: string, tab?: SheetTab, triage?: boolean): void;
  closeSheet(): void;
  setSheet(patch: Partial<NonNullable<State['sheet']>>): void;
  setContext(subjectId: string, context: string): void;
  review(ids: string[], status: FindingStatus, opts?: { toast?: boolean }): Promise<void>;
  commit(subjectId?: string): Promise<{ added: number }>;
  undo(): Promise<void>;
  select(ids: string[], additive?: boolean): void;
  selectEdge(id: string | null): void;
  patchNode(id: string, patch: Partial<GraphNode>): Promise<void>;
  removeNodes(ids: string[]): Promise<void>;
  mergeNodes(into: string, from: string): Promise<void>;
  refreshSuggestions(ai?: boolean): Promise<void>;
  acceptSuggestion(s: LinkSuggestion): Promise<void>;
  dismissSuggestion(id: string): void;
  addEdge(from: string, to: string, label?: string): Promise<void>;
  setView(v: View): void;
  toggle(k: 'sidebar' | 'inspector' | 'palette', v?: boolean): void;
  openPalette(seed?: string): void;
  openSettings(t: SettingsTab | null): void;
  setTheme(t: State['theme']): void;
  toast(text: string, action?: Toast['action']): void;
  dismissToast(id: number): void;
  refreshBrief(subjectId: string): Promise<void>;
  setPath(ids: string[] | null): void;
  attachRun(subjectId: string, runId: string, context: string): void;
}

const LAST = 'plexus.lastCase';
let toastSeq = 1;
const closers = new Map<string, () => void>();

export const useStore = create<State & Actions>((set, get) => ({
  booted: false, cases: [], caseId: null, snap: null, findings: {}, runs: {}, suggestions: [], settings: null, sources: [],
  view: 'graph', sheet: null, selection: [], selectedEdge: null, sidebar: true, inspector: false, palette: false, paletteSeed: '', settingsOpen: null,
  theme: (localStorage.getItem('plexus.theme') as State['theme']) || 'auto', toasts: [], undoStack: [], focusNodeId: null, pathFor: null,

  async boot() {
    await Promise.all([get().refreshSettings(), get().refreshSources()]);
    const { cases } = await api.get<{ cases: CaseInfo[] }>('/api/cases');
    set({ cases });
    const last = localStorage.getItem(LAST);
    const pick = cases.find((c) => c.id === last) ?? cases[0];
    if (pick) await get().loadCase(pick.id);
    set({ booted: true });
  },

  async refreshSettings() { set({ settings: await api.get<Settings>('/api/settings') }); },
  async refreshSources() { set({ sources: (await api.get<{ sources: SourceInfo[] }>('/api/sources')).sources }); },

  async loadCase(id) {
    closers.forEach((c) => c()); closers.clear();
    const [snap, f] = await Promise.all([
      api.get<CaseSnapshot>(`/api/cases/${id}`),
      api.get<{ findings: Finding[] }>(`/api/cases/${id}/findings`),
    ]);
    localStorage.setItem(LAST, id);
    set({
      caseId: id, snap: { case: snap.case, nodes: snap.nodes, edges: snap.edges }, findings: Object.fromEntries(f.findings.map((x) => [x.id, x])),
      runs: {}, sheet: null, selection: [], selectedEdge: null, suggestions: [], pathFor: null, undoStack: [],
    });
    void get().refreshSuggestions();
  },

  async newCase(name, purpose) {
    const untitled = get().cases.filter((c) => /^Untitled case( \d+)?$/.test(c.name)).length;
    const { case: c } = await api.post<{ case: CaseInfo }>('/api/cases', { name: name ?? (untitled ? `Untitled case ${untitled + 1}` : 'Untitled case'), purpose });
    set({ cases: [c, ...get().cases] });
    await get().loadCase(c.id);
    return c.id;
  },
  async renameCase(id, patch) {
    const { case: c } = await api.patch<{ case: CaseInfo }>(`/api/cases/${id}`, patch);
    set({ cases: get().cases.map((x) => (x.id === id ? { ...x, ...c } : x)), snap: get().snap && get().snap!.case.id === id ? { ...get().snap!, case: { ...get().snap!.case, ...c } } : get().snap });
  },
  async deleteCase(id) {
    await api.del(`/api/cases/${id}`);
    const cases = get().cases.filter((c) => c.id !== id);
    set({ cases });
    if (get().caseId === id) {
      if (cases[0]) await get().loadCase(cases[0].id); else set({ caseId: null, snap: null, findings: {}, runs: {}, sheet: null });
    }
  },

  async submit(items, opts = {}) {
    if (!items.length) return;
    let caseId = get().caseId;
    if (!caseId) caseId = await get().newCase(items[0].value.trim().slice(0, 48) || undefined);
    let first = true;
    for (const it of items) {
      try {
        const { node, run } = await api.post<{ node: GraphNode; run?: { id: string } }>(`/api/cases/${caseId}/lookups`, { type: it.type, value: it.value, context: opts.context, run: opts.run });
        const snap = get().snap!;
        if (!snap.nodes.some((n) => n.id === node.id)) set({ snap: { ...snap, nodes: [...snap.nodes, node] } });
        if (!run) { get().select([node.id]); continue; }
        get().attachRun(node.id, run.id, opts.context ?? '');
        if (first && opts.open !== false) { get().openSheet(node.id); set({ selection: [node.id], selectedEdge: null }); }
        first = false;
      } catch (e: any) {
        get().toast(e?.message ?? 'Could not add that');
      }
    }
  },

  async openNode(id) {
    const fs = Object.values(get().findings).filter((f) => f.subjectId === id);
    if (!fs.length && !get().runs[id]) return get().runNode(id);
    const pending = fs.some((f) => f.status === 'pending' || f.status === 'unsure');
    get().openSheet(id, pending || !fs.length ? 'review' : 'accepted');
  },

  /** Follow a suggested next step: accept the finding, put it on the graph linked to its parent, then look it up. */
  async pivot(step, fromSubject) {
    if (step.findingId) await get().review([step.findingId], 'accepted');
    await get().commit(fromSubject);
    const snap = get().snap!;
    const node = snap.nodes.find((n) => n.type === step.type && keyOfNode(n) === `${step.type}:${keyFor(step.type, step.value)}`);
    if (node) { get().select([node.id]); await get().runNode(node.id, '', true); }
  },

  async runNode(nodeId, context = '', open = true) {
    const caseId = get().caseId!;
    const prevCtx = get().runs[nodeId]?.context ?? '';
    const ctx = context || prevCtx;
    const { run } = await api.post<{ run: { id: string } }>(`/api/cases/${caseId}/lookups`, { nodeId, context: ctx });
    get().attachRun(nodeId, run.id, ctx);
    if (open) get().openSheet(nodeId);
  },

  openSheet(subjectId, tab = 'review', triage = false) { set({ sheet: { subjectId, tab, triage } }); },
  closeSheet() { set({ sheet: null }); },
  setSheet(patch) { const s = get().sheet; if (s) set({ sheet: { ...s, ...patch } }); },

  setContext(subjectId, context) {
    const r = get().runs[subjectId];
    set({ runs: { ...get().runs, [subjectId]: { ...(r ?? { runId: '', status: 'done', sources: [], brief: null, next: [], startedAt: 0 }), context } } });
    const ctx = parseContext(context);
    const findings = { ...get().findings };
    for (const f of Object.values(findings)) if (f.subjectId === subjectId) findings[f.id] = { ...f, rank: f.score + contextBoost(f, ctx) };
    set({ findings });
  },

  async review(ids, status, opts = {}) {
    const prev = new Map<string, FindingStatus>();
    const findings = { ...get().findings };
    for (const id of ids) { const f = findings[id]; if (f && f.status !== status) { prev.set(id, f.status); findings[id] = { ...f, status }; } }
    if (!prev.size) return;
    set({ findings });
    await api.post('/api/findings/review', { ids: [...prev.keys()], status });
    const groups = new Map<FindingStatus, string[]>();
    for (const [id, p] of prev) (groups.get(p) ?? groups.set(p, []).get(p)!).push(id);
    const run = async () => {
      const cur = { ...get().findings };
      for (const [p, list] of groups) {
        for (const id of list) if (cur[id]) cur[id] = { ...cur[id], status: p };
        await api.post('/api/findings/review', { ids: list, status: p });
      }
      set({ findings: cur });
    };
    const label = `${status} ${prev.size}`;
    set({ undoStack: [...get().undoStack.slice(-49), { label, run }] });
    if (opts.toast && prev.size > 1) {
      get().toast(`${status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Rejected' : 'Marked unsure'} ${prev.size}`, { label: 'Undo', run: () => void get().undo() });
    }
  },

  async commit(subjectId) {
    const caseId = get().caseId!;
    const r = await api.post<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/cases/${caseId}/commit`, { subjectId });
    const snap = get().snap!;
    const nodes = new Map(snap.nodes.map((n) => [n.id, n]));
    const before = nodes.size;
    for (const n of r.nodes) nodes.set(n.id, { ...nodes.get(n.id), ...n });
    const edges = new Map(snap.edges.map((e) => [e.id, e]));
    for (const e of r.edges) edges.set(e.id, e);
    // seeds that now have accepted children are confirmed
    const seeded = new Set(r.edges.map((e) => e.from));
    for (const id of seeded) { const n = nodes.get(id); if (n) nodes.set(id, { ...n, state: 'confirmed' }); }
    set({ snap: { ...snap, nodes: [...nodes.values()], edges: [...edges.values()] } });
    void get().refreshSuggestions();
    return { added: nodes.size - before };
  },

  async undo() {
    const u = get().undoStack.at(-1);
    if (!u) return;
    set({ undoStack: get().undoStack.slice(0, -1) });
    await u.run();
  },

  select(ids, additive) {
    const sel = additive ? [...new Set([...get().selection, ...ids])] : ids;
    set({ selection: sel, selectedEdge: null, inspector: sel.length > 0 ? true : get().inspector });
  },
  selectEdge(id) { set({ selectedEdge: id, selection: id ? [] : get().selection, inspector: id ? true : get().inspector }); },

  async patchNode(id, patch) {
    const snap = get().snap; if (!snap) return;
    set({ snap: { ...snap, nodes: snap.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) } });
    await api.patch(`/api/nodes/${id}`, patch);
  },

  async removeNodes(ids) {
    const snap = get().snap; if (!snap || !ids.length) return;
    const removed = snap.nodes.filter((n) => ids.includes(n.id));
    const removedEdges = snap.edges.filter((e) => ids.includes(e.from) || ids.includes(e.to));
    set({ snap: { ...snap, nodes: snap.nodes.filter((n) => !ids.includes(n.id)), edges: snap.edges.filter((e) => !removedEdges.includes(e)) }, selection: [] });
    await Promise.all(ids.map((id) => api.patch(`/api/nodes/${id}`, { hidden: true })));
    const restore = async () => {
      await Promise.all(ids.map((id) => api.patch(`/api/nodes/${id}`, { hidden: false })));
      await get().loadCase(get().caseId!);
    };
    get().toast(`Removed ${removed.length === 1 ? removed[0].label : `${removed.length} items`}`, { label: 'Undo', run: () => void restore() });
  },

  async mergeNodes(into, from) {
    await api.post(`/api/nodes/${from}/merge`, { into });
    await get().loadCase(get().caseId!);
    get().select([into]);
    get().toast('Merged');
  },

  async refreshSuggestions(ai = false) {
    const id = get().caseId; if (!id) return;
    try {
      const r = await api.get<{ suggestions: LinkSuggestion[] }>(`/api/cases/${id}/suggestions${ai ? '?ai=1' : ''}`);
      if (get().caseId === id) set({ suggestions: r.suggestions });
    } catch { /* non-critical */ }
  },
  async acceptSuggestion(s) {
    const caseId = get().caseId!;
    await api.post(`/api/cases/${caseId}/links/accept`, { a: s.a, b: s.b, label: s.label, score: s.score, kind: s.kind });
    set({ suggestions: get().suggestions.filter((x) => x.id !== s.id) });
    await get().loadCase(caseId);
    void get().refreshSuggestions();
  },
  dismissSuggestion(id) { set({ suggestions: get().suggestions.filter((s) => s.id !== id) }); },
  async addEdge(from, to, label) {
    const caseId = get().caseId!;
    const { edge } = await api.post<{ edge: GraphEdge }>(`/api/cases/${caseId}/edges`, { from, to, label });
    const snap = get().snap!;
    set({ snap: { ...snap, edges: [...snap.edges.filter((e) => e.id !== edge.id), edge] } });
  },

  setView(view) { set({ view }); },
  toggle(k, v) { set({ [k]: v ?? !get()[k] } as any); },
  openPalette(seed = '') { set({ palette: true, paletteSeed: seed }); },
  openSettings(t) { set({ settingsOpen: t }); },
  setTheme(theme) {
    set({ theme });
    try { localStorage.setItem('plexus.theme', theme); } catch { /* storage may be unavailable */ }
    if (theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  },
  toast(text, action) {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, text, action }] });
    setTimeout(() => get().dismissToast(id), action ? 6500 : 3200);
  },
  dismissToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }); },
  setPath(ids) { set({ pathFor: ids }); },

  async refreshBrief(subjectId) {
    const r = get().runs[subjectId] ?? { runId: '', status: 'done' as const, sources: [], brief: null, next: [], context: '', startedAt: 0 };
    set({ runs: { ...get().runs, [subjectId]: { ...r, briefLoading: true } } });
    try {
      const res = await api.post<{ brief: Brief; next: NextStep[] }>(`/api/nodes/${subjectId}/brief`, { context: r.context });
      const cur = get().runs[subjectId];
      set({ runs: { ...get().runs, [subjectId]: { ...cur, brief: res.brief, next: res.next, briefLoading: false } } });
    } catch {
      const cur = get().runs[subjectId];
      set({ runs: { ...get().runs, [subjectId]: { ...cur, briefLoading: false } } });
    }
  },

  // internal: wire a run's SSE stream into state
  attachRun(subjectId, runId, context) {
    closers.get(subjectId)?.();
    set({ runs: { ...get().runs, [subjectId]: { runId, status: 'running', sources: [], brief: null, next: [], context, startedAt: Date.now() } } });
    const close = streamRun(runId, (e) => applyEvent(subjectId, runId, e));
    closers.set(subjectId, close);
  },
}));

if (typeof location !== 'undefined' && location.search.includes('debug')) (window as any).__plexusStore = useStore;

function applyEvent(subjectId: string, runId: string, e: RunEvent) {
  const st = useStore.getState();
  const cur = st.runs[subjectId];
  if (!cur || cur.runId !== runId) return;
  const put = (patch: Partial<RunState>) => useStore.setState({ runs: { ...useStore.getState().runs, [subjectId]: { ...useStore.getState().runs[subjectId], ...patch } } });
  switch (e.t) {
    case 'run.started': put({ sources: e.sources }); break;
    case 'source': {
      const list = [...useStore.getState().runs[subjectId].sources];
      const i = list.findIndex((s) => s.adapter === e.progress.adapter);
      if (i >= 0) list[i] = e.progress; else list.push(e.progress);
      put({ sources: list });
      break;
    }
    case 'findings': {
      const ctx = parseContext(useStore.getState().runs[subjectId].context);
      const findings = { ...useStore.getState().findings };
      for (const f of e.findings) {
        const prev = findings[f.id];
        // keep the user's decision if they made one while results were still streaming
        findings[f.id] = { ...f, status: prev && prev.status !== 'pending' ? prev.status : f.status, rank: f.score + contextBoost(f, ctx) };
      }
      useStore.setState({ findings });
      break;
    }
    case 'brief': put({ brief: e.brief, next: e.next }); break;
    case 'run.done': put({ status: 'done' }); void useStore.getState().refreshSources(); break;
    case 'run.error': put({ status: 'error', error: e.message }); break;
  }
}

export const keyOfNode = (n: Pick<GraphNode, 'type' | 'value' | 'attrs'>) => `${n.type}:${keyFor(n.type, n.value, n.attrs)}`;
