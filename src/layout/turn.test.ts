import { describe, expect, it } from 'vitest';
import { turnedExtent, turns } from './turn.js';

const near = (v: number, want: number) => expect(v).toBeCloseTo(want, 1);

describe('turnedExtent', () => {
  it('leaves an unturned box alone', () => {
    expect(turnedExtent(86, 120, 0)).toEqual({ w: 86, h: 120 });
  });

  it('swaps the extents at a quarter turn', () => {
    const t = turnedExtent(86, 120, 90);
    near(t.w, 120);
    near(t.h, 86);
  });

  it('returns the same box at a half turn', () => {
    expect(turnedExtent(86, 120, 180)).toEqual({ w: 86, h: 120 });
  });

  it('grows past both extents between the quarters', () => {
    const t = turnedExtent(86, 120, 35);
    near(t.w, 139.3);
    near(t.h, 147.6);
    expect(t.w).toBeGreaterThan(86);
    expect(t.h).toBeGreaterThan(120);
  });

  it('is square at 45°, but widest at the diagonal', () => {
    const square = turnedExtent(86, 120, 45);
    near(square.w, 145.7);
    near(square.h, square.w);

    // 45° is where the box is squarest, not where it is biggest: the most any
    // angle reserves on an axis is the diagonal, at atan(h/w) for width.
    const diagonal = Math.hypot(86, 120);
    const widest = turnedExtent(86, 120, (Math.atan2(120, 86) * 180) / Math.PI);
    near(widest.w, diagonal);
    expect(widest.w).toBeGreaterThan(square.w);

    for (let deg = 0; deg <= 360; deg += 1) {
      const t = turnedExtent(86, 120, deg);
      expect(t.w).toBeLessThanOrEqual(diagonal + 1e-9);
      expect(t.h).toBeLessThanOrEqual(diagonal + 1e-9);
    }
  });

  it('is symmetric about the sign of the angle', () => {
    expect(turnedExtent(86, 120, -35)).toEqual(turnedExtent(86, 120, 35));
  });

  it('treats a square as a square at every quarter', () => {
    for (const deg of [0, 90, 180, 270]) {
      const t = turnedExtent(100, 100, deg);
      near(t.w, 100);
      near(t.h, 100);
    }
  });

  it('declines a non-finite angle rather than producing NaN', () => {
    expect(turnedExtent(86, 120, Number.NaN)).toEqual({ w: 86, h: 120 });
  });
});

describe('turns', () => {
  it('is false for an absent, zero or full-circle angle', () => {
    expect(turns(undefined)).toBe(false);
    expect(turns(0)).toBe(false);
    expect(turns(360)).toBe(false);
  });

  it('is true for a half turn, which reserves the same box but draws upside down', () => {
    expect(turns(180)).toBe(true);
  });

  it('is false for a non-finite angle', () => {
    expect(turns(Number.NaN)).toBe(false);
    expect(turns(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
