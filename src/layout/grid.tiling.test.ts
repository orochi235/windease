import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { gridStrategy, gridTiling } from './grid.js';

function units(n: number): LayoutItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));
}

/** Column and row origins the strategy actually placed into, which is what
 *  `gridTiling` claims to predict without laying anything out. */
function placedTracks(items: LayoutItem[], options: Record<string, unknown>) {
  const { placements } = gridStrategy.layout({
    items,
    container: { w: 900, h: 600 },
    state: undefined,
    options,
  });
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const rect of placements.values()) {
    xs.add(Math.round(rect.x));
    ys.add(Math.round(rect.y));
  }
  return { cols: xs.size, rows: ys.size };
}

describe('gridTiling', () => {
  it('reports the tiling with no container at all', () => {
    expect(gridTiling(units(6), { cols: 3 })).toEqual({ cols: 3, rows: 2 });
  });

  it('tiles an empty grid to nothing, so a content-sized host gets zero height', () => {
    expect(gridTiling([], { cols: 3 })).toEqual({ cols: 0, rows: 0 });
  });

  it('auto-balances toward a square when neither dimension is set', () => {
    expect(gridTiling(units(9), {})).toEqual({ cols: 3, rows: 3 });
  });

  it('honors the orientation bias on an imperfect square', () => {
    expect(gridTiling(units(5), { orientation: 'wide' }).cols).toBe(3);
    expect(gridTiling(units(5), { orientation: 'tall' }).cols).toBe(2);
  });

  it('caps columns with maxCols and grows rows instead', () => {
    expect(gridTiling(units(9), { maxCols: 2 })).toEqual({ cols: 2, rows: 5 });
  });

  it('counts the rows a span forces rather than the item count', () => {
    const items: LayoutItem[] = [
      { id: 'wide', placement: { span: { cols: 2 } } },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
    ];
    expect(gridTiling(items, { cols: 3 })).toEqual({ cols: 3, rows: 2 });
  });

  it('drops what the item cap excludes from the row count', () => {
    expect(gridTiling(units(9), { cols: 3, maxItems: 4 })).toEqual({ cols: 3, rows: 2 });
  });

  it('refuses a config layout would refuse, rather than reporting a tiling for it', () => {
    expect(() => gridTiling(units(4), { maxItems: 4, maxCols: 2 })).toThrow(/mutually exclusive/);
  });

  it('defaults its options, so a bare call still answers', () => {
    expect(gridTiling(units(4))).toEqual({ cols: 2, rows: 2 });
  });
});

/** The counts are only worth having if they match the pass that places cells.
 *  These are the cases where the two could drift apart. */
describe('gridTiling agrees with layout', () => {
  const cases: Array<[string, number, Record<string, unknown>]> = [
    ['auto-balanced', 7, {}],
    ['fixed columns', 7, { cols: 4 }],
    ['fixed rows', 7, { rows: 2 }],
    ['capped columns', 7, { maxCols: 3 }],
    ['tall bias', 8, { orientation: 'tall' }],
    ['single column', 5, { cols: 1 }],
    ['one item', 1, {}],
  ];

  for (const [name, count, options] of cases) {
    it(`matches the placed tracks — ${name}`, () => {
      const items = units(count);
      expect(gridTiling(items, options)).toEqual(placedTracks(items, options));
    });
  }
});
