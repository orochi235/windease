import { EPSILON } from '../geometry.js';
import type { Candidate, TrackerDef, Turn } from '../types.js';

/** `cols` as a count, or null when it is not a finite number of at least one. */
function fixedCount(cols: unknown): number | null {
  return typeof cols === 'number' && Number.isFinite(cols) && cols >= 1 ? Math.floor(cols) : null;
}

/**
 * Masonry columns: equal columns, and a spot on every run of adjacent columns an item's width
 * spans, resting on the tallest of them. Runs are listed left to right. Reads `columnWidth`,
 * `cols` and `justify` the way `columnStrategy` does.
 *
 * Features: `span` (columns the item covers) and `waste` (area left between the item and the
 * shorter columns under it, measured over whole column pitches).
 */
export const columnsTracker: TrackerDef = {
  id: 'columns',
  features: ['span', 'waste'],
  configSpec: { columnWidth: 'number', cols: 'number', justify: ['start', 'center', 'end'] },
  create({ container, gap, options, sizes }) {
    const fixed = fixedCount(options.cols);
    let narrowest = Number.POSITIVE_INFINITY;
    for (const size of sizes) narrowest = Math.min(narrowest, size.w);
    const cw = options.columnWidth;
    const columnWidth =
      fixed !== null
        ? Math.max(0, (container.w - (fixed - 1) * gap) / fixed)
        : typeof cw === 'number' && Number.isFinite(cw) && cw > 0
          ? cw
          : Number.isFinite(narrowest)
            ? narrowest
            : 0;
    const pitch = columnWidth + gap;
    const count =
      fixed ?? (pitch > 0 ? Math.max(1, Math.floor((container.w + gap + EPSILON) / pitch)) : 1);
    const free = fixed !== null ? 0 : Math.max(0, container.w - (count * pitch - gap));
    const lead = options.justify === 'center' ? free / 2 : options.justify === 'end' ? free : 0;
    const heights = new Array<number>(count).fill(0);

    return {
      candidates(turns: readonly Turn[]): Candidate[] {
        const out: Candidate[] = [];
        // Running sums of column heights, so each run's waste is O(1).
        const sums = new Float64Array(count + 1);
        for (let c = 0; c < count; c++) sums[c + 1] = sums[c]! + heights[c]!;
        for (const turn of turns) {
          const span = Math.min(count, Math.max(1, Math.ceil((turn.w + gap - EPSILON) / pitch)));
          const x0 = Math.max(0, container.w - turn.w);
          // Sliding-window maximum over `span` columns: `window` holds column indices whose
          // heights decrease, so its head is the tallest in the run.
          const window: number[] = [];
          let head = 0;
          for (let c = 0; c < count; c++) {
            while (window.length > head && heights[window[window.length - 1]!]! <= heights[c]!) {
              window.pop();
            }
            window.push(c);
            const first = c - span + 1;
            if (first < 0) continue;
            if (window[head]! < first) head++;
            const top = heights[window[head]!]!;
            const waste = (top * span - (sums[first + span]! - sums[first]!)) * pitch;
            out.push({
              x: Math.min(lead + first * pitch, x0),
              y: top,
              turn,
              extra: { span, waste, first },
            });
          }
        }
        return out;
      },
      commit({ y, turn, extra }) {
        const first = extra.first!;
        for (let c = first; c < first + extra.span!; c++) heights[c] = y + turn.h + gap;
      },
    };
  },
};
