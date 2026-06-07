import { describe, expect, it, vi } from 'vitest';
import { createGroup, createPanel, createZone } from './constructors.js';
import { WindeaseError } from './errors.js';
import { asNodeId } from './node.js';
import { stackStrategy } from './layout/stack.js';
import {
  deserializeToNodeStore,
  migrateV1ToV2,
  serializeNodes,
  type SerializedStoreV2,
} from './snapshot-v2.js';
import type { SerializedStore, SerializedWindow } from './snapshot.js';
import { WindeaseStore } from './store.js';
import { WindeaseNodeStore } from './store-v2.js';
import { asWindowId, asZoneId } from './window.js';

function buildSampleStore(): WindeaseNodeStore {
  const s = new WindeaseNodeStore();
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

describe('serializeNodes / deserializeToNodeStore — v2 round-trip', () => {
  it('preserves tree structure and capabilities', () => {
    const original = buildSampleStore();
    const snap = serializeNodes(original);
    expect(snap.version).toBe(2);
    expect(snap.rootIds).toEqual(['z']);
    const restored = deserializeToNodeStore(snap);
    expect(restored.getContainerView(asNodeId('z'))?.childIds).toEqual(['p1', 'p2']);
    expect(restored.getContainerView(asNodeId('p2'))?.childIds).toEqual(['leaf']);
    expect(restored.getNode(asNodeId('p1'))?.meta).toEqual({ title: 'one' });
    expect(restored.getNode(asNodeId('p1'))?.slot?.placement).toEqual({ pinned: true });
  });

  it('round-trips focus', () => {
    const s = new WindeaseNodeStore();
    s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    s.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    s.focusNode(asNodeId('p'));
    const snap = serializeNodes(s);
    expect(snap.focusedId).toBe('p');
    const restored = deserializeToNodeStore(snap);
    expect(restored.focusedId).toBe('p');
    expect(restored.getNode(asNodeId('p'))?.focus?.state).toBe('focused');
  });

  it('round-trips container state (e.g. binarySplit ratio)', () => {
    const s = new WindeaseNodeStore();
    s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'binarySplit', config: {} }));
    s.setContainerState(asNodeId('z'), { ratio: 0.7 });
    const snap = serializeNodes(s);
    const zoneSnap = snap.nodes.find((n) => n.id === 'z');
    expect(zoneSnap?.container?.state).toEqual({ ratio: 0.7 });
    const restored = deserializeToNodeStore(snap);
    expect(restored.getContainerState(asNodeId('z'))).toEqual({ ratio: 0.7 });
  });
});

describe('deserializeToNodeStore — version validation', () => {
  it('throws on missing version', () => {
    expect(() => deserializeToNodeStore({})).toThrow(WindeaseError);
  });
  it('throws on unknown version', () => {
    expect(() => deserializeToNodeStore({ version: 99, nodes: [], rootIds: [], focusedId: null })).toThrow(
      WindeaseError,
    );
  });
});

