import type { CaseInfo, EntityType, Finding, GraphEdge, GraphNode } from '../shared/types';
import { ENTITY_LABEL, LEVEL_LABEL } from '../shared/types';

const HEAD: Record<EntityType, [string, string]> = {
  person: ['name', 'People'], org: ['organization', 'Organizations'], email: ['email', 'Emails'], phone: ['phone number', 'Phone numbers'], username: ['username', 'Usernames'],
  account: ['account', 'Accounts'], location: ['location', 'Locations'], domain: ['domain', 'Domains'], ip: ['IP address', 'IP addresses'], url: ['page', 'Pages'],
  wallet: ['wallet', 'Wallets'], breach: ['data breach', 'Data breaches'], image: ['image', 'Images'],
};
const plural = (t: EntityType, n: number) => (n === 1 ? `1 ${HEAD[t][0]}` : `${n} ${HEAD[t][0] === 'IP address' ? 'IP addresses' : HEAD[t][0] === 'data breach' ? 'data breaches' : `${HEAD[t][0]}s`.replace('people', 'people')}`);
/** [1][2][3][5] → [1–3][5] */
function compressRefs(nums: number[]): string {
  const out: string[] = []; let i = 0;
  while (i < nums.length) { let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++; out.push(j - i >= 2 ? `[${nums[i]}–${nums[j]}]` : nums.slice(i, j + 1).map((n) => `[${n}]`).join('')); i = j + 1; }
  return out.join('');
}

const ORDER: EntityType[] = ['person', 'org', 'email', 'phone', 'username', 'account', 'location', 'domain', 'ip', 'url', 'wallet', 'breach', 'image'];

/** A plain Markdown report of everything the investigator confirmed, with provenance. */
export function buildReport(c: CaseInfo, nodes: GraphNode[], edges: GraphEdge[], accepted: Finding[], opts: { redact?: boolean; integrity?: { auditOk: boolean; auditCount: number; evidenceChecked: number; altered: number } } = {}): string {
  const mask = (s: string) => (opts.redact ? s.replace(/[A-Za-z0-9]/g, '•') : s);
  const lines: string[] = [];
  lines.push(`# ${c.name}`, '');
  if (c.purpose) lines.push(`**Purpose:** ${c.purpose}`, '');
  lines.push(`_Generated ${new Date().toISOString().slice(0, 10)} · ${nodes.length} entities · ${edges.length} relationships_`, '');

  const confirmed = nodes.filter((n) => n.state === 'confirmed' || n.state === 'seed');
  const fByNode = new Map<string, Finding[]>();
  for (const f of accepted) {
    const n = nodes.find((x) => x.type === f.type && x.value === f.value);
    if (n) (fByNode.get(n.id) ?? fByNode.set(n.id, []).get(n.id)!).push(f);
  }
  lines.push('## Summary', '');
  const seeds = nodes.filter((n) => n.state === 'seed' || edges.some((e) => e.from === n.id)).slice(0, 5);
  if (seeds.length) lines.push(`Starting points: ${seeds.map((s) => `**${mask(s.label)}** (${ENTITY_LABEL[s.type].toLowerCase()})`).join(', ')}.`, '');
  const byType = ORDER.map((t) => [t, confirmed.filter((n) => n.type === t)] as const).filter(([, l]) => l.length);
  lines.push(byType.map(([t, l]) => plural(t, l.length)).join(' · '), '');

  let ref = 0;
  const refs: string[] = [];
  for (const [t, list] of byType) {
    lines.push(`## ${HEAD[t][1]}`, '');
    for (const n of list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
      const fs = fByNode.get(n.id) ?? [];
      const conf = n.level ? ` — ${LEVEL_LABEL[n.level]} confidence` : '';
      const marks: number[] = [];
      for (const f of fs) for (const e of f.evidence) {
        ref++;
        refs.push(`${ref}. ${e.adapterName}${e.url ? ` — ${e.url}` : ''}${e.snippet ? ` — “${e.snippet}”` : ''} (retrieved ${new Date(e.retrievedAt).toISOString().slice(0, 10)}${e.hash ? ` · fingerprint ${e.hash.slice(0, 12)}` : ''})`);
        marks.push(ref);
      }
      lines.push(`- **${mask(n.label)}**${conf}${marks.length ? ` ${compressRefs(marks)}` : ''}`);
      if (n.notes) lines.push(`  - Note: ${n.notes.replace(/\n/g, ' ')}`);
    }
    lines.push('');
  }

  lines.push('## Relationships', '');
  const name = (id: string) => mask(nodes.find((n) => n.id === id)?.label ?? '?');
  for (const e of edges.filter((x) => x.kind !== 'inferred').slice(0, 200)) lines.push(`- ${name(e.from)} → ${e.label} → ${name(e.to)}`);
  const inferred = edges.filter((x) => x.kind === 'inferred');
  if (inferred.length) {
    lines.push('', '### Inferred (reviewer-confirmed, not directly evidenced)', '');
    for (const e of inferred) lines.push(`- ${name(e.from)} ↔ ${name(e.to)} (${e.label})`);
  }
  if (refs.length) lines.push('', '## Sources', '', ...refs);
  const ig = opts.integrity;
  lines.push('', '## Method and integrity', '',
    '- Each finding is scored from how many *independent* sources report it (sources that share a dataset count once), how much each source has earned your trust, and what cross-checks against other sources confirmed or contradicted. The percentage is an estimate, not a guarantee.',
    '- Every observation carries a SHA-256 fingerprint of what Plexus recorded (source, question asked, page, quote, record fields, time). The fingerprints above can be re-verified in the app at any time.');
  if (ig) lines.push(`- Integrity check at export: ${ig.evidenceChecked} observation fingerprints re-verified, ${ig.altered === 0 ? 'none altered' : `**${ig.altered} ALTERED — do not rely on this report**`}; activity log of ${ig.auditCount} entries is ${ig.auditOk ? 'an unbroken hash chain' : '**BROKEN — entries were edited or removed**'}.`);
  lines.push('', '---', '_Findings are leads, not proof. Name-only matches can describe different people. Verify before acting._');
  return lines.join('\n');
}
