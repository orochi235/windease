import { describe, expect, it, vi } from 'vitest';
import { createNode } from './constructors.js';
import { LockedError } from './errors.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

const id = (s: string) => asNodeId(s);

function seeded(): { s: Store; z: NodeId; p: NodeId } {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: {} },
      id: id('z'),
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: id('p'),
      parentId: id('z'),
    }),
  );
  return { s, z: id('z'), p: id('p') };
}

describe('Store — setLock / getLock', () => {
  it('expands true to the supported axes', () => {
    const { s, p } = seeded();
    s.setLock(p, true);
    expect(s.getLock(p)).toEqual({ move: true, resize: true, destroy: true, arrange: true });
  });

  it('returns an empty set for an unlocked node', () => {
    const { s, p } = seeded();
    expect(s.getLock(p)).toEqual({});
  });

  it('replaces rather than merges', () => {
    const { s, p } = seeded();
    s.setLock(p, { move: true, destroy: true });
    s.setLock(p, { move: true });
    expect(s.getLock(p)).toEqual({ move: true });
  });

  it('emits node.lockChanged with from and to', () => {
    const { s, p } = seeded();
    const spy = vi.fn();
    s.events.on('node.lockChanged', spy);
    s.setLock(p, { move: true });
    expect(spy).toHaveBeenCalledWith({ id: 'p', from: {}, to: { move: true } });
  });

  it('does not emit when the resolved set is unchanged', () => {
    const { s, p } = seeded();
    s.setLock(p, { move: true });
    const spy = vi.fn();
    s.events.on('node.lockChanged', spy);
    s.setLock(p, { move: true, accept: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports lock state per axis via isLocked', () => {
    const { s, p } = seeded();
    s.setLock(p, { move: true });
    expect(s.isLocked(p, 'move')).toBe(true);
    expect(s.isLocked(p, 'destroy')).toBe(false);
  });

  it('reports every axis unlocked while locks are suspended', () => {
    const { s, p } = seeded();
    s.setLock(p, true);
    s.withLocksSuspended(() => {
      expect(s.isLocked(p, 'move')).toBe(false);
    });
    expect(s.isLocked(p, 'move')).toBe(true);
  });

  it('restores suspension state when the callback throws', () => {
    const { s, p } = seeded();
    s.setLock(p, true);
    expect(() =>
      s.withLocksSuspended(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(s.isLocked(p, 'move')).toBe(true);
  });

  it('returns the callback result', () => {
    const { s } = seeded();
    expect(s.withLocksSuspended(() => 42)).toBe(42);
  });

  it('stays suspended across nested calls until the outermost exits', () => {
    const { s, p } = seeded();
    s.setLock(p, true);
    s.withLocksSuspended(() => {
      s.withLocksSuspended(() => {
        expect(s.isLocked(p, 'move')).toBe(false);
      });
      expect(s.isLocked(p, 'move')).toBe(false);
    });
    expect(s.isLocked(p, 'move')).toBe(true);
  });

  it('returns an empty set for a nonexistent node instead of throwing', () => {
    const { s } = seeded();
    expect(s.getLock(asNodeId('does-not-exist'))).toEqual({});
  });
});

describe('Store — destroy lock', () => {
  it('blocks unregisterNode on a locked node', () => {
    const { s, p } = seeded();
    s.setLock(p, { destroy: true });
    expect(() => s.unregisterNode(p)).toThrow(LockedError);
    expect(s.getNode(p)).toBeDefined();
  });

  it('allows unregisterNode with force', () => {
    const { s, p } = seeded();
    s.setLock(p, { destroy: true });
    s.unregisterNode(p, { force: true });
    expect(s.getNode(p)).toBeUndefined();
  });

  it('allows unregisterNode inside withLocksSuspended', () => {
    const { s, p } = seeded();
    s.setLock(p, { destroy: true });
    s.withLocksSuspended(() => s.unregisterNode(p));
    expect(s.getNode(p)).toBeUndefined();
  });

  it('refuses to destroy an ancestor holding a destroy-locked descendant', () => {
    const { s, z, p } = seeded();
    s.setLock(p, { destroy: true });
    expect(() => s.unregisterNode(z)).toThrow(LockedError);
    // The refusal names the descendant that refused, not the id passed in.
    expect(() => s.unregisterNode(z)).toThrow(new RegExp(`on ${p} `));
    expect(s.getNode(p)).toBeDefined();
    expect(s.getNode(z)).toBeDefined();
  });

  it('destroys through a locked descendant under force', () => {
    const { s, z, p } = seeded();
    s.setLock(p, { destroy: true });
    s.unregisterNode(z, { force: true });
    expect(s.getNode(p)).toBeUndefined();
    expect(s.getNode(z)).toBeUndefined();
  });

  it('destroys through a locked descendant inside withLocksSuspended', () => {
    const { s, z, p } = seeded();
    s.setLock(p, { destroy: true });
    s.withLocksSuspended(() => s.unregisterNode(z));
    expect(s.getNode(p)).toBeUndefined();
    expect(s.getNode(z)).toBeUndefined();
  });

  it('blocks destroying the ancestor when the ancestor itself is locked', () => {
    const { s, z } = seeded();
    s.setLock(z, { destroy: true });
    expect(() => s.unregisterNode(z)).toThrow(LockedError);
  });
});

function twoZones(): { s: Store; a: NodeId; b: NodeId; p: NodeId } {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: {} },
      id: id('a'),
    }),
  );
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: {} },
      id: id('b'),
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: id('p'),
      parentId: id('a'),
    }),
  );
  return { s, a: id('a'), b: id('b'), p: id('p') };
}

