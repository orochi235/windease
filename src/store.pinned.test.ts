import { describe, expect, it, vi } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { LockedError, PinIndexError } from './errors.js';
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
});
