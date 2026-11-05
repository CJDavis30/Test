import { useMemo, useState } from 'react';
import { identify, decodeTimestamp } from '@shared/tools/identify';
import { inspectText, decodeIdn } from '@shared/tools/textinspect';
import { compareStyle } from '@shared/tools/stylometry';
import { readPhone } from '@shared/tools/phone';
import { parseHandle, variants, compareHandles, rarityBits } from '@shared/forensics/username';
import { extractEntities } from '@shared/detect';
import { analyzeHeaders } from '@shared/forensics/headers';
import { analyzeUrl } from '@shared/forensics/urls';
import { EPOCH } from '@shared/forensics/ids';
import { Field, Row, Facts, Notice, Card, CopyBtn, AddBtn, useAdd, when, levelLabel } from './kit';
import type { EntityType } from '@shared/types';

const ZONES: [string, string][] = [['UTC', 'UTC'], ['Los Angeles', 'America/Los_Angeles'], ['New York', 'America/New_York'], ['São Paulo', 'America/Sao_Paulo'], ['London', 'Europe/London'], ['Berlin', 'Europe/Berlin'], ['Moscow', 'Europe/Moscow'], ['Dubai', 'Asia/Dubai'], ['Mumbai', 'Asia/Kolkata'], ['Shanghai', 'Asia/Shanghai'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney']];

export function Identify() {
  const [text, setText] = useState('');
  const lines = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30), [text]);
  return (
    <div className="tl-stack">
      <Field label="Paste anything: an ID, a number, a token, a string you cannot place" hint="One per line. Timestamps in any epoch, Discord/X/Steam IDs, UUIDs, hashes, JWTs, Base64, wallet addresses, IPs, MACs, IBANs…"><textarea className="field" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1700000000\n175928847299117063\neyJhbGciOiJIUzI1NiJ9…'} /></Field>
      {lines.map((l, i) => {
        const r = identify(l);
        return (
          <Card key={i} title={<code className="tl-code">{l.length > 70 ? l.slice(0, 70) + '…' : l}</code>} sub={r.length ? undefined : 'No known format matched. It may be a plain word, a password, or an ID Plexus does not know yet.'}>
            {r.map((x, j) => (
              <div className="tl-reading" key={j}>
                <div className="tl-reading-h"><b>{x.title}</b><span className="tl-chip" data-c={x.confidence >= 0.6 ? 'hi' : 'lo'}>{levelLabel(x.confidence)}</span></div>
                <Facts rows={[...(x.iso ? [['Date', when(x.iso)] as [string, string]] : []), ...x.facts.filter((f) => !(x.iso && /^(Date \(UTC\)|Created|Would date to)/.test(f[0])))]} />
                {x.entity && <div className="tl-actions"><AddBtn type={x.entity.type as EntityType} value={x.entity.value} /></div>}
              </div>
            ))}
          </Card>
        );
      })}
    </div>
  );
}

