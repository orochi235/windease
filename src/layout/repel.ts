import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  PlacedRect,
  Size,
} from '../layout-types.js';
import { trace } from '../trace.js';

/** `container.config` keys {@link repelStrategy} reads. */
export interface RepelConfig {
  /** The space kept between two items. */
  gap?: number;
  /** The furthest an item is moved from where it wants to be. Past it, it stays and overlaps. */
  drift?: number;
}

export const DEFAULT_REPEL_GAP = 8;

/** Edges this close count as touching rather than overlapping: a spot computed `gap` off an edge
 *  must not fail its own test to rounding. */
const EPSILON = 1e-6;

type Point = { x: number; y: number };

function sizeOf(item: LayoutItem): Size | null {
  const w = item.natural?.w ?? item.hints?.preferredSize?.w;
  const h = item.natural?.h ?? item.hints?.preferredSize?.h;
  const usable = (n: number | undefined): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n > 0;
  return usable(w) && usable(h) ? { w, h } : null;
}

function wantOf(item: LayoutItem): Point | null {
  const { x, y } = item.meta ?? {};
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : null;
}

const clear = (r: PlacedRect, o: PlacedRect, gap: number) =>
  r.x >= o.x + o.w + gap - EPSILON ||
  o.x >= r.x + r.w + gap - EPSILON ||
  r.y >= o.y + o.h + gap - EPSILON ||
  o.y >= r.y + r.h + gap - EPSILON;

/**
 * Places each item where its `meta.x` / `meta.y` asks, in item order, later ones nearer. An item
 * that would overlap one already placed moves to the nearest spot that overlaps nothing, choosing
 * among the spots `gap` off the placed items' edges. With no such spot within `drift` it keeps the
 * spot it asked for and draws above.
 *
 * Deterministic rather than relaxed: the same items always give the same rects, so a host that
 * lays out on every change does not see its items jitter. An item with no position or no size
 * goes to `unplaced`.
 * @group Strategies
 */
export const repelStrategy: LayoutStrategy<void, string> = {
  name: 'repel',
  configSpec: { gap: 'number', drift: 'number' },
  layout({ items, options }): LayoutResult<string> {
    const gap = typeof options.gap === 'number' ? options.gap : DEFAULT_REPEL_GAP;
    const drift = typeof options.drift === 'number' ? options.drift : Number.POSITIVE_INFINITY;
    const placements = new Map<string, PlacedRect>();
    const placed: PlacedRect[] = [];
    const unplaced: string[] = [];
    for (const item of items) {
      const size = sizeOf(item);
      const want = wantOf(item);
      if (!size || !want) {
        trace('layout', `repel: ${item.id} has no ${size ? 'position' : 'size'}, unplaced`);
        unplaced.push(item.id);
        continue;
      }
      const xs = [want.x, ...placed.flatMap((o) => [o.x - gap - size.w, o.x + o.w + gap])];
      const ys = [want.y, ...placed.flatMap((o) => [o.y - gap - size.h, o.y + o.h + gap])];
      let best: Point | null = null;
      let reach = Number.POSITIVE_INFINITY;
      for (const y of ys) {
        for (const x of xs) {
          const r = { x, y, z: 0, ...size };
          if (!placed.every((o) => clear(r, o, gap))) continue;
          const d = Math.hypot(x - want.x, y - want.y);
          if (d < reach) {
            best = { x, y };
            reach = d;
          }
        }
      }
      const at = best && reach <= drift ? best : want;
      if (at === want && reach > 0) {
        trace('layout', `repel: ${item.id} found no spot within ${drift}, overlaps`);
      }
      const rect = { x: at.x, y: at.y, z: placed.length + 1, ...size };
      placements.set(item.id, rect);
      placed.push(rect);
    }
    return { placements, affordances: [], ...(unplaced.length ? { unplaced } : {}) };
  },
};
