import type { LayoutItem, LayoutPlacement } from '../layout-types.js';

const NONE: LayoutPlacement = Object.freeze({});

/**
 * An item's placement bag, the one way a built-in strategy reads it. Folds in
 * the deprecated `meta` for a caller that builds items by hand and still puts
 * keys there; `placement` wins where both name a key.
 */
export function placementOf(item: LayoutItem): LayoutPlacement {
  const { placement, meta } = item;
  if (meta === undefined || meta === placement) return placement ?? NONE;
  if (placement === undefined) return meta as LayoutPlacement;
  return { ...meta, ...placement };
}

/** A copy of `item` with `patch` over its placement, and no stale `meta` left
 *  to fold back in a key the patch removed. */
export function withPlacement(item: LayoutItem, patch: LayoutPlacement): LayoutItem {
  const { meta: _meta, ...rest } = item;
  return { ...rest, placement: { ...placementOf(item), ...patch } };
}
