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

describe('strip join declaration', () => {
  it('omits join by default', () => {
    for (const aff of seams({ axis: 'x', resizeMode: 'neighbor' })) {
      expect(aff.join).toBeUndefined();
    }
  });

  it('omits join under redistribute, which has no single victim', () => {
    for (const aff of seams({ axis: 'x', resizeMode: 'redistribute', joinOnOvershoot: true })) {
      expect(aff.join).toBeUndefined();
    }
  });

  it('names the dragged pane at min and its neighbor at max', () => {
    const [first, second] = seams({ axis: 'x', resizeMode: 'neighbor', joinOnOvershoot: true });
    expect(first?.join).toEqual({ atMin: 'a', atMax: 'b', threshold: 24 });
    expect(second?.join).toEqual({ atMin: 'b', atMax: 'c', threshold: 24 });
  });

  it('honors an explicit threshold', () => {
    const [first] = seams({
      axis: 'x',
      resizeMode: 'neighbor',
      joinOnOvershoot: true,
      joinThreshold: 40,
    });
    expect(first?.join?.threshold).toBe(40);
  });

  it('declares the join on a vertical strip too', () => {
    const [first] = seams({ axis: 'y', resizeMode: 'neighbor', joinOnOvershoot: true });
    expect(first?.join).toEqual({ atMin: 'a', atMax: 'b', threshold: 24 });
  });

  it('emits exactly one seam per non-last child, join or not', () => {
    expect(seams({ axis: 'x', resizeMode: 'neighbor', joinOnOvershoot: true })).toHaveLength(2);
  });
});
