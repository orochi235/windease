import type {
  Affordance,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
  StatefulLayoutStrategy,
} from '../layout-types.js';
import { trace } from '../trace.js';

export const FLOATING_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export type Corner = (typeof FLOATING_CORNERS)[number];

export interface Point {
  x: number;
  y: number;
}

/** Where an item of `size` rests when anchored to `corner`, `inset` px in on both axes. */
export function cornerOrigin(corner: Corner, size: Size, container: Size, inset: number): Point {
  const left = corner === 'top-left' || corner === 'bottom-left';
  const top = corner === 'top-left' || corner === 'top-right';
  return {
    x: left ? inset : container.w - size.w - inset,
    y: top ? inset : container.h - size.h - inset,
  };
}

/**
 * Nearest eligible corner whose resting origin is within `threshold` of `at` on
 * BOTH axes, or null. Per-axis rather than by radius: with inset and threshold
 * both 12, a panel shoved into the corner sits at (0,0), which is 12 away on each
 * axis but 16.97 away by radius — the gesture that most clearly means "snap here".
 */
export function snapCorner(
  at: Point,
  size: Size,
  container: Size,
  inset: number,
  threshold: number,
  eligible: readonly Corner[],
): Corner | null {
  let best: Corner | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const corner of eligible) {
    const origin = cornerOrigin(corner, size, container, inset);
    const dx = Math.abs(origin.x - at.x);
    const dy = Math.abs(origin.y - at.y);
    if (dx > threshold || dy > threshold) continue;
    const distance = Math.max(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = corner;
    }
  }
  return best;
}

/** Where one floating item rests. `anchor` is a sticky cache over `x`/`y`. */
export interface FloatingPlacement {
  x: number;
  y: number;
  anchor: Corner | null;
}

export function isFloating(item: LayoutItem): boolean {
  return item.meta?.floating === true;
}

export function eligibleCorners(item: LayoutItem): readonly Corner[] {
  const raw = item.meta?.snapCorners;
  if (!Array.isArray(raw)) return FLOATING_CORNERS;
  const kept = raw.filter((c): c is Corner =>
    (FLOATING_CORNERS as readonly string[]).includes(c as string),
  );
  return kept.length > 0 ? kept : FLOATING_CORNERS;
}

export function sizeOf(item: LayoutItem): Size {
  return item.natural ?? item.hints?.preferredSize ?? { w: 0, h: 0 };
}

export function clampToContainer(at: Point, size: Size, container: Size): Point {
  return {
    x: Math.max(0, Math.min(at.x, container.w - size.w)),
    y: Math.max(0, Math.min(at.y, container.h - size.h)),
  };
}

export function rectOf(
  item: LayoutItem,
  place: FloatingPlacement,
  container: Size,
  inset: number,
): Rect {
  const size = sizeOf(item);
  const origin =
    place.anchor === null
      ? clampToContainer(place, size, container)
      : cornerOrigin(place.anchor, size, container, inset);
  return { x: origin.x, y: origin.y, w: size.w, h: size.h };
}

export interface FloatingState<TInner = unknown> {
  /** Where each floating item rests, by item id. */
  at: Record<string, FloatingPlacement>;
  /** The wrapped strategy's own state, or undefined when nothing is wrapped. */
  inner: TInner;
}

export interface FloatingConfig {
  inset?: number;
  snapThreshold?: number;
  defaultAnchor?: Corner;
  /** Height of the drag band at the top of a floating item. `0` makes the whole
   *  item the handle, which covers its content. */
  handleSize?: number;
}

export const DEFAULT_INSET = 12;
export const DEFAULT_SNAP_THRESHOLD = 12;
export const DEFAULT_ANCHOR: Corner = 'bottom-left';

/** Affordance id prefix, so `reduce` can route without knowing the inner strategy. */
export const FLOATING_DRAG_PREFIX = 'floating:drag:';

