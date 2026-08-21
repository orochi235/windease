import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { stripStrategy } from './layout/strip.js';
import { runStrategyForContainer } from './layout-node-adapter.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

/**
 * Pins the collapse pattern documented in the README. There is no collapse
 * state: a collapsed pane is a sized pane, and `hints.minSize` must not floor
 * a size the consumer wrote.
 */
const HEADER = 32;
const Z = asNodeId('dock');

function collapse(store: Store, id: NodeId): void {
  store.transact(() => {
    const h = (store.getNode(id)?.membership?.placement?.size as { h?: number } | undefined)?.h;
    store.setMeta(id, { expandedH: h });
    store.patchPlacement(id, { size: { h: HEADER } });
  }, 'collapse');
}

function expand(store: Store, id: NodeId): void {
  store.transact(() => {
    const h = store.getNode(id)?.meta?.expandedH as number | undefined;
    store.patchPlacement(id, { size: { h } });
    store.setMeta(id, { expandedH: undefined });
  }, 'expand');
}

const heightOf = (store: Store, id: NodeId) =>
  runStrategyForContainer(store, Z, { w: 200, h: 600 }, stripStrategy, undefined).placements.get(id)
    ?.h;

describe('collapse pattern from the README', () => {
  const build = () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'y', fill: true } },
        id: Z,
      }),
    );
    const p = asNodeId('palette');
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: p,
        parentId: Z,
        hints: { minSize: { w: 0, h: 120 } },
      }),
    );
    s.showNode(p);
    const o = asNodeId('other');
    s.registerNode(createNode({ kind: 'panel', focus: true, id: o, parentId: Z }));
    s.showNode(o);
    s.patchPlacement(p, { size: { h: 240 } });
    return { s, p };
  };

  it('collapses a pane below its own minSize and expands back', () => {
    const { s, p } = build();
    expect(heightOf(s, p)).toBe(240);

    collapse(s, p);
    expect(heightOf(s, p)).toBe(HEADER);

    expand(s, p);
    expect(heightOf(s, p)).toBe(240);
  });
});
