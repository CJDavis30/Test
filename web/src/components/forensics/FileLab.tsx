import type * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, FileSearch, Upload, MapPin, Clock, User, Camera, Wrench, FileText, AlertTriangle, Info, Plus, Trash2, Link2, Eye, Sparkles, ChevronDown, Copy } from 'lucide-react';
import { useStore, askConfirm } from '../../lib/store';
import { api, ApiError } from '../../lib/api';
import { pixelStats, cleanPreview } from '../../lib/pixels';
import { useDialog } from '../ui';
import type { FileReport, Fact, FactGroup } from '@shared/files';
import type { FileLink } from '@shared/forensics/filelinks';
import type { GeoConsensus } from '../../../../server/geolocate';
import { mapLinks } from '@shared/forensics/geo';

/**
 * Photos & files. Drop anything: Plexus reads what is inside it (where, when, who, with what, edited how) and puts the few facts that
 * matter first. The file is read by the local server and dropped; only the findings are kept, and only if you add them to a case.
 */
interface Item { key: string; name: string; file?: File; url?: string; report?: FileReport; error?: string; busy?: boolean; geo?: GeoState }
interface GeoState { busy?: boolean; result?: GeoConsensus; errKm?: number; error?: string; cal?: Calibration }
interface Calibration { total: number; byLevel: Record<string, { n: number; right: number; medianKm: number; target: number }> }

const ICON: Record<FactGroup, React.ReactElement> = { where: <MapPin size={14} />, when: <Clock size={14} />, who: <User size={14} />, device: <Camera size={14} />, edit: <Wrench size={14} />, content: <FileText size={14} />, file: <FileText size={14} /> };
const GROUP: Record<FactGroup, string> = { where: 'Where', when: 'When', who: 'Who', device: 'Device', edit: 'Edits and origin', content: 'Contents', file: 'The file' };
const GROUPS: FactGroup[] = ['where', 'when', 'who', 'device', 'edit', 'content', 'file'];
const isImage = (r?: FileReport) => !!r && ['jpeg', 'png', 'gif', 'webp', 'bmp'].includes(r.kind);
const LEVEL_TEXT: Record<string, string> = { city: 'City-level', region: 'Region-level', country: 'Country-level', none: 'No answer' };

