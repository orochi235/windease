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
    expect(r.placements.get('b')).toMatchObject({ x: 10, y: -58 });
  });

  it('keeps its wanted spot, drawn above, when no free spot is within drift', () => {
    const r = run([at('a', 0, 0), at('b', 10, 0)], { gap: 8, drift: 20 });
    expect(r.placements.get('b')).toEqual({ x: 10, y: 0, z: 2, w: 100, h: 50 });
  });

  it('steps around two items at once', () => {
    const r = run([at('a', 0, 0), at('b', 0, 58), at('c', 0, 0)], { gap: 8 });
    const c = r.placements.get('c');
    expect(c).toBeDefined();
    for (const id of ['a', 'b']) {
      const o = r.placements.get(id)!;
      const apart =
        c!.x >= o.x + o.w + 8 ||
        o.x >= c!.x + c!.w + 8 ||
        c!.y >= o.y + o.h + 8 ||
        o.y >= c!.y + c!.h + 8;
      expect(apart).toBe(true);
    }
  });

  it('gives the same rects for the same items', () => {
    const items = [at('a', 0, 0), at('b', 10, 5), at('c', 20, 10)];
    expect(run(items, { gap: 8 }).placements).toEqual(run(items, { gap: 8 }).placements);
  });

  it('reports an item with no position or no size as unplaced', () => {
    const r = run([
      { id: 'a', natural: { w: 10, h: 10 } },
      { id: 'b', meta: { x: 0, y: 0 } },
    ]);
    expect(r.unplaced).toEqual(['a', 'b']);
    expect(r.placements.size).toBe(0);
  });

  it('declares its config keys so a typo is reported, not silently defaulted', () => {
    expect(Object.keys(repelStrategy.configSpec ?? {})).toEqual(['gap', 'drift']);
  });
});
