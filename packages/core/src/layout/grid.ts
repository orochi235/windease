import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import type { WindowId } from '../window.js';

interface GridConfig {
  cols?: number;
  rows?: number;
  /**
   * Caps for the auto-balance pass. Ignored when the corresponding explicit
   * dimension (cols/rows) is set. When both maxCols and maxRows are set,
   * items beyond maxCols * maxRows go to `unplaced`.
   */
  maxCols?: number;
  maxRows?: number;
  /**
   * When neither cols nor rows is set, auto-balance the grid so it stays as
   * square as possible. 'wide' (default) biases toward more columns when the
   * count isn't a perfect square; 'tall' biases toward more rows.
   */
  orientation?: 'wide' | 'tall';
  gap?: number;
  padding?: number;
}

export const gridStrategy: LayoutStrategy<void, WindowId> = {
  name: 'grid',
  layout({
    items,
    container,
    options,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
  }): LayoutResult<WindowId> {
    const cfg = options as GridConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<WindowId, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const maxCols = cfg.maxCols !== undefined ? Math.max(1, cfg.maxCols) : undefined;
    const maxRows = cfg.maxRows !== undefined ? Math.max(1, cfg.maxRows) : undefined;

    let cols: number;
    let rowCap: number | undefined;
    if (cfg.cols !== undefined) {
      // Explicit cols wins; maxCols is ignored. maxRows still caps row count.
      cols = Math.max(1, cfg.cols);
      rowCap = maxRows;
    } else if (cfg.rows !== undefined) {
      // Explicit rows wins; maxRows is ignored. maxCols still caps col count.
      const fixedRows = Math.max(1, cfg.rows);
      const needed = Math.ceil(items.length / fixedRows);
      cols = maxCols !== undefined ? Math.min(maxCols, needed) : needed;
      cols = Math.max(1, cols);
      rowCap = fixedRows;
    } else {
      const root = Math.sqrt(items.length);
      const ideal =
        (cfg.orientation ?? 'wide') === 'tall' ? Math.floor(root) || 1 : Math.ceil(root);
      cols = maxCols !== undefined ? Math.min(maxCols, ideal) : ideal;
      cols = Math.max(1, cols);
      rowCap = maxRows;
    }

    const capacity = rowCap !== undefined ? cols * rowCap : Number.POSITIVE_INFINITY;
    const placedCount = Math.min(items.length, capacity);
    const rows = Math.max(1, Math.ceil(placedCount / cols));

    const usableW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding;
    const cellW = (usableW - gap * (cols - 1)) / cols;
    const cellH = (usableH - gap * (rows - 1)) / rows;

    for (let i = 0; i < placedCount; i++) {
      const item = items[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      placements.set(item.id as WindowId, {
        x: padding + col * (cellW + gap),
        y: padding + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }

    const unplaced: WindowId[] = [];
    for (let i = placedCount; i < items.length; i++) {
      unplaced.push(items[i]!.id as WindowId);
    }

    const result: LayoutResult<WindowId> = { placements, affordances: [] };
    if (unplaced.length > 0) result.unplaced = unplaced;
    return result;
  },
};
