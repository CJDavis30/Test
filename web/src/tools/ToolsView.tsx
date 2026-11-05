import { useMemo, useState } from 'react';
import { ArrowLeft, Search as SearchIcon, Sparkles } from 'lucide-react';
import { useStore } from '../lib/store';
import { TOOLS, GROUPS, toolById, type Tool } from './registry';
import { ErrorBoundary } from '../components/ErrorBoundary';

function Card({ t, onPick }: { t: Tool; onPick: (t: Tool) => void }) {
  return (
    <button className="tool-card" onClick={() => onPick(t)} aria-label={t.name}>
      <span className="tool-ic">{t.icon}</span>
      <span className="tool-body">
        <span className="tool-name">{t.name}{t.badge === 'new' && <em className="tool-new">New</em>}</span>
        <span className="tool-blurb">{t.blurb}</span>
        {(t.needs || t.open) && <span className="tool-meta">{t.needs === 'AI' ? 'Needs AI (Settings)' : t.needs === 'internet' ? 'Uses the internet' : t.open ? 'Opens a window' : ''}</span>}
      </span>
    </button>
  );
}

/** The Tools tab: small, sharp instruments that work with or without a case. Each opens in place. */
export function ToolsView() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>('all');
  const active = s.tool ? toolById(s.tool) : undefined;
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return TOOLS.filter((t) => (group === 'all' || t.group === group) && words.every((w) => `${t.name} ${t.blurb} ${t.keywords} ${t.group}`.toLowerCase().includes(w)));
  }, [q, group]);
  const pick = (t: Tool) => { if (t.open) t.open(); else s.setTool(t.id); };

  if (active?.Panel) {
    const P = active.Panel;
    return (
      <div className="view tools">
        <div className="view-inner tool-inner">
          <button className="btn ghost sm tool-back" onClick={() => s.setTool(null)}><ArrowLeft size={14} /> All tools</button>
          <div className="tool-head"><span className="tool-ic big">{active.icon}</span><div><h1>{active.name}</h1><p>{active.blurb}</p></div></div>
          <ErrorBoundary key={active.id}><P /></ErrorBoundary>
        </div>
      </div>
    );
  }
  return (
    <div className="view tools">
      <div className="view-inner">
        <div className="view-head"><h1>Tools</h1><span className="faint">{TOOLS.length} tools. They work with or without a case; anything they find can be added to yours.</span></div>
        <div className="filters">
          <div className="search" style={{ width: 260 }}><SearchIcon size={14} /><input aria-label="Search tools" placeholder="Search tools: shadow, email, domain…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="fchip" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>All <span className="n">{TOOLS.length}</span></button>
          {GROUPS.map((g) => <button key={g} className="fchip" aria-pressed={group === g} onClick={() => setGroup(g)}>{g} <span className="n">{TOOLS.filter((t) => t.group === g).length}</span></button>)}
        </div>
        {GROUPS.map((g) => {
          const items = list.filter((t) => t.group === g);
          if (!items.length) return null;
          return <section key={g} className="tool-group"><h2>{g}</h2><div className="tool-grid">{items.map((t) => <Card key={t.id} t={t} onPick={pick} />)}</div></section>;
        })}
        {!list.length && <div className="tool-empty"><Sparkles size={18} /> No tool matches “{q}”. Try a broader word, like “photo”, “email” or “time”.</div>}
      </div>
    </div>
  );
}
