import type { Rect, StickyInset } from '../layout-types.js';

/**
 * Where a sticky placement shows at `scroll`: at its own position until the
 * scroll reaches it, then held `inset` from the visible leading edge on each
 * axis the inset names. Pure, so a host recomputes it per scroll frame without
 * re-running the strategy.
 *
 * @group Layout
 */
export function stuckRect<T extends Rect>(
  rect: T,
  inset: StickyInset | undefined,
  scroll: { x: number; y: number },
): T {
  if (!inset) return rect;
  const x = inset.x === undefined ? rect.x : Math.max(rect.x, scroll.x + inset.x);
  const y = inset.y === undefined ? rect.y : Math.max(rect.y, scroll.y + inset.y);
  return x === rect.x && y === rect.y ? rect : { ...rect, x, y };
}

/**
 * The boxes frozen panes cover at `scroll`: `x` bounds every placement held on
 * x (a frozen column), `y` every one held on y (a heading row).
 *
 * @group Layout
 */
export function frozenBands(
  placements: ReadonlyMap<string, Rect>,
  sticky: ReadonlyMap<string, StickyInset>,
  scroll: { x: number; y: number },
): { x?: Rect; y?: Rect } {
  const bands: { x?: Rect; y?: Rect } = {};
  for (const [id, inset] of sticky) {
    const placed = placements.get(id);
    if (!placed) continue;
    const r = stuckRect(placed, inset, scroll);
    if (inset.x !== undefined) bands.x = union(bands.x, r);
    if (inset.y !== undefined) bands.y = union(bands.y, r);
  }
  return bands;
}

/**
 * A seam's `rect` less the part lying under the frozen band it scrolls beneath:
 * a column seam under a frozen column, a row seam under a heading row. It keeps
 * the longer piece, or shrinks to nothing, so the element stays focusable.
 * A seam held on its own axis is never beneath that band.
 *
 * @group Layout
 */
export function clipUnderBand<T extends Rect>(
  rect: T,
  across: 'x' | 'y',
  bands: { x?: Rect; y?: Rect },
  own: StickyInset | undefined,
): T {
  const band = bands[across];
  if (!band || own?.[across] !== undefined) return rect;
  const along = across === 'x' ? 'y' : 'x';
  const span = across === 'x' ? 'w' : 'h';
  const length = across === 'x' ? 'h' : 'w';
  const crosses =
    rect[across] < band[across] + band[span] && band[across] < rect[across] + rect[span];
  const lo = rect[along];
  const hi = lo + rect[length];
  const bandLo = band[along];
  const bandHi = bandLo + band[length];
  if (!crosses || bandHi <= lo || bandLo >= hi) return rect;
  const before = Math.max(0, bandLo - lo);
  const after = Math.max(0, hi - bandHi);
  return before >= after
    ? { ...rect, [length]: before }
    : { ...rect, [along]: bandHi, [length]: after };
}

function union(a: Rect | undefined, b: Rect): Rect {
  if (!a) return { x: b.x, y: b.y, z: 0, w: b.w, h: b.h };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    z: 0,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}
