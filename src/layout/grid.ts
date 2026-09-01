import type {
  Affordance,
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
  /**
   * When true, emit resize affordances on each placed item's trailing edges.
   * Dragging one writes `placement.span` — cell counts, not pixels, so the
   * extent moves a whole cell at a time. Default false: a grid is a tiling,
   * and a seam that only ever snaps is worth opting into.
   */
  resizable?: boolean;
  /**
   * What to do when the cells the container gives are smaller than the items'
   * `hints.minSize` floors. A grid derives its cells from the container, so
   * unlike a strip it only overflows once something states a floor.
   *
   * `'squeeze'` (default) ignores the floors and divides the container up
   * however small that makes the cells. This is what the strategy has always
   * done.
   *
   * `'scroll'` lays the cells out at their floors and reports the excess as
   * `overflow`, for a host that sizes a scrolling box to it.
   *
   * `'unplace'` keeps the rows that fit at the floors and sends the rest to
   * `unplaced`, composing with the count caps above. A container too narrow
   * for the floors still reports width `overflow`, since dropping rows cannot
   * widen a cell.
   */
  overflowMode?: 'squeeze' | 'scroll' | 'unplace';
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

/**
 * Cols, rows and cell reservations — the whole tiling, which grid derives from
 * the item count, their spans and the config alone. The container never enters
 * here; it only divides the result into cells. `layout`, `gridGeometry` and the
 * public `gridTiling` all resolve dimensions through this, so the three cannot
 * disagree about which item is in which cell.
 */
function resolveTiling(
  items: LayoutItem[],
  cfg: GridConfig,
): {
  cols: number;
  rows: number;
  rowCap: number | undefined;
  itemCap: number;
  cells: Map<string, ReservedCell>;
} {
  const maxCols = cfg.maxCols !== undefined ? Math.max(1, cfg.maxCols) : undefined;
  const maxRows = cfg.maxRows !== undefined ? Math.max(1, cfg.maxRows) : undefined;
  const fill = cfg.fill ?? true;

  if (cfg.maxItems !== undefined && (maxCols !== undefined || maxRows !== undefined)) {
    throw new Error('gridStrategy: maxItems is mutually exclusive with maxCols/maxRows');
  }

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
    const ideal = (cfg.orientation ?? 'wide') === 'tall' ? Math.floor(root) || 1 : Math.ceil(root);
    cols = maxCols !== undefined ? Math.min(maxCols, ideal) : ideal;
    cols = Math.max(1, cols);
    rowCap = maxRows;
  }

  const itemCap = cfg.maxItems !== undefined ? Math.max(1, cfg.maxItems) : Number.POSITIVE_INFINITY;

  // Two passes: the first (priority order — pins win the capacity race)
  // decides *which* items survive; the second (childOrder) assigns actual
  // cells, so position among the survivors never depends on pin status.
  const priorityPlaced = reserveCells(byCapacityPriority(items), cols, rowCap, itemCap);
  const survivors = items.filter((it) => priorityPlaced.has(it.id));
  const cells = reserveCells(survivors, cols, rowCap, survivors.length);

  let usedRows = 1;
  for (const cell of cells.values()) usedRows = Math.max(usedRows, cell.row + cell.rows);
  const rows = !fill && rowCap !== undefined ? rowCap : usedRows;

  return { cols, rows, rowCap, itemCap, cells };
}

/**
 * The tiling `options` produces for `items`: how many columns and rows, with
 * no container involved. A host that sizes a grid from its content — rows
 * times a row height it chooses itself — reads the counts here instead of
 * laying out at a throwaway height and inverting the cell arithmetic to
 * recover them. Grid has no opinion about row height, so it reports counts
 * and not an extent.
 *
 * Empty `items` tiles to `0 x 0`, so a content-sized host gets a zero height
 * rather than one empty row.
 *
 * @group Strategies
 */
export function gridTiling(
  items: LayoutItem[],
  options: Record<string, unknown> = {},
): { cols: number; rows: number } {
  if (items.length === 0) return { cols: 0, rows: 0 };
  const { cols, rows } = resolveTiling(items, options as GridConfig);
  return { cols, rows };
}

/**
 * `resolveTiling` plus the cell sizes the container divides into.
 * `dispatchAffordance` must agree with the pass that drew the affordance — the
 * two computing cells differently is the whole class of bug `placedOf` closes
 * for strip.
 */