function seed(options: Record<string, unknown> | undefined): FloatingPlacement {
  const anchor = (options as FloatingConfig | undefined)?.defaultAnchor ?? DEFAULT_ANCHOR;
  return { x: 0, y: 0, anchor };
}

export function floatingStrategy<TInner>(
  inner?: LayoutStrategy<TInner, string, unknown>,
): StatefulLayoutStrategy<FloatingState<TInner | undefined>, string> {
  return {
    name: inner ? `floating(${inner.name})` : 'floating',

    configSpec: {
      ...(inner?.configSpec ?? {}),
      inset: 'number',
      snapThreshold: 'number',
      handleSize: 'number',
      defaultAnchor: FLOATING_CORNERS,
    },

    initialState(items, options) {
      const at: Record<string, FloatingPlacement> = {};
      for (const item of items) if (isFloating(item)) at[item.id] = seed(options);
      const tiled = items.filter((i) => !isFloating(i));
      return { at, inner: inner?.initialState?.(tiled, options) };
    },

    layout({ items, container, state, options, preview }) {
      const cfg = options as FloatingConfig;
      const inset = cfg.inset ?? DEFAULT_INSET;
      const handleSize = cfg.handleSize ?? 0;
      const floating = items.filter(isFloating);
      const tiled = items.filter((i) => !isFloating(i));

      const innerInput = { items: tiled, container, state: state.inner as TInner, options };
      const result: LayoutResult<string> = inner
        ? inner.layout(preview ? { ...innerInput, preview } : innerInput)
        : { placements: new Map(), affordances: [] };

      const placements = new Map(result.placements);
      const affordances: Affordance[] = [...result.affordances];
      const unplaced = [...(result.unplaced ?? [])];
      for (const item of floating) {
        const size = sizeOf(item);
        // A 0x0 rect renders as a panel that vanished. `natural` arrives only
        // after a measurement, so withhold it until one does.
        if (size.w <= 0 || size.h <= 0) {
          trace('layout', `floating: ${item.id} has no size yet, withheld`);
          unplaced.push(item.id);
          continue;
        }
        const rect = rectOf(item, state.at[item.id] ?? seed(options), container, inset);
        placements.set(item.id, rect);
        affordances.push({
          id: `${FLOATING_DRAG_PREFIX}${item.id}`,
          kind: 'drag-xy',
          rect: handleSize > 0 ? { ...rect, h: Math.min(handleSize, rect.h) } : rect,
          cursor: 'grab',
          childId: item.id,
          affects: [item.id],
        });
      }

      trace('layout', `floating: ${floating.length} over ${inner?.name ?? 'nothing'}`);
      const out: LayoutResult<string> = { ...result, placements, affordances };
      if (unplaced.length > 0) out.unplaced = unplaced;
      return out;
    },

    reduce(state, event, context) {
      if (!event.affordanceId.startsWith(FLOATING_DRAG_PREFIX)) {
        if (!inner?.reduce) return state;
        return { ...state, inner: inner.reduce(state.inner as TInner, event, context) };
      }

      const id = event.affordanceId.slice(FLOATING_DRAG_PREFIX.length);
      const item = context.items.find((i) => i.id === id);
      const dx = event.payload.dx ?? 0;
      const dy = event.payload.dy ?? 0;
      if (!item || (dx === 0 && dy === 0)) return state;

      const cfg = context.options as FloatingConfig;
      const inset = cfg.inset ?? DEFAULT_INSET;
      const threshold = cfg.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
      const place = state.at[id] ?? seed(context.options);
      const size = sizeOf(item);

      const next = clampToContainer({ x: place.x + dx, y: place.y + dy }, size, context.container);
      const anchor = snapCorner(
        next,
        size,
        context.container,
        inset,
        threshold,
        eligibleCorners(item),
      );

      trace('layout', `floating: ${id} -> ${anchor ?? `${next.x},${next.y}`}`);
      return { ...state, at: { ...state.at, [id]: { ...next, anchor } } };
    },
  };
}
