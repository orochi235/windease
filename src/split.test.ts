import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asNodeId,
  configureTrace,
  createGroup,
  createPanel,
  createZone,
  deserialize,
  gridStrategy,
  HistoryController,
  type NodeId,
  nodeToLayoutItem,
  type SerializedStore,
  Store,
  serialize,
  stripStrategy,
} from './index.js';

function layoutOf(store: Store, parentId: NodeId, container = { w: 1200, h: 800 }) {
  const node = store.getNode(parentId);
  if (!node?.container) throw new Error(`${parentId} has no container`);
  const strategy = node.container.strategyId === 'grid' ? gridStrategy : stripStrategy;
  return strategy.layout({
    items: store.getChildren(parentId).map((n) => nodeToLayoutItem(n)),
    container,
    state: undefined as never,
    options: node.container.config as Record<string, unknown>,
  });
}

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
    expect(store.getNode(asNodeId('z'))?.container?.config).toEqual({
      cols: 3,
      gap: 8,
      axis: 'x',
      fill: true,
    });
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

describe('Store.split — geometry', () => {
  it('fills the container on a two-pane x split', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'x',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    const { placements } = layoutOf(store, asNodeId('g'));
    const p1 = placements.get('p1')!;
    const p2 = placements.get('p2')!;
    expect(p1.w).toBe(600);
    expect(p2.w).toBe(600);
    expect(p1.h).toBe(800);
    expect(p2.h).toBe(800);
    expect(p1.x + p1.w).toBe(p2.x);
    expect(p1.w + p2.w).toBe(1200);
  });

  it('fills the container on a two-pane y split', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    const { placements } = layoutOf(store, asNodeId('g'));
    const p1 = placements.get('p1')!;
    const p2 = placements.get('p2')!;
    expect(p1.h).toBe(400);
    expect(p2.h).toBe(400);
    expect(p1.w).toBe(1200);
    expect(p2.w).toBe(1200);
    expect(p1.y + p1.h).toBe(p2.y);
    expect(p1.h + p2.h).toBe(800);
  });

  it('gives every pane non-zero width on a four-pane x split, not W/2^k', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'x',
      into: 4,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    const { placements } = layoutOf(store, asNodeId('g'));
    const widths = ['p1', 'p2', 'p3', 'p4'].map((id) => placements.get(id)!.w);
    for (const w of widths) expect(w).toBe(300);
    expect(widths.reduce((sum, w) => sum + w, 0)).toBe(1200);
  });

  it('fills both levels of a both[2,2] split', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'both',
      into: [2, 2],
      groupIds: [asNodeId('g'), asNodeId('c0'), asNodeId('c1')],
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    const outer = layoutOf(store, asNodeId('g'));
    const c0Rect = outer.placements.get('c0')!;
    const c1Rect = outer.placements.get('c1')!;
    expect(c0Rect.w).toBe(600);
    expect(c1Rect.w).toBe(600);
    expect(c0Rect.w + c1Rect.w).toBe(1200);

    const col0 = layoutOf(store, asNodeId('c0'), { w: c0Rect.w, h: c0Rect.h });
    const p1 = col0.placements.get('p1')!;
    const p2 = col0.placements.get('p2')!;
    expect(p1.h).toBe(400);
    expect(p2.h).toBe(400);
    expect(p1.h + p2.h).toBe(800);

    const col1 = layoutOf(store, asNodeId('c1'), { w: c1Rect.w, h: c1Rect.h });
    const p3 = col1.placements.get('p3')!;
    const p4 = col1.placements.get('p4')!;
    expect(p3.h).toBe(400);
    expect(p4.h).toBe(400);
  });

  it('fills every cell of a grid split', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'grid',
      into: 4,
      cols: 2,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    const { placements } = layoutOf(store, asNodeId('g'));
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      const rect = placements.get(id)!;
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
  });

  it('honors an explicit fill: false override rather than hardcoding fill on', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'x',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
      config: { fill: false },
    });

    const { placements } = layoutOf(store, asNodeId('g'));
    expect(placements.get('p1')!.w).toBe(0);
    expect(placements.get('p2')!.w).toBe(0);
  });
});

