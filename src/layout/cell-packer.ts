/** A block of grid cells: its top-left cell and its span. */
export interface ReservedCell {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** Bits `lo` through `hi` of a 32-bit word, inclusive. */
const span32 = (lo: number, hi: number): number => ((0xffffffff >>> (31 - hi)) & (-1 << lo)) >>> 0;

/**
 * Taken cells as one bitmask per row, 32 columns to a word, grown on demand.
 * A block test reads a word per 32 columns rather than a byte per cell, which
 * is what span-reach probes spend most of their time on.
 */
class CellMask {
  private readonly words: number;
  private bits = new Uint32Array(64);
  size = 0;

  constructor(cols: number) {
    this.words = Math.max(1, Math.ceil(cols / 32));
  }

  /** The rightmost taken column in `[col, col + span)` of `row`, or -1. */
  rightmostIn(row: number, col: number, span: number): number {
    const base = row * this.words;
    if (base >= this.bits.length) return -1;
    let hi = col + span - 1;
    while (hi >= col) {
      const w = hi >>> 5;
      const lo = Math.max(col, w << 5);
      const hit = (this.bits[base + w] as number) & span32(lo & 31, hi & 31);
      if (hit !== 0) return (w << 5) + 31 - Math.clz32(hit);
      hi = lo - 1;
    }
    return -1;
  }

  /** The first free column at or after `col` in `row`, or `cols` when the row is full. */
  firstFreeIn(row: number, col: number, cols: number): number {
    const base = row * this.words;
    if (base >= this.bits.length) return col;
    for (let w = col >>> 5; w < this.words; w++) {
      let free = ~(this.bits[base + w] as number) >>> 0;
      if (w === col >>> 5) free &= span32(col & 31, 31);
      if (free !== 0) return Math.min(cols, (w << 5) + 31 - Math.clz32(free & -free));
    }
    return cols;
  }

  /** Marks a block free of taken cells as taken, or a taken block as free. */
  write(block: ReservedCell, on: boolean): void {
    const { words } = this;
    const need = (block.row + block.rows) * words;
    if (on && need > this.bits.length) {
      const next = new Uint32Array(Math.max(need, this.bits.length * 2));
      next.set(this.bits);
      this.bits = next;
    }
    const hiCol = block.col + block.cols - 1;
    for (let r = block.row; r < block.row + block.rows; r++) {
      const base = r * words;
      if (base >= this.bits.length) break;
      for (let w = block.col >>> 5; w <= hiCol >>> 5; w++) {
        const m = span32(Math.max(block.col, w << 5) & 31, Math.min(hiCol, (w << 5) + 31) & 31);
        const i = base + w;
        this.bits[i] = on ? (this.bits[i] as number) | m : (this.bits[i] as number) & ~m;
      }
    }
    this.size += (on ? 1 : -1) * block.cols * block.rows;
  }
}

/**
 * Row-major first-fit over a `cols`-wide lattice. Every cell before `cursor`
 * is taken, so no block can start there and each search begins at it.
 */
export class CellPacker {
  readonly cols: number;
  readonly rowCap: number | undefined;
  private readonly taken: CellMask;
  private cursor = 0;
  private journal: ReservedCell[] | undefined;
  /**
   * Per block size, the cell its last search stopped at, or Infinity when it
   * fit nowhere. Taking cells never opens a start before that, so the next
   * search of that size begins there; freeing cells has to drop these.
   */
  private starts = new Map<number, number>();

  constructor(cols: number, rowCap: number | undefined) {
    this.cols = cols;
    this.rowCap = rowCap;
    this.taken = new CellMask(cols);
  }

  /** Runs `probe` against this packer, then undoes every cell it took. */
  trial<T>(probe: (packer: CellPacker) => T): T {
    const { cursor, starts } = this;
    const outer = this.journal;
    const journal: ReservedCell[] = [];
    this.journal = journal;
    this.starts = new Map(starts);
    try {
      return probe(this);
    } finally {
      this.journal = outer;
      for (const block of journal) this.taken.write(block, false);
      this.cursor = cursor;
      this.starts = starts;
    }
  }

  /** How many cells are taken. */
  get takenCount(): number {
    return this.taken.size;
  }

  free(col: number, row: number, cSpan: number, rSpan: number): boolean {
    return this.blockedAt(col, row, cSpan, rSpan) < 0;
  }

  /** Runs `probe` with a block this packer holds freed, then takes it back. */
  without<T>(block: ReservedCell, probe: (packer: CellPacker) => T): T {
    const { cols, taken, cursor, starts } = this;
    taken.write(block, false);
    this.cursor = Math.min(cursor, block.row * cols + block.col);
    this.starts = new Map();
    try {
      return probe(this);
    } finally {
      taken.write(block, true);
      this.cursor = cursor;
      this.starts = starts;
    }
  }

  private take(block: ReservedCell): void {
    this.journal?.push(block);
    this.taken.write(block, true);
    this.advanceCursor();
  }

  private advanceCursor(): void {
    const { cols } = this;
    let row = Math.floor(this.cursor / cols);
    let col = this.taken.firstFreeIn(row, this.cursor % cols, cols);
    while (col >= cols) {
      row++;
      col = this.taken.firstFreeIn(row, 0, cols);
    }
    this.cursor = row * cols + col;
  }

  /** Reserves the first block a `cSpan × rSpan` item fits, if any. */
  place(cSpan: number, rSpan: number): { col: number; row: number } | undefined {
    const { cols, rowCap, starts } = this;
    const size = cSpan <= cols && rSpan >= 1 ? cSpan + rSpan * (cols + 1) : -1;
    const from = Math.max(this.cursor, (size >= 0 && starts.get(size)) || 0);
    if (from === Number.POSITIVE_INFINITY) return undefined;
    let col = from % cols;
    for (let row = Math.floor(from / cols); rowCap === undefined || row + rSpan <= rowCap; row++) {
      while (col + cSpan <= cols) {
        const blocked = this.blockedAt(col, row, cSpan, rSpan);
        if (blocked < 0) {
          this.take({ col, row, cols: cSpan, rows: rSpan });
          if (size >= 0) starts.set(size, row * cols + col);
          return { col, row };
        }
        // Every start from `col` through `blocked` covers the taken cell.
        col = blocked + 1;
      }
      col = 0;
    }
    if (size >= 0) starts.set(size, Number.POSITIVE_INFINITY);
    return undefined;
  }

  /** Reserves the block at `col, row` if every cell of it is free. */
  reserve(col: number, row: number, cSpan: number, rSpan: number): boolean {
    if (this.blockedAt(col, row, cSpan, rSpan) >= 0) return false;
    this.take({ col, row, cols: cSpan, rows: rSpan });
    return true;
  }

  /** The column of a taken cell inside the block, or -1 when it is free. */
  private blockedAt(col: number, row: number, cSpan: number, rSpan: number): number {
    for (let dr = 0; dr < rSpan; dr++) {
      const hit = this.taken.rightmostIn(row + dr, col, cSpan);
      if (hit >= 0) return hit;
    }
    return -1;
  }
}
