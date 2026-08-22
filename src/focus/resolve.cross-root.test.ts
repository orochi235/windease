import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { resolveNavigation } from './resolve.js';
import type { GeometrySource } from './types.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

/** Two root zones side by side, each with a top and a bottom pane. The right
 *  column is staggered so `rBottom` is the farther of the two by raw distance
 *  from `lBottom` — only the cross-axis penalty makes it the straight-ahead win. */
function twoRoots(): { store: Store; geometry: GeometrySource } {
  const store = new Store();
  const layout: Record<string, [string, string, number, number]> = {
    lTop: ['zLeft', 'lTop', 0, 0],
    lBottom: ['zLeft', 'lBottom', 0, 200],
    rTop: ['zRight', 'rTop', 300, 0],
    rBottom: ['zRight', 'rBottom', 400, 200],
  };

  for (const zid of ['zLeft', 'zRight']) {
    store.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'grid', config: {} }, id: id(zid) }),
    );
    store.showNode(id(zid));
  }

  const map: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [zid, pid, x, y] of Object.values(layout)) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(pid), parentId: id(zid) }));
    store.showNode(id(pid));
    map[pid] = { x, y, w: 100, h: 100 };
  }

  return { store, geometry: { rectOf: (nid) => map[nid] ?? null } };
}

describe('resolveNavigation — across root containers', () => {
  it('crosses from one root into the other', () => {
    const { store, geometry } = twoRoots();
    expect(resolveNavigation({ store, from: id('lTop'), intent: 'right', geometry })).toBe(
      id('rTop'),
    );
  });

  it('prefers the pane straight ahead over a diagonally nearer one', () => {
    const { store, geometry } = twoRoots();
    expect(resolveNavigation({ store, from: id('lBottom'), intent: 'right', geometry })).toBe(
      id('rBottom'),
    );
  });

  it('returns null past the outer edge of the last root', () => {
    const { store, geometry } = twoRoots();
    expect(resolveNavigation({ store, from: id('rBottom'), intent: 'right', geometry })).toBeNull();
  });
});
