import { useStore } from './store';

/** Choose a Plexus export file and import it as a NEW case. Nothing already on this Mac is changed. */
export function pickAndImport(_s?: unknown) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => {
    const st = useStore.getState();
    const file = input.files?.[0]; if (!file) return;
    if (file.size > 80_000_000) { st.toast('That file is too large to import'); return; }
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'content-type': 'application/json', 'x-plexus': '1' }, body: await file.text() });
      const j = await res.json();
      if (!res.ok) { st.toast(j.error ?? 'Could not import that file'); return; }
      await st.refreshCases();
      await st.loadCase(j.case.id);
      st.toast(j.integrity.altered ? `Imported, but ${j.integrity.altered} evidence item${j.integrity.altered > 1 ? 's were' : ' was'} changed since export` : `Imported “${j.case.name}” · ${j.nodes} entities, evidence verified`);
    } catch (e: any) { st.toast(e?.message ?? 'Could not import that file'); }
  };
  input.click();
}