describe('deserializeToNodeStore — broken snapshot', () => {
  it('throws on orphan child', () => {
    const broken: SerializedStoreV2 = {
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
    expect(() => deserializeToNodeStore(broken)).toThrow(/parentId missing/);
  });
});

describe('migrateV1ToV2', () => {
  it('translates v1 zones to zone nodes', () => {
    const store = new WindeaseStore();
    store.registerZone({ id: asZoneId('z'), strategy: stackStrategy as never, config: {} });
    store.createWindow({ id: asWindowId('p'), kind: 'panel' });
    store.claim(asZoneId('z'), asWindowId('p'));
    const v1 = store.snapshot();
    const v2 = migrateV1ToV2(v1);
    expect(v2.version).toBe(2);
    const zone = v2.nodes.find((n) => n.id === 'z');
    expect(zone?.kind).toBe('zone');
    const panel = v2.nodes.find((n) => n.id === 'p');
    expect(panel?.kind).toBe('panel');
    expect(panel?.slot?.parentId).toBe('z');
  });

  it('drops unowned v1 windows with a warning', () => {
    const store = new WindeaseStore();
    store.createWindow({ id: asWindowId('orphan'), kind: 'panel' });
    const v1 = store.snapshot();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v2 = migrateV1ToV2(v1);
    expect(v2.nodes.find((n) => n.id === 'orphan')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('moves itemMeta into placement', () => {
    const store = new WindeaseStore();
    store.registerZone({ id: asZoneId('z'), strategy: stackStrategy as never, config: {} });
    store.createWindow({ id: asWindowId('p'), kind: 'panel' });
    store.claim(asZoneId('z'), asWindowId('p'), undefined, { pinned: true });
    const v1 = store.snapshot();
    const v2 = migrateV1ToV2(v1);
    const panel = v2.nodes.find((n) => n.id === 'p');
    expect(panel?.slot?.placement).toEqual({ pinned: true });
  });
});

describe('deserializeToNodeStore — v1 input flows through migration', () => {
  it('hydrates a v1 snapshot via migration', () => {
    const store = new WindeaseStore();
    store.registerZone({ id: asZoneId('z'), strategy: stackStrategy as never, config: {} });
    store.createWindow({ id: asWindowId('p'), kind: 'panel' });
    store.claim(asZoneId('z'), asWindowId('p'));
    const v1 = store.snapshot();
    const restored = deserializeToNodeStore(v1);
    expect(restored.getContainerView(asNodeId('z'))?.childIds).toEqual(['p']);
    expect(restored.getNode(asNodeId('p'))?.kind).toBe('panel');
  });
});

describe('snapshot v2 — activity', () => {
  it('round-trips activity verbatim', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.patchActivity(asNodeId('p'), { busy: true, lastAt: 1234 });
    const snap = serializeNodes(store);
    const pSerialized = snap.nodes.find((n) => n.id === 'p')!;
    expect(pSerialized.activity).toEqual({ busy: true, lastAt: 1234 });

    const hydrated = deserializeToNodeStore(snap);
    expect(hydrated.getActivity(asNodeId('p'))).toEqual({ busy: true, lastAt: 1234 });
  });

  it('omits activity from snapshot when empty', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    const snap = serializeNodes(store);
    expect(snap.nodes.find((n) => n.id === 'p')!.activity).toBeUndefined();
  });

  it('omits activity after setActivity({}) clears it', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.patchActivity(asNodeId('p'), { busy: true });
    store.setActivity(asNodeId('p'), {});
    const snap = serializeNodes(store);
    expect(snap.nodes.find((n) => n.id === 'p')!.activity).toBeUndefined();
  });

  it('v1 → v2 migration leaves activity absent', () => {
    const v1: SerializedStore = {
      version: 1,
      zones: [
        {
          id: 'z',
          strategyName: 'grid',
          config: {},
          windowIds: ['p'],
          allowsPinning: true,
          itemMeta: {},
        },
      ],
      windows: [
        {
          id: 'p',
          zoneId: 'z',
          lifecycle: 'visible',
          focus: 'blurred',
        } as SerializedWindow,
      ],
    };
    const migrated = migrateV1ToV2(v1);
    const p = migrated.nodes.find((n) => n.id === 'p')!;
    expect(p.activity).toBeUndefined();
  });
});

describe('serializeNodes — groups + recursion', () => {
  it('serializes a group inside a zone', () => {
    const s = new WindeaseNodeStore();
    s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    s.registerNode(
      createGroup({
        id: asNodeId('g'),
        parentId: asNodeId('z'),
        strategyId: 'stack',
        config: { axis: 'horizontal' },
      }),
    );
    const snap = serializeNodes(s);
    const group = snap.nodes.find((n) => n.id === 'g');
    expect(group?.kind).toBe('group');
    expect(group?.container?.strategyId).toBe('stack');
    expect(group?.slot?.parentId).toBe('z');
    expect(group?.focus).toBeUndefined();
    const restored = deserializeToNodeStore(snap);
    expect(restored.getNode(asNodeId('g'))?.container).toBeDefined();
    expect(restored.getNode(asNodeId('g'))?.focus).toBeUndefined();
  });
});
