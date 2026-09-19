import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '#windease/layout-types.js';
import { checkRecipe, pack } from './engine.js';
import { engineQueue } from './order.js';
import { RECIPES, recipeById } from './recipes.js';
import { carve } from './trackers/free.js';

const box = (id: string, w: number, h: number): LayoutItem => ({
  id,
  hints: { preferredSize: { w, h } },
});

describe('engineQueue', () => {
  it('orders by perimeter, largest first, ties in input order', () => {
    const items = [box('a', 2, 2), box('b', 1, 5), box('c', 3, 1), box('d', 4, 4)];
    expect(engineQueue(items, 'perimeter').map((e) => e.item.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it("orders 'height-width' by height, then width", () => {
    const items = [box('a', 2, 5), box('b', 4, 5), box('c', 9, 1)];
    expect(engineQueue(items, 'height-width').map((e) => e.item.id)).toEqual(['b', 'a', 'c']);
  });

  it('drops items with no usable size', () => {
    expect(engineQueue([box('a', 0, 3), { id: 'b' }, box('c', 1, 1)], 'none')).toHaveLength(1);
  });
});

describe('checkRecipe', () => {
  it('accepts every named recipe', () => {
    for (const recipe of RECIPES) expect(() => checkRecipe(recipe)).not.toThrow();
  });

  it('refuses a feature the tracker does not compute', () => {
    expect(() => checkRecipe({ id: 'r', tracker: 'rows', tiers: [{ waste: 1 }] })).toThrow(
      'the rows tracker does not compute',
    );
  });

  it('refuses an unknown tracker', () => {
    expect(() => checkRecipe({ id: 'r', tracker: 'nope', tiers: [] })).toThrow('no tracker "nope"');
  });
});

describe('pack', () => {
  it('breaks a tie in an earlier tier with a later one', () => {
    // Both spots on the empty outline sit at y 0; only `x` separates them, and it prefers the right.
    const recipe = { id: 'r', tracker: 'outline', tiers: [{ y: 1 }, { x: -1 }] };
    const items = [box('a', 10, 10), box('b', 10, 10)];
    const { placed } = pack(recipe, { items, container: { w: 40, h: 0 }, options: {} });
    expect(placed.get('b')).toMatchObject({ x: 10, y: 0 });
  });

  it('keeps an item where it was when drift outweighs the lower spot', () => {
    const items = [box('a', 10, 10), box('b', 10, 10)];
    const previous = new Map([['b', { x: 0, y: 10, z: 0, w: 10, h: 10 }]]);
    const container = { w: 20, h: 0 };
    const steady = pack(recipeById('skyline-steady'), { items, container, options: {}, previous });
    const plain = pack(recipeById('skyline'), { items, container, options: {}, previous });
    expect(plain.placed.get('b')).toMatchObject({ x: 10, y: 0 });
    expect(steady.placed.get('b')).toMatchObject({ x: 0, y: 10 });
  });

  it('fills a hole beside a tall item that an outline cannot reach', () => {
    // a is tall on the left, b spans the top right, c fits under b beside a.
    const items = [box('a', 10, 30), box('b', 20, 10), box('c', 20, 10)];
    const container = { w: 30, h: 0 };
    const { placed } = pack(recipeById('maxrects-bl'), { items, container, options: {} });
    expect(placed.get('c')).toMatchObject({ x: 10, y: 10 });
  });
});

describe('carve', () => {
  it('splits a free rect around a used one into its maximal pieces', () => {
    const pieces = carve([{ x: 0, y: 0, w: 10, h: 10 }], { x: 4, y: 4, w: 2, h: 2 });
    expect(pieces).toEqual([
      { x: 0, y: 0, w: 4, h: 10 },
      { x: 6, y: 0, w: 4, h: 10 },
      { x: 0, y: 0, w: 10, h: 4 },
      { x: 0, y: 6, w: 10, h: 4 },
    ]);
  });

  it('drops a piece that another free rect already covers', () => {
    const free = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: 4, h: 20 },
    ];
    const pieces = carve(free, { x: 4, y: 0, w: 6, h: 5 });
    expect(pieces).not.toContainEqual({ x: 0, y: 0, w: 4, h: 10 });
    expect(pieces).toContainEqual({ x: 0, y: 0, w: 4, h: 20 });
  });
});
