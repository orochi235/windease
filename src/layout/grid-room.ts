/**
 * An upper bound on how many cells a set of blocks can cover on a grid that
 * already has cells taken, cheap enough to ask once per span a reach probe
 * would otherwise repack for.
 *
 * Inside one row, the blocks sharing a free run have widths summing to at most
 * the run's length, so the run holds no more than the largest sum of block
 * widths that fits it. Summed over every run of every row that bounds the area
 * the blocks cover; columns and heights give a second bound the same way.
 */
export interface GridRoom {
  /** Whether the blocks could still cover `need` cells with one more block
   *  taken at `col, row`, which must lie on free cells. */
  admits(col: number, row: number, w: number, h: number, need: number): boolean;
}

export function gridRoom(
  free: (col: number, row: number) => boolean,
  cols: number,
  rows: number,
  spans: Iterable<{ cols: number; rows: number }>,
): GridRoom {
  const widths = new Set<number>();
  const heights = new Set<number>();
  for (const span of spans) {
    widths.add(span.cols);
    heights.add(span.rows);
  }
  const fillW = fills(widths, cols);
  const fillH = fills(heights, rows);

  // Each line's free runs as flat [start, end) pairs.
  const rowRuns: number[][] = [];
  const colRuns: number[][] = Array.from({ length: cols }, () => []);
  const colStart = new Array<number>(cols).fill(-1);
  let rowTotal = 0;
  let colTotal = 0;
  for (let r = 0; r < rows; r++) {
    const runs: number[] = [];
    let start = -1;
    for (let c = 0; c < cols; c++) {
      if (free(c, r)) {
        if (start < 0) start = c;
        if ((colStart[c] as number) < 0) colStart[c] = r;
        continue;
      }
      if (start >= 0) {
        runs.push(start, c);
        rowTotal += fillW[c - start] as number;
        start = -1;
      }
      const top = colStart[c] as number;
      if (top >= 0) {
        (colRuns[c] as number[]).push(top, r);
        colTotal += fillH[r - top] as number;
        colStart[c] = -1;
      }
    }
    if (start >= 0) {
      runs.push(start, cols);
      rowTotal += fillW[cols - start] as number;
    }
    rowRuns.push(runs);
  }
  for (let c = 0; c < cols; c++) {
    const top = colStart[c] as number;
    if (top >= 0) {
      (colRuns[c] as number[]).push(top, rows);
      colTotal += fillH[rows - top] as number;
    }
  }

  return {
    admits(col, row, w, h, need) {
      let byRows = rowTotal;
      for (let r = row; r < row + h; r++)
        byRows -= loss(rowRuns[r] as number[], col, col + w, fillW);
      if (byRows < need) return false;
      let byCols = colTotal;
      for (let c = col; c < col + w; c++)
        byCols -= loss(colRuns[c] as number[], row, row + h, fillH);
      return byCols >= need;
    },
  };
}

/** What a run loses when `[a, b)` inside it is taken. An empty block, which
 *  an off-grid cell's clamped span can be, takes nothing. */
function loss(runs: number[], a: number, b: number, fill: Int32Array): number {
  if (b <= a) return 0;
  for (let i = 0; i < runs.length; i += 2) {
    const s = runs[i] as number;
    const e = runs[i + 1] as number;
    if (s <= a && b <= e) {
      return (fill[e - s] as number) - (fill[a - s] as number) - (fill[e - b] as number);
    }
  }
  return 0;
}

/** For each length up to `max`, the largest sum of `sizes`, repeats allowed, that fits it. */
function fills(sizes: Set<number>, max: number): Int32Array {
  const fill = new Int32Array(max + 1);
  for (let n = 1; n <= max; n++) {
    let best = fill[n - 1] as number;
    for (const size of sizes) {
      if (size <= n) best = Math.max(best, size + (fill[n - size] as number));
    }
    fill[n] = best;
  }
  return fill;
}
