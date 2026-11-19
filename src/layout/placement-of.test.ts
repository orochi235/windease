import { describe, expect, it } from 'vitest';
import { onTopLayer } from './layer.js';
import { placementOf, withPlacement } from './placement-of.js';

describe('placementOf', () => {
  it('reads placement when meta is the same object', () => {
    const bag = { pinned: 0 };
    expect(placementOf({ id: 'a', placement: bag, meta: bag })).toBe(bag);
  });

  it('folds a hand-built meta in, with placement winning', () => {
    const item = { id: 'a', meta: { pinned: 0, x: 1 }, placement: { x: 2 } };
    expect(placementOf(item)).toEqual({ pinned: 0, x: 2 });
  });

  it('reads a meta-only item from before the rename', () => {
    expect(placementOf({ id: 'a', meta: { floating: true } })).toEqual({ floating: true });
  });

  it('is empty for an item with neither', () => {
    expect(placementOf({ id: 'a' })).toEqual({});
  });
});

describe('withPlacement', () => {
  it('leaves no meta to fold a key deleted from the copy back in', () => {
    const bag = { size: { w: 10 }, pinned: 0 };
    const next = withPlacement({ id: 'a', placement: bag, meta: bag }, {});
    delete next.placement?.size;
    expect(next.meta).toBeUndefined();
    expect(placementOf(next).size).toBeUndefined();
    expect(placementOf(next).pinned).toBe(0);
    expect(bag.size).toEqual({ w: 10 });
  });
});

describe('a built-in reader fed a hand-built item', () => {
  it('still honors a key given under the deprecated meta', () => {
    expect(onTopLayer({ id: 'a', meta: { layer: 'top' } })).toBe(true);
    expect(onTopLayer({ id: 'a', placement: { layer: 'top' } })).toBe(true);
  });
});
