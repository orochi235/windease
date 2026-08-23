import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { destroyBlockedBy } from './lock.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';

/** root ─ group ─ leaf */
function tree(locks: { group?: boolean; leaf?: boolean } = {}) {
  const store = new Store();
  store.registerNode(
    createNode({ id: asNodeId('root'), container: { strategyId: 'strip', config: {} } }),
  );
  store.registerNode(
    createNode({
      id: asNodeId('group'),
      container: { strategyId: 'strip', config: {} },
      parentId: asNodeId('root'),
      ...(locks.group ? { lock: { destroy: true } } : {}),
    }),
  );
  store.registerNode(
    createNode({
      id: asNodeId('leaf'),
      parentId: asNodeId('group'),
      ...(locks.leaf ? { lock: { destroy: true } } : {}),
    }),
  );
  return store;
}

describe('destroyBlockedBy', () => {
  it('returns null for an unlocked subtree', () => {
    expect(destroyBlockedBy(tree(), asNodeId('group'))).toBeNull();
  });

  it('names the node itself when it is locked', () => {
    expect(destroyBlockedBy(tree({ group: true }), asNodeId('group'))).toBe('group');
  });

  it('names a locked descendant, which unregisterNode would destroy silently', () => {
    expect(destroyBlockedBy(tree({ leaf: true }), asNodeId('group'))).toBe('leaf');
  });

  it('returns null for a node that does not exist', () => {
    expect(destroyBlockedBy(tree(), asNodeId('nope'))).toBeNull();
  });

  it('ignores locks on other axes', () => {
    const store = new Store();
    store.registerNode(
      createNode({ id: asNodeId('root'), container: { strategyId: 'strip', config: {} } }),
    );
    store.registerNode(
      createNode({
        id: asNodeId('pane'),
        parentId: asNodeId('root'),
        lock: { move: true, resize: true },
      }),
    );
    expect(destroyBlockedBy(store, asNodeId('pane'))).toBeNull();
  });
});
