import { describe, it, expect } from 'vitest';
import { shortestPath, neighborhood } from '../web/src/lib/graphMath';

const n = (id: string) => ({ id });
const e = (id: string, from: string, to: string, strength: number) => ({ id, from, to, strength });

describe('shortestPath', () => {
  it('prefers a confident two-hop chain over a weak direct edge', () => {
    const r = shortestPath([n('a'), n('b'), n('c')], [e('ac', 'a', 'c', 0.1), e('ab', 'a', 'b', 0.95), e('bc', 'b', 'c', 0.95)], 'a', 'c')!;
    expect(r.nodes).toEqual(['a', 'b', 'c']);
    expect(r.strength).toBeCloseTo(0.9025, 3);
  });
  it('returns null when disconnected and handles identical endpoints', () => {
    expect(shortestPath([n('a'), n('b')], [], 'a', 'b')).toBeNull();
    expect(shortestPath([n('a')], [], 'a', 'a')?.nodes).toEqual(['a']);
  });
});

describe('neighborhood', () => {
  it('expands by depth', () => {
    const edges = [e('1', 'a', 'b', 1), e('2', 'b', 'c', 1), e('3', 'c', 'd', 1)];
    expect([...neighborhood(edges, 'a', 1)].sort()).toEqual(['a', 'b']);
    expect([...neighborhood(edges, 'a', 2)].sort()).toEqual(['a', 'b', 'c']);
  });
});
