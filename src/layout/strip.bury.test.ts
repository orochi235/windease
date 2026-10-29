import { describe, expect, it } from 'vitest';
import type { Affordance, LayoutItem } from '../layout-types.js';
import { stripStrategy } from './strip.js';

const items: LayoutItem[] = [
  { id: 'a', hints: { minSize: { w: 80, h: 0 } } },
  { id: 'b', hints: { minSize: { w: 80, h: 0 } } },
  { id: 'c', hints: { minSize: { w: 80, h: 0 } } },
];

function seams(options: Record<string, unknown>): Affordance[] {
  return stripStrategy.layout({
    items,
    container: { w: 600, h: 200 },
    state: undefined,
    options,
  }).affordances;
}

describe('strip bury declaration', () => {
  it('omits bury by default', () => {
    for (const aff of seams({ axis: 'x', resizeMode: 'neighbor' })) {
      expect(aff.join).toBeUndefined();
    }
  });

  it('omits bury under redistribute, which has no single victim', () => {
    for (const aff of seams({ axis: 'x', resizeMode: 'redistribute', overshoot: 'destroy' })) {
      expect(aff.join).toBeUndefined();
    }
  });

  it('names the dragged pane at min and its neighbor at max', () => {
    const [first, second] = seams({ axis: 'x', resizeMode: 'neighbor', overshoot: 'destroy' });
    expect(first?.bury).toEqual({ atMin: 'a', atMax: 'b', threshold: 24 });
    expect(second?.bury).toEqual({ atMin: 'b', atMax: 'c', threshold: 24 });
  });

  it('honors an explicit threshold', () => {
    const [first] = seams({
      axis: 'x',
      resizeMode: 'neighbor',
      overshoot: 'destroy',
      buryThreshold: 40,
    });
    expect(first?.bury?.threshold).toBe(40);
  });

  it('declares the bury on a vertical strip too', () => {
    const [first] = seams({ axis: 'y', resizeMode: 'neighbor', overshoot: 'destroy' });
    expect(first?.bury).toEqual({ atMin: 'a', atMax: 'b', threshold: 24 });
  });

  it('emits exactly one seam per non-last child, bury or not', () => {
    expect(seams({ axis: 'x', resizeMode: 'neighbor', overshoot: 'destroy' })).toHaveLength(2);
  });
});
