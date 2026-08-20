import type { LayoutItem, LayoutResult, LayoutStrategy, Rect, Size } from '../layout-types.js';

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

/** cols/rowCap resolution shared by `canAccept`/`getDropPreview`. Unlike
 *  `layout()`'s own resolution, this ignores `fill` — capacity doesn't care
 *  how underfull cells are drawn, only how many exist. */
function resolveCapacityDims(
  cfg: GridConfig,
  itemCount: number,
): { cols: number; rowCap: number | undefined } {
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
    const ideal = (cfg.orientation ?? 'wide') === 'tall' ? Math.floor(root) || 1 : Math.ceil(root);
    cols = maxCols !== undefined ? Math.min(maxCols, ideal) : ideal;
    cols = Math.max(1, cols);
    rowCap = maxRows;
  }
  return { cols, rowCap };
}

/** An item's span clamped so it never exceeds the grid's own dimensions. */
function clampSpan(
  item: LayoutItem,
  cols: number,
  rowCap: number | undefined,
): { cols: number; rows: number } {
  const span = item.placement?.span;
  const c = Math.max(1, Math.min(Math.floor(span?.cols ?? 1), cols));
  const rawRows = Math.max(1, Math.floor(span?.rows ?? 1));
  const r = rowCap !== undefined ? Math.min(rawRows, rowCap) : rawRows;
  return { cols: c, rows: r };
}

function totalCellsRequested(items: LayoutItem[], cols: number, rowCap: number): number {
  let sum = 0;
  for (const item of items) {
    const span = clampSpan(item, cols, rowCap);
    sum += span.cols * span.rows;
  }
  return sum;
}

function fitsCapacity(cfg: GridConfig, items: LayoutItem[]): boolean {
  const hasGridCap = cfg.maxCols !== undefined || cfg.maxRows !== undefined;
  if (cfg.maxItems !== undefined && hasGridCap) {
    throw new Error('gridStrategy: maxItems is mutually exclusive with maxCols/maxRows');
  }
  if (cfg.maxItems !== undefined) return items.length <= Math.max(1, cfg.maxItems);
  const { cols, rowCap } = resolveCapacityDims(cfg, items.length);
  if (rowCap === undefined) return true;
  // O(n) approximation: sums requested cells against total grid capacity,
  // ignoring row-wrap fragmentation. `canAccept` runs on every drag
  // pointermove and can't afford a full reservation pack; `layout()` still
  // pushes anything that doesn't actually fit to `unplaced`.
  return totalCellsRequested(items, cols, rowCap) <= cols * rowCap;
}

