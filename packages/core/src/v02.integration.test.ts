import { describe, expect, it } from 'vitest';
import {
  asNodeId,
  createGroup,
  createPanel,
  createZone,
  validateKindShape,
} from './index.js';

describe('v0.2 node model — integration', () => {
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
