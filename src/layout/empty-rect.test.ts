import { describe, expect, it } from 'vitest';
import type { Rect } from '../layout-types.js';
import { largestEmptyRect } from './empty-rect.js';

const CONTAINER = { w: 100, h: 100 };
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, z: 0, w, h });
const box = (r: Rect | null) => (r === null ? null : { x: r.x, y: r.y, w: r.w, h: r.h });

describe('largestEmptyRect', () => {
  it('gives the whole container when nothing is placed', () => {
    expect(box(largestEmptyRect([], CONTAINER))).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('gives null when a placement covers the container', () => {
    expect(largestEmptyRect([rect(0, 0, 100, 100)], CONTAINER)).toBeNull();
  });

  it('gives the band below a full-width row', () => {
    expect(box(largestEmptyRect([rect(0, 0, 100, 30)], CONTAINER))).toEqual({
      x: 0,
      y: 30,
      w: 100,
      h: 70,
    });
  });

  it('gives the column beside a full-height block', () => {
    expect(box(largestEmptyRect([rect(0, 0, 40, 100)], CONTAINER))).toEqual({
      x: 40,
      y: 0,
      w: 60,
      h: 100,
    });
  });

  it('keeps a gap between the rectangle and what is placed', () => {
    expect(box(largestEmptyRect([rect(0, 0, 100, 30)], CONTAINER, 8))).toEqual({
      x: 0,
      y: 38,
      w: 100,
      h: 62,
    });
  });

  it('takes the largest of several empty regions', () => {
    // A tall block on the left, a short one top-right: the largest empty
    // rectangle is the band under the short one.
    const out = box(largestEmptyRect([rect(0, 0, 30, 100), rect(30, 0, 70, 20)], CONTAINER));
    expect(out).toEqual({ x: 30, y: 20, w: 70, h: 80 });
  });

  it('breaks an area tie toward the bottom, then the right', () => {
    // Two 100x20 rows placed at y=20 and y=60 leave three 100x20 bands, at
    // y=0, y=40 and y=80. The lowest wins.
    const out = box(largestEmptyRect([rect(0, 20, 100, 20), rect(0, 60, 100, 20)], CONTAINER));
    expect(out).toEqual({ x: 0, y: 80, w: 100, h: 20 });
  });

  it('breaks a tie toward the right when the tops match', () => {
    // A 20-wide block at each end leaves two 40x100 columns; the right one wins.
    const out = box(largestEmptyRect([rect(40, 0, 20, 100)], { w: 100, h: 100 }));
    expect(out).toEqual({ x: 60, y: 0, w: 40, h: 100 });
  });

  it('ignores what lies outside the container', () => {
    const out = box(largestEmptyRect([rect(120, 0, 40, 40)], CONTAINER));
    expect(out).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('clips a placement that runs past the container', () => {
    const out = box(largestEmptyRect([rect(0, 80, 100, 400)], CONTAINER));
    expect(out).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it('gives null for a container with no area', () => {
    expect(largestEmptyRect([], { w: 0, h: 100 })).toBeNull();
    expect(largestEmptyRect([], { w: 100, h: 0 })).toBeNull();
  });

  it('finds the notch left by a staircase', () => {
    // Two blocks stepping down from the top-left leave the bottom-right open.
    const out = box(largestEmptyRect([rect(0, 0, 60, 40), rect(0, 40, 30, 60)], CONTAINER));
    expect(out).toEqual({ x: 30, y: 40, w: 70, h: 60 });
  });
});
