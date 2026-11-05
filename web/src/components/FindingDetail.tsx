import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleCheck, CircleHelp, CircleX, ExternalLink, Minus, TriangleAlert, X } from 'lucide-react';
import { ENTITY_LABEL, type EntityType, type Evidence, type Finding, type GraphEdge, type GraphNode } from '@shared/types';
import { confidenceSentence, evidenceStrength, explainRelation, hedge, warningsFor } from '@shared/explain';
import { safeHttpUrl } from '@shared/normalize';
import { useStore } from '../lib/store';
import { EntityGlyph } from '../lib/icons';
import { ago, displayValue, fmtDate, hostOf } from '../lib/format';
import { Dots, Kbd } from './ui';

export interface Subject { type: EntityType; label: string }

const initialOf = (n: string) => n.trim()[0]?.toUpperCase() ?? '?';
const nice = (r: string) => r.replace(/[-_]/g, ' ');

/** The chain of lookups that led to this one: start → … → the thing you looked up. Follows accepted findings back up the graph. */
function lineage(subjectId: string, nodes: GraphNode[], edges: GraphEdge[]): { node: GraphNode; via?: string }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: { node: GraphNode; via?: string }[] = [];
  const seen = new Set<string>();
  let cur = byId.get(subjectId);
  while (cur && !seen.has(cur.id) && chain.length < 5) {
    seen.add(cur.id);
    const parent = edges.filter((e) => e.to === cur!.id && e.kind === 'evidenced' && byId.has(e.from) && !seen.has(e.from)).sort((a, b) => b.strength - a.strength)[0];
    chain.unshift({ node: cur, via: parent?.label });
    cur = parent ? byId.get(parent.from) : undefined;
  }
  return chain;
}

/** What you entered → (how it led here) → what was found, left to right. Wraps on narrow screens. */
export function ConnectionPath({ subject, f, subjectId }: { subject: Subject; f: Finding; subjectId?: string }) {
  const snap = useStore((s) => s.snap);
  const chain = subjectId && snap ? lineage(subjectId, snap.nodes, snap.edges) : [];
  const steps = chain.length > 1 ? chain : [{ node: { type: subject.type, label: subject.label } as GraphNode, via: undefined as string | undefined }];
  return (
    <div className="chain" role="group" aria-label="Connection">
      {steps.map((st, i) => (
        <span key={i} className="chain-part">
          {i > 0 && <Hop label={steps[i].via ?? 'led to'} />}
          <span className="cnode" title={st.node.label}>
            <small>{i === 0 && steps.length > 1 ? 'Started from' : i === steps.length - 1 ? 'You searched' : 'Then'}</small>
            <span className="cv"><EntityGlyph type={st.node.type} size={13} /><span className="truncate">{st.node.label}</span></span>
          </span>
        </span>
      ))}
      <span className="chain-part">
        <Hop label={nice(f.relation)} />
        <span className="cnode found" title={f.value}>
          <small>Found</small>
          <span className="cv"><EntityGlyph type={f.type} size={13} /><span className="truncate">{displayValue(f)}</span></span>
        </span>
      </span>
    </div>
  );
}
const Hop = ({ label }: { label: string }) => <span className="hop"><span className="hop-l">{label}</span><span className="hop-line" /></span>;

const OFFLINE = new Set(['derive', 'phone-offline']);
type SourceInfo = { description: string; trust: number; decisions: number; homepage?: string };

/** Evidence in two groups, each source a compact row that opens to show exactly what was asked and what came back. */
export function SourceCards({ f, defaultOpen = 'first' }: { f: Finding; defaultOpen?: 'first' | 'none' | 'all' }) {
  const sources = useStore((s) => s.sources);
  const byWeight = (a: Evidence, b: Evidence) => b.weight - a.weight;
  const direct = f.evidence.filter((e) => e.kind !== 'cross').sort(byWeight);
  const cross = f.evidence.filter((e) => e.kind === 'cross').sort((a, b) => Number(b.polarity !== 'against') - Number(a.polarity !== 'against') || byWeight(a, b));
  const ok = cross.filter((e) => e.polarity !== 'against').length, bad = cross.length - ok;
  const ordered = [...direct, ...cross];
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen === 'all' ? ordered.map((e) => e.id) : defaultOpen === 'first' && ordered[0] ? [ordered[0].id] : []));
  const allOpen = ordered.length > 0 && ordered.every((e) => open.has(e.id));
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });
  const info = (e: Evidence) => sources.find((x) => x.id === e.adapter);
  const group = (list: Evidence[]) => <div className="scards">{list.map((e) => <SourceRow key={e.id} e={e} info={info(e)} open={open.has(e.id)} onToggle={() => toggle(e.id)} />)}</div>;
  return (
    <>
      <div className="fsec">
        Evidence <span className="cnt">{ordered.length}</span>
        <button className="linkish" onClick={() => setOpen(allOpen ? new Set() : new Set(ordered.map((e) => e.id)))}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
      </div>
      {direct.length > 0 && (<>
        <div className="fsub">Found directly <span className="cnt">{direct.length} {direct.length === 1 ? 'source' : 'sources'}</span></div>
        {group(direct)}
      </>)}
      {cross.length > 0 && (<>
        <div className="fsub">Cross-checks <span className="cnt">{ok > 0 && <span className="okc">{ok} confirm</span>}{ok > 0 && bad > 0 && ' · '}{bad > 0 && <span className="badc">{bad} contradict</span>}</span></div>
        {group(cross)}
      </>)}
    </>
  );
}

