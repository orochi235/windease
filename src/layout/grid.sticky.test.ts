import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { gridStrategy } from './grid.js';
import { stuckRect } from './sticky.js';

/** A 4x4 sheet of 50px cells with a 1px gap and 2px padding: row 0 holds the
 *  column headings, column 0 the row numbers, and cell 0 the corner. */
function sheet(extra: Record<string, unknown> = {}) {
  const items: LayoutItem[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const sticky = r === 0 && c === 0 ? true : r === 0 ? 'y' : c === 0 ? 'x' : undefined;
      items.push({ id: `r${r}c${c}`, ...(sticky === undefined ? {} : { meta: { sticky } }) });
    }
  }
  return gridStrategy.layout({
    items,
    container: { w: 120, h: 120 },
    state: undefined,
    options: { cols: 4, gap: 1, padding: 2, cell: { w: 50, h: 50 }, ...extra },
  });
}

describe('gridStrategy placement.sticky', () => {
  it('holds a heading cell at the top edge, and a row number at the left', () => {
    const r = sheet();
    expect(r.sticky?.get('r0c2')).toEqual({ y: 2 });
    expect(r.sticky?.get('r2c0')).toEqual({ x: 2 });
    expect(r.sticky?.get('r0c0')).toEqual({ x: 2, y: 2 });
    expect(r.sticky?.has('r2c2')).toBe(false);
  });

  it('draws the corner above the headings, and the headings above the body', () => {
    const r = sheet();
    expect(r.placements.get('r0c0')?.z).toBe(4);
    expect(r.placements.get('r0c2')?.z).toBe(2);
    expect(r.placements.get('r2c0')?.z).toBe(2);
    expect(r.placements.get('r2c2')?.z).toBe(0);
  });

  it('stacks sticky rows in order, each after the ones before it', () => {
    const items: LayoutItem[] = [0, 1, 2].map((row) => ({
      id: `h${row}`,
      ...(row < 2 ? { meta: { sticky: 'y' } } : {}),
    }));
    const r = gridStrategy.layout({
      items,
      container: { w: 50, h: 60 },
      state: undefined,
      options: { cols: 1, gap: 1, padding: 2, cell: { w: 50, h: 30 } },
    });
    expect(r.sticky?.get('h0')).toEqual({ y: 2 });
    expect(r.sticky?.get('h1')).toEqual({ y: 33 });
  });

  it('keeps the stuck cell in view through stuckRect as the sheet scrolls', () => {
    const r = sheet();
    const heading = r.placements.get('r0c2')!;
    const at = stuckRect(heading, r.sticky?.get('r0c2'), { x: 40, y: 100 });
    expect(at.y).toBe(102);
    expect(at.x).toBe(heading.x);
  });

  it('moves the seam of a sticky track with it', () => {
    const r = sheet({ tracks: { cols: [50, 50, 50, 50] }, resizable: true });
    const seam = r.affordances.find((a) => a.id === 'track-x-0');
    expect(seam?.sticky).toEqual({ x: 2 + 50 - 2 + 0.5 });
    expect(r.affordances.find((a) => a.id === 'track-x-1')?.sticky).toBeUndefined();
  });

  it('draws every seam above the headings it crosses and below the corner', () => {
    // A column seam crosses the heading row, where its width is dragged.
    const r = sheet({ tracks: { cols: [50, 50, 50, 50] }, resizable: true });
    const seams = r.affordances.filter((a) => /^track-[xy]-/.test(a.id));
    expect(seams.length).toBeGreaterThan(0);
    for (const a of seams) expect(a.rect.z, a.id).toBe(3);
  });

  it('reports nothing when no cell is sticky', () => {
    const r = gridStrategy.layout({
      items: [{ id: 'a' }],
      container: { w: 50, h: 50 },
      state: undefined,
      options: {},
    });
    expect(r.sticky).toBeUndefined();
  });

  it("ignores a value it does not know, as strip's sticky does", () => {
    const r = gridStrategy.layout({
      items: [{ id: 'a', meta: { sticky: 'z' } }],
      container: { w: 50, h: 50 },
      state: undefined,
      options: {},
    });
    expect(r.sticky).toBeUndefined();
  });
});
