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

  it('caps an explicit size above max on initial layout', () => {
    const out = clampExplicitSizes({
      available: 1000,
      items: [{ id: 'a', explicit: 500, min: 0, max: 100 }],
    });
    expect(out.get('a')).toBe(100);
  });

  it('sends space freed by a cap to the other items, not nowhere', () => {
    // a wants 500 but is capped to 100; the freed 400 must reach b, not vanish.
    const out = clampExplicitSizes({
      available: 500,
      items: [
        { id: 'a', explicit: 500, min: 0, max: 100 },
        { id: 'b', explicit: undefined, min: 0 },
      ],
    });
    expect(out.get('a')).toBe(100);
    expect(out.get('b')).toBe(400);
    expect((out.get('a') ?? 0) + (out.get('b') ?? 0)).toBe(500);
  });

  it("honors an unconstrained sibling's min after a cap still forces proportional scaling", () => {
    // a's cap (300) still exceeds its share of the budget once b's min (150) is
    // reserved, so the existing scale-down runs on the capped value: 250/300.
    const out = clampExplicitSizes({
      available: 400,
      items: [
        { id: 'a', explicit: 1000, min: 0, max: 300 },
        { id: 'b', explicit: undefined, min: 150 },
      ],
    });
    expect(out.get('a')).toBeCloseTo(250);
    expect(out.get('b')).toBeCloseTo(150);
  });

  it("renders an explicit size below the item's own min", () => {
    // The layout floor applies to items that did not ask for a size. 32 is a
    // stated intent -- a palette collapsed to its header -- so it renders as
    // written. The resize path still refuses to drag below 120.
    const out = clampExplicitSizes({
      available: 600,
      items: [
        { id: 'a', explicit: 32, min: 120 },
        { id: 'b', explicit: undefined, min: 0 },
      ],
    });
    expect(out.get('a')).toBe(32);
    expect(out.get('b')).toBe(568);
  });

  it('caps an explicit size at max without consulting min', () => {
    // min > max is contradictory; max wins and min does not raise the value
    // first, because min no longer floors an explicitly-sized item.
    const out = clampExplicitSizes({
      available: 1000,
      items: [{ id: 'a', explicit: 50, min: 300, max: 100 }],
    });
    expect(out.get('a')).toBe(50);
  });

  it('leaves an item with no maxSize unaffected', () => {
    const out = clampExplicitSizes({
      available: 500,
      items: [
        { id: 'a', explicit: 200, min: 0, max: undefined },
        { id: 'b', explicit: undefined, min: 50 },
      ],
    });
    expect(out.get('a')).toBe(200);
    expect(out.get('b')).toBe(300);
  });

  it('never scales an explicit size below its own min', () => {
    // available = 200, explicit 300 + 100. Naive proportional scaling gives
    // a -> 150, under a's declared min of 180.
    const out = clampExplicitSizes({
      available: 200,
      items: [
        { id: 'a', explicit: 300, min: 180 },
        { id: 'b', explicit: 100, min: 0 },
      ],
    });
    expect(out.get('a')).toBeCloseTo(180);
    expect(out.get('b')).toBeCloseTo(20);
  });

  it('keeps explicit items at their min rather than collapsing them to zero', () => {
    // Unconstrained mins alone consume the whole extent, so the explicit
    // budget is 0. The row cannot fit either way, but `a` must render at its
    // min, not vanish.
    const out = clampExplicitSizes({
      available: 100,
      items: [
        { id: 'a', explicit: 80, min: 40 },
        { id: 'b', explicit: undefined, min: 100 },
      ],
    });
    expect(out.get('a')).toBe(40);
    expect(out.get('b')).toBe(100);
  });

  it('freezes one item at min and keeps scaling the rest proportionally', () => {
    // budget 300 across 200/200/200. Flat scaling is 0.5 -> 100 each, but a's
    // min is 150. a freezes at 150; b and c split the remaining 150.
    const out = clampExplicitSizes({
      available: 300,
      items: [
        { id: 'a', explicit: 200, min: 150 },
        { id: 'b', explicit: 200, min: 0 },
        { id: 'c', explicit: 200, min: 0 },
      ],
    });
    expect(out.get('a')).toBeCloseTo(150);
    expect(out.get('b')).toBeCloseTo(75);
    expect(out.get('c')).toBeCloseTo(75);
  });
});
