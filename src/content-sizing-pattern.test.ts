import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import { stripStrategy } from './layout/strip.js';
import type { StrategyRegistry } from './layout-types.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

/**
 * Pins the content-sizing pattern documented in the README, which claims a
 * gutter drag pins a pane and that clearing `placement.size` resumes tracking.
 * Prose naming an API drifts; this runs it.
 */
const REGISTRY: StrategyRegistry = new Map([['strip', stripStrategy as never]]);
const Z = asNodeId('dock');
const A = asNodeId('a');
const B = asNodeId('b');

function build(): { store: Store; host: ContainerHost } {
  const store = new Store();
  store.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'y' } },
      id: Z,
    }),
  );
  store.registerNode(
    createNode({ kind: 'palette', id: A, parentId: Z, hints: { sizing: { h: 'content' } } }),
  );
  store.registerNode(createNode({ kind: 'panel', id: B, parentId: Z }));
  store.showNode(A);
  store.showNode(B);
  const host = new ContainerHost(store, Z, REGISTRY);
  host.setViewport({ w: 200, h: 400 });
  host.setNaturalSize(A, { w: 200, h: 120 });
  return { store, host };
}

const heightOf = (host: ContainerHost, id: typeof A) => host.layout().placements.get(id)?.h;

describe('the documented content-sizing pattern', () => {
  it('tracks the measurement until something writes a size', () => {
    const { host } = build();
    expect(heightOf(host, A)).toBe(120);
    host.setNaturalSize(A, { w: 200, h: 160 });
    expect(heightOf(host, A)).toBe(160);
  });

  it('pins the pane once a size is written, measurement notwithstanding', () => {
    const { store, host } = build();
    store.patchPlacement(A, { size: { h: 60 } });
    expect(heightOf(host, A)).toBe(60);
    host.setNaturalSize(A, { w: 200, h: 300 });
    expect(heightOf(host, A)).toBe(60);
  });

  it('resumes tracking when the size is cleared, exactly as documented', () => {
    const { store, host } = build();
    store.patchPlacement(A, { size: { h: 60 } });
    expect(heightOf(host, A)).toBe(60);
    store.patchPlacement(A, { size: { h: undefined } });
    expect(heightOf(host, A)).toBe(120);
  });
});
