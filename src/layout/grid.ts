import type {
  Affordance,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import { trace } from '../trace.js';

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
   * `'unplaced'` keeps the rows that fit at the floors and sends the rest to
   * `unplaced`, composing with the count caps above. A container too narrow
   * for the floors still reports width `overflow`, since dropping rows cannot
   * widen a cell.
   */
  overflowMode?: 'squeeze' | 'scroll' | 'unplaced';
}

/** An item's `placement.cell`, floored — or undefined when it has none, or
 *  one that isn't two finite, non-negative numbers. */
function explicitCell(item: LayoutItem): { col: number; row: number } | undefined {
  const cell = item.placement?.cell;
  if (!cell) return undefined;
  const { col, row } = cell;
  if (!Number.isFinite(col) || !Number.isFinite(row) || col < 0 || row < 0) return undefined;
  return { col: Math.floor(col), row: Math.floor(row) };
}

/** The numeric keys grid reads, each a whole count of at least 1 — or
 *  undefined when absent or not finite, so a NaN or Infinity reads as unset. */
interface GridDims {
  cols: number | undefined;
  rows: number | undefined;
  maxCols: number | undefined;
  maxRows: number | undefined;
  maxItems: number | undefined;
}

function readDims(cfg: GridConfig): GridDims {
  const read = (key: keyof GridDims): number | undefined => {
    const v = cfg[key];
    if (v === undefined) return undefined;
    if (typeof v === 'number' && !Number.isFinite(v)) {
      trace('layout', `grid: config ${key} is ${v}, ignored`);
      return undefined;
    }
    return Math.max(1, Math.floor(v));
  };
  const dims: GridDims = {
    cols: read('cols'),
    rows: read('rows'),
    maxCols: read('maxCols'),
    maxRows: read('maxRows'),
    maxItems: read('maxItems'),
  };
  if (dims.maxItems !== undefined && (dims.maxCols !== undefined || dims.maxRows !== undefined)) {
    throw new Error('gridStrategy: maxItems is mutually exclusive with maxCols/maxRows');
  }
  return dims;
}

/** One span axis as a whole cell count: at least 1, at most `limit`. An
 *  infinite span fills a bounded axis; any other non-finite value reads as 1. */
function wholeSpan(
  v: number | undefined,
  limit: number | undefined,
  id: string,
  axis: 'cols' | 'rows',
): number {
  if (v === undefined) return 1;
  if (!Number.isFinite(v)) {
    const clamped = v === Number.POSITIVE_INFINITY && limit !== undefined ? limit : 1;
    trace('layout', `grid: ${id} span.${axis} is ${v}, clamped to ${clamped}`);
    return clamped;
  }
  const n = Math.max(1, Math.floor(v));
  return limit !== undefined ? Math.min(n, limit) : n;
}

/** An item's span clamped so it never exceeds the grid's own dimensions. */
function clampSpan(
  item: LayoutItem,
  cols: number,
  rowCap: number | undefined,
): { cols: number; rows: number } {
  const span = item.placement?.span;
  return {
    cols: wholeSpan(span?.cols, cols, item.id, 'cols'),
    rows: wholeSpan(span?.rows, rowCap, item.id, 'rows'),
  };
}

/** Cells `items` ask for, with spans clamped to whichever bounds are known. */
function requestedArea(
  items: LayoutItem[],
  colLimit: number | undefined,
  rowCap: number | undefined,
): number {
  let sum = 0;
  for (const item of items) {
    const span = item.placement?.span;
    sum +=
      wholeSpan(span?.cols, colLimit, item.id, 'cols') *
      wholeSpan(span?.rows, rowCap, item.id, 'rows');
  }
  return sum;
}

/**
 * The column count a layout starts from, the most it may grow to, and the row
 * cap. `colLimit` is Infinity when nothing caps the columns — a fixed `rows`
 * or a lone `maxRows` — so a grid whose rows are full grows sideways instead
 * of dropping items.
 */
function resolveDims(
  items: LayoutItem[],
  dims: GridDims,
  fill: boolean,
  orientation: 'wide' | 'tall',
): { cols: number; rowCap: number | undefined; colLimit: number } {
  if (dims.cols !== undefined) {
    return { cols: dims.cols, rowCap: dims.maxRows, colLimit: dims.cols };
  }
  const rowCap = dims.rows ?? dims.maxRows;
  const colLimit = dims.maxCols ?? Number.POSITIVE_INFINITY;
  // fill=false with max dimensions: lock to the full max grid.
  if (!fill && dims.maxCols !== undefined) return { cols: dims.maxCols, rowCap, colLimit };
  let cols = 1;
  if (dims.rows === undefined) {
    const root = Math.sqrt(items.length);
    cols = orientation === 'tall' ? Math.floor(root) || 1 : Math.ceil(root);
  }
  if (rowCap !== undefined) {
    cols = Math.max(cols, Math.ceil(requestedArea(items, dims.maxCols, rowCap) / rowCap));
  }
  return { cols: Math.max(1, Math.min(colLimit, cols)), rowCap, colLimit };
}

