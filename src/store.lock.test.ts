import { describe, expect, it, vi } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

const id = (s: string) => asNodeId(s);

function seeded(): { s: Store; z: NodeId; p: NodeId } {
  const s = new Store();
  s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
  s.registerNode(createPanel({ id: id('p'), parentId: id('z') }));
  return { s, z: id('z'), p: id('p') };
}

describe('Store — setLock / getLock', () => {
  it('expands true to the supported axes', () => {
    const { s, p } = seeded();
    s.setLock(p, true);
    expect(s.getLock(p)).toEqual({ move: true, resize: true, destroy: true });
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
});
