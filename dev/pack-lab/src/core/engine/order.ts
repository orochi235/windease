import type { LayoutItem, Size } from '#windease/layout-types.js';

// Mirrors packSize, packQueue and PACK_SORTS in src/layout/pack.ts, which windease does not
// export, plus two orders the shipped packers lack.

/** Orders the engine's `sort` accepts. Every one but `'none'` is descending and stable. */
export const ENGINE_SORTS = [
  'none',
  'height',
  'width',
  'area',
  'max-side',
  'perimeter',
  'height-width',
] as const;
export type EngineSort = (typeof ENGINE_SORTS)[number];

const usable = (n: number): boolean => Number.isFinite(n) && n > 0;

/** `natural`, else `hints.preferredSize`, or null when neither is a positive finite size. */
export function engineSize(item: LayoutItem): Size | null {
  const size = item.natural ?? item.hints?.preferredSize;
  return size && usable(size.w) && usable(size.h) ? size : null;
}

type Compare = (a: Size, b: Size) => number;

const desc =
  (key: (s: Size) => number): Compare =>
  (a, b) =>
    key(b) - key(a);

const COMPARES: Record<Exclude<EngineSort, 'none'>, Compare> = {
  height: desc((s) => s.h),
  width: desc((s) => s.w),
  area: desc((s) => s.w * s.h),
  'max-side': desc((s) => Math.max(s.w, s.h)),
  perimeter: desc((s) => s.w + s.h),
  // stb_rect_pack's rect_height_compare.
  'height-width': (a, b) => b.h - a.h || b.w - a.w,
};

export interface QueueEntry {
  item: LayoutItem;
  size: Size;
}

/** The sized items in `sort` order, ties in input order. A list compares by each order in
 *  turn, as the shipped packers do; unknown names and `'none'` add nothing. */
export function engineQueue(items: readonly LayoutItem[], sort: unknown): QueueEntry[] {
  const queue: QueueEntry[] = [];
  for (const item of items) {
    const size = engineSize(item);
    if (size) queue.push({ item, size });
  }
  const names: unknown[] = Array.isArray(sort) ? sort : [sort];
  const compares = names.flatMap((n) => {
    const c = COMPARES[n as Exclude<EngineSort, 'none'>];
    return c ? [c] : [];
  });
  if (compares.length > 0) {
    queue.sort((a, b) => {
      for (const c of compares) {
        const d = c(a.size, b.size);
        if (d !== 0) return d;
      }
      return 0;
    });
  }
  return queue;
}