function fitsCapacity(cfg: GridConfig, items: LayoutItem[]): boolean {
  const dims = readDims(cfg);
  if (dims.maxItems !== undefined) return items.length <= dims.maxItems;
  const colLimit = dims.cols ?? dims.maxCols;
  const rowCap = dims.cols !== undefined ? dims.maxRows : (dims.rows ?? dims.maxRows);
  if (colLimit === undefined || rowCap === undefined) return true;
  // O(n) approximation: sums requested cells against total grid capacity,
  // ignoring row-wrap fragmentation. `canAccept` runs on every drag
  // pointermove and can't afford a full reservation pack; `layout()` still
  // pushes anything that doesn't actually fit to `unplaced`.
  return requestedArea(items, colLimit, rowCap) <= colLimit * rowCap;
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
 * Row-major first-fit over a `cols`-wide lattice. Every cell before `cursor`
 * is taken, so no block can start there and each search begins at it.
 */
class CellPacker {
  readonly cols: number;
  readonly rowCap: number | undefined;
  private readonly taken = new Set<number>();
  private cursor = 0;

  constructor(cols: number, rowCap: number | undefined) {
    this.cols = cols;
    this.rowCap = rowCap;
  }

  clone(): CellPacker {
    const copy = new CellPacker(this.cols, this.rowCap);
    for (const cell of this.taken) copy.taken.add(cell);
    copy.cursor = this.cursor;
    return copy;
  }

  /** Reserves the first block a `cSpan × rSpan` item fits, if any. */
  place(cSpan: number, rSpan: number): { col: number; row: number } | undefined {
    const { cols, rowCap, taken } = this;
    let col = this.cursor % cols;
    for (
      let row = Math.floor(this.cursor / cols);
      rowCap === undefined || row + rSpan <= rowCap;
      row++
    ) {
      while (col + cSpan <= cols) {
        const blocked = this.blockedAt(col, row, cSpan, rSpan);
        if (blocked < 0) {
          for (let dr = 0; dr < rSpan; dr++) {
            for (let dc = 0; dc < cSpan; dc++) taken.add((row + dr) * cols + col + dc);
          }
          while (taken.has(this.cursor)) this.cursor++;
          return { col, row };
        }
        // Every start from `col` through `blocked` covers the taken cell.
        col = blocked + 1;
      }
      col = 0;
    }
    return undefined;
  }

  /** Reserves the block at `col, row` if every cell of it is free. */
  reserve(col: number, row: number, cSpan: number, rSpan: number): boolean {
    if (this.blockedAt(col, row, cSpan, rSpan) >= 0) return false;
    for (let dr = 0; dr < rSpan; dr++) {
      for (let dc = 0; dc < cSpan; dc++) this.taken.add((row + dr) * this.cols + col + dc);
    }
    while (this.taken.has(this.cursor)) this.cursor++;
    return true;
  }

  /** The column of a taken cell inside the block, or -1 when it is free. */
  private blockedAt(col: number, row: number, cSpan: number, rSpan: number): number {
    for (let dr = 0; dr < rSpan; dr++) {
      const base = (row + dr) * this.cols + col;
      for (let dc = cSpan - 1; dc >= 0; dc--) if (this.taken.has(base + dc)) return col + dc;
    }
    return -1;
  }
}

/**
 * Reserves an explicitly celled item's block, its span clamped to the room
 * past its cell. False when the cell is outside the grid or collides.
 */
function reserveExplicit(
  packer: CellPacker,
  item: LayoutItem,
  at: { col: number; row: number },
  placed: Map<string, ReservedCell>,
): boolean {
  const { cols, rowCap } = packer;
  if (at.col >= cols || (rowCap !== undefined && at.row >= rowCap)) return false;
  const span = clampSpan(item, cols - at.col, rowCap === undefined ? undefined : rowCap - at.row);
  if (!packer.reserve(at.col, at.row, span.cols, span.rows)) return false;
  placed.set(item.id, { ...at, ...span });
  return true;
}

/**
 * Walks `order` twice: first reserving each explicitly celled item's block,
 * then giving every other item the first free block its (clamped) span fits.
 * Items beyond `itemCap`, cells that collide or fall outside the grid, and
 * spans that can't fit before `rowCap` runs out are omitted.
 */
function reserveCells(
  order: LayoutItem[],
  cols: number,
  rowCap: number | undefined,
  itemCap: number,
): Map<string, ReservedCell> {
  const packer = new CellPacker(cols, rowCap);
  const placed = new Map<string, ReservedCell>();
  let anyFlow = false;
  for (const item of order) {
    if (placed.size >= itemCap) break;
    const at = explicitCell(item);
    if (at) reserveExplicit(packer, item, at, placed);
    else anyFlow = true;
  }
  if (!anyFlow) return placed;
  for (const item of order) {
    if (placed.size >= itemCap) break;
    if (explicitCell(item)) continue;
    const span = clampSpan(item, cols, rowCap);
    const at = packer.place(span.cols, span.rows);
    if (at) placed.set(item.id, { ...at, ...span });
  }
  return placed;
}

/** One past the rightmost column the explicit cells reach, spans included. */
function explicitReach(items: LayoutItem[]): number {
  let reach = 0;
  for (const item of items) {
    const at = explicitCell(item);
    if (at)
      reach = Math.max(
        reach,
        at.col + wholeSpan(item.placement?.span?.cols, undefined, item.id, 'cols'),
      );
  }
  return reach;
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
  const dims = readDims(cfg);
  const fill = cfg.fill ?? true;
  const resolved = resolveDims(items, dims, fill, cfg.orientation ?? 'wide');
  const { rowCap, colLimit } = resolved;
  let cols = Math.min(colLimit, Math.max(resolved.cols, explicitReach(items)));
  const itemCap = dims.maxItems ?? Number.POSITIVE_INFINITY;

  // Two passes: the first (priority order — pins win the capacity race)
  // decides *which* items survive; the second (childOrder) assigns actual
  // cells, so position among the survivors never depends on pin status.
  const order = byCapacityPriority(items);
  let priorityPlaced = reserveCells(order, cols, rowCap, itemCap);

  // Area set the starting width; fragmentation can need more. Past the summed
  // span widths every item fits in row 0, so growing further cannot help. A
  // cell that is out of bounds or collides stays that way at any width, so it
  // is not wanted.
  let lost = 0;
  for (const item of items) if (!priorityPlaced.has(item.id) && explicitCell(item)) lost++;
  const want = Math.min(items.length - lost, itemCap);
  if (rowCap !== undefined && priorityPlaced.size < want && cols < colLimit) {
    const widths = requestedArea(items, dims.maxCols, 1);
    const ceiling = Math.min(colLimit, Math.max(cols, widths));
    const from = cols;
    while (priorityPlaced.size < want && cols < ceiling) {
      let short = want - priorityPlaced.size;
      let missing = 0;
      for (const item of order) {
        if (short === 0) break;
        if (priorityPlaced.has(item.id) || explicitCell(item)) continue;
        const span = clampSpan(item, cols, rowCap);
        missing += span.cols * span.rows;
        short--;
      }
      cols = Math.min(ceiling, cols + Math.max(1, Math.ceil(missing / rowCap)));
      priorityPlaced = reserveCells(order, cols, rowCap, itemCap);
    }
    trace(
      'layout',
      `grid: grew ${from} → ${cols} cols to place ${priorityPlaced.size}/${want} in ${rowCap} rows`,
    );
  }

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
  const celled = items.some((it) => explicitCell(it) !== undefined);
  // An unbounded grid grows a row rather than dropping anyone, so every span
  // fits: the ceiling is the grid's width, and — since nothing can usefully
  // span more rows than there are items — the item count. Cells break this:
  // they don't move out of the way.
  if (rowCap === undefined && !celled) return { cols, rows: items.length };

  const at = items.findIndex((it) => it.id === id);
  if (at < 0) return { cols: 1, rows: 1 };
  const item = items[at] as LayoutItem;
  const ownCell = explicitCell(item);

  // What packs the same whatever span `id` takes is packed once, and each
  // probe repacks only the rest: every other cell, since cells reserve first,
  // then — unless `id` is itself celled and so reserves ahead of all flow —
  // the flow items before it.
  const prefix = new CellPacker(cols, rowCap);
  const prefixPlaced = new Map<string, ReservedCell>();
  if (celled) {
    for (const other of items) {
      if (prefixPlaced.size >= itemCap) break;
      const cell = other.id === id ? undefined : explicitCell(other);
      if (cell) reserveExplicit(prefix, other, cell, prefixPlaced);
    }
  }
  let before = prefixPlaced.size;
  const rest: LayoutItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const other = items[i] as LayoutItem;
    if (i === at || (celled && explicitCell(other))) continue;
    if (ownCell || i > at) {
      rest.push(other);
    } else if (before < itemCap) {
      const span = clampSpan(other, cols, rowCap);
      if (prefix.place(span.cols, span.rows)) before++;
    }
  }
  const baseline = reserveCells(items, cols, rowCap, itemCap).size;
  const own = ownCell
    ? clampSpan(item, cols - ownCell.col, rowCap === undefined ? undefined : rowCap - ownCell.row)
    : clampSpan(item, cols, rowCap);

  const fits = (axis: 'cols' | 'rows', value: number): boolean => {
    const packer = prefix.clone();
    let placed = before;
    if (placed < itemCap) {
      const span = { ...own, [axis]: value };
      if (ownCell) {
        const inBounds =
          ownCell.col + span.cols <= cols &&
          (rowCap === undefined || ownCell.row + span.rows <= rowCap);
        if (!inBounds || !packer.reserve(ownCell.col, ownCell.row, span.cols, span.rows)) {
          return false;
        }
        placed++;
      } else if (packer.place(span.cols, span.rows)) {
        placed++;
      }
    }
    for (let i = 0; i < rest.length && placed < itemCap; i++) {
      const span = clampSpan(rest[i] as LayoutItem, cols, rowCap);
      if (packer.place(span.cols, span.rows)) placed++;
      else if (placed + rest.length - 1 - i < baseline) return false;
    }
    return placed >= baseline;
  };
  const reachOn = (axis: 'cols' | 'rows', cap: number): number => {
    let best = 1;
    for (let v = 1; v <= cap; v++) if (fits(axis, v)) best = v;
    return best;
  };
  return { cols: reachOn('cols', cols), rows: reachOn('rows', rowCap ?? items.length) };
}

