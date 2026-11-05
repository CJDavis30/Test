import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Plus, ShieldCheck, Trash2, Search } from 'lucide-react';
import { useStore } from '../lib/store';
import { detect } from '@shared/detect';
import { ENTITY_LABEL, type EntityType } from '@shared/types';
import { EntityGlyph } from '../lib/icons';
import { useDialog } from './ui';

const KINDS: EntityType[] = ['email', 'username', 'phone', 'person', 'account', 'domain', 'org', 'location', 'wallet', 'url'];
const HINT: Partial<Record<EntityType, string>> = { email: 'name@example.com', username: 'their username or handle', phone: '+1 555 010 0199', person: 'Full name', account: 'https://profile link', domain: 'example.com', org: 'Company', location: 'City', wallet: 'Wallet address', url: 'https://…' };
interface Row { id: number; value: string; kind: EntityType | null }
let rid = 1;

/**
 * "I know this is theirs." Two facts find far more than one: each is looked up, and everything found for any of them is checked against
 * all the others (does this account list the email? is its handle the username? does it show the phone?).
 */
export function KnownDialog() {
  const s = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const close = () => s.setKnownDialog(false);
  useDialog(ref, { onEscape: close });
  const [rows, setRows] = useState<Row[]>([{ id: rid++, value: '', kind: null }, { id: rid++, value: '', kind: null }]);
  const [busy, setBusy] = useState(false);
  const typeOf = (r: Row): EntityType | null => r.kind ?? (r.value.trim() ? detect(r.value.trim())?.type ?? null : null);
  const filled = rows.filter((r) => r.value.trim());
  const set = (id: number, patch: Partial<Row>) => setRows((a) => a.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const onPaste = (e: React.ClipboardEvent, id: number) => {
    const t = e.clipboardData.getData('text'); const lines = t.split(/\r?\n|,\s*(?=[\w@+])/).map((x) => x.trim()).filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    setRows((a) => { const i = a.findIndex((r) => r.id === id); const fresh = lines.map((v) => ({ id: rid++, value: v, kind: null as EntityType | null })); return [...a.slice(0, i), ...fresh, ...a.slice(i + 1).filter((r) => r.value.trim())]; });
  };
  const go = async (run: boolean) => {
    if (!filled.length || busy) return;
    setBusy(true);
    try {
      const r = await s.addKnown(filled.map((x) => ({ type: typeOf(x) ?? undefined, value: x.value.trim() })), run);
      s.toast(r.skipped.length ? `Added ${r.added}. Could not understand: ${r.skipped.join(', ')}` : run ? `Added ${r.added} known ${r.added === 1 ? 'fact' : 'facts'}. Looking each one up and cross-checking…` : `Added ${r.added} known ${r.added === 1 ? 'fact' : 'facts'}`);
      close();
    } catch (e: any) { s.toast(e?.message ?? 'Could not add those'); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="scrim" onMouseDown={close} />
      <motion.div ref={ref} tabIndex={-1} aria-modal="true" role="dialog" aria-label="What you already know" className="modal known" style={{ x: '-50%', y: '-50%' }} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
        <button className="btn icon ghost close-x" aria-label="Close" onClick={close}><X size={17} /></button>
        <div className="ml-title"><ShieldCheck size={18} /><h2>What you already know</h2></div>
        <p className="kn-lead">Add anything you are <b>sure</b> belongs to the same person: an email, a username, a phone number, a name, a profile link. Plexus treats these as true, looks each one up, and checks everything it finds against <b>all</b> of them. With two or three known facts it can tell which accounts are really theirs.</p>
        <div className="kn-rows">
          {rows.map((r, i) => {
            const t = typeOf(r);
            return (
              <div className="kn-row" key={r.id}>
                <span className="kn-ico">{t ? <EntityGlyph type={t} size={15} /> : <Search size={15} />}</span>
                <input className="field" value={r.value} autoFocus={i === 0} placeholder={i === 0 ? 'name@example.com' : i === 1 ? 'their username' : 'anything else you are sure of'} aria-label={`Known fact ${i + 1}`} spellCheck={false}
                  onChange={(e) => set(r.id, { value: e.target.value })} onPaste={(e) => onPaste(e, r.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (i === rows.length - 1) setRows((a) => [...a, { id: rid++, value: '', kind: null }]); else (e.currentTarget.parentElement?.nextElementSibling?.querySelector('input') as HTMLInputElement | null)?.focus(); } }} />
                <select className="kn-kind" value={r.kind ?? t ?? ''} onChange={(e) => set(r.id, { kind: (e.target.value || null) as EntityType | null })} aria-label={`Kind of fact ${i + 1}`}>
                  {!t && <option value="">What is it?</option>}
                  {KINDS.map((k) => <option key={k} value={k}>{ENTITY_LABEL[k]}</option>)}
                </select>
                {rows.length > 1 && <button className="btn icon sm ghost" aria-label={`Remove fact ${i + 1}`} onClick={() => setRows((a) => a.filter((x) => x.id !== r.id))}><Trash2 size={14} /></button>}
              </div>
            );
          })}
          <button className="btn sm ghost kn-add" onClick={() => setRows((a) => [...a, { id: rid++, value: '', kind: null }])}><Plus size={13} /> Add another</button>
        </div>
        {filled.some((r) => !typeOf(r)) && <p className="kn-warn">Choose what kind of thing each unmarked line is.</p>}
        {filled.length === 1 && <p className="kn-tip">One fact is a fine start. Adding a second one later (a username next to an email, say) makes every result more accurate.</p>}
        <div className="actions">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn outline" disabled={!filled.length || busy || filled.some((r) => !typeOf(r))} onClick={() => void go(false)}>Add only</button>
          <button className="btn primary" disabled={!filled.length || busy || filled.some((r) => !typeOf(r))} onClick={() => void go(true)}><ShieldCheck size={14} /> {filled.length > 1 ? `Add ${filled.length} and look them all up` : 'Add and look it up'}</button>
        </div>
      </motion.div>
    </>
  );
}
