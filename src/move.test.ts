import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import type { GeometrySource } from './focus/types.js';
import type { Rect } from './layout-types.js';
import { applyMove, resolveMove } from './move.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

type Rects = Record<string, Rect>;

function geometryOf(map: Rects): GeometrySource {
  return { rectOf: (nid) => map[nid] ?? null };
}

/** One strip zone holding a b c left to right. */
function row(): { store: Store; geometry: GeometrySource } {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  store.showNode(id('z'));
  for (const c of ['a', 'b', 'c']) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    store.showNode(id(c));
  }
  return {
    store,
    geometry: geometryOf({
      a: { x: 0, y: 0, z: 0, w: 100, h: 100 },
      b: { x: 100, y: 0, z: 0, w: 100, h: 100 },
      c: { x: 200, y: 0, z: 0, w: 100, h: 100 },
    }),
  };
}

/** Two strip zones side by side: z1 holds a b, z2 holds c d. */
function twoZones(): { store: Store; geometry: GeometrySource } {
  const store = new Store();
  for (const z of ['z1', 'z2']) {
    store.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id(z) }),
    );
    store.showNode(id(z));
  }
  const pairs: [string, string][] = [
    ['a', 'z1'],
    ['b', 'z1'],
    ['c', 'z2'],
    ['d', 'z2'],
  ];
  for (const [c, z] of pairs) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id(z) }));
    store.showNode(id(c));
  }
  return {
    store,
    geometry: geometryOf({
      a: { x: 0, y: 0, z: 0, w: 100, h: 100 },
      b: { x: 100, y: 0, z: 0, w: 100, h: 100 },
      c: { x: 300, y: 0, z: 0, w: 100, h: 100 },
      d: { x: 400, y: 0, z: 0, w: 100, h: 100 },
    }),
  };
}

const order = (store: Store, parent: string) =>
  store.getNode(id(parent))?.container?.childOrder.map(String);

describe('resolveMove — within one parent', () => {
  it('right takes the index of the node it passes', () => {
    const { store, geometry } = row();
    const plan = resolveMove({ store, from: id('b'), direction: 'right', geometry });
    expect(plan).toEqual({ kind: 'reorder', id: id('b'), parentId: id('z'), at: 2 });
  });

  it('left takes the index of the node it passes', () => {
    const { store, geometry } = row();
    const plan = resolveMove({ store, from: id('b'), direction: 'left', geometry });
    expect(plan).toEqual({ kind: 'reorder', id: id('b'), parentId: id('z'), at: 0 });
  });

  it('returns null at the edge rather than wrapping', () => {
    const { store, geometry } = row();
    expect(resolveMove({ store, from: id('c'), direction: 'right', geometry })).toBeNull();
  });

  it('applying a reorder rewrites childOrder', () => {
    const { store, geometry } = row();
    const plan = resolveMove({ store, from: id('b'), direction: 'right', geometry });
    if (plan) applyMove(store, plan);
    expect(order(store, 'z')).toEqual(['a', 'c', 'b']);
  });
});

describe('resolveMove — across parents', () => {
  it('reparents into the container the target leaf lives in', () => {
    const { store, geometry } = twoZones();
    const plan = resolveMove({ store, from: id('b'), direction: 'right', geometry });
    expect(plan).toEqual({
      kind: 'reparent',
      id: id('b'),
      fromParentId: id('z1'),
      parentId: id('z2'),
      at: 0,
    });
  });

  it('applying a reparent moves the node between containers', () => {
    const { store, geometry } = twoZones();
    const plan = resolveMove({ store, from: id('b'), direction: 'right', geometry });
    if (plan) applyMove(store, plan);
    expect(order(store, 'z1')).toEqual(['a']);
    expect(order(store, 'z2')).toEqual(['b', 'c', 'd']);
  });

  it('a reparent is one undo step', () => {
    const { store, geometry } = twoZones();
    const seen: string[] = [];
    store.events.on('node.moved', () => seen.push('moved'));
    const plan = resolveMove({ store, from: id('b'), direction: 'right', geometry });
    if (plan) applyMove(store, plan);
    expect(seen).toEqual(['moved']);
  });
});

describe('resolveMove — refusals', () => {
  it('refuses a node with no parent', () => {
    const { store, geometry } = row();
    expect(resolveMove({ store, from: id('z'), direction: 'right', geometry })).toBeNull();
  });

  it('refuses when the node is move-locked', () => {
    const { store, geometry } = row();
    store.setLock(id('b'), { move: true });
    expect(resolveMove({ store, from: id('b'), direction: 'right', geometry })).toBeNull();
  });

  it('refuses when the destination will not accept', () => {
    const { store, geometry } = twoZones();
    store.setLock(id('z2'), { accept: true });
    expect(resolveMove({ store, from: id('b'), direction: 'right', geometry })).toBeNull();
  });

  it('refuses when the source will not let go', () => {
    const { store, geometry } = twoZones();
    store.setLock(id('z1'), { dragOut: true });
    expect(resolveMove({ store, from: id('b'), direction: 'right', geometry })).toBeNull();
  });

  it('refuses a reorder when the parent is arrange-locked', () => {
    const { store, geometry } = row();
    store.setLock(id('z'), { arrange: true });
    expect(resolveMove({ store, from: id('b'), direction: 'right', geometry })).toBeNull();
  });

  it('refuses to move a node inside its own subtree', () => {
    const store = new Store();
    store.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
    );
    store.showNode(id('z'));
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: id('g'),
        parentId: id('z'),
      }),
    );
    store.showNode(id('g'));
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id('x'), parentId: id('g') }));
    store.showNode(id('x'));
    const geometry = geometryOf({
      g: { x: 0, y: 0, z: 0, w: 100, h: 100 },
      x: { x: 100, y: 0, z: 0, w: 100, h: 100 },
    });
    expect(resolveMove({ store, from: id('g'), direction: 'right', geometry })).toBeNull();
  });
});

describe('resolveMove — pins', () => {
  it('a pinned neighbor keeps its index when passed', () => {
    const { store, geometry } = row();
    store.setPinned(id('a'), 0);
    const plan = resolveMove({ store, from: id('b'), direction: 'left', geometry });
    if (plan) applyMove(store, plan);
    expect(order(store, 'z')?.[0]).toBe('a');
  });
});
