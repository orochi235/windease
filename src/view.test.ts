import { describe, expect, it } from 'vitest';
import {
  fitScale,
  fitView,
  IDENTITY_VIEW,
  toLayoutDelta,
  toLayoutScroll,
  toLocalPoint,
  viewTransform,
  zoomView,
} from './view.js';

describe('fitScale', () => {
  it('contain picks the tighter axis', () => {
    expect(fitScale({ w: 1024, h: 768 }, { w: 512, h: 600 })).toBe(0.5);
    expect(fitScale({ w: 1024, h: 768 }, { w: 2048, h: 384 })).toBe(0.5);
  });

  it('width fills the width whatever the height', () => {
    expect(fitScale({ w: 1024, h: 768 }, { w: 512, h: 100 }, 'width')).toBe(0.5);
  });

  it('scales up as well as down', () => {
    expect(fitScale({ w: 400, h: 300 }, { w: 800, h: 600 })).toBe(2);
  });

  it('is 1 for an unmeasured frame or an empty viewport', () => {
    expect(fitScale({ w: 1024, h: 768 }, { w: 0, h: 0 })).toBe(1);
    expect(fitScale({ w: 0, h: 768 }, { w: 500, h: 500 })).toBe(1);
  });
});

describe('fitView', () => {
  it('centers the axis contain does not fill', () => {
    expect(fitView({ w: 1024, h: 768 }, { w: 512, h: 484 })).toEqual({ x: 0, y: 50, scale: 0.5 });
  });

  it('width pins the top edge', () => {
    expect(fitView({ w: 1024, h: 768 }, { w: 512, h: 900 }, 'width')).toEqual({
      x: 0,
      y: 0,
      scale: 0.5,
    });
  });

  it('is the identity until the frame has a size', () => {
    expect(fitView({ w: 1024, h: 768 }, { w: 0, h: 0 })).toBe(IDENTITY_VIEW);
  });
});

describe('delta math', () => {
  it('a screen delta divides by the scale', () => {
    expect(toLayoutDelta(50, -20, { x: 0.5, y: 0.5 })).toEqual({ dx: 100, dy: -40 });
  });

  it('a screen point is relative to the origin, then divided', () => {
    expect(toLocalPoint({ x: 150, y: 90 }, { x: 100, y: 40 }, { x: 0.5, y: 2 })).toEqual({
      x: 100,
      y: 25,
    });
  });

  it('nested scales compose by multiplication, so one division undoes both', () => {
    const outer = 0.5;
    const inner = 0.8;
    const layoutMove = 100;
    const screenMove = layoutMove * outer * inner;
    expect(toLayoutDelta(screenMove, 0, { x: outer * inner, y: 1 }).dx).toBeCloseTo(layoutMove);
  });

  it('a scroll offset is the layout point at the visible leading edge', () => {
    expect(toLayoutScroll({ x: 30, y: 7 }, IDENTITY_VIEW)).toEqual({ x: 30, y: 7 });
    // Layout y maps to 20 + y * 0.5 in the scroller; the edge at 120 is layout 200.
    expect(toLayoutScroll({ x: 0, y: 120 }, { x: 0, y: 20, scale: 0.5 })).toEqual({
      x: 0,
      y: 200,
    });
  });
});

describe('zoomView', () => {
  it('keeps the layout point under the anchor where it was', () => {
    const v = { x: 10, y: 20, scale: 1 };
    const anchor = { x: 110, y: 70 };
    const before = toLocalPoint(anchor, v, { x: v.scale, y: v.scale });
    const z = zoomView(v, anchor, 2);
    expect(z.scale).toBe(2);
    expect(toLocalPoint(anchor, z, { x: z.scale, y: z.scale })).toEqual(before);
  });
});

describe('viewTransform', () => {
  it('is absent for the identity view', () => {
    expect(viewTransform(IDENTITY_VIEW)).toBeUndefined();
  });

  it('translates, then scales about the top-left', () => {
    expect(viewTransform({ x: 4, y: 8, scale: 0.5 })).toBe('translate(4px, 8px) scale(0.5)');
  });
});
