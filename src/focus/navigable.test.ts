import { describe, expect, it } from 'vitest';
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
      return r ? { x: r[0], y: r[1], w: r[2], h: r[3] } : null;
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

  it('skips the whole subtree of a hidden container', () => {
    const s = row(['a', 'b']);
    s.hideNode(id('z'));
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 10, 10] });
    expect(navigableLeaves(s, g)).toEqual([]);
  });

  it('skips a node with no geometry', () => {
    const s = row(['a', 'b']);
    const g = rects({ a: [0, 0, 10, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a')]);
  });
});
