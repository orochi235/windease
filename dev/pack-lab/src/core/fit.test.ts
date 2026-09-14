import { describe, expect, it } from 'vitest';
import { aspectScore, fitPacking, packAt } from './fit.js';
import { packerById } from './packers.js';
import type { Packing } from './types.js';

const box = (id: string, w: number, h: number) => ({ id, hints: { preferredSize: { w, h } } });
const six = Array.from({ length: 6 }, (_, i) => box(`b${i}`, 10, 10));

describe('packAt', () => {
  it('measures the bounds of what it placed, at the width it was given', () => {
    const p = packAt(packerById('shelf'), six, 30, {});
    expect(p.width).toBe(30);
    expect(p.bounds).toEqual({ w: 30, h: 20 });
    expect(p.unplaced).toEqual([]);
  });

  it('reports an item with no size as unplaced and leaves it out of the bounds', () => {
    const p = packAt(packerById('shelf'), [{ id: 'bare' }, box('a', 10, 10)], 100, {});
    expect(p.unplaced).toEqual(['bare']);
    expect(p.bounds).toEqual({ w: 10, h: 10 });
  });
});

describe('fitPacking', () => {
  it('packs at a fixed width as given', () => {
    const p = fitPacking(packerById('shelf'), six, { kind: 'width', width: 20 }, {});
    expect(p.bounds).toEqual({ w: 20, h: 30 });
  });

  it('keeps the width whose shape is closest to the ratio', () => {
    // Six 10×10 boxes: three to a row is 30×20, exactly 1.5.
    const p = fitPacking(packerById('shelf'), six, { kind: 'aspect', ratio: 1.5 }, {});
    expect(p.bounds).toEqual({ w: 30, h: 20 });
  });
});

describe('aspectScore', () => {
  const shaped = (w: number, h: number): Packing => ({
    placements: new Map(),
    unplaced: [],
    bounds: { w, h },
    width: w,
  });

  it('scores a wide miss and a tall miss by the same factor alike', () => {
    expect(aspectScore(shaped(40, 10), 1)).toBeCloseTo(aspectScore(shaped(10, 40), 1));
  });

  it('is infinite for an empty packing', () => {
    expect(aspectScore(shaped(0, 0), 1)).toBe(Number.POSITIVE_INFINITY);
  });
});
