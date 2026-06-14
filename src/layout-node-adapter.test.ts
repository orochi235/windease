import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import {
  getLayoutNodes,
  nodeToLayoutItem,
  nodeToLayoutNode,
  runStrategyForContainer,
} from './layout-node-adapter.js';
import { stackStrategy } from './layout/stack.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

describe('nodeToLayoutItem', () => {
  it('converts hints', () => {
    const n = createPanel({
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

  it('projects placement → meta', () => {
    const n = createPanel({
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      placement: { pinned: true, locked: false },
    });
    const item = nodeToLayoutItem(n);
    expect(item.meta).toEqual({ pinned: true, locked: false });
  });

  it('omits meta when placement is empty', () => {
    const n = createPanel({ id: asNodeId('p'), parentId: asNodeId('z') });
    const item = nodeToLayoutItem(n);
    expect(item.meta).toBeUndefined();
  });

  it('propagates hints.maxSize', () => {
    const n = createPanel({
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      hints: { minSize: { w: 10, h: 10 }, maxSize: { w: 200, h: 300 } },
    });
    const item = nodeToLayoutItem(n);
    expect(item.hints?.maxSize).toEqual({ w: 200, h: 300 });
  });

  it('surfaces placement.size as item.placement.size', () => {
    const n = createPanel({
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      placement: { pinned: true, size: { h: 180 } },
    });
    const item = nodeToLayoutItem(n);
    expect(item.placement?.size).toEqual({ h: 180 });
    // size lives under placement, not duplicated into the meta flag bag.
    expect(item.meta).toEqual({ pinned: true, size: { h: 180 } });
  });

  it('omits placement when there is no size', () => {
    const n = createPanel({
      id: asNodeId('p'),
      parentId: asNodeId('z'),
      placement: { pinned: true },
    });
    const item = nodeToLayoutItem(n);
    expect(item.placement).toBeUndefined();
  });
});

describe('nodeToLayoutNode', () => {
  it('copies all fields including isContainer', () => {
    const recursive = createPanel({
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
    const leaf = createPanel({ id: asNodeId('p'), parentId: asNodeId('z') });
    expect(nodeToLayoutNode(leaf).isContainer).toBe(false);
  });
});

describe('getLayoutNodes', () => {
  it('returns visible children in childOrder order, excludes hidden', () => {
    const s = new Store();
    s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    s.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    s.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    s.registerNode(createPanel({ id: asNodeId('c'), parentId: asNodeId('z') }));
    s.showNode(asNodeId('a'));
    s.showNode(asNodeId('b'));
    s.showNode(asNodeId('c'));
    s.hideNode(asNodeId('b'));
    const ln = getLayoutNodes(s, asNodeId('z'));
    expect(ln.map((n) => n.id)).toEqual(['a', 'c']);
  });
});

describe('layout-node-adapter — activity passthrough', () => {
  it('nodeToLayoutNode populates activity (defaults to {})', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    const before = nodeToLayoutNode(store.getNode(asNodeId('p'))!);
    expect(before.activity).toEqual({});

    store.patchActivity(asNodeId('p'), { busy: true, lastAt: 42 });
    const after = nodeToLayoutNode(store.getNode(asNodeId('p'))!);
    expect(after.activity).toEqual({ busy: true, lastAt: 42 });
  });

  it('runStrategyForContainer exposes activity to LayoutNodes (via getLayoutNodes)', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('p2'), parentId: asNodeId('z') }));
    store.showNode(asNodeId('p1'));
    store.showNode(asNodeId('p2'));
    store.patchActivity(asNodeId('p2'), { lastAt: 100 });
    const nodes = getLayoutNodes(store, asNodeId('z'));
    expect(nodes.map((n) => n.activity)).toEqual([{}, { lastAt: 100 }]);
  });
});

describe('runStrategyForContainer', () => {
  it('runs stackStrategy on a container, returns NodeId-keyed placements', () => {
    const s = new Store();
    s.registerNode(
      createZone({
        id: asNodeId('z'),
        strategyId: 'stack',
        config: { axis: 'vertical', defaultItemSize: 50 },
      }),
    );
    s.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    s.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    const initial = stackStrategy.initialState
      ? stackStrategy.initialState([{ id: 'a' }, { id: 'b' }])
      : undefined;
    const result = runStrategyForContainer(
      s,
      asNodeId('z'),
      { w: 200, h: 200 },
      stackStrategy,
      initial as never,
    );
    expect(result.placements.size).toBeGreaterThan(0);
    expect(result.placements.has(asNodeId('a'))).toBe(true);
    expect(result.placements.has(asNodeId('b'))).toBe(true);
  });
});
