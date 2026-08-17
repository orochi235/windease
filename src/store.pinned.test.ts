import { describe, expect, it, vi } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import {
  InvariantViolationError,
  LockedError,
  NodeNotFoundError,
  PinIndexError,
} from './errors.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

const id = (s: string) => asNodeId(s);

function strip(count: number): { s: Store; z: NodeId } {
  const s = new Store();
  s.registerNode(createZone({ id: id('z'), strategyId: 'strip', config: {} }));
  for (let i = 0; i < count; i++) {
    s.registerNode(createPanel({ id: id(`p${i}`), parentId: id('z') }));
  }
  return { s, z: id('z') };
}

const order = (s: Store, z: NodeId) => s.getContainerView(z)?.childOrder;

describe('Store — setPinned', () => {
  it('pins to the current index by default and does not move the node', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p2'));
    expect(order(s, z)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(s.getPinnedIndex(id('p2'))).toBe(2);
  });

  it('pins to an explicit index, moving the node there', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p3'), 0);
    expect(order(s, z)).toEqual(['p3', 'p0', 'p1', 'p2']);
    expect(s.getPinnedIndex(id('p3'))).toBe(0);
  });

  it('throws PinIndexError for an index past the end', () => {
    const { s } = strip(4);
    expect(() => s.setPinned(id('p0'), 7)).toThrow(PinIndexError);
  });

  it('throws PinIndexError for a negative index', () => {
    const { s } = strip(4);
    expect(() => s.setPinned(id('p0'), -1)).toThrow(PinIndexError);
  });

  it('emits node.pinnedChanged', () => {
    const { s } = strip(4);
    const spy = vi.fn();
    s.events.on('node.pinnedChanged', spy);
    s.setPinned(id('p1'));
    expect(spy).toHaveBeenCalledWith({ id: 'p1', from: null, to: 1 });
  });

  it('unpins', () => {
    const { s } = strip(4);
    s.setPinned(id('p1'));
    s.unpin(id('p1'));
    expect(s.getPinnedIndex(id('p1'))).toBeNull();
  });

  it('does not promote a pinned node to the front', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p2'));
    s.setPinned(id('p3'));
    expect(order(s, z)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('records the actual landed index on a slot collision, not the requested one', () => {
    const { s, z } = strip(5);
    s.setPinned(id('p1'), 2);
    s.setPinned(id('p3'), 2);
    expect(order(s, z)).toEqual(['p0', 'p2', 'p1', 'p3', 'p4']);
    expect(s.getPinnedIndex(id('p1'))).toBe(2);
    expect(s.getPinnedIndex(id('p3'))).toBe(3);
    const childOrder = order(s, z) ?? [];
    for (const nid of [id('p1'), id('p3')]) {
      expect(childOrder[s.getPinnedIndex(nid) as number]).toBe(nid);
    }
  });

  it('does not emit node.pinnedChanged when already pinned at the target index', () => {
    const { s } = strip(4);
    s.setPinned(id('p2'));
    const spy = vi.fn();
    s.events.on('node.pinnedChanged', spy);
    s.setPinned(id('p2'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Store — pinned displacement', () => {
  it('routes a third-party reorder around a held slot', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p2'));
    s.reorderInParent(id('p3'), 2);
    expect(order(s, z)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(s.getPinnedIndex(id('p2'))).toBe(2);
  });

  it('clamps held indices when a sibling is removed', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p3'), 3);
    s.unregisterNode(id('p0'));
    expect(order(s, z)).toEqual(['p1', 'p2', 'p3']);
    expect(s.getPinnedIndex(id('p3'))).toBe(2);
  });

  it('does not throw when a removal invalidates a held index', () => {
    const { s } = strip(2);
    s.setPinned(id('p1'), 1);
    expect(() => s.unregisterNode(id('p0'))).not.toThrow();
  });

  it('lets an explicit reorder of the pinned node itself move it', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p2'));
    s.reorderInParent(id('p2'), 0);
    expect(order(s, z)).toEqual(['p2', 'p0', 'p1', 'p3']);
    expect(s.getPinnedIndex(id('p2'))).toBe(0);
  });
});

describe('Store — setPinned/unpin arrange lock', () => {
  it('setPinned throws LockedError when parent is arrange-locked', () => {
    const { s, z } = strip(4);
    s.setLock(z, { arrange: true });
    expect(() => s.setPinned(id('p1'))).toThrow(LockedError);
  });

  it('setPinned bypasses the arrange lock with force: true', () => {
    const { s, z } = strip(4);
    s.setLock(z, { arrange: true });
    expect(() => s.setPinned(id('p1'), undefined, { force: true })).not.toThrow();
    expect(s.getPinnedIndex(id('p1'))).toBe(1);
  });

  it('unpin throws LockedError when parent is arrange-locked', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p1'));
    s.setLock(z, { arrange: true });
    expect(() => s.unpin(id('p1'))).toThrow(LockedError);
  });

  it('unpin bypasses the arrange lock with force: true', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p1'));
    s.setLock(z, { arrange: true });
    expect(() => s.unpin(id('p1'), { force: true })).not.toThrow();
    expect(s.getPinnedIndex(id('p1'))).toBeNull();
  });

  it('unpin throws LockedError for an already-unpinned node in an arrange-locked container', () => {
    const { s, z } = strip(4);
    s.setLock(z, { arrange: true });
    expect(() => s.unpin(id('p1'))).toThrow(LockedError);
  });
});

describe('Store — unpin existence check', () => {
  it('throws NodeNotFoundError for an unregistered id', () => {
    const { s } = strip(4);
    expect(() => s.unpin(id('ghost'))).toThrow(NodeNotFoundError);
  });
});

describe('Store — setPinned/unpin and allowsPinning', () => {
  function stripNoPinning(count: number): { s: Store; z: NodeId } {
    const s = new Store();
    s.registerNode(
      createZone({ id: id('z'), strategyId: 'strip', config: {}, allowsPinning: false }),
    );
    for (let i = 0; i < count; i++) {
      s.registerNode(createPanel({ id: id(`p${i}`), parentId: id('z') }));
    }
    return { s, z: id('z') };
  }

  it('setPinned throws when the parent has allowsPinning: false', () => {
    const { s } = stripNoPinning(4);
    expect(() => s.setPinned(id('p1'))).toThrow(InvariantViolationError);
  });

  it('unpin still works when the parent has allowsPinning: false', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p1'));
    s.setAllowsPinning(z, false);
    expect(() => s.unpin(id('p1'))).not.toThrow();
  });
});

