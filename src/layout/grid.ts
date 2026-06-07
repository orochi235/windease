import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';


interface GridConfig {
  cols?: number;
  rows?: number;
  /**
   * Caps for the auto-balance pass. Ignored when the corresponding explicit
   * dimension (cols/rows) is set. When both maxCols and maxRows are set,
   * items beyond maxCols * maxRows go to `unplaced`. Mutually exclusive with
   * `maxItems` — setting both throws.
   */
  maxCols?: number;
  maxRows?: number;
  /**
   * Absolute cap on the number of items the zone accepts. Mutually exclusive
   * with `maxCols`/`maxRows`. Items beyond this count go to `unplaced` and
   * the default `canAccept` rejects drops that would overflow it.
   */
  maxItems?: number;
  /**
   * When true (default), cells expand to fill the container even when items
   * don't occupy every slot — e.g. 2 items in a maxCols=2/maxRows=2 grid use
   * a 2×1 layout, each filling half the container's width and the full
   * height. When false, the grid keeps the full configured (or max)
   * dimensions, leaving empty cells when underfilled. Has no effect when
   * neither cfg.cols/cfg.rows nor maxCols/maxRows is set.
   */
  fill?: boolean;
  /**
   * When neither cols nor rows is set, auto-balance the grid so it stays as
   * square as possible. 'wide' (default) biases toward more columns when the
   * count isn't a perfect square; 'tall' biases toward more rows.
   */
  orientation?: 'wide' | 'tall';
  gap?: number;
  padding?: number;
}

function gridCapacity(cfg: GridConfig, itemCount: number): number {
  const hasGridCap = cfg.maxCols !== undefined || cfg.maxRows !== undefined;
  if (cfg.maxItems !== undefined && hasGridCap) {
    throw new Error(
      'gridStrategy: maxItems is mutually exclusive with maxCols/maxRows',
    );
  }
  if (cfg.maxItems !== undefined) return Math.max(1, cfg.maxItems);
  const maxCols = cfg.maxCols !== undefined ? Math.max(1, cfg.maxCols) : undefined;
  const maxRows = cfg.maxRows !== undefined ? Math.max(1, cfg.maxRows) : undefined;
  let cols: number;
  let rowCap: number | undefined;
  if (cfg.cols !== undefined) {
    cols = Math.max(1, cfg.cols);
    rowCap = maxRows;
  } else if (cfg.rows !== undefined) {
    const fixedRows = Math.max(1, cfg.rows);
    const needed = Math.ceil(Math.max(1, itemCount) / fixedRows);
    cols = maxCols !== undefined ? Math.min(maxCols, needed) : needed;
    cols = Math.max(1, cols);
    rowCap = fixedRows;
  } else {
    const root = Math.sqrt(Math.max(1, itemCount));
    const ideal =
      (cfg.orientation ?? 'wide') === 'tall' ? Math.floor(root) || 1 : Math.ceil(root);
    cols = maxCols !== undefined ? Math.min(maxCols, ideal) : ideal;
    cols = Math.max(1, cols);
    rowCap = maxRows;
  }
  return rowCap !== undefined ? cols * rowCap : Number.POSITIVE_INFINITY;
}

/** @group Strategies */
export const gridStrategy: LayoutStrategy<void, string> = {
  name: 'grid',
  canAccept(items, options): boolean {
    const cap = gridCapacity(options as GridConfig, items.length);
    return items.length <= cap;
  },
  layout({
    items,
    container,
    options,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
  }): LayoutResult<string> {
    const cfg = options as GridConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const hasGridCap = cfg.maxCols !== undefined || cfg.maxRows !== undefined;
    if (cfg.maxItems !== undefined && hasGridCap) {
      throw new Error(
        'gridStrategy: maxItems is mutually exclusive with maxCols/maxRows',
      );
    }
    const maxCols = cfg.maxCols !== undefined ? Math.max(1, cfg.maxCols) : undefined;
    const maxRows = cfg.maxRows !== undefined ? Math.max(1, cfg.maxRows) : undefined;
    const fill = cfg.fill ?? true;

    let cols: number;
    let rowCap: number | undefined;
    if (cfg.cols !== undefined) {
      cols = Math.max(1, cfg.cols);
      rowCap = maxRows;
    } else if (cfg.rows !== undefined) {
      const fixedRows = Math.max(1, cfg.rows);
      if (fill) {
        const needed = Math.ceil(items.length / fixedRows);
        cols = maxCols !== undefined ? Math.min(maxCols, needed) : needed;
      } else {
        cols = maxCols ?? Math.max(1, Math.ceil(items.length / fixedRows));
      }
      cols = Math.max(1, cols);
      rowCap = fixedRows;
    } else if (!fill && maxCols !== undefined) {
      // fill=false with max dimensions: lock to the full max grid.
      cols = maxCols;
      rowCap = maxRows;
    } else {
      const root = Math.sqrt(items.length);
      const ideal =
        (cfg.orientation ?? 'wide') === 'tall' ? Math.floor(root) || 1 : Math.ceil(root);
      cols = maxCols !== undefined ? Math.min(maxCols, ideal) : ideal;
      cols = Math.max(1, cols);
      rowCap = maxRows;
    }

    const gridCap = rowCap !== undefined ? cols * rowCap : Number.POSITIVE_INFINITY;
    const itemCap = cfg.maxItems !== undefined ? Math.max(1, cfg.maxItems) : Number.POSITIVE_INFINITY;
    const capacity = Math.min(gridCap, itemCap);
    const placedCount = Math.min(items.length, capacity);
    const rows =
      !fill && rowCap !== undefined
        ? rowCap
        : Math.max(1, Math.ceil(placedCount / cols));

    const usableW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding;
    const cellW = (usableW - gap * (cols - 1)) / cols;
    const cellH = (usableH - gap * (rows - 1)) / rows;

    for (let i = 0; i < placedCount; i++) {
      const item = items[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      placements.set(item.id, {
        x: padding + col * (cellW + gap),
        y: padding + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }

    const unplaced: string[] = [];
    for (let i = placedCount; i < items.length; i++) {
      unplaced.push(items[i]!.id);
    }

    const result: LayoutResult<string> = { placements, affordances: [] };
    if (unplaced.length > 0) result.unplaced = unplaced;
    return result;
  },
};
