import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

/** A content-sized pane: declares the axis, and optionally carries the
 *  measurement an adapter would have supplied. */
const content = (
  id: string,
  h?: number,
  extra?: Partial<Pick<LayoutItem, 'hints' | 'placement'>>,
): LayoutItem => ({
  id,
  hints: { sizing: { h: 'content' }, ...(extra?.hints ?? {}) },
  ...(h !== undefined ? { natural: { w: 0, h } } : {}),
  ...(extra?.placement ? { placement: extra.placement } : {}),
});

const layoutY = (items: LayoutItem[], h = 400, options: Record<string, unknown> = {}) =>
  stripStrategy.layout({
    items,
    container: { w: 200, h },
    state: undefined as void,
    options: { axis: 'y', ...options },
  });

describe('stripStrategy content-driven sizing', () => {
  it('sizes a pane to its measured content', () => {
    const r = layoutY([content('a', 120), content('b', 80)]);
    expect(r.placements.get('a')?.h).toBe(120);
    expect(r.placements.get('b')?.h).toBe(80);
  });

  it('prefers a measured size over preferredSize', () => {
    const r = layoutY([
      content('a', 120, { hints: { preferredSize: { w: 0, h: 300 } } }),
      content('b', 80),
    ]);
    expect(r.placements.get('a')?.h).toBe(120);
  });

  it('yields to an explicit placement size', () => {
    const r = layoutY([content('a', 120, { placement: { size: { h: 55 } } }), content('b', 80)]);
    expect(r.placements.get('a')?.h).toBe(55);
  });

  it('clamps a measured size to minSize and maxSize', () => {
    const r = layoutY([
      content('a', 10, { hints: { minSize: { w: 0, h: 60 } } }),
      content('b', 900, { hints: { maxSize: { w: 0, h: 100 } } }),
    ]);
    expect(r.placements.get('a')?.h).toBe(60);
    expect(r.placements.get('b')?.h).toBe(100);
  });

  it('leaves the remainder to a flex sibling', () => {
    const r = layoutY([content('a', 120), { id: 'b' }], 400, { fill: true });
    expect(r.placements.get('a')?.h).toBe(120);
    expect(r.placements.get('b')?.h).toBe(280);
  });

  it('falls back before any measurement arrives', () => {
    // The first pass always runs without a measurement. A pane that collapses
    // to zero here flashes on screen before the second pass corrects it.
    const r = layoutY([
      content('a', undefined, { hints: { preferredSize: { w: 0, h: 90 } } }),
      content('b', undefined, { hints: { minSize: { w: 0, h: 70 } } }),
    ]);
    expect(r.placements.get('a')?.h).toBe(90);
    expect(r.placements.get('b')?.h).toBe(70);
  });

  it('ignores a measurement on the axis it does not size', () => {
    const r = stripStrategy.layout({
      items: [content('a', 120), content('b', 80)],
      container: { w: 200, h: 400 },
      state: undefined as void,
      options: { axis: 'x', fill: true },
    });
    // `sizing.h` is inert in a horizontal strip: both share the main axis.
    expect(r.placements.get('a')?.w).toBe(100);
    expect(r.placements.get('b')?.w).toBe(100);
  });

  it('ignores a measurement the item never asked for', () => {
    const r = layoutY([{ id: 'a', natural: { w: 0, h: 120 } }, content('b', 80)], 400, {
      fill: true,
    });
    expect(r.placements.get('a')?.h).toBe(320);
  });

  it('squeezes measured sizes under pressure, like any other stated size', () => {
    const r = layoutY([content('a', 300), content('b', 300)], 400);
    expect(r.placements.get('a')?.h).toBe(200);
    expect(r.overflow).toBeUndefined();
  });

  it('reports overflow once minimums stop the squeeze', () => {
    const floor = { minSize: { w: 0, h: 300 } };
    const r = layoutY(
      [content('a', 300, { hints: floor }), content('b', 300, { hints: floor })],
      400,
    );
    expect(r.placements.get('a')?.h).toBe(300);
    expect(r.overflow).toEqual({ w: 0, h: 200 });
  });
});
