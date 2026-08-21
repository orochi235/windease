import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function treeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  for (const c of ['a', 'b']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    s.showNode(id(c));
  }
  return s;
}

describe('container focus memory', () => {
  it('records the focused descendant on every ancestor container', () => {
    const s = treeStore();
    s.focusNode(id('b'));
    expect(s.getNode(id('z'))?.container?.lastFocusedId).toBe(id('b'));
  });

  it('stops naming a removed child (the successor takes its place)', () => {
    const s = treeStore();
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.getNode(id('z'))?.container?.lastFocusedId).toBe(id('a'));
  });

  it('clears when the removed child leaves no successor', () => {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
    );
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('a'), parentId: id('z') }));
    s.showNode(id('a'));
    s.focusNode(id('a'));
    s.unregisterNode(id('a'));
    expect(s.getNode(id('z'))?.container?.lastFocusedId).toBeUndefined();
  });

  it('clears when the remembered child moves to another parent', () => {
    const s = treeStore();
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z2') }),
    );
    s.focusNode(id('b'));
    s.moveNode(id('b'), id('z2'));
    expect(s.getNode(id('z'))?.container?.lastFocusedId).toBeUndefined();
    expect(s.getNode(id('z2'))?.container?.lastFocusedId).toBe(id('b'));
  });
});
