import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { ContainerHost } from './container-host.js';
import type { LayoutStrategy, StrategyRegistry } from './layout-types.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

const Z = asNodeId('z');

/** Places every child at the origin and tags it with a channel the core has no
 *  predicate over — the shape a 3D consumer emits. */
const tagging: LayoutStrategy<void, string> = {
  name: 'tagging',
  layout({ items }) {
    const placements = new Map(items.map((i) => [i.id, { x: 0, y: 0, z: 0, w: 10, h: 10 }]));
    const channels = new Map(items.map((i, n) => [i.id, { opacity: n / items.length }]));
    return { placements, affordances: [], channels };
  },
};

const bare: LayoutStrategy<void, string> = {
  name: 'bare',
  layout({ items }) {
    return {
      placements: new Map(items.map((i) => [i.id, { x: 0, y: 0, z: 0, w: 10, h: 10 }])),
      affordances: [],
    };
  },
};

const REGISTRY: StrategyRegistry = new Map([
  ['tagging', tagging as never],
  ['bare', bare as never],
]);

function build(strategyId: string): Store {
  const s = new Store();
  s.registerNode(createNode({ kind: 'zone', container: { strategyId, config: {} }, id: Z }));
  for (const id of ['p1', 'p2']) {
    const nid = asNodeId(id);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: Z }));
    s.showNode(nid);
  }
  return s;
}

function host(store: Store): ContainerHost {
  const h = new ContainerHost(store, Z, REGISTRY);
  h.setViewport({ w: 100, h: 100 });
  return h;
}

describe('ContainerHost carries channels', () => {
  it('publishes what the strategy attached, unread and unchanged', () => {
    const h = host(build('tagging'));
    const channels = h.layout().channels;
    expect(channels?.get(asNodeId('p1'))).toEqual({ opacity: 0 });
    expect(channels?.get(asNodeId('p2'))).toEqual({ opacity: 0.5 });
    h.destroy();
  });

  it('leaves the field absent when a strategy emits none', () => {
    const h = host(build('bare'));
    expect(h.layout().channels).toBeUndefined();
    h.destroy();
  });
});
