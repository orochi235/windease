import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { visibleSeamOf } from './seamIndex.js';

const id = asNodeId;

/** A parent with children a…f, all visible, and `x` being dragged in from elsewhere. */
function store(): Store {
  const s = new Store();
  s.registerNode(createNode({ id: id('p'), kind: 'zone', container: { strategyId: 'grid', config: {} } }));
  for (const c of ['a', 'b', 'c', 'd', 'e', 'f']) {
    s.registerNode(createNode({ id: id(c), kind: 'panel', parentId: id('p') }));
    s.showNode(id(c));
  }
  return s;
}

describe('visibleSeamOf', () => {
  it('leaves a seam alone when every visible child was drawn', () => {
    const s = store();
    expect(visibleSeamOf(s, id('p'), id('x'), ['a', 'b', 'c', 'd', 'e', 'f'], 2)).toBe(2);
  });

  it('counts a seam on a later page from that page’s first child', () => {
    const s = store();
    // A page showing d, e and f: before e is visible seam 4, the end is 6.
    expect(visibleSeamOf(s, id('p'), id('x'), ['d', 'e', 'f'], 0)).toBe(3);
    expect(visibleSeamOf(s, id('p'), id('x'), ['d', 'e', 'f'], 1)).toBe(4);
    expect(visibleSeamOf(s, id('p'), id('x'), ['d', 'e', 'f'], 3)).toBe(6);
  });

  it('counts without the dragged child when it moves within the parent', () => {
    const s = store();
    // c is dragged from page one onto the page showing d, e and f.
    expect(visibleSeamOf(s, id('p'), id('c'), ['d', 'e', 'f'], 0)).toBe(2);
  });

  it('skips hidden children, which a seam among visible ones never counts', () => {
    const s = store();
    s.hideNode(id('b'));
    expect(visibleSeamOf(s, id('p'), id('x'), ['e', 'f'], 0)).toBe(3);
  });

  it('leaves the seam alone when nothing was drawn', () => {
    expect(visibleSeamOf(store(), id('p'), id('x'), [], 0)).toBe(0);
  });
});
