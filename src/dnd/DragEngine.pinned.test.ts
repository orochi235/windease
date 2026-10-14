import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, type LayoutStrategy, type Rect, Store } from '../index.js';
import { DragEngine } from './DragEngine.js';

const anything: LayoutStrategy<unknown, string, unknown> = {
  name: 'anything',
  layout: () => ({ placements: new Map(), affordances: [] }),
};
const SQUARE: Rect = { x: 0, y: 0, z: 0, w: 100, h: 100 };
const Z1 = asNodeId('z1');
const Z2 = asNodeId('z2');

/** z2 holds `head`, pinned first, then `a` and `b`; `p` waits in z1. */
function build(): Store {
  const s = new Store();
  for (const z of [Z1, Z2]) {
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'anything', config: {} }, id: z }),
    );
  }
  for (const [id, parent] of [
    ['p', Z1],
    ['head', Z2],
    ['a', Z2],
    ['b', Z2],
  ] as const) {
    s.registerNode(createNode({ kind: 'panel', id: asNodeId(id), parentId: parent }));
  }
  s.setPinned(asNodeId('head'), 0);
  return s;
}

function hoverAt(s: Store, dragging: string, index: number) {
  const e = new DragEngine(s, { getStrategy: () => anything });
  e.addDropTarget(Z2, { bounds: () => SQUARE, getInsertionIndex: () => index });
  e.tryBegin(asNodeId(dragging));
  e.updateHoverByPoint(50, 50);
  return e;
}

describe('DragEngine — a hover over a slot a pinned child holds', () => {
  it('reports the index the drop will land at, past the pin', () => {
    expect(hoverAt(build(), 'p', 0).state()?.hover?.insertIndex).toBe(1);
  });

  it('lands where it said it would', () => {
    const s = build();
    hoverAt(s, 'p', 0).drop();
    expect(s.getNode(Z2)?.container?.childOrder).toEqual(['head', 'p', 'a', 'b']);
  });

  it('does the same for a reorder inside the container', () => {
    expect(hoverAt(build(), 'b', 0).state()?.hover?.insertIndex).toBe(1);
  });

  it('leaves an index no pin holds as the pointer gave it', () => {
    expect(hoverAt(build(), 'p', 2).state()?.hover?.insertIndex).toBe(2);
  });

  it('lets the pinned child itself be dragged to any slot', () => {
    expect(hoverAt(build(), 'head', 2).state()?.hover?.insertIndex).toBe(2);
  });
});
