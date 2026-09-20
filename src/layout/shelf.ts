import type { LayoutResult, LayoutStrategy, Rect } from '../layout-types.js';
import { trace } from '../trace.js';
import {
  fitsWithin,
  PACK_OVERFLOW_MODES,
  PACK_SORTS,
  type PackTurn,
  packBounded,
  packGap,
  packLeast,
  packPocketPass,
  packQueue,
  packResult,
  packRotate,
  packTurns,
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
 * With `rotate: true` an item may be turned a quarter where that fits it into
 * the current row: of the ways that fit the row's remaining width without
 * raising it, the narrower wins, upright on a tie. An item that fits neither
 * way goes upright, raising the row, if it fits the width, and otherwise
 * starts a new one. An item is also turned when only turned does it fit the
 * container at all. Each placement then carries a `rotation` channel, 90 or 0.
 *
 * Items are placed in the order given, or by `sort`, descending by that
 * measure with ties kept in input order. Size is `natural`, else
 * `hints.preferredSize`; an item with neither goes to `unplaced`. Config
 * takes `gap`, `sort`, `rotate`, `overflowMode` and `pocket`.
 *
 * `pocket: { w, h }` holds back every item whose width and height are both
 * under that size and packs them together into the largest empty rectangle
 * this pass leaves, instead of each taking a spot in the flow.
 * @group Strategies
 */
export const shelfStrategy: LayoutStrategy<void, string> = {
  name: 'shelf',
  configSpec: {
    gap: 'number',
    sort: PACK_SORTS,
    rotate: 'boolean',
    overflowMode: PACK_OVERFLOW_MODES,
    pocket: 'object',
  },
  layout({ items, container, options }): LayoutResult<string> {
    const pocket = packPocketPass(shelfStrategy, { items, container, options });
    if (pocket) return pocket;

    const gap = packGap(options);
    const bounded = packBounded(options);
    const rotate = packRotate(options);
    const { queue } = packQueue(items, options);
    const placed = new Map<string, Rect>();
    const turned = new Set<string>();

    let x = 0;
    let y = 0;
    let rowHeight = 0;
    let rows = 0;
    const below = (top: number, turn: PackTurn) =>
      !bounded || fitsWithin(top + turn.h, container.h);

    for (const { item, size } of queue) {
      const turns = packTurns(size, rotate);
      let turn: PackTurn | null = null;
      if (x > 0) {
        const fit = turns.filter((t) => fitsWithin(x + t.w, container.w) && below(y, t));
        const under = fit.filter((t) => fitsWithin(t.h, rowHeight));
        turn = packLeast(under, (t) => t.w) ?? fit.find((t) => !t.turned) ?? null;
      }
      if (!turn) {
        const top = x > 0 ? y + rowHeight + gap : y;
        const fit = turns.find((t) => fitsWithin(t.w, container.w) && below(top, t));
        turn = fit ?? (bounded ? null : turns[0]!);
        if (!turn) continue;
        if (x > 0) {
          y = top;
          x = 0;
          rowHeight = 0;
        }
      }
      if (x === 0) rows++;
      placed.set(item.id, { x, y, z: 0, w: turn.w, h: turn.h });
      if (turn.turned) turned.add(item.id);
      rowHeight = Math.max(rowHeight, turn.h);
      x += turn.w + gap;
    }

    const result = packResult(items, placed, container, rotate ? turned : null);
    trace(
      'layout',
      `shelf: ${placed.size} of ${items.length} in ${rows} rows at w=${container.w}, gap ${gap}, sort ${String(options.sort ?? 'none')}${rotate ? `, ${turned.size} turned` : ''}`,
      { unplaced: result.unplaced, overflow: result.overflow },
    );
    return result;
  },
};
