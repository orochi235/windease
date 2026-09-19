import type { LayoutItem } from '../layout-types.js';

/** The values `placement.layer` accepts. Any other value is the normal layer. */
export const PLACEMENT_LAYERS = ['top'] as const;

/** Whether an item asked, through `placement.layer`, to draw above the normal layer. */
export function onTopLayer(item: LayoutItem): boolean {
  return item.meta?.layer === 'top';
}
