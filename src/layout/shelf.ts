import type { LayoutResult, LayoutStrategy, Rect } from '../layout-types.js';
import { trace } from '../trace.js';
import {
  fitsContainer,
  fitsWithin,
  PACK_OVERFLOW_MODES,
  PACK_SORTS,
  packBounded,
  packGap,
  packQueue,
  packResult,
} from './pack.js';

/**
 * Packs items at their own size into rows, left to right, starting a new row
 * below the tallest item in the current one when the next would cross the
 * container's width. By default the width is the only bound: rows continue
 * down past `container.h`, and the excess is reported as `overflow`. Under
 * `overflowMode: 'unplaced'` the container is a bin: an item that would cross
 * either edge goes to `unplaced`, and the row stays open for a later item that
 * fits.
 *
 * Items are placed in the order given, or by `sort`, descending by that
 * measure with ties kept in input order. Size is `natural`, else
 * `hints.preferredSize`; an item with neither goes to `unplaced`. Config
 * takes `gap`, `sort` and `overflowMode`.
 * @group Strategies
 */
export const shelfStrategy: LayoutStrategy<void, string> = {
  name: 'shelf',
  configSpec: { gap: 'number', sort: PACK_SORTS, overflowMode: PACK_OVERFLOW_MODES },
  layout({ items, container, options }): LayoutResult<string> {
    const gap = packGap(options);
    const bounded = packBounded(options);
    const { queue } = packQueue(items, options);
    const placed = new Map<string, Rect>();

    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let rows = 0;
    for (const { item, size } of queue) {
      const wraps = x > 0 && !fitsWithin(x + size.w, container.w);
      if (bounded) {
        const at = wraps ? { x: 0, y: y + rowHeight + gap } : { x, y };
        if (!fitsContainer(at.x, at.y, size, container)) continue;
      }
      if (wraps) {
        y += rowHeight + gap;
        x = 0;
        rowHeight = 0;
      }
      if (x === 0) rows++;
      placed.set(item.id, { x, y, z: 0, w: size.w, h: size.h });
      rowHeight = Math.max(rowHeight, size.h);
      x += size.w + gap;
    }

    const result = packResult(items, placed, container);
    trace(
      'layout',
      `shelf: ${placed.size} of ${items.length} in ${rows} rows at w=${container.w}, gap ${gap}, sort ${String(options.sort ?? 'none')}`,
      { unplaced: result.unplaced, overflow: result.overflow },
    );
    return result;
  },
};
