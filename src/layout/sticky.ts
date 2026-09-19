import type { Rect, StickyInset } from '../layout-types.js';

/**
 * Where a sticky placement shows at `scroll`: at its own position until the
 * scroll reaches it, then held `inset` from the visible leading edge on each
 * axis the inset names. Pure, so a host recomputes it per scroll frame without
 * re-running the strategy.
 *
 * @group Layout
 */
export function stuckRect(
  rect: Rect,
  inset: StickyInset | undefined,
  scroll: { x: number; y: number },
): Rect {
  if (!inset) return rect;
  const x = inset.x === undefined ? rect.x : Math.max(rect.x, scroll.x + inset.x);
  const y = inset.y === undefined ? rect.y : Math.max(rect.y, scroll.y + inset.y);
  return x === rect.x && y === rect.y ? rect : { ...rect, x, y };
}
