import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { bindAnnouncer } from './announcer.js';
import type { FocusAdapter } from './types.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function spyAdapter(): FocusAdapter & { spoken: string[] } {
  const spoken: string[] = [];
  return {
    spoken,
    present() {},
    announce(text) {
      spoken.push(text);
    },
  };
}

/** One zone of panels, all visible. */
function row(zone: string, children: string[], store = new Store()): Store {
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id(zone) }),
  );
  store.showNode(id(zone));
  for (const c of children) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id(zone) }));
    store.showNode(id(c));
  }
  return store;
}

describe('bindAnnouncer', () => {
  it('announces the departure when the focused node is destroyed', () => {
    const s = row('z', ['a', 'b']);
    const adapter = spyAdapter();
    bindAnnouncer(s, adapter);
    s.focusNode(id('a'));
    s.unregisterNode(id('a'));
    expect(adapter.spoken).toEqual(['panel 1 closed']);
  });

  it('names the departing node by meta.title when it has one', () => {
    const s = row('z', ['a', 'b']);
    s.setMeta(id('a'), { title: 'Editor' });
    const adapter = spyAdapter();
    bindAnnouncer(s, adapter);
    s.focusNode(id('a'));
    s.unregisterNode(id('a'));
    expect(adapter.spoken).toEqual(['Editor closed']);
  });

  it('says nothing is left when no successor could be found', () => {
    const s = row('z', ['a']);
    const adapter = spyAdapter();
    bindAnnouncer(s, adapter);
    s.focusNode(id('a'));
    s.unregisterNode(id('a'));
    expect(adapter.spoken).toEqual(['panel 1 closed. Nothing left to focus']);
  });

  it('distinguishes hiding from destroying', () => {
    const s = row('z', ['a', 'b']);
    const adapter = spyAdapter();
    bindAnnouncer(s, adapter);
    s.focusNode(id('a'));
    s.hideNode(id('a'));
    expect(adapter.spoken).toEqual(['panel 1 hidden']);
  });

  it('announces the new parent and position when the focused node is moved', () => {
    const s = row('z', ['a', 'b']);
    row('y', ['c'], s);
    s.setMeta(id('y'), { title: 'Sidebar' });
    s.setMeta(id('a'), { title: 'Editor' });
    const adapter = spyAdapter();
    bindAnnouncer(s, adapter);
    s.focusNode(id('a'));
    s.moveNode(id('a'), id('y'));
    expect(adapter.spoken).toEqual(['Editor moved to Sidebar, position 2 of 2']);
  });

  it('announces a reorder of the focused node without naming the parent', () => {
    const s = row('z', ['a', 'b', 'c']);
    s.setMeta(id('a'), { title: 'Editor' });
    const adapter = spyAdapter();
    bindAnnouncer(s, adapter);
    s.focusNode(id('a'));
    s.reorderInParent(id('a'), 2);
    expect(adapter.spoken).toEqual(['Editor moved to position 3 of 3']);
  });

  it('announces a move that relocates the subtree focus sits in', () => {
    const s = new Store();
    row('z', [], s);
    row('y', [], s);
    s.registerNode(
      createNode({
        kind: 'group',
        container: { strategyId: 'strip', config: {} },
        id: id('g'),
        parentId: id('z'),
      }),
    );
    s.showNode(id('g'));
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('p'), parentId: id('g') }));
    s.showNode(id('p'));
    const adapter = spyAdapter();
    bindAnnouncer(s, adapter);
    s.focusNode(id('p'));
    s.moveNode(id('g'), id('y'));
    expect(adapter.spoken).toEqual(['group 1 moved to zone 2, position 1 of 1']);
  });

  it('stays silent for a node focus is not inside', () => {
    const s = row('z', ['a', 'b']);
    row('y', [], s);
    const adapter = spyAdapter();
    bindAnnouncer(s, adapter);
    s.focusNode(id('a'));
    s.moveNode(id('b'), id('y'));
    s.unregisterNode(id('b'));
    expect(adapter.spoken).toEqual([]);
  });

  it('stops announcing once unbound', () => {
    const s = row('z', ['a', 'b']);
    const adapter = spyAdapter();
    const off = bindAnnouncer(s, adapter);
    s.focusNode(id('a'));
    off();
    s.unregisterNode(id('a'));
    expect(adapter.spoken).toEqual([]);
  });
});