export function FileLab() {
  const s = useStore();
  const ref = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const close = () => s.closeFileLab();
  useDialog(ref, { onEscape: close });
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ files: FileReport[]; links: FileLink[] }>({ files: [], links: [] });
  const [save, setSave] = useState(true);
  const [more, setMore] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const refreshLibrary = () => { if (s.caseId) api.get<{ files: FileReport[]; links: FileLink[] }>(`/api/cases/${s.caseId}/files`).then(setLibrary).catch(() => {}); };
  useEffect(refreshLibrary, [s.caseId]);

  const analyse = async (file: File) => {
    const key = `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 6)}`;
    const url = /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : undefined;
    setItems((a) => [{ key, name: file.name, file, url, busy: true }, ...a]); setSel(key);
    try {
      const px = file.type.startsWith('image/') ? await pixelStats(file) : null;
      const q = new URLSearchParams({ name: file.name, lastModified: String(file.lastModified) });
      if (px) { q.set('dhash', px.dhash); q.set('luma', String(px.luma)); q.set('sky', String(px.sky)); q.set('pw', String(px.width)); q.set('ph', String(px.height)); }
      if (save && s.caseId) q.set('caseId', s.caseId);
      const res = await fetch(`/api/files/analyze?${q}`, { method: 'POST', headers: { 'x-plexus': '1', 'content-type': 'application/octet-stream' }, body: file });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(j.error ?? `HTTP ${res.status}`);
      setItems((a) => a.map((i) => (i.key === key ? { ...i, busy: false, report: j.report } : i)));
      if (save && s.caseId) refreshLibrary();
    } catch (e: any) { setItems((a) => a.map((i) => (i.key === key ? { ...i, busy: false, error: e?.message ?? 'Could not read that file' } : i))); }
  };
  const take = (files: FileList | File[]) => { for (const f of [...files].slice(0, 20)) void analyse(f); };
  useEffect(() => { if (s.fileLab?.files.length) take(s.fileLab.files); /* eslint-disable-next-line */ }, []);
  useEffect(() => () => items.forEach((i) => i.url && URL.revokeObjectURL(i.url)), []);  // eslint-disable-line

  const cur = items.find((i) => i.key === sel) ?? null;
  const rep = cur?.report;
  useEffect(() => { setMore(false); setPicked(new Set((rep?.entities ?? []).map((e, i) => (e.confidence !== 'low' ? i : -1)).filter((i) => i >= 0))); }, [rep?.sha256]);

  const open = async (id: string) => { const r = await api.get<{ report: FileReport }>(`/api/files/${id}`); const key = `lib:${id}`; setItems((a) => (a.some((x) => x.key === key) ? a : [{ key, name: r.report.name, report: r.report }, ...a])); setSel(key); };
  const remove = async (id: string) => { await api.del(`/api/files/${id}`); setItems((a) => a.filter((i) => i.report?.id !== id)); refreshLibrary(); };
  const addEntities = async () => {
    if (!rep || !s.caseId) return;
    const chosen = rep.entities.filter((_, i) => picked.has(i));
    if (chosen.some((e) => e.type === 'person' || e.type === 'location') && s.snap?.case && (await api.get<any>(`/api/cases/${s.caseId}`)).care?.flagged && !(await askConfirm('This may involve a young person', 'This case has signs the subject may be a minor. Adding a real name or place from a file ties them to the real world. If this is a child, stop and report to the platform or the authorities instead. Continue?', 'Add anyway'))) return;
    const r = await api.post<{ added: number }>(`/api/cases/${s.caseId}/entities-from`, { source: rep.name, entities: chosen.map((e) => ({ type: e.type, value: e.value, note: e.why })) });
    const snap = await api.get<any>(`/api/cases/${s.caseId}`); useStore.setState({ snap: { ...useStore.getState().snap!, nodes: snap.nodes, edges: snap.edges } });
    s.toast(`Added ${r.added} to the case`);
  };

  const locate = async () => {
    if (!cur?.file || !rep) return;
    const patch = (g: GeoState) => setItems((a) => a.map((i) => (i.key === cur.key ? { ...i, geo: { ...i.geo, ...g } } : i)));
    patch({ busy: true, error: undefined });
    try {
      const vs = await api.get<{ ok: boolean; why?: string; local: boolean; provider: string; model?: string }>('/api/ai/vision');
      if (!vs.ok) { patch({ busy: false, error: `${vs.why ?? 'AI is not set up'}. Add a model that can read pictures in Settings → AI.` }); return; }
      if (!vs.local && !(await askConfirm('Send this picture to your AI provider?', `The picture itself (pixels only; none of its metadata) will be sent three times to ${vs.provider} so the answers can be compared. Do not do this with a picture you are not allowed to share.`, 'Send picture'))) { patch({ busy: false }); return; }
      const image = await cleanPreview(cur.file); if (!image) { patch({ busy: false, error: 'This browser cannot open that picture, so it cannot be sent.' }); return; }
      const r = await api.post<{ result: GeoConsensus; truthErrKm?: number; calibration: Calibration }>('/api/geolocate', { image, confirmed: true, truth: rep.location ? { lat: rep.location.lat, lon: rep.location.lon } : undefined });
      patch({ busy: false, result: r.result, errKm: r.truthErrKm, cal: r.calibration });
    } catch (e: any) { patch({ busy: false, error: e?.message ?? 'The location check failed' }); }
  };

  const grouped = useMemo(() => {
    const by = new Map<FactGroup, Fact[]>();
    for (const f of rep?.facts ?? []) if (more || f.importance >= 2) by.set(f.group, [...(by.get(f.group) ?? []), f]);
    return GROUPS.filter((g) => by.has(g)).map((g) => ({ g, facts: by.get(g)! }));
  }, [rep, more]);
  const hidden = (rep?.facts ?? []).filter((f) => f.importance < 2).length;
  const linksFor = (id?: string) => library.links.filter((l) => l.a === id || l.b === id);
  const nameOf = (id: string) => library.files.find((f) => f.id === id)?.name ?? id;
  const geo = cur?.geo;

  return (
    <>
      <div className="scrim" onMouseDown={close} />
      <motion.div ref={ref} tabIndex={-1} aria-modal="true" role="dialog" aria-label="Photos and files" className="modal filelab" style={{ x: '-50%', y: '-50%' }} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
        <button className="btn icon ghost close-x" aria-label="Close photos and files" onClick={close}><X size={17} /></button>
        <div className="ml-title"><FileSearch size={18} /><h2>Photos &amp; files</h2><span className="faint">Everything a photo, video, document or program gives away</span></div>
        <div className="fl-body">
          <aside className="fl-side">
            <button className="fl-drop" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); take(e.dataTransfer.files); }}>
              <Upload size={18} /><b>Choose or drop files</b><small>Nothing leaves this Mac</small>
            </button>
            <input ref={input} type="file" multiple hidden aria-label="Choose files to analyse" onChange={(e) => { if (e.target.files) take(e.target.files); e.target.value = ''; }} />
            {s.caseId && <label className="fl-save"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Keep findings in this case</label>}
            <div className="fl-list">
              {items.map((i) => <button key={i.key} className={`fl-item ${sel === i.key ? 'on' : ''}`} onClick={() => setSel(i.key)}><span className="truncate">{i.name}</span><small>{i.busy ? 'Reading…' : i.error ? 'Could not read' : i.report ? `${i.report.flags.filter((f) => f.severity === 'warning').length || 'No'} warnings` : ''}</small></button>)}
              {library.files.filter((f) => !items.some((i) => i.report?.id === f.id)).length > 0 && <div className="fl-h">Saved in this case</div>}
              {library.files.filter((f) => !items.some((i) => i.report?.id === f.id)).map((f) => <div key={f.id} className="fl-item lib"><button className="grow truncate" onClick={() => void open(f.id!)}>{f.name}</button><button className="btn icon sm ghost" aria-label={`Remove ${f.name}`} onClick={() => void remove(f.id!)}><Trash2 size={13} /></button></div>)}
            </div>
          </aside>
          <section className="fl-main" aria-live="polite">
            {!cur && <div className="fl-empty"><FileSearch size={30} /><p>Drop a photo, video, PDF, Word or Excel file, audio, or a program.</p><p className="faint">Plexus shows where and when it was made, who by, on what, and whether it was changed, and flags anything that does not add up.</p></div>}
            {cur?.busy && <div className="fl-empty"><p>Reading {cur.name}…</p></div>}
            {cur?.error && <div className="fl-empty"><AlertTriangle size={26} /><p>{cur.error}</p></div>}
            {rep && (<>
              <div className="fl-top">
                {cur?.url && (rep.kind === 'mp4' ? <video src={cur.url} className="fl-thumb" muted preload="metadata" /> : <img src={cur.url} className="fl-thumb" alt="" />)}
                <div className="grow"><h3 className="truncate">{rep.name}</h3><p className="faint">{rep.label} · {rep.size.toLocaleString('en-US')} bytes{rep.dims ? ` · ${rep.dims.width}×${rep.dims.height}` : ''}</p>
                  <button className="fl-hash" title="Copy SHA-256" onClick={() => { void navigator.clipboard?.writeText(rep.sha256); s.toast('SHA-256 copied'); }}><Copy size={11} /> SHA-256 {rep.sha256.slice(0, 16)}…</button></div>
              </div>
              {rep.flags.length > 0 && <div className="fl-flags">{rep.flags.map((f) => <div key={f.id} className={`fl-flag ${f.severity}`}>{f.severity === 'info' ? <Info size={15} /> : <AlertTriangle size={15} />}<div><b>{f.title}</b><p>{f.detail}</p></div></div>)}</div>}
              {rep.headline.length > 0 && <div className="fl-head">{rep.headline.map((f, i) => <div key={i} className={`fl-card g-${f.group}`}><span className="fl-ico">{ICON[f.group]} {f.label}</span><b className="num">{f.value}</b>{f.note && <small>{f.note}</small>}</div>)}</div>}
              {rep.location && (
                <div className="fl-loc">
                  <div className="fsec">On the map</div>
                  <p><b className="num">{rep.location.lat.toFixed(5)}, {rep.location.lon.toFixed(5)}</b> · {rep.location.description}</p>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{rep.location.links.map((m) => <a key={m.url} className="btn sm" href={m.url} target="_blank" rel="noreferrer noopener">{m.label}</a>)}</div>
                </div>
              )}
              {isImage(rep) && cur?.file && (
                <div className="fl-geo">
                  <div className="fsec">Where does the picture itself say it was taken?</div>
                  {!geo?.result && <p className="faint">Reads signs, road markings, plants, buildings and terrain with your AI model, three independent times, and trusts the answer only as far as the readings agree. {rep.location ? 'This photo has real GPS, so Plexus will also record how close the guess was.' : ''}</p>}
                  {!geo?.result && <button className="btn" disabled={geo?.busy} onClick={() => void locate()}><Eye size={14} /> {geo?.busy ? 'Looking… (up to a minute)' : 'Work out the location from the picture'}</button>}
                  {geo?.error && <p className="dc-warn">{geo.error}</p>}
                  {geo?.result && <GeoView g={geo.result} errKm={geo.errKm} cal={geo.cal} truth={!!rep.location} onAdd={s.caseId ? async () => { const g = geo.result!; if (g.lat === undefined) return; await api.post(`/api/cases/${s.caseId}/entities-from`, { source: rep.name, entities: [{ type: 'location', value: `${g.lat.toFixed(5)}, ${g.lon!.toFixed(5)}`, note: `AI visual estimate (${LEVEL_TEXT[g.level]}, ${g.votes} of ${g.runs} readings agree), not measured` }] }); const snap = await api.get<any>(`/api/cases/${s.caseId}`); useStore.setState({ snap: { ...useStore.getState().snap!, nodes: snap.nodes, edges: snap.edges } }); s.toast('Added as an estimate'); } : undefined} />}
                  <div className="row fl-rev" style={{ flexWrap: 'wrap', gap: 6, marginTop: 10 }}><span className="faint" style={{ fontSize: 12 }}>Search for this picture elsewhere:</span>{[['Google Lens', 'https://lens.google.com/'], ['TinEye', 'https://tineye.com/'], ['Yandex Images', 'https://yandex.com/images/'], ['Bing Visual Search', 'https://www.bing.com/visualsearch']].map(([l, u]) => <a key={l} className="btn sm" href={u} target="_blank" rel="noreferrer noopener">{l}</a>)}</div>
                </div>
              )}
              {rep.times.length > 0 && (
                <div><div className="fsec">Every date in the file <span className="cnt">{rep.times.length}</span></div>
                  <ul className="fl-times">{[...rep.times].sort((a, b) => a.iso.localeCompare(b.iso)).map((t, i) => <li key={i}><span className="num">{t.iso.replace('T', ' ').replace(/\.\d+/, '')}</span><b>{t.label}</b><small>{t.source}{t.offsetMin !== undefined ? ` · UTC${t.offsetMin < 0 ? '-' : '+'}${String(Math.floor(Math.abs(t.offsetMin) / 60)).padStart(2, '0')}:${String(Math.abs(t.offsetMin) % 60).padStart(2, '0')}` : ''}</small></li>)}</ul></div>
              )}
              {grouped.map(({ g, facts }) => (
                <div key={g}><div className="fsec">{ICON[g]} {GROUP[g]}</div>
                  <dl className="fl-facts">{facts.map((f, i) => <div key={i} className={`fl-fact i${f.importance}`}><dt>{f.label}</dt><dd className={/^[\d:\- .,+°UTC]+$/.test(f.value) || f.label === 'SHA-256' ? 'num' : ''}>{f.value}{f.note && <small>{f.note}</small>}</dd></div>)}</dl></div>
              ))}
              {hidden > 0 && <button className="btn sm ghost" onClick={() => setMore(!more)}><ChevronDown size={13} style={{ transform: more ? 'rotate(180deg)' : undefined }} /> {more ? 'Hide minor details' : `Show ${hidden} minor details`}</button>}
              {rep.leaks.length > 0 && (
                <div><div className="fsec">Text hidden inside <span className="cnt">{rep.leaks.length}</span></div>
                  <ul className="fl-leaks">{rep.leaks.slice(0, 30).map((l, i) => <li key={i} className={l.kind === 'secret' ? 'bad' : ''}><span className="fl-k">{({ email: 'Email', url: 'Link', 'user-path': 'Account name', host: 'Network path', ip: 'IP address', mac: 'Hardware address', secret: 'Credential', coords: 'Coordinates' } as const)[l.kind]}</span><span className="num truncate" title={l.value}>{l.value}</span>{l.context && <small>{l.context}</small>}</li>)}</ul></div>
              )}
              {linksFor(rep.id).length > 0 && (
                <div><div className="fsec"><Link2 size={13} /> Links to other files in this case</div>
                  <ul className="fl-times">{linksFor(rep.id).map((l, i) => <li key={i}><b>{nameOf(l.a === rep.id ? l.b : l.a)}</b><span>{l.detail}</span><small>{l.strength}</small></li>)}</ul></div>
              )}
              {rep.entities.length > 0 && (
                <div className="fl-add"><div className="fsec">Things you can add to the case <span className="cnt">{rep.entities.length}</span></div>
                  {rep.entities.map((e, i) => <label key={i} className="fl-ent"><input type="checkbox" checked={picked.has(i)} onChange={(ev) => { const n = new Set(picked); ev.target.checked ? n.add(i) : n.delete(i); setPicked(n); }} aria-label={`Add ${e.value}`} /><span className="fl-k">{e.type}</span><b className="truncate">{e.value}</b><small>{e.why} · {e.confidence}</small></label>)}
                  {s.caseId ? <button className="btn" disabled={picked.size === 0} onClick={() => void addEntities()}><Plus size={14} /> Add {picked.size} to this case</button> : <p className="faint">Open or create a case to add these to a graph.</p>}
                </div>
              )}
            </>)}
          </section>
        </div>
      </motion.div>
    </>
  );
}