function gridGeometry(
  items: LayoutItem[],
  container: Size,
  cfg: GridConfig,
): {
  cols: number;
  rows: number;
  rowCap: number | undefined;
  itemCap: number;
  cellW: number;
  cellH: number;
  cells: Map<string, ReservedCell>;
} | null {
  if (items.length === 0) return null;
  const gap = cfg.gap ?? 0;
  const padding = cfg.padding ?? 0;
  const tiling = resolveTiling(items, cfg);
  const usableW = container.w - 2 * padding;
  const usableH = container.h - 2 * padding;
  return {
    ...tiling,
    cellW: (usableW - gap * (tiling.cols - 1)) / tiling.cols,
    cellH: (usableH - gap * (tiling.rows - 1)) / tiling.rows,
  };
}

/**
 * The largest span `id` can take on each axis without pushing any sibling out
 * of the grid. A grid packs rather than pairing, so growing an item costs
 * whoever no longer fits — the honest ceiling is the last span at which
 * everyone is still placed.
 */
function spanReach(
  items: LayoutItem[],
  id: string,
  cols: number,
  rowCap: number | undefined,
  itemCap: number,
): { cols: number; rows: number } {
  // An unbounded grid grows a row rather than dropping anyone, so fitting is
  // tested against the *cap*, not against however many rows happen to be in
  // use. Capping at the current count would report a ceiling of 1 for every
  // item in a full auto-balanced grid, which can always grow.
  const fitRows = rowCap ?? Number.POSITIVE_INFINITY;
  const fits = (axis: 'cols' | 'rows', value: number): boolean => {
    const probe = items.map((it) =>
      it.id === id
        ? {
            ...it,
            placement: {
              ...it.placement,
              span: { ...it.placement?.span, [axis]: value },
            },
          }
        : it,
    );
    return (
      reserveCells(probe, cols, fitRows, itemCap).size ===
      reserveCells(items, cols, fitRows, itemCap).size
    );
  };
  const reachOn = (axis: 'cols' | 'rows', cap: number): number => {
    let best = 1;
    for (let v = 1; v <= cap; v++) if (fits(axis, v)) best = v;
    return best;
  };
  return {
    cols: reachOn('cols', cols),
    // Unbounded rows still need a finite probe: nothing can usefully span more
    // rows than there are items.
    rows: reachOn('rows', rowCap ?? items.length),
  };
}

/**
 * Lays children out in a uniform grid, filling rows left to right. Config
 * takes `cols` / `rows`, `gap` and `padding`; capping either dimension makes
 * the overflow `unplaced` rather than shrinking cells.
 *
 * Reads `placement.span` for children that should cover several cells.
 * @group Strategies
 */
