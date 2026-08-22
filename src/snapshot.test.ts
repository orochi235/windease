import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { WindeaseError } from './errors.js';
import { asNodeId } from './node.js';
import { deserialize, type SerializedStore, serialize } from './snapshot.js';
import { Store } from './store.js';

function buildSampleStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'stack', config: { axis: 'vertical' } },
      id: asNodeId('z'),
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p1'),
      parentId: asNodeId('z'),
      meta: { title: 'one' },
      placement: { pinned: true },
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('p2'),
      parentId: asNodeId('z'),
      container: { strategyId: 'stack', config: {} },
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: asNodeId('leaf'),
      parentId: asNodeId('p2'),
    }),
  );
  return s;
}

describe('serialize / deserialize — v4 round-trip', () => {
  it('preserves tree structure and capabilities', () => {
    const original = buildSampleStore();
    const snap = serialize(original);
    expect(snap.version).toBe(5);
    expect(snap.rootIds).toEqual(['z']);
    const restored = deserialize(snap);
    expect(restored.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2']);
    expect(restored.getContainerView(asNodeId('p2'))?.childOrder).toEqual(['leaf']);
    expect(restored.getNode(asNodeId('p1'))?.meta).toEqual({ title: 'one' });
    expect(restored.getNode(asNodeId('p1'))?.membership?.placement).toEqual({ pinned: true });
  });

  it('round-trips focus', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    s.focusNode(asNodeId('p'));
    const snap = serialize(s);
    expect(snap.focusedId).toBe('p');
    const restored = deserialize(snap);
    expect(restored.focusedId).toBe('p');
    expect(restored.getNode(asNodeId('p'))?.focus?.state).toBe('focused');
  });

  it('round-trips container state (e.g. a resize ratio)', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'split', config: {} },
        id: asNodeId('z'),
      }),
    );
    s.setContainerState(asNodeId('z'), { ratio: 0.7 });
    const snap = serialize(s);
    const zoneSnap = snap.nodes.find((n) => n.id === 'z');
    expect(zoneSnap?.container?.state).toEqual({ ratio: 0.7 });
    const restored = deserialize(snap);
    expect(restored.getContainerState(asNodeId('z'))).toEqual({ ratio: 0.7 });
  });
});

describe('deserialize — version validation', () => {
  it('throws on missing version', () => {
    expect(() => deserialize({})).toThrow(WindeaseError);
  });
  it('throws on unknown version', () => {
    expect(() => deserialize({ version: 99, nodes: [], rootIds: [], focusedId: null })).toThrow(
      WindeaseError,
    );
  });
});

describe('deserialize — broken snapshot', () => {
  it('throws on orphan child', () => {
    const broken: SerializedStore = {
      version: 5,
      nodes: [
        {
          id: 'p',
          kind: 'panel',
          lifecycle: 'mounted',
          membership: { parentId: 'missing', placement: {} },
          focus: { state: 'blurred' },
        },
      ],
      rootIds: [],
      focusedId: null,
    };
    expect(() => deserialize(broken)).toThrow(/parentId missing/);
  });
});

describe('deserialize — back-compat for legacy childIds key', () => {
  it('accepts container.childIds (old shape) as childOrder', () => {
    // Snapshot written by a 0.3.x build, where containers still used `childIds`.
    const legacy = {
      version: 2,
      nodes: [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'mounted',
          container: {
            strategyId: 'stack',
            config: {},
            childIds: ['p1', 'p2'],
            allowsPinning: false,
          },
        },
        {
          id: 'p1',
          kind: 'panel',
          lifecycle: 'mounted',
          slot: { parentId: 'z', placement: {} },
          focus: { state: 'blurred' },
        },
        {
          id: 'p2',
          kind: 'panel',
          lifecycle: 'mounted',
          slot: { parentId: 'z', placement: {} },
          focus: { state: 'blurred' },
        },
      ],
      rootIds: ['z'],
      focusedId: null,
    };
    const restored = deserialize(legacy);
    expect(restored.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2']);
  });
});

