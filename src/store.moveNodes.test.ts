import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { asNodeId, CycleError, LockedError, type NodeId, Store } from './index.js';
import { recordEvents } from './test-utils/record-events.js';

const id = (s: string) => asNodeId(s);
const order = (s: Store, parent: NodeId) => s.getContainerView(parent)?.childOrder ?? [];

/** Two sibling zones under a root, `src` holding `a b c d` and `dst` holding `x y`. */
function seeded(): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('r') }),
  );
  for (const z of ['src', 'dst']) {
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: id(z),
        parentId: id('r'),
      }),
    );
  }
  for (const p of ['a', 'b', 'c', 'd']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(p), parentId: id('src') }));
    s.showNode(id(p));
  }
  for (const p of ['x', 'y']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(p), parentId: id('dst') }));
    s.showNode(id(p));
  }
  return s;
}

describe('Store — moveNodes', () => {
  it('lands the whole set together at the insertion point', () => {
    const s = seeded();
    s.moveNodes([id('a'), id('b')], id('dst'), 1);
    expect(order(s, id('dst'))).toEqual([id('x'), id('a'), id('b'), id('y')]);
    expect(order(s, id('src'))).toEqual([id('c'), id('d')]);
  });

  it('arrives in source order when every node comes from one parent', () => {
    const s = seeded();
    s.moveNodes([id('c'), id('a')], id('dst'));
    expect(order(s, id('dst'))).toEqual([id('x'), id('y'), id('a'), id('c')]);
  });

  it('arrives in the order given when the nodes come from several parents', () => {
    const s = seeded();
    s.moveNodes([id('y'), id('a')], id('src'), 0);
    expect(order(s, id('src'))).toEqual([id('y'), id('a'), id('b'), id('c'), id('d')]);
  });

  it('drops repeated ids', () => {
    const s = seeded();
    s.moveNodes([id('a'), id('a'), id('b')], id('dst'));
    expect(order(s, id('dst'))).toEqual([id('x'), id('y'), id('a'), id('b')]);
  });

  it('drops a node whose ancestor is also in the set', () => {
    const s = seeded();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: id('g'),
        parentId: id('src'),
      }),
    );
    s.moveNode(id('d'), id('g'));
    const rec = recordEvents(s, 'node.moved');
    s.moveNodes([id('g'), id('d')], id('dst'));
    expect(order(s, id('dst'))).toEqual([id('x'), id('y'), id('g')]);
    expect(order(s, id('g'))).toEqual([id('d')]);
    expect(rec.of('node.moved').map((e) => e.id)).toEqual([id('g')]);
    rec.stop();
  });

  it('validates the whole set before moving anything', () => {
    const s = seeded();
    s.setLock(id('c'), { move: true });
    expect(() => s.moveNodes([id('a'), id('b'), id('c')], id('dst'))).toThrow(LockedError);
    expect(order(s, id('src'))).toEqual([id('a'), id('b'), id('c'), id('d')]);
    expect(order(s, id('dst'))).toEqual([id('x'), id('y')]);
  });

  it("refuses a move into a node's own descendant", () => {
    const s = seeded();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: id('g'),
        parentId: id('src'),
      }),
    );
    expect(() => s.moveNodes([id('src')], id('g'))).toThrow(CycleError);
  });

  it('coalesces the source once, after the last node has landed', () => {
    const s = seeded();
    s.setAutoUnsplit(id('src'), true);
    s.moveNodes([id('a'), id('b'), id('c')], id('dst'));
    // `src` was left holding one child, so it dissolved and lifted `d` to the root.
    expect(s.getNode(id('src'))).toBeUndefined();
    expect(order(s, id('r'))).toEqual([id('d'), id('dst')]);
    expect(order(s, id('dst'))).toEqual([id('x'), id('y'), id('a'), id('b'), id('c')]);
  });

  it('does not dissolve a source the batch empties down to one and then refills', () => {
    const s = seeded();
    s.setAutoUnsplit(id('src'), true);
    s.moveNodes([id('a'), id('b')], id('dst'));
    expect(s.getNode(id('src'))).toBeDefined();
    expect(order(s, id('src'))).toEqual([id('c'), id('d')]);
  });

  it('keeps the run contiguous next to a pin', () => {
    const s = seeded();
    s.setPinned(id('x'), 0);
    s.moveNodes([id('a'), id('b')], id('dst'), 0);
    expect(order(s, id('dst'))).toEqual([id('x'), id('a'), id('b'), id('y')]);
  });

  it('repositions a same-parent member instead of moving it', () => {
    const s = seeded();
    const rec = recordEvents(s, 'node.moved', 'node.reordered', 'node.transitioned');
    s.moveNodes([id('d')], id('src'), 0);
    expect(order(s, id('src'))).toEqual([id('d'), id('a'), id('b'), id('c')]);
    expect(rec.of('node.moved')).toEqual([]);
    expect(rec.of('node.reordered')).toEqual([
      { parentId: id('src'), id: id('d'), fromIndex: 3, toIndex: 0 },
    ]);
    expect(rec.of('node.transitioned').filter((e) => e.machine === 'transit')).toEqual([]);
    rec.stop();
  });

  it('brackets the batch in one transaction', () => {
    const s = seeded();
    const rec = recordEvents(s, 'transaction.begin', 'transaction.end');
    s.moveNodes([id('a'), id('b'), id('c')], id('dst'));
    expect(rec.of('transaction.begin')).toEqual([{ label: 'moveNodes' }]);
    expect(rec.of('transaction.end')).toEqual([{ label: 'moveNodes' }]);
    rec.stop();
  });

  it('reports each moved node with the index it actually landed on', () => {
    const s = seeded();
    const rec = recordEvents(s, 'node.moved');
    s.moveNodes([id('a'), id('b')], id('dst'), 1);
    expect(rec.of('node.moved')).toEqual([
      {
        id: id('a'),
        fromParentId: id('src'),
        toParentId: id('dst'),
        fromIndex: 0,
        toIndex: 1,
      },
      {
        id: id('b'),
        fromParentId: id('src'),
        toParentId: id('dst'),
        fromIndex: 1,
        toIndex: 2,
      },
    ]);
    rec.stop();
  });

  it('carries placement across the move, as moveNode does', () => {
    const s = seeded();
    s.setPlacement(id('a'), 'size', 300);
    s.moveNodes([id('a')], id('dst'));
    expect(s.getNode(id('a'))?.membership?.placement).toMatchObject({ size: 300 });
  });

  it('leaves the focused node focused and remembered up its new chain', () => {
    const s = seeded();
    s.focusNode(id('a'));
    s.moveNodes([id('a'), id('b')], id('dst'));
    expect(s.focusedId).toBe(id('a'));
    expect(s.getNode(id('dst'))?.container?.lastFocusedId).toBe(id('a'));
    expect(s.getNode(id('src'))?.container?.lastFocusedId).toBeUndefined();
  });

  it('does nothing when the set is empty', () => {
    const s = seeded();
    const rec = recordEvents(s, 'transaction.begin');
    s.moveNodes([], id('dst'));
    expect(order(s, id('dst'))).toEqual([id('x'), id('y')]);
    expect(rec.of('transaction.begin')).toEqual([]);
    rec.stop();
  });
});
