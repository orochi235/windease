import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import type { LayoutStrategy } from '../layout-types.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { resolveNavigation } from './resolve.js';
import type { GeometrySource } from './types.js';
import type { Rect } from '../layout-types.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function scene(navigate: NonNullable<LayoutStrategy['navigate']>) {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'custom', config: {} }, id: id('z') }),
  );
  store.showNode(id('z'));
  for (const c of ['a', 'b']) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    store.showNode(id(c));
  }
  const map: Record<string, Rect> = {
    a: { x: 0, y: 0, z: 0, w: 100, h: 100 },
    b: { x: 110, y: 0, z: 0, w: 100, h: 100 },
  };
  const geometry: GeometrySource = { rectOf: (nid) => map[nid] ?? null };
  const strategy: LayoutStrategy = {
    name: 'custom',
    layout: () => ({ placements: new Map(), affordances: [] }),
    navigate,
  };
  const strategies = new Map([['custom', strategy]]);
  return { store, geometry, strategies };
}

describe('resolveNavigation — strategy override', () => {
  it('an id returned by the strategy wins', () => {
    const { store, geometry, strategies } = scene(() => 'a');
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies })).toBe(
      id('a'),
    );
  });

  it('undefined falls through to geometry', () => {
    const { store, geometry, strategies } = scene(() => undefined);
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies })).toBe(
      id('b'),
    );
  });

  it('null stops the search', () => {
    const { store, geometry, strategies } = scene(() => null);
    expect(
      resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies }),
    ).toBeNull();
  });
});
