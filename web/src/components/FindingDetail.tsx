import { ArrowDown, Check, CircleHelp, CircleCheck, CircleX, ExternalLink, Minus, TriangleAlert, X } from 'lucide-react';
import { ENTITY_LABEL, type EntityType, type Evidence, type Finding, type GraphEdge, type GraphNode } from '@shared/types';
import { confidenceSentence, evidenceStrength, explainRelation, hedge, warningsFor } from '@shared/explain';
import { safeHttpUrl } from '@shared/normalize';
import { useStore } from '../lib/store';
import { EntityGlyph } from '../lib/icons';
import { ago, displayValue, fmtDate, hostOf } from '../lib/format';
import { Dots, Kbd } from './ui';

export interface Subject { type: EntityType; label: string }

const initialOf = (n: string) => n.trim()[0]?.toUpperCase() ?? '?';

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

/** What you entered → (how it led here) → what was found. A few chips, readable at a glance. */
export function ConnectionPath({ subject, f, subjectId }: { subject: Subject; f: Finding; subjectId?: string }) {
  const snap = useStore((s) => s.snap);
  const chain = subjectId && snap ? lineage(subjectId, snap.nodes, snap.edges) : [];
  const steps = chain.length > 1 ? chain : [{ node: { type: subject.type, label: subject.label } as GraphNode, via: undefined }];
  return (
    <div className="cpath" role="group" aria-label="Connection">
      {steps.map((st, i) => (
        <div key={i} className="cstep">
          {i > 0 && <Link label={steps[i].via ?? 'led to'} />}
          <div className="crow">
            <span className="ctag">{i === 0 && steps.length > 1 ? 'Started from' : i === steps.length - 1 ? 'You searched' : 'Then'}</span>
            <span className="cnode" title={st.node.label}><EntityGlyph type={st.node.type} size={14} /><span className="truncate">{st.node.label}</span></span>
          </div>
        </div>
      ))}
      <div className="cstep">
        <Link label={f.relation} />
        <div className="crow"><span className="ctag">Found</span><span className="cnode found" title={f.value}><EntityGlyph type={f.type} size={14} /><span className="truncate">{displayValue(f)}</span></span></div>
      </div>
    </div>
  );
}
const Link = ({ label }: { label: string }) => <div className="clink"><span className="cline" /><span className="clabel">{label}</span><ArrowDown size={12} /></div>;

/** Evidence in two groups: what sources returned directly, and what other sources said when we cross-checked it. */
export function SourceCards({ f }: { f: Finding }) {
  const sources = useStore((s) => s.sources);
  const byWeight = (a: Evidence, b: Evidence) => b.weight - a.weight;
  const direct = f.evidence.filter((e) => e.kind !== 'cross').sort(byWeight);
  const cross = f.evidence.filter((e) => e.kind === 'cross').sort((a, b) => Number(b.polarity !== 'against') - Number(a.polarity !== 'against') || byWeight(a, b));
  const ok = cross.filter((e) => e.polarity !== 'against').length, bad = cross.length - ok;
  const info = (e: Evidence) => sources.find((x) => x.id === e.adapter);
  return (
    <>
      {direct.length > 0 && (
        <>
          <div className="fsec">Found directly <span className="cnt">{direct.length} {direct.length === 1 ? 'source' : 'sources'}</span></div>
          <div className="scards">{direct.map((e) => <SourceCard key={e.id} e={e} info={info(e)} />)}</div>
        </>
      )}
      {cross.length > 0 && (
        <>
          <div className="fsec">Cross-checks <span className="cnt">{ok > 0 && <span className="okc">{ok} confirm</span>}{ok > 0 && bad > 0 && ' · '}{bad > 0 && <span className="badc">{bad} contradict</span>}</span></div>
          <div className="scards">{cross.map((e) => <SourceCard key={e.id} e={e} info={info(e)} />)}</div>
        </>
      )}
    </>
  );
}

