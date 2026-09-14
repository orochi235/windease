import type { LayoutItem } from '#windease/layout-types.js';
import type { Fit, Packer, Packing } from './types.js';

/** Widths an aspect fit tries past the widest box — astv's aspect search, kept identical. */
const ASPECT_STEPS = 24;

export function packAt(
  packer: Packer,
  items: readonly LayoutItem[],
  width: number,
  options: Record<string, unknown>,
): Packing {
  const result = packer.strategy.layout({
    items: [...items],
    container: { w: width, h: 0 },
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
  if (fit.kind === 'width') return packAt(packer, items, fit.width, options);
  const gap = typeof options.gap === 'number' ? options.gap : 0;
  let widest = 1;
  let total = 0;
  for (const item of items) {
    const w = (item.natural ?? item.hints?.preferredSize)?.w ?? 0;
    widest = Math.max(widest, w);
    total += w + gap;
  }
  let best = packAt(packer, items, widest, options);
  let bestScore = aspectScore(best, fit.ratio);
  const step = Math.max(1, (total - widest) / ASPECT_STEPS);
  for (let width = widest + step; width <= total; width += step) {
    const packing = packAt(packer, items, width, options);
    const score = aspectScore(packing, fit.ratio);
    if (score < bestScore) {
      best = packing;
      bestScore = score;
    }
  }
  return best;
}
