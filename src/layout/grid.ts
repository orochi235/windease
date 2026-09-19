import type {
  Affordance,
  LayoutEvent,
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
  /**
   * Fixed cell size in pixels, per axis. A fixed axis keeps its cells that size
   * instead of dividing the container among them, and with a fixed `w` and no
   * `cols` the column count is however many cells fit across the container.
   * Rows past the container's height are `overflow`, or `unplaced` under
   * `overflowMode: 'unplaced'`; `hints.minSize` floors are not read.
   */
  cell?: { w?: number; h?: number };
  /**
   * Where leftover width goes when the occupied columns don't span the
   * container: fixed cells narrower than it, or trailing columns nothing sits
   * in (`fill: false`, or a set `cols` with few items). Columns move as whole
   * tracks, so every row stays aligned. Default `'start'`.
   */
  justify?: GridJustify;
  /**
   * Per-track sizes, by index: a number of pixels, or `{ share }` of what the
   * pixel tracks and gaps leave, the way CSS `fr` splits it. A tracked axis has
   * uneven cells. `tracks.cols` sets the column count when `cols` is unset;
   * `tracks.rows` only sizes rows, which still come from the content. A track
   * past the list takes the fixed `cell` size on that axis, or `{ share: 1 }`.
   *
   * With `resizable`, a tracked axis gets a seam after each pixel track and
   * between two share tracks instead of per-item span seams. A seam drag
   * writes the new sizes back into this key through `updateContainerConfig`.
   */
  tracks?: { cols?: TrackSize[]; rows?: TrackSize[] };
  /**
   * `'up'` is gravity, as a Grafana dashboard has: celled items float up into
   * the free rows above them, in order of their stated row, and the rest flow
   * around them. Where two cells collide the lower one is pushed down beneath
   * the other instead of going to `unplaced`, so growing a celled item pushes
   * the items below it down. Layout-time only: `placement.cell` keeps the row
   * that was stated.
   */
  compact?: 'up';
}

/**
 * One grid track's size: pixels, or a share of the length the pixel tracks and
 * gaps leave.
 * @group Strategies
 */
export type TrackSize = number | { share: number };

type GridJustify = 'start' | 'center' | 'end' | 'between' | 'evenly';

/** The positive, finite axes of `cfg.cell`, which are the ones that are fixed. */
function fixedCell(cfg: GridConfig): { w: number | undefined; h: number | undefined } {
  const read = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
  return { w: read(cfg.cell?.w), h: read(cfg.cell?.h) };
}

/**
 * The column count a fixed cell width fits across the container, capped by
 * `maxCols`. Undefined when columns are not derived from the width: `cols` is
 * set, the width isn't fixed, or there is no container to fit into.
 */
function fitCols(cfg: GridConfig, dims: GridDims, container: Size | undefined): number | undefined {
  if (dims.cols !== undefined) return undefined;
  const w = fixedCell(cfg).w;
  if (w === undefined) return undefined;
  if (!container) {
    trace('layout', 'grid: cell.w without cols needs a container to fit columns; auto-balancing');
    return undefined;
  }
  const gap = cfg.gap ?? 0;
  const usableW = container.w - 2 * (cfg.padding ?? 0);
  const fit = Math.max(1, Math.floor((usableW + gap) / (w + gap)));
  return dims.maxCols !== undefined ? Math.min(fit, dims.maxCols) : fit;
}

/**
 * Where the first column starts, past padding, and the extra space between
 * each pair of columns, for `justify` to hand out `leftover` px across `used`
 * columns. Overflowing content (`leftover <= 0`) stays at the start.
 */
function justifyColumns(
  justify: GridJustify | undefined,
  leftover: number,
  used: number,
): { offset: number; extra: number } {
  if (leftover <= 0 || used < 1) return { offset: 0, extra: 0 };
  switch (justify) {
    case 'center':
      return { offset: leftover / 2, extra: 0 };
    case 'end':
      return { offset: leftover, extra: 0 };
    case 'between':
      return used > 1 ? { offset: 0, extra: leftover / (used - 1) } : { offset: 0, extra: 0 };
    case 'evenly': {
      const share = leftover / (used + 1);
      return { offset: share, extra: share };
    }
    default:
      return { offset: 0, extra: 0 };
  }
}

