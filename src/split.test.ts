import { afterEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, configureTrace, createGroup, createPanel, createZone, Store } from './index.js';

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
    ).not.toThrow();
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

describe('Store.split — wrap mode', () => {
  it('interposes a group at the target index and puts the target at 0', () => {
    const store = new Store();
    store.registerNode(
      createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }),
    );
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'g', 'b']);
    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2']);
    expect(store.getNode(asNodeId('p1'))?.membership?.parentId).toBe('g');
  });

  it('gives the group a strip container on the requested axis', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    const g = store.getNode(asNodeId('g'));
    expect(g?.container?.strategyId).toBe('strip');
    expect(g?.container?.config).toMatchObject({ axis: 'y' });
  });

  it('merges config over the strip config', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
      config: { gap: 8 },
    });

    expect(store.getNode(asNodeId('g'))?.container?.config).toMatchObject({ axis: 'y', gap: 8 });
  });

  it('honors into for more than two children', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      into: 4,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('transfers the target placement to the group and clears the target', () => {
    const store = seeded();
    store.patchPlacement(asNodeId('p1'), { size: { w: 300 } });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getPlacement(asNodeId('g'))).toMatchObject({ size: { w: 300 } });
    expect(store.getPlacement(asNodeId('p1')).size).toBeUndefined();
  });

  it('transfers a pinned index to the group', () => {
    const store = new Store();
    store.registerNode(
      createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }),
    );
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.setPinned(asNodeId('p1'), 0);

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getPinnedIndex(asNodeId('g'))).toBe(0);
    expect(store.getPinnedIndex(asNodeId('p1'))).toBeNull();
  });

  it('wraps a group target the same way it wraps a panel', () => {
    const store = new Store();
    store.registerNode(
      createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }),
    );
    // createGroup, not createZone({parentId}) — that arrives in Task 8.
    store.registerNode(
      createGroup({
        id: asNodeId('inner'),
        parentId: asNodeId('z'),
        strategyId: 'stack',
        config: {},
      }),
    );

    store.split(asNodeId('inner'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['inner', 'p2']);
  });
});

describe('Store.split — flatten mode', () => {
  it('inserts siblings after the target when the parent axis matches', () => {
    const store = new Store();
    store.registerNode(
      createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }),
    );
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'x',
      groupId: asNodeId('unused'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2', 'b']);
    expect(store.getNode(asNodeId('unused'))).toBeUndefined();
  });

  it('needs no groupId when flattening', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'x', newIds: [asNodeId('p2')] }),
    ).not.toThrow();
  });

  it('treats a strip with no explicit axis as x', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), { direction: 'x', newIds: [asNodeId('p2')] });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2']);
  });

  it('wraps rather than flattens when the axis differs', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['g']);
  });

  it('wraps rather than flattens when the parent is not a strip', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'x',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['g']);
  });
});

describe('Store.split — atomicity', () => {
  it('emits one transaction pair per split', () => {
    const store = seeded();
    let pairs = 0;
    store.events.on('transaction.end', () => {
      pairs += 1;
    });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(pairs).toBe(1);
  });

  it('notifies subscribers once', async () => {
    const store = seeded();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });
    await Promise.resolve();

    expect(notifications).toBe(1);
  });
});

describe('Store.split — reconfigure mode', () => {
  it('makes an empty root the container and registers the new panels', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('z'), {
      direction: 'x',
      into: 3,
      newIds: [asNodeId('p1'), asNodeId('p2')],
    });

    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('strip');
    expect(store.getNode(asNodeId('z'))?.container?.config).toMatchObject({ axis: 'x' });
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2']);
  });

  it('takes into - 1 newIds even at a root, so an empty root gains into - 1 children', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('z'), { direction: 'x', into: 3, newIds: [asNodeId('a'), asNodeId('b')] });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'b']);
  });

  it('keeps existing children ahead of the new ones', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('old'), parentId: asNodeId('z') }));

    store.split(asNodeId('z'), { direction: 'y', newIds: [asNodeId('new')] });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['old', 'new']);
  });

  it('ignores groupId at a root', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('z'), {
      direction: 'x',
      groupId: asNodeId('unused'),
      newIds: [asNodeId('p1')],
    });

    expect(store.getNode(asNodeId('unused'))).toBeUndefined();
  });

  it('gives a container-less root a container', () => {
    const store = new Store();
    const orphan = createZone({ id: asNodeId('o'), strategyId: 'stack', config: {} });
    delete (orphan as { container?: unknown }).container;
    store.registerNode(orphan);

    store.split(asNodeId('o'), { direction: 'x', newIds: [asNodeId('p1')] });

    expect(store.getNode(asNodeId('o'))?.container?.strategyId).toBe('strip');
    expect(store.getContainerView(asNodeId('o'))?.childOrder).toEqual(['p1']);
  });

  it('merges over the existing config rather than replacing it', () => {
    const store = new Store();
    store.registerNode(
      createZone({ id: asNodeId('z'), strategyId: 'grid', config: { cols: 3, gap: 8 } }),
    );

    store.split(asNodeId('z'), { direction: 'x', newIds: [asNodeId('p1')] });

    // `gap` survives because it is consumer intent, not strategy-specific.
    // `cols` survives too and is inert — strip never reads it.
    expect(store.getNode(asNodeId('z'))?.container?.config).toEqual({ cols: 3, gap: 8, axis: 'x' });
  });
});

