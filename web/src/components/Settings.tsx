import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Sliders, KeyRound, Cpu, ScrollText, Check, ArrowUp, ArrowDown, LoaderCircle, Trash2, Download, Search } from 'lucide-react';
import { ENTITY_LABEL, type AuditEntry, type SourceInfo } from '@shared/types';
import { useStore, type SettingsTab } from '../lib/store';
import { api } from '../lib/api';
import { EntityGlyph } from '../lib/icons';
import { Switch, download } from './ui';

const REGIONS = ['US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'IN', 'BR', 'MX', 'JP', 'KR', 'SG', 'ZA', 'AE'];
const CAP_LABEL: Record<string, string> = {
  derive: 'Derived from the input', dns: 'DNS records', registration: 'Registration (RDAP/WHOIS)', subdomains: 'Subdomains & certificates', 'passive-dns': 'Passive DNS', 'web-history': 'Web history',
  'ip-intel': 'IP intelligence', geoip: 'IP geolocation', 'email-profile': 'Email profiles', 'email-reputation': 'Email reputation', breaches: 'Data breaches', 'code-profile': 'Developer & social profiles',
  'username-sweep': 'Username sweep', 'phone-intel': 'Phone numbers', 'org-registry': 'Company registries', 'public-figure': 'Public figures', chain: 'Blockchain', 'domain-emails': 'Domain emails', demo: 'Demo',
};
const FALLBACK = new Set(['dns', 'registration', 'subdomains', 'passive-dns', 'web-history', 'ip-intel', 'geoip', 'email-reputation', 'breaches', 'domain-emails']);

export function Settings() {
  const s = useStore();
  const tab = s.settingsOpen!;
  const nav: [SettingsTab, string, typeof Sliders][] = [['general', 'General', Sliders], ['sources', 'Sources', KeyRound], ['ai', 'AI', Cpu], ['audit', 'Audit log', ScrollText]];
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') s.openSettings(null); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <>
      <div className="scrim" onMouseDown={() => s.openSettings(null)} />
      <motion.div className="settings" role="dialog" aria-label="Settings" style={{ x: '-50%', y: '-50%' }} initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 460, damping: 36 }}>
        <nav>
          <h3>Settings</h3>
          {nav.map(([id, label, I]) => <button key={id} className="side-item" aria-current={tab === id} onClick={() => s.openSettings(id)}><I size={16} strokeWidth={1.75} /> {label}</button>)}
        </nav>
        <div className="pane">
          <button className="btn icon ghost close" aria-label="Close settings" onClick={() => s.openSettings(null)}><X size={17} /></button>
          {tab === 'general' && <General />}
          {tab === 'sources' && <Sources />}
          {tab === 'ai' && <AI />}
          {tab === 'audit' && <Audit />}
        </div>
      </motion.div>
    </>
  );
}

