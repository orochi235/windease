import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, getLayoutNodes, Store } from './index.js';

describe('preset constructors — capability shape', () => {
  it('builds a 3-level tree of zone → recursive panel → leaf panel', () => {
    const trayHost = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('tray'),
      parentId: asNodeId('z'),
      container: { strategyId: 'stack', config: { axis: 'vertical' } },
    });
    const leaf = createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('leaf'),
      parentId: asNodeId('tray'),
    });
    expect(trayHost.container).toBeDefined();
    expect(trayHost.membership?.parentId).toBe('z');
    expect(leaf.membership?.parentId).toBe('tray');
  });

  it('builds a group inside a zone', () => {
    const group = createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'horizontal' } },
      id: asNodeId('g'),
      parentId: asNodeId('z'),
    });
    expect(group.container?.strategyId).toBe('strip');
    expect(group.membership?.parentId).toBe('z');
    expect(group.focus).toBeUndefined();
  });
});

describe('integration: activity-aware consumer strategy', () => {
  it('sorts children by activity.lastAt descending', () => {
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
        id: asNodeId('a'),
        parentId: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('b'),
        parentId: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('c'),
        parentId: asNodeId('z'),
      }),
    );
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    store.showNode(asNodeId('c'));

    store.patchActivity(asNodeId('a'), { lastAt: 10 });
    store.patchActivity(asNodeId('b'), { lastAt: 30 });
    store.patchActivity(asNodeId('c'), { lastAt: 20 });

    const layoutNodes = getLayoutNodes(store, asNodeId('z'));
    const sorted = [...layoutNodes].sort((x, y) => {
      const xt = (x.activity.lastAt as number) ?? 0;
      const yt = (y.activity.lastAt as number) ?? 0;
      return yt - xt;
    });
    expect(sorted.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});
