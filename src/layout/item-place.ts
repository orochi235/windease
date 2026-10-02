import type { LayoutItem, Size } from '../layout-types.js';

/** The size an item shows at: its stored `placement.size`, else its natural size, else its
 *  preferred one. Null when either side is missing or not a positive finite number. */
export function itemSize(item: LayoutItem): Size | null {
  const w = item.placement?.size?.w ?? item.natural?.w ?? item.hints?.preferredSize?.w;
  const h = item.placement?.size?.h ?? item.natural?.h ?? item.hints?.preferredSize?.h;
  const usable = (n: number | undefined): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n > 0;
  return usable(w) && usable(h) ? { w, h } : null;
}

/** The spot an item asks for in its placement `x` / `y`. Null unless both are finite numbers. */
export function itemWant(item: LayoutItem): { x: number; y: number } | null {
  const { x, y } = item.meta ?? {};
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : null;
}
