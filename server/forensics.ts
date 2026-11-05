import { circadian, type Circadian } from '../shared/forensics/circadian';
import { findPlatformRefs, decodeDiscordSnowflake } from '../shared/forensics/ids';
import { linkProfiles, lookAlikes, resolveIdentities, type LookAlike, type Match, type Profile, type Resolution } from '../shared/forensics/linker';
import { findBursts, type Burst } from '../shared/forensics/bursts';
import { dstFingerprint } from '../shared/forensics/dst';
import { analyzeHeaders } from '../shared/forensics/headers';
import { parseChat } from '../shared/forensics/chat';
import { uid } from './store';
import { estimateNote } from './idclocks';
import { keyFor } from '../shared/normalize';
import type { GraphNode } from '../shared/types';
import type { Store } from './store';

const asMs = (v: unknown): { ms: number; precision: 'second' | 'day' } | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v); if (!Number.isFinite(t)) return null;
  return { ms: t, precision: /T\d{2}:\d{2}/.test(v) ? 'second' : 'day' };
};

/** Timestamps attached to a node (pasted logs, message links): the raw material of its circadian fingerprint. */
export function activityOf(n: GraphNode): number[] {
  const a = n.attrs?.activity;
  return typeof a === 'string' ? a.split(',').map(Number).filter(Number.isFinite) : [];
}

