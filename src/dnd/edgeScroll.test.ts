import { describe, expect, it } from 'vitest';
import { edgeScrollDelta } from './edgeScroll.js';

const BOX = { x: 0, y: 0, w: 400, h: 300 };
const opts = { margin: 50, maxRate: 10 };

describe('edgeScrollDelta', () => {
  it('is still in the middle', () => {
    expect(edgeScrollDelta(BOX, { x: 200, y: 150 }, opts)).toEqual({ x: 0, y: 0 });
  });

  it('is still exactly at the margin', () => {
    expect(edgeScrollDelta(BOX, { x: 50, y: 150 }, opts).x).toBe(0);
  });

  it('ramps up as the cursor closes on an edge', () => {
    const near = edgeScrollDelta(BOX, { x: 40, y: 150 }, opts).x;
    const nearer = edgeScrollDelta(BOX, { x: 10, y: 150 }, opts).x;
    expect(near).toBeLessThan(0);
    expect(nearer).toBeLessThan(near);
  });

  it('reaches the full rate at the edge', () => {
    expect(edgeScrollDelta(BOX, { x: 0, y: 150 }, opts).x).toBe(-10);
    expect(edgeScrollDelta(BOX, { x: 400, y: 150 }, opts).x).toBe(10);
  });

  it('holds the full rate past the edge rather than reversing', () => {
    expect(edgeScrollDelta(BOX, { x: -200, y: 150 }, opts).x).toBe(-10);
    expect(edgeScrollDelta(BOX, { x: 900, y: 150 }, opts).x).toBe(10);
  });

  it('scrolls both axes in a corner', () => {
    const d = edgeScrollDelta(BOX, { x: 0, y: 0 }, opts);
    expect(d).toEqual({ x: -10, y: -10 });
  });

  it('picks the nearer edge in a box narrower than two margins', () => {
    const narrow = { x: 0, y: 0, w: 60, h: 300 };
    expect(edgeScrollDelta(narrow, { x: 45, y: 150 }, opts).x).toBeGreaterThan(0);
    expect(edgeScrollDelta(narrow, { x: 15, y: 150 }, opts).x).toBeLessThan(0);
  });

  it('is disabled by a zero margin or rate', () => {
    expect(edgeScrollDelta(BOX, { x: 0, y: 0 }, { margin: 0 })).toEqual({ x: 0, y: 0 });
    expect(edgeScrollDelta(BOX, { x: 0, y: 0 }, { maxRate: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('has defaults that fire near an edge and not in the middle', () => {
    expect(edgeScrollDelta(BOX, { x: 200, y: 150 })).toEqual({ x: 0, y: 0 });
    expect(edgeScrollDelta(BOX, { x: 2, y: 150 }).x).toBeLessThan(0);
  });
});
