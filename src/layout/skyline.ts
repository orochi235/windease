import type { LayoutResult, LayoutStrategy, Rect, Size } from '../layout-types.js';
import { trace } from '../trace.js';
import {
  fitsWithin,
  PACK_OVERFLOW_MODES,
  PACK_SORTS,
  type PackTurn,
  packBounded,
  packGap,
  packLeast,
  packPocketPass,
  packQueue,
  packResult,
  packRotate,
  packTurns,
} from './pack.js';

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

/** Where `turn` would go on `sky`: the lowest spot, leftmost on ties, or null
 *  when a bound leaves it nowhere. */
function lowestSpot(
  sky: Segment[],
  turn: PackTurn,
  container: Size,
  gap: number,
  bounded: boolean,
): { x: number; y: number } | null {
  let x = 0;
  let y = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sky.length; i++) {
    const candidate = sky[i]!.x;
    if ((bounded || candidate > 0) && !fitsWithin(candidate + turn.w, container.w)) break;
    const top = topOver(sky, i, candidate + turn.w + gap);
    if (top < y) {
      x = candidate;
      y = top;
    }
  }
  if (y === Number.POSITIVE_INFINITY) return null;
  if (bounded && !fitsWithin(y + turn.h, container.h)) return null;
  return { x, y };
}

/**
 * Bottom-left fill: packs items at their own size, each at the lowest point
 * along the outline of what is already packed, leftmost on ties. Unlike
 * `shelfStrategy`, a short item drops into the space beside a tall one instead
 * of waiting for the next row. By default the container's width is the only
 * bound; the outline grows down past `container.h`, and the excess is reported
 * as `overflow`. An item wider than the container goes at the left edge. Under
 * `overflowMode: 'unplaced'` the container is a bin, and an item whose lowest
 * spot would cross either edge goes to `unplaced`.
 *
 * With `rotate: true` an item may be turned a quarter: it takes whichever way
 * leaves its top edge lower, upright on a tie, and a way that fits the width
 * beats one that does not. Each placement then carries a `rotation` channel,
 * 90 or 0.
 *
 * Items are placed in the order given, or by `sort`, descending by that
 * measure with ties kept in input order. Size is `natural`, else
 * `hints.preferredSize`; an item with neither goes to `unplaced`. Config
 * takes `gap`, `sort`, `rotate`, `overflowMode` and `pocket`.
 *
 * `pocket: { w, h }` holds back every item whose width and height are both
 * under that size and packs them together into the largest empty rectangle
 * this pass leaves, instead of each taking a spot in the flow.
 * @group Strategies
 */
export const skylineStrategy: LayoutStrategy<void, string> = {
  name: 'skyline',
  configSpec: {
    gap: 'number',
    sort: PACK_SORTS,
    rotate: 'boolean',
    overflowMode: PACK_OVERFLOW_MODES,
    pocket: 'object',
  },
  layout({ items, container, options }): LayoutResult<string> {
    const pocket = packPocketPass(skylineStrategy, { items, container, options });
    if (pocket) return pocket;

    const gap = packGap(options);
    const bounded = packBounded(options);
    const rotate = packRotate(options);
    const { queue } = packQueue(items, options);
    const placed = new Map<string, Rect>();
    const turned = new Set<string>();

    let sky: Segment[] = [{ x: 0, end: Math.max(0, container.w), top: 0 }];
    for (const { item, size } of queue) {
      const spots = packTurns(size, rotate).flatMap((turn) => {
        const at = lowestSpot(sky, turn, container, gap, bounded);
        return at ? [{ turn, ...at }] : [];
      });
      const best = packLeast(
        spots,
        (s) => (fitsWithin(s.turn.w, container.w) ? 0 : 1),
        (s) => s.y + s.turn.h,
      );
      if (!best) continue;
      const { turn, x, y } = best;
      placed.set(item.id, { x, y, z: 0, w: turn.w, h: turn.h });
      if (turn.turned) turned.add(item.id);
      sky = raise(sky, x, x + turn.w + gap, y + turn.h + gap);
    }

    const result = packResult(items, placed, container, rotate ? turned : null);
    trace(
      'layout',
      `skyline: ${placed.size} of ${items.length} at w=${container.w}, gap ${gap}, sort ${String(options.sort ?? 'none')}${rotate ? `, ${turned.size} turned` : ''}, outline of ${sky.length} segments`,
      { unplaced: result.unplaced, overflow: result.overflow },
    );
    return result;
  },
};
