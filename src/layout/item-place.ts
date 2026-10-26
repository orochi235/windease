import type { LayoutItem, Size } from '../layout-types.js';
import { trace } from '../trace.js';

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

/** A drag event's delta with each non-finite axis zeroed. A real pointer cannot produce one;
 *  a zero view scale can, so it is traced rather than applied. */
export function dragDelta(
  label: string,
  payload: { dx?: number; dy?: number },
): { dx: number; dy: number } {
  const { dx, dy } = payload;
  const bad = (n: number | undefined) => n !== undefined && !Number.isFinite(n);
  if (bad(dx) || bad(dy))
    trace('layout', `${label} drag delta (${dx}, ${dy}) is not finite, axis ignored`);
  return { dx: bad(dx) ? 0 : (dx ?? 0), dy: bad(dy) ? 0 : (dy ?? 0) };
}
