import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { gridStrategy } from './grid.js';

function items(n: number, min?: { w: number; h: number }): LayoutItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    ...(min ? { hints: { minSize: min } } : {}),
  })) as LayoutItem[];
}

const run = (its: LayoutItem[], options: Record<string, unknown>, w = 100, h = 100) =>
  gridStrategy.layout({
    items: its,
    container: { w, h },
    state: undefined as never,
    options,
  });

describe('gridStrategy — overflowMode', () => {
  it('squeezes past the floors by default, reporting nothing', () => {
    const out = run(items(2, { w: 0, h: 80 }), { cols: 1 });
    expect(out.overflow).toBeUndefined();
    expect(out.placements.get('p1')?.h).toBe(50);
  });

  it('scroll holds the cells at their floor and reports the excess', () => {
    const out = run(items(2, { w: 0, h: 80 }), { cols: 1, overflowMode: 'scroll' });
    expect(out.placements.get('p0')?.h).toBe(80);
    expect(out.placements.get('p1')?.h).toBe(80);
    expect(out.overflow).toEqual({ w: 0, h: 60 });
    expect(out.unplaced ?? []).toEqual([]);
  });

  it('scroll reports nothing when the floors fit', () => {
    const out = run(items(2, { w: 0, h: 40 }), { cols: 1, overflowMode: 'scroll' });
    expect(out.overflow).toBeUndefined();
  });

  it('unplace keeps the rows that fit and sends the rest away', () => {
    const out = run(items(2, { w: 0, h: 80 }), { cols: 1, overflowMode: 'unplaced' });
    expect(out.unplaced).toEqual(['p1']);
    expect(out.placements.has('p0')).toBe(true);
    expect(out.overflow).toBeUndefined();
  });

  it('unplace places the first row even when it does not fit', () => {
    const out = run(items(3, { w: 0, h: 500 }), { cols: 1, overflowMode: 'unplaced' });
    expect(out.placements.has('p0')).toBe(true);
    expect(out.unplaced).toEqual(['p1', 'p2']);
  });

  it('unplace still reports width overflow, which dropping rows cannot fix', () => {
    const out = run(items(2, { w: 80, h: 0 }), { cols: 2, overflowMode: 'unplaced' });
    expect(out.overflow?.w).toBe(60);
  });

  it('reports nothing when no item states a floor', () => {
    for (const overflowMode of ['squeeze', 'scroll', 'unplaced']) {
      expect(run(items(4), { cols: 2, overflowMode }).overflow).toBeUndefined();
    }
  });

  it('accounts for gap in the excess', () => {
    const out = run(items(2, { w: 0, h: 80 }), { cols: 1, overflowMode: 'scroll', gap: 10 });
    // two 80px rows plus one 10px gap against a 100px box
    expect(out.overflow).toEqual({ w: 0, h: 70 });
  });

  it('composes with maxItems, which caps by count instead', () => {
    const out = run(items(4, { w: 0, h: 80 }), {
      cols: 1,
      maxItems: 2,
      overflowMode: 'unplaced',
    });
    expect(out.unplaced).toContain('p2');
    expect(out.unplaced).toContain('p3');
  });
});