describe('deserialize — back-compat for legacy v2 slot key', () => {
  // v2 named the parent-membership capability `slot`. Snapshots persisted by
  // 0.8.0 and earlier must still hydrate.
  const v2Snapshot = {
    version: 2,
    nodes: [
      {
        id: 'z',
        kind: 'zone',
        lifecycle: 'mounted',
        container: {
          strategyId: 'stack',
          config: {},
          childOrder: ['p'],
          allowsPinning: true,
        },
      },
      {
        id: 'p',
        kind: 'panel',
        lifecycle: 'mounted',
        slot: { parentId: 'z', placement: { pinned: true, size: { h: 120 } } },
        focus: { state: 'blurred' },
      },
    ],
    rootIds: ['z'],
    focusedId: null,
  };

  it('hydrates a v2 slot into membership, migrating boolean pinned to its held index', () => {
    const restored = deserialize(structuredClone(v2Snapshot));
    const p = restored.getNode(asNodeId('p'));
    expect(p?.membership?.parentId).toBe('z');
    expect(p?.membership?.placement).toEqual({ pinned: 0, size: { h: 120 } });
    expect(restored.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p']);
  });

  it('re-serializes a hydrated v2 snapshot as v4 with membership', () => {
    const reserialized = serialize(deserialize(structuredClone(v2Snapshot)));
    expect(reserialized.version).toBe(5);
    const p = reserialized.nodes.find((n) => n.id === 'p');
    expect(p?.membership?.parentId).toBe('z');
    expect(p).not.toHaveProperty('slot');
  });
});

describe('deserialize — rejects v1 snapshots', () => {
  it('throws on version: 1', () => {
    expect(() => deserialize({ version: 1, zones: [], windows: [] })).toThrow(/version: 1/);
  });
});

describe('snapshot v3 — activity', () => {
  it('round-trips activity verbatim', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    store.patchActivity(asNodeId('p'), { busy: true, lastAt: 1234 });
    const snap = serialize(store);
    const pSerialized = snap.nodes.find((n) => n.id === 'p')!;
    expect(pSerialized.activity).toEqual({ busy: true, lastAt: 1234 });

    const hydrated = deserialize(snap);
    expect(hydrated.getActivity(asNodeId('p'))).toEqual({ busy: true, lastAt: 1234 });
  });

  it('omits activity from snapshot when empty', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    const snap = serialize(store);
    expect(snap.nodes.find((n) => n.id === 'p')!.activity).toBeUndefined();
  });

  it('omits activity after setActivity({}) clears it', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    store.patchActivity(asNodeId('p'), { busy: true });
    store.setActivity(asNodeId('p'), {});
    const snap = serialize(store);
    expect(snap.nodes.find((n) => n.id === 'p')!.activity).toBeUndefined();
  });
});

describe('serialize — groups + recursion', () => {
  it('serializes a group inside a zone', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    const groupNode = createNode({
      kind: 'zone',
      container: { strategyId: 'stack', config: { axis: 'horizontal' } },
      id: asNodeId('g'),
      parentId: asNodeId('z'),
    });
    groupNode.kind = 'group';
    s.registerNode(groupNode);
    const snap = serialize(s);
    const group = snap.nodes.find((n) => n.id === 'g');
    expect(group?.kind).toBe('group');
    expect(group?.container?.strategyId).toBe('stack');
    expect(group?.membership?.parentId).toBe('z');
    expect(group?.focus).toBeUndefined();
    const restored = deserialize(snap);
    expect(restored.getNode(asNodeId('g'))?.container).toBeDefined();
    expect(restored.getNode(asNodeId('g'))?.focus).toBeUndefined();
  });
});

describe('snapshot — placement.size and hints.maxSize', () => {
  it('round-trips placement.size on a membership', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('a'),
        parentId: asNodeId('z'),
        placement: { size: { h: 180 } },
      }),
    );
    const snap = serialize(store);
    const restored = deserialize(snap);
    const placement = restored.getNode(asNodeId('a'))?.membership?.placement as {
      size: { h: number };
    };
    expect(placement.size).toEqual({ h: 180 });
  });

  it('round-trips hints.maxSize', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('a'),
        parentId: asNodeId('z'),
        hints: { minSize: { w: 10, h: 10 }, maxSize: { w: 400, h: 400 } },
      }),
    );
    const snap = serialize(store);
    const restored = deserialize(snap);
    expect(restored.getNode(asNodeId('a'))?.hints?.maxSize).toEqual({ w: 400, h: 400 });
  });
});

