import { describe, expect, it } from 'vitest';
import { gridStrategy } from './grid.js';

const mkItem = (id: string) => ({ id: id });

describe('gridStrategy', () => {
  it('lays out items in a grid with cols, gap, padding', () => {
    const result = gridStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c'), mkItem('d')],
      container: { w: 410, h: 410 },
      state: undefined as void,
      options: { cols: 2, gap: 10, padding: 20 },
    });
    expect(result.placements.get('a')).toEqual({ x: 20, y: 20, w: 180, h: 180 });
    expect(result.placements.get('b')).toEqual({ x: 210, y: 20, w: 180, h: 180 });
    expect(result.placements.get('c')).toEqual({ x: 20, y: 210, w: 180, h: 180 });
    expect(result.placements.get('d')).toEqual({ x: 210, y: 210, w: 180, h: 180 });
    expect(result.affordances).toEqual([]);
  });

  it('single item fills the container with default options', () => {
    const result = gridStrategy.layout({
      items: [mkItem('a')],
      container: { w: 100, h: 80 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it('auto-balances cols to stay as square as possible (wide bias)', () => {
    // 3 items: ceil(sqrt(3)) = 2 cols, ceil(3/2) = 2 rows
    const r3 = gridStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c')],
      container: { w: 200, h: 200 },
      state: undefined as void,
      options: {},
    });
    expect(r3.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(r3.placements.get('b')).toEqual({ x: 100, y: 0, w: 100, h: 100 });
    expect(r3.placements.get('c')).toEqual({ x: 0, y: 100, w: 100, h: 100 });

    // 7 items: ceil(sqrt(7)) = 3 cols, ceil(7/3) = 3 rows — adds a col before a row
    const r7 = gridStrategy.layout({
      items: Array.from({ length: 7 }, (_, i) => mkItem(`p${i}`)),
      container: { w: 300, h: 300 },
      state: undefined as void,
      options: {},
    });
    expect(r7.placements.get('p6')).toEqual({ x: 0, y: 200, w: 100, h: 100 });
  });

  it('tall orientation biases toward more rows', () => {
    // 3 items, tall: floor(sqrt(3)) = 1 col, 3 rows
    const result = gridStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c')],
      container: { w: 100, h: 300 },
      state: undefined as void,
      options: { orientation: 'tall' },
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(result.placements.get('b')).toEqual({ x: 0, y: 100, w: 100, h: 100 });
    expect(result.placements.get('c')).toEqual({ x: 0, y: 200, w: 100, h: 100 });
  });

  it('rows option derives cols from item count', () => {
    // 5 items in 2 rows → ceil(5/2) = 3 cols
    const result = gridStrategy.layout({
      items: Array.from({ length: 5 }, (_, i) => mkItem(`p${i}`)),
      container: { w: 300, h: 200 },
      state: undefined as void,
      options: { rows: 2 },
    });
    expect(result.placements.get('p0')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(result.placements.get('p4')).toEqual({ x: 100, y: 100, w: 100, h: 100 });
  });

  it('returns empty for empty items', () => {
    const result = gridStrategy.layout({
      items: [],
      container: { w: 100, h: 100 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.size).toBe(0);
    expect(result.affordances).toEqual([]);
    expect(result.unplaced).toBeUndefined();
  });

  it('omits unplaced field when everything fits', () => {
    const result = gridStrategy.layout({
      items: [mkItem('a'), mkItem('b')],
      container: { w: 200, h: 100 },
      state: undefined as void,
      options: { cols: 2 },
    });
    expect(result.unplaced).toBeUndefined();
  });

  describe('maxCols / maxRows', () => {
    it('maxCols caps auto-balanced cols, rows grow unbounded', () => {
      // 10 items: ideal cols = ceil(sqrt(10)) = 4, but capped at 2 → 5 rows
      const result = gridStrategy.layout({
        items: Array.from({ length: 10 }, (_, i) => mkItem(`p${i}`)),
        container: { w: 200, h: 500 },
        state: undefined as void,
        options: { maxCols: 2 },
      });
      expect(result.placements.size).toBe(10);
      expect(result.unplaced).toBeUndefined();
      // 2 cols × 5 rows, cell 100×100
      expect(result.placements.get('p0')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
      expect(result.placements.get('p9')).toEqual({ x: 100, y: 400, w: 100, h: 100 });
    });

    it('maxCols does not constrain when ideal cols is below the cap', () => {
      // 4 items: ideal ceil(sqrt(4)) = 2; maxCols=5 should not interfere
      const result = gridStrategy.layout({
        items: [mkItem('a'), mkItem('b'), mkItem('c'), mkItem('d')],
        container: { w: 200, h: 200 },
        state: undefined as void,
        options: { maxCols: 5 },
      });
      expect(result.placements.get('d')).toEqual({ x: 100, y: 100, w: 100, h: 100 });
    });

    it('maxRows caps auto-balanced rows when used with tall orientation', () => {
      // 10 items tall: ideal cols = floor(sqrt(10)) = 3, rows = ceil(10/3) = 4
      // maxRows=4 fits exactly, no overflow
      const result = gridStrategy.layout({
        items: Array.from({ length: 10 }, (_, i) => mkItem(`p${i}`)),
        container: { w: 300, h: 400 },
        state: undefined as void,
        options: { orientation: 'tall', maxRows: 4 },
      });
      expect(result.placements.size).toBe(10);
      expect(result.unplaced).toBeUndefined();
    });

    it('overflows to unplaced when both maxCols and maxRows are set', () => {
      // capacity = 2 × 2 = 4; 6 items → 4 placed, 2 unplaced
      const result = gridStrategy.layout({
        items: Array.from({ length: 6 }, (_, i) => mkItem(`p${i}`)),
        container: { w: 200, h: 200 },
        state: undefined as void,
        options: { maxCols: 2, maxRows: 2 },
      });
      expect(result.placements.size).toBe(4);
      expect(result.unplaced).toEqual(['p4', 'p5']);
      // Cells are sized based on the placed (2×2) layout, not the full 6-item count
      expect(result.placements.get('p0')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
      expect(result.placements.get('p3')).toEqual({ x: 100, y: 100, w: 100, h: 100 });
    });

    it('explicit cols ignores maxCols but respects maxRows for overflow', () => {
      // cols=3 (explicit), maxRows=2 → capacity 6; 8 items → 2 unplaced
      const result = gridStrategy.layout({
        items: Array.from({ length: 8 }, (_, i) => mkItem(`p${i}`)),
        container: { w: 300, h: 200 },
        state: undefined as void,
        options: { cols: 3, maxCols: 1, maxRows: 2 },
      });
      expect(result.placements.size).toBe(6);
      expect(result.unplaced).toEqual(['p6', 'p7']);
    });

    it('explicit rows ignores maxRows but respects maxCols', () => {
      // rows=2 (explicit), 10 items, maxCols=3 → cols = min(3, ceil(10/2)=5) = 3,
      // capacity = 3*2 = 6, overflow = 4
      const result = gridStrategy.layout({
        items: Array.from({ length: 10 }, (_, i) => mkItem(`p${i}`)),
        container: { w: 300, h: 200 },
        state: undefined as void,
        options: { rows: 2, maxCols: 3, maxRows: 99 },
      });
      expect(result.placements.size).toBe(6);
      expect(result.unplaced).toHaveLength(4);
      expect(result.unplaced?.[0]).toBe('p6');
    });

    it('preserves item order in unplaced', () => {
      const result = gridStrategy.layout({
        items: [mkItem('first'), mkItem('a'), mkItem('b'), mkItem('c'), mkItem('last')],
        container: { w: 100, h: 100 },
        state: undefined as void,
        options: { maxCols: 1, maxRows: 1 },
      });
      expect(result.placements.size).toBe(1);
      expect(result.placements.has('first')).toBe(true);
      expect(result.unplaced).toEqual(['a', 'b', 'c', 'last']);
    });

    it('clamps maxCols and maxRows to at least 1', () => {
      const result = gridStrategy.layout({
        items: [mkItem('a'), mkItem('b'), mkItem('c')],
        container: { w: 100, h: 100 },
        state: undefined as void,
        options: { maxCols: 0, maxRows: -3 },
      });
      // Both treated as 1; capacity 1; 2 unplaced
      expect(result.placements.size).toBe(1);
      expect(result.unplaced).toEqual(['b', 'c']);
    });

    it('items fit exactly at capacity → no overflow', () => {
      const result = gridStrategy.layout({
        items: Array.from({ length: 4 }, (_, i) => mkItem(`p${i}`)),
        container: { w: 200, h: 200 },
        state: undefined as void,
        options: { maxCols: 2, maxRows: 2 },
      });
      expect(result.placements.size).toBe(4);
      expect(result.unplaced).toBeUndefined();
    });

    it('fill: false reserves the full maxCols/maxRows grid even when underfilled', () => {
      const result = gridStrategy.layout({
        items: [mkItem('a'), mkItem('b'), mkItem('c')],
        container: { w: 200, h: 200 },
        state: undefined as void,
        options: { maxCols: 2, maxRows: 2, fill: false },
      });
      // Each cell is 100×100, three items in (0,0)(1,0)(0,1), (1,1) empty.
      expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
      expect(result.placements.get('b')).toEqual({ x: 100, y: 0, w: 100, h: 100 });
      expect(result.placements.get('c')).toEqual({ x: 0, y: 100, w: 100, h: 100 });
    });

    it('fill: true (default) lets 2 items in a 2×2 max grid use a 2×1 layout filling the height', () => {
      const result = gridStrategy.layout({
        items: [mkItem('a'), mkItem('b')],
        container: { w: 200, h: 200 },
        state: undefined as void,
        options: { maxCols: 2, maxRows: 2 },
      });
      expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 200 });
      expect(result.placements.get('b')).toEqual({ x: 100, y: 0, w: 100, h: 200 });
    });

    it('maxItems caps placement count regardless of cols/rows auto-balance', () => {
      const result = gridStrategy.layout({
        items: Array.from({ length: 6 }, (_, i) => mkItem(`p${i}`)),
        container: { w: 200, h: 200 },
        state: undefined as void,
        options: { maxItems: 3 },
      });
      expect(result.placements.size).toBe(3);
      expect(result.unplaced).toEqual(['p3', 'p4', 'p5']);
    });

    it('canAccept honors maxItems independently of grid caps', () => {
      expect(
        gridStrategy.canAccept?.(
          Array.from({ length: 4 }, (_, i) => mkItem(`p${i}`)),
          { maxItems: 3 },
        ),
      ).toBe(false);
      expect(
        gridStrategy.canAccept?.(
          Array.from({ length: 3 }, (_, i) => mkItem(`p${i}`)),
          { maxItems: 3 },
        ),
      ).toBe(true);
    });

    it('maxItems combined with maxCols/maxRows throws', () => {
      expect(() =>
        gridStrategy.layout({
          items: [mkItem('a')],
          container: { w: 100, h: 100 },
          state: undefined as void,
          options: { maxItems: 4, maxCols: 2 },
        }),
      ).toThrow(/mutually exclusive/);
      expect(() => gridStrategy.canAccept?.([mkItem('a')], { maxItems: 4, maxRows: 2 })).toThrow(
        /mutually exclusive/,
      );
    });

    it('canAccept rejects prospective lists that would overflow capacity', () => {
      // 2×2 cap = 4 items; 5 is too many.
      expect(
        gridStrategy.canAccept?.(
          Array.from({ length: 5 }, (_, i) => mkItem(`p${i}`)),
          { maxCols: 2, maxRows: 2 },
        ),
      ).toBe(false);
      expect(
        gridStrategy.canAccept?.(
          Array.from({ length: 4 }, (_, i) => mkItem(`p${i}`)),
          { maxCols: 2, maxRows: 2 },
        ),
      ).toBe(true);
    });

    it('cell size reflects placed-count layout, not capacity', () => {
      // maxCols=2 maxRows=2 = cap 4, but only 2 items → 1 row 2 cols (auto-balance under cap)
      // Items fit in a 2×1 arrangement, not 2×2 with empty cells
      const result = gridStrategy.layout({
        items: [mkItem('a'), mkItem('b')],
        container: { w: 200, h: 100 },
        state: undefined as void,
        options: { maxCols: 2, maxRows: 2 },
      });
      expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
      expect(result.placements.get('b')).toEqual({ x: 100, y: 0, w: 100, h: 100 });
    });
  });
});

describe('gridStrategy — preview', () => {
  it('marks isPreview=true when preview is set on layout()', () => {
    const result = gridStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 300, h: 200 },
      state: undefined,
      options: { cols: 3 },
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 150, y: 100 } },
    });
    expect(result.isPreview).toBe(true);
    expect(result.placements.get('ghost')).toBeDefined();
  });

  it('getDropPreview returns placements that include the insertId', () => {
    const out = gridStrategy.getDropPreview!({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 200 },
      options: { cols: 2 },
      insertId: 'ghost',
      insertIndex: 1,
      cursor: { x: 100, y: 50 },
    });
    expect(out).not.toBeNull();
    expect(out!.accepted).toBe(true);
    expect(out!.placements.has('ghost')).toBe(true);
  });

  it('getDropPreview returns accepted=false when it would overflow maxItems', () => {
    const out = gridStrategy.getDropPreview!({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 200 },
      options: { maxItems: 2 },
      insertId: 'ghost',
      insertIndex: 2,
      cursor: { x: 100, y: 50 },
    });
    expect(out).not.toBeNull();
    expect(out!.accepted).toBe(false);
  });
});

describe('gridStrategy — placement.size is currently ignored', () => {
  it('child with placement.size still occupies a uniform cell', () => {
    const result = gridStrategy.layout({
      items: [{ id: 'a', placement: { size: { w: 999, h: 999 } } } as never, { id: 'b' }],
      container: { w: 200, h: 100 },
      state: undefined as void,
      options: { cols: 2 },
    });
    expect(result.placements.get('a')?.w).toBe(100);
    expect(result.placements.get('a')?.h).toBe(100);
    expect(result.placements.get('b')?.w).toBe(100);
  });
});
