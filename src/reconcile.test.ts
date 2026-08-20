import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { asNodeId } from './node.js';
import {
  reconcileChildOrder,
  reconcileContainerState,
  reconcilePinned,
  reconcilePlacement,
} from './reconcile.js';
import { Store } from './store.js';

const Z = asNodeId('z');

function build(childIds: string[] = ['a', 'b', 'c']): Store {
  const s = new Store();
  s.registerNode(createZone({ id: Z, strategyId: 'stack', config: {} }));
  for (const id of childIds) {
    const nid = asNodeId(id);
    s.registerNode(createPanel({ id: nid, parentId: Z }));
    s.showNode(nid);
  }
  return s;
}

const seen = (ids: string[]) => ids.map((id) => ({ id: asNodeId(id), order: undefined }));
const order = (s: Store) => s.getContainerView(Z)?.childOrder;

describe('reconcile decisions, with no binding present', () => {
  describe('childOrder — skips under arrange', () => {
    it('writes the observed order', () => {
      const s = build();
      reconcileChildOrder(s, Z, seen(['c', 'a', 'b']));
      expect(order(s)).toEqual(['c', 'a', 'b']);
    });

    it('refuses to write while the container is arrange-locked', () => {
      const s = build();
      s.setLock(Z, { arrange: true });
      reconcileChildOrder(s, Z, seen(['c', 'a', 'b']));
      expect(order(s)).toEqual(['a', 'b', 'c']);
    });

    it('leaves a pinned child on its exact index', () => {
      const s = build();
      s.setPinned(asNodeId('b'), 1);
      reconcileChildOrder(s, Z, seen(['c', 'a']));
      expect(order(s)?.[1]).toBe('b');
    });

    it('drops ids that are not children of this parent', () => {
      const s = build();
      reconcileChildOrder(s, Z, seen(['c', 'nonsense', 'a', 'b']));
      expect(order(s)).toEqual(['c', 'a', 'b']);
    });

    it('appends children it never observed, in store order', () => {
      const s = build(['a', 'b', 'c']);
      reconcileChildOrder(s, Z, seen(['c']));
      expect(order(s)).toEqual(['c', 'a', 'b']);
    });
  });

  describe('pinned — skips under the *parent* arrange lock', () => {
    it('pins to the declared index', () => {
      const s = build();
      reconcilePinned(s, asNodeId('c'), 0);
      expect(s.getPinnedIndex(asNodeId('c'))).toBe(0);
    });

    it('refuses while the parent is arrange-locked', () => {
      const s = build();
      s.setLock(Z, { arrange: true });
      reconcilePinned(s, asNodeId('c'), 0);
      expect(s.getPinnedIndex(asNodeId('c'))).toBeNull();
    });

    it('false unpins', () => {
      const s = build();
      s.setPinned(asNodeId('c'), 0);
      reconcilePinned(s, asNodeId('c'), false);
      expect(s.getPinnedIndex(asNodeId('c'))).toBeNull();
    });
  });

  describe('placement — forces past the lock', () => {
    it('writes size even when the node is resize-locked', () => {
      const s = build();
      const a = asNodeId('a');
      s.setLock(a, { resize: true });
      reconcilePlacement(s, a, { size: { w: 120 } });
      expect(s.getNode(a)?.membership?.placement?.size).toEqual({ w: 120 });
    });

    it('refuses the reserved pinned key', () => {
      const s = build();
      expect(() => reconcilePlacement(s, asNodeId('a'), { pinned: 1 })).toThrow(/pinned/);
    });
  });

  describe('container state — skips under arrange', () => {
    it('writes when unlocked', () => {
      const s = build();
      reconcileContainerState(s, Z, { ratio: 0.7 });
      expect(s.getContainerState(Z)).toEqual({ ratio: 0.7 });
    });

    it('refuses while arrange-locked', () => {
      const s = build();
      s.setLock(Z, { arrange: true });
      reconcileContainerState(s, Z, { ratio: 0.7 });
      expect(s.getContainerState(Z)).toBeUndefined();
    });
  });
});
