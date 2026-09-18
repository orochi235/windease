import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import {
  asNodeId,
  deserialize,
  HistoryController,
  LockedError,
  type NodeId,
  type SerializedStore,
  Store,
  serialize,
} from './index.js';
import { captureTrace } from './test-utils/capture-trace.js';
import { recordEvents } from './test-utils/record-events.js';

const id = (s: string) => asNodeId(s);
const order = (s: Store, parent: NodeId) => s.getContainerView(parent)?.childOrder ?? [];

/** Zone `z` running `strategyId` with `config`, holding focusable panels `ids`, all shown. */
function seeded(
  config: Record<string, unknown>,
  ids: readonly string[] = ['a', 'b', 'c'],
  strategyId = 'desktop',
): Store {
  const s = new Store();
  s.registerNode(createNode({ kind: 'zone', container: { strategyId, config }, id: id('z') }));
  for (const p of ids) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(p), parentId: id('z') }));
    s.showNode(id(p));
  }
  return s;
}

/** Undo bracketed on the store's transaction events, the way the guide wires it. */
function bracketedHistory(s: Store) {
  const history = new HistoryController<SerializedStore>();
  history.push(serialize(s));
  s.events.on('transaction.begin', () => history.beginTransaction());
  s.events.on('transaction.end', () => history.endTransaction(serialize(s)));
  return {
    history,
    undo() {
      const snap = history.undo();
      if (snap) s.withLocksSuspended(() => deserialize(s, snap));
    },
  };
}

describe("config raise: 'focus'", () => {
  it('moves the focused child last in its parent', () => {
    const s = seeded({ raise: 'focus' });
    s.focusNode(id('a'));
    expect(order(s, id('z'))).toEqual(['b', 'c', 'a']);
  });

  it('leaves the order alone without the key', () => {
    const s = seeded({});
    s.focusNode(id('a'));
    expect(order(s, id('z'))).toEqual(['a', 'b', 'c']);
  });

  it("raises on 'click' too: the two modes differ only in the React layer", () => {
    const s = seeded({ raise: 'click' });
    s.focusNode(id('b'));
    expect(order(s, id('z'))).toEqual(['a', 'c', 'b']);
  });

  it('reports the raise as a reorder', () => {
    const s = seeded({ raise: 'focus' });
    const rec = recordEvents(s, 'node.reordered');
    s.focusNode(id('a'));
    expect(rec.of('node.reordered')).toEqual([
      { parentId: id('z'), id: id('a'), fromIndex: 0, toIndex: 2 },
    ]);
  });

  it('raises the ancestor that sits in the raising container, not only a direct child', () => {
    const s = seeded({ raise: 'focus' }, ['a', 'b']);
    s.registerNode(
      createNode({
        kind: 'window',
        id: id('w'),
        parentId: id('z'),
        container: { strategyId: 'strip', config: {} },
      }),
    );
    s.showNode(id('w'));
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('inner'), parentId: id('w') }));
    s.showNode(id('inner'));
    s.focusNode(id('a'));
    s.focusNode(id('inner'));
    expect(order(s, id('z'))).toEqual(['b', 'a', 'w']);
  });

  it('keeps a pinned child in its slot', () => {
    const s = seeded({ raise: 'focus' });
    s.setPinned(id('a'), 0);
    s.focusNode(id('a'));
    expect(order(s, id('z'))).toEqual(['a', 'b', 'c']);
  });

  it('routes around a pin that holds the top slot', () => {
    const s = seeded({ raise: 'focus' });
    s.setPinned(id('c'), 2);
    s.focusNode(id('a'));
    expect(order(s, id('z'))).toEqual(['b', 'a', 'c']);
  });

  it("skips a parent locked against 'arrange', and still focuses", () => {
    const s = seeded({ raise: 'focus' });
    s.setLock(id('z'), { arrange: true });
    s.focusNode(id('a'));
    expect(order(s, id('z'))).toEqual(['a', 'b', 'c']);
    expect(s.focusedId).toBe(id('a'));
  });

  it('is one transaction with the focus change, so one undo step', () => {
    const s = seeded({ raise: 'focus' });
    const rec = recordEvents(s, 'transaction.begin', 'transaction.end');
    const { undo } = bracketedHistory(s);
    s.focusNode(id('a'));
    expect(rec.of('transaction.begin')).toEqual([{ label: 'raise' }]);
    expect(rec.of('transaction.end')).toHaveLength(1);
    undo();
    expect(order(s, id('z'))).toEqual(['a', 'b', 'c']);
  });

  it('opens no transaction when nothing moves', () => {
    const s = seeded({ raise: 'focus' });
    const rec = recordEvents(s, 'transaction.begin');
    s.focusNode(id('c'));
    expect(rec.of('transaction.begin')).toEqual([]);
  });

  it('traces the raise', () => {
    const s = seeded({ raise: 'focus' });
    const t = captureTrace('store');
    s.focusNode(id('a'));
    expect(t.matching(/raise: a in z/)).toHaveLength(1);
  });
});

describe('Store.raise', () => {
  it('moves a child last without touching focus', () => {
    const s = seeded({});
    s.raise(id('a'));
    expect(order(s, id('z'))).toEqual(['b', 'c', 'a']);
    expect(s.focusedId).toBeNull();
  });

  it("throws on a parent locked against 'arrange', unless forced", () => {
    const s = seeded({});
    s.setLock(id('z'), { arrange: true });
    expect(() => s.raise(id('a'))).toThrow(LockedError);
    s.raise(id('a'), { force: true });
    expect(order(s, id('z'))).toEqual(['b', 'c', 'a']);
  });

  it('ignores a root, which has no order to be raised in', () => {
    const s = seeded({});
    expect(() => s.raise(id('z'))).not.toThrow();
  });
});
