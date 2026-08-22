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

  describe('under resizeMode: neighbor', () => {
    const paired = (items: unknown[], id: string) =>
      stripStrategy
        .layout({
          items: items as LayoutItem[],
          container: { w: 200, h: 400 },
          state: undefined as void,
          options: { axis: 'y', resizeMode: 'neighbor' },
        })
        .affordances.find((a) => a.childId === id)?.bounds;

    it("stops at the neighbor's minimum, not at every sibling's", () => {
      // The pair conserves its total, so `a` can only take what `b` can give.
      // Reporting the whole row's slack here would publish an
      // `aria-valuemax` the drag refuses to reach.
      const b = paired(
        [
          { id: 'a', placement: { size: { h: 100 } }, hints: { minSize: { w: 0, h: 20 } } },
          { id: 'b', placement: { size: { h: 100 } }, hints: { minSize: { w: 0, h: 20 } } },
          { id: 'c', placement: { size: { h: 100 } }, hints: { minSize: { w: 0, h: 20 } } },
        ],
        'a',
      );
      expect(b?.valueMax).toBe(180);
    });

    it("floors at what the neighbor's maximum will absorb", () => {
      const b = paired(
        [
          { id: 'a', placement: { size: { h: 100 } } },
          { id: 'b', placement: { size: { h: 100 } }, hints: { maxSize: { w: 0, h: 150 } } },
        ],
        'a',
      );
      expect(b?.valueMin).toBe(50);
    });
  });
});
