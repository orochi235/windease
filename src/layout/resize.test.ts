// src/layout/resize.test.ts
import { describe, expect, it } from 'vitest';
import { clampExplicitSizes } from './resize.js';

describe('clampExplicitSizes', () => {
  it('honors explicit sizes when they fit', () => {
    // available = 500, two children: A explicit 200, B unconstrained (min 50)
    const out = clampExplicitSizes({
      available: 500,
      items: [
        { id: 'a', explicit: 200, min: 0 },
        { id: 'b', explicit: undefined, min: 50 },
      ],
    });
    expect(out.get('a')).toBe(200);
    expect(out.get('b')).toBe(300);
  });

  it('distributes leftover across multiple unconstrained children', () => {
    const out = clampExplicitSizes({
      available: 600,
      items: [
        { id: 'a', explicit: 200, min: 0 },
        { id: 'b', explicit: undefined, min: 0 },
        { id: 'c', explicit: undefined, min: 0 },
      ],
    });
    expect(out.get('a')).toBe(200);
    expect(out.get('b')).toBe(200);
    expect(out.get('c')).toBe(200);
  });

  it('proportionally scales explicit sizes down when sum > available', () => {
    // available = 200, two explicit children 300 + 100 = 400.
    // Scale factor 200/400 = 0.5: a -> 150, b -> 50.
    const out = clampExplicitSizes({
      available: 200,
      items: [
        { id: 'a', explicit: 300, min: 0 },
        { id: 'b', explicit: 100, min: 0 },
      ],
    });
    expect(out.get('a')).toBeCloseTo(150);
    expect(out.get('b')).toBeCloseTo(50);
  });

  it('shrinks explicit sizes to honor unconstrained mins', () => {
    // available = 200, explicit child = 180, unconstrained child min = 50.
    // explicit alone leaves 20, less than 50. Scale explicit until leftover = 50.
    // explicit becomes 150.
    const out = clampExplicitSizes({
      available: 200,
      items: [
        { id: 'a', explicit: 180, min: 0 },
        { id: 'b', explicit: undefined, min: 50 },
      ],
    });
    expect(out.get('a')).toBeCloseTo(150);
    expect(out.get('b')).toBeCloseTo(50);
  });

  it('returns empty map for empty items', () => {
    const out = clampExplicitSizes({ available: 100, items: [] });
    expect(out.size).toBe(0);
  });
});
