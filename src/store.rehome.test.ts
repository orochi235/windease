import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { asNodeId, CycleError, LockedError, type NodeId, Store } from './index.js';
import { recordEvents } from './test-utils/record-events.js';

const id = (s: string) => asNodeId(s);
const order = (s: Store, parent: string) =>
  (s.getContainerView(id(parent))?.childOrder ?? []).map(String);

/** Roots `main` and `wt` (a worktree's zone), `main` holding `editor` and
 *  `wt` holding `term` and `log`, all shown and focusable. */
function seeded(): Store {
  const s = new Store();
  for (const z of ['main', 'wt']) {
    s.registerNode(
      createNode({ kind: 'zone', id: id(z), container: { strategyId: 'strip', config: {} } }),
    );
    s.showNode(id(z));
  }
  const panels: Array<[string, string]> = [
    ['editor', 'main'],
    ['term', 'wt'],
    ['log', 'wt'],
  ];
  for (const [p, parent] of panels) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(p), parentId: id(parent) }));
    s.showNode(id(p));
  }
  return s;
}

const snapshot = (s: Store) => ({
  main: order(s, 'main'),
  wt: order(s, 'wt'),
  has: !!s.getNode(id('wt')),
});

describe('unregisterNode with rehome', () => {
  it("moves the zone's children to the target before removing it", () => {
    const s = seeded();
    s.unregisterNode(id('wt'), { rehome: id('main') });
    expect(s.getNode(id('wt'))).toBeUndefined();
    expect(order(s, 'main')).toEqual(['editor', 'term', 'log']);
    expect(s.getRoot(id('term'))?.id).toBe('main');
  });

  it('cascades as before without it', () => {
    const s = seeded();
    s.unregisterNode(id('wt'));
    expect(s.getNode(id('term'))).toBeUndefined();
  });

  it('is one transaction, and reports no cascade', () => {
    const s = seeded();
    const rec = recordEvents(s, 'transaction.begin', 'node.cascadeDestroyed', 'node.unregistered');
    s.unregisterNode(id('wt'), { rehome: id('main') });
    expect(rec.of('transaction.begin')).toHaveLength(1);
    expect(rec.of('node.cascadeDestroyed')).toEqual([]);
    expect(rec.of('node.unregistered')).toEqual([{ id: id('wt') }]);
  });

  it('carries hidden children too, still hidden', () => {
    const s = seeded();
    s.hideNode(id('log'));
    s.unregisterNode(id('wt'), { rehome: id('main') });
    expect(s.getNode(id('log'))?.lifecycle.state).toBe('hidden');
    expect(order(s, 'main')).toContain('log');
  });

  it('keeps focus on a rehomed child', () => {
    const s = seeded();
    s.focusNode(id('term'));
    s.unregisterNode(id('wt'), { rehome: id('main') });
    expect(s.focusedId).toBe(id('term'));
  });

  it("does not let a rehomed child's lock.destroy block the removal", () => {
    const s = seeded();
    s.setLock(id('term'), { destroy: true });
    s.unregisterNode(id('wt'), { rehome: id('main') });
    expect(s.getNode(id('term'))).toBeDefined();
  });

  it("still honors the zone's own lock.destroy", () => {
    const s = seeded();
    s.setLock(id('wt'), { destroy: true });
    expect(() => s.unregisterNode(id('wt'), { rehome: id('main') })).toThrow(LockedError);
    expect(snapshot(s)).toEqual({ main: ['editor'], wt: ['term', 'log'], has: true });
  });

  it.each<[string, (s: Store) => void]>([
    ["a child's lock.move", (s) => s.setLock(id('log'), { move: true })],
    ["the target's lock.accept", (s) => s.setLock(id('main'), { accept: true })],
    ["the zone's lock.dragOut", (s) => s.setLock(id('wt'), { dragOut: true })],
  ])('throws on %s and changes nothing, unless forced', (_label, lock) => {
    const s = seeded();
    lock(s);
    expect(() => s.unregisterNode(id('wt'), { rehome: id('main') })).toThrow(LockedError);
    expect(snapshot(s)).toEqual({ main: ['editor'], wt: ['term', 'log'], has: true });
    s.unregisterNode(id('wt'), { rehome: id('main'), force: true });
    expect(snapshot(s)).toEqual({ main: ['editor', 'term', 'log'], wt: [], has: false });
  });

  it('refuses a target inside the zone, or the zone itself', () => {
    const s = seeded();
    s.registerNode(
      createNode({
        kind: 'group',
        id: id('inner'),
        parentId: id('wt'),
        container: { strategyId: 'strip', config: {} },
      }),
    );
    for (const target of ['wt', 'inner']) {
      expect(() => s.unregisterNode(id('wt'), { rehome: id(target) })).toThrow(CycleError);
    }
    expect(s.getNode(id('wt'))).toBeDefined();
  });

  it('refuses a target that is missing or holds no children', () => {
    const s = seeded();
    const before = snapshot(s);
    expect(() => s.unregisterNode(id('wt'), { rehome: id('nowhere') })).toThrow();
    expect(() => s.unregisterNode(id('wt'), { rehome: id('editor') as NodeId })).toThrow();
    expect(snapshot(s)).toEqual(before);
  });

  it('removes a zone with no children like any other', () => {
    const s = seeded();
    s.registerNode(
      createNode({ kind: 'zone', id: id('empty'), container: { strategyId: 'strip', config: {} } }),
    );
    s.unregisterNode(id('empty'), { rehome: id('main') });
    expect(s.getNode(id('empty'))).toBeUndefined();
  });
});
