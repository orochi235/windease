import type { LayoutResult, LayoutStrategy, Rect } from '../layout-types.js';
import { trace } from '../trace.js';
import { fitsWithin, packGap, packResult, packSize } from './pack.js';

/** One flat stretch of the packed outline: `[x, end)` is filled down to `top`. */
interface Segment {
  x: number;
  end: number;
  top: number;
}

/** Highest top across `[sky[i].x, to)`. Past the outline's end nothing is filled. */
function topOver(sky: Segment[], i: number, to: number): number {
  let top = 0;
  for (let j = i; j < sky.length; j++) {
    const segment = sky[j]!;
    if (segment.x >= to) break;
    top = Math.max(top, segment.top);
  }
  return top;
}

/** The outline with `[from, to)` raised to `top`, neighbors of equal height merged. */
function raise(sky: Segment[], from: number, to: number, top: number): Segment[] {
  const left = sky.filter((s) => s.x < from).map((s) => ({ ...s, end: Math.min(s.end, from) }));
  const right = sky.filter((s) => s.end > to).map((s) => ({ ...s, x: Math.max(s.x, to) }));
  const next: Segment[] = [];
  for (const segment of [...left, { x: from, end: to, top }, ...right]) {
    const last = next[next.length - 1];
    if (last && last.top === segment.top && last.end === segment.x) last.end = segment.end;
    else next.push(segment);
  }
  return next;
}

/**
 * Bottom-left fill: packs items at their own size, each at the lowest point
 * along the outline of what is already packed, leftmost on ties. Unlike
 * `shelfStrategy`, a short item drops into the space beside a tall one instead
 * of waiting for the next row. The container's width is the only bound; the
 * outline grows down past `container.h`, and the excess is reported as
 * `overflow`. An item wider than the container goes at the left edge. Items
 * are placed in the order given.
 *
 * Size is `natural`, else `hints.preferredSize`; an item with neither goes to
 * `unplaced`. Config takes `gap`.
 * @group Strategies
 */
export const skylineStrategy: LayoutStrategy<void, string> = {
  name: 'skyline',
  configSpec: { gap: 'number' },
  layout({ items, container, options }): LayoutResult<string> {
    const gap = packGap(options);
    const placements = new Map<string, Rect>();
    const unplaced: string[] = [];

    let sky: Segment[] = [{ x: 0, end: Math.max(0, container.w), top: 0 }];
    for (const item of items) {
      const size = packSize(item);
      if (!size) {
        unplaced.push(item.id);
        continue;
      }
      let x = 0;
      let y = Number.POSITIVE_INFINITY;
      for (let i = 0; i < sky.length; i++) {
        const candidate = sky[i]!.x;
        if (candidate > 0 && !fitsWithin(candidate + size.w, container.w)) break;
        const top = topOver(sky, i, candidate + size.w + gap);
        if (top < y) {
          x = candidate;
          y = top;
        }
      }
      placements.set(item.id, { x, y, z: 0, w: size.w, h: size.h });
      sky = raise(sky, x, x + size.w + gap, y + size.h + gap);
    }

    const result = packResult(placements, unplaced, container);
    trace(
      'layout',
      `skyline: ${placements.size} of ${items.length} at w=${container.w}, gap ${gap}, outline of ${sky.length} segments`,
      { unplaced, overflow: result.overflow },
    );
    return result;
  },
};
