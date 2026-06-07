import { describe, expect, it } from 'vitest';
import {
  asNodeId,
  createGroup,
  createPanel,
  createZone,
  deserialize,
  serialize,
  Store,
} from './index.js';

/**
 * Headline end-to-end test for the unified node model.
 *
 * Exercises: store mutation → snapshot → re-hydrate → identical tree shape →
 * mutation again after rehydrate. If this test breaks, the public
 * contract has regressed.
 */
describe('headline end-to-end', () => {
  it('builds, snapshots, rehydrates, and continues mutating a 3-level tree', () => {
    const store = new Store();

    // Build:
    //   z (zone, grid)
    //   ├── tray (panel hosting children, stack)
    //   │     ├── leafA (panel, focused)
    //   │     └── leafB (panel)
    //   ├── solo (panel, pinned)
    //   └── tabs (group, strip)
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: { cols: 2 } }));
    store.registerNode(
      createPanel({
        id: asNodeId('tray'),
        parentId: asNodeId('z'),
        container: { strategyId: 'stack', config: { axis: 'vertical' } },
      }),
    );
    store.registerNode(createPanel({ id: asNodeId('leafA'), parentId: asNodeId('tray') }));
    store.registerNode(createPanel({ id: asNodeId('leafB'), parentId: asNodeId('tray') }));
    store.registerNode(
      createPanel({ id: asNodeId('solo'), parentId: asNodeId('z'), placement: { pinned: true } }),
    );
    store.registerNode(
      createGroup({
        id: asNodeId('tabs'),
        parentId: asNodeId('z'),
        strategyId: 'strip',
        config: { axis: 'horizontal' },
      }),
    );
    store.focusNode(asNodeId('leafA'));

    // Snapshot + rehydrate.
    const snap = serialize(store);
    expect(snap.version).toBe(2);
    const rehydrated = deserialize(snap);

    // Tree structure preserved (with pinned 'solo' promoted to prefix).
    const zoneChildren = rehydrated.getContainerView(asNodeId('z'))?.childIds ?? [];
    expect(zoneChildren[0]).toBe('solo');
    expect(zoneChildren).toEqual(expect.arrayContaining(['solo', 'tray', 'tabs']));
    expect(rehydrated.getContainerView(asNodeId('tray'))?.childIds).toEqual(['leafA', 'leafB']);

    // Capabilities preserved per kind.
    expect(rehydrated.getNode(asNodeId('z'))?.slot).toBeUndefined();
    expect(rehydrated.getNode(asNodeId('z'))?.focus).toBeUndefined();
    expect(rehydrated.getNode(asNodeId('tabs'))?.focus).toBeUndefined();
    expect(rehydrated.getNode(asNodeId('tabs'))?.slot).toBeDefined();
    expect(rehydrated.getNode(asNodeId('tabs'))?.container).toBeDefined();
    expect(rehydrated.getNode(asNodeId('leafA'))?.focus).toBeDefined();

    // Focus preserved.
    expect(rehydrated.focusedId).toBe('leafA');

    // Mutating after rehydrate works end-to-end: move leafB out of tray into z.
    rehydrated.moveNode(asNodeId('leafB'), asNodeId('z'));
    expect(rehydrated.getContainerView(asNodeId('tray'))?.childIds).toEqual(['leafA']);
    const zoneAfter = rehydrated.getContainerView(asNodeId('z'))?.childIds ?? [];
    expect(zoneAfter).toContain('leafB');
    // 'solo' is still pinned-prefix.
    expect(zoneAfter[0]).toBe('solo');
  });
});
