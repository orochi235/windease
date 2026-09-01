import type { Rect } from '../layout-types.js';
import type { Point } from './DragEngine.js';

/** Tunes the auto-scroll ramp: how wide the hot zone at each edge is and how
 *  fast the scroll runs across it. */
export interface EdgeScrollOptions {
  /** How near an edge the cursor must come before scrolling starts. */
  margin?: number;
  /** Rate at the edge itself, in px per sample. The ramp is linear from zero
   *  at `margin` to this at the edge, and holds here past it. */
  maxRate?: number;
}

const ZERO: Point = { x: 0, y: 0 };

const DEFAULT_MARGIN = 48;
const DEFAULT_MAX_RATE = 16;

function rate(distance: number, margin: number, maxRate: number): number {
  const t = Math.min(1, Math.max(0, 1 - distance / margin));
  return maxRate * t;
}

/**
 * How far a scrolling box should move to follow a cursor dragged toward its
 * edge, in px per sample. Zero on an axis whose cursor is clear of both
 * margins, so a drag through the middle costs one comparison per axis.
 *
 * Pure arithmetic over bounds and a point — the caller does the scrolling and
 * decides how often to ask. A cursor past the edge keeps the maximum rate
 * rather than reversing, so overshooting a target does not fight the user.
 */
export function edgeScrollDelta(bounds: Rect, point: Point, opts?: EdgeScrollOptions): Point {
  const margin = opts?.margin ?? DEFAULT_MARGIN;
  const maxRate = opts?.maxRate ?? DEFAULT_MAX_RATE;
  if (margin <= 0 || maxRate <= 0) return ZERO;

  const axis = (p: number, lo: number, hi: number): number => {
    const fromLo = p - lo;
    const fromHi = hi - p;
    // Nearer edge wins, so a box narrower than two margins still picks a side
    // instead of always scrolling the same way.
    const towardLo = fromLo <= fromHi;
    const distance = towardLo ? fromLo : fromHi;
    if (distance >= margin) return 0;
    return (towardLo ? -1 : 1) * rate(distance, margin, maxRate);
  };

  const x = axis(point.x, bounds.x, bounds.x + bounds.w);
  const y = axis(point.y, bounds.y, bounds.y + bounds.h);
  return x === 0 && y === 0 ? ZERO : { x, y };
}
