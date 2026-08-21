import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { resolveNavigation } from './resolve.js';
import type { GeometrySource } from './types.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

/** a b across the top, c bottom-left. */
function grid(): { store: Store; geometry: GeometrySource } {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'grid', config: {} }, id: id('z') }),
  );
  store.showNode(id('z'));
  for (const c of ['a', 'b', 'c']) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    store.showNode(id(c));
  }
  const map: Record<string, { x: number; y: number; w: number; h: number }> = {
    a: { x: 0, y: 0, w: 100, h: 100 },
    b: { x: 110, y: 0, w: 100, h: 100 },
    c: { x: 0, y: 110, w: 100, h: 100 },
  };
  return { store, geometry: { rectOf: (nid) => map[nid] ?? null } };
}

describe('resolveNavigation — directional', () => {
  it('right moves to the neighbor in that half-plane', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('b'));
  });

  it('down moves to the node below', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('a'), intent: 'down', geometry })).toBe(id('c'));
  });

  it('returns null rather than wrapping', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('b'), intent: 'right', geometry })).toBeNull();
  });

  it('prefers the nearer candidate on the primary axis', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('c'), intent: 'up', geometry })).toBe(id('a'));
  });
});