export const gridStrategy: LayoutStrategy<void, string> = {
  name: 'grid',
  configSpec: {
    cols: 'number',
    rows: 'number',
    maxCols: 'number',
    maxRows: 'number',
    maxItems: 'number',
    fill: 'boolean',
    orientation: ['wide', 'tall'],
    gap: 'number',
    padding: 'number',
    resizable: 'boolean',
    overflowMode: ['squeeze', 'scroll', 'unplace'],
  },
  configConflicts: [
    { kind: 'exclusive', keys: ['maxItems', 'maxCols', 'maxRows'] },
    { kind: 'ignored', key: 'rows', when: ['cols'] },
    { kind: 'ignored', key: 'maxCols', when: ['cols'] },
    { kind: 'ignored', key: 'maxRows', when: ['rows'] },
    { kind: 'ignored', key: 'orientation', when: ['cols', 'rows'] },
  ],
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

    const { cols, rows, rowCap, itemCap, cells } = resolveTiling(items, cfg);
    const unplaced = items.filter((it) => !cells.has(it.id)).map((it) => it.id);

    const usableW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding;
    const mode = cfg.overflowMode ?? 'squeeze';
    const floor = (axis: 'w' | 'h') =>
      mode === 'squeeze' ? 0 : Math.max(0, ...items.map((it) => it.hints?.minSize?.[axis] ?? 0));
    const floorW = floor('w');
    const floorH = floor('h');

    const heightFor = (r: number) => Math.max((usableH - gap * (r - 1)) / r, floorH);
    let rowsUsed = rows;
    let cellH = heightFor(rowsUsed);

    if (mode === 'unplace' && cellH * rowsUsed + gap * (rowsUsed - 1) > usableH) {
      // The first row is placed even when it does not fit, so an overflowing
      // grid never renders empty — same rule strip follows.
      rowsUsed = Math.max(1, Math.floor((usableH + gap) / (heightFor(1) + gap)));
      for (const [id, cell] of [...cells]) {
        if (cell.row < rowsUsed) continue;
        cells.delete(id);
        unplaced.push(id);
      }
      cellH = heightFor(rowsUsed);
    }

    const cellW = Math.max((usableW - gap * (cols - 1)) / cols, floorW);
    const excessW = Math.max(0, cellW * cols + gap * (cols - 1) - usableW);
    const excessH = Math.max(0, cellH * rowsUsed + gap * (rowsUsed - 1) - usableH);

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

    const affordances: Affordance[] = [];
    if (cfg.resizable && !preview) {
      for (const item of items) {
        const cell = cells.get(item.id);
        const rect = placements.get(item.id);
        if (!cell || !rect) continue;
        const reach = spanReach(items, item.id, cols, rowCap, itemCap);
        // Emit when the span can move at all, in either direction. Keying on
        // "a cell follows this one" instead would drop the handle from an item
        // spanning to the edge, leaving it grown with no way back.
        if (reach.cols > 1 || cell.cols > 1) {
          affordances.push({
            id: `resize-x-${item.id}`,
            kind: 'resize-x',
            rect: { x: rect.x + rect.w - 2, y: rect.y, w: 4, h: rect.h },
            cursor: 'ew-resize',
            childId: item.id,
            affects: [item.id],
            bounds: {
              orientation: 'horizontal',
              valueNow: cell.cols,
              valueMin: 1,
              valueMax: reach.cols,
              atMin: cell.cols <= 1,
              atMax: cell.cols >= reach.cols,
              step: 1,
            },
          });
        }
        if (reach.rows > 1 || cell.rows > 1) {
          affordances.push({
            id: `resize-y-${item.id}`,
            kind: 'resize-y',
            rect: { x: rect.x, y: rect.y + rect.h - 2, w: rect.w, h: 4 },
            cursor: 'ns-resize',
            childId: item.id,
            affects: [item.id],
            bounds: {
              orientation: 'vertical',
              valueNow: cell.rows,
              valueMin: 1,
              valueMax: reach.rows,
              atMin: cell.rows <= 1,
              atMax: cell.rows >= reach.rows,
              step: 1,
            },
          });
        }
      }
    }

    const result: LayoutResult<string> = { placements, affordances };
    if (excessW > 0 || excessH > 0) result.overflow = { w: excessW, h: excessH };
    if (unplaced.length > 0) result.unplaced = unplaced;
    if (preview) result.isPreview = true;
    return result;
  },

  dispatchAffordance({ event, affordance, store, items, container, options }) {
    if (event.kind !== 'drag') return;
    if (affordance.kind !== 'resize-x' && affordance.kind !== 'resize-y') return;
    const childId = affordance.childId;
    if (!childId) return;
    const axis: 'cols' | 'rows' = affordance.kind === 'resize-x' ? 'cols' : 'rows';

    const cfg = options as GridConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;
    const geom = gridGeometry(items, container, cfg);
    if (!geom) return;
    const cell = geom.cells.get(String(childId));
    if (!cell) return;

    const stride = axis === 'cols' ? geom.cellW + gap : geom.cellH + gap;
    if (stride <= 0) return;
    const current = axis === 'cols' ? cell.cols : cell.rows;

    let want: number;
    const point = event.payload.point;
    if (point) {
      // Resolve against the pointer rather than accumulating deltas. A span is
      // quantized, so a few pixels rounds to the span it already has and the
      // drag would never move at all.
      const origin = axis === 'cols' ? padding + cell.col * stride : padding + cell.row * stride;
      const extent = (axis === 'cols' ? point.x : point.y) - origin;
      want = Math.round((extent + gap) / stride);
    } else {
      // No pointer: a synthesized step. `bounds.step` is 1, so the host sends
      // one cell's worth and this reads as ±1.
      const delta = axis === 'cols' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
      want = current + Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / stride));
    }

    const reach = spanReach(items, String(childId), geom.cols, geom.rowCap, geom.itemCap);
    const ceiling = axis === 'cols' ? reach.cols : reach.rows;
    const next = Math.max(1, Math.min(want, ceiling));
    if (next === current) return;

    const existing = (store.getNode(childId as never)?.membership?.placement?.span ?? {}) as {
      cols?: number;
      rows?: number;
    };
    store.patchPlacement(childId as never, { span: { ...existing, [axis]: next } });
  },
};
