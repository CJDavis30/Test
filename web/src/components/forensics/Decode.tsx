import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, ScanSearch, Plus } from 'lucide-react';
import { useStore } from '../../lib/store';
import { api } from '../../lib/api';
import { fmtWhen, type ChatSummary, type PlatformRef, type ScanResponse } from '../../lib/forensics';
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
  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [chatText, setChatText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const openChat = (t: string) => api.post<{ chat: ChatSummary | null }>('/api/forensics/chat', { text: t }).then((r) => { setChat(r.chat); setChatText(r.chat ? t : ''); setPicked(new Set((r.chat?.speakers ?? []).filter((x) => x.messages >= 20).map((x) => x.id))); if (!r.chat) s.toast('That does not look like a Discord, Telegram or WhatsApp export'); }).catch((e) => s.toast(e?.message ?? 'Could not read that file'));
  const pickFile = () => { const i = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,.csv,.txt,text/*,application/json' }); i.onchange = async () => { const f = i.files?.[0]; if (!f) return; if (f.size > 40_000_000) { s.toast('That export is too large (40 MB maximum)'); return; } await openChat(await f.text()); }; i.click(); };
  const addSpeakers = async () => { const r = await api.post<{ added: number }>(`/api/cases/${s.caseId}/chat-import`, { text: chatText, speakers: [...picked] }); const snap = await api.get<any>(`/api/cases/${s.caseId}`); useStore.setState({ snap: { ...useStore.getState().snap!, nodes: snap.nodes, edges: snap.edges } }); s.toast(`Added ${r.added} ${r.added === 1 ? 'speaker' : 'speakers'} to the case`); };
  const accounts = (s.snap?.nodes ?? []).filter((n) => n.type === 'account' || n.type === 'username');
  useEffect(() => {
    if (text.trim().length < 3) { setRes(null); return; }
    if (text.length > 300 && /^\s*(\{|AuthorID|\[?\d)/.test(text)) void openChat(text);
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
        <div className="row" style={{ marginBottom: 8 }}><button className="btn sm" onClick={pickFile}>Open a chat export…</button><span className="faint" style={{ fontSize: 12 }}>Discord (JSON or CSV), Telegram (JSON) or WhatsApp (text)</span></div>
        <textarea className="field dc-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Paste Discord message links, Roblox or Steam profile links, user IDs, chat exports with timestamps…\n\nEverything is read on this Mac. Nothing is looked up until you add it to a case.'} spellCheck={false} autoFocus aria-label="Text to decode" />
        {chat && (
          <div className="dc-chat">
            <div className="fsec" style={{ marginTop: 6 }}>{chat.platform} chat export <span className="cnt">{chat.total.toLocaleString('en-US')} messages · {chat.speakers.length} speakers</span></div>
            {chat.note && <p className="faint" style={{ fontSize: 12, margin: '0 0 8px' }}>{chat.note}</p>}
            <div className="dc-speakers">
              {chat.speakers.slice(0, 40).map((sp) => (
                <label className="dc-sp" key={sp.id}>
                  <input type="checkbox" checked={picked.has(sp.id)} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(sp.id) : n.delete(sp.id); setPicked(n); }} aria-label={`Add ${sp.name || sp.id}`} />
                  <div className="grow"><b className="truncate">{sp.name || sp.id}</b><small>{sp.messages.toLocaleString('en-US')} messages · {fmtWhen(sp.first, 'day')} to {fmtWhen(sp.last, 'day')}{sp.circadian && sp.circadian.strength !== 'insufficient' ? ` · active like UTC${sp.circadian.best.offset >= 0 ? '+' : '−'}${Math.abs(sp.circadian.best.offset)} (${Math.round(sp.circadian.best.p * 100)}%)` : ''}</small></div>
                  {sp.circadian && sp.circadian.strength !== 'insufficient' && <ActivityClock c={sp.circadian} size={64} mini />}
                </label>
              ))}
            </div>
            {s.caseId && <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={picked.size === 0} onClick={() => void addSpeakers()}><Plus size={14} /> Add {picked.size} {picked.size === 1 ? 'speaker' : 'speakers'} to this case</button></div>}
          </div>
        )}
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
          {res.headers && (
            <div className="dc-head">
              <div className="fsec" style={{ marginTop: 14 }}>Email headers</div>
              <div className="dc-hmeta">{res.headers.from && <span>From <b>{res.headers.from}</b></span>}{res.headers.sent && <span>Sent <b className="num">{fmtWhen(res.headers.sent.at)}</b> from a clock set to <b>{res.headers.sent.tz}</b></span>}{res.headers.originIp && <span>Origin <b className="num">{res.headers.originIp}</b></span>}</div>
              {res.headers.hops.length > 0 && <ol className="dc-hops">{res.headers.hops.map((h) => <li key={h.index}><b>{h.by ?? 'unknown'}</b>{h.ip ? <span className="num"> · {h.ip}</span> : null}{h.at ? <small>{fmtWhen(h.at)}{h.delaySec !== undefined ? ` · +${h.delaySec}s` : ''}</small> : null}</li>)}</ol>}
              <ul className="dc-hf">{res.headers.findings.map((f, i) => <li key={i} className={f.level}>{f.text}</li>)}</ul>
            </div>
          )}
          {res.circadian && (
            <div className="dc-clock">
              <div className="fsec" style={{ marginTop: 14 }}>When this person is awake</div>
              <ActivityClock c={res.circadian} dst={res.dst} />
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
