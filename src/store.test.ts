import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGroup, createPanel, createZone } from './constructors.js';
import {
  CapabilityMissingError,
  CycleError,
  DuplicateNodeError,
  NodeNotFoundError,
} from './errors.js';
import { asNodeId, type NodeId } from './node.js';
import { Store, type StoreEvents } from './store.js';

function fresh(): Store {
  return new Store();
}

function id(s: string): NodeId {
  return asNodeId(s);
}

describe('Store — register / unregister', () => {
  it('registers a zone as a root node', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    expect(s.rootIds).toEqual(['z']);
    expect(s.getNode(id('z'))?.kind).toBe('zone');
  });

  it('registers a panel under a zone, appending to childOrder', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('p1'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('p2'), parentId: id('z') }));
    expect(s.getContainerView(id('z'))?.childOrder).toEqual(['p1', 'p2']);
  });

  it('throws DuplicateNodeError on re-register', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    expect(() =>
      s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} })),
    ).toThrow(DuplicateNodeError);
  });

  it('throws NodeNotFoundError when parent does not exist', () => {
    const s = fresh();
    expect(() =>
      s.registerNode(createPanel({ id: id('p1'), parentId: id('missing') })),
    ).toThrow(NodeNotFoundError);
  });

  it('emits node.registered', () => {
    const s = fresh();
    const cb = vi.fn();
    s.events.on('node.registered', cb);
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    expect(cb).toHaveBeenCalledWith({ id: 'z' });
  });

  it('unregisters a leaf and emits node.unregistered', () => {
    const s = fresh();
    const cb = vi.fn();
    s.events.on('node.unregistered', cb);
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('p'), parentId: id('z') }));
    s.unregisterNode(id('p'));
    expect(s.getNode(id('p'))).toBeUndefined();
    expect(s.getContainerView(id('z'))?.childOrder).toEqual([]);
    expect(cb).toHaveBeenCalledWith({ id: 'p' });
  });

  it('cascade-destroys descendants depth-first, leaves first', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(
      createPanel({
        id: id('tray'),
        parentId: id('z'),
        container: { strategyId: 'stack', config: {} },
      }),
    );
    s.registerNode(createPanel({ id: id('a'), parentId: id('tray') }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('tray') }));

    const order: string[] = [];
    s.events.on('node.unregistered', (e) => order.push(`unreg:${e.id}`));
    s.events.on('node.cascadeDestroyed', (e) =>
      order.push(`cascade:${e.parentId}:${[...e.descendantIds].join(',')}`),
    );

    s.unregisterNode(id('tray'));

    expect(order).toEqual([
      'unreg:a',
      'unreg:b',
      'cascade:tray:a,b',
      'unreg:tray',
    ]);
    expect(s.getNode(id('a'))).toBeUndefined();
    expect(s.getNode(id('tray'))).toBeUndefined();
    expect(s.getContainerView(id('z'))?.childOrder).toEqual([]);
  });
});

