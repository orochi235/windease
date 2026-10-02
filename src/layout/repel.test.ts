import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { repelStrategy } from './repel.js';

const at = (id: string, x: number, y: number, w = 100, h = 50): LayoutItem => ({
  id,
  natural: { w, h },
  meta: { x, y },
});
const run = (items: LayoutItem[], options: Record<string, unknown> = {}) =>
  repelStrategy.layout({ items, container: { w: 1000, h: 1000 }, state: undefined, options });

describe('repelStrategy', () => {
  it('leaves items that do not overlap where they want to be, later ones nearer', () => {
    const r = run([at('a', 0, 0), at('b', 300, 0)]);
    expect(r.placements.get('a')).toEqual({ x: 0, y: 0, z: 1, w: 100, h: 50 });
    expect(r.placements.get('b')).toEqual({ x: 300, y: 0, z: 2, w: 100, h: 50 });
  });

  it('moves an overlapping item to the nearest free spot, gap off the one in its way', () => {
    // From (10, 0): 98 to the right, 118 to the left, 58 above or below. Above comes first.
    const r = run([at('a', 0, 0), at('b', 10, 0)], { gap: 8 });
    expect(r.placements.get('b')).toEqual({ x: 10, y: -58, z: 2, w: 100, h: 50 });
  });

  it('steps around two items at once', () => {
    const r = run([at('a', 0, 0), at('b', 0, 58), at('c', 0, 0)], { gap: 8 });
    expect(r.placements.get('b')).toEqual({ x: 0, y: 58, z: 2, w: 100, h: 50 });
    expect(r.placements.get('c')).toEqual({ x: 0, y: -58, z: 3, w: 100, h: 50 });
  });

  it('takes x from one item and y from another when that spot is nearest', () => {
    const r = run(
      [at('a', 100, 100, 100, 100), at('b', 250, 0, 100, 100), at('c', 150, 50, 100, 100)],
      {
        gap: 8,
      },
    );
    // Left of b (250 - 8 - 100) and above a (100 - 8 - 100).
    expect(r.placements.get('c')).toEqual({ x: 142, y: -8, z: 3, w: 100, h: 100 });
  });

  it('moves an item whose nearest spot is exactly drift away, and keeps one just past it', () => {
    const items = [at('a', 0, 0), at('b', 10, 0)];
    expect(run(items, { gap: 8, drift: 58 }).placements.get('b')).toMatchObject({ x: 10, y: -58 });
    expect(run(items, { gap: 8, drift: 57.9 }).placements.get('b')).toEqual({
      x: 10,
      y: 0,
      z: 2,
      w: 100,
      h: 50,
    });
  });

  it('makes a later item avoid one that gave up', () => {
    // b cannot clear a within 20 and overlaps it. c's nearest spot to a alone is 108, but b is there.
    const r = run([at('a', 0, 0), at('b', 10, 0), at('c', 100, 0)], { gap: 8, drift: 20 });
    expect(r.placements.get('b')).toMatchObject({ x: 10, y: 0 });
    expect(r.placements.get('c')).toEqual({ x: 118, y: 0, z: 3, w: 100, h: 50 });
  });

  it('sizes an item from hints.preferredSize when it has no natural size', () => {
    const r = run([{ id: 'a', hints: { preferredSize: { w: 30, h: 20 } }, meta: { x: 5, y: 6 } }]);
    expect(r.placements.get('a')).toEqual({ x: 5, y: 6, z: 1, w: 30, h: 20 });
  });

  it('sizes an item from placement.size ahead of its natural size', () => {
    const item: LayoutItem = { ...at('a', 0, 0), placement: { size: { w: 40, h: 30 } } };
    expect(run([item]).placements.get('a')).toMatchObject({ w: 40, h: 30 });
  });

  it('leaves items exactly gap apart where they are', () => {
    const r = run([at('a', 0, 0), at('b', 108, 0)], { gap: 8 });
    expect(r.placements.get('b')).toMatchObject({ x: 108, y: 0 });
  });

  it('does not let rounding turn a spot gap away into an overlap', () => {
    const r = run([at('a', 0, 0), at('b', 100.1, 0)], { gap: 0.1 });
    expect(r.placements.get('b')).toMatchObject({ x: 100.1, y: 0 });
  });

  it('gives an unplaced item no z, so later items stay nearer in order', () => {
    const r = run([at('a', 0, 0), { id: 'x', meta: { x: 0, y: 0 } }, at('b', 300, 0)]);
    expect(r.unplaced).toEqual(['x']);
    expect([r.placements.get('a')?.z, r.placements.get('b')?.z]).toEqual([1, 2]);
  });

  it('reports an item with no position or no size as unplaced', () => {
    const r = run([
      { id: 'a', natural: { w: 10, h: 10 } },
      { id: 'b', meta: { x: 0, y: 0 } },
    ]);
    expect(r.unplaced).toEqual(['a', 'b']);
    expect(r.placements.size).toBe(0);
  });

  it('reads an invalid gap as the default and an invalid drift as unbounded', () => {
    const items = [at('a', 0, 0), at('b', 10, 0)];
    const want = run(items).placements;
    expect(run(items, { gap: -5, drift: -1 }).placements).toEqual(want);
    expect(run(items, { gap: Number.NaN, drift: Number.NaN }).placements).toEqual(want);
    expect(run(items, { gap: 'wide' }).placements).toEqual(want);
  });

  it('declares its config keys so a typo is reported, not silently defaulted', () => {
    expect(Object.keys(repelStrategy.configSpec ?? {})).toEqual(['gap', 'drift']);
  });
});
