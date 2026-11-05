import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { emailGuesses, patternOf } from '@shared/tools/emails';
import { reverseImageLinks, uploadReverseLinks } from '@shared/tools/reverse';
import type { DomainReport } from '@shared/tools/domain';
import { normalizeDomain } from '@shared/normalize';
import { Field, Row, Facts, Notice, Card, AddBtn, useBusy, when } from './kit';

interface GHit { email: string; exists: boolean; avatar?: string; displayName?: string; about?: string; accounts?: { name: string; url: string }[]; error?: string }

function GravatarResults({ hits }: { hits: GHit[] }) {
  const found = hits.filter((h) => h.exists);
  return (
    <>
      <Notice level={found.length ? 'good' : 'info'}>{found.length ? `${found.length} of ${hits.length} addresses have a Gravatar, so they belong to a real, active email account.` : `None of the ${hits.length} addresses has a Gravatar. That does not mean they are wrong: most people never set one up.`}</Notice>
      {found.map((h) => (
        <Card key={h.email} title={h.email} right={<AddBtn type="email" value={h.email} />}>
          <div className="tl-gravatar">{h.avatar && <img src={h.avatar} alt="" width={72} height={72} />}<Facts rows={[['Name on the profile', h.displayName], ['About', h.about], ['Linked accounts', h.accounts?.length ? h.accounts.map((a) => <div key={a.url}><a href={a.url} target="_blank" rel="noreferrer noopener">{a.name || a.url}</a></div>) : '']]} /></div>
        </Card>
      ))}
      {hits.some((h) => h.error) && <Notice level="notice">{hits.filter((h) => h.error).length} could not be checked: {hits.find((h) => h.error)!.error}</Notice>}
    </>
  );
}

export function EmailGuess() {
  const [first, setFirst] = useState(''), [last, setLast] = useState(''), [middle, setMiddle] = useState(''), [domain, setDomain] = useState(''), [personal, setPersonal] = useState(false), [known, setKnown] = useState('');
  const pat = known.includes('@') && first && last ? patternOf(known, first, last) : null;
  const guesses = useMemo(() => emailGuesses({ first, last, middle, domain, personal, knownPattern: pat ?? undefined }), [first, last, middle, domain, personal, pat]);
  const { busy, err, data, run } = useBusy<{ hits: GHit[] }>();
  const check = () => run(() => api.post('/api/tools/gravatar', { emails: guesses.slice(0, 40).map((g) => g.email) }));
  return (
    <div className="tl-stack">
      <Notice>Companies pick one email pattern for everyone. From a name and a company domain Plexus lists the likely addresses, then can check which ones have a Gravatar (a public avatar tied to the address), which shows the address is real. A guess is a lead, not a fact.</Notice>
      <Row><Field label="First name" grow><input className="field" value={first} onChange={(e) => setFirst(e.target.value)} /></Field><Field label="Middle (optional)"><input className="field" style={{ width: 120 }} value={middle} onChange={(e) => setMiddle(e.target.value)} /></Field><Field label="Last name" grow><input className="field" value={last} onChange={(e) => setLast(e.target.value)} /></Field></Row>
      <Row><Field label="Company domain" grow hint="acme.com"><input className="field" value={domain} disabled={personal} onChange={(e) => setDomain(e.target.value)} /></Field><Field label="Or try personal providers"><label className="tl-check"><input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} /> Gmail, Outlook, Yahoo, iCloud…</label></Field></Row>
      <Field label="An address you already know at that company (optional)" hint="Someone else's works too: it reveals the pattern. Enter that person's name above first.">
        <input className="field" value={known} onChange={(e) => setKnown(e.target.value)} placeholder="jane.doe@acme.com" /></Field>
      {pat && <Notice level="good">Their pattern is <b>{pat}</b>. That address is ranked first.</Notice>}
      {guesses.length > 0 && <Card title={`${guesses.length} likely addresses`} right={<button className="btn primary sm" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check which exist'}</button>}>
        <ul className="tl-pick">{guesses.slice(0, 40).map((g) => <li key={g.email}><span className="tl-val">{g.email}</span> <span className="faint">{g.pattern}</span><span className="tl-meter" title={`${Math.round(g.weight * 100)}% of companies use this`}><i style={{ width: `${Math.min(100, g.weight * 220)}%` }} /></span></li>)}</ul>
      </Card>}
      {err && <Notice level="warning">{err}</Notice>}
      {data && <GravatarResults hits={data.hits} />}
    </div>
  );
}

export function Gravatar() {
  const [t, setT] = useState('');
  const emails = useMemo(() => [...new Set(t.split(/[\s,;]+/).filter((x) => /@/.test(x)))], [t]);
  const { busy, err, data, run } = useBusy<{ hits: GHit[] }>();
  return (
    <div className="tl-stack">
      <Notice>Gravatar is a free avatar service many people use without remembering. If an email has one, the picture, a display name and sometimes linked accounts are public. Plexus asks only gravatar.com and sends a one-way hash, never the address itself.</Notice>
      <Field label="Email addresses" hint="Up to 40, separated by spaces, commas or new lines"><textarea className="field" rows={4} value={t} onChange={(e) => setT(e.target.value)} placeholder="name@example.com" /></Field>
      <div className="tl-actions"><button className="btn primary" disabled={!emails.length || busy} onClick={() => run(() => api.post('/api/tools/gravatar', { emails }))}>{busy ? 'Checking…' : `Check ${emails.length || ''} address${emails.length === 1 ? '' : 'es'}`}</button></div>
      {err && <Notice level="warning">{err}</Notice>}
      {data && <GravatarResults hits={data.hits} />}
    </div>
  );
}

