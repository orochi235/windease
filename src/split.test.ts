import { describe, expect, it } from 'vitest';
import { asNodeId, createPanel, createZone, Store } from './index.js';

function seeded(): Store {
  const store = new Store();
  store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }));
  store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
  return store;
}

describe('Store.split validation', () => {
  it('throws unknown-node for an absent target', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('nope'), {
        direction: 'x',
        groupId: asNodeId('g'),
        newIds: [asNodeId('p2')],
      }),
    ).toThrow(/nope/);
  });

  it('throws split-arity when newIds disagrees with into', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'x',
        into: 3,
        groupId: asNodeId('g'),
        newIds: [asNodeId('p2')],
      }),
    ).toThrow(/split-arity|newIds/);
  });

  it('throws split-arity when into is below 2', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'x', into: 1, groupId: asNodeId('g'), newIds: [] }),
    ).toThrow(/split-arity|into/);
  });

  it('throws duplicate-id when a newId is already registered', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'x',
        groupId: asNodeId('g'),
        newIds: [asNodeId('p1')],
      }),
    ).toThrow(/p1/);
  });

  it('throws duplicate-id when the call repeats an id internally', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'x',
        into: 3,
        groupId: asNodeId('g'),
        newIds: [asNodeId('p2'), asNodeId('p2')],
      }),
    ).toThrow(/p2/);
  });

  it('throws split-missing-group-id when wrap mode has no groupId', () => {
    const store = seeded();
    expect(() => store.split(asNodeId('p1'), { direction: 'y', newIds: [asNodeId('p2')] })).toThrow(
      /split-missing-group-id|groupId/,
    );
  });

  it('throws duplicate-id when groupId collides in wrap mode', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'y',
        groupId: asNodeId('z'),
        newIds: [asNodeId('p2')],
      }),
    ).toThrow(/z/);
  });

  it('throws duplicate-id when groupId repeats a newId', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'y',
        groupId: asNodeId('p2'),
        newIds: [asNodeId('p2')],
      }),
    ).toThrow(/p2/);
  });

  it('ignores a colliding groupId when flattening, since it is never registered', () => {
    const store = seeded();
    // Parent axis is 'x' and direction is 'x', so this flattens and no group
    // is created — a collision on the unused groupId must not be raised.
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'x',
        groupId: asNodeId('z'),
        newIds: [asNodeId('p2')],
      }),
    ).toThrow(/split-unimplemented/);
  });

  it('leaves the store untouched when validation throws', () => {
    const store = seeded();
    const before = store.getContainerView(asNodeId('z'))?.childOrder;
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'y', newIds: [asNodeId('p2')] }),
    ).toThrow();
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(before);
    expect(store.getNode(asNodeId('p2'))).toBeUndefined();
  });
});
