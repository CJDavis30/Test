import type { CaseInfo, EntityType, Finding, GraphEdge, GraphNode } from '../shared/types';
import { ENTITY_LABEL, LEVEL_LABEL } from '../shared/types';

const ORDER: EntityType[] = ['person', 'org', 'email', 'phone', 'username', 'account', 'location', 'domain', 'ip', 'url', 'wallet', 'breach', 'image'];

/** A plain Markdown report of everything the investigator confirmed, with provenance. */
export function buildReport(c: CaseInfo, nodes: GraphNode[], edges: GraphEdge[], accepted: Finding[], opts: { redact?: boolean } = {}): string {
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
  lines.push(byType.map(([t, l]) => `${l.length} ${ENTITY_LABEL[t].toLowerCase()}${l.length === 1 ? '' : 's'}`).join(' · '), '');

  let ref = 0;
  const refs: string[] = [];
  for (const [t, list] of byType) {
    lines.push(`## ${ENTITY_LABEL[t]}s`, '');
    for (const n of list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
      const fs = fByNode.get(n.id) ?? [];
      const conf = n.level ? ` — ${LEVEL_LABEL[n.level]} confidence` : '';
      const marks: string[] = [];
      for (const f of fs) for (const e of f.evidence) {
        ref++;
        refs.push(`${ref}. ${e.adapterName}${e.url ? ` — ${e.url}` : ''}${e.snippet ? ` — “${e.snippet}”` : ''} (retrieved ${new Date(e.retrievedAt).toISOString().slice(0, 10)})`);
        marks.push(`[${ref}]`);
        if (marks.length >= 4) break;
      }
      lines.push(`- **${mask(n.label)}**${conf}${marks.length ? ` ${marks.join('')}` : ''}`);
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
  lines.push('', '---', '_Findings are leads, not proof. Name-only matches can describe different people. Verify before acting._');
  return lines.join('\n');
}
