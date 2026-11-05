import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, ScanSearch, Plus } from 'lucide-react';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { fmtWhen, type PlatformRef, type ScanResponse } from '../../lib/forensics';
import { ActivityClock } from './ActivityClock';
import { useDialog } from '../ui';

/**
 * Paste anything: a chat export, a pile of links, a log. Plexus finds every platform ID and link, decodes what they carry (exact times,
 * account types), and if there are enough timestamps it works out when the person is awake and roughly where.
 */
export function Decode() {
  const s = useStore();
  const close = () => useStore.getState().setDecode(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, { onEscape: close });
  const [text, setText] = useState('');
  const [res, setRes] = useState<ScanResponse | null>(null);
  const [target, setTarget] = useState('');
  const accounts = (s.snap?.nodes ?? []).filter((n) => n.type === 'account' || n.type === 'username');
  useEffect(() => {
    if (text.trim().length < 3) { setRes(null); return; }
    let live = true;
    const t = setTimeout(() => api.post<ScanResponse>('/api/forensics/scan', { text }).then((r) => { if (live) setRes(r); }).catch(() => {}), 250);
    return () => { live = false; clearTimeout(t); };
  }, [text]);
  const addable = useMemo(() => (res?.refs ?? []).filter((r) => r.kind === 'user' || r.kind === 'handle'), [res]);
  const add = async (refs: PlatformRef[]) => {
    let n = 0;
    for (const r of refs) { try { await api.post(`/api/cases/${s.caseId}/lookups`, { type: 'account', value: r.url, run: false }); n++; } catch { /* skip what the case cannot hold */ } }
    const snap = await api.get<any>(`/api/cases/${s.caseId}`); useStore.setState({ snap: { ...useStore.getState().snap!, nodes: snap.nodes, edges: snap.edges } });
    s.toast(n ? `Added ${n} ${n === 1 ? 'account' : 'accounts'} to the case` : 'Nothing to add');
  };
  const attach = async () => {
    if (!target) return;
    const r = await api.post<{ count: number }>(`/api/nodes/${target}/activity`, { text });
    s.toast(`Saved ${r.count} timestamps on that account`);
  };
  return (
    <>
      <div className="scrim" onMouseDown={close} />
      <motion.div ref={ref} tabIndex={-1} aria-modal="true" role="dialog" aria-label="Decode IDs, links and timestamps" className="modal decode" style={{ x: '-50%', y: '-50%' }} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
        <button className="btn icon ghost close-x" aria-label="Close decoder" onClick={close}><X size={17} /></button>
        <div className="ml-title"><ScanSearch size={18} /><h2>Decode</h2><span className="faint">Paste links, IDs, chat logs, anything</span></div>
        <textarea className="field dc-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Paste Discord message links, Roblox or Steam profile links, user IDs, chat exports with timestamps…\n\nEverything is read on this Mac. Nothing is looked up until you add it to a case.'} spellCheck={false} autoFocus aria-label="Text to decode" />
        {res && (<>
          <div className="dc-sum">{res.refs.length} {res.refs.length === 1 ? 'reference' : 'references'} found · {res.timestamps} timestamps</div>
          {res.refs.length > 0 && (
            <div className="dc-refs">
              {res.refs.map((r) => (
                <div className="dc-ref" key={`${r.platform}${r.kind}${r.id}`}>
                  <span className="dc-plat">{r.platform}</span>
                  <div className="grow"><b className="truncate">{r.label}</b>{r.note && <small>{r.note}</small>}{r.at && !r.note && <small>{fmtWhen(r.at)}</small>}</div>
                </div>
              ))}
            </div>
          )}
          {addable.length > 0 && s.caseId && <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => void add(addable)}><Plus size={14} /> Add {addable.length} {addable.length === 1 ? 'account' : 'accounts'} to this case</button></div>}
          {res.circadian && (
            <div className="dc-clock">
              <div className="fsec" style={{ marginTop: 14 }}>When this person is awake</div>
              <ActivityClock c={res.circadian} />
              {res.circadian.strength !== 'insufficient' && accounts.length > 0 && (
                <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  <select className="field" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Account to attach these times to"><option value="">Attach these times to an account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
                  <button className="btn" onClick={() => void attach()} disabled={!target}>Attach</button>
                </div>
              )}
            </div>
          )}
        </>)}
      </motion.div>
    </>
  );
}
