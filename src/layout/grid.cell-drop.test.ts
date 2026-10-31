import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { gridStrategy } from './grid.js';

/** A grid of 100x50 cells, 3 across, with a 10px gap and no padding. A grid
 *  has the rows its children reach, so `low` holds row 1 open. */
const OPTIONS: Record<string, unknown> = { cols: 3, gap: 10, cell: { h: 50 } };
const low: LayoutItem = { id: 'low', placement: { cell: { col: 0, row: 1 } } };
const CONTAINER = { w: 320, h: 110 };

const cellAt = (items: LayoutItem[], point: { x: number; y: number }, options = OPTIONS) =>
  gridStrategy.cellAt?.({ items, container: CONTAINER, options, point, sourceId: 'drag' });

describe('gridStrategy.cellAt', () => {
  it('names the empty cell under the point', () => {
    expect(cellAt([low], { x: 230, y: 80 })).toEqual({ col: 2, row: 1 });
    expect(cellAt([low], { x: 120, y: 20 })).toEqual({ col: 1, row: 0 });
  });

  it('answers nothing in a row past the last one a child reaches', () => {
    expect(cellAt([{ id: 'a' }], { x: 230, y: 80 })).toBeUndefined();
  });

  it('answers nothing over a cell a child already holds', () => {
    expect(cellAt([low], { x: 20, y: 80 })).toBeUndefined();
    const spanning: LayoutItem = {
      id: 'a',
      placement: { cell: { col: 1, row: 0 }, span: { cols: 2 } },
    };
    expect(cellAt([spanning], { x: 230, y: 20 })).toBeUndefined();
  });

  it('treats the dragged child as gone, so it can move to a cell of its own', () => {
    expect(cellAt([{ id: 'drag' }], { x: 20, y: 20 })).toEqual({ col: 0, row: 0 });
  });

  it('measures against the grid as shown, with the dragged child still counted', () => {
    // Five auto-balanced items tile 3×2; without the source, four would tile 2×2.
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }));
    const hit = gridStrategy.cellAt?.({
      items,
      container: { w: 300, h: 300 },
      options: {},
      point: { x: 250, y: 225 },
      sourceId: 'i0',
    });
    expect(hit).toEqual({ col: 2, row: 1 });
  });

  it('counts a gap as the cell before it', () => {
    expect(cellAt([low], { x: 105, y: 20 })).toEqual({ col: 0, row: 0 });
  });

  it('answers nothing past the grid, or outside the rows it has', () => {
    expect(cellAt([], { x: 330, y: 20 })).toBeUndefined();
    expect(cellAt([low], { x: 20, y: 200 })).toBeUndefined();
  });

  it('works on tracked axes', () => {
    const options = { cols: 3, tracks: { cols: [40, 200, 60], rows: [50] } };
    expect(cellAt([], { x: 250, y: 20 }, options)).toEqual({ col: 2, row: 0 });
  });
});
