import { describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, type Rect, Store } from '../index.js';
import { DragEngine, type DragEngineOptions, type DropTarget } from './DragEngine.js';
import type { DropIntent } from './dropIntent.js';

const SQUARE: Rect = { x: 0, y: 0, w: 100, h: 100 };

/** strip zone `z` holding panels `a`, `b`, plus a loose panel `p` in `other`. */
function buildStore(): Store {
  const s = new Store();
  for (const z of ['z', 'other']) {
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: asNodeId(z) }),
    );
  }
  for (const [id, parent] of [
    ['a', 'z'],
    ['b', 'z'],
    ['p', 'other'],
  ] as const) {
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId(id), parentId: asNodeId(parent) }),
    );
    s.showNode(asNodeId(id));
  }
  return s;
}

function target(intent: DropIntent | undefined, extra: Partial<DropTarget> = {}): DropTarget {
  return { bounds: () => SQUARE, getDropIntent: () => intent, ...extra };
}

const order = (s: Store, id: string) => s.getContainerView(asNodeId(id))?.childOrder ?? [];

function engineWith(s: Store, extra: Partial<DragEngineOptions> = {}): DragEngine {
  return new DragEngine(s, {
    makeStackId: () => asNodeId('s1'),
    makeSplitId: () => asNodeId('g1'),
    ...extra,
  });
}

