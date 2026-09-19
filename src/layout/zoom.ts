import type { LayoutItem, LayoutResult, Rect, Size } from '../layout-types.js';
import { trace } from '../trace.js';

/** The child `zoom` names, when it names one of `items`. */
export function zoomedOf(items: LayoutItem[], zoom: unknown): LayoutItem | undefined {
  if (typeof zoom !== 'string') return undefined;
  const hit = items.find((it) => it.id === zoom);
  if (!hit) trace('layout', `zoom: ${zoom} is not a visible child; laying out unzoomed`);
  return hit;
}

/** `zoomed` over `inset`, every other item withheld. Shared by strip and stack. */
export function zoomLayout(
  items: LayoutItem[],
  zoomed: LayoutItem,
  container: Size,
  inset: number,
): LayoutResult<string> {
  const placements = new Map<string, Rect>([
    [
      zoomed.id,
      {
        x: inset,
        y: inset,
        z: 0,
        w: Math.max(0, container.w - 2 * inset),
        h: Math.max(0, container.h - 2 * inset),
      },
    ],
  ]);
  const result: LayoutResult<string> = { placements, affordances: [] };
  const unplaced = items.filter((it) => it !== zoomed).map((it) => it.id);
  if (unplaced.length > 0) result.unplaced = unplaced;
  trace('layout', `zoom: ${zoomed.id} fills, ${unplaced.length} withheld`);
  return result;
}