const OFFLINE = new Set(['derive', 'phone-offline']);

function SourceCard({ e, info }: { e: Evidence; info?: { description: string; trust: number; decisions: number; homepage?: string; demo?: boolean } }) {
  const st = evidenceStrength(e.weight, info?.trust ?? 1);
  const url = safeHttpUrl(e.url);
  const about = info?.description?.replace(/\s*\(Simulated, fictional data\.?\)\s*$/i, '');
  const against = e.polarity === 'against';
  const facts = e.record?.facts ?? [];
  return (
    <div className={`scard selectable ${e.kind === 'cross' ? (against ? 'bad' : 'ok') : ''}`}>
      <div className="shead">
        <span className="sic" aria-hidden>{initialOf(e.adapterName)}</span>
        <span className="sname truncate" title={about}>{e.adapterName}{safeHttpUrl(info?.homepage) && <a className="shome" href={safeHttpUrl(info?.homepage)} target="_blank" rel="noreferrer noopener" title={`About ${e.adapterName}`} aria-label={`About ${e.adapterName}`}><ExternalLink size={11} /></a>}</span>
        <span className="sstr" title={`${st.label}: the source's claim strength combined with how much Plexus trusts it${info ? ` (${Math.round(info.trust * 100)}%${info.decisions ? `, learned from your ${info.decisions} decisions` : ''})` : ''}.`}><Dots level={st.level} /><span>{st.label.replace(' evidence', '')}</span></span>
      </div>
      {e.kind === 'cross' && e.verdict && (
        <div className={`sverdict ${against ? 'bad' : 'ok'}`}>{against ? <CircleX size={14} /> : <CircleCheck size={14} />}<span>{e.verdict}</span></div>
      )}
      <dl className="strail">
        {e.how && <><dt>Asked</dt><dd>{e.how}</dd></>}
        {e.snippet && <><dt>Found</dt><dd className="quote">{e.snippet}</dd></>}
        {!e.snippet && facts.length === 0 && <><dt>Found</dt><dd className="quote">A match, with no extra detail.</dd></>}
        {url
          ? <><dt>Check</dt><dd><a href={url} target="_blank" rel="noreferrer noopener" title={url}>{e.urlKind === 'record' ? 'Open the record' : 'Repeat this lookup'} · {hostOf(url)} <ExternalLink size={11} style={{ verticalAlign: -1 }} /></a></dd></>
          : <><dt>Check</dt><dd className="faint">{info?.demo ? 'Simulated source: there is no real page to open.' : OFFLINE.has(e.adapter) ? 'Worked out on this Mac. Nothing to open.' : 'This source gave no page to link to.'}</dd></>}
      </dl>
      {facts.length > 0 && (
        <div className="srecord">
          <div className="rtitle">{e.record!.title}</div>
          <table><tbody>{facts.slice(0, 7).map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
        </div>
      )}
      {e.via && <div className="svia">Checked because “{e.via.label}” was found for this lookup · {ago(e.retrievedAt)}</div>}
      {!e.via && <div className="smeta2">Checked {ago(e.retrievedAt)}</div>}
    </div>
  );
}

/** How the number was reached: what found it, what confirmed it, what disagreed, and what was asked but had nothing. */
function ScoreCard({ f }: { f: Finding }) {
  const direct = new Set(f.evidence.filter((e) => e.kind !== 'cross' && e.polarity !== 'against').map((e) => e.family)).size;
  const confirm = f.evidence.filter((e) => e.kind === 'cross' && e.polarity !== 'against');
  const against = f.evidence.filter((e) => e.polarity === 'against');
  const quiet = (f.checks ?? []).filter((c) => c.result === 'neutral' || c.result === 'failed');
  return (
    <ul className="scorecard">
      <li className="y"><Check size={13} /> Found directly by {direct} {direct === 1 ? 'source' : 'sources'}</li>
      {confirm.length > 0 && <li className="y"><Check size={13} /> {confirm.length} cross-check{confirm.length > 1 ? 's' : ''} confirm it ({[...new Set(confirm.map((e) => e.adapterName))].join(', ')})</li>}
      {against.length > 0 && <li className="n"><X size={13} /> {against.length} cross-check{against.length > 1 ? 's' : ''} contradict it ({[...new Set(against.map((e) => e.adapterName))].join(', ')})</li>}
      {quiet.length > 0 && <li className="z"><Minus size={13} /> Also asked, no answer either way: {quiet.map((c) => `${c.source}${c.result === 'failed' ? ' (unreachable)' : ''}`).join(', ')}</li>}
    </ul>
  );
}

/** Everything someone needs to approve or reject a finding: the trail first, warnings only when something is shaky. */
export function FindingDetail({ f, subject, compact = false, onDecide }: { f: Finding; subject: Subject; compact?: boolean; onDecide?: (s: 'accepted' | 'rejected' | 'unsure') => void }) {
  const all = useStore((s) => s.findings);
  const independent = new Set(f.evidence.filter((e) => e.polarity !== 'against').map((e) => e.family)).size;
  const rivals = (f.conflictsWith ?? []).map((id) => all[id]).filter(Boolean);
  const warns = warningsFor(f);
  return (
    <div className={`fdetail ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="fhead">
          <span className="fic"><EntityGlyph type={f.type} size={18} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="fvalue selectable">{displayValue(f)}</div>
            <div className="ftype">{ENTITY_LABEL[f.type]}{f.when ? ` · from ${fmtDate(f.when)}` : ''}</div>
          </div>
        </div>
      )}

      <div className="fverdict">
        <div className="row" style={{ gap: 10 }}><span className="fpct num" style={{ color: `var(--lvl${f.level})` }}>{Math.round(f.score * 100)}%</span><Dots level={f.level} label /><span className="faint" style={{ fontSize: 12 }} title="An estimate from how many independent sources agree, how much each is trusted, and what cross-checks found. Not a guarantee.">confidence</span></div>
        <span className="fsentence">{confidenceSentence(f.level, independent)}</span>
        <ScoreCard f={f} />
      </div>

      {onDecide && (
        <div className="fbuttons">
          <button className="btn primary" onClick={() => onDecide('accepted')} title="Add this to your graph, linked to what you searched"><Check size={14} /> Accept <Kbd>A</Kbd></button>
          <button className="btn" onClick={() => onDecide('rejected')} title="This is wrong or irrelevant. Plexus will trust the sources that reported it a little less."><X size={14} /> Reject <Kbd>R</Kbd></button>
          <button className="btn ghost" onClick={() => onDecide('unsure')} title="Park it and decide later"><CircleHelp size={14} /> Not sure <Kbd>U</Kbd></button>
        </div>
      )}

      <div className="fsec">How it’s connected</div>
      <ConnectionPath subject={subject} f={f} subjectId={f.subjectId} />
      <p className="plain selectable">{hedge(explainRelation(f.relation, subject.label, displayValue(f)), f.level, f.evidence.some((e) => e.polarity === 'against'))}</p>

      <SourceCards f={f} />

      {(warns.length > 0 || rivals.length > 0) && (
        <>
          <div className="fsec warn">Watch out</div>
          <ul className="watch">
            {warns.map((w) => <li key={w}><TriangleAlert size={13} />{w}</li>)}
            {rivals.length > 0 && <li><TriangleAlert size={13} />Sources disagree. Pick the answer you trust:</li>}
          </ul>
          {rivals.length > 0 && (
            <div className="rivals">
              {[f, ...rivals].sort((a, b) => b.score - a.score).map((r) => (
                <div key={r.id} className="rival" data-self={r.id === f.id}><span className="grow truncate">{displayValue(r)}{r.id === f.id ? ' (this one)' : ''}</span><Dots level={r.level} /><span className="faint num">{r.evidence.length} {r.evidence.length === 1 ? 'source' : 'sources'}</span></div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
