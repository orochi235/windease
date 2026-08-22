import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { asNodeId, LockedError, type NodeId, Store } from './index.js';
import { deserialize, serialize } from './snapshot.js';
import { recordEvents } from './test-utils/record-events.js';

const id = (s: string) => asNodeId(s);

/** root `r` › group `g` › panels `a`, `b`. `g` is the one that can coalesce. */
function seeded(autoUnsplit = true): { s: Store; r: NodeId; g: NodeId; a: NodeId; b: NodeId } {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('r') }),
  );
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: {} },
      id: id('g'),
      parentId: id('r'),
    }),
  );
  for (const p of ['a', 'b']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(p), parentId: id('g') }));
    s.showNode(id(p));
  }
  if (autoUnsplit) s.setAutoUnsplit(id('g'), true);
  return { s, r: id('r'), g: id('g'), a: id('a'), b: id('b') };
}

const order = (s: Store, parent: NodeId) => s.getContainerView(parent)?.childOrder ?? [];

describe('Store — autoUnsplit', () => {
  it('lifts the last child out and destroys the group', () => {
    const { s, r, g, a, b } = seeded();
    s.unregisterNode(a);
    expect(order(s, r)).toEqual([b]);
    expect(s.getNode(g)).toBeUndefined();
  });

  it('leaves the group alone while two children remain', () => {
    const { s, r, g } = seeded();
    expect(order(s, r)).toEqual([g]);
    expect(order(s, g)).toHaveLength(2);
  });

  it('does nothing when the flag is off', () => {
    const { s, r, g, a, b } = seeded(false);
    s.unregisterNode(a);
    expect(order(s, r)).toEqual([g]);
    expect(order(s, g)).toEqual([b]);
  });

  it('fires when a child is moved out, not only destroyed', () => {
    const { s, r, g, a, b } = seeded();
    s.moveNode(a, r);
    expect(s.getNode(g)).toBeUndefined();
    expect(order(s, r)).toContain(b);
    expect(order(s, r)).toContain(a);
  });

  it('hands the group placement to the survivor', () => {
    const { s, g, a, b } = seeded();
    s.patchPlacement(g, { size: { w: 240 } });
    s.unregisterNode(a);
    expect(s.getPlacement(b).size).toEqual({ w: 240 });
  });

  it('takes the survivor to the group position in the parent', () => {
    const { s, r, a, b } = seeded();
    const first = id('first');
    s.registerNode(createNode({ kind: 'panel', focus: true, id: first, parentId: r }));
    s.showNode(first);
    s.reorderInParent(id('g'), 0);
    s.unregisterNode(a);
    expect(order(s, r)).toEqual([b, first]);
  });

  it('is one transaction, so one undo step', () => {
    const { s, a } = seeded();
    const rec = recordEvents(s, 'transaction.begin', 'transaction.end');
    s.unregisterNode(a);
    expect(rec.of('transaction.begin')).toHaveLength(1);
    expect(rec.of('transaction.end')).toHaveLength(1);
    rec.stop();
  });

  it('does not touch a container that merely holds one child', () => {
    const { s, g } = seeded();
    const inner = id('inner');
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: inner,
        parentId: g,
      }),
    );
    s.setAutoUnsplit(inner, true);
    const leaf = id('leaf');
    s.registerNode(createNode({ kind: 'panel', focus: true, id: leaf, parentId: inner }));
    s.showNode(leaf);
    // `inner` has held exactly one child since `leaf` arrived and is still
    // here: building a group up a child at a time has to be possible.
    expect(s.getNode(inner)).toBeDefined();
    expect(order(s, inner)).toEqual([leaf]);
  });

  it('collapses one level per removal, since the parent count is unchanged', () => {
    const { s, r, g, a } = seeded();
    const inner = id('inner');
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: inner,
        parentId: g,
      }),
    );
    s.setAutoUnsplit(inner, true);
    for (const p of ['leaf1', 'leaf2']) {
      s.registerNode(createNode({ kind: 'panel', focus: true, id: id(p), parentId: inner }));
      s.showNode(id(p));
    }
    // g holds [a, b, inner]; inner holds [leaf1, leaf2].
    s.unregisterNode(id('leaf1'));
    // inner dropped to one child and collapsed into g, which swapped `inner`
    // for `leaf2` and so did not itself drop.
    expect(s.getNode(inner)).toBeUndefined();
    expect(order(s, g)).toEqual([a, id('b'), id('leaf2')]);
    expect(s.getNode(g)).toBeDefined();
    expect(order(s, r)).toEqual([g]);
  });

  it('never coalesces a root, which has no grandparent to lift into', () => {
    const { s, r, g, a, b } = seeded();
    s.setAutoUnsplit(r, true);
    s.unregisterNode(a);
    // g collapsed into r, leaving r with one child and nowhere to go.
    expect(s.getNode(r)).toBeDefined();
    expect(order(s, r)).toEqual([b]);
    expect(s.getNode(g)).toBeUndefined();
  });

  it('leaves the tree alone when a lock forbids the coalesce, without failing the removal', () => {
    const { s, r, g, a, b } = seeded();
    s.setLock(g, { destroy: true });
    expect(() => s.unregisterNode(a)).not.toThrow();
    expect(s.getNode(g)).toBeDefined();
    expect(order(s, g)).toEqual([b]);
    expect(order(s, r)).toEqual([g]);
  });

  it('round-trips the flag through the container view', () => {
    const { s, g } = seeded();
    expect(s.getContainerView(g)?.autoUnsplit).toBe(true);
    s.setAutoUnsplit(g, false);
    expect(s.getContainerView(g)?.autoUnsplit).toBe(false);
  });
});

describe('Store — setAutoUnsplit', () => {
  it('refuses a node with no container', () => {
    const { s, a } = seeded();
    expect(() => s.setAutoUnsplit(a, true)).toThrow();
  });

  it('is refused on an arrange-locked container', () => {
    const { s, g } = seeded(false);
    s.setLock(g, { arrange: true });
    expect(() => s.setAutoUnsplit(g, true)).toThrow(LockedError);
  });
});

describe('autoUnsplit — snapshot', () => {
  it('round-trips the flag', () => {
    const { s, g } = seeded();
    const restored = deserialize(serialize(s));
    expect(restored.getContainerView(g)?.autoUnsplit).toBe(true);
  });

  it('leaves a container that never set it off, not undefined-and-truthy', () => {
    const { s, r } = seeded();
    const restored = deserialize(serialize(s));
    expect(restored.getContainerView(r)?.autoUnsplit).toBe(false);
  });

  it('still coalesces after a round-trip', () => {
    const { s, r, g, a, b } = seeded();
    const restored = deserialize(serialize(s));
    restored.unregisterNode(a);
    expect(restored.getNode(g)).toBeUndefined();
    expect(restored.getContainerView(r)?.childOrder).toEqual([b]);
  });
});