function General() {
  const s = useStore();
  const st = s.settings!;
  const set = async (b: object) => { await api.put('/api/settings', b); await Promise.all([s.refreshSettings(), s.refreshSources()]); };
  return (
    <>
      <h2>General</h2><p className="lead">Plexus keeps everything on this Mac: cases, findings and your API keys.</p>
      <div className="setrow"><div className="grow"><div className="t">Appearance</div></div>
        <div className="seg">{(['auto', 'light', 'dark'] as const).map((t) => <button key={t} aria-pressed={s.theme === t} onClick={() => s.setTheme(t)}>{t === 'auto' ? 'System' : t[0].toUpperCase() + t.slice(1)}</button>)}</div></div>
      <div className="setrow"><div className="grow"><div className="t">Demo data</div><div className="d">Use simulated sources and fictional people (all on reserved .example domains). Nothing is sent over the network. Great for learning the app.</div></div>
        <Switch on={st.demoMode} label="Demo data" onChange={(v) => void set({ demoMode: v }).then(() => s.toast(v ? 'Using demo data' : 'Using live sources'))} /></div>
      <div className="setrow"><div className="grow"><div className="t">Phone number region</div><div className="d">Used to interpret numbers typed without a country code.</div></div>
        <select value={st.region} onChange={(e) => void set({ region: e.target.value })} aria-label="Region">{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
      <div className="setrow"><div className="grow"><div className="t">Lookup cache</div><div className="d">Source responses are cached for a few hours so repeat lookups are instant and polite to free APIs.</div></div>
        <button className="btn" onClick={async () => { await api.post('/api/cache/clear'); s.toast('Cache cleared'); }}>Clear cache</button></div>
      <div className="setrow"><div className="grow"><div className="t">Responsible use</div><div className="d">Plexus is for lawful, authorized research. A name match is a lead, not proof. Every lookup is written to the case's audit log, and exports can be redacted.</div></div></div>
    </>
  );
}

function Sources() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'ready' | 'key'>('all');
  const list = s.sources.filter((x) => !q || `${x.name} ${x.description}`.toLowerCase().includes(q.toLowerCase())).filter((x) => only === 'all' || (only === 'key' ? x.requiresKey && !x.keySet : !(x.requiresKey && !x.keyOptional && !x.keySet)));
  const groups = useMemo(() => { const m = new Map<string, SourceInfo[]>(); for (const x of list) (m.get(x.capability) ?? m.set(x.capability, []).get(x.capability)!).push(x); return [...m.entries()]; }, [list]);
  const ready = s.sources.filter((x) => x.enabled && !(x.requiresKey && !x.keyOptional && !x.keySet)).length;
  return (
    <>
      <h2>Sources</h2>
      <p className="lead">{s.settings?.demoMode ? 'Demo mode is on, so only simulated sources run. Turn it off in General to use real ones.' : `${ready} of ${s.sources.length} sources ready. Where several sources answer the same question, Plexus tries them in order and falls back to the next if one fails, is empty or rate-limited.`}</p>
      <div className="filters">
        {([['all', 'All'], ['ready', 'Ready'], ['key', 'Needs key']] as const).map(([id, l]) => <button key={id} className="fchip" aria-pressed={only === id} onClick={() => setOnly(id)}>{l}</button>)}
        <label className="search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter sources" aria-label="Filter sources" /></label>
      </div>
      {groups.map(([cap, items]) => (
        <section key={cap}>
          <div className="cap">{CAP_LABEL[cap] ?? cap}{FALLBACK.has(cap) && items.length > 1 && <span className="chain faint">· fallback order</span>}</div>
          {items.map((x, i) => <SourceRow key={x.id} x={x} first={i === 0} last={i === items.length - 1} siblings={items} />)}
        </section>
      ))}
      {groups.length === 0 && <div className="empty-note">No sources match.</div>}
    </>
  );
}