/** Says why an explicit cell was ignored or went unplaced. Off the hot path:
 *  each branch only runs for an item holding a cell. */
function traceCells(
  items: LayoutItem[],
  cells: Map<string, ReservedCell>,
  cols: number,
  rowCap: number | undefined,
): void {
  for (const item of items) {
    const raw = item.placement?.cell;
    if (!raw) continue;
    const at = explicitCell(item);
    if (!at) {
      trace(
        'layout',
        `grid: ${item.id} cell ${JSON.stringify(raw)} is not two non-negative numbers, ignored`,
      );
      continue;
    }
    if (cells.has(item.id)) continue;
    const where = `grid: ${item.id} cell (${at.col}, ${at.row})`;
    if (at.col >= cols || (rowCap !== undefined && at.row >= rowCap)) {
      trace('layout', `${where} is outside the ${cols}×${rowCap ?? '∞'} grid; unplaced`);
    } else {
      trace('layout', `${where} collides with a cell already taken, or the grid is full; unplaced`);
    }
  }
}

/**
 * Lays children out in a uniform grid, filling rows left to right. Config
 * takes `cols` / `rows`, `gap` and `padding`; capping either dimension makes
 * the overflow `unplaced` rather than shrinking cells.
 *
 * Reads `placement.span` for children that should cover several cells, and
 * `placement.cell` for children that sit at a given cell rather than where
 * the flow puts them. Celled children reserve their cells first; the rest
 * flow into the free cells in order. A cell that collides with one already
 * taken, or lies outside a capped grid, goes to `unplaced`.
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
    overflowMode: ['squeeze', 'scroll', 'unplaced'],
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
    // Splice ghost in if not already present. A celled child dragged within
    // its own grid is previewed as the reorder will leave it: its cell
    // cleared, flowing from the new index.
    const ghostAt = items.findIndex((it) => it.id === insertId);
    const ghost = ghostAt >= 0 ? items[ghostAt] : undefined;
    let projected: LayoutItem[];
    if (ghost && explicitCell(ghost)) {
      const { cell: _cell, ...placement } = ghost.placement ?? {};
      const rest = items.filter((_, i) => i !== ghostAt);
      const index = Math.max(0, Math.min(insertIndex ?? rest.length, rest.length));
      rest.splice(index, 0, { ...ghost, placement });
      projected = rest;
    } else {
      projected =
        ghostAt >= 0
          ? items
          : insertIndex !== undefined && insertIndex >= 0 && insertIndex <= items.length
            ? [...items.slice(0, insertIndex), { id: insertId }, ...items.slice(insertIndex)]
            : [...items, { id: insertId }];
    }
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
    traceCells(items, cells, cols, rowCap);

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

    if (mode === 'unplaced' && cellH * rowsUsed + gap * (rowsUsed - 1) > usableH) {
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
        z: 0,
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
            rect: { x: rect.x + rect.w - 2, y: rect.y, z: 0, w: 4, h: rect.h },
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
            rect: { x: rect.x, y: rect.y + rect.h - 2, z: 0, w: rect.w, h: 4 },
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