function SourceRow({ e, info, open, onToggle }: { e: Evidence; info?: SourceInfo; open: boolean; onToggle: () => void }) {
  const st = evidenceStrength(e.weight, info?.trust ?? 1);
  const url = safeHttpUrl(e.url);
  const about = info?.description?.replace(/\s*\(Simulated, fictional data\.?\)\s*$/i, '');
  const against = e.polarity === 'against';
  const cross = e.kind === 'cross';
  const facts = e.record?.facts ?? [];
  const home = safeHttpUrl(info?.homepage);
  return (
    <div className={`scard selectable ${cross ? (against ? 'bad' : 'ok') : ''} ${open ? 'open' : ''}`}>
      <button className="shead" aria-expanded={open} onClick={onToggle} title={about}>
        {open ? <ChevronDown size={14} className="chev" /> : <ChevronRight size={14} className="chev" />}
        <span className="sic" aria-hidden>{initialOf(e.adapterName)}</span>
        <span className="sbody">
          <span className="sname truncate">{e.adapterName}</span>
          {!open && <span className="sline truncate">{cross && e.verdict ? e.verdict : e.snippet ?? 'A match, with no extra detail.'}</span>}
        </span>
        {cross && (against ? <CircleX size={15} className="vbad" aria-label="Contradicts" /> : <CircleCheck size={15} className="vok" aria-label="Confirms" />)}
        <span className="sstr" title={`${st.label}: the source's claim strength combined with how much Plexus trusts it${info ? ` (${Math.round(info.trust * 100)}%${info.decisions ? `, learned from your ${info.decisions} decisions` : ''})` : ''}.`}><Dots level={st.level} /></span>
      </button>
      {open && (
        <div className="sopen">
          {cross && e.verdict && <div className={`sverdict ${against ? 'bad' : 'ok'}`}>{against ? <CircleX size={14} /> : <CircleCheck size={14} />}<span>{e.verdict}</span></div>}
          <dl className="strail">
            {e.how && <><dt>Asked</dt><dd>{e.how}</dd></>}
            {e.snippet && <><dt>Found</dt><dd className="quote">{e.snippet}</dd></>}
            {!e.snippet && facts.length === 0 && <><dt>Found</dt><dd className="quote">A match, with no extra detail.</dd></>}
            {url
              ? <><dt>Check</dt><dd><a href={url} target="_blank" rel="noreferrer noopener" title={url}>{e.urlKind === 'record' ? 'Open the record' : 'Repeat this lookup'} · {hostOf(url)} <ExternalLink size={11} style={{ verticalAlign: -1 }} /></a></dd></>
              : <><dt>Check</dt><dd className="faint">{OFFLINE.has(e.adapter) ? 'Worked out on this Mac. Nothing to open.' : 'This source gave no page to link to.'}</dd></>}
          </dl>
          {facts.length > 0 && (
            <div className="srecord">
              <div className="rtitle">{e.record!.title}</div>
              <table><tbody>{facts.slice(0, 8).map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
            </div>
          )}
          <div className="smeta2">
            {e.via ? <>Checked because “{e.via.label}” was found for this lookup · {ago(e.retrievedAt)}</> : <>Checked {ago(e.retrievedAt)}</>}
            <span className="sdot">·</span><span>{st.label}</span>
            {e.hash && <span className="sdot">·</span>}{e.hash && <span className="fp" title={`SHA-256 of what Plexus recorded for this observation:\n${e.hash}\nRe-checked under Settings → Audit log.`}>Fingerprint {e.hash.slice(0, 10)}</span>}
            {home && <a className="shome" href={home} target="_blank" rel="noreferrer noopener" title={`About ${e.adapterName}`}>About this source <ExternalLink size={10} style={{ verticalAlign: -1 }} /></a>}
          </div>
        </div>
      )}
    </div>
  );
}

/** How the number was reached, as a few short chips. */
function ScoreChips({ f }: { f: Finding }) {
  const direct = new Set(f.evidence.filter((e) => e.kind !== 'cross' && e.polarity !== 'against').map((e) => e.family)).size;
  const confirm = f.evidence.filter((e) => e.kind === 'cross' && e.polarity !== 'against');
  const against = f.evidence.filter((e) => e.polarity === 'against');
  const quiet = (f.checks ?? []).filter((c) => c.result === 'neutral' || c.result === 'failed');
  const names = (l: Evidence[]) => [...new Set(l.map((e) => e.adapterName))].join(', ');
  return (
    <div className="chips2">
      <span className="chip2 y" title="Independent sources that returned this directly"><Check size={12} /> Found by {direct} {direct === 1 ? 'source' : 'sources'}</span>
      {confirm.length > 0 && <span className="chip2 y" title={names(confirm)}><Check size={12} /> {confirm.length} {confirm.length === 1 ? 'check confirms' : 'checks confirm'}</span>}
      {against.length > 0 && <span className="chip2 n" title={names(against)}><X size={12} /> {against.length} {against.length === 1 ? 'check contradicts' : 'checks contradict'}</span>}
      {quiet.length > 0 && <span className="chip2 z" title={quiet.map((c) => `${c.source}${c.result === 'failed' ? ' (unreachable)' : ''}`).join(', ')}><Minus size={12} /> {quiet.length} no answer</span>}
    </div>
  );
}

const VERDICT: Record<string, string> = { solid: 'Solid', sturdy: 'Sturdy', fragile: 'Fragile', single: 'One source', thin: 'Thin' };

/** "What if one source is wrong?" Each independent source is removed in turn and the finding re-scored. */
function StressCard({ f }: { f: Finding }) {
  const s = useStore((st) => st.stress[f.id]);
  if (!s || s.verdict === 'thin') return null;
  const shown = s.drops.slice(0, 4);
  return (
    <div className={`stress ${s.verdict}`}>
      <div className="st-head"><b>Stress test</b><span className={`st-pill ${s.verdict}`}>{VERDICT[s.verdict]}</span></div>
      <p>{s.headline}</p>
      {s.ledger && s.ledger.sources > 0 && <p className="st-ledger" title={s.ledger.rows.map((r) => `${r.name}: ${r.bits.toFixed(1)} bits`).join('\n')}>For this to be false, every source would have to be wrong at once: about <b>1 in {s.ledger.allWrongOneIn >= 1000 ? Math.round(s.ledger.allWrongOneIn).toLocaleString('en-US') : s.ledger.allWrongOneIn.toFixed(s.ledger.allWrongOneIn < 10 ? 1 : 0)}</b> <span className="faint">({s.ledger.total.toFixed(1)} bits)</span>.</p>}
      {s.verdict !== 'single' && shown.length > 0 && (
        <div className="st-rows" role="list" aria-label="What the confidence becomes if one source is wrong">
          <div className="st-cap"><span>If this source is wrong…</span><span>…it becomes</span></div>
          {shown.map((d) => (
            <div className="st-row" role="listitem" key={d.family} title={`${d.name}: ${Math.round(s.base * 100)}% → ${Math.round(d.after * 100)}%`}>
              <span className="st-name truncate">{d.name}</span>
              <span className="st-bar"><i className="base" style={{ width: `${s.base * 100}%` }} /><i className="after" style={{ width: `${d.after * 100}%` }} /></span>
              <span className="st-val num">{Math.round(d.after * 100)}%</span>
            </div>
          ))}
        </div>
      )}
      {s.ifContradictionWrong !== undefined && <p className="st-up">If the contradicting check is wrong, this would be <b>{Math.round(s.ifContradictionWrong * 100)}%</b>.</p>}
    </div>
  );
}

/** Sources that could check this finding further but are switched off or need a key. Tells you what a key would buy you. */
function MoreChecks({ f }: { f: Finding }) {
  const sources = useStore((s) => s.sources);
  const openSettings = useStore((s) => s.openSettings);
  if (f.level >= 4) return null;
  const used = new Set(f.evidence.map((e) => e.adapter));
  const idle = sources.filter((x) => x.accepts.includes(f.type) && !used.has(x.id) && ((x.requiresKey && !x.keyOptional && !x.keySet) || !x.enabled));
  if (idle.length === 0) return null;
  return (
    <div className="morechecks">
      <b>More ways to check this</b>
      <span>{idle.slice(0, 4).map((x) => x.name).join(', ')}{idle.length > 4 ? ` and ${idle.length - 4} more` : ''} {idle.length === 1 ? 'is' : 'are'} switched off or need{idle.length === 1 ? 's' : ''} an API key.</span>
      <button className="linkish" onClick={() => openSettings('sources')}>Open sources</button>
    </div>
  );
}

/** Everything someone needs to approve or reject a finding. The decision bar stays pinned at the bottom while the evidence scrolls. */
export function FindingDetail({ f, subject, onDecide }: { f: Finding; subject: Subject; onDecide?: (s: 'accepted' | 'rejected' | 'unsure') => void }) {
  const all = useStore((s) => s.findings);
  const independent = new Set(f.evidence.filter((e) => e.polarity !== 'against').map((e) => e.family)).size;
  const rivals = (f.conflictsWith ?? []).map((id) => all[id]).filter(Boolean);
  const warns = warningsFor(f);
  const quiet = (f.checks ?? []).filter((c) => c.result === 'neutral' || c.result === 'failed');
  const R = 21, C = 2 * Math.PI * R;
  return (
    <div className="fdetail">
      <div className="fscroll">
        <div className="fhead">
          <span className="fic"><EntityGlyph type={f.type} size={18} /></span>
          <div className="fhead-t">
            <div className="fvalue selectable">{displayValue(f)}</div>
            <div className="ftype">{ENTITY_LABEL[f.type]}{f.when ? ` · from ${fmtDate(f.when)}` : ''}</div>
          </div>
          <div className="fscore" title="An estimate from how many independent sources agree, how much each is trusted, and what cross-checks found. Not a guarantee.">
            <svg viewBox="0 0 50 50" width="50" height="50" aria-hidden>
              <circle cx="25" cy="25" r={R} fill="none" stroke="var(--line)" strokeWidth="3" />
              <circle cx="25" cy="25" r={R} fill="none" stroke={`var(--lvl${f.level})`} strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - f.score)} transform="rotate(-90 25 25)" />
            </svg>
            <b className="num" style={{ color: `var(--lvl${f.level})` }}>{Math.round(f.score * 100)}%</b>
          </div>
        </div>

        <p className="fsentence">{confidenceSentence(f.level, independent)}</p>
        <ScoreChips f={f} />
        <StressCard f={f} />
        {quiet.length > 0 && <div className="fquiet">Also asked, no answer either way: {quiet.map((c) => `${c.source}${c.result === 'failed' ? ' (unreachable)' : ''}`).join(', ')}.</div>}

        {(warns.length > 0 || rivals.length > 0) && (
          <div className="fwatch">
            {warns.map((w) => <div key={w} className="w"><TriangleAlert size={13} />{w}</div>)}
            {rivals.length > 0 && <div className="w"><TriangleAlert size={13} />Sources disagree. Pick the answer you trust:</div>}
            {rivals.length > 0 && (
              <div className="rivals">
                {[f, ...rivals].sort((a, b) => b.score - a.score).map((r) => (
                  <div key={r.id} className="rival" data-self={r.id === f.id}><span className="grow truncate">{displayValue(r)}{r.id === f.id ? ' (this one)' : ''}</span><Dots level={r.level} /><span className="faint num">{r.evidence.length} {r.evidence.length === 1 ? 'source' : 'sources'}</span></div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="fsec">How it’s connected</div>
        <ConnectionPath subject={subject} f={f} subjectId={f.subjectId} />
        <p className="plain selectable">{hedge(explainRelation(f.relation, subject.label, displayValue(f)), f.level, f.evidence.some((e) => e.polarity === 'against'))}</p>

        <SourceCards f={f} />
        <MoreChecks f={f} />
      </div>

      {onDecide && (
        <div className="fdecide">
          <button className="btn" onClick={() => onDecide('rejected')} title="This is wrong or irrelevant. Plexus will trust the sources that reported it a little less."><X size={14} /> Reject <Kbd>R</Kbd></button>
          <button className="btn ghost" onClick={() => onDecide('unsure')} title="Park it and decide later"><CircleHelp size={14} /> Not sure <Kbd>U</Kbd></button>
          <button className="btn primary grow" onClick={() => onDecide('accepted')} title="Add this to your graph, linked to what you searched"><Check size={14} /> Accept <Kbd>A</Kbd></button>
        </div>
      )}
    </div>
  );
}