describe('snapshot v4 — lock round-trip', () => {
  it('round-trips a single-axis lock', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    store.setLock(asNodeId('p'), { destroy: true });
    const snap = serialize(store);
    expect(snap.nodes.find((n) => n.id === 'p')?.lock).toEqual({ destroy: true });
    const restored = deserialize(snap);
    expect(restored.getLock(asNodeId('p'))).toEqual({ destroy: true });
  });

  it('round-trips lock(true) resolved to all supported axes', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    store.setLock(asNodeId('p'), true);
    const snap = serialize(store);
    const restored = deserialize(snap);
    expect(restored.getLock(asNodeId('p'))).toEqual({
      move: true,
      resize: true,
      destroy: true,
      arrange: true,
    });
  });

  it('omits lock and pinned from a node that has neither', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    const snap = serialize(store);
    const pSnap = snap.nodes.find((n) => n.id === 'p');
    expect(pSnap?.lock).toBeUndefined();
    expect(pSnap?.membership?.placement).not.toHaveProperty('pinned');
  });
});

describe('snapshot v4 — pinned round-trip', () => {
  it('round-trips a held index', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p1'),
        parentId: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p2'),
        parentId: asNodeId('z'),
      }),
    );
    store.setPinned(asNodeId('p1'), 0);
    const snap = serialize(store);
    expect(snap.version).toBe(5);
    const restored = deserialize(snap);
    expect(restored.getPinnedIndex(asNodeId('p1'))).toBe(0);
  });
});

describe('deserialize — v3 migration to v4', () => {
  function v3Fixture(nodes: unknown[], rootIds: string[]): unknown {
    return { version: 3, nodes, rootIds, focusedId: null };
  }

  it('migrates container.allowsDrop: false to lock.accept', () => {
    const snap = v3Fixture(
      [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'mounted',
          container: {
            strategyId: 'stack',
            config: {},
            childOrder: [],
            allowsPinning: true,
            allowsDrop: false,
          },
        },
      ],
      ['z'],
    );
    const restored = deserialize(snap);
    expect(restored.getLock(asNodeId('z'))).toEqual({ accept: true });
  });

  it('migrates container.allowsDragOut: false to lock.dragOut', () => {
    const snap = v3Fixture(
      [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'mounted',
          container: {
            strategyId: 'stack',
            config: {},
            childOrder: [],
            allowsPinning: true,
            allowsDragOut: false,
          },
        },
      ],
      ['z'],
    );
    const restored = deserialize(snap);
    expect(restored.getLock(asNodeId('z'))).toEqual({ dragOut: true });
  });

  it('produces no lock when allowsDrop/allowsDragOut are true or absent', () => {
    const snap = v3Fixture(
      [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'mounted',
          container: {
            strategyId: 'stack',
            config: {},
            childOrder: [],
            allowsPinning: true,
            allowsDrop: true,
            allowsDragOut: true,
          },
        },
      ],
      ['z'],
    );
    const restored = deserialize(snap);
    expect(restored.getLock(asNodeId('z'))).toEqual({});
  });

  it('migrates placement.locked: true to a full move/resize/destroy lock and drops the key', () => {
    const snap = v3Fixture(
      [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'mounted',
          container: {
            strategyId: 'stack',
            config: {},
            childOrder: ['p'],
            allowsPinning: true,
          },
        },
        {
          id: 'p',
          kind: 'panel',
          lifecycle: 'mounted',
          membership: { parentId: 'z', placement: { locked: true } },
          focus: { state: 'blurred' },
        },
      ],
      ['z'],
    );
    const restored = deserialize(snap);
    expect(restored.getLock(asNodeId('p'))).toEqual({ move: true, resize: true, destroy: true });
    expect(restored.getPlacement(asNodeId('p'))).not.toHaveProperty('locked');
  });

  it('migrates boolean placement.pinned to the held index without promoting the node', () => {
    const snap = v3Fixture(
      [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'mounted',
          container: {
            strategyId: 'stack',
            config: {},
            childOrder: ['p1', 'p2'],
            allowsPinning: true,
          },
        },
        {
          id: 'p1',
          kind: 'panel',
          lifecycle: 'mounted',
          membership: { parentId: 'z', placement: {} },
          focus: { state: 'blurred' },
        },
        {
          id: 'p2',
          kind: 'panel',
          lifecycle: 'mounted',
          membership: { parentId: 'z', placement: { pinned: true } },
          focus: { state: 'blurred' },
        },
      ],
      ['z'],
    );
    const restored = deserialize(snap);
    // p2 held index 1 — its position in the v3 childOrder, not promoted to 0.
    expect(restored.getPinnedIndex(asNodeId('p2'))).toBe(1);
    expect(restored.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2']);
  });

  it('does not mutate the caller-supplied v3 snapshot object', () => {
    const original = v3Fixture(
      [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'mounted',
          container: {
            strategyId: 'stack',
            config: {},
            childOrder: ['p'],
            allowsPinning: true,
            allowsDrop: false,
          },
        },
        {
          id: 'p',
          kind: 'panel',
          lifecycle: 'mounted',
          membership: { parentId: 'z', placement: { locked: true, pinned: true } },
          focus: { state: 'blurred' },
        },
      ],
      ['z'],
    );
    const snapshot = structuredClone(original);
    deserialize(original);
    expect(original).toEqual(snapshot);
  });

  it('a v2 snapshot still deserializes without throwing', () => {
    const v2 = {
      version: 2,
      nodes: [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'mounted',
          container: { strategyId: 'stack', config: {}, childOrder: ['p'], allowsPinning: true },
        },
        {
          id: 'p',
          kind: 'panel',
          lifecycle: 'mounted',
          slot: { parentId: 'z', placement: {} },
          focus: { state: 'blurred' },
        },
      ],
      rootIds: ['z'],
      focusedId: null,
    };
    expect(() => deserialize(v2)).not.toThrow();
  });
});