describe('Store — moveNode', () => {
  function buildTwoZones(): Store {
    const s = fresh();
    s.registerNode(createZone({ id: id('z1'), strategyId: 'grid', config: {} }));
    s.registerNode(createZone({ id: id('z2'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('p1'), parentId: id('z1') }));
    s.registerNode(createPanel({ id: id('p2'), parentId: id('z1') }));
    return s;
  }

  it('moves a panel between zones with atomic transit transitions', () => {
    const s = buildTwoZones();
    const transitions: string[] = [];
    s.events.on('node.transitioned', (e) => {
      if (e.machine === 'transit') transitions.push(`${e.from}→${e.to}`);
    });
    s.moveNode(id('p1'), id('z2'));
    expect(transitions).toEqual(['idle→releasing', 'releasing→claiming', 'claiming→idle']);
    expect(s.getContainerView(id('z1'))?.childOrder).toEqual(['p2']);
    expect(s.getContainerView(id('z2'))?.childOrder).toEqual(['p1']);
    expect(s.getNode(id('p1'))?.slot?.parentId).toBe('z2');
  });

  it('emits node.moved with from/to parents and indices', () => {
    const s = buildTwoZones();
    const cb = vi.fn();
    s.events.on('node.moved', cb);
    s.moveNode(id('p1'), id('z2'), 0);
    expect(cb).toHaveBeenCalledWith({
      id: 'p1',
      fromParentId: 'z1',
      toParentId: 'z2',
      fromIndex: 0,
      toIndex: 0,
    });
  });

  it('honors `at` insertion index', () => {
    const s = buildTwoZones();
    s.registerNode(createPanel({ id: id('p3'), parentId: id('z2') }));
    s.registerNode(createPanel({ id: id('p4'), parentId: id('z2') }));
    s.moveNode(id('p1'), id('z2'), 1);
    expect(s.getContainerView(id('z2'))?.childOrder).toEqual(['p3', 'p1', 'p4']);
  });

  it('throws CycleError on self-move', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(
      createPanel({
        id: id('p'),
        parentId: id('z'),
        container: { strategyId: 'stack', config: {} },
      }),
    );
    expect(() => s.moveNode(id('p'), id('p'))).toThrow(CycleError);
  });

  it('throws CycleError on moving under a descendant', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(
      createPanel({
        id: id('a'),
        parentId: id('z'),
        container: { strategyId: 'stack', config: {} },
      }),
    );
    s.registerNode(
      createPanel({
        id: id('b'),
        parentId: id('a'),
        container: { strategyId: 'stack', config: {} },
      }),
    );
    expect(() => s.moveNode(id('a'), id('b'))).toThrow(CycleError);
  });

  it('throws NodeNotFoundError on missing target parent', () => {
    const s = buildTwoZones();
    expect(() => s.moveNode(id('p1'), id('missing'))).toThrow(NodeNotFoundError);
  });

  it('replaces involved Node refs (record replacement)', () => {
    const s = buildTwoZones();
    const beforeP1 = s.getNode(id('p1'));
    const beforeZ1 = s.getNode(id('z1'));
    const beforeZ2 = s.getNode(id('z2'));
    s.moveNode(id('p1'), id('z2'));
    expect(s.getNode(id('p1'))).not.toBe(beforeP1);
    expect(s.getNode(id('z1'))).not.toBe(beforeZ1);
    expect(s.getNode(id('z2'))).not.toBe(beforeZ2);
  });
});

describe('Store — reorder + pinned prefix', () => {
  it('reorderInParent emits node.reordered with from/to indices', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('a'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('c'), parentId: id('z') }));
    const cb = vi.fn();
    s.events.on('node.reordered', cb);
    s.reorderInParent(id('c'), 0);
    expect(s.getContainerView(id('z'))?.childOrder).toEqual(['c', 'a', 'b']);
    expect(cb).toHaveBeenCalledWith({
      parentId: 'z',
      id: 'c',
      fromIndex: 2,
      toIndex: 0,
    });
  });

  it('pinned children stay in prefix on reorder', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('a'), parentId: id('z'), placement: { pinned: true } }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('c'), parentId: id('z') }));
    // Try to put c before a — should snap so a stays first.
    s.reorderInParent(id('c'), 0);
    const ids = s.getContainerView(id('z'))?.childOrder ?? [];
    expect(ids[0]).toBe('a');
  });

  it('setting pinned promotes to prefix', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('a'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('c'), parentId: id('z') }));
    s.setPlacement(id('c'), 'pinned', true);
    const ids = s.getContainerView(id('z'))?.childOrder ?? [];
    expect(ids[0]).toBe('c');
  });

  it('allowsPinning: false does not resort', () => {
    const s = fresh();
    s.registerNode(
      createZone({ id: id('z'), strategyId: 'grid', config: {}, allowsPinning: false }),
    );
    s.registerNode(createPanel({ id: id('a'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('z') }));
    s.setPlacement(id('b'), 'pinned', true);
    expect(s.getContainerView(id('z'))?.childOrder).toEqual(['a', 'b']);
  });
});