function SourceRow({ x, first, last, siblings }: { x: SourceInfo; first: boolean; last: boolean; siblings: SourceInfo[] }) {
  const s = useStore();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const keyed = !!x.requiresKey;
  const needs = keyed && !x.keyOptional && !x.keySet;
  const move = async (dir: -1 | 1) => {
    const idx = siblings.findIndex((y) => y.id === x.id), other = siblings[idx + dir];
    if (!other) return;
    const px = idx + 1, po = idx + dir + 1; // position-based priorities keep ordering stable
    await Promise.all([api.patch(`/api/sources/${x.id}`, { priority: po * 10 }), api.patch(`/api/sources/${other.id}`, { priority: px * 10 })]);
    await s.refreshSources();
  };
  const test = async () => {
    setBusy(true); setRes(null);
    const r = await api.post<{ ok: boolean; ms: number; count?: number; sample?: string[]; error?: string }>(`/api/sources/${x.id}/test`);
    setBusy(false); setRes({ ok: r.ok, text: r.ok ? `Works · ${r.count} result${r.count === 1 ? '' : 's'} in ${r.ms}ms` : r.error ?? 'Failed' });
    void s.refreshSources();
  };
  const saveKey = async () => { await api.put(`/api/secrets/${x.id}`, { value: key }); setKey(''); await s.refreshSources(); s.toast('Key saved'); };
  const health = x.health.lastError ? 'bad' : x.health.ok > 0 ? 'ok' : '';
  return (
    <div className="src" style={{ opacity: x.enabled ? 1 : .55 }}>
      <Switch on={x.enabled} label={`Enable ${x.name}`} onChange={async (v) => { await api.patch(`/api/sources/${x.id}`, { enabled: v }); await s.refreshSources(); }} />
      <div style={{ minWidth: 0 }}>
        <div className="nm"><span className={`health ${health}`} title={x.health.lastError ?? (x.health.ok ? `${x.health.ok} successful calls` : 'Not used yet')} />{x.name}
          {needs && <span className="tag mute" style={{ marginLeft: 2 }}>Needs key</span>}{x.keyOptional && !x.keySet && <span className="tag mute">Key optional</span>}</div>
        <div className="ds">{x.description}</div>
      </div>
      <div className="row" style={{ gap: 4 }}>
        {siblings.length > 1 && !x.demo && <><button className="btn icon sm ghost" aria-label="Try earlier" disabled={first} onClick={() => void move(-1)}><ArrowUp size={13} /></button><button className="btn icon sm ghost" aria-label="Try later" disabled={last} onClick={() => void move(1)}><ArrowDown size={13} /></button></>}
        <button className="btn sm" onClick={() => void test()} disabled={busy || needs}>{busy ? <LoaderCircle size={13} className="spin" /> : 'Test'}</button>
      </div>
      <div className="sub">
        <span className="faint" style={{ fontSize: 12 }}>For {x.accepts.map((t) => ENTITY_LABEL[t].toLowerCase()).join(', ')}</span>
        {keyed && (x.keySet ? (
          <span className="row" style={{ gap: 6 }}><span className="tag mute"><Check size={10} /> Key saved</span><button className="btn sm ghost" onClick={async () => { await api.put(`/api/secrets/${x.id}`, { value: null }); await s.refreshSources(); }}><Trash2 size={12} /> Remove</button></span>
        ) : (
          <span className="keyrow"><input className="field" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="API key" autoComplete="off" aria-label={`${x.name} API key`} onKeyDown={(e) => e.key === 'Enter' && key && void saveKey()} /><button className="btn sm" disabled={!key} onClick={() => void saveKey()}>Save</button>{x.keyHelp && <span className="faint" style={{ fontSize: 12 }}>{x.keyHelp}</span>}</span>
        ))}
        {x.decisions > 0 && <span className="faint" style={{ fontSize: 12 }} title="Trust is learned from your accept / reject decisions on this source's findings">Trust {Math.round(x.trust * 100)}% · learned from {x.decisions} decision{x.decisions === 1 ? '' : 's'}{x.trust < x.reliability - 0.03 ? ' ↓' : x.trust > x.reliability + 0.03 ? ' ↑' : ''}</span>}
        {res && <span className={`testres ${res.ok ? 'ok' : 'bad'}`}>{res.text}</span>}
      </div>
    </div>
  );
}

const PROVIDERS = [
  ['none', 'Off — rules only', 'Everything still works. Briefs are written by deterministic rules.'],
  ['openrouter', 'OpenRouter', 'One key, hundreds of models. Auto picks a strong model for each request.'],
  ['google', 'Google AI Studio', 'Gemini models through Google’s OpenAI-compatible endpoint.'],
  ['openai', 'OpenAI', ''],
  ['ollama', 'Ollama (local)', 'Runs on this Mac. Nothing leaves your machine.'],
  ['custom', 'Custom (OpenAI-compatible)', 'Any server that speaks the chat completions API.'],
] as const;

