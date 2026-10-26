import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { asNodeId, LockedError, type NodeId, Store } from './index.js';
import { deserialize, serialize } from './snapshot.js';
import { recordEvents } from './test-utils/record-events.js';

const id = (s: string) => asNodeId(s);
const order = (s: Store, parent: NodeId) => s.getContainerView(parent)?.childOrder ?? [];

/** root `r` › row `w` (autoUnsplit) › stacks `s1` [a] and `s2` [b, c], both autoPrune. */
function seeded(autoPrune = true) {
  const s = new Store();
  const box = (cid: string, parentId?: string, flags: { autoUnsplit?: boolean } = {}) =>
    s.registerNode(
      createNode({
        kind: 'zone',
        id: id(cid),
        ...(parentId ? { parentId: id(parentId) } : {}),
        container: { strategyId: 'strip', config: {}, ...flags },
      }),
    );
  box('r');
  box('w', 'r', { autoUnsplit: true });
  box('s1', 'w');
  box('s2', 'w');
  const pane = (pid: string, parentId: string) => {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(pid), parentId: id(parentId) }));
    s.showNode(id(pid));
  };
  pane('a', 's1');
  pane('b', 's2');
  pane('c', 's2');
  if (autoPrune) {
    s.setAutoPrune(id('s1'), true);
    s.setAutoPrune(id('s2'), true);
  }
  return s;
}

describe('Store — autoPrune', () => {
  it('removes a container a move leaves empty', () => {
    const s = seeded();
    s.moveNode(id('a'), id('s2'));
    expect(s.getNode(id('s1'))).toBeUndefined();
  });

  it('then lets the parent it left with one child unsplit', () => {
    const s = seeded();
    s.moveNode(id('a'), id('s2'));
    expect(s.getNode(id('w'))).toBeUndefined();
    expect(order(s, id('r'))).toEqual([id('s2')]);
    expect(order(s, id('s2'))).toEqual([id('b'), id('c'), id('a')]);
  });

  it('removes one emptied by unregisterNode too', () => {
    const s = seeded();
    s.unregisterNode(id('a'));
    expect(s.getNode(id('s1'))).toBeUndefined();
    expect(order(s, id('r'))).toEqual([id('s2')]);
  });

  it('removes one a batch empties, judged after the whole batch', () => {
    const s = seeded();
    s.moveNodes([id('b'), id('c')], id('s1'));
    expect(s.getNode(id('s2'))).toBeUndefined();
    expect(order(s, id('s1'))).toEqual([id('a'), id('b'), id('c')]);
  });

  it('does nothing when the flag is off', () => {
    const s = seeded(false);
    s.moveNode(id('a'), id('s2'));
    expect(order(s, id('s1'))).toEqual([]);
    expect(order(s, id('w'))).toEqual([id('s1'), id('s2')]);
  });

  it('leaves a container that is registered empty alone', () => {
    const s = seeded();
    s.registerNode(
      createNode({
        kind: 'zone',
        id: id('s3'),
        parentId: id('w'),
        container: { strategyId: 'strip', config: {}, autoPrune: true },
      }),
    );
    expect(s.getNode(id('s3'))).toBeDefined();
  });

  it('never removes a root', () => {
    const s = seeded();
    s.setAutoPrune(id('r'), true);
    s.unregisterNode(id('s2'));
    s.unregisterNode(id('a'));
    expect(s.getNode(id('r'))).toBeDefined();
  });

  it('leaves the container when a lock forbids destroying it, without failing the move', () => {
    const s = seeded();
    s.setLock(id('s1'), { destroy: true });
    expect(() => s.moveNode(id('a'), id('s2'))).not.toThrow();
    expect(order(s, id('s1'))).toEqual([]);
    expect(order(s, id('w'))).toEqual([id('s1'), id('s2')]);
  });

  it('brackets the removal and the unsplit it causes as one transaction', () => {
    const s = seeded();
    const rec = recordEvents(s, 'transaction.begin', 'transaction.end');
    s.moveNode(id('a'), id('s2'));
    expect(rec.of('transaction.begin')).toHaveLength(1);
    expect(rec.of('transaction.end')).toHaveLength(1);
    rec.stop();
  });

  it('round-trips through the container view and a snapshot', () => {
    const s = seeded();
    expect(s.getContainerView(id('s1'))?.autoPrune).toBe(true);
    expect(s.getContainerView(id('w'))?.autoPrune).toBe(false);
    const restored = deserialize(serialize(s));
    expect(restored.getContainerView(id('s1'))?.autoPrune).toBe(true);
    restored.moveNode(id('a'), id('s2'));
    expect(restored.getNode(id('s1'))).toBeUndefined();
  });

  it('is refused on an arrange-locked container', () => {
    const s = seeded(false);
    s.setLock(id('s1'), { arrange: true });
    expect(() => s.setAutoPrune(id('s1'), true)).toThrow(LockedError);
  });
});