describe('Store — placement / meta', () => {
  it('patchPlacement merges and undefined deletes; emits batched changes', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(
      createPanel({ id: id('p'), parentId: id('z'), placement: { a: 1 } }),
    );
    const cb = vi.fn();
    s.events.on('node.placementChanged', cb);
    s.patchPlacement(id('p'), { a: 2, b: 3 });
    expect(s.getPlacement(id('p'))).toEqual({ a: 2, b: 3 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0].changes).toEqual({
      a: { from: 1, to: 2 },
      b: { from: undefined, to: 3 },
    });
    s.patchPlacement(id('p'), { a: undefined });
    expect(s.getPlacement(id('p'))).toEqual({ b: 3 });
  });

  it('patchPlacement throws when slot is missing', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    expect(() => s.patchPlacement(id('z'), { a: 1 })).toThrow(CapabilityMissingError);
  });

  it('setMeta merges and undefined deletes', () => {
    const s = fresh();
    s.registerNode(
      createZone({ id: id('z'), strategyId: 'grid', config: {}, meta: { title: 'x' } }),
    );
    s.setMeta(id('z'), { title: 'y', desc: 'd' });
    expect(s.getMeta(id('z'))).toEqual({ title: 'y', desc: 'd' });
  });
});

describe('Store — container config', () => {
  it('merge-patches object configs; emits configChanged', () => {
    const s = fresh();
    s.registerNode(
      createZone({ id: id('z'), strategyId: 'grid', config: { cols: 2, rows: 3 } }),
    );
    const cb = vi.fn();
    s.events.on('container.configChanged', cb);
    s.updateContainerConfig(id('z'), { cols: 4 });
    expect(s.getContainerView(id('z'))?.config).toEqual({ cols: 4, rows: 3 });
    expect(cb).toHaveBeenCalled();
  });

  it('setAllowsPinning false clears pinned flags', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('p'), parentId: id('z'), placement: { pinned: true } }));
    s.setAllowsPinning(id('z'), false);
    expect(s.getPlacement(id('p'))).toEqual({});
  });
});

describe('Store — lifecycle', () => {
  it('show / hide transition lifecycle FSM', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('p'), parentId: id('z') }));
    expect(s.getNode(id('p'))?.lifecycle.state).toBe('mounted');
    s.showNode(id('p'));
    expect(s.getNode(id('p'))?.lifecycle.state).toBe('visible');
    s.hideNode(id('p'));
    expect(s.getNode(id('p'))?.lifecycle.state).toBe('hidden');
  });
});

describe('Store — focus', () => {
  it('focusNode blurs previous before focusing new', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('a'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('z') }));
    const events: StoreEvents['node.transitioned'][] = [];
    s.events.on('node.transitioned', (e) => {
      if (e.machine === 'focus') events.push(e);
    });
    s.focusNode(id('a'));
    s.focusNode(id('b'));
    expect(events.map((e) => `${e.id}:${e.from}→${e.to}`)).toEqual([
      'a:blurred→focused',
      'a:focused→blurred',
      'b:blurred→focused',
    ]);
    expect(s.focusedId).toBe('b');
  });

  it('focusNode on a node without focus capability throws', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    expect(() => s.focusNode(id('z'))).toThrow(CapabilityMissingError);
  });

  it('unregistering the focused node clears focusedId', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('p'), parentId: id('z') }));
    s.focusNode(id('p'));
    s.unregisterNode(id('p'));
    expect(s.focusedId).toBeNull();
  });
});

