import { describe, expect, it } from 'vitest';
import { type CollapsePolicy, collapse } from '../collapse.js';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { navigableLeaves } from './navigable.js';
import type { GeometrySource } from './types.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function rects(map: Record<string, [number, number, number, number]>): GeometrySource {
  return {
    rectOf(nid) {
      const r = map[nid];
      return r ? { x: r[0], y: r[1], z: 0, w: r[2], h: r[3] } : null;
    },
  };
}

function row(children: string[]): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  s.showNode(id('z'));
  for (const c of children) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    s.showNode(id(c));
  }
  return s;
}

describe('navigableLeaves', () => {
  it('returns visible focusable leaves in depth-first order', () => {
    const s = row(['a', 'b']);
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 10, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a'), id('b')]);
  });

  it('skips a zero-area node', () => {
    const s = row(['a', 'b']);
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 0, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a')]);
  });

  it('skips a sub-pixel node', () => {
    const s = row(['a', 'b']);
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 0.4, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a')]);
  });

  it('skips a hidden node', () => {
    const s = row(['a', 'b']);
    s.hideNode(id('b'));
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 10, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a')]);
  });

  it('descends into a container nobody showed', () => {
    const s2 = new Store();
    s2.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
    );
    for (const c of ['a', 'b']) {
      s2.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
      s2.showNode(id(c));
    }
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 10, 10] });
    expect(navigableLeaves(s2, g)).toEqual([id('a'), id('b')]);
  });

  it('skips the whole subtree of a hidden container', () => {
    const s = row(['a', 'b']);
    s.hideNode(id('z'));
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 10, 10] });
    expect(navigableLeaves(s, g)).toEqual([]);
  });

  it('includes a childless focusable container', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        focus: true,
        container: { strategyId: 'strip', config: {} },
        id: id('dock'),
      }),
    );
    s.showNode(id('dock'));
    const g = rects({ dock: [0, 0, 100, 40] });
    // An empty dock is a legitimate arrow target — somewhere to land before
    // dropping into it.
    expect(navigableLeaves(s, g)).toEqual([id('dock')]);
  });

  it('skips a node with no geometry', () => {
    const s = row(['a', 'b']);
    const g = rects({ a: [0, 0, 10, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a')]);
  });

  describe('with a collapse policy', () => {
    /** z ▸ [a, side], where `side` is an empty focusable group. */
    const withSide = (policy: CollapsePolicy): Store => {
      const s = new Store({ collapsePolicy: policy });
      s.registerNode(
        createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
      );
      s.registerNode(createNode({ kind: 'panel', focus: true, id: id('a'), parentId: id('z') }));
      s.registerNode(
        createNode({
          kind: 'group',
          focus: true,
          id: id('side'),
          parentId: id('z'),
          container: { strategyId: 'strip', config: {} },
        }),
      );
      for (const n of ['z', 'a', 'side']) s.showNode(id(n));
      return s;
    };
    // The rect a host still holds from before `side` shut.
    const stale = rects({ a: [0, 0, 10, 10], side: [20, 0, 10, 10] });

    it('skips a container collapsed to nothing, whatever rect is reported', () => {
      expect(navigableLeaves(withSide(collapse()), stale)).toEqual([id('a')]);
    });

    it('keeps a container collapsed to a rail', () => {
      expect(navigableLeaves(withSide(collapse({ to: 24 })), stale)).toEqual([id('a'), id('side')]);
    });
  });
});
