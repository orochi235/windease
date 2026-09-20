import type { LayoutItem, LayoutResult, LayoutStrategy, Rect, Size } from '../layout-types.js';
import { trace } from '../trace.js';
import { largestEmptyRect } from './empty-rect.js';

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

/** What a packing strategy's `overflowMode` accepts. `'scroll'`, the default,
 *  packs past the container and reports the excess as `overflow`;
 *  `'unplaced'` treats the container as a bin and sends what will not fit in it
 *  to `unplaced`. */
export const PACK_OVERFLOW_MODES = ['scroll', 'unplaced'] as const;

/** Whether `options` bound packing to the container, under `overflowMode: 'unplaced'`. */
export function packBounded(options: Record<string, unknown>): boolean {
  return options.overflowMode === 'unplaced';
}

/** Whether a `size` placed at `x`, `y` stays inside `container`, allowing float drift. */
export function fitsContainer(x: number, y: number, size: Size, container: Size): boolean {
  return fitsWithin(x + size.w, container.w) && fitsWithin(y + size.h, container.h);
}

/** One way to place an item: its own size, or turned a quarter with `w` and `h` swapped. */
export interface PackTurn {
  w: number;
  h: number;
  turned: boolean;
}

/** The ways `size` may be placed: upright first, then turned when `rotate` is
 *  set and turning changes anything. Callers break ties toward the first. */
export function packTurns(size: Size, rotate: boolean): PackTurn[] {
  const upright = { w: size.w, h: size.h, turned: false };
  return rotate && size.w !== size.h
    ? [upright, { w: size.h, h: size.w, turned: true }]
    : [upright];
}

/** The candidate with the least `keys`, compared in order; the earliest on a
 *  full tie. `null` for no candidates. */
export function packLeast<T>(candidates: readonly T[], ...keys: ((c: T) => number)[]): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (best === null) {
      best = candidate;
      continue;
    }
    for (const key of keys) {
      const a = key(candidate);
      const b = key(best);
      if (a < b) best = candidate;
      if (a !== b) break;
    }
  }
  return best;
}

/** Whether `options` let items be turned a quarter, under `rotate: true`. */
export function packRotate(options: Record<string, unknown>): boolean {
  return options.rotate === true;
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
 *
 * `turned` is null when the pass could not rotate. Otherwise every placement
 * gets a `rotation` channel: 90 for an item placed turned a quarter clockwise,
 * 0 for one placed upright.
 */
export function packResult(
  items: LayoutItem[],
  placed: Map<string, Rect>,
  container: Size,
  turned: ReadonlySet<string> | null = null,
): LayoutResult<string> {
  const placements = new Map<string, Rect>();
  const channels = new Map<string, Record<string, number>>();
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
    if (turned) channels.set(id, { rotation: turned.has(id) ? 90 : 0 });
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  const result: LayoutResult<string> = { placements, affordances: [] };
  if (unplaced.length > 0) result.unplaced = unplaced;
  if (turned) result.channels = channels;
  const w = fitsWithin(right, container.w) ? 0 : right - container.w;
  const h = fitsWithin(bottom, container.h) ? 0 : bottom - container.h;
  if (w > 0 || h > 0) result.overflow = { w, h };
  return result;
}

/**
 * A strategy's `pocket` config: the size under which an item is diverted, or
 * null when the key is absent or holds no positive, finite `w` and `h`.
 */
export function packPocketSize(options: Record<string, unknown>): Size | null {
  const pocket = options.pocket as { w?: unknown; h?: unknown } | undefined;
  if (!pocket || typeof pocket !== 'object') return null;
  const usable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  return usable(pocket.w) && usable(pocket.h) ? { w: pocket.w, h: pocket.h } : null;
}

/** Whether `item` is small enough to be pocketed: both sides under `pocket`. */
function pocketed(item: LayoutItem, pocket: Size): boolean {
  const size = packSize(item);
  return size !== null && size.w < pocket.w && size.h < pocket.h;
}

/** The ids `result` placed turned a quarter, by its `rotation` channels. */
function turnedIn(result: LayoutResult<string>): string[] {
  const out: string[] = [];
  for (const [id, channels] of result.channels ?? []) {
    if (channels.rotation === 90) out.push(id);
  }
  return out;
}

/**
 * The pass behind a packing strategy's `pocket` config: items under that size
 * are held back, the rest are packed as usual, and the held-back ones are then
 * packed together into the largest empty rectangle the main pass left — the
 * pocket — instead of each taking a spot in the flow.
 *
 * Returns null when `pocket` is absent or unusable, and the caller packs
 * normally. The inner passes run with `pocket` removed, so neither can divert
 * again.
 *
 * Every item still gets a rect of its own; nothing is drawn for the pocket and
 * no node stands in it. Each pocketed placement carries a `pocket: 1` channel,
 * for a host that wants to mark the region. What the pocket cannot hold obeys
 * the container's own `overflowMode`, since the inner pass reads the same
 * config the outer one did.
 */
export function packPocketPass(
  strategy: LayoutStrategy<void, string>,
  args: { items: LayoutItem[]; container: Size; options: Record<string, unknown> },
): LayoutResult<string> | null {
  const pocket = packPocketSize(args.options);
  if (!pocket) return null;

  const { pocket: _, ...rest } = args.options;
  const flow = args.items.filter((item) => !pocketed(item, pocket));
  const smalls = args.items.filter((item) => pocketed(item, pocket));
  const main = strategy.layout({
    items: flow,
    container: args.container,
    state: undefined,
    options: rest,
  });

  const placed = new Map<string, Rect>(main.placements);
  const turned = new Set<string>(turnedIn(main));
  const inPocket = new Set<string>();
  const rect =
    smalls.length > 0
      ? largestEmptyRect(main.placements.values(), args.container, packGap(args.options))
      : null;
  if (rect) {
    const inner = strategy.layout({
      items: smalls,
      container: { w: rect.w, h: rect.h },
      state: undefined,
      options: rest,
    });
    for (const [id, r] of inner.placements) {
      placed.set(id, { ...r, x: r.x + rect.x, y: r.y + rect.y });
      inPocket.add(id);
    }
    for (const id of turnedIn(inner)) turned.add(id);
  }

  const rotate = packRotate(args.options);
  const result = packResult(args.items, placed, args.container, rotate ? turned : null);
  if (inPocket.size > 0) {
    const channels = new Map(result.channels ?? []);
    for (const id of inPocket) channels.set(id, { ...channels.get(id), pocket: 1 });
    result.channels = channels;
  }
  trace(
    'layout',
    `${strategy.name}: pocket ${rect ? `${rect.w}×${rect.h} at ${rect.x},${rect.y}` : 'none'} for ${inPocket.size} of ${smalls.length} under ${pocket.w}×${pocket.h}`,
    { unplaced: result.unplaced, overflow: result.overflow },
  );
  return result;
}
