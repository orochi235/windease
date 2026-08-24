import { describe, expect, it } from 'vitest';
import { cornerOrigin, FLOATING_CORNERS, snapCorner } from './floating.js';

const container = { w: 400, h: 300 };
const size = { w: 100, h: 80 };

describe('cornerOrigin', () => {
  it('insets from the named corner', () => {
    expect(cornerOrigin('top-left', size, container, 12)).toEqual({ x: 12, y: 12 });
    expect(cornerOrigin('top-right', size, container, 12)).toEqual({ x: 288, y: 12 });
    expect(cornerOrigin('bottom-left', size, container, 12)).toEqual({ x: 12, y: 208 });
    expect(cornerOrigin('bottom-right', size, container, 12)).toEqual({ x: 288, y: 208 });
  });
});

describe('snapCorner', () => {
  const eligible = FLOATING_CORNERS;

  it('captures a position resting exactly on the corner origin', () => {
    expect(snapCorner({ x: 12, y: 12 }, size, container, 12, 12, eligible)).toBe('top-left');
  });

  it('captures the shoved-into-the-corner case that a radius metric rejects', () => {
    // (0,0) is 12 on each axis from the (12,12) origin, but 16.97 away by radius.
    expect(snapCorner({ x: 0, y: 0 }, size, container, 12, 12, eligible)).toBe('top-left');
  });

  it('rejects a position past the threshold on one axis only', () => {
    expect(snapCorner({ x: 12, y: 25 }, size, container, 12, 12, eligible)).toBeNull();
  });

  it('never captures a corner outside the eligible set', () => {
    expect(snapCorner({ x: 0, y: 0 }, size, container, 12, 12, ['bottom-right'])).toBeNull();
  });

  it('picks the closer corner when two are in range', () => {
    const tiny = { w: 10, h: 10 };
    const narrow = { w: 40, h: 300 };
    // origins are x=12 (left) and x=18 (right); a position at x=17 is nearer the right.
    expect(snapCorner({ x: 17, y: 12 }, tiny, narrow, 12, 12, ['top-left', 'top-right'])).toBe(
      'top-right',
    );
  });
});