describe('deserialize — capability filtering on lock (defense against malformed snapshots)', () => {
  it('drops an axis a container-only node does not support', () => {
    const snap: SerializedStore = {
      version: 5,
      nodes: [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'mounted',
          container: { strategyId: 'stack', config: {}, childOrder: [], allowsPinning: true },
          // Malformed: 'move' requires membership, which this node lacks.
          lock: { move: true, accept: true },
        },
      ],
      rootIds: ['z'],
      focusedId: null,
    };
    const restored = deserialize(snap);
    expect(restored.getLock(asNodeId('z'))).toEqual({ accept: true });
  });
});

describe('deserialize — in-place restore with a destroy-locked root', () => {
  it('does not throw when the target store has a destroy-locked root', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.setLock(asNodeId('z'), { destroy: true });
    const snap = serialize(store);
    expect(() => deserialize(store, snap)).not.toThrow();
    expect(store.getNode(asNodeId('z'))).toBeDefined();
  });
});

describe('v4 → v5 split migration', () => {
  function v4WithSplit() {
    return {
      version: 4,
      rootIds: ['z'],
      focusedId: null,
      nodes: [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'visible',
          container: {
            strategyId: 'split',
            config: { gutterSize: 4 },
            childOrder: ['a', 'b', 'c'],
            allowsPinning: true,
            state: {
              kind: 'split',
              direction: 'horizontal',
              ratio: 0.5,
              a: { kind: 'leaf', id: 'a' },
              b: {
                kind: 'split',
                direction: 'vertical',
                ratio: 0.5,
                a: { kind: 'leaf', id: 'b' },
                b: { kind: 'leaf', id: 'c' },
              },
            },
          },
        },
        {
          id: 'a',
          kind: 'panel',
          lifecycle: 'visible',
          membership: { parentId: 'z', placement: {} },
          focus: 'blurred',
        },
        {
          id: 'b',
          kind: 'panel',
          lifecycle: 'visible',
          membership: { parentId: 'z', placement: {} },
          focus: 'blurred',
        },
        {
          id: 'c',
          kind: 'panel',
          lifecycle: 'visible',
          membership: { parentId: 'z', placement: {} },
          focus: 'blurred',
        },
      ],
    };
  }

  it('turns the split root into a strip and drops the state', () => {
    const store = deserialize(v4WithSplit() as never);

    const z = store.getNode(asNodeId('z'));
    expect(z?.container?.strategyId).toBe('strip');
    expect(z?.container?.config).toMatchObject({ axis: 'x', fill: true });
    expect(store.getContainerState(asNodeId('z'))).toBeUndefined();
  });

  it('rebuilds the nested split as a real group', () => {
    const store = deserialize(v4WithSplit() as never);

    const top = store.getContainerView(asNodeId('z'))?.childOrder ?? [];
    expect(top).toHaveLength(2);
    expect(top[0]).toBe('a');

    const inner = store.getNode(top[1] as never);
    expect(inner?.container?.strategyId).toBe('strip');
    expect(inner?.container?.config).toMatchObject({ axis: 'y' });
    expect(store.getContainerView(top[1] as never)?.childOrder).toEqual(['b', 'c']);
  });

  it('keeps every original leaf, none orphaned', () => {
    const store = deserialize(v4WithSplit() as never);

    for (const id of ['a', 'b', 'c']) {
      expect(store.getNode(asNodeId(id))).toBeDefined();
      expect(store.getParent(asNodeId(id))).toBeDefined();
    }
  });

  it('leaves a v4 snapshot with no split container alone', () => {
    const snap = v4WithSplit();
    snap.nodes[0]!.container!.strategyId = 'strip';
    delete (snap.nodes[0]!.container as Record<string, unknown>).state;

    const store = deserialize(snap as never);

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'b', 'c']);
  });

  it('serializes at v5', () => {
    expect(serialize(new Store()).version).toBe(5);
  });

  it('round-trips a v5 snapshot unchanged', () => {
    const store = deserialize(v4WithSplit() as never);
    const once = serialize(store);
    const twice = serialize(deserialize(once));
    expect(twice).toEqual(once);
  });

  it('rewrites a split container to strip with axis x when state is missing', () => {
    const snap = v4WithSplit();
    delete (snap.nodes[0]!.container as Record<string, unknown>).state;

    const store = deserialize(snap as never);

    const z = store.getNode(asNodeId('z'));
    expect(z?.container?.strategyId).toBe('strip');
    expect(z?.container?.config).toMatchObject({ axis: 'x', fill: true });
  });

  it('does not throw when container.state is malformed, not a legacy split tree', () => {
    const snap = v4WithSplit();
    (snap.nodes[0]!.container as { state: unknown }).state = { totally: 'not-a-split-node' };

    expect(() => deserialize(snap as never)).not.toThrow();
    const store = deserialize(snap as never);
    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('strip');
  });

  it('converts a 3-level-deep tree, both sides nested', () => {
    function leaf(id: string) {
      return { kind: 'leaf' as const, id };
    }
    const snap = {
      version: 4,
      rootIds: ['z'],
      focusedId: null,
      nodes: [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'visible',
          container: {
            strategyId: 'split',
            config: {},
            childOrder: ['a', 'b', 'c', 'd', 'e'],
            allowsPinning: true,
            // Unbalanced: nesting on the `a` side as well as `b`, three levels deep.
            state: {
              kind: 'split',
              direction: 'horizontal',
              ratio: 0.5,
              a: { kind: 'split', direction: 'vertical', ratio: 0.5, a: leaf('a'), b: leaf('b') },
              b: {
                kind: 'split',
                direction: 'vertical',
                ratio: 0.5,
                a: leaf('c'),
                b: {
                  kind: 'split',
                  direction: 'horizontal',
                  ratio: 0.5,
                  a: leaf('d'),
                  b: leaf('e'),
                },
              },
            },
          },
        },
        ...['a', 'b', 'c', 'd', 'e'].map((id) => ({
          id,
          kind: 'panel',
          lifecycle: 'visible',
          membership: { parentId: 'z', placement: {} },
          focus: 'blurred',
        })),
      ],
    };

    const store = deserialize(snap as never);

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(store.getNode(asNodeId(id))).toBeDefined();
      expect(store.getParent(asNodeId(id))).toBeDefined();
    }
    const top = store.getContainerView(asNodeId('z'))?.childOrder ?? [];
    expect(top).toHaveLength(2);
    const leftGroup = top[0] as never;
    const rightGroup = top[1] as never;
    expect(store.getContainerView(leftGroup)?.childOrder).toEqual(['a', 'b']);
    expect(store.getNode(leftGroup)?.container?.config).toMatchObject({ axis: 'y' });
    const rightChildren = store.getContainerView(rightGroup)?.childOrder ?? [];
    expect(rightChildren[0]).toBe('c');
    const deepGroup = rightChildren[1] as never;
    expect(store.getContainerView(deepGroup)?.childOrder).toEqual(['d', 'e']);
    expect(store.getNode(deepGroup)?.container?.config).toMatchObject({ axis: 'x' });
  });

  it('mints a collision-free id when the deterministic scheme collides with an existing node', () => {
    const snap = v4WithSplit();
    // 'z:s1' is exactly what the deterministic scheme mints for the nested
    // split at path [1] — plant it as an unrelated root to force a collision.
    snap.nodes.push({
      id: 'z:s1',
      kind: 'zone',
      lifecycle: 'visible',
      container: { strategyId: 'stack', config: {}, childOrder: [], allowsPinning: true },
    } as never);
    snap.rootIds.push('z:s1');

    expect(() => deserialize(snap as never)).not.toThrow();
    const store = deserialize(snap as never);
    // The pre-existing 'z:s1' root is untouched...
    expect(store.getNode(asNodeId('z:s1'))?.container?.strategyId).toBe('stack');
    // ...and the nested split still got its own group, under a different id.
    const top = store.getContainerView(asNodeId('z'))?.childOrder ?? [];
    expect(top).toHaveLength(2);
    expect(top[1]).not.toBe('z:s1');
    expect(store.getContainerView(top[1] as never)?.childOrder).toEqual(['b', 'c']);
  });
});

