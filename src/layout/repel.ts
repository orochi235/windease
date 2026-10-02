import type { LayoutResult, LayoutStrategy, PlacedRect } from '../layout-types.js';
import { trace } from '../trace.js';
import { itemSize, itemWant } from './item-place.js';

/** `container.config` keys {@link repelStrategy} reads. */
export interface RepelConfig {
  /** The space kept between two items. Default {@link DEFAULT_REPEL_GAP}; a negative or
   *  non-finite value reads as the default. */
  gap?: number;
  /** The furthest an item is moved from where it wants to be, in a straight line. Past it, it
   *  stays and overlaps. Default unbounded; a negative or NaN value reads as unbounded. */
  drift?: number;
}

/** The `gap` {@link repelStrategy} keeps between items when `container.config.gap` is unset, in px. */
export const DEFAULT_REPEL_GAP = 8;

/** Edges this close count as touching rather than overlapping: a spot computed `gap` off an edge
 *  must not fail its own test to rounding. */
const EPSILON = 1e-6;

type Point = { x: number; y: number };

const clear = (r: PlacedRect, o: PlacedRect, gap: number) =>
  r.x >= o.x + o.w + gap - EPSILON ||
  o.x >= r.x + r.w + gap - EPSILON ||
  r.y >= o.y + o.h + gap - EPSILON ||
  o.y >= r.y + r.h + gap - EPSILON;

const unique = (xs: number[]) => [...new Set(xs)];

function gapOf(options: Record<string, unknown>): number {
  const g = options.gap;
  if (g === undefined) return DEFAULT_REPEL_GAP;
  if (typeof g === 'number' && Number.isFinite(g) && g >= 0) return g;
  trace(
    'layout',
    `repel: gap ${String(g)} is not a non-negative number, using ${DEFAULT_REPEL_GAP}`,
  );
  return DEFAULT_REPEL_GAP;
}

function driftOf(options: Record<string, unknown>): number {
  const d = options.drift;
  if (d === undefined) return Number.POSITIVE_INFINITY;
  if (typeof d === 'number' && d >= 0) return d;
  trace('layout', `repel: drift ${String(d)} is not a non-negative number, unbounded`);
  return Number.POSITIVE_INFINITY;
}

/**
 * Places each item where its `meta.x` / `meta.y` asks, in item order, later ones nearer. An item
 * that would come within `gap` of one already placed moves to the nearest spot that keeps `gap`
 * from every placed item, choosing among the spots `gap` off the placed items' edges. Nearest is
 * by straight-line distance. A tie goes to the first spot tried: rows in turn, the wanted row, then
 * each placed item's rows in placement order, above before below; within a row, columns the same
 * way, left before right. With no such spot within `drift` it keeps the spot it asked for and
 * draws above.
 *
 * The container is not consulted: a moved item can land outside it, and the host decides what
 * bounds apply. Deterministic rather than relaxed: the same items always give the same rects, so a
 * host that lays out on every change does not see its items jitter. An item with no position or no
 * size goes to `unplaced`; size comes from `placement.size`, else `natural`, else
 * `hints.preferredSize`, as in the desktop strategy.
 * @group Strategies
 */
export const repelStrategy: LayoutStrategy<void, string> = {
  name: 'repel',
  configSpec: { gap: 'number', drift: 'number' },
  layout({ items, options }): LayoutResult<string> {
    const gap = gapOf(options);
    const drift = driftOf(options);
    const placements = new Map<string, PlacedRect>();
    const placed: PlacedRect[] = [];
    const unplaced: string[] = [];
    let moved = 0;
    let gaveUp = 0;
    for (const item of items) {
      const size = itemSize(item);
      const want = itemWant(item);
      if (!size || !want) {
        trace('layout', `repel: ${item.id} has no ${size ? 'position' : 'size'}, unplaced`);
        unplaced.push(item.id);
        continue;
      }
      const xs = unique([want.x, ...placed.flatMap((o) => [o.x - gap - size.w, o.x + o.w + gap])]);
      const ys = unique([want.y, ...placed.flatMap((o) => [o.y - gap - size.h, o.y + o.h + gap])]);
      let best: Point | null = null;
      let reach = Number.POSITIVE_INFINITY;
      for (const y of ys) {
        for (const x of xs) {
          const d = Math.hypot(x - want.x, y - want.y);
          if (d >= reach) continue;
          const r = { x, y, z: 0, ...size };
          if (!placed.every((o) => clear(r, o, gap))) continue;
          best = { x, y };
          reach = d;
        }
      }
      let at = want;
      if (best && reach <= drift) {
        at = best;
        if (reach > 0) moved++;
      } else {
        gaveUp++;
        trace('layout', `repel: ${item.id} found no spot within ${drift}, overlaps`);
      }
      const rect = { x: at.x, y: at.y, z: placed.length + 1, ...size };
      placements.set(item.id, rect);
      placed.push(rect);
    }
    trace(
      'layout',
      `repel: ${placed.length} of ${items.length} placed, ${moved} moved, ${gaveUp} gave up, gap ${gap}, drift ${drift}`,
      { unplaced },
    );
    return { placements, affordances: [], ...(unplaced.length ? { unplaced } : {}) };
  },
};
