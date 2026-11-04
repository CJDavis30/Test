import type { GraphEdge, GraphNode, LinkSuggestion } from '../shared/types';
import { keyFor, nameSimilarity, normalizeDomain } from '../shared/normalize';
import { uid } from './store';

/**
 * Deterministic "connect the dots": proposes edges between nodes already in the graph, from structure alone.
 * Nothing here is saved automatically — suggestions are shown for the user to accept.
 */
export function inferLinks(nodes: GraphNode[], edges: GraphEdge[]): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  const connected = new Set<string>();
  for (const e of edges) { connected.add(`${e.from}|${e.to}`); connected.add(`${e.to}|${e.from}`); }
  const add = (a: GraphNode, b: GraphNode, label: string, reason: string, score: number, kind: 'link' | 'merge' = 'link') => {
    if (a.id === b.id || connected.has(`${a.id}|${b.id}`)) return;
    connected.add(`${a.id}|${b.id}`); connected.add(`${b.id}|${a.id}`);
    out.push({ id: uid('s_'), a: a.id, b: b.id, label, reason, score, kind, by: 'rules' });
  };

  const by = (t: GraphNode['type']) => nodes.filter((n) => n.type === t);
  const emails = by('email'), users = by('username'), domains = by('domain'), persons = by('person');
  const orgs = by('org'), accounts = by('account'), ips = by('ip'), wallets = by('wallet');

  // email local-part == username
  for (const e of emails) {
    const local = keyFor('username', e.value.split('@')[0].split('+')[0]);
    for (const u of users) if (keyFor('username', u.value) === local && local.length >= 4)
      add(e, u, 'same handle', `The email's local part “${e.value.split('@')[0]}” matches the username.`, 0.45);
  }
  // email @ domain
  for (const e of emails) {
    const dom = normalizeDomain(e.value.split('@')[1] ?? '');
    for (const d of domains) if (normalizeDomain(d.value) === dom) add(e, d, 'mailbox at', `${e.value} is hosted on ${d.value}.`, 0.8);
  }
  // account URL → username / platform handle
  for (const a of accounts) {
    let seg = '';
    try { seg = decodeURIComponent(new URL(a.value).pathname.split('/').filter(Boolean).pop() ?? '').replace(/^@/, ''); } catch { /* not a URL */ }
    if (!seg) continue;
    for (const u of users) if (keyFor('username', seg) === keyFor('username', u.value))
      add(u, a, 'profile', `The profile URL ends in “${seg}”, same as the username.`, 0.65);
  }
  // possible same person (name variants)
  for (let i = 0; i < persons.length; i++) for (let j = i + 1; j < persons.length; j++) {
    const s = nameSimilarity(persons[i].value, persons[j].value);
    if (s >= 0.9) add(persons[i], persons[j], 'possibly the same', `Names are ${Math.round(s * 100)}% similar. Review before merging.`, s * 0.7, 'merge');
  }
  // org ↔ domain by name
  for (const o of orgs) {
    const toks = o.value.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter((t) => t.length >= 4 && !['labs', 'group', 'company', 'studio', 'cloud', 'corp', 'holdings'].includes(t));
    for (const d of domains) {
      const dn = d.value.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (toks.length && toks.every((t) => dn.includes(t))) add(o, d, 'possible website', `Domain name contains “${toks.join(' ')}”.`, 0.4);
    }
  }
  // people who share an organization
  const linkedOrgs = new Map<string, Set<string>>();
  for (const e of edges) {
    const f = nodes.find((n) => n.id === e.from), t = nodes.find((n) => n.id === e.to);
    if (!f || !t) continue;
    for (const [p, o] of [[f, t], [t, f]] as const) if (p.type === 'person' && o.type === 'org') (linkedOrgs.get(o.id) ?? linkedOrgs.set(o.id, new Set()).get(o.id)!).add(p.id);
  }
  for (const [orgId, ids] of linkedOrgs) {
    const list = [...ids].map((id) => nodes.find((n) => n.id === id)!).filter(Boolean);
    const org = nodes.find((n) => n.id === orgId)!;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
      add(list[i], list[j], 'associates', `Both are linked to ${org.value}.`, 0.35);
  }
  // domain ↔ ip: subdomain families and shared hosting
  for (const d of domains) for (const p of domains) {
    if (d.id !== p.id && d.value.endsWith(`.${p.value}`)) add(p, d, 'subdomain', `${d.value} is under ${p.value}.`, 0.9);
  }
  void ips; void wallets;
  return out.sort((a, b) => b.score - a.score).slice(0, 25);
}