/** One past the rightmost column any placed cell reaches. */
function usedCols(cells: Map<string, ReservedCell>): number {
  let used = 0;
  for (const cell of cells.values()) used = Math.max(used, cell.col + cell.cols);
  return used;
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
  const listed = cfg.tracks?.cols;
  const dims: GridDims = {
    cols: read('cols') ?? (Array.isArray(listed) && listed.length > 0 ? listed.length : undefined),
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
 * spans that can't fit before `rowCap` runs out are omitted. Under `compact`
 * the cells float up instead of holding their rows, and a collision pushes the
 * lower cell down rather than omitting it.
 */
function reserveCells(
  order: LayoutItem[],
  cols: number,
  rowCap: number | undefined,
  itemCap: number,
  compact = false,
): Map<string, ReservedCell> {
  const packer = new CellPacker(cols, rowCap);
  const placed = new Map<string, ReservedCell>();
  let anyFlow = false;
  if (compact) {
    anyFlow = compactCells(packer, order, itemCap, placed);
  } else {
    for (const item of order) {
      if (placed.size >= itemCap) break;
      const at = explicitCell(item);
      if (at) reserveExplicit(packer, item, at, placed);
      else anyFlow = true;
    }
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

/**
 * Gravity over the celled items: in order of their stated row, then column,
 * then `order`, each lands on the lowest row its columns leave free beneath
 * the items already landed — up into empty rows, or down below one that grew
 * into it. A skyline of each column's lowest landed edge answers that without
 * searching, and nothing landed later can sit above anything landed earlier
 * in the same column, so no two blocks overlap. Returns whether any item flows.
 */
function compactCells(
  packer: CellPacker,
  order: LayoutItem[],
  itemCap: number,
  placed: Map<string, ReservedCell>,
): boolean {
  const { cols, rowCap } = packer;
  const celled: { item: LayoutItem; col: number; row: number; index: number }[] = [];
  let anyFlow = false;
  for (let index = 0; index < order.length; index++) {
    const item = order[index] as LayoutItem;
    const at = explicitCell(item);
    if (!at) anyFlow = true;
    else if (at.col < cols && celled.length < itemCap) celled.push({ item, ...at, index });
  }
  celled.sort((a, b) => a.row - b.row || a.col - b.col || a.index - b.index);
  const skyline = new Array<number>(cols).fill(0);
  let moved = 0;
  for (const { item, col, row } of celled) {
    const span = clampSpan(item, cols - col, rowCap);
    let top = 0;
    for (let c = col; c < col + span.cols; c++) top = Math.max(top, skyline[c] as number);
    if (rowCap !== undefined && top + span.rows > rowCap) continue;
    packer.reserve(col, top, span.cols, span.rows);
    for (let c = col; c < col + span.cols; c++) skyline[c] = top + span.rows;
    placed.set(item.id, { col, row: top, ...span });
    if (top !== row) moved++;
  }
  if (moved > 0) trace('layout', `grid: compact moved ${moved}/${celled.length} cells`);
  return anyFlow;
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
 * the item count, their spans and the config alone. The container enters only
 * to count how many fixed-width cells fit across it; otherwise it just divides
 * the result into cells. `layout`, `gridGeometry` and the
 * public `gridTiling` all resolve dimensions through this, so the three cannot
 * disagree about which item is in which cell.
 */
function resolveTiling(
  items: LayoutItem[],
  cfg: GridConfig,
  container?: Size,
): {
  cols: number;
  rows: number;
  rowCap: number | undefined;
  itemCap: number;
  cells: Map<string, ReservedCell>;
} {
  const dims = readDims(cfg);
  const fill = cfg.fill ?? true;
  const fit = fitCols(cfg, dims, container);
  const resolved =
    fit !== undefined
      ? { cols: fit, rowCap: dims.rows ?? dims.maxRows, colLimit: fit }
      : resolveDims(items, dims, fill, cfg.orientation ?? 'wide');
  const { rowCap, colLimit } = resolved;
  let cols = Math.min(colLimit, Math.max(resolved.cols, explicitReach(items)));
  const itemCap = dims.maxItems ?? Number.POSITIVE_INFINITY;
  const compact = cfg.compact === 'up';

  // Two passes: the first (priority order — pins win the capacity race)
  // decides *which* items survive; the second (childOrder) assigns actual
  // cells, so position among the survivors never depends on pin status.
  const order = byCapacityPriority(items);
  let priorityPlaced = reserveCells(order, cols, rowCap, itemCap, compact);

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
      priorityPlaced = reserveCells(order, cols, rowCap, itemCap, compact);
    }
    trace(
      'layout',
      `grid: grew ${from} → ${cols} cols to place ${priorityPlaced.size}/${want} in ${rowCap} rows`,
    );
  }

  const survivors = items.filter((it) => priorityPlaced.has(it.id));
  const cells = reserveCells(survivors, cols, rowCap, survivors.length, compact);

  let usedRows = 1;
  for (const cell of cells.values()) usedRows = Math.max(usedRows, cell.row + cell.rows);
  const rows = !fill && rowCap !== undefined ? rowCap : usedRows;

  return { cols, rows, rowCap, itemCap, cells };
}

/**
 * The tiling `options` produces for `items`: how many columns and rows. It
 * needs `container` only for a fixed `cell.w` with no `cols`, whose column
 * count is however many cells fit across; without one that config
 * auto-balances instead. A host that sizes a grid from its content — rows
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
  container?: Size,
): { cols: number; rows: number } {
  if (items.length === 0) return { cols: 0, rows: 0 };
  const { cols, rows } = resolveTiling(items, options as GridConfig, container);
  return { cols, rows };
}

/** A track as the layout reads it: fixed pixels, or a share of the rest. */
type Track = { px: number } | { share: number };

/** The smallest a seam drag leaves a track, in pixels. */
const MIN_TRACK = 8;

/** `tracks.cols` or `tracks.rows` when it is a non-empty array. */
function listedTracks(cfg: GridConfig, axis: 'cols' | 'rows'): unknown[] | undefined {
  const list = cfg.tracks?.[axis];
  return Array.isArray(list) && list.length > 0 ? list : undefined;
}

function readTrack(v: unknown, axis: 'cols' | 'rows', i: number): Track | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return { px: v };
  if (typeof v === 'object' && v !== null) {
    const share = (v as { share?: unknown }).share;
    if (typeof share === 'number' && Number.isFinite(share) && share > 0) return { share };
  }
  const shown = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  trace('layout', `grid: track ${axis}[${i}] is ${shown}, read as implicit`);
  return undefined;
}

/** The size a track takes when the list stops short of it or holds nothing
 *  readable: the fixed cell size on that axis, else one share. */
function implicitTrack(fixed: number | undefined): Track {
  return fixed !== undefined ? { px: fixed } : { share: 1 };
}

function resolveTracks(
  list: unknown[],
  count: number,
  fixed: number | undefined,
  axis: 'cols' | 'rows',
): Track[] {
  const out: Track[] = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = (i < list.length ? readTrack(list[i], axis, i) : undefined) ?? implicitTrack(fixed);
  }
  return out;
}

/** Pixel sizes for `tracks` along `available`: pixels as stated, shares
 *  splitting what the pixels and gaps leave, each held at `floor`. */
function trackSizes(tracks: Track[], available: number, gap: number, floor: number): number[] {
  let px = 0;
  let shares = 0;
  for (const t of tracks) {
    if ('px' in t) px += t.px;
    else shares += t.share;
  }
  const rest = Math.max(0, available - gap * (tracks.length - 1) - px);
  return tracks.map((t) => ('px' in t ? t.px : Math.max((rest * t.share) / shares, floor)));
}

/**
 * One axis of a laid-out grid in pixels. `start` already includes padding and
 * the `justify` offset, and `gap` the justify space between tracks.
 */
interface Axis {
  count: number;
  gap: number;
  start(i: number): number;
  size(i: number): number;
  /** The length of `n` tracks from `i`, the gaps between them included. */
  length(i: number, n: number): number;
  /** Set on an untracked axis, whose cells are all one size. */
  uniform?: { size: number; stride: number };
}

function uniformAxis(
  count: number,
  size: number,
  gap: number,
  origin: number,
  extra: number,
): Axis {
  const between = gap + extra;
  const stride = size + between;
  return {
    count,
    gap: between,
    start: (i) => origin + i * stride,
    size: () => size,
    length: (_i, n) => n * size + (n - 1) * between,
    uniform: { size, stride },
  };
}

function listedAxis(sizes: number[], gap: number, origin: number, extra: number): Axis {
  const between = gap + extra;
  const prefix = new Array<number>(sizes.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < sizes.length; i++) {
    prefix[i + 1] = (prefix[i] as number) + (sizes[i] as number);
  }
  return {
    count: sizes.length,
    gap: between,
    start: (i) => origin + (prefix[i] as number) + i * between,
    size: (i) => sizes[i] as number,
    length: (i, n) => (prefix[i + n] as number) - (prefix[i] as number) + (n - 1) * between,
  };
}

/** A laid-out grid: the tiling, the cells that survived the overflow mode, and
 *  each axis in pixels. */
interface GridGeometry {
  cols: number;
  rowCap: number | undefined;
  itemCap: number;
  cells: Map<string, ReservedCell>;
  unplaced: string[];
  x: Axis;
  y: Axis;
  /** Present on a tracked axis. */
  colTracks: Track[] | undefined;
  rowTracks: Track[] | undefined;
  usableW: number;
  usableH: number;
  excessW: number;
  excessH: number;
}

/**
 * The tiling plus the pixel geometry the container divides it into.
 * `dispatchAffordance` must agree with the pass that drew the affordance — the
 * two computing cells differently is the whole class of bug `placedOf` closes
 * for strip — so `layout` reads its geometry here too.
 */
function gridGeometry(items: LayoutItem[], container: Size, cfg: GridConfig): GridGeometry {
  const gap = cfg.gap ?? 0;
  const padding = cfg.padding ?? 0;
  const { cols, rows, rowCap, itemCap, cells } = resolveTiling(items, cfg, container);
  const fixed = fixedCell(cfg);
  const unplaced = items.filter((it) => !cells.has(it.id)).map((it) => it.id);

  const usableW = container.w - 2 * padding;
  const usableH = container.h - 2 * padding;
  const mode = cfg.overflowMode ?? 'squeeze';
  const floor = (axis: 'w' | 'h') =>
    mode === 'squeeze' ? 0 : Math.max(0, ...items.map((it) => it.hints?.minSize?.[axis] ?? 0));
  const floorW = floor('w');
  const floorH = floor('h');

  const dropRowsFrom = (kept: number) => {
    for (const [id, cell] of [...cells]) {
      if (cell.row < kept) continue;
      cells.delete(id);
      unplaced.push(id);
    }
  };

  const listedRows = listedTracks(cfg, 'rows');
  let rowTracks: Track[] | undefined;
  let y: Axis;
  if (listedRows) {
    rowTracks = resolveTracks(listedRows, rows, fixed.h, 'rows');
    y = listedAxis(trackSizes(rowTracks, usableH, gap, floorH), gap, padding, 0);
    if (mode === 'unplaced') {
      let kept = rows;
      while (kept > 1 && y.length(0, kept) > usableH) {
        let fit = 0;
        while (fit < kept - 1 && y.start(fit) - padding + y.size(fit) <= usableH) fit++;
        kept = Math.max(1, fit);
        rowTracks = rowTracks.slice(0, kept);
        y = listedAxis(trackSizes(rowTracks, usableH, gap, floorH), gap, padding, 0);
      }
      if (kept < rows) dropRowsFrom(kept);
    }
  } else {
    const heightFor = (r: number) => fixed.h ?? Math.max((usableH - gap * (r - 1)) / r, floorH);
    let rowsUsed = rows;
    let cellH = heightFor(rowsUsed);
    if (mode === 'unplaced' && cellH * rowsUsed + gap * (rowsUsed - 1) > usableH) {
      // The first row is placed even when it does not fit, so an overflowing
      // grid never renders empty — same rule strip follows.
      rowsUsed = Math.max(1, Math.floor((usableH + gap) / (heightFor(1) + gap)));
      dropRowsFrom(rowsUsed);
      cellH = heightFor(rowsUsed);
    }
    y = uniformAxis(rowsUsed, cellH, gap, padding, 0);
  }

  const listedCols = listedTracks(cfg, 'cols');
  const colTracks = listedCols ? resolveTracks(listedCols, cols, fixed.w, 'cols') : undefined;
  const colSizes = colTracks ? trackSizes(colTracks, usableW, gap, floorW) : undefined;
  const cellW = fixed.w ?? Math.max((usableW - gap * (cols - 1)) / cols, floorW);
  const axisX = (origin: number, extra: number) =>
    colSizes
      ? listedAxis(colSizes, gap, origin, extra)
      : uniformAxis(cols, cellW, gap, origin, extra);
  const plain = axisX(padding, 0);
  const used = usedCols(cells);
  const spread = justifyColumns(cfg.justify, usableW - plain.length(0, used), used);
  const x =
    spread.offset === 0 && spread.extra === 0
      ? plain
      : axisX(padding + spread.offset, spread.extra);

  return {
    cols,
    rowCap,
    itemCap,
    cells,
    unplaced,
    x,
    y,
    colTracks,
    rowTracks,
    usableW,
    usableH,
    excessW: Math.max(0, plain.length(0, cols) - usableW),
    excessH: Math.max(0, y.length(0, y.count) - usableH),
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
  compact = false,
): { cols: number; rows: number } {
  if (compact) return compactReach(items, id, cols, rowCap, itemCap);
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

/**
 * `spanReach` under `compact`, where growing pushes whatever is below down
 * rather than being stopped by it. With no row cap nobody is ever pushed out,
 * so the ceiling is the room past the item's column and, as without compact,
 * the item count in rows. Under a cap each probe repacks the whole grid.
 */
function compactReach(
  items: LayoutItem[],
  id: string,
  cols: number,
  rowCap: number | undefined,
  itemCap: number,
): { cols: number; rows: number } {
  const item = items.find((it) => it.id === id);
  if (!item) return { cols: 1, rows: 1 };
  const room = cols - (explicitCell(item)?.col ?? 0);
  const own = clampSpan(item, room, rowCap);
  if (rowCap === undefined) return { cols: room, rows: Math.max(items.length, own.rows) };

  const baseline = reserveCells(items, cols, rowCap, itemCap, true).size;
  const fits = (axis: 'cols' | 'rows', value: number): boolean => {
    const span = { ...own, [axis]: value };
    const probe = items.map((it) =>
      it === item ? { ...it, placement: { ...it.placement, span } } : it,
    );
    return reserveCells(probe, cols, rowCap, itemCap, true).size >= baseline;
  };
  const reachOn = (axis: 'cols' | 'rows', cap: number): number => {
    let best = 1;
    for (let v = 1; v <= cap; v++) if (fits(axis, v)) best = v;
    return best;
  };
  return { cols: reachOn('cols', room), rows: reachOn('rows', rowCap) };
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
 * What the seam after track `i` moves and how far. A pixel track resizes on
 * its own, the tracks past it shifting; a share track trades with a share
 * track after it. A share before a pixel track, or the last track when it is a
 * share, has no seam: nothing it could trade with keeps the seam under the
 * pointer. `pxTotal` is the sum of the axis's pixel tracks.
 */
function seamAt(
  geom: GridGeometry,
  axis: 'cols' | 'rows',
  i: number,
  pxTotal: number,
  cfg: GridConfig,
): { pair: boolean; now: number; min: number; max: number; center: number } | undefined {
  const tracks = axis === 'cols' ? geom.colTracks : geom.rowTracks;
  const along = axis === 'cols' ? geom.x : geom.y;
  const track = tracks?.[i];
  if (!tracks || !track) return undefined;
  const now = along.size(i);
  const end = along.start(i) + now;
  const center = i < along.count - 1 ? (end + along.start(i + 1)) / 2 : end;
  if ('px' in track) {
    const usable = axis === 'cols' ? geom.usableW : geom.usableH;
    const room =
      cfg.overflowMode === 'scroll'
        ? usable
        : usable - (pxTotal - track.px) - (cfg.gap ?? 0) * (tracks.length - 1);
    return { pair: false, now, min: Math.min(MIN_TRACK, now), max: Math.max(now, room), center };
  }
  const next = tracks[i + 1];
  if (!next || !('share' in next)) return undefined;
  const combined = now + along.size(i + 1);
  return {
    pair: true,
    now,
    min: Math.min(MIN_TRACK, now),
    max: Math.max(now, combined - MIN_TRACK),
    center,
  };
}

function pixelTotal(tracks: Track[]): number {
  let px = 0;
  for (const t of tracks) if ('px' in t) px += t.px;
  return px;
}

/** The seams of a tracked axis, one after each track that has one. */
function trackSeams(geom: GridGeometry, axis: 'cols' | 'rows', cfg: GridConfig): Affordance[] {
  const tracks = (axis === 'cols' ? geom.colTracks : geom.rowTracks) ?? [];
  const across = axis === 'cols' ? geom.y : geom.x;
  const holding: string[][] = tracks.map(() => []);
  for (const [id, cell] of geom.cells) {
    const from = axis === 'cols' ? cell.col : cell.row;
    const n = axis === 'cols' ? cell.cols : cell.rows;
    for (let k = from; k < from + n && k < holding.length; k++) holding[k]?.push(id);
  }
  const pxTotal = pixelTotal(tracks);
  const lo = across.start(0);
  const extent = Math.max(0, across.length(0, across.count));
  const out: Affordance[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const seam = seamAt(geom, axis, i, pxTotal, cfg);
    if (!seam) continue;
    const affects = seam.pair
      ? [...new Set([...(holding[i] ?? []), ...(holding[i + 1] ?? [])])]
      : (holding[i] ?? []);
    const cols = axis === 'cols';
    out.push({
      id: `track-${cols ? 'x' : 'y'}-${i}`,
      kind: cols ? 'resize-x' : 'resize-y',
      rect: cols
        ? { x: seam.center - 2, y: lo, z: 0, w: 4, h: extent }
        : { x: lo, y: seam.center - 2, z: 0, w: extent, h: 4 },
      cursor: cols ? 'ew-resize' : 'ns-resize',
      name: `resize ${cols ? 'column' : 'row'} ${i + 1}`,
      affects,
      bounds: {
        orientation: cols ? 'horizontal' : 'vertical',
        valueNow: seam.now,
        valueMin: seam.min,
        valueMax: seam.max,
        atMin: seam.now <= seam.min,
        atMax: seam.now >= seam.max,
      },
    });
  }
  return out;
}

function parseTrackSeam(id: string): { axis: 'cols' | 'rows'; index: number } | undefined {
  const m = /^track-([xy])-(\d+)$/.exec(id);
  if (!m) return undefined;
  return { axis: m[1] === 'x' ? 'cols' : 'rows', index: Number(m[2]) };
}

const toTrackSize = (t: Track): TrackSize => ('px' in t ? t.px : { share: t.share });
const roundShare = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * The `tracks` list a drag on the seam after track `i` leaves, or undefined
 * when it changes nothing. Tracks before the dragged one that the list left
 * implicit are written out at their implicit size, so the list stays indexed.
 */
function draggedTracks(
  geom: GridGeometry,
  axis: 'cols' | 'rows',
  i: number,
  event: LayoutEvent,
  cfg: GridConfig,
): TrackSize[] | undefined {
  const tracks = axis === 'cols' ? geom.colTracks : geom.rowTracks;
  if (!tracks) return undefined;
  const seam = seamAt(geom, axis, i, pixelTotal(tracks), cfg);
  if (!seam) return undefined;
  const point = event.payload.point;
  const delta = axis === 'cols' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
  const want = point
    ? (axis === 'cols' ? point.x : point.y) - seam.center + seam.now
    : seam.now + delta;
  const size = Math.max(seam.min, Math.min(seam.max, want));

  const raw = listedTracks(cfg, axis) ?? [];
  const need = seam.pair ? i + 2 : i + 1;
  const out: unknown[] = [];
  for (let k = 0; k < Math.max(raw.length, need); k++) {
    const t = tracks[k];
    out.push(t ? toTrackSize(t) : raw[k]);
  }
  const track = tracks[i] as Track;
  if ('px' in track) {
    const px = Math.round(size);
    if (px === track.px) return undefined;
    out[i] = px;
  } else {
    const next = tracks[i + 1] as { share: number };
    const combined = seam.now + (axis === 'cols' ? geom.x : geom.y).size(i + 1);
    if (combined <= 0) return undefined;
    const pair = track.share + next.share;
    const own = roundShare((pair * size) / combined);
    if (own === track.share) return undefined;
    out[i] = { share: own };
    out[i + 1] = { share: roundShare(pair - own) };
  }
  return out as TrackSize[];
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
    cell: 'object',
    justify: ['start', 'center', 'end', 'between', 'evenly'],
    tracks: 'object',
    compact: ['up'],
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

    const placements = new Map<string, Rect>();
    if (items.length === 0) {
      const empty: LayoutResult<string> = { placements, affordances: [] };
      if (preview) empty.isPreview = true;
      return empty;
    }

    const geom = gridGeometry(items, container, cfg);
    const { cols, rowCap, itemCap, cells, unplaced, x, y } = geom;
    traceCells(items, cells, cols, rowCap);

    for (const item of items) {
      const cell = cells.get(item.id);
      if (!cell) continue;
      placements.set(item.id, {
        x: x.start(cell.col),
        y: y.start(cell.row),
        z: 0,
        w: x.length(cell.col, cell.cols),
        h: y.length(cell.row, cell.rows),
      });
    }

    const affordances: Affordance[] = [];
    if (cfg.resizable && !preview) {
      if (geom.colTracks) affordances.push(...trackSeams(geom, 'cols', cfg));
      if (geom.rowTracks) affordances.push(...trackSeams(geom, 'rows', cfg));
      for (const item of items) {
        const cell = cells.get(item.id);
        const rect = placements.get(item.id);
        if (!cell || !rect) continue;
        const reach = spanReach(items, item.id, cols, rowCap, itemCap, cfg.compact === 'up');
        // Emit when the span can move at all, in either direction. Keying on
        // "a cell follows this one" instead would drop the handle from an item
        // spanning to the edge, leaving it grown with no way back.
        if (!geom.colTracks && (reach.cols > 1 || cell.cols > 1)) {
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
        if (!geom.rowTracks && (reach.rows > 1 || cell.rows > 1)) {
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
    if (geom.excessW > 0 || geom.excessH > 0) {
      result.overflow = { w: geom.excessW, h: geom.excessH };
    }
    if (unplaced.length > 0) result.unplaced = unplaced;
    if (preview) result.isPreview = true;
    return result;
  },

  dispatchAffordance({ event, affordance, store, items, container, options, parentId }) {
    if (event.kind !== 'drag') return;
    if (affordance.kind !== 'resize-x' && affordance.kind !== 'resize-y') return;
    if (items.length === 0) return;
    const cfg = options as GridConfig;
    const geom = gridGeometry(items, container, cfg);

    const seam = parseTrackSeam(affordance.id);
    if (seam) {
      const next = draggedTracks(geom, seam.axis, seam.index, event, cfg);
      if (!next) return;
      trace('layout', `grid: track ${seam.axis}[${seam.index}] → ${JSON.stringify(next)}`);
      store.updateContainerConfig(parentId, { tracks: { ...cfg.tracks, [seam.axis]: next } });
      return;
    }

    const childId = affordance.childId;
    if (!childId) return;
    const axis: 'cols' | 'rows' = affordance.kind === 'resize-x' ? 'cols' : 'rows';
    const cell = geom.cells.get(String(childId));
    if (!cell) return;
    // A tracked axis draws track seams instead, so a span seam's axis is uniform.
    const along = axis === 'cols' ? geom.x : geom.y;
    if (!along.uniform) return;
    const { size, stride } = along.uniform;
    if (stride <= 0) return;
    const current = axis === 'cols' ? cell.cols : cell.rows;

    let want: number;
    const point = event.payload.point;
    if (point) {
      // Resolve against the pointer rather than accumulating deltas. A span is
      // quantized, so a few pixels rounds to the span it already has and the
      // drag would never move at all.
      const origin = along.start(axis === 'cols' ? cell.col : cell.row);
      const extent = (axis === 'cols' ? point.x : point.y) - origin;
      // A span of n covers n strides less the space after its last cell.
      want = Math.round((extent + stride - size) / stride);
    } else {
      // No pointer: a synthesized step. `bounds.step` is 1, so the host sends
      // one cell's worth and this reads as ±1.
      const delta = axis === 'cols' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
      want = current + Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / stride));
    }

    const reach = spanReach(
      items,
      String(childId),
      geom.cols,
      geom.rowCap,
      geom.itemCap,
      cfg.compact === 'up',
    );
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