const snowflakeAt = (ms: number) => ((BigInt(Math.max(0, Math.round(ms - EPOCH.discord))) << 22n)).toString();
export function Timestamps() {
  const [text, setText] = useState('');
  const t = text.trim();
  const numeric = decodeTimestamp(t);
  const parsed = useMemo(() => { if (!t || /^-?\d+(\.\d+)?$/.test(t)) return null; const ms = Date.parse(/(z|[+-]\d{2}:?\d{2})$/i.test(t) ? t : t + (/\d{2}:\d{2}/.test(t) ? 'Z' : 'T00:00:00Z')); return Number.isFinite(ms) ? ms : null; }, [t]);
  const base = parsed ?? numeric[0]?.ms ?? null;
  return (
    <div className="tl-stack">
      <Field label="A timestamp, in any form" hint="1700000000 · 1700000000000 · 2023-11-14 22:13 · Windows FILETIME · Chrome/WebKit time · iOS absolute time. Text dates are read as UTC unless they say otherwise."><input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="1700000000" /></Field>
      {t && numeric.length > 1 && <Notice level="notice">This number fits {numeric.length} different time formats. The right one depends on where you found it: most things use Unix seconds or milliseconds; Windows files use FILETIME; Chrome history uses WebKit time.</Notice>}
      {numeric.map((d) => <Card key={d.epoch} title={when(d.iso)} sub={d.epoch}><Facts rows={[['ISO', d.iso]]} /></Card>)}
      {base !== null && <Card title="The same moment in other places" sub="So a time stamped in one timezone can be compared with another">
        <Facts rows={ZONES.map(([n, z]): [string, string] => [n, new Date(base).toLocaleString('en-US', { timeZone: z, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' })])} />
        <Facts rows={[['Unix seconds', <>{Math.floor(base / 1000)} <CopyBtn text={String(Math.floor(base / 1000))} /></>], ['Unix milliseconds', <>{base} <CopyBtn text={String(base)} /></>], ['A Discord ID created at this moment would start with', snowflakeAt(base)]]} />
      </Card>}
      {t && !numeric.length && parsed === null && <Notice level="notice">Could not read that as a time between 1995 and 2035.</Notice>}
    </div>
  );
}

export function HandleVariants() {
  const [h, setH] = useState('');
  const p = h.trim() ? parseHandle(h.trim()) : null;
  const vs = useMemo(() => (h.trim() ? variants(h.trim(), 24) : []), [h]);
  const add = useAdd();
  return (
    <div className="tl-stack">
      <Field label="A username" hint="People reuse, decorate and tweak handles. This shows how this one is built and the likely versions to look for."><input className="field" value={h} onChange={(e) => setH(e.target.value)} placeholder="xX_maralinden99_Xx" /></Field>
      {p && <Card title="How the handle is built">
        <Facts rows={[['Core name', p.core || '(none)'], ['Without decoration', p.clean], ['Decorated', p.decorated ? 'Yes (extra characters around the name)' : 'No'], ['Leetspeak', p.leet ? 'Yes (digits standing in for letters)' : 'No'], ['Trailing number', p.trailingDigits || 'none'], ['Words inside', p.tokens.join(', ') || 'none'], ['How rare', `about ${Math.round(rarityBits(p.core))} bits of surprise: ${rarityBits(p.core) > 24 ? 'very distinctive, a shared copy is a strong lead' : rarityBits(p.core) > 14 ? 'fairly distinctive' : 'common, so sharing it proves little'}`]]} />
      </Card>}
      {vs.length > 0 && <Card title="Likely variations" sub="Add the ones worth searching; each becomes a username in your case"><div className="tl-chips">{vs.map((v) => <button key={v} className="tl-chip btn-ish" title="Add to case" onClick={() => add('username', v)}>{v}</button>)}</div></Card>}
    </div>
  );
}

export function HandleCompare() {
  const [a, setA] = useState(''), [b, setB] = useState('');
  const r = a.trim() && b.trim() ? compareHandles(a.trim(), b.trim()) : null;
  return (
    <div className="tl-stack">
      <Notice>How much does it tell you that two accounts have names like these? A shared common word means nothing; a shared odd name is a real clue. The result is measured in bits: each bit halves the chance it is a coincidence.</Notice>
      <Row><Field label="Handle one" grow><input className="field" value={a} onChange={(e) => setA(e.target.value)} placeholder="maralinden" /></Field><Field label="Handle two" grow><input className="field" value={b} onChange={(e) => setB(e.target.value)} placeholder="m4ralinden_2009" /></Field></Row>
      {r && <Card title={{ identical: 'Identical', 'same-core': 'Same name, written differently', 'shared-token': 'Share a distinctive word', near: 'Nearly the same', different: 'Different' }[r.kind]} sub={r.detail}>
        <Facts rows={[['Evidence', r.bits > 0 ? `+${r.bits.toFixed(1)} bits toward "same person" (about 1 in ${Math.round(2 ** r.bits).toLocaleString('en-US')} by chance)` : `${r.bits.toFixed(1)} bits (mild evidence against)`]]} />
        <Notice level="notice">Handles are cheap to copy. Treat this as a lead and look for things an impostor cannot copy: when each account was created, or a shared email.</Notice>
      </Card>}
    </div>
  );
}

export function Lookalike() {
  const [t, setT] = useState('');
  const r = useMemo(() => (t ? inspectText(t) : null), [t]);
  const idn = /xn--/i.test(t) ? decodeIdn(t.trim().toLowerCase()) : '';
  return (
    <div className="tl-stack">
      <Notice>A name can look identical to another and be different: a Cyrillic "а" for a Latin "a", an invisible character, a right-to-left control. Paste a username, domain, link or message to see what it is really made of.</Notice>
      <Field label="Text to inspect"><input className="field" value={t} onChange={(e) => setT(e.target.value)} placeholder="pаypal.com" /></Field>
      {r && <>
        {r.findings.map((f, i) => <Notice key={i} level={f.level === 'bad' ? 'warning' : f.level === 'warn' ? 'notice' : 'good'}>{f.text}</Notice>)}
        <Card title="What it looks like to a person"><Facts rows={[['Reads as', <>{r.skeleton} <CopyBtn text={r.skeleton} /></>], ['With hidden characters removed', <>{r.cleaned} <CopyBtn text={r.cleaned} /></>], ['Length', `${r.length} characters`], ['Alphabets used', Object.entries(r.scripts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'], ['Domain as displayed', idn]]} /></Card>
        <Card title="Character by character"><div className="tl-chars">{r.chars.map((c, i) => <span key={i} className="tl-char" data-bad={c.suspicious} title={`${c.code} · ${c.name}`}><b>{c.ch.trim() ? c.ch : '␣'}</b><small>{c.code.slice(2)}</small></span>)}</div></Card>
      </>}
    </div>
  );
}

export function Style() {
  const [a, setA] = useState(''), [b, setB] = useState('');
  const r = useMemo(() => (a.trim() && b.trim() ? compareStyle(a, b) : null), [a, b]);
  return (
    <div className="tl-stack">
      <Notice>Do two pieces of writing share a hand? Paste messages from two accounts (the more the better, at least a few hundred words each). It compares small-word habits, punctuation, capitals, slang and letter patterns. Weak evidence on its own: copying and imitation fool it.</Notice>
      <Row><Field label="Writing from account A" grow><textarea className="field" rows={8} value={a} onChange={(e) => setA(e.target.value)} /></Field><Field label="Writing from account B" grow><textarea className="field" rows={8} value={b} onChange={(e) => setB(e.target.value)} /></Field></Row>
      {r && <>
        <Card title={r.verdict[0].toUpperCase() + r.verdict.slice(1)} sub={`Style similarity ${Math.round(r.similarity * 100)}% · ${r.words[0]} and ${r.words[1]} words · reliability ${r.reliability}`}>
          {r.notes.map((n, i) => <Notice key={i} level="notice">{n}</Notice>)}
        </Card>
        <Card title="The habits compared"><table className="tl-table"><thead><tr><th>Habit</th><th>A</th><th>B</th><th>Match</th></tr></thead><tbody>{r.rows.filter((x) => x.informative).map((x) => <tr key={x.label}><td>{x.label}</td><td>{x.a}</td><td>{x.b}</td><td><span className="tl-meter"><i style={{ width: `${Math.round(x.match * 100)}%` }} /></span></td></tr>)}</tbody></table></Card>
      </>}
    </div>
  );
}

export function Phone() {
  const [n, setN] = useState(''), [c, setC] = useState('US');
  const r = useMemo(() => (n.trim() ? readPhone(n, (c.trim().toUpperCase() || 'US') as any) : null), [n, c]);
  return (
    <div className="tl-stack">
      <Row><Field label="Phone number" hint="With a + and country code is best" grow><input className="field" value={n} onChange={(e) => setN(e.target.value)} placeholder="+1 415 555 0132" /></Field><Field label="Country if no +" hint="2 letters"><input className="field" style={{ width: 70 }} maxLength={2} value={c} onChange={(e) => setC(e.target.value)} /></Field></Row>
      {r && <>
        <Card title={r.valid ? (r.international ?? n) : 'Not a valid number'} sub={r.valid ? `${r.countryName ?? ''}${r.callingCode ? ` · +${r.callingCode}` : ''}` : undefined} right={r.valid && r.e164 ? <AddBtn type="phone" value={r.e164} /> : undefined}>
          <Facts rows={[['International', r.international], ['National', r.national], ['E.164 (for searching)', r.e164 && <>{r.e164} <CopyBtn text={r.e164} /></>], ['Valid for its country', r.valid ? 'Yes' : 'No'], ['Plausible length', r.possible ? 'Yes' : 'No']]} />
          {r.flags.map((f, i) => <Notice key={i} level={f.level}>{f.text}</Notice>)}
        </Card>
        {r.candidates.length > 0 && <Card title="Countries this could belong to" sub="No country code was given, so here is every country where it is a valid number"><ul className="tl-list">{r.candidates.map((x) => <li key={x.country + x.e164}>{x.name} <span className="faint">{x.e164}</span></li>)}</ul></Card>}
        {r.links.length > 0 && <div className="tl-links">{r.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener">{l.label}</a>)}</div>}
      </>}
    </div>
  );
}

export function Extract() {
  const [t, setT] = useState('');
  const items = useMemo(() => (t.trim() ? extractEntities(t) : []), [t]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const add = useAdd();
  const key = (i: { type: string; value: string }) => `${i.type}:${i.value}`;
  const go = async () => { for (const i of items.filter((x) => picked.has(key(x)))) await add(i.type, i.value); setPicked(new Set()); };
  return (
    <div className="tl-stack">
      <Field label="Paste any text: a post, an email, a log, a document" hint="Plexus pulls out the emails, links, domains, phone numbers and IP addresses"><textarea className="field" rows={7} value={t} onChange={(e) => { setT(e.target.value); setPicked(new Set()); }} /></Field>
      {t.trim() && !items.length && <Notice level="notice">Nothing found: no emails, links, domains, phone numbers or IP addresses.</Notice>}
      {items.length > 0 && <Card title={`${items.length} found`} right={<button className="btn primary sm" disabled={!picked.size} onClick={go}>Add {picked.size || ''} selected</button>}>
        <ul className="tl-pick">{items.map((i) => <li key={key(i)}><label><input type="checkbox" checked={picked.has(key(i))} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(key(i))) n.delete(key(i)); else n.add(key(i)); return n; })} /><span className="tl-chip">{i.type}</span> <span className="tl-val">{i.value}</span></label></li>)}</ul>
        <div className="tl-actions"><button className="btn sm" onClick={() => setPicked(new Set(items.map(key)))}>Select all</button></div>
      </Card>}
    </div>
  );
}

export function Headers() {
  const [t, setT] = useState('');
  const r = useMemo(() => (t.trim() ? analyzeHeaders(t) : null), [t]);
  return (
    <div className="tl-stack">
      <Field label="Paste the full email headers" hint="Gmail: ⋮ → Show original. Apple Mail: View → Message → All Headers. Outlook: File → Properties."><textarea className="field" rows={8} value={t} onChange={(e) => setT(e.target.value)} placeholder="Received: from mail.example.com (203.0.113.9) by …" /></Field>
      {t.trim() && !r && <Notice level="notice">That does not look like email headers (no Received: or From: lines).</Notice>}
      {r && <>
        <Card title={r.subject || '(no subject)'} sub={`From ${r.from ?? 'unknown'}${r.to ? ` to ${r.to}` : ''}`}>
          <Facts rows={[['Sent', r.sent ? `${when(new Date(r.sent.at).toISOString(), false)} · sender's clock was set to ${r.sent.tz}` : ''], ['First server that accepted it', r.originIp ? `${r.originIp}` : ''], ['Reply-To', r.replyTo], ['Return-Path', r.returnPath], ['Sent with', r.mailer], ['Message-ID', r.messageId], ['SPF / DKIM / DMARC', [r.auth.spf, r.auth.dkim, r.auth.dmarc].map((x) => x ?? 'none').join(' / ')]]} />
          {r.originIp && <div className="tl-actions"><AddBtn type="ip" value={r.originIp} label="Add origin IP to case" /></div>}
        </Card>
        {r.findings.map((f, i) => <Notice key={i} level={f.level === 'bad' ? 'warning' : f.level === 'warn' ? 'notice' : 'info'}>{f.text}</Notice>)}
        <Card title={`The route it took (${r.hops.length} hops, oldest first)`}><ol className="tl-hops">{r.hops.map((h) => <li key={h.index}><b>{h.by ?? 'unknown server'}</b> <span className="faint">{h.from ? `received from ${h.from}` : ''}{h.ip ? ` [${h.ip}]` : ''}{h.at ? ` · ${new Date(h.at).toISOString().replace('T', ' ').slice(0, 19)} UTC` : ''}{h.delaySec ? ` · +${h.delaySec}s` : ''}</span></li>)}</ol></Card>
      </>}
    </div>
  );
}

export function LinkInspect() {
  const [u, setU] = useState('');
  const r = useMemo(() => (u.trim() ? analyzeUrl(u.trim()) : null), [u]);
  return (
    <div className="tl-stack">
      <Field label="A link" hint="Nothing is opened. Plexus reads what the link gives away: tracking tags that name who shared it, hidden redirects, timestamps inside post links."><input className="field" value={u} onChange={(e) => setU(e.target.value)} placeholder="https://www.instagram.com/p/…?igsh=…" /></Field>
      {u.trim() && !r && <Notice level="notice">That does not look like a link.</Notice>}
      {r && <>
        {r.warnings.map((w, i) => <Notice key={i} level="notice">{w}</Notice>)}
        <Card title={r.host} sub="What the link says"><Facts rows={r.facts.filter((f) => f.importance >= 1).sort((a, b) => b.importance - a.importance).map((f): [string, string] => [f.label, f.iso ? `${f.value} (${when(f.iso, false)})` : f.value])} /></Card>
        <Card title="Cleaned link" sub={r.removed.length ? `Removed ${r.removed.length} tracking part${r.removed.length > 1 ? 's' : ''}: ${r.removed.join(', ')}` : 'Nothing to remove'}><div className="tl-url">{r.cleaned} <CopyBtn text={r.cleaned} /></div></Card>
        {r.entities.length > 0 && <Card title="Things found in the link">{r.entities.map((e, i) => <div className="tl-reading" key={i}><div className="tl-reading-h"><span><span className="tl-chip">{e.type}</span> <b>{e.value}</b></span><AddBtn type={e.type as EntityType} value={e.value} /></div><p className="faint" style={{ margin: 0, fontSize: 12.5 }}>{e.why}</p></div>)}</Card>}
      </>}
    </div>
  );
}