/** Turns the accounts and handles in a case into profiles the linker can compare, using only what the case already knows. */
export function profilesFor(store: Store, caseId: string): { profiles: Profile[]; circ: Map<string, Circadian> } {
  const nodes = store.listNodes(caseId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = store.listEdges(caseId);
  const tied = (id: string) => edges.filter((e) => e.from === id || e.to === id).map((e) => ({ node: byId.get(e.from === id ? e.to : e.from), strength: e.strength })).filter((x): x is { node: GraphNode; strength: number } => !!x.node);
  const neighbours = (id: string) => tied(id).map((x) => x.node);
  const profiles: Profile[] = []; const circ = new Map<string, Circadian>();
  // A bare username is only the handle itself. Once an account with that handle is on the case, the account is the thing to compare.
  const accountHandles = new Set(nodes.filter((n) => n.type === 'account' && typeof n.attrs?.handle === 'string').map((n) => String(n.attrs.handle).toLowerCase().replace(/^@/, '')));
  for (const n of nodes) {
    if (n.type !== 'account' && n.type !== 'username') continue;
    if (n.type === 'username' && accountHandles.has(n.value.toLowerCase().replace(/^@/, ''))) continue;
    const ref = n.type === 'account' ? findPlatformRefs(n.value).find((r) => r.kind !== 'post' && r.kind !== 'message') : undefined;
    const platform = (typeof n.attrs?.platform === 'string' && n.attrs.platform) || ref?.platform;
    let handle = (typeof n.attrs?.handle === 'string' && n.attrs.handle) || (ref && ref.kind === 'handle' ? ref.id : undefined) || (n.type === 'username' ? n.value.replace(/^@/, '') : undefined);
    if (!handle && n.type === 'account') { try { handle = new URL(n.value).pathname.split('/').filter(Boolean).pop(); } catch { /* not a URL */ } }
    let created = asMs(n.attrs?.createdAt);
    if (!created && ref?.at) created = { ms: ref.at, precision: 'second' };
    if (!created && ref?.platform === 'Discord' && ref.kind === 'user') { const s = decodeDiscordSnowflake(ref.id); if (s) created = { ms: s.createdAt, precision: 'second' }; }
    if (!created) { // fall back to the date a source gave when it reported this account
      for (const f of store.listFindings(caseId).filter((f) => f.type === n.type && f.key === keyFor(n.type, n.value, n.attrs) && f.when)) { const d = asMs(f.when); if (d) { created = d; break; } }
    }
    const nb = neighbours(n.id);
    const contactStrength: Record<string, number> = {};
    for (const t of tied(n.id)) if (['email', 'phone', 'wallet'].includes(t.node.type)) { const k = `${t.node.type}:${keyFor(t.node.type, t.node.value, t.node.attrs)}`; contactStrength[k] = Math.max(contactStrength[k] ?? 0, t.strength); }
    const contacts = Object.keys(contactStrength);
    const avatar = nb.find((x) => x.type === 'image' && typeof x.attrs?.hash === 'string')?.attrs?.hash as string | undefined;
    const links = nb.filter((x) => x.type === 'account' || x.type === 'url').map((x) => x.value);
    const c = circadian(activityOf(n)); if (c) circ.set(n.id, c);
    profiles.push({
      id: n.id, label: n.label, platform, handle, displayName: typeof n.attrs?.displayName === 'string' ? n.attrs.displayName : undefined,
      createdAt: created?.ms, createdPrecision: created?.precision, avatarHash: avatar, contacts, contactStrength, links, circadian: c ? { offsets: c.offsets, strength: c.strength } : undefined,
      activity: activityOf(n),
    });
  }
  return { profiles, circ };
}

const slim = (p: Profile): Profile => ({ ...p, activity: undefined }); // the raw timestamps stay on the server

export function matchNodes(store: Store, caseId: string, a: string, b: string, priorOdds?: number): { match: Match; a: Profile; b: Profile } | null {
  const { profiles } = profilesFor(store, caseId);
  const pa = profiles.find((p) => p.id === a), pb = profiles.find((p) => p.id === b);
  if (!pa || !pb) return null;
  return { match: linkProfiles(pa, pb, { priorOdds }), a: slim(pa), b: slim(pb) };
}

export function identitiesFor(store: Store, caseId: string, priorOdds?: number): Resolution & { profiles: number; bursts: Burst[]; lookalikes: LookAlike[] } {
  const { profiles } = profilesFor(store, caseId);
  const r = resolveIdentities(profiles, { priorOdds });
  const precise = profiles.filter((p) => p.createdAt !== undefined && p.createdPrecision !== 'day');
  const bursts: Burst[] = findBursts(precise.map((p) => ({ id: p.id, at: p.createdAt! })));
  const lookalikes = lookAlikes(profiles, { priorOdds }).map((l) => ({ ...l, a: slim(l.a), b: slim(l.b) }));
  return {
    bursts, lookalikes,
    identities: r.identities.map((i) => ({ ...i, members: i.members.map(slim) })),
    maybes: r.maybes.map((m) => ({ ...m, a: slim(m.a), b: slim(m.b) })),
    separated: r.separated.map((m) => ({ ...m, a: slim(m.a), b: slim(m.b) })),
    profiles: profiles.length,
  };
}

// ---------------------------------------------------------------------------------------------------- paste anything
const ISO = /\b(20\d{2}|19[7-9]\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?\s?(Z|[+-]\d{2}:?\d{2})?/g;
const EPOCH = /(?<![\d.])(1[3-9]\d{8}|2[0-3]\d{8})(\d{3})?(?![\d.])/g;

/** Every timestamp in a block of text, whatever form it takes: ISO times, Unix times, and the times hidden inside message links and IDs. */
export function timestampsIn(text: string): number[] {
  const out: number[] = []; const now = Date.now() + 86_400_000;
  let m: RegExpExecArray | null;
  const T = text.slice(0, 2_000_000);
  while ((m = ISO.exec(T))) { const tz = m[7] && m[7] !== 'Z' ? m[7].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') : 'Z'; const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${m[7] ? tz : 'Z'}`); if (Number.isFinite(t) && t < now) out.push(t); }
  while ((m = EPOCH.exec(T))) { const t = Number(m[1]) * 1000 + (m[2] ? Number(m[2]) : 0); if (t > Date.UTC(2005, 0, 1) && t < now) out.push(t); }
  for (const r of findPlatformRefs(T)) if (r.at && (r.kind === 'message' || r.kind === 'post')) out.push(r.at);
  return out;
}

export function scan(text: string, store?: Store) {
  const refs = findPlatformRefs(text).map((r) => { const n = store ? estimateNote(store, r) : undefined; return n ? { ...r, note: n } : r; });
  const times = timestampsIn(text);
  return { refs, timestamps: times.length, circadian: circadian(times), dst: dstFingerprint(times), headers: /^Received:/im.test(text) ? analyzeHeaders(text) : null };
}

// ---------------------------------------------------------------------------------------------------- chat exports
export function chatSummary(text: string) {
  const r = parseChat(text); if (!r) return null;
  return {
    format: r.format, platform: r.platform, total: r.total, localTime: r.localTime, note: r.note,
    speakers: r.speakers.slice(0, 200).map((s) => {
      const c = !r.localTime && s.times.length >= 12 ? circadian(s.times) : null;
      return { id: s.id, name: s.name, messages: s.messages, first: s.first, last: s.last, circadian: c, dst: c && c.strength !== 'insufficient' ? dstFingerprint(s.times) : null };
    }),
  };
}

/** Adds the chosen speakers to a case as accounts, with their activity attached when the export's times are in UTC. */
export function importChat(store: Store, caseId: string, text: string, ids: string[]): { added: number; nodes: string[] } {
  const r = parseChat(text); if (!r) return { added: 0, nodes: [] };
  const want = new Set(ids); const nodes: string[] = [];
  for (const s of r.speakers) {
    if (!want.has(s.id)) continue;
    const handle = (s.name || s.id).slice(0, 80);
    const url = r.platform === 'Discord' && /^\d{15,20}$/.test(s.id) ? `https://discord.com/users/${s.id}` : r.platform === 'Telegram' ? `telegram:${s.id}` : `${r.platform.toLowerCase()}:${s.id}`;
    const attrs: Record<string, string | number | boolean> = { platform: r.platform, handle, speakerId: s.id, messages: s.messages, ...(r.localTime ? {} : { activity: s.times.slice(-5000).join(',') }) };
    const key = keyFor('account', url);
    const n = store.upsertNode({ caseId, type: 'account', value: url, key, label: `${r.platform} · ${handle}`, state: 'seed', attrs });
    store.patchNodeAttrs(n.id, attrs);
    nodes.push(n.id);
  }
  store.audit(caseId, 'chat.imported', `${nodes.length} speakers from a ${r.platform} export (${r.total} messages)${r.localTime ? ', local times so no activity attached' : ''}`);
  return { added: nodes.length, nodes };
}
