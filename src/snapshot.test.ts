import { describe, expect, it } from 'vitest';
import { createGroup, createPanel, createZone } from './constructors.js';
import { WindeaseError } from './errors.js';
import { asNodeId } from './node.js';
import { deserialize, type SerializedStore, serialize } from './snapshot.js';
import { Store } from './store.js';

function buildSampleStore(): Store {
  const s = new Store();
  s.registerNode(
    createZone({ id: asNodeId('z'), strategyId: 'stack', config: { axis: 'vertical' } }),
  );
  s.registerNode(
    createPanel({
      id: asNodeId('p1'),
      parentId: asNodeId('z'),
      meta: { title: 'one' },
      placement: { pinned: true },
    }),
  );
  s.registerNode(
    createPanel({
      id: asNodeId('p2'),
      parentId: asNodeId('z'),
      container: { strategyId: 'stack', config: {} },
    }),
  );
  s.registerNode(createPanel({ id: asNodeId('leaf'), parentId: asNodeId('p2') }));
  return s;
}

describe('serialize / deserialize — v4 round-trip', () => {
  it('preserves tree structure and capabilities', () => {
    const original = buildSampleStore();
    const snap = serialize(original);
    expect(snap.version).toBe(4);
    expect(snap.rootIds).toEqual(['z']);
    const restored = deserialize(snap);
    expect(restored.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2']);
    expect(restored.getContainerView(asNodeId('p2'))?.childOrder).toEqual(['leaf']);
    expect(restored.getNode(asNodeId('p1'))?.meta).toEqual({ title: 'one' });
    expect(restored.getNode(asNodeId('p1'))?.membership?.placement).toEqual({ pinned: true });
  });

  it('round-trips focus', () => {
    const s = new Store();
    s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    s.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    s.focusNode(asNodeId('p'));
    const snap = serialize(s);
    expect(snap.focusedId).toBe('p');
    const restored = deserialize(snap);
    expect(restored.focusedId).toBe('p');
    expect(restored.getNode(asNodeId('p'))?.focus?.state).toBe('focused');
  });

  it('round-trips container state (e.g. splitStrategy ratio)', () => {
    const s = new Store();
    s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'split', config: {} }));
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
      version: 4,
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
    expect(reserialized.version).toBe(4);
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
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.patchActivity(asNodeId('p'), { busy: true, lastAt: 1234 });
    const snap = serialize(store);
    const pSerialized = snap.nodes.find((n) => n.id === 'p')!;
    expect(pSerialized.activity).toEqual({ busy: true, lastAt: 1234 });

    const hydrated = deserialize(snap);
    expect(hydrated.getActivity(asNodeId('p'))).toEqual({ busy: true, lastAt: 1234 });
  });

  it('omits activity from snapshot when empty', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    const snap = serialize(store);
    expect(snap.nodes.find((n) => n.id === 'p')!.activity).toBeUndefined();
  });

  it('omits activity after setActivity({}) clears it', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.patchActivity(asNodeId('p'), { busy: true });
    store.setActivity(asNodeId('p'), {});
    const snap = serialize(store);
    expect(snap.nodes.find((n) => n.id === 'p')!.activity).toBeUndefined();
  });
});

describe('serialize — groups + recursion', () => {
  it('serializes a group inside a zone', () => {
    const s = new Store();
    s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    s.registerNode(
      createGroup({
        id: asNodeId('g'),
        parentId: asNodeId('z'),
        strategyId: 'stack',
        config: { axis: 'horizontal' },
      }),
    );
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
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(
      createPanel({
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
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(
      createPanel({
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
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.setLock(asNodeId('p'), { destroy: true });
    const snap = serialize(store);
    expect(snap.nodes.find((n) => n.id === 'p')?.lock).toEqual({ destroy: true });
    const restored = deserialize(snap);
    expect(restored.getLock(asNodeId('p'))).toEqual({ destroy: true });
  });

  it('round-trips lock(true) resolved to all supported axes', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.setLock(asNodeId('p'), true);
    const snap = serialize(store);
    const restored = deserialize(snap);
    expect(restored.getLock(asNodeId('p'))).toEqual({ move: true, resize: true, destroy: true });
  });

  it('omits lock and pinned from a node that has neither', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    const snap = serialize(store);
    const pSnap = snap.nodes.find((n) => n.id === 'p');
    expect(pSnap?.lock).toBeUndefined();
    expect(pSnap?.membership?.placement).not.toHaveProperty('pinned');
  });
});

describe('snapshot v4 — pinned round-trip', () => {
  it('round-trips a held index', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('p2'), parentId: asNodeId('z') }));
    store.setPinned(asNodeId('p1'), 0);
    const snap = serialize(store);
    expect(snap.version).toBe(4);
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
      version: 4,
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
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.setLock(asNodeId('z'), { destroy: true });
    const snap = serialize(store);
    expect(() => deserialize(store, snap)).not.toThrow();
    expect(store.getNode(asNodeId('z'))).toBeDefined();
  });
});
