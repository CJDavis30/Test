import { describe, it, expect } from 'vitest';
import { explainRelation, confidenceSentence, evidenceStrength, subjectNoun, warningsFor } from '../shared/explain';
import { ENTITY_TYPES } from '../shared/types';

describe('explainRelation', () => {
  it('reads as a plain sentence in both directions, without mangling emails or domains', () => {
    expect(explainRelation('belongs to', 'mara.linden@northwind-labs.example', 'Mara Linden')).toBe('Mara Linden appears to own mara.linden@northwind-labs.example.');
    expect(explainRelation('work email', 'Mara Linden', 'mara.linden@northwind-labs.example')).toBe('mara.linden@northwind-labs.example is Mara Linden’s work email address.');
    expect(explainRelation('subdomain', 'example.com', 'api.example.com')).toBe('api.example.com is a subdomain of example.com.');
    expect(explainRelation('subdomain of', 'api.example.com', 'example.com')).toBe('api.example.com is a subdomain of example.com.');
    expect(explainRelation('resolves to', 'example.com', '93.184.216.34')).toBe('The address example.com points to 93.184.216.34.');
  });
  it('handles bio relations with the platform name', () => {
    expect(explainRelation('listed in GitHub bio', 'torvalds', 'a@b.example')).toBe('a@b.example is listed in torvalds’s GitHub bio.');
    expect(explainRelation('link in DEV bio', 'x', 'https://y.example')).toContain('linked from');
  });
  it('never leaves template placeholders or jargon-only output, even for unknown relations', () => {
    const out = explainRelation('some brand new relation', 'A', 'B');
    expect(out).toBe('B is connected to A (some brand new relation).');
    for (const rel of ['belongs to', 'resolves to', 'appeared in', 'registrar', 'based in', 'works at']) expect(explainRelation(rel, 'S', 'F')).not.toMatch(/[{}]/);
  });
  it('every known sentence mentions both sides', () => {
    // guards against a template that forgets {s} or {f}
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../shared/explain.ts'), 'utf8') as string;
    const lines = [...src.matchAll(/^\s+'([^']+)': '([^']+)',/gm)];
    expect(lines.length).toBeGreaterThan(80);
    for (const [, k, tpl] of lines) if (!/^(open ports|organization \(hunter\)|possible public-figure match)$/.test(k)) expect(tpl.includes('{s}') && (tpl.includes('{f}') || /^The (phone number)/.test(tpl)), `${k}: ${tpl}`).toBe(true);
  });
});

describe('plain-language confidence', () => {
  it('is one short clause that differs by level and by number of sources', () => {
    expect(confidenceSentence(4, 4)).toBe('4 separate sources agree.');
    expect(confidenceSentence(4, 1)).toBe('One high-trust source says so.');
    expect(confidenceSentence(2, 1)).toMatch(/Only one source mentions it/);
    expect(confidenceSentence(1, 3)).toMatch(/Thin evidence/);
    for (const l of [1, 2, 3, 4] as const) expect(confidenceSentence(l, 2).length).toBeLessThan(60);
  });
  it('warns only about things worth pausing on', () => {
    const f = (relation: string, level: 1 | 2 | 3 | 4, fams: string[]) => ({ relation, level, evidence: fams.map((family) => ({ family })), reasons: [] });
    expect(warningsFor(f('belongs to', 4, ['a', 'b', 'c']))).toEqual([]);
    expect(warningsFor(f('belongs to', 3, ['a']))).toEqual(['Only one source backs this.']);
    expect(warningsFor(f('possible namesake', 1, ['a']))).toContain('Same name does not mean same person.');
    expect(warningsFor(f('geolocated to', 2, ['a', 'b']))[0]).toMatch(/Approximate/);
  });
  it('rates evidence by claim strength × trust', () => {
    expect(evidenceStrength(0.9, 0.95).label).toBe('Strong evidence');
    expect(evidenceStrength(0.9, 0.5).label).toBe('Fair evidence');
    expect(evidenceStrength(0.3, 0.6).label).toBe('Weak evidence');
  });
  it('has a noun for every entity type', () => { for (const t of ENTITY_TYPES) expect(subjectNoun(t)).toMatch(/^this /); });
});

it('capitalises sentences that start with a generic subject ("this email") but never an email address', () => {
  expect(explainRelation('also known as', 'this email', 'Mara L. Linden')).toBe('Mara L. Linden looks like another way this email appears online.');
  expect(explainRelation('appears as', 'this email', 'Mara L. Linden')).toBe('This email shows up under the name Mara L. Linden.');
  expect(explainRelation('subdomain', 'example.com', 'api.example.com')).toMatch(/^api\./);
});

import { hedge } from '../shared/explain';
describe('hedging', () => {
  it('never states a weak or contradicted finding as plain fact', () => {
    expect(hedge('Jo uses the handle x.', 4, false)).toBe('Jo uses the handle x.');
    expect(hedge('Jo uses the handle x.', 3, false)).toBe('Jo uses the handle x.');
    expect(hedge('Jo uses the handle x.', 2, false)).toBe('Unconfirmed. Jo uses the handle x.');
    expect(hedge('Jo uses the handle x.', 1, false)).toMatch(/^Unconfirmed\./);
    expect(hedge('Jo uses the handle x.', 4, true)).toBe('Disputed. Jo uses the handle x.');
  });
});
