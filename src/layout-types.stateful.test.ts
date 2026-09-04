import { describe, expect, it } from 'vitest';
import type { LayoutItem, StatefulLayoutStrategy } from './layout-types.js';

interface Ratios {
  ratios: number[];
}

const ratioStrategy: StatefulLayoutStrategy<Ratios> = {
  name: 'ratio',
  initialState: (items: LayoutItem[]) => ({ ratios: items.map(() => 1 / items.length) }),
  layout: ({ items, state }) => ({
    placements: new Map(
      items.map((item, i) => [
        item.id,
        { x: 0, y: 0, z: 0, w: (state.ratios[i] ?? 0) * 100, h: 10 },
      ]),
    ),
    affordances: [],
  }),
};

describe('StatefulLayoutStrategy', () => {
  it('feeds its own initialState straight into layout without narrowing', () => {
    const items: LayoutItem[] = [{ id: 'a' }, { id: 'b' }];
    const state = ratioStrategy.initialState(items);
    const result = ratioStrategy.layout({
      items,
      container: { w: 100, h: 10 },
      state,
      options: {},
    });
    expect(result.placements.get('a')?.w).toBe(50);
  });
});
