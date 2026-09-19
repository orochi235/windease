import type { LayoutItem, Size } from '#windease/layout-types.js';
import type { Fit, Packer, Packing } from './types.js';

/**
 * Widths an aspect fit tries past the widest box — astv's aspect search, without its float
 * drift. Its 1-unit minimum step is astv's too, so the search assumes pixel- or astv-scale boxes.
 */
const ASPECT_STEPS = 24;

// Mirrors packSize and packGap in src/layout/pack.ts, which windease does not export.
const usable = (n: number): boolean => Number.isFinite(n) && n > 0;

/** An item's size the way the strategies size it: `natural`, else `hints.preferredSize`. */
function itemSize(item: LayoutItem): Size | null {
  const size = item.natural ?? item.hints?.preferredSize;
  return size && usable(size.w) && usable(size.h) ? size : null;
}

/** An options bag's `gap` the way the strategies read it: a positive finite number, else 0. */
function optionsGap(options: Record<string, unknown>): number {
  const gap = options.gap;
  return typeof gap === 'number' && usable(gap) ? gap : 0;
}

export function packAt(
  packer: Packer,
  items: readonly LayoutItem[],
  width: number,
  options: Record<string, unknown>,
  height = 0,
): Packing {
  const result = packer.strategy.layout({
    items: [...items],
    container: { w: width, h: height },
    state: undefined,
    options,
  });
  let w = 0;
  let h = 0;
  for (const r of result.placements.values()) {
    w = Math.max(w, r.x + r.w);
    h = Math.max(h, r.y + r.h);
  }
  return {
    placements: result.placements,
    unplaced: result.unplaced ?? [],
    bounds: { w, h },
    width,
    height,
  };
}

/** How far a packing's shape is from `ratio`, the same for too wide as for too tall. */
export function aspectScore(packing: Packing, ratio: number): number {
  const { w, h } = packing.bounds;
  return w > 0 && h > 0 ? Math.abs(Math.log(w / h / ratio)) : Number.POSITIVE_INFINITY;
}

export function fitPacking(
  packer: Packer,
  items: readonly LayoutItem[],
  fit: Fit,
  options: Record<string, unknown>,
): Packing {
  if (fit.kind === 'width') return packAt(packer, items, fit.width, options, fit.height);
  const gap = optionsGap(options);
  let widest = 1;
  let total = 0;
  for (const item of items) {
    const size = itemSize(item);
    if (!size) continue;
    widest = Math.max(widest, size.w);
    total += size.w + gap;
  }
  let best = packAt(packer, items, widest, options);
  let bestScore = aspectScore(best, fit.ratio);
  const step = Math.max(1, (total - widest) / ASPECT_STEPS);
  // Integer steps: `width += step` accumulates float error and can land one step short of `total`.
  for (let k = 1; widest + k * step <= total + 1e-9; k++) {
    const width = widest + k * step;
    const packing = packAt(packer, items, width, options);
    const score = aspectScore(packing, fit.ratio);
    if (score < bestScore) {
      best = packing;
      bestScore = score;
    }
  }
  return best;
}
