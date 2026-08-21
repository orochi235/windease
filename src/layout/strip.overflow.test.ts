import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const run = (items: unknown[], container = { w: 200, h: 300 }) =>
  stripStrategy.layout({
    items: items as LayoutItem[],
    container,
    state: undefined as void,
    options: { axis: 'y', fill: true },
  });

describe('stripStrategy overflow signal', () => {
  it('is absent when the content fits', () => {
    const r = run([{ id: 'a', placement: { size: { h: 100 } } }, { id: 'b' }]);
    expect(r.overflow).toBeUndefined();
  });

  it('reports the excess when minimums exceed the extent', () => {
    // Three panes each demanding 150 in a 300px column: 450 needed, 150 over.
    const r = run([
      { id: 'a', hints: { minSize: { w: 0, h: 150 } } },
      { id: 'b', hints: { minSize: { w: 0, h: 150 } } },
      { id: 'c', hints: { minSize: { w: 0, h: 150 } } },
    ]);
    expect(r.overflow?.h).toBe(150);
    expect(r.overflow?.w).toBe(0);
  });

  it('reports excess from an explicit size held at its floor', () => {
    // The collapsed-pane case inverted: `a` is pinned at 40 by its own floor
    // while `b` demands 300, in a 300px column.
    const r = run([
      { id: 'a', placement: { size: { h: 80 } }, hints: { minSize: { w: 0, h: 40 } } },
      { id: 'b', hints: { minSize: { w: 0, h: 300 } } },
    ]);
    expect(r.overflow?.h).toBeGreaterThan(0);
  });

  it('squeezes rather than overflowing when the panes allow it', () => {
    // Explicit 150+150 in a 300px column with gap and padding does not fit,
    // but neither pane declares a floor, so scaling them down is correct and
    // there is nothing to report.
    const r = stripStrategy.layout({
      items: [
        { id: 'a', placement: { size: { h: 150 } } },
        { id: 'b', placement: { size: { h: 150 } } },
      ] as LayoutItem[],
      container: { w: 200, h: 300 },
      state: undefined as void,
      options: { axis: 'y', fill: true, gap: 20, padding: 10 },
    });
    expect(r.overflow).toBeUndefined();
  });

  it('counts gaps and padding toward the overflow once floors bind', () => {
    const r = stripStrategy.layout({
      items: [
        { id: 'a', placement: { size: { h: 150 } }, hints: { minSize: { w: 0, h: 150 } } },
        { id: 'b', placement: { size: { h: 150 } }, hints: { minSize: { w: 0, h: 150 } } },
      ] as LayoutItem[],
      container: { w: 200, h: 300 },
      state: undefined as void,
      options: { axis: 'y', fill: true, gap: 20, padding: 10 },
    });
    // Neither pane can go below 150, so the 20px gap and 2x10 padding overflow.
    expect(r.overflow?.h).toBe(40);
  });
});
