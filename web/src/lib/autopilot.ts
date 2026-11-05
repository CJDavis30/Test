import type { ApEvent, AutopilotSummary, CaseSnapshot, EntityType, Finding } from '@shared/types';
import { api, streamAutopilot } from './api';
import { useStore } from './store';

export interface ApLine { id: number; kind: 'look' | 'check' | 'accept' | 'keep' | 'follow'; text: string }
export interface ApState {
  id: string; caseId: string; seed: { id: string; label: string; type: EntityType };
  status: 'running' | 'done' | 'stopped' | 'error';
  lines: ApLine[];
  current?: { label: string; type: EntityType; depth: number; n: number; phase: 'looking' | 'checking' | 'judging'; done?: number; total?: number };
  limits: { depth: number; subjects: number };
  nodes: number; edges: number; accepted: number; kept: number;
  summary?: AutopilotSummary; error?: string; startedAt: number; undone?: boolean;
}

let close: (() => void) | null = null;
let seq = 1;

const patch = (p: Partial<ApState> | ((s: ApState) => Partial<ApState>)) => {
  const cur = useStore.getState().autopilot; if (!cur) return;
  useStore.setState({ autopilot: { ...cur, ...(typeof p === 'function' ? p(cur) : p) } });
};
const line = (kind: ApLine['kind'], text: string) => patch((s) => ({ lines: [...s.lines.slice(-40), { id: seq++, kind, text }] }));

/** Pull the new nodes and edges in without disturbing positions the graph has already settled on. */
async function refreshGraph(final = false) {
  const st = useStore.getState(); const ap = st.autopilot; if (!ap || st.caseId !== ap.caseId || !st.snap) return;
  const [snap, f] = await Promise.all([api.get<CaseSnapshot>(`/api/cases/${ap.caseId}`), final ? api.get<{ findings: Finding[] }>(`/api/cases/${ap.caseId}/findings`) : Promise.resolve(null)]);
  const cur = useStore.getState();
  if (cur.caseId !== ap.caseId || !cur.snap) return;
  const have = new Map(cur.snap.nodes.map((n) => [n.id, n]));
  const nodes = snap.nodes.map((n) => { const o = have.get(n.id); return o ? { ...n, x: o.x ?? n.x, y: o.y ?? n.y, pinned: o.pinned ?? n.pinned } : n; });
  useStore.setState({ snap: { ...cur.snap, nodes, edges: snap.edges }, ...(f ? { findings: Object.fromEntries(f.findings.map((x) => [x.id, { ...(cur.findings[x.id] ?? {}), ...x }])) } : {}) });
}

function apply(e: ApEvent) {
  switch (e.t) {
    case 'ap.start': break;
    case 'ap.step': {
      patch((s) => ({ current: { label: e.subject.label, type: e.subject.type, depth: e.depth, n: e.n, phase: e.phase, done: e.sources?.done ?? (s.current?.n === e.n ? s.current.done : undefined), total: e.sources?.total ?? (s.current?.n === e.n ? s.current.total : undefined) } }));
      const prev = useStore.getState().autopilot?.lines.at(-1)?.text;
      if (e.phase === 'looking' && !e.sources) { const t = e.depth === 0 ? `Starting with ${e.subject.label}` : `Following ${e.subject.label}`; if (prev !== t) line(e.depth === 0 ? 'look' : 'follow', t); }
      if (e.phase === 'checking') { const t = 'Cross-checking what it found against other sources'; if (prev !== t) line('check', t); }
      break;
    }
    case 'ap.accepted':
      patch((s) => ({ accepted: s.accepted + e.labels.length + 0, kept: s.kept + e.kept }));
      if (e.labels.length) line('accept', `Accepted ${e.labels.slice(0, 3).join(', ')}${e.labels.length > 3 ? ` and ${e.labels.length - 3} more` : ''}`);
      if (e.kept) line('keep', `Left ${e.kept} for you to review`);
      void refreshGraph();
      break;
    case 'ap.graph': patch({ nodes: e.nodes, edges: e.edges }); void refreshGraph(); break;
    case 'ap.done':
      patch({ status: e.summary.stopped ? 'stopped' : 'done', summary: e.summary, nodes: e.summary.nodes, edges: e.summary.edges, current: undefined });
      void refreshGraph(true).then(() => { void useStore.getState().refreshSuggestions(); setTimeout(() => window.dispatchEvent(new CustomEvent('plexus:fit')), 300); });
      break;
    case 'ap.error': patch({ status: 'error', error: e.message, current: undefined }); break;
  }
}

/** Start Autopilot from something you typed, or from a node already on the graph. */
export async function startAutopilot(input: { type?: EntityType; value?: string; nodeId?: string; dryRun?: boolean }) {
  const st = useStore.getState();
  let caseId = st.caseId;
  if (!caseId) caseId = await st.newCase(input.value ? undefined : undefined);
  try {
    const r = await api.post<{ id: string; node: { id: string; label: string; type: EntityType } }>(`/api/cases/${caseId}/autopilot`, input);
    close?.();
    const s2 = useStore.getState();
    if (s2.snap && !s2.snap.nodes.some((n) => n.id === r.node.id)) useStore.setState({ snap: { ...s2.snap, nodes: [...s2.snap.nodes, r.node as any] } });
    useStore.setState({ autopilot: { id: r.id, caseId: caseId!, seed: { id: r.node.id, label: r.node.label, type: r.node.type }, status: 'running', lines: [], limits: { depth: 2, subjects: 8 }, nodes: 0, edges: 0, accepted: 0, kept: 0, startedAt: Date.now() }, view: 'graph', sheet: null, palette: false, selection: [r.node.id] });
    close = streamAutopilot(r.id, apply, () => { close = null; if (useStore.getState().autopilot?.status === 'running') patch({ status: 'error', error: 'Lost contact with the engine.' }); });
  } catch (e: any) { useStore.getState().toast(e?.message ?? 'Could not start Autopilot'); }
}

export async function stopAutopilot() {
  const ap = useStore.getState().autopilot; if (!ap || ap.status !== 'running') return;
  line('keep', 'Stopping after the current step…');
  await api.post(`/api/autopilot/${ap.id}/stop`).catch(() => {});
}
/** Put back everything this run accepted and take off the graph what it added. */
export async function undoAutopilot() {
  const ap = useStore.getState().autopilot; if (!ap || ap.status === 'running' || ap.undone) return;
  try {
    const r = await api.post<{ findings: number; nodes: number }>(`/api/autopilot/${ap.id}/undo`);
    await useStore.getState().loadCase(ap.caseId);
    useStore.setState({ autopilot: { ...ap, undone: true }, sheet: null });
    useStore.getState().toast(`Undone: ${r.findings} findings back to review, ${r.nodes} nodes removed`);
  } catch (e: any) { useStore.getState().toast(e?.message ?? 'Nothing to undo'); }
}
export function dismissAutopilot() { close?.(); close = null; useStore.setState({ autopilot: null }); }