describe('Store — move / accept / dragOut locks', () => {
  function expectNoMutation(s: Store, a: NodeId, b: NodeId, p: NodeId): void {
    expect(s.getNode(p)?.membership?.parentId).toBe(a);
    expect(s.getNode(a)?.container?.childOrder).toEqual([p]);
    expect(s.getNode(b)?.container?.childOrder).toEqual([]);
  }

  it('blocks moveNode when the source is move-locked', () => {
    const { s, a, b, p } = twoZones();
    const moved = vi.fn();
    const transitioned = vi.fn();
    s.events.on('node.moved', moved);
    s.events.on('node.transitioned', transitioned);
    s.setLock(p, { move: true });
    expect(() => s.moveNode(p, b)).toThrow(LockedError);
    expectNoMutation(s, a, b, p);
    expect(moved).not.toHaveBeenCalled();
    expect(transitioned).not.toHaveBeenCalled();
  });

  it('blocks moveNode when the target is accept-locked', () => {
    const { s, a, b, p } = twoZones();
    const moved = vi.fn();
    s.events.on('node.moved', moved);
    s.setLock(b, { accept: true });
    expect(() => s.moveNode(p, b)).toThrow(LockedError);
    expectNoMutation(s, a, b, p);
    expect(moved).not.toHaveBeenCalled();
  });

  it('blocks moveNode when the source parent is dragOut-locked', () => {
    const { s, a, b, p } = twoZones();
    const moved = vi.fn();
    s.events.on('node.moved', moved);
    s.setLock(a, { dragOut: true });
    expect(() => s.moveNode(p, b)).toThrow(LockedError);
    expectNoMutation(s, a, b, p);
    expect(moved).not.toHaveBeenCalled();
  });

  it('allows a move that violates none of the three', () => {
    const { s, b, p } = twoZones();
    s.moveNode(p, b);
    expect(s.getNode(p)?.membership?.parentId).toBe('b');
  });

  it('allows a blocked move with force', () => {
    const { s, b, p } = twoZones();
    s.setLock(p, { move: true });
    s.moveNode(p, b, undefined, { force: true });
    expect(s.getNode(p)?.membership?.parentId).toBe('b');
  });

  it('keeps the lock after a move, since lock is node-intrinsic', () => {
    const { s, b, p } = twoZones();
    s.setLock(p, { destroy: true });
    s.moveNode(p, b);
    expect(s.getLock(p)).toEqual({ destroy: true });
  });

  it('blocks reorderInParent when the node is move-locked', () => {
    const { s, a } = twoZones();
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: id('q'),
        parentId: a,
      }),
    );
    s.setLock(id('q'), { move: true });
    expect(() => s.reorderInParent(id('q'), 0)).toThrow(LockedError);
  });

  it('allows reorderInParent with force on a move-locked node', () => {
    const { s, a } = twoZones();
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: id('q'),
        parentId: a,
      }),
    );
    s.setLock(id('q'), { move: true });
    s.reorderInParent(id('q'), 0, { force: true });
    expect(s.getNode(a)?.container?.childOrder).toEqual([id('q'), id('p')]);
  });
});

