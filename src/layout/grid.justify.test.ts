import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import type { LayoutItem } from '../layout-types.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { checkStrategyConfig } from './config-check.js';
import { gridStrategy } from './grid.js';

const ids = (n: number): LayoutItem[] => Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));

const run = (items: LayoutItem[], options: Record<string, unknown>, w = 400, h = 400) =>
  gridStrategy.layout({ items, container: { w, h }, state: undefined as void, options });

const xs = (items: LayoutItem[], options: Record<string, unknown>, w = 400) => {
  const r = run(items, options, w);
  return items.map((it) => r.placements.get(it.id)?.x);
};

/** Four 64px cells and three 8px gaps take 280 of 400px, leaving 120. */
const DOCK = { cell: { w: 64, h: 48 }, gap: 8, cols: 4 };

describe('gridStrategy — justify', () => {
  it('start (the default) keeps the columns at the left', () => {
    expect(xs(ids(4), DOCK)).toEqual([0, 72, 144, 216]);
    expect(xs(ids(4), { ...DOCK, justify: 'start' })).toEqual([0, 72, 144, 216]);
  });

  it('center splits the leftover either side', () => {
    expect(xs(ids(4), { ...DOCK, justify: 'center' })).toEqual([60, 132, 204, 276]);
  });

  it('end puts the leftover before the first column', () => {
    expect(xs(ids(4), { ...DOCK, justify: 'end' })).toEqual([120, 192, 264, 336]);
  });

  it('between spreads it between columns, flush with both edges', () => {
    expect(xs(ids(4), { ...DOCK, justify: 'between' })).toEqual([0, 112, 224, 336]);
  });

  it('evenly makes every space the same, edges included', () => {
    expect(xs(ids(4), { ...DOCK, justify: 'evenly' })).toEqual([24, 120, 216, 312]);
  });

  it('measures from inside the padding', () => {
    // 320px usable, 280 occupied: 40 left, 20 each side.
    expect(xs(ids(4), { ...DOCK, padding: 40, justify: 'center' }, 400)).toEqual([
      60, 132, 204, 276,
    ]);
  });

  it('moves whole columns, so a short last row stays aligned under the first', () => {
    const r = run(ids(6), { ...DOCK, justify: 'evenly' });
    expect(r.placements.get('i4')?.x).toBe(r.placements.get('i0')?.x);
    expect(r.placements.get('i5')?.x).toBe(r.placements.get('i1')?.x);
  });

  it('counts only the columns items reach: trailing empty ones are leftover', () => {
    // cols 4 with two items: 100px cells, two of them empty.
    expect(xs(ids(2), { cols: 4, justify: 'end' })).toEqual([200, 300]);
  });

  it('spreads the occupied columns of a fill: false grid', () => {
    // A 6-wide page holding 4: 100px cells, 200px of empty columns.
    const options = { maxCols: 6, maxRows: 1, fill: false, justify: 'center' };
    expect(xs(ids(4), options, 600)).toEqual([100, 200, 300, 400]);
  });

  it('does nothing when the columns already fill the container', () => {
    expect(xs(ids(4), { justify: 'evenly' })).toEqual([0, 200, 0, 200]);
  });

  it('counts a cell past the flow as occupying its column', () => {
    const items: LayoutItem[] = [{ id: 'a' }, { id: 'b', placement: { cell: { col: 3, row: 0 } } }];
    expect(xs(items, { ...DOCK, justify: 'center' })).toEqual([60, 276]);
  });

  it('between with one column leaves it at the start', () => {
    expect(xs(ids(1), { ...DOCK, justify: 'between' })).toEqual([0]);
  });

  it('leaves content that overflows the container at the start', () => {
    const r = run(ids(8), { ...DOCK, cols: 8, justify: 'center' });
    expect(r.placements.get('i0')?.x).toBe(0);
    expect(r.overflow?.w).toBe(168);
  });

  it('widens a span by the extra space between the columns it covers', () => {
    const items: LayoutItem[] = [{ id: 'a', placement: { span: { cols: 2 } } }, ...ids(2)];
    const r = run(items, { ...DOCK, justify: 'between' });
    expect(r.placements.get('a')).toMatchObject({ x: 0, w: 64 + 8 + 40 + 64 });
    expect(r.placements.get('i1')?.x).toBe(336);
  });

  it('leaves the vertical axis alone', () => {
    const r = run(ids(4), { ...DOCK, justify: 'evenly' });
    expect(r.placements.get('i0')?.y).toBe(0);
  });

  it('resolves a seam drag against the justified columns', () => {
    const opts = { ...DOCK, justify: 'between', resizable: true, maxRows: 1 };
    const items = ids(2);
    const s = new Store();
    const z = asNodeId('z');
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'grid', config: opts }, id: z }),
    );
    for (const it of items) {
      s.registerNode(createNode({ kind: 'panel', id: asNodeId(it.id), parentId: z }));
    }
    // Two items occupy two columns: 128 + 8 of 400, so 264 extra between them.
    const affordance = run(items, opts).affordances.find((a) => a.id === 'resize-x-i0');
    if (!affordance) throw new Error('no seam');
    gridStrategy.dispatchAffordance?.({
      event: { affordanceId: affordance.id, kind: 'drag', payload: { point: { x: 300, y: 10 } } },
      affordance,
      store: s,
      parentId: z,
      container: { w: 400, h: 400 },
      options: opts,
      items,
    });
    // Stride 64 + 8 + 264 = 336, so 300px reaches the second column.
    expect(s.getPlacement(asNodeId('i0')).span).toEqual({ cols: 2 });
  });

  it('is a declared config key with a closed set of values', () => {
    const spec = gridStrategy.configSpec;
    if (!spec) throw new Error('no spec');
    expect(checkStrategyConfig('grid', { justify: 'evenly' }, spec)).toEqual([]);
    expect(checkStrategyConfig('grid', { justify: 'around' }, spec)).toHaveLength(1);
  });
});
