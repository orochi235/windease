import { describe, expect, it } from 'vitest';
import { asNodeId, type NodeId } from './node.js';
import { placeRespectingPins } from './pinning.js';

const ids = (...s: string[]) => s.map(asNodeId);
const pins = (m: Record<string, number>) => (id: NodeId) => m[id] ?? null;

describe('placeRespectingPins', () => {
  it('moves a node normally when nothing is pinned', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c', 'd'), asNodeId('d'), 1, pins({}));
    expect(out).toEqual(['a', 'd', 'b', 'c']);
  });

  it('routes a third party past a held slot', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c', 'd'), asNodeId('d'), 2, pins({ c: 2 }));
    expect(out).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back before the desired slot when nothing after it is free', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c'), asNodeId('a'), 2, pins({ b: 1, c: 2 }));
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('moves a pinned node when it is the one being reordered', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c'), asNodeId('c'), 0, pins({ c: 2 }));
    expect(out).toEqual(['c', 'a', 'b']);
  });

  it('clamps a held index beyond the end of the list', () => {
    const out = placeRespectingPins(ids('a', 'b'), asNodeId('a'), 1, pins({ b: 9 }));
    expect(out).toEqual(['a', 'b']);
  });

  it('treats the loser of a held-index collision as unpinned', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c'), asNodeId('a'), 2, pins({ b: 1, c: 1 }));
    expect(out).toHaveLength(3);
    expect(new Set(out)).toEqual(new Set(['a', 'b', 'c']));
    expect(out[1]).toBe('b');
  });

  it('preserves the relative order of unpinned nodes', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c', 'd', 'e'), asNodeId('e'), 0, pins({ c: 2 }));
    expect(out).toEqual(['e', 'a', 'c', 'b', 'd']);
  });

  it('throws when order is empty (movingId cannot be a member of it)', () => {
    expect(() => placeRespectingPins([], asNodeId('a'), 0, pins({}))).toThrow(
      /not a member of order/,
    );
  });

  it('throws when movingId is not present in order', () => {
    expect(() => placeRespectingPins(ids('a', 'b', 'c'), asNodeId('z'), 1, pins({}))).toThrow(
      /not a member of order/,
    );
  });

  it('clamps a negative desired index to the front', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c'), asNodeId('c'), -5, pins({}));
    expect(out).toEqual(['c', 'a', 'b']);
  });

  it('falls back to the last free slot when every other node is pinned', () => {
    const out = placeRespectingPins(
      ids('a', 'b', 'c', 'd'),
      asNodeId('a'),
      0,
      pins({ b: 0, c: 1, d: 2 }),
    );
    expect(out).toHaveLength(4);
    expect(new Set(out)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('clamps a negative held index to the front', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c'), asNodeId('c'), 2, pins({ b: -3 }));
    expect(out[0]).toBe('b');
    expect(new Set(out)).toEqual(new Set(['a', 'b', 'c']));
  });
});