describe('Store — selectors', () => {
  it('getChildren returns nodes in childOrder order', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('a'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('z') }));
    expect(s.getChildren(id('z')).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('getParent returns the parent node', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('p'), parentId: id('z') }));
    expect(s.getParent(id('p'))?.id).toBe('z');
  });

  it('getAncestors returns root-to-self chain', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(
      createPanel({
        id: id('tray'),
        parentId: id('z'),
        container: { strategyId: 'stack', config: {} },
      }),
    );
    s.registerNode(createPanel({ id: id('leaf'), parentId: id('tray') }));
    expect(s.getAncestors(id('leaf')).map((n) => n.id)).toEqual(['z', 'tray', 'leaf']);
  });

  it('isContainer / isSlotted / hasFocus', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(
      createGroup({ id: id('g'), parentId: id('z'), strategyId: 'stack', config: {} }),
    );
    s.registerNode(createPanel({ id: id('p'), parentId: id('z') }));
    expect(s.isContainer(id('z'))).toBe(true);
    expect(s.isContainer(id('g'))).toBe(true);
    expect(s.isContainer(id('p'))).toBe(false);
    expect(s.isSlotted(id('z'))).toBe(false);
    expect(s.isSlotted(id('g'))).toBe(true);
    expect(s.isSlotted(id('p'))).toBe(true);
    expect(s.hasFocus(id('p'))).toBe(true);
    expect(s.hasFocus(id('g'))).toBe(false);
    expect(s.hasFocus(id('z'))).toBe(false);
  });
});

describe('Store — subscribe', () => {
  it('fires subscribers on microtask after mutation', async () => {
    const s = fresh();
    const cb = vi.fn();
    s.subscribe(cb);
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    expect(cb).not.toHaveBeenCalled(); // batched to microtask
    await Promise.resolve();
    expect(cb).toHaveBeenCalled();
  });
});