describe('Store.unsplit', () => {
  it('moves children up to the group index in order, then removes the group', () => {
    const store = new Store();
    store.registerNode(
      createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }),
    );
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.split(asNodeId('p1'), {
      direction: 'y',
      into: 3,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3')],
    });

    store.unsplit(asNodeId('g'));

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'p1', 'p2', 'p3', 'b']);
    expect(store.getNode(asNodeId('g'))).toBeUndefined();
  });

  it('round-trips with split', () => {
    const store = seeded();
    const before = store.getContainerView(asNodeId('z'))?.childOrder;
    const beforeSnapshot = serialize(store);

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });
    store.unregisterNode(asNodeId('p2'));
    store.unsplit(asNodeId('g'));

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(before);
    expect(serialize(store)).toEqual(beforeSnapshot);
  });

  it('returns the group placement to a sole surviving child', () => {
    const store = seeded();
    store.patchPlacement(asNodeId('p1'), { size: { w: 300 } });
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });
    store.unregisterNode(asNodeId('p2'));

    store.unsplit(asNodeId('g'));

    expect(store.getPlacement(asNodeId('p1'))).toMatchObject({ size: { w: 300 } });
  });

  it('returns a transferred pin to a sole surviving child', () => {
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
    store.unregisterNode(asNodeId('p2'));

    store.unsplit(asNodeId('g'));

    expect(store.getPinnedIndex(asNodeId('p1'))).toBe(0);
  });

  it('drops the group placement when several children survive', () => {
    const store = seeded();
    store.patchPlacement(asNodeId('p1'), { size: { w: 300 } });
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    store.unsplit(asNodeId('g'));

    // One slot's size cannot describe two siblings; picking one would be arbitrary.
    expect(store.getPlacement(asNodeId('p1')).size).toBeUndefined();
    expect(store.getPlacement(asNodeId('p2')).size).toBeUndefined();
  });

  it('throws when the target has no container', () => {
    const store = seeded();
    expect(() => store.unsplit(asNodeId('p1'))).toThrow(/container/);
  });

  it('throws when the target has no parent', () => {
    const store = seeded();
    expect(() => store.unsplit(asNodeId('z'))).toThrow(/membership|parent/);
  });

  it('emits one transaction pair', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });
    let pairs = 0;
    store.events.on('transaction.end', () => {
      pairs += 1;
    });

    store.unsplit(asNodeId('g'));

    expect(pairs).toBe(1);
  });

  it('refuses when the group is locked against destroy', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });
    store.setLock(asNodeId('g'), { destroy: true });

    expect(() => store.unsplit(asNodeId('g'))).toThrow();
    expect(store.getNode(asNodeId('g'))).toBeDefined();
  });

  it('force overrides the lock', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });
    store.setLock(asNodeId('g'), { destroy: true });

    store.unsplit(asNodeId('g'), { force: true });

    expect(store.getNode(asNodeId('g'))).toBeUndefined();
  });
});

describe('Store.split — locks', () => {
  it('refuses when the target is locked against move', () => {
    const store = seeded();
    store.setLock(asNodeId('p1'), { move: true });

    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'y',
        groupId: asNodeId('g'),
        newIds: [asNodeId('p2')],
      }),
    ).toThrow();
    expect(store.getNode(asNodeId('g'))).toBeUndefined();
  });

  it('refuses when the parent is locked against arrange', () => {
    const store = seeded();
    store.setLock(asNodeId('z'), { arrange: true });

    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'y',
        groupId: asNodeId('g'),
        newIds: [asNodeId('p2')],
      }),
    ).toThrow();
  });

  it('refuses a flatten when the parent is locked against arrange', () => {
    const store = seeded();
    store.setLock(asNodeId('z'), { arrange: true });

    expect(() =>
      store.split(asNodeId('p1'), { direction: 'x', newIds: [asNodeId('p2')] }),
    ).toThrow();
  });

  it('force overrides every axis', () => {
    const store = seeded();
    store.setLock(asNodeId('p1'), { move: true });
    store.setLock(asNodeId('z'), { arrange: true, dragOut: true });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
      force: true,
    });

    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2']);
  });

  it('does not refuse when the new group is registered under a parent locked against accept', () => {
    const store = seeded();
    store.setLock(asNodeId('z'), { accept: true });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2']);
  });

  // registerNode never checks 'accept', so the case above passes either way.
  // This is the real proof: applyWrap's patchPlacement checks 'resize', which is not in split's own list.
  it('runs internal calls suspended, so an axis outside the contract does not refuse', () => {
    const store = seeded();
    store.setLock(asNodeId('p1'), { resize: true });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2']);
    expect(store.getPlacement(asNodeId('p1')).size).toBeUndefined();
  });
});

describe('Store.split — persistence and undo', () => {
  it('round-trips a split tree through serialize/deserialize', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'both',
      into: [2, 2],
      groupIds: [asNodeId('g'), asNodeId('c0'), asNodeId('c1')],
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    const snap = serialize(store);
    const revived = deserialize(snap);

    expect(revived.getContainerView(asNodeId('c0'))?.childOrder).toEqual(['p1', 'p2']);
    expect(revived.getContainerView(asNodeId('c1'))?.childOrder).toEqual(['p3', 'p4']);
  });

  it('undoes a split in one step when history brackets the transaction pair', () => {
    const store = seeded();
    const history = new HistoryController<SerializedStore>();
    history.push(serialize(store));
    store.events.on('transaction.begin', () => history.beginTransaction());
    store.events.on('transaction.end', () => history.endTransaction(serialize(store)));

    store.split(asNodeId('p1'), {
      direction: 'y',
      into: 3,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3')],
    });

    const previous = history.undo();
    expect(previous).toBeDefined();
    if (previous) store.withLocksSuspended(() => deserialize(store, previous));

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1']);
    expect(store.getNode(asNodeId('g'))).toBeUndefined();
  });
});
