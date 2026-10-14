import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { gridStrategy } from './grid.js';

function run(items: LayoutItem[], options: Record<string, unknown>, w = 600, h = 400) {
  return gridStrategy.layout({ items, container: { w, h }, state: undefined, options });
}

const at = (id: string, col: number, row: number, extra: Partial<LayoutItem> = {}): LayoutItem => ({
  id,
  placement: { cell: { col, row } },
  ...extra,
});
const shut = (extent = 0) => ({ collapse: { extent } });

describe('gridStrategy and a collapsed child', () => {
  it('gives back a column whose only child is collapsed to nothing', () => {
    const r = run([at('a', 0, 0), at('b', 1, 0, shut()), at('c', 2, 0)], { cols: 3, gap: 10 });
    expect(r.placements.get('a')).toMatchObject({ x: 0, w: 295 });
    expect(r.placements.get('b')).toMatchObject({ x: 305, w: 0, collapsed: true });
    expect(r.placements.get('c')).toMatchObject({ x: 305, w: 295 });
  });

  it('holds the column at a rail when the policy asks for one', () => {
    const r = run([at('a', 0, 0), at('b', 1, 0, shut(24))], { cols: 2, gap: 10 });
    expect(r.placements.get('a')).toMatchObject({ x: 0, w: 566 });
    expect(r.placements.get('b')).toMatchObject({ x: 576, w: 24, collapsed: true });
  });

  it('keeps a column that an open child still sits in', () => {
    const items = [at('a', 0, 0), at('b', 1, 0, shut()), at('c', 1, 1)];
    const r = run(items, { cols: 2, rows: 2 });
    expect(r.placements.get('b')).toEqual({ x: 300, y: 0, z: 0, w: 300, h: 200 });
  });

  it('gives back a row the same way', () => {
    const items = [at('a', 0, 0), at('b', 0, 1, shut()), at('c', 0, 2)];
    const r = run(items, { cols: 1, gap: 10 });
    expect(r.placements.get('a')).toMatchObject({ y: 0, h: 195 });
    expect(r.placements.get('b')).toMatchObject({ y: 205, h: 0, collapsed: true });
    expect(r.placements.get('c')).toMatchObject({ y: 205, h: 195 });
  });

  it('gives back the row of a flowed child left alone in it', () => {
    const r = run([{ id: 'a' }, { id: 'b' }, { id: 'c', ...shut() }], { cols: 2 });
    expect(r.placements.get('a')).toMatchObject({ h: 400 });
    expect(r.placements.get('c')).toMatchObject({ h: 0, collapsed: true });
  });

  it('gives the room to share tracks and leaves pixel tracks as stated', () => {
    const items = [at('a', 0, 0), at('b', 1, 0, shut()), at('c', 2, 0)];
    const r = run(items, { tracks: { cols: [100, { share: 1 }, { share: 1 }] } });
    expect(r.placements.get('a')).toMatchObject({ x: 0, w: 100 });
    expect(r.placements.get('c')).toMatchObject({ x: 100, w: 500 });
  });

  it('collapses every column a spanning child holds alone', () => {
    const b = at('b', 1, 0, {
      ...shut(),
      placement: { cell: { col: 1, row: 0 }, span: { cols: 2 } },
    });
    const r = run([at('a', 0, 0), b], { cols: 3 });
    expect(r.placements.get('a')).toMatchObject({ x: 0, w: 600 });
    expect(r.placements.get('b')).toMatchObject({ w: 0 });
  });

  it('draws no track seam beside a collapsed column', () => {
    const items = [at('a', 0, 0), at('b', 1, 0, shut()), at('c', 2, 0)];
    const r = run(items, { resizable: true, tracks: { cols: [100, 100, { share: 1 }] } });
    expect(r.affordances.filter((a) => a.id.startsWith('track-'))).toEqual([]);
    const open = run([at('a', 0, 0), at('b', 1, 0), at('c', 2, 0)], {
      resizable: true,
      tracks: { cols: [100, 100, { share: 1 }] },
    });
    expect(open.affordances.filter((a) => a.id.startsWith('track-'))).toHaveLength(2);
  });

  it('is the layout it always was when nothing is collapsed', () => {
    const items = [at('a', 0, 0), at('b', 1, 0)];
    expect(run(items, { cols: 2, gap: 10 }).placements.get('b')).toEqual({
      x: 305,
      y: 0,
      z: 0,
      w: 295,
      h: 400,
    });
  });
});