describe('Store — arrange and resize locks', () => {
  it('blocks setChildOrder on an arrange-locked container', () => {
    const { s, z, p } = seeded();
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: id('q'),
        parentId: z,
      }),
    );
    s.setLock(z, { arrange: true });
    expect(() => s.setChildOrder(z, [id('q'), p])).toThrow(LockedError);
  });

  it('blocks reorderInParent on an arrange-locked container', () => {
    const { s, z, p } = seeded();
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('q'), parentId: z }));
    s.setLock(z, { arrange: true });
    expect(() => s.reorderInParent(p, 1)).toThrow(LockedError);
  });

  it('lets a forced reorderInParent through, as setPinned relies on', () => {
    const { s, z, p } = seeded();
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('q'), parentId: z }));
    s.setLock(z, { arrange: true });
    expect(() => s.reorderInParent(p, 1, { force: true })).not.toThrow();
    expect(s.getNode(z)?.container?.childOrder.map(String)).toEqual(['q', 'p']);
  });

  it('still reports the node move lock ahead of the parent arrange lock', () => {
    const { s, z, p } = seeded();
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('q'), parentId: z }));
    s.setLock(p, { move: true });
    try {
      s.reorderInParent(p, 1);
      expect.unreachable();
    } catch (e) {
      expect((e as LockedError).axis).toBe('move');
    }
    expect(z).toBeDefined();
  });

  it('blocks updateContainerConfig on an arrange-locked container', () => {
    const { s, z } = seeded();
    s.setLock(z, { arrange: true });
    expect(() => s.updateContainerConfig(z, { cols: 3 })).toThrow(LockedError);
  });

  it('blocks setContainerState on an arrange-locked container', () => {
    const { s, z } = seeded();
    s.setLock(z, { arrange: true });
    expect(() => s.setContainerState(z, { ratio: 0.5 })).toThrow(LockedError);
  });

  it('blocks writing placement.size on a resize-locked node', () => {
    const { s, p } = seeded();
    s.setLock(p, { resize: true });
    expect(() => s.patchPlacement(p, { size: { w: 100 } })).toThrow(LockedError);
  });

  it('blocks clearing placement.size on a resize-locked node', () => {
    const { s, p } = seeded();
    s.patchPlacement(p, { size: { w: 100 } });
    s.setLock(p, { resize: true });
    expect(() => s.patchPlacement(p, { size: undefined })).toThrow(LockedError);
  });

  it('allows free-form placement keys on a resize-locked node', () => {
    const { s, p } = seeded();
    s.setLock(p, { resize: true });
    s.patchPlacement(p, { collapsed: true });
    expect(s.getPlacement(p).collapsed).toBe(true);
  });

  it('allows a size write with force', () => {
    const { s, p } = seeded();
    s.setLock(p, { resize: true });
    s.patchPlacement(p, { size: { w: 100 } }, { force: true });
    expect(s.getPlacement(p).size).toEqual({ w: 100 });
  });

  it('blocks setPlacement(id, "size", undefined) on a resize-locked node', () => {
    const { s, p } = seeded();
    s.setLock(p, { resize: true });
    expect(() => s.setPlacement(p, 'size', undefined)).toThrow(LockedError);
  });
});

describe('Store — allows* flags are gone', () => {
  it('no longer exposes setAllowsDrop or setAllowsDragOut', () => {
    const { s } = seeded();
    expect((s as unknown as Record<string, unknown>).setAllowsDrop).toBeUndefined();
    expect((s as unknown as Record<string, unknown>).setAllowsDragOut).toBeUndefined();
  });

  it('accepts lock at construction via createNode', () => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'grid', config: {} },
        id: id('z'),
        lock: { accept: true },
      }),
    );
    expect(s.getLock(id('z'))).toEqual({ accept: true });
  });

  it('keeps allowsPinning, which governs a different concept', () => {
    const { s, z } = seeded();
    s.setAllowsPinning(z, false);
    expect(s.getContainerView(z)?.allowsPinning).toBe(false);
  });
});

/** `arrange` is the only container axis that has to bind before the container
 *  exists: it is what says a node may not gain children in the first place. */
describe('Store — arrange lock on a childless node', () => {
  it('refuses ensureContainer on an arrange-locked panel', () => {
    const { s, p } = seeded();
    s.setLock(p, { arrange: true });
    expect(() => s.ensureContainer(p, 'strip', { axis: 'x' })).toThrow(LockedError);
    expect(s.getNode(p)?.container).toBeUndefined();
  });

  it('stores the axis rather than dropping it as unsupported', () => {
    const { s, p } = seeded();
    s.setLock(p, { arrange: true });
    expect(s.getLock(p)).toEqual({ arrange: true });
  });

  it('lets an unlocked panel gain one (control)', () => {
    const { s, p } = seeded();
    s.ensureContainer(p, 'strip', { axis: 'x' });
    expect(s.getNode(p)?.container?.strategyId).toBe('strip');
  });
});
