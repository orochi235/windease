import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import {
  asNodeId,
  CapabilityMissingError,
  InvariantViolationError,
  LockedError,
  type NodeId,
  Store,
} from './index.js';
import { serialize } from './snapshot.js';
import { captureTrace } from './test-utils/capture-trace.js';
import { recordEvents } from './test-utils/record-events.js';

const id = (s: string) => asNodeId(s);

/** zone `z` › panels `a`, `b`, `c`. */
function seeded(): { s: Store; z: NodeId; a: NodeId; b: NodeId; c: NodeId } {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  for (const p of ['a', 'b', 'c']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(p), parentId: id('z') }));
    s.showNode(id(p));
  }
  return { s, z: id('z'), a: id('a'), b: id('b'), c: id('c') };
}

const order = (s: Store, parent: NodeId) => s.getContainerView(parent)?.childOrder ?? [];

describe('Store.stackNodes', () => {
  it('wraps both nodes in a stack at the onto-child slot', () => {
    const { s, z, a, b, c } = seeded();
    s.stackNodes(a, b, { id: id('s1') });
    expect(order(s, z)).toEqual([id('s1'), c]);
    expect(order(s, id('s1'))).toEqual([b, a]);
    expect(s.getNode(id('s1'))?.container?.strategyId).toBe('stack');
  });

  it('keeps the onto-child index rather than appending', () => {
    const { s, z, a, c } = seeded();
    s.stackNodes(a, c, { id: id('s1') });
    expect(order(s, z)).toEqual([id('b'), id('s1')]);
  });

  it('gives the stack the placement the onto-child was carrying', () => {
    const { s, a, b } = seeded();
    s.patchPlacement(b, { size: { w: 120 } });
    s.stackNodes(a, b, { id: id('s1') });
    expect(s.getNode(id('s1'))?.membership?.placement).toMatchObject({ size: { w: 120 } });
  });

  it('appends into an existing stack instead of nesting a second one', () => {
    const { s, z, a, b, c } = seeded();
    s.stackNodes(a, b, { id: id('s1') });
    s.stackNodes(c, b, { id: id('s2') });
    expect(order(s, id('s1'))).toEqual([b, a, c]);
    expect(s.getNode(id('s2'))).toBeUndefined();
    expect(order(s, z)).toEqual([id('s1')]);
  });

  it('is one transaction, so one undo step', () => {
    const { s, a, b } = seeded();
    const rec = recordEvents(s, 'transaction.begin', 'transaction.end');
    s.stackNodes(a, b, { id: id('s1') });
    expect(rec.of('transaction.begin')).toHaveLength(1);
    expect(rec.of('transaction.end')).toHaveLength(1);
    rec.stop();
  });

  it('refuses to stack a node onto itself, writing nothing', () => {
    const { s, a } = seeded();
    const before = JSON.stringify(serialize(s));
    expect(() => s.stackNodes(a, a, { id: id('s1') })).toThrow();
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses to stack a node onto its own descendant, writing nothing', () => {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
    );
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: id('g'),
        parentId: id('z'),
      }),
    );
    s.registerNode(createNode({ kind: 'panel', id: id('a'), parentId: id('g') }));
    s.showNode(id('a'));
    // `a` sits under `g`, and `g`'s parent is a strip — so this reaches the
    // wrap path, where the new stack would land inside `g` and then swallow it.
    const before = JSON.stringify(serialize(s));
    expect(() => s.stackNodes(id('g'), id('a'), { id: id('s1') })).toThrow();
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses a move-locked onto-child, writing nothing', () => {
    const { s, a, b } = seeded();
    s.setLock(b, { move: true });
    const before = JSON.stringify(serialize(s));
    expect(() => s.stackNodes(a, b, { id: id('s1') })).toThrow(LockedError);
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses an arrange-locked parent, writing nothing', () => {
    const { s, z, a, b } = seeded();
    s.setLock(z, { arrange: true });
    const before = JSON.stringify(serialize(s));
    expect(() => s.stackNodes(a, b, { id: id('s1') })).toThrow(LockedError);
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('sets autoUnsplit, so dragging the last tab out dissolves the stack', () => {
    const { s, z, a, b, c } = seeded();
    s.stackNodes(a, b, { id: id('s1') });
    s.moveNode(a, z);
    expect(s.getNode(id('s1'))).toBeUndefined();
    expect(order(s, z)).toEqual([b, c, a]);
  });

  it('shows the node that was stacked, not the one stacked onto', () => {
    const { s, a, b } = seeded();
    s.stackNodes(a, b, { id: id('s1') });
    expect(s.getNode(id('s1'))?.container?.config).toMatchObject({ activeId: a });
  });

  it('shows the node appended to an existing stack', () => {
    const { s, a, b, c } = seeded();
    s.stackNodes(a, b, { id: id('s1') });
    s.stackNodes(c, b, { id: id('s2') });
    expect(s.getNode(id('s1'))?.container?.config).toMatchObject({ activeId: c });
  });

  it('makes the new stack visible, so it renders', () => {
    const { s, a, b } = seeded();
    s.stackNodes(a, b, { id: id('s1') });
    expect(s.getNode(id('s1'))?.lifecycle.state).toBe('visible');
  });

  it('traces the wrap it performed', () => {
    const { s, a, b } = seeded();
    const cap = captureTrace('store');
    s.stackNodes(a, b, { id: id('s1') });
    expect(cap.matching(/stack: a onto b in new s1@1/)).toHaveLength(1);
    cap.stop();
  });

  it('passes its config through to the new container', () => {
    const { s, a, b } = seeded();
    s.stackNodes(a, b, { id: id('s1'), config: { headerSize: 28 } });
    expect(s.getNode(id('s1'))?.container?.config).toMatchObject({ headerSize: 28 });
  });
});

describe('Store.setActiveChild', () => {
  /** zone `z` › stack `s1` › panels `a`, `b`; `c` stays outside the stack. */
  function stacked(): { s: Store; st: NodeId } {
    const { s, a, b } = seeded();
    s.stackNodes(a, b, { id: id('s1') });
    return { s, st: id('s1') };
  }

  it('writes activeId into the container config', () => {
    const { s, st } = stacked();
    s.setActiveChild(st, id('a'));
    expect(s.getNode(st)?.container?.config).toMatchObject({ activeId: id('a') });
  });

  it('switches the active child on an arrange-locked stack', () => {
    const { s, st } = stacked();
    s.setLock(st, { arrange: true });
    s.setActiveChild(st, id('a'));
    expect(s.getNode(st)?.container?.config).toMatchObject({ activeId: id('a') });
  });

  it('refuses an id that is not a child of the container', () => {
    const { s, st } = stacked();
    expect(() => s.setActiveChild(st, id('c'))).toThrow(InvariantViolationError);
  });

  it('refuses a node with no container capability', () => {
    const { s } = stacked();
    expect(() => s.setActiveChild(id('a'), id('b'))).toThrow(CapabilityMissingError);
  });
});
