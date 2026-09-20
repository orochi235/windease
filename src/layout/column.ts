import type { LayoutResult, LayoutStrategy, Rect } from '../layout-types.js';
import { trace } from '../trace.js';
import {
  fitsContainer,
  fitsWithin,
  PACK_EPSILON,
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

interface ColumnConfig {
  gap?: number;
  /** Width of one column. Defaults to the narrowest item's width, so a wider
   *  item spans columns rather than widening every one. */
  columnWidth?: number;
  /** A fixed column count, the columns widened to fill the container. */
  cols?: number;
  /** Where the columns sit in the width they leave, when they do not fill it. */
  justify?: 'start' | 'center' | 'end';
}

/** `cols` as a count, or null when it is not a finite number of at least one. */
function fixedCount(cols: unknown): number | null {
  return typeof cols === 'number' && Number.isFinite(cols) && cols >= 1 ? Math.floor(cols) : null;
}

/**
 * Masonry: packs items at their own size into equal columns, each item on the
 * run of adjacent columns it spans whose tallest is lowest, leftmost on ties.
 * An item wider than one column spans as many as its width needs, capped at
 * the column count. The container's width sets the column count. By default
 * it is the only bound; columns grow down past `container.h`, and the excess
 * is reported as `overflow`. Under `overflowMode: 'unplaced'` the container is
 * a bin, and an item that would cross either edge on its lowest run goes to
 * `unplaced`.
 *
 * `cols` fixes the column count instead, and widens the columns to fill the
 * container between `gap`s; it cannot be combined with `columnWidth`. When
 * the columns do not fill the width, `justify` places them in what is left:
 * `'start'` (default), `'center'` or `'end'`.
 *
 * With `rotate: true` an item may be turned a quarter: it takes whichever way
 * spans fewer columns without making the tallest column taller than the other
 * way would, then whichever leaves its bottom edge higher, upright on a tie. A
 * way that fits the width beats one that does not. The
 * default column width still comes from the items upright. Each placement
 * then carries a `rotation` channel, 90 or 0.
 *
 * Items are placed in the order given, or by `sort`, descending by that
 * measure with ties kept in input order. Size is `natural`, else
 * `hints.preferredSize`; an item with neither goes to `unplaced`. Config
 * takes `gap`, `sort`, `rotate`, `overflowMode`, `columnWidth`, `cols`,
 * `justify` and `pocket`.
 *
 * `pocket: { w, h }` holds back every item whose width and height are both
 * under that size and packs them together into the largest empty rectangle
 * this pass leaves, instead of each taking a spot in the flow.
 * @group Strategies
 */
export const columnStrategy: LayoutStrategy<void, string> = {
  name: 'column',
  configSpec: {
    gap: 'number',
    sort: PACK_SORTS,
    rotate: 'boolean',
    overflowMode: PACK_OVERFLOW_MODES,
    columnWidth: 'number',
    cols: 'number',
    justify: ['start', 'center', 'end'],
    pocket: 'object',
  },
  configConflicts: [
    { kind: 'exclusive', keys: ['cols', 'columnWidth'] },
    { kind: 'ignored', key: 'justify', when: ['cols'] },
  ],
  layout({ items, container, options }): LayoutResult<string> {
    const pocket = packPocketPass(columnStrategy, { items, container, options });
    if (pocket) return pocket;

    const cfg = options as ColumnConfig;
    const gap = packGap(options);
    const bounded = packBounded(options);
    const rotate = packRotate(options);
    const { queue } = packQueue(items, options);

    const fixed = fixedCount(cfg.cols);
    let narrowest = Number.POSITIVE_INFINITY;
    for (const { size } of queue) narrowest = Math.min(narrowest, size.w);
    const columnWidth =
      fixed !== null
        ? Math.max(0, (container.w - (fixed - 1) * gap) / fixed)
        : typeof cfg.columnWidth === 'number' &&
            Number.isFinite(cfg.columnWidth) &&
            cfg.columnWidth > 0
          ? cfg.columnWidth
          : Number.isFinite(narrowest)
            ? narrowest
            : 0;
    const pitch = columnWidth + gap;
    const count =
      fixed ??
      (pitch > 0 ? Math.max(1, Math.floor((container.w + gap + PACK_EPSILON) / pitch)) : 1);
    const free = fixed !== null ? 0 : Math.max(0, container.w - (count * pitch - gap));
    const lead = cfg.justify === 'center' ? free / 2 : cfg.justify === 'end' ? free : 0;
    const heights = new Array<number>(count).fill(0);
    let tallest = 0;

    /** The lowest run of columns `turn` spans, leftmost on ties. */
    const lowestRun = (turn: PackTurn) => {
      const span = Math.min(count, Math.max(1, Math.ceil((turn.w + gap - PACK_EPSILON) / pitch)));
      let first = 0;
      let top = Number.POSITIVE_INFINITY;
      for (let start = 0; start + span <= count; start++) {
        let runTop = 0;
        for (let c = start; c < start + span; c++) runTop = Math.max(runTop, heights[c] ?? 0);
        if (runTop < top) {
          top = runTop;
          first = start;
        }
      }
      const x = Math.min(lead + first * pitch, Math.max(0, container.w - turn.w));
      return { turn, span, first, x, top };
    };

    const placed = new Map<string, Rect>();
    const turned = new Set<string>();
    for (const { item, size } of queue) {
      const runs = packTurns(size, rotate)
        .map(lowestRun)
        .filter((r) => !bounded || fitsContainer(r.x, r.top, r.turn, container));
      const best = packLeast(
        runs,
        (r) => (fitsWithin(r.turn.w, container.w) ? 0 : 1),
        (r) => Math.max(tallest, r.top + r.turn.h + gap),
        (r) => r.span,
        (r) => r.top + r.turn.h,
      );
      if (!best) continue;
      const { turn, span, first, x, top } = best;
      placed.set(item.id, { x, y: top, z: 0, w: turn.w, h: turn.h });
      if (turn.turned) turned.add(item.id);
      for (let c = first; c < first + span; c++) heights[c] = top + turn.h + gap;
      tallest = Math.max(tallest, top + turn.h + gap);
    }

    const result = packResult(items, placed, container, rotate ? turned : null);
    trace(
      'layout',
      `column: ${placed.size} of ${items.length} in ${count} columns of ${columnWidth} at w=${container.w}${lead > 0 ? ` from x=${lead}` : ''}, gap ${gap}, sort ${String(options.sort ?? 'none')}${rotate ? `, ${turned.size} turned` : ''}`,
      { unplaced: result.unplaced, overflow: result.overflow },
    );
    return result;
  },
};