interface ReservedCell {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

function isPinned(item: LayoutItem): boolean {
  return typeof item.meta?.pinned === 'number';
}

/** Pinned items win the capacity race, in childOrder; unpinned fill what's
 *  left, also in childOrder. Mirrors `selectByCapacity`'s priority, but
 *  drives cell reservation instead of a flat count. */
function byCapacityPriority(items: LayoutItem[]): LayoutItem[] {
  const pinned = items.filter(isPinned);
  const unpinned = items.filter((it) => !isPinned(it));
  return [...pinned, ...unpinned];
}

/**
 * Row-major cell reservation: walks `order`, and for each item finds the
 * first free cell block its (clamped) span fits, reserving it. Items beyond
 * `itemCap`, or whose span can't fit before `rowCap` runs out, are omitted.
 */
function reserveCells(
  order: LayoutItem[],
  cols: number,
  rowCap: number | undefined,
  itemCap: number,
): Map<string, ReservedCell> {
  const occupied = new Set<string>();
  const placed = new Map<string, ReservedCell>();
  const fits = (col: number, row: number, cSpan: number, rSpan: number): boolean => {
    for (let dr = 0; dr < rSpan; dr++) {
      for (let dc = 0; dc < cSpan; dc++) {
        if (occupied.has(`${col + dc},${row + dr}`)) return false;
      }
    }
    return true;
  };
  for (const item of order) {
    if (placed.size >= itemCap) continue;
    const { cols: cSpan, rows: rSpan } = clampSpan(item, cols, rowCap);
    let at: { col: number; row: number } | undefined;
    for (let row = 0; rowCap === undefined || row + rSpan <= rowCap; row++) {
      for (let col = 0; col + cSpan <= cols; col++) {
        if (fits(col, row, cSpan, rSpan)) {
          at = { col, row };
          break;
        }
      }
      if (at) break;
    }
    if (!at) continue;
    for (let dr = 0; dr < rSpan; dr++) {
      for (let dc = 0; dc < cSpan; dc++) occupied.add(`${at.col + dc},${at.row + dr}`);
    }
    placed.set(item.id, { col: at.col, row: at.row, cols: cSpan, rows: rSpan });
  }
  return placed;
}

/** @group Strategies */
export const gridStrategy: LayoutStrategy<void, string> = {
  name: 'grid',
  canAccept(items, options): boolean {
    return fitsCapacity(options as GridConfig, items);
  },
  getDropPreview({ items, container, options, insertId, insertIndex, cursor: _cursor }) {
    const cfg = options as GridConfig;
    // Splice ghost in if not already present.
    const ghostAt = items.findIndex((it) => it.id === insertId);
    const projected: LayoutItem[] =
      ghostAt >= 0
        ? items
        : insertIndex !== undefined && insertIndex >= 0 && insertIndex <= items.length
          ? [...items.slice(0, insertIndex), { id: insertId }, ...items.slice(insertIndex)]
          : [...items, { id: insertId }];
    if (!fitsCapacity(cfg, projected)) {
      // Still produce placements (using normal layout) so the host can show
      // the rejection overlay against the current grid.
      const fallback = gridStrategy.layout({
        items,
        container,
        state: undefined,
        options,
      });
      return { placements: fallback.placements, accepted: false };
    }
    const lay = gridStrategy.layout({
      items: projected,
      container,
      state: undefined,
      options,
    });
    return { placements: lay.placements, accepted: true };
  },
  layout({
    items,
    container,
    options,
    preview,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
    preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } };
  }): LayoutResult<string> {
    const cfg = options as GridConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) {
      const empty: LayoutResult<string> = { placements, affordances: [] };
      if (preview) empty.isPreview = true;
      return empty;
    }

    const hasGridCap = cfg.maxCols !== undefined || cfg.maxRows !== undefined;
    if (cfg.maxItems !== undefined && hasGridCap) {
      throw new Error('gridStrategy: maxItems is mutually exclusive with maxCols/maxRows');
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

    const itemCap =
      cfg.maxItems !== undefined ? Math.max(1, cfg.maxItems) : Number.POSITIVE_INFINITY;

    // Two passes: the first (priority order — pins win the capacity race)
    // decides *which* items survive; the second (childOrder) assigns actual
    // cells, so position among the survivors never depends on pin status.
    const priorityPlaced = reserveCells(byCapacityPriority(items), cols, rowCap, itemCap);
    const survivors = items.filter((it) => priorityPlaced.has(it.id));
    const cells = reserveCells(survivors, cols, rowCap, survivors.length);
    const unplaced = items.filter((it) => !cells.has(it.id)).map((it) => it.id);

    let usedRows = 1;
    for (const cell of cells.values()) usedRows = Math.max(usedRows, cell.row + cell.rows);
    const rows = !fill && rowCap !== undefined ? rowCap : usedRows;

    const usableW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding;
    const cellW = (usableW - gap * (cols - 1)) / cols;
    const cellH = (usableH - gap * (rows - 1)) / rows;

    for (const item of items) {
      const cell = cells.get(item.id);
      if (!cell) continue;
      placements.set(item.id, {
        x: padding + cell.col * (cellW + gap),
        y: padding + cell.row * (cellH + gap),
        w: cell.cols * cellW + (cell.cols - 1) * gap,
        h: cell.rows * cellH + (cell.rows - 1) * gap,
      });
    }

    const result: LayoutResult<string> = { placements, affordances: [] };
    if (unplaced.length > 0) result.unplaced = unplaced;
    if (preview) result.isPreview = true;
    return result;
  },
};
