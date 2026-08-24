import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { asNodeId, DuplicateNodeError, LockedError, type NodeId, Store } from './index.js';
import { serialize } from './snapshot.js';

const id = (s: string) => asNodeId(s);

/** zone `z` (horizontal strip) › panels `a`, `b`, `c`. */
function seeded(): { s: Store; z: NodeId; a: NodeId; b: NodeId; c: NodeId } {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x' } },
      id: id('z'),
    }),
  );
  for (const p of ['a', 'b', 'c']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(p), parentId: id('z') }));
    s.showNode(id(p));
  }
  return { s, z: id('z'), a: id('a'), b: id('b'), c: id('c') };
}

const order = (s: Store, parent: NodeId) => s.getContainerView(parent)?.childOrder ?? [];

describe('Store.splitInto', () => {
  it('wraps both nodes in a strip at the onto-child slot', () => {
    const { s, z, a, b, c } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(order(s, z)).toEqual([id('g1'), c]);
    expect(order(s, id('g1'))).toEqual([a, b]);
    expect(s.getNode(id('g1'))?.container?.strategyId).toBe('strip');
  });

  it('puts the source last when the edge is the end', () => {
    const { s, a, b } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'end' });
    expect(order(s, id('g1'))).toEqual([b, a]);
  });

  it('gives the group the requested axis and fills it', () => {
    const { s, a, b } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(s.getNode(id('g1'))?.container?.config).toMatchObject({ axis: 'y', fill: true });
  });

  it('merges caller config over the defaults', () => {
    const { s, a, b } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start', config: { gap: 8 } });
    expect(s.getNode(id('g1'))?.container?.config).toMatchObject({ axis: 'y', fill: true, gap: 8 });
  });

  it('keeps the onto-child index rather than appending', () => {
    const { s, z, a, c } = seeded();
    s.splitInto(a, c, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(order(s, z)).toEqual([id('b'), id('g1')]);
  });

  it('gives the group the placement the onto-child was carrying', () => {
    const { s, a, b } = seeded();
    s.patchPlacement(b, { size: { w: 300 } });
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(s.getNode(id('g1'))?.membership?.placement).toMatchObject({ size: { w: 300 } });
  });

  it('clears a stale size from both children', () => {
    const { s, a, b } = seeded();
    s.patchPlacement(b, { size: { w: 300 } });
    s.patchPlacement(a, { size: { w: 120 } });
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(s.getNode(a)?.membership?.placement?.size).toBeUndefined();
    expect(s.getNode(b)?.membership?.placement?.size).toBeUndefined();
  });

  it('moves a pin from the onto-child to the group', () => {
    const { s, a, b } = seeded();
    s.setPinned(b, 0);
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(s.getPinnedIndex(id('g1'))).toBe(0);
    expect(s.getPinnedIndex(b)).toBeNull();
  });

  it("drops the source's own pin, which indexed the parent it left", () => {
    const { s, a, b } = seeded();
    s.setPinned(a, 0);
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(s.getPinnedIndex(a)).toBeNull();
  });

  it('sets autoUnsplit so dragging one child out dissolves the group', () => {
    const { s, z, a, b, c } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    s.moveNode(a, z);
    expect(s.getNode(id('g1'))).toBeUndefined();
    expect(order(s, z)).toEqual([b, c, a]);
  });

  it('refuses to split a node onto itself and leaves the tree untouched', () => {
    const { s, a } = seeded();
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(a, a, { id: id('g1'), axis: 'y', edge: 'start' })).toThrow();
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses to split onto its own descendant and leaves the tree untouched', () => {
    const { s, a, b } = seeded();
    s.splitInto(b, a, { id: id('g1'), axis: 'y', edge: 'start' });
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(id('g1'), b, { id: id('g2'), axis: 'x', edge: 'start' })).toThrow();
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  // Asserting the tree is untouched would pass without the pre-transaction
  // guard too: `registerNode` throws as the transaction's first statement, so
  // nothing has mutated yet either way. What the guard actually buys is that no
  // transaction opens at all, which is what a history integration sees.
  it('refuses a duplicate group id without opening a transaction', () => {
    const { s, a, b, c } = seeded();
    let begins = 0;
    s.events.on('transaction.begin', () => {
      begins += 1;
    });
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(a, b, { id: c, axis: 'y', edge: 'start' })).toThrow(
      DuplicateNodeError,
    );
    expect(begins).toBe(0);
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses when the onto-child is move-locked, before mutating anything', () => {
    const { s, a, b } = seeded();
    s.setLock(b, { move: true });
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' })).toThrow(
      LockedError,
    );
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses when the parent is arrange-locked, before mutating anything', () => {
    const { s, z, a, b } = seeded();
    s.setLock(z, { arrange: true });
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' })).toThrow(
      LockedError,
    );
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('is one undo step', () => {
    const { s, a, b } = seeded();
    let begins = 0;
    let ends = 0;
    s.events.on('transaction.begin', () => {
      begins += 1;
    });
    s.events.on('transaction.end', () => {
      ends += 1;
    });
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(begins).toBe(1);
    expect(ends).toBe(1);
  });
});
