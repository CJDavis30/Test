import { useState } from 'react';
import type { GraphNode } from '@shared/types';
import { TRUSTS, describeRole, originLabel, roleFromAttrs } from '@shared/handles';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { RolePicker, draftOf, roleOfDraft, type RoleDraft } from './RolePicker';

/** What this username is: its service, whether it is a username or a display name, where it came from, how sure you were. Editable, and the lookup is repeated with the new meaning. */
export function HandleRoleCard({ node }: { node: GraphNode }) {
  const s = useStore();
  const role = roleFromAttrs(node.attrs);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RoleDraft>(() => draftOf(role));
  const clue = role?.kind === 'display-name' && node.attrs.handleSearch !== true;
  const save = async () => {
    const r = roleOfDraft(draft);
    try { await api.patch(`/api/nodes/${node.id}`, { role: r ?? null }); await s.refreshCaseData(); setOpen(false); s.toast(r ? `Saved: ${describeRole(r)}. Looking it up again…` : 'Cleared. Looking it up again…'); void s.runNode(node.id); } catch (e: any) { s.toast(e?.message ?? 'Could not save that'); }
  };
  return (
    <div className="hrole" data-set={!!role}>
      <div className="hrole-h"><b>{describeRole(role)}</b>{role && <span className="faint"> · {TRUSTS.find((t) => t.key === role.trust)?.label.toLowerCase()}</span>}</div>
      {role?.origin && <div className="faint hrole-o">From {originLabel(role.origin).toLowerCase()}{role.originNote ? `: ${role.originNote}` : ''}</div>}
      {!role && <div className="faint hrole-o">Plexus does not know which service this is for, so everything it finds is only a same-name match.</div>}
      {clue && <div className="hrole-o">Kept as a clue only. <button className="linkish" onClick={async () => { await api.patch(`/api/nodes/${node.id}`, { handleSearch: true }); await s.refreshCaseData(); void s.runNode(node.id); }}>Search the internet for it anyway</button></div>}
      <button className="btn sm" onClick={() => { setDraft(draftOf(role)); setOpen(!open); }}>{open ? 'Cancel' : role ? 'Change' : 'Say what it is'}</button>
      {open && <><RolePicker value={draft} onChange={setDraft} subject={node.value} /><div className="rp-save"><button className="btn sm primary" onClick={() => void save()}>Save and look it up again</button></div></>}
    </div>
  );
}

