import type { Size } from './layout-types.js';

/** Which axis a split runs out of room on, how much its panes' floors need
 *  there, and how much there is. */
export interface SplitShortfall {
  axis: 'x' | 'y';
  needed: number;
  available: number;
}

/** The spacing of the container the new panes land in. */
export interface SplitSpacing {
  gap: number;
  padding: number;
}

const EPSILON = 1e-6;

const extent = (s: Size, axis: 'x' | 'y') => (axis === 'x' ? s.w : s.h);
const other = (axis: 'x' | 'y') => (axis === 'x' ? 'y' : 'x');

/**
 * Whether panes with these floors fit in a row along `axis` of `size`, the way
 * a filled strip lays them out: every floor, plus the gaps and padding, along
 * the axis, and the largest floor across it. Null when they fit.
 */
export function rowShortfall(
  size: Size,
  axis: 'x' | 'y',
  floors: readonly Size[],
  spacing: SplitSpacing,
): SplitShortfall | null {
  const pad = 2 * spacing.padding;
  const along =
    floors.reduce((sum, f) => sum + extent(f, axis), 0) +
    spacing.gap * Math.max(0, floors.length - 1) +
    pad;
  if (along > extent(size, axis) + EPSILON) {
    return { axis, needed: along, available: extent(size, axis) };
  }
  const cross = other(axis);
  const across = Math.max(0, ...floors.map((f) => extent(f, cross))) + pad;
  if (across > extent(size, cross) + EPSILON) {
    return { axis: cross, needed: across, available: extent(size, cross) };
  }
  return null;
}

/** Columns laid along x, each a strip of panes along y, as `direction: 'both'`
 *  builds them: every column carries the same spacing as the row holding it. */
export function columnsShortfall(
  size: Size,
  columns: readonly (readonly Size[])[],
  spacing: SplitSpacing,
): SplitShortfall | null {
  const pad = 2 * spacing.padding;
  const floors = columns.map((col) => ({
    w: Math.max(0, ...col.map((f) => f.w)) + pad,
    h: col.reduce((sum, f) => sum + f.h, 0) + spacing.gap * Math.max(0, col.length - 1) + pad,
  }));
  return rowShortfall(size, 'x', floors, spacing);
}

/** Equal cells in `cols` columns, as a grid divides its container: the largest
 *  floor has to fit one cell on each axis. */
export function gridShortfall(
  size: Size,
  cols: number,
  floors: readonly Size[],
  spacing: SplitSpacing,
): SplitShortfall | null {
  const rows = Math.ceil(floors.length / cols);
  for (const [axis, count] of [
    ['x', cols],
    ['y', rows],
  ] as const) {
    const largest = Math.max(0, ...floors.map((f) => extent(f, axis)));
    const needed = largest * count + spacing.gap * (count - 1) + 2 * spacing.padding;
    if (needed > extent(size, axis) + EPSILON) {
      return { axis, needed, available: extent(size, axis) };
    }
  }
  return null;
}
