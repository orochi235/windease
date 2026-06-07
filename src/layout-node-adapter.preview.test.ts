import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { runStrategyForContainer } from './layout-node-adapter.js';
import { stackStrategy } from './layout/stack.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

describe('runStrategyForContainer — preview', () => {
  it('splices the insertId at insertIndex when previewing', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    const result = runStrategyForContainer(
      store,
      asNodeId('z'),
      { w: 100, h: 300 },
      stackStrategy,
      undefined,
      {
        insertId: 'ghost',
        insertIndex: 1,
        cursor: { x: 50, y: 100 },
      },
    );
    // 3 placements: a, ghost, b (in that order)
    expect(Array.from(result.placements.keys())).toEqual(['a', 'ghost', 'b']);
  });

  it('appends the insertId when insertIndex is undefined', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.showNode(asNodeId('a'));
    const result = runStrategyForContainer(
      store,
      asNodeId('z'),
      { w: 100, h: 200 },
      stackStrategy,
      undefined,
      {
        insertId: 'ghost',
        cursor: { x: 50, y: 50 },
      },
    );
    expect(Array.from(result.placements.keys())).toEqual(['a', 'ghost']);
  });

  it('reorders existing source for same-parent preview', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('c'), parentId: asNodeId('z') }));
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    store.showNode(asNodeId('c'));
    const result = runStrategyForContainer(
      store,
      asNodeId('z'),
      { w: 100, h: 300 },
      stackStrategy,
      undefined,
      {
        insertId: 'a',
        insertIndex: 2,
        cursor: { x: 50, y: 200 },
      },
    );
    expect(Array.from(result.placements.keys())).toEqual(['b', 'c', 'a']);
  });
});