export function Domain() {
  const [d, setD] = useState('');
  const { busy, err, data, run } = useBusy<{ report: DomainReport }>();
  const r = data?.report;
  const [bad, setBad] = useState('');
  const go = () => { const n = normalizeDomain(d); if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(n)) { setBad('That is not a domain name. Try something like example.com.'); return; } setBad(''); void run(() => api.post('/api/tools/domain', { domain: n })); };
  return (
    <div className="tl-stack">
      <Notice>A domain's life story from three public records: when it was registered, when security certificates were first issued for it and its sub-sites, and when the Internet Archive first saw it. An archive older than the registration means the name was dropped and bought again.</Notice>
      <Row><Field label="Domain" grow><input className="field" value={d} onChange={(e) => setD(e.target.value)} placeholder="example.com" onKeyDown={(e) => { if (e.key === 'Enter' && d.trim()) go(); }} /></Field><div className="tl-actions" style={{ alignSelf: 'flex-end' }}><button className="btn primary" disabled={!d.trim() || busy} onClick={go}>{busy ? 'Looking up (can take 20 seconds)…' : 'Build the history'}</button></div></Row>
      {bad && <Notice level="warning">{bad}</Notice>}
      {err && <Notice level="warning">{err}</Notice>}
      {r && <>
        {r.insights.map((i, k) => <Notice key={k} level={i.level}>{i.text}</Notice>)}
        <Card title={r.domain} right={<AddBtn type="domain" value={r.domain} />}>
          <Facts rows={[['Registrar', r.facts.registrar], ['Registered', r.facts.registered && when(r.facts.registered)], ['Last changed', r.facts.updated && when(r.facts.updated, false)], ['Expires', r.facts.expires && when(r.facts.expires, false)], ['Name servers', r.facts.nameservers.join(', ')], ['Status', r.facts.status.join(', ')], ['Certificates', r.certs.count ? `${r.certs.count} issued by ${r.certs.issuers.join(', ')}` : ''], ['Archive copies', r.archive.captures ? `${r.archive.captures} months with a saved copy` : '']]} />
        </Card>
        {r.timeline.length > 0 && <Card title="Timeline"><ol className="tl-timeline">{r.timeline.map((e, i) => <li key={i}><time>{e.iso.slice(0, 10)}</time><span>{e.text}</span></li>)}</ol></Card>}
        {r.certs.hosts.length > 0 && <Card title={`${r.certs.hosts.length} host names seen in certificates`} sub="Sub-sites the owner has run; some may not be linked anywhere"><div className="tl-chips">{r.certs.hosts.slice(0, 60).map((h) => <span key={h} className="tl-chip">{h}</span>)}</div></Card>}
      </>}
    </div>
  );
}

export function Redirects() {
  const [u, setU] = useState('');
  const { busy, err, data, run } = useBusy<{ hops: { url: string; status: number; location?: string; server?: string; note?: string }[]; final?: string; stopped?: string }>();
  return (
    <div className="tl-stack">
      <Notice>Where does a short or suspicious link really go? Plexus follows it one step at a time without opening the page, and refuses anything that points at a private network.</Notice>
      <Row><Field label="Link" grow><input className="field" value={u} onChange={(e) => setU(e.target.value)} placeholder="https://bit.ly/…" onKeyDown={(e) => { if (e.key === 'Enter' && u.trim()) void run(() => api.post('/api/tools/redirects', { url: u })); }} /></Field><div className="tl-actions" style={{ alignSelf: 'flex-end' }}><button className="btn primary" disabled={!u.trim() || busy} onClick={() => run(() => api.post('/api/tools/redirects', { url: u }))}>{busy ? 'Following…' : 'Follow the link'}</button></div></Row>
      {err && <Notice level="warning">{err}</Notice>}
      {data && <>
        {data.stopped && <Notice level="notice">{data.stopped}</Notice>}
        <Card title={data.final ? 'It ends here' : 'The trail'} sub={data.final} right={data.final ? <AddBtn type="url" value={data.final} /> : undefined}>
          <ol className="tl-hops">{data.hops.map((h, i) => <li key={i}><b>{h.status || 'no answer'}</b> {h.url}{h.server ? <span className="faint"> · {h.server}</span> : null}{h.note ? <span className="faint"> · {h.note}</span> : null}</li>)}</ol>
        </Card>
      </>}
    </div>
  );
}

export function Reverse() {
  const [u, setU] = useState('');
  const ok = /^https?:\/\//i.test(u.trim());
  return (
    <div className="tl-stack">
      <Notice>Find where else a picture appears, who posted it first, and larger or uncropped copies. The big search engines take a public picture address, so for a file on your computer use the upload links. Plexus never uploads your picture for you.</Notice>
      <Field label="Public address of the picture" hint="Right-click the picture in a browser → Copy image address"><input className="field" value={u} onChange={(e) => setU(e.target.value)} placeholder="https://…/photo.jpg" /></Field>
      {u.trim() && !ok && <Notice level="notice">The address needs to start with http:// or https://</Notice>}
      {ok && <Card title="Search with this address">{reverseImageLinks(u).map((l) => <div className="tl-linkrow" key={l.label}><a href={l.url} target="_blank" rel="noreferrer noopener">{l.label}</a><span className="faint">{l.note}</span></div>)}</Card>}
      <Card title="For a picture on your computer">{uploadReverseLinks.map((l) => <div className="tl-linkrow" key={l.label}><a href={l.url} target="_blank" rel="noreferrer noopener">{l.label}</a><span className="faint">{l.note}</span></div>)}</Card>
    </div>
  );
}
