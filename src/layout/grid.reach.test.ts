import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { prng } from '../test-utils/exotic/invariants.js';
import { spanReach } from './grid.js';

// The non-compact `spanReach` as it stood before probes rolled back instead of
// cloning, frozen with the packing it depends on. It is the oracle the
// differential test holds the live one to.
function wholeSpan(v: number | undefined, limit: number | undefined): number {
  if (v === undefined) return 1;
  if (!Number.isFinite(v)) return v === Number.POSITIVE_INFINITY && limit !== undefined ? limit : 1;
  const n = Math.max(1, Math.floor(v));
  return limit !== undefined ? Math.min(n, limit) : n;
}

function clampSpan(item: LayoutItem, cols: number, rowCap: number | undefined) {
  const span = item.placement?.span;
  return { cols: wholeSpan(span?.cols, cols), rows: wholeSpan(span?.rows, rowCap) };
}

function explicitCell(item: LayoutItem): { col: number; row: number } | undefined {
  const cell = item.placement?.cell;
  if (!cell) return undefined;
  const { col, row } = cell;
  if (!Number.isFinite(col) || !Number.isFinite(row) || col < 0 || row < 0) return undefined;
  return { col: Math.floor(col), row: Math.floor(row) };
}

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
        col = blocked + 1;
      }
      col = 0;
    }
    return undefined;
  }

  reserve(col: number, row: number, cSpan: number, rSpan: number): boolean {
    if (this.blockedAt(col, row, cSpan, rSpan) >= 0) return false;
    for (let dr = 0; dr < rSpan; dr++) {
      for (let dc = 0; dc < cSpan; dc++) this.taken.add((row + dr) * this.cols + col + dc);
    }
    while (this.taken.has(this.cursor)) this.cursor++;
    return true;
  }

  private blockedAt(col: number, row: number, cSpan: number, rSpan: number): number {
    for (let dr = 0; dr < rSpan; dr++) {
      const base = (row + dr) * this.cols + col;
      for (let dc = cSpan - 1; dc >= 0; dc--) if (this.taken.has(base + dc)) return col + dc;
    }
    return -1;
  }
}

function reserveExplicit(
  packer: CellPacker,
  item: LayoutItem,
  at: { col: number; row: number },
  placed: Map<string, unknown>,
): boolean {
  const { cols, rowCap } = packer;
  if (at.col >= cols || (rowCap !== undefined && at.row >= rowCap)) return false;
  const span = clampSpan(item, cols - at.col, rowCap === undefined ? undefined : rowCap - at.row);
  if (!packer.reserve(at.col, at.row, span.cols, span.rows)) return false;
  placed.set(item.id, { ...at, ...span });
  return true;
}

function placedCount(
  order: LayoutItem[],
  cols: number,
  rowCap: number | undefined,
  itemCap: number,
): number {
  const packer = new CellPacker(cols, rowCap);
  const placed = new Map<string, unknown>();
  for (const item of order) {
    if (placed.size >= itemCap) break;
    const at = explicitCell(item);
    if (at) reserveExplicit(packer, item, at, placed);
  }
  for (const item of order) {
    if (placed.size >= itemCap) break;
    if (explicitCell(item)) continue;
    const span = clampSpan(item, cols, rowCap);
    const at = packer.place(span.cols, span.rows);
    if (at) placed.set(item.id, { ...at, ...span });
  }
  return placed.size;
}

function oracleReach(
  items: LayoutItem[],
  id: string,
  cols: number,
  rowCap: number | undefined,
  itemCap: number,
): { cols: number; rows: number } {
  const celled = items.some((it) => explicitCell(it) !== undefined);
  if (rowCap === undefined && !celled) return { cols, rows: items.length };

  const at = items.findIndex((it) => it.id === id);
  if (at < 0) return { cols: 1, rows: 1 };
  const item = items[at] as LayoutItem;
  const ownCell = explicitCell(item);

  const prefix = new CellPacker(cols, rowCap);
  const prefixPlaced = new Map<string, unknown>();
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
  const baseline = placedCount(items, cols, rowCap, itemCap);
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

interface Layout {
  items: LayoutItem[];
  cols: number;
  rowCap: number | undefined;
  itemCap: number;
}

/** A random grid whose share of celled items is `celledPct` percent. */
function randomLayout(seed: number, celledPct: number): Layout {
  const rand = prng(seed);
  const cols = rand(1, 8);
  const rowCap = rand(0, 3) === 0 ? undefined : rand(1, 10);
  const count = rand(1, 14);
  const itemCap = rand(0, 3) === 0 ? rand(1, count) : Number.POSITIVE_INFINITY;
  const spanOf = (limit: number): number | undefined => {
    const roll = rand(0, 9);
    if (roll === 0) return undefined;
    if (roll === 1) return Number.POSITIVE_INFINITY;
    return rand(1, limit);
  };
  const items: LayoutItem[] = [];
  for (let i = 0; i < count; i++) {
    const span: { cols?: number; rows?: number } = {};
    const sc = spanOf(cols);
    const sr = spanOf(4);
    if (sc !== undefined) span.cols = sc;
    if (sr !== undefined) span.rows = sr;
    const cell =
      rand(1, 100) <= celledPct
        ? { col: rand(0, cols), row: rand(0, (rowCap ?? 8) + 1) }
        : undefined;
    items.push({ id: `i${i}`, placement: cell ? { cell, span } : { span } });
  }
  return { items, cols, rowCap, itemCap };
}

describe('grid spanReach', () => {
  it('reaches the same spans as the cloning oracle over 3000 random grids', () => {
    let probes = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const { items, cols, rowCap, itemCap } = randomLayout(
        seed,
        [0, 30, 70, 100][seed % 4] as number,
      );
      for (const id of [...items.map((it) => it.id), 'missing']) {
        const want = oracleReach(items, id, cols, rowCap, itemCap);
        const got = spanReach(items, id, cols, rowCap, itemCap);
        if (got.cols !== want.cols || got.rows !== want.rows) {
          expect({ seed, id, got }).toEqual({ seed, id, got: want });
        }
        probes++;
      }
    }
    expect(probes).toBeGreaterThan(20000);
  });
});
