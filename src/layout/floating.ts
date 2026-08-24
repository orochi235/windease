import type { Size } from '../layout-types.js';

export const FLOATING_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export type Corner = (typeof FLOATING_CORNERS)[number];

export interface Point {
  x: number;
  y: number;
}

/** Where an item of `size` rests when anchored to `corner`, `inset` px in on both axes. */
export function cornerOrigin(corner: Corner, size: Size, container: Size, inset: number): Point {
  const left = corner === 'top-left' || corner === 'bottom-left';
  const top = corner === 'top-left' || corner === 'top-right';
  return {
    x: left ? inset : container.w - size.w - inset,
    y: top ? inset : container.h - size.h - inset,
  };
}

/**
 * Nearest eligible corner whose resting origin is within `threshold` of `at` on
 * BOTH axes, or null. Per-axis rather than by radius: with inset and threshold
 * both 12, a panel shoved into the corner sits at (0,0), which is 12 away on each
 * axis but 16.97 away by radius — the gesture that most clearly means "snap here".
 */
export function snapCorner(
  at: Point,
  size: Size,
  container: Size,
  inset: number,
  threshold: number,
  eligible: readonly Corner[],
): Corner | null {
  let best: Corner | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const corner of eligible) {
    const origin = cornerOrigin(corner, size, container, inset);
    const dx = Math.abs(origin.x - at.x);
    const dy = Math.abs(origin.y - at.y);
    if (dx > threshold || dy > threshold) continue;
    const distance = Math.max(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = corner;
    }
  }
  return best;
}