describe('Store — patchPlacement rejects direct pinned writes', () => {
  it('throws when patch sets pinned', () => {
    const { s } = strip(4);
    expect(() => s.patchPlacement(id('p1'), { pinned: 2 })).toThrow(InvariantViolationError);
  });

  it('throws when patch clears pinned', () => {
    const { s } = strip(4);
    s.setPinned(id('p1'));
    expect(() => s.patchPlacement(id('p1'), { pinned: undefined })).toThrow(
      InvariantViolationError,
    );
  });

  it('setPinned itself still works (does not route through patchPlacement)', () => {
    const { s } = strip(4);
    expect(() => s.setPinned(id('p1'))).not.toThrow();
    expect(s.getPinnedIndex(id('p1'))).toBe(1);
  });
});

describe('Store — moveNode pinned displacement', () => {
  it('routes a newcomer past a held slot in the destination', () => {
    const s = new Store();
    s.registerNode(createZone({ id: id('src'), strategyId: 'strip', config: {} }));
    s.registerNode(createZone({ id: id('dst'), strategyId: 'strip', config: {} }));
    s.registerNode(createPanel({ id: id('m'), parentId: id('src') }));
    s.registerNode(createPanel({ id: id('d0'), parentId: id('dst') }));
    s.registerNode(createPanel({ id: id('d1'), parentId: id('dst') }));
    s.setPinned(id('d0'), 0);

    s.moveNode(id('m'), id('dst'), 0);
    expect(order(s, id('dst'))).toEqual(['d0', 'm', 'd1']);
    expect(s.getPinnedIndex(id('d0'))).toBe(0);
  });
});