describe('Store — activity', () => {
  it('getActivity returns {} when unset', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    expect(s.getActivity(id('z'))).toEqual({});
  });

  it('setActivity replaces the entire bag and emits a single event', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.patchActivity(id('z'), { busy: true, count: 1 });
    const cb = vi.fn();
    s.events.on('node.activityChanged', cb);
    s.setActivity(id('z'), { lastAt: 1000 });
    expect(s.getActivity(id('z'))).toEqual({ lastAt: 1000 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toEqual({
      id: id('z'),
      changes: {
        busy: { from: true, to: undefined },
        count: { from: 1, to: undefined },
        lastAt: { from: undefined, to: 1000 },
      },
    });
  });

  it('setActivity({}) clears the bag', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.patchActivity(id('z'), { busy: true });
    s.setActivity(id('z'), {});
    expect(s.getActivity(id('z'))).toEqual({});
    expect(s.getNode(id('z'))?.activity).toBeUndefined();
  });

  it('patchActivity merges; undefined keys delete', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    const cb = vi.fn();
    s.events.on('node.activityChanged', cb);
    s.patchActivity(id('z'), { busy: true, count: 1 });
    expect(s.getActivity(id('z'))).toEqual({ busy: true, count: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0].changes).toEqual({
      busy: { from: undefined, to: true },
      count: { from: undefined, to: 1 },
    });
    s.patchActivity(id('z'), { busy: undefined });
    expect(s.getActivity(id('z'))).toEqual({ count: 1 });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]?.[0].changes).toEqual({
      busy: { from: true, to: undefined },
    });
  });

  it('no-op patches do not emit', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.patchActivity(id('z'), { busy: true });
    const cb = vi.fn();
    s.events.on('node.activityChanged', cb);
    s.patchActivity(id('z'), { busy: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('no-op setActivity (same keys + values) does not emit', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.setActivity(id('z'), { busy: true });
    const cb = vi.fn();
    s.events.on('node.activityChanged', cb);
    s.setActivity(id('z'), { busy: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('produces a fresh Node reference on change', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    const before = s.getNode(id('z'));
    s.patchActivity(id('z'), { busy: true });
    const after = s.getNode(id('z'));
    expect(after).not.toBe(before);
  });

  it('throws NodeNotFoundError when node is missing', () => {
    const s = fresh();
    expect(() => s.setActivity(id('missing'), { x: 1 })).toThrow(NodeNotFoundError);
    expect(() => s.patchActivity(id('missing'), { x: 1 })).toThrow(NodeNotFoundError);
  });

  it('getActivity on a missing node returns {}', () => {
    const s = fresh();
    expect(s.getActivity(id('missing'))).toEqual({});
  });
});

describe('Store — integration', () => {
  it('builds and rearranges a 3-level tree', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(
      createPanel({
        id: id('tray'),
        parentId: id('z'),
        container: { strategyId: 'stack', config: {} },
      }),
    );
    s.registerNode(createPanel({ id: id('leaf1'), parentId: id('tray') }));
    s.registerNode(createPanel({ id: id('leaf2'), parentId: id('tray') }));
    s.registerNode(createPanel({ id: id('other'), parentId: id('z') }));

    expect(s.getContainerView(id('z'))?.childOrder).toEqual(['tray', 'other']);
    expect(s.getContainerView(id('tray'))?.childOrder).toEqual(['leaf1', 'leaf2']);

    // Move leaf1 out of tray into z
    s.moveNode(id('leaf1'), id('z'));
    expect(s.getContainerView(id('tray'))?.childOrder).toEqual(['leaf2']);
    expect(s.getContainerView(id('z'))?.childOrder).toContain('leaf1');
    expect(s.getNode(id('leaf1'))?.slot?.parentId).toBe('z');
  });
});

describe('Store — container state (side-channel)', () => {
  it('round-trips state via get/setContainerState', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'split', config: {} }));
    expect(s.getContainerState(id('z'))).toBeUndefined();
    s.setContainerState(id('z'), { ratio: 0.7 });
    expect(s.getContainerState(id('z'))).toEqual({ ratio: 0.7 });
  });

  it('emits container.stateChanged on write', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'split', config: {} }));
    const spy = vi.fn();
    s.events.on('container.stateChanged', spy);
    s.setContainerState(id('z'), { ratio: 0.4 });
    expect(spy).toHaveBeenCalledWith({ id: 'z', from: undefined, to: { ratio: 0.4 } });
  });

  it('skips emit + notify when state reference is unchanged', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'split', config: {} }));
    const state = { ratio: 0.5 };
    s.setContainerState(id('z'), state);
    const spy = vi.fn();
    s.events.on('container.stateChanged', spy);
    s.setContainerState(id('z'), state);
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws CapabilityMissingError for nodes without container', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: id('p'), parentId: id('z') }));
    expect(() => s.setContainerState(id('p'), { ratio: 0.5 })).toThrow(CapabilityMissingError);
  });

  it('clears state when the container is unregistered', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'split', config: {} }));
    s.setContainerState(id('z'), { ratio: 0.7 });
    s.unregisterNode(id('z'));
    s.registerNode(createZone({ id: id('z'), strategyId: 'split', config: {} }));
    expect(s.getContainerState(id('z'))).toBeUndefined();
  });

  it('stores state on node.container.state (so snapshot picks it up)', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'split', config: {} }));
    s.setContainerState(id('z'), { ratio: 0.3 });
    expect(s.getNode(id('z'))?.container?.state).toEqual({ ratio: 0.3 });
  });
});

describe('Store — allowsDrop / allowsDragOut', () => {
  it('default to true on createZone', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'stack', config: {} }));
    const c = s.getNode(id('z'))?.container;
    expect(c?.allowsDrop).toBe(true);
    expect(c?.allowsDragOut).toBe(true);
  });

  it('setAllowsDrop emits and updates', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'stack', config: {} }));
    const spy = vi.fn();
    s.events.on('container.allowsDropChanged', spy);
    s.setAllowsDrop(id('z'), false);
    expect(s.getNode(id('z'))?.container?.allowsDrop).toBe(false);
    expect(spy).toHaveBeenCalledWith({ id: 'z', from: true, to: false });
  });

  it('setAllowsDragOut emits and updates', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'stack', config: {} }));
    const spy = vi.fn();
    s.events.on('container.allowsDragOutChanged', spy);
    s.setAllowsDragOut(id('z'), false);
    expect(s.getNode(id('z'))?.container?.allowsDragOut).toBe(false);
    expect(spy).toHaveBeenCalledWith({ id: 'z', from: true, to: false });
  });
});