function AI() {
  const s = useStore();
  const ai = s.settings!.ai;
  const [key, setKey] = useState('');
  const [models, setModels] = useState<{ id: string; name: string; context?: number; promptPrice?: number }[]>([]);
  const [mq, setMq] = useState('');
  const [loading, setLoading] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const set = async (patch: object) => { await api.put('/api/settings', { ai: patch }); await s.refreshSettings(); };
  const filtered = models.filter((m) => !mq || m.id.toLowerCase().includes(mq.toLowerCase())).slice(0, 200);
  const loadModels = async () => { setLoading(true); const r = await api.get<{ models: typeof models; error?: string }>('/api/ai/models'); setLoading(false); setModels(r.models); if (r.error) s.toast(`Couldn't load models: ${r.error}`); };
  const p = PROVIDERS.find((x) => x[0] === ai.provider)!;
  return (
    <>
      <h2>AI</h2>
      <p className="lead">AI never invents facts here. It only reads findings your sources returned, must cite them, and any claim without a valid citation is discarded before you see it.</p>
      <div className="setrow"><div className="grow"><div className="t">Provider</div><div className="d">{p[2]}</div></div>
        <select value={ai.provider} onChange={(e) => void set({ provider: e.target.value, model: '' })} aria-label="Provider">{PROVIDERS.map((x) => <option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></div>
      {ai.provider !== 'none' && (<>
        {ai.provider === 'custom' && <div className="setrow"><div className="grow"><div className="t">Base URL</div><div className="d">e.g. http://127.0.0.1:1234/v1</div></div><input className="field" style={{ width: 260 }} defaultValue={ai.baseUrl ?? ''} onBlur={(e) => void set({ baseUrl: e.target.value.trim() })} aria-label="Base URL" /></div>}
        {ai.provider !== 'ollama' && <div className="setrow"><div className="grow"><div className="t">API key</div><div className="d">Stored in a private file on this Mac, never in your case data or exports.</div></div>
          {ai.keySet ? <span className="row"><span className="tag mute"><Check size={10} /> Saved</span><button className="btn sm ghost" onClick={async () => { await api.put('/api/secrets/ai', { value: null }); await s.refreshSettings(); }}>Remove</button></span>
            : <span className="keyrow"><input className="field" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste key" autoComplete="off" aria-label="AI API key" /><button className="btn sm" disabled={!key} onClick={async () => { await api.put('/api/secrets/ai', { value: key }); setKey(''); await s.refreshSettings(); }}>Save</button></span>}</div>}
        <div className="setrow" style={{ alignItems: 'flex-start' }}>
          <div className="grow"><div className="t">Model</div><div className="d">{ai.model ? <>Using <span className="mono">{ai.model}</span></> : 'Automatic — the provider default for this key. Override any time.'}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" aria-pressed={!ai.model} onClick={() => void set({ model: '' })}>{!ai.model && <Check size={12} />} Auto</button>
              <button className="btn sm" onClick={() => void loadModels()} disabled={loading}>{loading ? <LoaderCircle size={12} className="spin" /> : null} {models.length ? 'Reload models' : 'Choose a model…'}</button>
            </div>
            {models.length > 0 && (<>
              <input className="field" style={{ marginTop: 8 }} value={mq} onChange={(e) => setMq(e.target.value)} placeholder={`Search ${models.length} models`} aria-label="Search models" />
              <div className="modelist" role="listbox">{filtered.map((m) => (
                <button key={m.id} role="option" aria-selected={ai.model === m.id} className="model" onClick={() => void set({ model: m.id })}>
                  <span className="mono truncate grow">{m.id}</span>{m.context && <span className="faint num">{Math.round(m.context / 1000)}k</span>}{m.promptPrice !== undefined && <span className="faint num">${m.promptPrice.toFixed(2)}/M</span>}{ai.model === m.id && <Check size={13} />}
                </button>))}</div></>)}
          </div>
        </div>
        {ai.provider !== 'ollama' && ai.provider !== 'custom' && <div className="setrow"><div className="grow"><div className="t">Allow cloud models</div><div className="d">Turn off to keep every lookup entirely local. AI features then pause unless you use Ollama.</div></div><Switch on={ai.allowCloud} label="Allow cloud" onChange={(v) => void set({ allowCloud: v })} /></div>}
        <div className="setrow"><div className="grow"><div className="t">Test connection</div>{test && <div className={`d testres ${test.ok ? 'ok' : 'bad'}`}>{test.text}</div>}</div>
          <button className="btn" onClick={async () => { setTest(null); const r = await api.post<{ ok: boolean; model?: string; error?: string }>('/api/ai/test'); setTest({ ok: r.ok, text: r.ok ? `Connected · ${r.model}` : r.error ?? 'Failed' }); }}>Test</button></div>
      </>)}
    </>
  );
}

function Audit() {
  const s = useStore();
  const [rows, setRows] = useState<AuditEntry[]>([]);
  useEffect(() => { if (s.caseId) api.get<{ audit: AuditEntry[] }>(`/api/cases/${s.caseId}/audit`).then((r) => setRows(r.audit)); }, [s.caseId]);
  return (
    <>
      <h2>Audit log</h2>
      <p className="lead">Every lookup, decision and export for “{s.snap?.case.name ?? 'this case'}”, newest first.</p>
      <div className="row" style={{ marginBottom: 12 }}><button className="btn sm" onClick={() => download('audit.csv', 'time,action,detail\n' + rows.map((r) => `${new Date(r.ts).toISOString()},${r.action},"${r.detail.replace(/"/g, '""')}"`).join('\n'), 'text/csv')} disabled={!rows.length}><Download size={13} /> Export CSV</button></div>
      {rows.length === 0 ? <div className="empty-note">No activity yet.</div> : (
        <table className="audit selectable"><tbody>{rows.map((r) => <tr key={r.id}><td className="num">{new Date(r.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</td><td>{r.action}</td><td>{r.detail}</td></tr>)}</tbody></table>
      )}
    </>
  );
}