describe("Store.split — direction 'both'", () => {
  it('builds an outer x strip of inner y strips, filling column-major', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'both',
      into: [2, 2],
      groupIds: [asNodeId('g'), asNodeId('c0'), asNodeId('c1')],
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    expect(store.getNode(asNodeId('g'))?.container?.config).toMatchObject({ axis: 'x' });
    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['c0', 'c1']);
    expect(store.getNode(asNodeId('c0'))?.container?.config).toMatchObject({ axis: 'y' });
    expect(store.getContainerView(asNodeId('c0'))?.childOrder).toEqual(['p1', 'p2']);
    expect(store.getContainerView(asNodeId('c1'))?.childOrder).toEqual(['p3', 'p4']);
  });

  it('handles a non-square grid', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'both',
      into: [3, 2],
      groupIds: [asNodeId('g'), asNodeId('c0'), asNodeId('c1'), asNodeId('c2')],
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4'), asNodeId('p5'), asNodeId('p6')],
    });

    expect(store.getContainerView(asNodeId('c0'))?.childOrder).toEqual(['p1', 'p2']);
    expect(store.getContainerView(asNodeId('c1'))?.childOrder).toEqual(['p3', 'p4']);
    expect(store.getContainerView(asNodeId('c2'))?.childOrder).toEqual(['p5', 'p6']);
  });

  it('throws when groupIds is not 1 + cols', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'both',
        into: [2, 2],
        groupIds: [asNodeId('g'), asNodeId('c0')],
        newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
      }),
    ).toThrow(/groupIds/);
  });

  it('replaces the target at its old index in the parent', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'both',
      into: [2, 2],
      groupIds: [asNodeId('g'), asNodeId('c0'), asNodeId('c1')],
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'g']);
  });

  it('makes the target itself the outer container at a root', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('z'), {
      direction: 'both',
      into: [2, 2],
      groupIds: [asNodeId('unused'), asNodeId('c0'), asNodeId('c1')],
      newIds: [asNodeId('p1'), asNodeId('p2'), asNodeId('p3')],
    });

    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('strip');
    expect(store.getNode(asNodeId('z'))?.container?.config).toMatchObject({ axis: 'x' });
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['c0', 'c1']);
    expect(store.getContainerView(asNodeId('c0'))?.childOrder).toEqual(['p1', 'p2']);
    expect(store.getContainerView(asNodeId('c1'))?.childOrder).toEqual(['p3']);
    expect(store.getNode(asNodeId('unused'))).toBeUndefined();
  });
});

describe("Store.split — direction 'grid'", () => {
  it('builds one grid container with all children flat', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'grid',
      into: 4,
      cols: 2,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    expect(store.getNode(asNodeId('g'))?.container?.strategyId).toBe('grid');
    expect(store.getNode(asNodeId('g'))?.container?.config).toMatchObject({ cols: 2 });
    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('omits cols from the config when not given', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'grid',
      into: 2,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getNode(asNodeId('g'))?.container?.config).not.toHaveProperty('cols');
  });

  it('reconfigures a root into a grid', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('z'), {
      direction: 'grid',
      into: 3,
      cols: 3,
      newIds: [asNodeId('a'), asNodeId('b')],
    });

    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('grid');
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'b']);
  });
});

describe('Store.split — Task 3 nits', () => {
  afterEach(() => {
    configureTrace(null);
  });

  it('reports flatten trace with the axis, like wrap', () => {
    const store = new Store();
    store.registerNode(
      createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }),
    );
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    configureTrace('store');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    store.split(asNodeId('p1'), { direction: 'x', newIds: [asNodeId('p2')] });
    const lines = spy.mock.calls.map((call) => call.join(' '));
    spy.mockRestore();

    expect(lines.some((line) => /flatten.*\bx\b/.test(line))).toBe(true);
  });
});

describe('Store.setStrategy', () => {
  it('drops container state belonging to the outgoing strategy', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'split', config: {} }));
    store.setContainerState(asNodeId('z'), { kind: 'leaf', id: 'old' });

    store.setStrategy(asNodeId('z'), 'strip');

    expect(store.getContainerState(asNodeId('z'))).toBeUndefined();
  });

  it('leaves state alone when the strategy is unchanged', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: {} }));
    store.setContainerState(asNodeId('z'), { keep: true });

    store.setStrategy(asNodeId('z'), 'strip');

    expect(store.getContainerState(asNodeId('z'))).toEqual({ keep: true });
  });

  it('reconfiguring a split root clears its SplitNode tree', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'split', config: {} }));
    store.setContainerState(asNodeId('z'), { kind: 'leaf', id: 'old' });

    store.split(asNodeId('z'), { direction: 'x', newIds: [asNodeId('p1')] });

    expect(store.getContainerState(asNodeId('z'))).toBeUndefined();
  });
});
