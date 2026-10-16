import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, type LayoutStrategy, type Rect, Store } from '../index.js';
import { recordEvents } from '../test-utils/record-events.js';
import { DragEngine } from './DragEngine.js';

const anything: LayoutStrategy<unknown, string, unknown> = {
  name: 'anything',
  layout: () => ({ placements: new Map(), affordances: [] }),
};
const SQUARE: Rect = { x: 0, y: 0, z: 0, w: 100, h: 100 };
const BOARD = asNodeId('board');
const TRAY = asNodeId('tray');
const CELL = { col: 2, row: 1 };

/** `board` (a grid) holds `a`, celled at 0,0; `p` waits in `tray`. */
function build(): Store {
  const s = new Store();
  for (const z of [BOARD, TRAY]) {
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'anything', config: {} }, id: z }),
    );
  }
  s.registerNode(
    createNode({
      kind: 'panel',
      id: asNodeId('a'),
      parentId: BOARD,
      placement: { cell: { col: 0, row: 0 } },
    }),
  );
  s.registerNode(createNode({ kind: 'panel', id: asNodeId('p'), parentId: TRAY }));
  return s;
}

function dropOnCell(s: Store, dragging: string) {
  const e = new DragEngine(s, { getStrategy: () => anything });
  e.addDropTarget(BOARD, {
    bounds: () => SQUARE,
    getDropIntent: () => ({ kind: 'cell', cell: CELL }),
  });
  e.tryBegin(asNodeId(dragging));
  e.updateHoverByPoint(50, 50);
  return e;
}

describe('DragEngine — a drop onto an empty grid cell', () => {
  it('reports the cell on the hover and accepts it', () => {
    const hover = dropOnCell(build(), 'p').state()?.hover;
    expect(hover?.accepted).toBe(true);
    expect(hover?.intent).toEqual({ kind: 'cell', cell: CELL });
  });

  it('moves the child in and writes the cell, as one transaction', () => {
    const s = build();
    const rec = recordEvents(s, 'transaction.begin');
    dropOnCell(s, 'p').drop();
    expect(s.getParent(asNodeId('p'))?.id).toBe(BOARD);
    expect(s.getNode(asNodeId('p'))?.membership?.placement.cell).toEqual(CELL);
    expect(rec.of('transaction.begin')).toEqual([{ label: 'drop to cell' }]);
  });

  it('moves a child already in the grid to the cell without reordering it', () => {
    const s = build();
    dropOnCell(s, 'a').drop();
    expect(s.getNode(asNodeId('a'))?.membership?.placement.cell).toEqual(CELL);
    expect(s.getContainerView(BOARD)?.childOrder).toEqual(['a']);
  });

  it('never starts for a source with lock.move, as any drag does', () => {
    const s = build();
    s.setLock(asNodeId('p'), { move: true });
    expect(dropOnCell(s, 'p').state()).toBeNull();
  });

  it('refuses a cell drop into a parent whose order the host controls', () => {
    const s = build();
    const e = new DragEngine(s, { getStrategy: () => anything });
    e.addDropTarget(BOARD, {
      bounds: () => SQUARE,
      getDropIntent: () => ({ kind: 'cell', cell: CELL }),
    });
    e.registerOrderControl(BOARD, () => {});
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(false);
  });
});
