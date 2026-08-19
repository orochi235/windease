import { describe, expect, it } from 'vitest';
import { insertionIndexByMidpoint } from './insertionIndex.js';

describe('insertionIndexByMidpoint', () => {
  it('returns 0 when cursor is before the first child', () => {
    const rects = [
      { top: 100, bottom: 200 },
      { top: 200, bottom: 300 },
    ];
    expect(insertionIndexByMidpoint(rects, 50, 'y')).toBe(0);
  });

  it('returns N when cursor is after the last child', () => {
    const rects = [
      { top: 0, bottom: 100 },
      { top: 100, bottom: 200 },
    ];
    expect(insertionIndexByMidpoint(rects, 999, 'y')).toBe(2);
  });

  it('returns 1 when cursor is past the first child midpoint', () => {
    const rects = [
      { top: 0, bottom: 100 }, // midpoint y=50
      { top: 100, bottom: 200 }, // midpoint y=150
    ];
    expect(insertionIndexByMidpoint(rects, 51, 'y')).toBe(1);
    expect(insertionIndexByMidpoint(rects, 49, 'y')).toBe(0);
  });

  it('uses left/right when axis is x', () => {
    const rects = [
      { left: 0, right: 100 },
      { left: 100, right: 200 },
    ];
    expect(insertionIndexByMidpoint(rects, 51, 'x')).toBe(1);
  });

  it('returns 0 for an empty list', () => {
    expect(insertionIndexByMidpoint([], 100, 'y')).toBe(0);
  });
});
