import type { Rect, Size } from '../layout-types.js';
import { PACK_EPSILON } from './pack.js';

/** Unique values in `xs`, ascending, with values within `PACK_EPSILON` folded together. */
function coordinates(xs: number[]): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || x - last > PACK_EPSILON) out.push(x);
  }
  return out;
}

/**
 * The largest axis-aligned rectangle inside `container` that none of
 * `obstacles` covers, or null when nothing is left. Each obstacle is grown by
 * `gap` on every side first, so the result never sits closer than `gap` to
 * what is already placed, and is clipped to the container, so an obstacle
 * running past an edge bounds the search without moving it.
 *
 * Equal areas break toward the greatest `y`, then the greatest `x` — the
 * direction the packing strategies flow — so the result sits after the
 * content rather than above it.
 *
 * The obstacles' edges are the only candidate edges, so the search runs over
 * the grid they cut the container into: O(n²) cells for n obstacles, each
 * scanned once by the usual largest-rectangle-under-a-histogram sweep.
 * Arithmetic only; nothing here reads the DOM.
 */
export function largestEmptyRect(obstacles: Iterable<Rect>, container: Size, gap = 0): Rect | null {
  if (!(container.w > 0) || !(container.h > 0)) return null;

  const blocks: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const o of obstacles) {
    const x0 = Math.max(0, o.x - gap);
    const y0 = Math.max(0, o.y - gap);
    const x1 = Math.min(container.w, o.x + o.w + gap);
    const y1 = Math.min(container.h, o.y + o.h + gap);
    if (x1 - x0 > PACK_EPSILON && y1 - y0 > PACK_EPSILON) blocks.push({ x0, y0, x1, y1 });
  }
  if (blocks.length === 0) {
    return { x: 0, y: 0, z: 0, w: container.w, h: container.h };
  }

  const xs = coordinates([0, container.w, ...blocks.flatMap((b) => [b.x0, b.x1])]);
  const ys = coordinates([0, container.h, ...blocks.flatMap((b) => [b.y0, b.y1])]);
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  if (cols < 1 || rows < 1) return null;

  // free[r][c]: no obstacle covers the cell. Cell edges come from the
  // obstacles, so a cell is covered whole or not at all.
  const free: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row = new Array<boolean>(cols).fill(true);
    const top = ys[r]!;
    const bottom = ys[r + 1]!;
    for (const b of blocks) {
      if (b.y0 > top + PACK_EPSILON || b.y1 < bottom - PACK_EPSILON) continue;
      for (let c = 0; c < cols; c++) {
        if (!row[c]) continue;
        const left = xs[c]!;
        const right = xs[c + 1]!;
        if (b.x0 <= left + PACK_EPSILON && b.x1 >= right - PACK_EPSILON) row[c] = false;
      }
    }
    free.push(row);
  }

  let best: Rect | null = null;
  const better = (candidate: Rect): boolean => {
    if (best === null) return true;
    const area = candidate.w * candidate.h;
    const bestArea = best.w * best.h;
    if (area - bestArea > PACK_EPSILON) return true;
    if (bestArea - area > PACK_EPSILON) return false;
    if (candidate.y - best.y > PACK_EPSILON) return true;
    if (best.y - candidate.y > PACK_EPSILON) return false;
    return candidate.x - best.x > PACK_EPSILON;
  };

  // Heights of the free run ending at each row, in pixels; the usual
  // histogram sweep then reads the widest span each height spans.
  const heights = new Array<number>(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    const rowHeight = ys[r + 1]! - ys[r]!;
    for (let c = 0; c < cols; c++) {
      heights[c] = free[r]![c] ? heights[c]! + rowHeight : 0;
    }
    for (let c = 0; c < cols; c++) {
      const h = heights[c]!;
      if (h <= PACK_EPSILON) continue;
      let left = c;
      while (left > 0 && heights[left - 1]! >= h - PACK_EPSILON) left--;
      let right = c;
      while (right + 1 < cols && heights[right + 1]! >= h - PACK_EPSILON) right++;
      const x = xs[left]!;
      const w = xs[right + 1]! - x;
      const y = ys[r + 1]! - h;
      const candidate: Rect = { x, y, z: 0, w, h };
      if (w > PACK_EPSILON && better(candidate)) best = candidate;
    }
  }
  return best;
}
