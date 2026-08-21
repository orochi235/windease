import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const layout = (items: unknown[], container = { w: 200, h: 600 }) =>
  stripStrategy.layout({
    items: items as LayoutItem[],
    container,
    state: undefined as void,
    options: { axis: 'y', fill: true },
  });

const boundsOf = (items: unknown[], id: string, container?: { w: number; h: number }) =>
  layout(items, container).affordances.find((a) => a.childId === id)?.bounds;

describe('stripStrategy resize affordance bounds', () => {
  it("reports the rendered extent and the child's own min", () => {
    const b = boundsOf(
      [
        { id: 'a', placement: { size: { h: 200 } }, hints: { minSize: { w: 0, h: 80 } } },
        { id: 'b' },
      ],
      'a',
    );
    expect(b?.orientation).toBe('vertical');
    expect(b?.valueNow).toBe(200);
    expect(b?.valueMin).toBe(80);
    expect(b?.atMin).toBe(false);
  });

  it("caps valueMax at the ceiling siblings leave, not the child's own max", () => {
    // usable 600; b and c reserve 250 each, so a can reach 100 at most --
    // well under its own maxSize of 500.
    const b = boundsOf(
      [
        { id: 'a', placement: { size: { h: 90 } }, hints: { maxSize: { w: 0, h: 500 } } },
        { id: 'b', hints: { minSize: { w: 0, h: 250 } } },
        { id: 'c', hints: { minSize: { w: 0, h: 250 } } },
      ],
      'a',
    );
    expect(b?.valueMax).toBe(100);
  });

  it('sets atMax when the pane already fills the reachable range', () => {
    const b = boundsOf(
      [
        { id: 'a', placement: { size: { h: 100 } } },
        { id: 'b', hints: { minSize: { w: 0, h: 250 } } },
        { id: 'c', hints: { minSize: { w: 0, h: 250 } } },
      ],
      'a',
    );
    expect(b?.valueMax).toBe(100);
    expect(b?.atMax).toBe(true);
  });

  it('keeps valueMin at or below valueNow for a pane sized under its own min', () => {
    // A collapsed palette: 32px against a declared min of 120. Advertising a
    // floor of 120 while sitting at 32 would describe a range excluding the
    // current value.
    const b = boundsOf(
      [
        { id: 'a', placement: { size: { h: 32 } }, hints: { minSize: { w: 0, h: 120 } } },
        { id: 'b' },
      ],
      'a',
    );
    expect(b?.valueNow).toBe(32);
    expect(b?.valueMin).toBeLessThanOrEqual(32);
    expect(b?.atMin).toBe(true);
  });

  it('reports horizontal orientation on an x-axis strip', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a', placement: { size: { w: 100 } } }, { id: 'b' }] as LayoutItem[],
      container: { w: 600, h: 200 },
      state: undefined as void,
      options: { axis: 'x', fill: true },
    });
    expect(result.affordances.find((a) => a.childId === 'a')?.bounds?.orientation).toBe(
      'horizontal',
    );
  });
});