describe('v4 → v5 split migration — hostile input', () => {
  // container.state is consumer data of unknown provenance; every case here
  // must fall back to a flat strip rather than throw, per the spec's own
  // premise that a v4 snapshot may have drifted from any version we control.
  function v4SplitContainer(state: unknown, childOrder: string[]) {
    return {
      version: 4,
      rootIds: ['z'],
      focusedId: null,
      nodes: [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'visible',
          container: {
            strategyId: 'split',
            config: { gutterSize: 4 },
            childOrder,
            allowsPinning: true,
            state,
          },
        },
        ...childOrder.map((id) => ({
          id,
          kind: 'panel',
          lifecycle: 'visible',
          membership: { parentId: 'z', placement: {} },
          focus: 'blurred',
        })),
      ],
    };
  }

  it('falls back when the tree covers only some of childOrder, keeping the rest as flat siblings', () => {
    const snap = v4SplitContainer(
      {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'a' },
        b: { kind: 'leaf', id: 'b' },
      },
      ['a', 'b', 'c'],
    );

    expect(() => deserialize(snap as never)).not.toThrow();
    const store = deserialize(snap as never);

    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('strip');
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c']) {
      expect(store.getParent(asNodeId(id))).toBeDefined();
    }
  });

  it('falls back when a leaf names a node absent from the snapshot entirely', () => {
    const snap = v4SplitContainer(
      {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'ghost' },
        b: { kind: 'leaf', id: 'a' },
      },
      ['a'],
    );

    expect(() => deserialize(snap as never)).not.toThrow();
    const store = deserialize(snap as never);

    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('strip');
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a']);
    expect(store.getParent(asNodeId('a'))).toBeDefined();
  });

  it('falls back when the same leaf id appears twice in the tree', () => {
    const snap = v4SplitContainer(
      {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'a' },
        b: { kind: 'leaf', id: 'a' },
      },
      ['a', 'b'],
    );

    expect(() => deserialize(snap as never)).not.toThrow();
    const store = deserialize(snap as never);

    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('strip');
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'b']);
    for (const id of ['a', 'b']) {
      expect(store.getParent(asNodeId(id))).toBeDefined();
    }
  });

  it('falls back instead of overflowing the stack on a cyclic state', () => {
    const cyclic: Record<string, unknown> = {
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf', id: 'a' },
    };
    cyclic.b = cyclic;
    const snap = v4SplitContainer(cyclic, ['a']);

    expect(() => deserialize(snap as never)).not.toThrow();
    const store = deserialize(snap as never);

    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('strip');
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a']);
    expect(store.getParent(asNodeId('a'))).toBeDefined();
  });

  it('still rebuilds a well-formed tree exactly as before (no false-positive fallback)', () => {
    const snap = v4SplitContainer(
      {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        a: { kind: 'leaf', id: 'a' },
        b: {
          kind: 'split',
          direction: 'vertical',
          ratio: 0.5,
          a: { kind: 'leaf', id: 'b' },
          b: { kind: 'leaf', id: 'c' },
        },
      },
      ['a', 'b', 'c'],
    );

    const store = deserialize(snap as never);

    const top = store.getContainerView(asNodeId('z'))?.childOrder ?? [];
    expect(top).toEqual(['a', expect.any(String)]);
    expect(store.getContainerView(top[1] as never)?.childOrder).toEqual(['b', 'c']);
  });
});
