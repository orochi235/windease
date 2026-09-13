import type { LayoutResult, LayoutStrategy, Rect } from '../layout-types.js';
import { trace } from '../trace.js';
import { packGap, packResult, packSize } from './pack.js';

interface ColumnConfig {
  gap?: number;
  /** Width of one column. Defaults to the narrowest item's width, so a wider
   *  item spans columns rather than widening every one. */
  columnWidth?: number;
}

/**
 * Masonry: packs items at their own size into equal columns, each item on the
 * run of adjacent columns it spans whose tallest is lowest, leftmost on ties.
 * An item wider than one column spans as many as its width needs, capped at
 * the column count. The container's width sets the column count and is the
 * only bound; columns grow down past `container.h`, and the excess is
 * reported as `overflow`. Items are placed in the order given.
 *
 * Size is `natural`, else `hints.preferredSize`; an item with neither goes to
 * `unplaced`. Config takes `gap` and `columnWidth`.
 * @group Strategies
 */
export const columnStrategy: LayoutStrategy<void, string> = {
  name: 'column',
  configSpec: { gap: 'number', columnWidth: 'number' },
  layout({ items, container, options }): LayoutResult<string> {
    const cfg = options as ColumnConfig;
    const gap = packGap(options);
    const sizes = items.map((item) => packSize(item));

    let narrowest = Number.POSITIVE_INFINITY;
    for (const size of sizes) if (size) narrowest = Math.min(narrowest, size.w);
    const columnWidth =
      typeof cfg.columnWidth === 'number' && Number.isFinite(cfg.columnWidth) && cfg.columnWidth > 0
        ? cfg.columnWidth
        : Number.isFinite(narrowest)
          ? narrowest
          : 0;
    const pitch = columnWidth + gap;
    const count = pitch > 0 ? Math.max(1, Math.floor((container.w + gap) / pitch)) : 1;
    const heights = new Array<number>(count).fill(0);

    const placements = new Map<string, Rect>();
    const unplaced: string[] = [];
    items.forEach((item, i) => {
      const size = sizes[i];
      if (!size) {
        unplaced.push(item.id);
        return;
      }
      const span = Math.min(count, Math.max(1, Math.ceil((size.w + gap) / pitch)));
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
      placements.set(item.id, { x: first * pitch, y: top, z: 0, w: size.w, h: size.h });
      for (let c = first; c < first + span; c++) heights[c] = top + size.h + gap;
    });

    const result = packResult(placements, unplaced, container);
    trace(
      'layout',
      `column: ${placements.size} of ${items.length} in ${count} columns of ${columnWidth} at w=${container.w}, gap ${gap}`,
      { unplaced, overflow: result.overflow },
    );
    return result;
  },
};