describe('DragEngine — drop intent', () => {
  it('carries the resolved intent on hover', () => {
    const s = buildStore();
    const e = engineWith(s);
    e.addDropTarget(asNodeId('z'), target({ kind: 'stack', ontoId: 'b' }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.intent).toEqual({ kind: 'stack', ontoId: 'b' });
  });

  it('takes insertIndex from an insert intent', () => {
    const s = buildStore();
    const e = engineWith(s);
    e.addDropTarget(asNodeId('z'), target({ kind: 'insert', index: 1 }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.insertIndex).toBe(1);
  });

  it('still honours a target that only registers getInsertionIndex', () => {
    const s = buildStore();
    const e = engineWith(s);
    e.addDropTarget(asNodeId('z'), { bounds: () => SQUARE, getInsertionIndex: () => 1 });
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.insertIndex).toBe(1);
    expect(e.state()?.hover?.intent).toBeUndefined();
    e.drop();
    expect(order(s, 'z')).toEqual([asNodeId('a'), asNodeId('p'), asNodeId('b')]);
  });

  it('wraps the pair into a stack on a stack intent', () => {
    const s = buildStore();
    const e = engineWith(s);
    e.addDropTarget(asNodeId('z'), target({ kind: 'stack', ontoId: 'b' }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    e.drop();
    expect(order(s, 'z')).toEqual([asNodeId('a'), asNodeId('s1')]);
    expect(order(s, 's1')).toEqual([asNodeId('b'), asNodeId('p')]);
  });

  it('refuses to stack a node onto itself', () => {
    const s = buildStore();
    const e = engineWith(s);
    e.addDropTarget(asNodeId('z'), target({ kind: 'stack', ontoId: 'p' }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
    e.drop();
    expect(s.getNode(asNodeId('s1'))).toBeUndefined();
    expect(order(s, 'other')).toEqual([asNodeId('p')]);
  });

  it('refuses to stack onto a move-locked child', () => {
    const s = buildStore();
    s.setLock(asNodeId('b'), { move: true });
    const e = engineWith(s);
    e.addDropTarget(asNodeId('z'), target({ kind: 'stack', ontoId: 'b' }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
    e.drop();
    expect(order(s, 'z')).toEqual([asNodeId('a'), asNodeId('b')]);
  });

  it('refuses to stack onto a descendant of the dragged node', () => {
    const s = buildStore();
    // p › mid › deep, so the target is neither the source nor its own child —
    // only the onto-child is inside the dragged subtree.
    s.ensureContainer(asNodeId('p'), 'strip', {});
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: asNodeId('mid'),
        parentId: asNodeId('p'),
      }),
    );
    s.registerNode(createNode({ kind: 'panel', id: asNodeId('deep'), parentId: asNodeId('mid') }));
    s.showNode(asNodeId('deep'));
    const e = engineWith(s);
    e.addDropTarget(asNodeId('mid'), target({ kind: 'stack', ontoId: 'deep' }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
    e.drop();
    expect(s.getNode(asNodeId('s1'))).toBeUndefined();
  });

  it('accepts a split intent', () => {
    const s = buildStore();
    const e = engineWith(s);
    e.addDropTarget(
      asNodeId('z'),
      target({ kind: 'split', ontoId: 'b', edge: 'start', axis: 'y' }),
    );
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(true);
    expect(e.state()?.hover?.intent).toEqual({
      kind: 'split',
      ontoId: 'b',
      edge: 'start',
      axis: 'y',
    });
  });

  it('commits a split at the drop', () => {
    const s = buildStore();
    const e = engineWith(s);
    e.addDropTarget(
      asNodeId('z'),
      target({ kind: 'split', ontoId: 'b', edge: 'start', axis: 'y' }),
    );
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    e.drop();
    expect(order(s, 'z')).toEqual([asNodeId('a'), asNodeId('g1')]);
    expect(order(s, 'g1')).toEqual([asNodeId('p'), asNodeId('b')]);
    expect(s.getNode(asNodeId('g1'))?.container?.config).toMatchObject({ axis: 'y' });
  });

  it('puts the source in the far half for an end-edge drop', () => {
    const s = buildStore();
    const e = engineWith(s);
    e.addDropTarget(asNodeId('z'), target({ kind: 'split', ontoId: 'b', edge: 'end', axis: 'y' }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    e.drop();
    expect(order(s, 'g1')).toEqual([asNodeId('b'), asNodeId('p')]);
  });

  it('merges splitConfig into the group it creates', () => {
    const s = buildStore();
    const e = engineWith(s, { splitConfig: { gap: 6 } });
    e.addDropTarget(
      asNodeId('z'),
      target({ kind: 'split', ontoId: 'b', edge: 'start', axis: 'y' }),
    );
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    e.drop();
    expect(s.getNode(asNodeId('g1'))?.container?.config).toMatchObject({ gap: 6 });
  });

  // A flow container reads its axis off measured rects, so the axis of the
  // same pane's split can change mid-drag as siblings reflow. Deduping the
  // hover on ontoId and edge alone would keep the stale one.
  it('treats a split whose axis changed as a new hover', () => {
    const s = buildStore();
    const e = engineWith(s);
    let axis: 'x' | 'y' = 'y';
    e.addDropTarget(asNodeId('z'), {
      bounds: () => SQUARE,
      getDropIntent: () => ({ kind: 'split', ontoId: 'b', edge: 'start', axis }),
    });
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    const seen: (DropIntent | undefined)[] = [];
    e.subscribe((st) => seen.push(st?.hover?.intent));
    // Same point: a moved cursor re-emits on its own, which would hide whether
    // the intent comparison noticed the axis.
    axis = 'x';
    e.updateHoverByPoint(50, 50);
    expect(seen.at(-1)).toMatchObject({ kind: 'split', axis: 'x' });
  });

  it('refuses to split a node onto itself', () => {
    const s = buildStore();
    const e = engineWith(s);
    e.addDropTarget(
      asNodeId('z'),
      target({ kind: 'split', ontoId: 'p', edge: 'start', axis: 'y' }),
    );
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('refuses to split onto a move-locked child', () => {
    const s = buildStore();
    s.setLock(asNodeId('b'), { move: true });
    const e = engineWith(s);
    e.addDropTarget(
      asNodeId('z'),
      target({ kind: 'split', ontoId: 'b', edge: 'start', axis: 'y' }),
    );
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('refuses to split onto a descendant of the dragged node', () => {
    const s = buildStore();
    // p › mid › deep, so the target is neither the source nor its own child —
    // only the onto-child is inside the dragged subtree.
    s.ensureContainer(asNodeId('p'), 'strip', {});
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: {} },
        id: asNodeId('mid'),
        parentId: asNodeId('p'),
      }),
    );
    s.registerNode(createNode({ kind: 'panel', id: asNodeId('deep'), parentId: asNodeId('mid') }));
    s.showNode(asNodeId('deep'));
    const e = engineWith(s);
    e.addDropTarget(
      asNodeId('mid'),
      target({ kind: 'split', ontoId: 'deep', edge: 'start', axis: 'y' }),
    );
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('refuses a split intent on a parent whose order the host controls', () => {
    const s = buildStore();
    const e = engineWith(s);
    const commit = vi.fn();
    e.registerOrderControl(asNodeId('z'), commit);
    e.addDropTarget(
      asNodeId('z'),
      target({ kind: 'split', ontoId: 'b', edge: 'start', axis: 'y' }),
    );
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
    e.drop();
    expect(commit).not.toHaveBeenCalled();
    expect(order(s, 'z')).toEqual([asNodeId('a'), asNodeId('b')]);
  });

  it('refuses a stack intent on a parent whose order the host controls', () => {
    const s = buildStore();
    const e = engineWith(s);
    const commit = vi.fn();
    e.registerOrderControl(asNodeId('z'), commit);
    e.addDropTarget(asNodeId('z'), target({ kind: 'stack', ontoId: 'b' }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
    e.drop();
    expect(commit).not.toHaveBeenCalled();
    expect(s.getNode(asNodeId('s1'))).toBeUndefined();
    expect(order(s, 'z')).toEqual([asNodeId('a'), asNodeId('b')]);
  });

  it('still commits an insert on a controlled parent', () => {
    const s = buildStore();
    const e = engineWith(s);
    const commit = vi.fn();
    e.registerOrderControl(asNodeId('z'), commit);
    e.addDropTarget(asNodeId('z'), target({ kind: 'insert', index: 1 }));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    e.drop();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
