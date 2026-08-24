import type { LayoutItem, Rect, Size } from '../layout-types.js';

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

/** Where one floating item rests. `anchor` is a sticky cache over `x`/`y`. */
export interface FloatingPlacement {
  x: number;
  y: number;
  anchor: Corner | null;
}

export function isFloating(item: LayoutItem): boolean {
  return item.meta?.floating === true;
}

export function eligibleCorners(item: LayoutItem): readonly Corner[] {
  const raw = item.meta?.snapCorners;
  if (!Array.isArray(raw)) return FLOATING_CORNERS;
  const kept = raw.filter((c): c is Corner =>
    (FLOATING_CORNERS as readonly string[]).includes(c as string),
  );
  return kept.length > 0 ? kept : FLOATING_CORNERS;
}

export function sizeOf(item: LayoutItem): Size {
  return item.natural ?? item.hints?.preferredSize ?? { w: 0, h: 0 };
}

export function clampToContainer(at: Point, size: Size, container: Size): Point {
  return {
    x: Math.max(0, Math.min(at.x, container.w - size.w)),
    y: Math.max(0, Math.min(at.y, container.h - size.h)),
  };
}

export function rectOf(
  item: LayoutItem,
  place: FloatingPlacement,
  container: Size,
  inset: number,
): Rect {
  const size = sizeOf(item);
  const origin =
    place.anchor === null
      ? clampToContainer(place, size, container)
      : cornerOrigin(place.anchor, size, container, inset);
  return { x: origin.x, y: origin.y, w: size.w, h: size.h };
}
