import { describe, expect, it } from 'vitest';
import { gridStrategy } from './layout/grid.js';
import { stackStrategy } from './layout/stack.js';
import { stripStrategy } from './layout/strip.js';
import type { LayoutItem, LayoutResult, Rect } from './layout-types.js';

const items: LayoutItem[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const container = { w: 300, h: 200 };

/** Every rect a result carries, placements and affordance boxes alike. */
function rectsOf(result: LayoutResult<string>): Rect[] {
  return [...result.placements.values(), ...result.affordances.map((a) => a.rect)];
}

describe('every shipped strategy emits z', () => {
  const cases: [string, () => LayoutResult<string>][] = [
    ['grid', () => gridStrategy.layout({ items, container, state: undefined, options: { resizable: true } })],
    ['strip', () => stripStrategy.layout({ items, container, state: undefined as never, options: { axis: 'x', resizable: true } })],
    ['stack', () => stackStrategy.layout({ items, container, state: undefined, options: {} })],
  ];

  for (const [name, run] of cases) {
    it(`${name} sets z on every rect, so a read site needs no ?? 0`, () => {
      const rects = rectsOf(run());
      expect(rects.length).toBeGreaterThan(0);
      for (const r of rects) expect(r.z).toBe(0);
    });
  }

  it('emits affordance rects too, not just placements', () => {
    const result = stripStrategy.layout({
      items,
      container,
      state: undefined as never,
      options: { axis: 'x', resizable: true },
    });
    expect(result.affordances.length).toBeGreaterThan(0);
    for (const a of result.affordances) expect(a.rect.z).toBe(0);
  });

  it('is 0 rather than absent — a 2D layout genuinely sits at depth zero', () => {
    const r = stackStrategy.layout({ items, container, state: undefined, options: {} });
    const placed = r.placements.get('a')!;
    expect('z' in placed).toBe(true);
    expect(placed.z).not.toBeUndefined();
  });
});
