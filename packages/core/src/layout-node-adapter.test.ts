import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { stackStrategy } from './layout/stack.js';
import {
  getLayoutNodes,
  nodeToLayoutItem,
  nodeToLayoutNode,
  runStrategyForContainer,
} from './layout-node-adapter.js';
import { asNodeId } from './node.js';
import { WindeaseNodeStore } from './store-v2.js';

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
  it('returns visible children in childIds order, excludes hidden', () => {
    const s = new WindeaseNodeStore();
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

describe('runStrategyForContainer', () => {
  it('runs stackStrategy on a container, returns NodeId-keyed placements', () => {
    const s = new WindeaseNodeStore();
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
      ? stackStrategy.initialState([
          { id: 'a' },
          { id: 'b' },
        ])
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
