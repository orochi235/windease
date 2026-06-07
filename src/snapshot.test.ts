import { describe, expect, it } from 'vitest';
import { createGroup, createPanel, createZone } from './constructors.js';
import { WindeaseError } from './errors.js';
import { asNodeId } from './node.js';
import {
  deserialize,
  serialize,
  type SerializedStore,
} from './snapshot.js';
import { Store } from './store.js';

function buildSampleStore(): Store {
  const s = new Store();
  s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: { axis: 'vertical' } }));
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

describe('serialize / deserialize — v2 round-trip', () => {
  it('preserves tree structure and capabilities', () => {
    const original = buildSampleStore();
    const snap = serialize(original);
    expect(snap.version).toBe(2);
    expect(snap.rootIds).toEqual(['z']);
    const restored = deserialize(snap);
    expect(restored.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2']);
    expect(restored.getContainerView(asNodeId('p2'))?.childOrder).toEqual(['leaf']);
    expect(restored.getNode(asNodeId('p1'))?.meta).toEqual({ title: 'one' });
    expect(restored.getNode(asNodeId('p1'))?.slot?.placement).toEqual({ pinned: true });
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

  it('round-trips allowsDrop / allowsDragOut, omits when default true', () => {
    const s = new Store();
    s.registerNode(createZone({ id: asNodeId('open'), strategyId: 'stack', config: {} }));
    s.registerNode(createZone({ id: asNodeId('sealed'), strategyId: 'stack', config: {} }));
    s.setAllowsDrop(asNodeId('sealed'), false);
    s.setAllowsDragOut(asNodeId('sealed'), false);
    const snap = serialize(s);
    const openSnap = snap.nodes.find((n) => n.id === 'open');
    const sealedSnap = snap.nodes.find((n) => n.id === 'sealed');
    expect(openSnap?.container?.allowsDrop).toBeUndefined();
    expect(openSnap?.container?.allowsDragOut).toBeUndefined();
    expect(sealedSnap?.container?.allowsDrop).toBe(false);
    expect(sealedSnap?.container?.allowsDragOut).toBe(false);
    const restored = deserialize(snap);
    expect(restored.getNode(asNodeId('open'))?.container?.allowsDrop).toBe(true);
    expect(restored.getNode(asNodeId('sealed'))?.container?.allowsDrop).toBe(false);
    expect(restored.getNode(asNodeId('sealed'))?.container?.allowsDragOut).toBe(false);
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
      version: 2,
      nodes: [
        {
          id: 'p',
          kind: 'panel',
          lifecycle: 'mounted',
          slot: { parentId: 'missing', placement: {} },
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

describe('deserialize — rejects v1 snapshots', () => {
  it('throws on version: 1', () => {
    expect(() =>
      deserialize({ version: 1, zones: [], windows: [] }),
    ).toThrow(/version: 1/);
  });
});

describe('snapshot v2 — activity', () => {
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
    expect(group?.slot?.parentId).toBe('z');
    expect(group?.focus).toBeUndefined();
    const restored = deserialize(snap);
    expect(restored.getNode(asNodeId('g'))?.container).toBeDefined();
    expect(restored.getNode(asNodeId('g'))?.focus).toBeUndefined();
  });
});
