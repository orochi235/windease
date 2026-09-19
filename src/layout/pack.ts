import type { LayoutItem, LayoutResult, Rect, Size } from '../layout-types.js';

/**
 * Tolerance, in pixels, for width comparisons. Tiles sized as a fraction of the
 * width sum to it only up to float error, so a row that fills the width exactly
 * can come out a hair over it.
 */
export const PACK_EPSILON = 1e-6;

/** Whether an extent ending at `end` stays within `limit`, allowing float drift. */
export function fitsWithin(end: number, limit: number): boolean {
  return end <= limit + PACK_EPSILON;
}

/**
 * The size a packing strategy places `item` at — `natural` when an adapter
 * measured it, else `hints.preferredSize` — or `null` when neither gives a
 * positive, finite width and height.
 */
export function packSize(item: LayoutItem): Size | null {
  const size = item.natural ?? item.hints?.preferredSize;
  if (!size) return null;
  const usable = (n: number) => Number.isFinite(n) && n > 0;
  return usable(size.w) && usable(size.h) ? size : null;
}

/** The orders a packing strategy's `sort` config accepts. Every order but
 *  `'none'` is descending and keeps input order among equal keys. */
export const PACK_SORTS = ['none', 'height', 'width', 'area', 'max-side'] as const;
export type PackSort = (typeof PACK_SORTS)[number];

/** A sized item as a packer places it. */
export interface PackEntry {
  item: LayoutItem;
  size: Size;
}

const SORT_KEYS: Record<Exclude<PackSort, 'none'>, (size: Size) => number> = {
  height: (s) => s.h,
  width: (s) => s.w,
  area: (s) => s.w * s.h,
  'max-side': (s) => Math.max(s.w, s.h),
};

/**
 * `items` split into the sized ones, in the order `options.sort` places them,
 * and the ids of those with no usable size. An unknown `sort` reads as
 * `'none'`, the order given.
 */
export function packQueue(
  items: LayoutItem[],
  options: Record<string, unknown>,
): { queue: PackEntry[]; unsized: string[] } {
  const queue: PackEntry[] = [];
  const unsized: string[] = [];
  for (const item of items) {
    const size = packSize(item);
    if (size) queue.push({ item, size });
    else unsized.push(item.id);
  }
  const key = SORT_KEYS[options.sort as Exclude<PackSort, 'none'>];
  if (key) queue.sort((a, b) => key(b.size) - key(a.size));
  return { queue, unsized };
}

/** A packing strategy's `gap`; anything but a positive finite number reads as 0. */
export function packGap(options: Record<string, unknown>): number {
  const gap = options.gap;
  return typeof gap === 'number' && Number.isFinite(gap) && gap > 0 ? gap : 0;
}

/**
 * Wraps a packing pass's placements with `unplaced` and per-axis `overflow`,
 * each absent when empty. Placements and `unplaced` come back in `items`'
 * order, whatever order the pass placed them in. Overflow measures the placed
 * rects' far edges, so a trailing gap never counts toward it.
 */
export function packResult(
  items: LayoutItem[],
  placed: Map<string, Rect>,
  container: Size,
): LayoutResult<string> {
  const placements = new Map<string, Rect>();
  const unplaced: string[] = [];
  let right = 0;
  let bottom = 0;
  for (const { id } of items) {
    const rect = placed.get(id);
    if (!rect) {
      unplaced.push(id);
      continue;
    }
    placements.set(id, rect);
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  const result: LayoutResult<string> = { placements, affordances: [] };
  if (unplaced.length > 0) result.unplaced = unplaced;
  const w = fitsWithin(right, container.w) ? 0 : right - container.w;
  const h = fitsWithin(bottom, container.h) ? 0 : bottom - container.h;
  if (w > 0 || h > 0) result.overflow = { w, h };
  return result;
}
