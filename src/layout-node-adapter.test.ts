import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { stripStrategy } from './layout/strip.js';
import {
  getLayoutNodes,
  nodeToLayoutItem,
  nodeToLayoutNode,
  runStrategyForContainer,
} from './layout-node-adapter.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

describe('nodeToLayoutItem', () => {
  it('converts hints', () => {
    const n = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      hints: { minSize: { w: 10, h: 20 }, preferredSize: { w: 100, h: 200 } },
    });
    const item = nodeToLayoutItem(n);
    expect(item.id).toBe('p');
    expect(item.hints).toEqual({
      minSize: { w: 10, h: 20 },
      preferredSize: { w: 100, h: 200 },
    });
  });

  it('projects the whole placement bag into placement, with meta as the same object', () => {
    const n = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      placement: { pinned: 0, column: 'left' },
    });
    const item = nodeToLayoutItem(n);
    expect(item.placement).toEqual({ pinned: 0, column: 'left' });
    expect(item.meta).toBe(item.placement);
  });

  it('omits meta when placement is empty', () => {
    const n = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p'),
      parentId: asNodeId('z'),
    });
    const item = nodeToLayoutItem(n);
    expect(item.meta).toBeUndefined();
  });

  it('propagates hints.maxSize', () => {
    const n = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      hints: { minSize: { w: 10, h: 10 }, maxSize: { w: 200, h: 300 } },
    });
    const item = nodeToLayoutItem(n);
    expect(item.hints?.maxSize).toEqual({ w: 200, h: 300 });
  });

  it('propagates hints.aspect', () => {
    const n = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      hints: { aspect: 1.5 },
    });
    expect(nodeToLayoutItem(n).hints).toEqual({ aspect: 1.5 });
  });

  it('surfaces placement.size as item.placement.size', () => {
    const n = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      placement: { pinned: true, size: { h: 180 } },
    });
    const item = nodeToLayoutItem(n);
    expect(item.placement).toEqual({ pinned: true, size: { h: 180 } });
  });

  it('omits placement when the bag is empty', () => {
    const n = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p'),
      parentId: asNodeId('z'),
    });
    expect(nodeToLayoutItem(n).placement).toBeUndefined();
  });
});

describe('nodeToLayoutNode', () => {
  it('copies all fields including isContainer', () => {
    const recursive = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      meta: { title: 't' },
      placement: { pinned: true },
      container: { strategyId: 'stack', config: {} },
    });
    const ln = nodeToLayoutNode(recursive);
    expect(ln.id).toBe('p');
    expect(ln.kind).toBe('panel');
    expect(ln.meta).toEqual({ title: 't' });
    expect(ln.placement).toEqual({ pinned: true });
    expect(ln.isContainer).toBe(true);
  });

  it('isContainer false for leaf panels', () => {
    const leaf = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p'),
      parentId: asNodeId('z'),
    });
    expect(nodeToLayoutNode(leaf).isContainer).toBe(false);
  });
});

describe('getLayoutNodes', () => {
  it('returns visible children in childOrder order, excludes hidden', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('a'),
        parentId: asNodeId('z'),
      }),
    );
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('b'),
        parentId: asNodeId('z'),
      }),
    );
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('c'),
        parentId: asNodeId('z'),
      }),
    );
    s.showNode(asNodeId('a'));
    s.showNode(asNodeId('b'));
    s.showNode(asNodeId('c'));
    s.hideNode(asNodeId('b'));
    const ln = getLayoutNodes(s, asNodeId('z'));
    expect(ln.map((n) => n.id)).toEqual(['a', 'c']);
  });

  it('excludes a child that was registered and never shown', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    s.registerNode(createNode({ kind: 'panel', id: asNodeId('a'), parentId: asNodeId('z') }));
    s.registerNode(createNode({ kind: 'panel', id: asNodeId('b'), parentId: asNodeId('z') }));
    s.showNode(asNodeId('b'));
    expect(getLayoutNodes(s, asNodeId('z')).map((n) => n.id)).toEqual(['b']);
  });
});

describe('layout-node-adapter — activity passthrough', () => {
  it('nodeToLayoutNode populates activity (defaults to {})', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    const before = nodeToLayoutNode(store.getNode(asNodeId('p'))!);
    expect(before.activity).toEqual({});

    store.patchActivity(asNodeId('p'), { busy: true, lastAt: 42 });
    const after = nodeToLayoutNode(store.getNode(asNodeId('p'))!);
    expect(after.activity).toEqual({ busy: true, lastAt: 42 });
  });

  it('runStrategyForContainer exposes activity to LayoutNodes (via getLayoutNodes)', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p1'),
        parentId: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p2'),
        parentId: asNodeId('z'),
      }),
    );
    store.showNode(asNodeId('p1'));
    store.showNode(asNodeId('p2'));
    store.patchActivity(asNodeId('p2'), { lastAt: 100 });
    const nodes = getLayoutNodes(store, asNodeId('z'));
    expect(nodes.map((n) => n.activity)).toEqual([{}, { lastAt: 100 }]);
  });
});

describe('runStrategyForContainer', () => {
  it('runs stripStrategy on a container, returns NodeId-keyed placements', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'y', fill: true, defaultItemSize: 50 } },
        id: asNodeId('z'),
      }),
    );
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('a'),
        parentId: asNodeId('z'),
      }),
    );
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('b'),
        parentId: asNodeId('z'),
      }),
    );
    s.showNode(asNodeId('a'));
    s.showNode(asNodeId('b'));
    const initial = stripStrategy.initialState
      ? stripStrategy.initialState([{ id: 'a' }, { id: 'b' }])
      : undefined;
    const result = runStrategyForContainer(
      s,
      asNodeId('z'),
      { w: 200, h: 200 },
      stripStrategy,
      initial as never,
    );
    expect(result.placements.size).toBeGreaterThan(0);
    expect(result.placements.has(asNodeId('a'))).toBe(true);
    expect(result.placements.has(asNodeId('b'))).toBe(true);
  });

  it('gives a child that was registered and never shown no room and no seam', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'x', fill: true, resizable: true } },
        id: asNodeId('z'),
      }),
    );
    s.registerNode(
      createNode({
        kind: 'panel',
        id: asNodeId('side'),
        parentId: asNodeId('z'),
        placement: { size: { w: 80 } },
      }),
    );
    s.registerNode(createNode({ kind: 'panel', id: asNodeId('main'), parentId: asNodeId('z') }));
    s.showNode(asNodeId('main'));
    const result = runStrategyForContainer(
      s,
      asNodeId('z'),
      { w: 200, h: 100 },
      stripStrategy,
      undefined as never,
    );
    expect([...result.placements.keys()]).toEqual(['main']);
    expect(result.placements.get(asNodeId('main'))).toMatchObject({ x: 0, w: 200 });
    expect(result.affordances).toEqual([]);
  });
});
