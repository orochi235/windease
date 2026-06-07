import { describe, expect, it } from 'vitest';
import {
  asNodeId,
  createGroup,
  createPanel,
  createZone,
  validateKindShape,
  WindeaseStore,
  getLayoutNodes,
} from './index.js';

describe('node model — integration', () => {
  it('builds a 3-level tree of zone → recursive panel → leaf panel', () => {
    const zone = createZone({ id: asNodeId('z'), strategyId: 'grid', config: { cols: 2 } });
    const trayHost = createPanel({
      id: asNodeId('tray'),
      parentId: asNodeId('z'),
      container: { strategyId: 'stack', config: { axis: 'vertical' } },
    });
    const leaf = createPanel({
      id: asNodeId('leaf'),
      parentId: asNodeId('tray'),
    });

    for (const n of [zone, trayHost, leaf]) {
      expect(() => validateKindShape(n)).not.toThrow();
    }
    expect(trayHost.container).toBeDefined();
    expect(trayHost.slot?.parentId).toBe('z');
    expect(leaf.slot?.parentId).toBe('tray');
  });

  it('builds a group inside a zone', () => {
    const zone = createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} });
    const group = createGroup({
      id: asNodeId('g'),
      parentId: asNodeId('z'),
      strategyId: 'strip',
      config: { axis: 'horizontal' },
    });
    expect(() => validateKindShape(zone)).not.toThrow();
    expect(() => validateKindShape(group)).not.toThrow();
    expect(group.container?.strategyId).toBe('strip');
    expect(group.slot?.parentId).toBe('z');
    expect(group.focus).toBeUndefined();
  });
});

describe('integration: activity-aware consumer strategy', () => {
  it('sorts children by activity.lastAt descending', () => {
    const store = new WindeaseStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('c'), parentId: asNodeId('z') }));
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
