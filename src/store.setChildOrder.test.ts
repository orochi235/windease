import { describe, expect, it } from 'vitest';
import { asNodeId, createPanel, createZone, Store } from './index.js';

describe('Store.setChildOrder', () => {
  it('applies a full reordering atomically', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('root') }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('root') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('root') }));
    store.registerNode(createPanel({ id: asNodeId('c'), parentId: asNodeId('root') }));

    store.setChildOrder(asNodeId('root'), [asNodeId('c'), asNodeId('a'), asNodeId('b')]);

    expect(store.getContainerView(asNodeId('root'))?.childIds).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op when the order is already correct', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('root') }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('root') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('root') }));

    let notifications = 0;
    store.subscribe(() => notifications++);
    store.setChildOrder(asNodeId('root'), [asNodeId('a'), asNodeId('b')]);

    expect(notifications).toBe(0);
  });

  it('throws if orderedIds is not a permutation of current childIds', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('root') }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('root') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('root') }));

    expect(() => store.setChildOrder(asNodeId('root'), [asNodeId('a')])).toThrow(/permutation/i);
    expect(() =>
      store.setChildOrder(asNodeId('root'), [asNodeId('a'), asNodeId('b'), asNodeId('c')]),
    ).toThrow(/permutation/i);
    expect(() =>
      store.setChildOrder(asNodeId('root'), [asNodeId('a'), asNodeId('a')]),
    ).toThrow(/permutation/i);
  });

  it('throws when parent has no container capability', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('root') }));
    store.registerNode(createPanel({ id: asNodeId('lone'), parentId: asNodeId('root') }));
    expect(() => store.setChildOrder(asNodeId('lone'), [])).toThrow();
  });
});
