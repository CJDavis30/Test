import { useEffect, useMemo, useState } from 'react';
import { Scale, Users } from 'lucide-react';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { EntityGlyph } from '../lib/icons';
import { fmtWhen, pctText, type IdentitiesResponse, type Profile } from '../lib/forensics';
import { describeWindow } from '@shared/forensics/bursts';
import { oneIn } from '@shared/forensics/linker';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Who is who: the accounts in this case, grouped into the people most likely to be behind them. */
export function IdentitiesView() {
  const s = useStore();
  const [data, setData] = useState<IdentitiesResponse | null>(null);
  const [v, setV] = useState(Math.log10(50));
  const accounts = (s.snap?.nodes ?? []).filter((n) => n.type === 'account' || n.type === 'username').length;
  useEffect(() => {
    if (!s.caseId) return; let live = true;
    const t = setTimeout(() => api.get<IdentitiesResponse>(`/api/cases/${s.caseId}/identities?prior=${1 / Math.round(10 ** v)}`).then((r) => { if (live) setData(r); }).catch(() => {}), 120);
    return () => { live = false; clearTimeout(t); };
  }, [s.caseId, accounts, v, s.snap?.edges.length]);
  const N = Math.round(10 ** v);
  const open = (p: Profile) => { s.setView('graph'); s.select([p.id]); window.dispatchEvent(new CustomEvent('plexus:pan', { detail: p.id })); };
  const compare = (a: Profile, b: Profile) => s.setMatchLab({ a: a.id, b: b.id });
  const multi = useMemo(() => (data?.identities ?? []).filter((i) => i.members.length > 1), [data]);
  const single = useMemo(() => (data?.identities ?? []).filter((i) => i.members.length === 1).map((i) => i.members[0]), [data]);
  const byId = useMemo(() => new Map((data?.identities ?? []).flatMap((i) => i.members).map((p) => [p.id, p])), [data]);

  return (
    <div className="view"><div className="view-inner">
      <div className="view-head"><h1>Identities</h1><span className="faint">{data ? `${data.profiles} accounts · ${multi.length} linked ${multi.length === 1 ? 'operator' : 'operators'}${single.length ? ` · ${single.length} on their own` : ''}` : ''}</span>
        <div className="grow" />
        <label className="idn-prior" title="How common it is for two accounts found together to belong to the same person, before looking at any evidence">Prior 1 in <b>{N.toLocaleString('en-US')}</b>
          <input type="range" min={0.3} max={6} step={0.05} value={v} onChange={(e) => setV(Number(e.target.value))} aria-label="Prior odds of a match" /></label>
      </div>
      {data && data.profiles < 2 && <div className="emptystate"><Users size={26} className="faint" /><h3 style={{ marginTop: 10 }}>Add a few accounts first</h3>Once the case has two or more accounts or handles (Roblox, Discord, GitHub…), Plexus works out which ones belong to the same person, and shows its working.</div>}
      {multi.map((id, i) => (
        <section className="idn-card" key={id.id} aria-label={`Operator ${LETTERS[i] ?? i + 1}`}>
          <header><span className="idn-badge">{LETTERS[i] ?? i + 1}</span><div><b>Operator {LETTERS[i] ?? i + 1}</b><div className="faint">{id.members.length} accounts · weakest link {pctText(id.weakest)}</div></div></header>
          <div className="idn-members">
            {id.members.map((p) => (
              <button key={p.id} className="idn-mem" onClick={() => open(p)}>
                <span className="gl"><EntityGlyph type="account" size={14} /></span>
                <span className="grow"><b className="truncate">{p.handle ?? p.label}</b><small>{p.platform ?? 'Account'}{p.createdAt ? ` · created ${fmtWhen(p.createdAt, p.createdPrecision)}` : ''}</small></span>
              </button>
            ))}
          </div>
          <div className="idn-links">
            {[...id.links].sort((a, b) => b.posterior - a.posterior).slice(0, 5).map((l) => { const a = byId.get(l.a), b = byId.get(l.b); if (!a || !b) return null; return (
              <div className="idn-link" key={`${l.a}${l.b}`}><span className="truncate">{a.platform ?? a.label} <b>{a.handle}</b> ↔ {b.platform ?? b.label} <b>{b.handle}</b></span><span className="num">{pctText(l.posterior)}</span><button className="btn sm" onClick={() => compare(a, b)}><Scale size={13} /> Why</button></div>
            ); })}
          </div>
        </section>
      ))}
      {data && data.lookalikes.length > 0 && (<>
        <div className="fsec">Look-alikes <span className="cnt">same name, probably not the same person</span></div>
        <div className="idn-list">{data.lookalikes.map((l) => (
          <div className="idn-look" key={`${l.a.id}${l.b.id}`}>
            <div className="idn-link"><span className="truncate">{l.a.platform} <b>{l.a.handle}</b> vs {l.b.platform} <b>{l.b.handle}</b></span><span className="num">{pctText(l.posterior)} same</span><button className="btn sm" onClick={() => compare(l.a, l.b)}><Scale size={13} /> Why</button></div>
            <ul>{l.against.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        ))}</div>
      </>)}
      {data && data.bursts.length > 0 && (<>
        <div className="fsec">Created in a burst <span className="cnt">made in one go, which is how one person makes several accounts</span></div>
        <div className="idn-list">{data.bursts.slice(0, 5).map((b) => (
          <div className="idn-link" key={b.ids.join()}><span className="truncate"><b>{b.count} accounts</b> within {describeWindow(b.window)}: {b.ids.map((id) => byId.get(id)?.handle ?? byId.get(id)?.label ?? '?').join(', ')}</span><span className="num" title={`${b.bits.toFixed(1)} bits`}>{oneIn(b.bits)}</span><span className="faint">by chance</span></div>
        ))}</div>
      </>)}
      {data && data.maybes.length > 0 && (<>
        <div className="fsec">Might be the same person <span className="cnt">needs your judgement</span></div>
        <div className="idn-list">{data.maybes.map((m) => (
          <div className="idn-link" key={`${m.a.id}${m.b.id}`}><span className="truncate">{m.a.platform} <b>{m.a.handle}</b> ↔ {m.b.platform} <b>{m.b.handle}</b></span><span className="num">{pctText(m.posterior)}</span><button className="btn sm" onClick={() => compare(m.a, m.b)}><Scale size={13} /> Why</button></div>
        ))}</div>
      </>)}
      {data && data.separated.length > 0 && (<>
        <div className="fsec">Kept apart <span className="cnt">look alike, but something says different people</span></div>
        <div className="idn-list">{data.separated.map((m) => <div className="idn-link" key={`${m.a.id}${m.b.id}`}><span className="truncate">{m.a.handle} ↔ {m.b.handle}</span><span className="faint">{m.why}</span></div>)}</div>
      </>)}
      {single.length > 0 && (<>
        <div className="fsec">On their own <span className="cnt">{single.length}</span></div>
        <div className="idn-singles">{single.map((p) => <button key={p.id} className="idn-chip" onClick={() => open(p)}><EntityGlyph type="account" size={13} /><span className="truncate">{p.platform ? `${p.platform} · ` : ''}{p.handle ?? p.label}</span></button>)}</div>
      </>)}
    </div></div>
  );
}