function GeoView({ g, errKm, cal, truth, onAdd }: { g: GeoConsensus; errKm?: number; cal?: Calibration; truth: boolean; onAdd?: () => void }) {
  const links = g.lat !== undefined ? mapLinks(g.lat, g.lon!) : [];
  return (
    <div className={`fl-georesult lvl-${g.level}`}>
      <div className="fl-glevel"><b>{LEVEL_TEXT[g.level]}</b>{g.place && <span> · {g.place}</span>}</div>
      <p>{g.summary}</p>
      {g.lat !== undefined && <p className="num">{g.lat.toFixed(4)}, {g.lon!.toFixed(4)}{g.spreadKm !== undefined ? ` · readings spread ${g.spreadKm} km` : ''}</p>}
      {g.failedRuns > 0 && <p className="faint">{g.failedRuns} of {g.runs} requests failed.</p>}
      {g.clues.length > 0 && <div><small className="faint">What it relied on</small><ul className="fl-clues">{g.clues.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
      {g.visibleText.length > 0 && <p><small className="faint">Readable text</small><br />{g.visibleText.map((t) => `“${t.text}”${t.language ? ` (${t.language})` : ''}`).join(' · ')}</p>}
      {g.alternatives.length > 0 && <p><small className="faint">{g.level === 'none' ? 'Candidates to check by hand' : 'Other readings'}</small><br />{g.alternatives.map((a) => `${a.place} (${a.votes})`).join(' · ')}</p>}
      {errKm !== undefined && <p className="fl-truth"><Sparkles size={13} /> The photo's real GPS is {errKm < 1 ? 'under 1 km' : `${errKm.toLocaleString('en-US', { maximumFractionDigits: 0 })} km`} from this estimate. That is recorded.</p>}
      {cal && cal.total > 0 && <p className="faint fl-cal">Measured on your photos with known locations ({cal.total}): {Object.entries(cal.byLevel).map(([lv, c]) => `${LEVEL_TEXT[lv].toLowerCase()} claims were right ${c.right} of ${c.n} times (median miss ${Math.round(c.medianKm).toLocaleString('en-US')} km)`).join('; ') || 'no usable answers yet'}.</p>}
      {!truth && <p className="faint">This is an estimate from the picture. Check it with the street-level and satellite views before relying on it.</p>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{links.slice(0, 5).map((m) => <a key={m.url} className="btn sm" href={m.url} target="_blank" rel="noreferrer noopener">{m.label}</a>)}{onAdd && g.level !== 'none' && <button className="btn sm" onClick={onAdd}><Plus size={13} /> Add as an estimate</button>}</div>
    </div>
  );
}
