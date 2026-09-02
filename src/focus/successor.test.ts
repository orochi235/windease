import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { recordEvents } from '../test-utils/record-events.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function row(children: string[]): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  for (const c of children) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    s.showNode(id(c));
  }
  return s;
}

describe('focus successor', () => {
  it('moves focus to the next sibling when the focused node is destroyed', () => {
    const s = row(['a', 'b', 'c']);
    s.focusNode(id('b'));
    const rec = recordEvents(s, 'focus.successor');
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBe(id('c'));
    expect(rec.of('focus.successor')).toEqual([
      { from: id('b'), to: id('c'), reason: 'destroyed' },
    ]);
    rec.stop();
  });

  it('falls back to the previous sibling when the focused node was last', () => {
    const s = row(['a', 'b']);
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBe(id('a'));
  });

  it('reports null when nothing is left to focus', () => {
    const s = row(['a']);
    s.focusNode(id('a'));
    const rec = recordEvents(s, 'focus.successor');
    s.unregisterNode(id('a'));
    expect(s.focusedId).toBeNull();
    expect(rec.of('focus.successor')).toEqual([{ from: id('a'), to: null, reason: 'destroyed' }]);
    rec.stop();
  });

  it('hiding the focused node picks a successor with reason hidden', () => {
    const s = row(['a', 'b']);
    s.focusNode(id('a'));
    const rec = recordEvents(s, 'focus.successor');
    s.hideNode(id('a'));
    expect(s.focusedId).toBe(id('b'));
    expect(rec.of('focus.successor')).toEqual([{ from: id('a'), to: id('b'), reason: 'hidden' }]);
    rec.stop();
  });

  it('blurs the departing node when a successor takes over', () => {
    const s = row(['a', 'b']);
    s.focusNode(id('a'));
    s.hideNode(id('a'));
    expect(s.focusedId).toBe(id('b'));
    expect(s.getNode(id('a'))?.focus?.state).toBe('blurred');
    expect(s.getNode(id('b'))?.focus?.state).toBe('focused');
  });

  it('blurs the departing node when nothing succeeds it', () => {
    const s = row(['a']);
    s.focusNode(id('a'));
    s.hideNode(id('a'));
    expect(s.focusedId).toBeNull();
    expect(s.getNode(id('a'))?.focus?.state).toBe('blurred');
  });

  it('emits the departing blur before the successor focus', () => {
    const s = row(['a', 'b']);
    s.focusNode(id('a'));
    const rec = recordEvents(s, 'node.transitioned');
    s.hideNode(id('a'));
    expect(rec.of('node.transitioned').filter((e) => e.machine === 'focus')).toEqual([
      { id: id('a'), machine: 'focus', from: 'focused', to: 'blurred' },
      { id: id('b'), machine: 'focus', from: 'blurred', to: 'focused' },
    ]);
    rec.stop();
  });

  it('does not fire on an explicit focusNode', () => {
    const s = row(['a', 'b']);
    const rec = recordEvents(s, 'focus.successor');
    s.focusNode(id('a'));
    s.focusNode(id('b'));
    expect(rec.of('focus.successor')).toEqual([]);
    rec.stop();
  });
});
