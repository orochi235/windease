import { describe, expect, it } from 'vitest';
import { CellPacker } from './cell-packer.js';

/** First-fit by brute force over a `Set` of cells: the answer to agree with. */
class NaivePacker {
  private readonly taken = new Set<number>();
  constructor(
    private readonly cols: number,
    private readonly rowCap: number | undefined,
  ) {}
  get takenCount(): number {
    return this.taken.size;
  }
  free(col: number, row: number, cSpan: number, rSpan: number): boolean {
    for (let r = row; r < row + rSpan; r++) {
      for (let c = col; c < col + cSpan; c++) if (this.taken.has(r * this.cols + c)) return false;
    }
    return true;
  }
  reserve(col: number, row: number, cSpan: number, rSpan: number): boolean {
    if (!this.free(col, row, cSpan, rSpan)) return false;
    for (let r = row; r < row + rSpan; r++) {
      for (let c = col; c < col + cSpan; c++) this.taken.add(r * this.cols + c);
    }
    return true;
  }
  place(cSpan: number, rSpan: number): { col: number; row: number } | undefined {
    if (cSpan > this.cols || rSpan < 1) return undefined;
    const rows = this.rowCap ?? 400;
    for (let row = 0; row + rSpan <= rows; row++) {
      for (let col = 0; col + cSpan <= this.cols; col++) {
        if (this.reserve(col, row, cSpan, rSpan)) return { col, row };
      }
    }
    return undefined;
  }
}

/** A seeded generator, so a failure names the sequence that produced it. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('CellPacker', () => {
  for (const cols of [7, 24, 31, 32, 33, 64, 70]) {
    it(`agrees with brute force on ${cols} columns`, () => {
      const next = rng(cols);
      const rowCap = 60;
      const fast = new CellPacker(cols, rowCap);
      const slow = new NaivePacker(cols, rowCap);
      for (let i = 0; i < 300; i++) {
        const cSpan = 1 + Math.floor(next() * Math.min(cols, 40));
        const rSpan = 1 + Math.floor(next() * 4);
        if (next() < 0.2) {
          const col = Math.floor(next() * cols);
          const row = Math.floor(next() * rowCap);
          const c = Math.min(cSpan, cols - col);
          const r = Math.min(rSpan, rowCap - row);
          expect(fast.reserve(col, row, c, r)).toBe(slow.reserve(col, row, c, r));
        } else {
          expect(fast.place(cSpan, rSpan)).toEqual(slow.place(cSpan, rSpan));
        }
        expect(fast.takenCount).toBe(slow.takenCount);
      }
    });
  }

  it('undoes a trial, block by block, including the cursor', () => {
    const p = new CellPacker(40, undefined);
    p.place(40, 1);
    p.trial((q) => {
      q.place(35, 2);
      q.place(5, 1);
    });
    expect(p.takenCount).toBe(40);
    expect(p.place(40, 1)).toEqual({ col: 0, row: 1 });
  });

  it('frees a held block for a probe and takes it back after', () => {
    const p = new CellPacker(36, undefined);
    p.place(30, 1);
    const block = { col: 0, row: 0, cols: 30, rows: 1 };
    expect(p.without(block, (q) => q.free(0, 0, 36, 1))).toBe(true);
    expect(p.free(0, 0, 1, 1)).toBe(false);
    expect(p.takenCount).toBe(30);
  });
});
