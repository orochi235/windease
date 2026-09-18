import type { LayoutResult, LayoutStrategy, Rect } from '../layout-types.js';
import { trace } from '../trace.js';
import { fitsWithin, packGap, packResult, packSize } from './pack.js';

/**
 * Packs items at their own size into rows, left to right, starting a new row
 * below the tallest item in the current one when the next would cross the
 * container's width. The width is the only bound: rows continue down past
 * `container.h`, and the excess is reported as `overflow`. Items are placed in
 * the order given; sorting them is the caller's call.
 *
 * Size is `natural`, else `hints.preferredSize`; an item with neither goes to
 * `unplaced`. Config takes `gap`.
 * @group Strategies
 */
export const shelfStrategy: LayoutStrategy<void, string> = {
  name: 'shelf',
  configSpec: { gap: 'number' },
  layout({ items, container, options }): LayoutResult<string> {
    const gap = packGap(options);
    const placements = new Map<string, Rect>();
    const unplaced: string[] = [];

    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let rows = 0;
    for (const item of items) {
      const size = packSize(item);
      if (!size) {
        unplaced.push(item.id);
        continue;
      }
      if (x > 0 && !fitsWithin(x + size.w, container.w)) {
        y += rowHeight + gap;
        x = 0;
        rowHeight = 0;
      }
      if (x === 0) rows++;
      placements.set(item.id, { x, y, z: 0, w: size.w, h: size.h });
      rowHeight = Math.max(rowHeight, size.h);
      x += size.w + gap;
    }

    const result = packResult(placements, unplaced, container);
    trace(
      'layout',
      `shelf: ${placements.size} of ${items.length} in ${rows} rows at w=${container.w}, gap ${gap}`,
      { unplaced, overflow: result.overflow },
    );
    return result;
  },
};
