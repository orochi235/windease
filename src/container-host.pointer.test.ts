import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import type { LayoutResult, LayoutStrategy } from './layout-types.js';
import { asNodeId } from './node.js';
import { serialize } from './snapshot.js';
import { Store } from './store.js';

/** Reports the pointer it was handed as the first child's position, so a test
 *  can read the input back out of a layout. */
const probe: LayoutStrategy<void, string> = {
  name: 'probe',
  layout({ items, pointer }): LayoutResult<string> {
    const placements = new Map<string, { x: number; y: number; z: number; w: number; h: number }>();
    for (const item of items) {
      placements.set(item.id, { x: pointer?.x ?? -1, y: pointer?.y ?? -1, z: 0, w: 10, h: 10 });
    }
    return { placements, affordances: [] };
  },
};

const Z = asNodeId('z');
const C1 = asNodeId('c1');
const REGISTRY = new Map([['probe', probe as never]]);

function host(): { host: ContainerHost; store: Store } {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'probe', config: {} }, id: Z }),
  );
  store.registerNode(createNode({ kind: 'panel', id: C1, parentId: Z }));
  store.showNode(C1);
  const h = new ContainerHost(store, Z, REGISTRY);
  h.setViewport({ w: 200, h: 100 });
  return { host: h, store };
}

const seen = (h: ContainerHost) => h.layout().placements.get(C1)!;

describe('ContainerHost pointer input', () => {
  it('is absent until something sets it', () => {
    expect(seen(host().host).x).toBe(-1);
  });

  it('reaches the strategy', () => {
    const { host: h } = host();
    h.setPointer({ x: 40, y: 12 });
    expect(seen(h)).toMatchObject({ x: 40, y: 12 });
  });

  it('goes absent again when the pointer leaves', () => {
    const { host: h } = host();
    h.setPointer({ x: 40, y: 12 });
    h.setPointer(null);
    expect(seen(h).x).toBe(-1);
  });

  it('re-runs the layout when it moves', () => {
    const { host: h } = host();
    h.setPointer({ x: 1, y: 1 });
    const before = h.layout();
    h.setPointer({ x: 2, y: 1 });
    expect(h.layout()).not.toBe(before);
    expect(seen(h).x).toBe(2);
  });

  it('does not re-run for the same position', () => {
    const { host: h } = host();
    h.setPointer({ x: 5, y: 5 });
    const before = h.layout();
    h.setPointer({ x: 5, y: 5 });
    expect(h.layout()).toBe(before);
  });

  it('is never written to the store', () => {
    const { host: h, store } = host();
    h.setPointer({ x: 40, y: 12 });
    h.layout();
    expect(JSON.stringify(serialize(store))).not.toContain('pointer');
  });
});
