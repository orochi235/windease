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

/** The four corners a floating item can anchor to. */
export const FLOATING_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

/** One of {@link FLOATING_CORNERS}. */
export type Corner = (typeof FLOATING_CORNERS)[number];

/** A position in container-relative coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** A rect a floating item can snap into: the container, or one tiled pane. */
export interface SnapTarget {
  /** The pane's item id, or null for the container itself. */
  id: string | null;
  rect: Rect;
}

/** Which target and corner an item is anchored to. */
export interface SnapHit {
  corner: Corner;
  to: string | null;
}

/** The whole container as a snap target. */
export function containerTarget(container: Size): SnapTarget {
  return { id: null, rect: { x: 0, y: 0, w: container.w, h: container.h } };
}

/** Where an item of `size` rests when anchored to `corner` of `within`, `inset` px in. */
export function cornerOrigin(corner: Corner, size: Size, within: Rect, inset: number): Point {
  const left = corner === 'top-left' || corner === 'bottom-left';
  const top = corner === 'top-left' || corner === 'top-right';
  return {
    x: left ? within.x + inset : within.x + within.w - size.w - inset,
    y: top ? within.y + inset : within.y + within.h - size.h - inset,
  };
}

/**
 * Nearest eligible corner of any target whose resting origin is within
 * `threshold` of `at` on BOTH axes, or null. Per-axis rather than by radius:
 * with inset and threshold both 12, a panel shoved into the corner sits at
 * (0,0), which is 12 away on each axis but 16.97 away by radius — the gesture
 * that most clearly means "snap here".
 */
export function snapCorner(
  at: Point,
  size: Size,
  targets: readonly SnapTarget[],
  inset: number,
  threshold: number,
  eligible: readonly Corner[],
): SnapHit | null {
  let best: SnapHit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    for (const corner of eligible) {
      const origin = cornerOrigin(corner, size, target.rect, inset);
      const dx = Math.abs(origin.x - at.x);
      const dy = Math.abs(origin.y - at.y);
      if (dx > threshold || dy > threshold) continue;
      const distance = Math.max(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { corner, to: target.id };
      }
    }
  }
  return best;
}

/** Where one floating item rests. `anchor` is a sticky cache over `x`/`y`. */
export interface FloatingPlacement {
  x: number;
  y: number;
  anchor: Corner | null;
  /** The pane the anchor belongs to; absent means the container's own corner. */
  anchorTo?: string;
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

/**
 * Where an item rests right now: its anchor's corner when it has one that still
 * resolves, and its free position otherwise. A pane anchor stops resolving when
 * the pane is gone, which drops the item back to where it last was.
 */
export function resolveOrigin(
  place: FloatingPlacement,
  size: Size,
  container: Size,
  inset: number,
  panes?: ReadonlyMap<string, Rect>,
): Point {
  if (place.anchor === null) return clampToContainer(place, size, container);
  const within =
    place.anchorTo === undefined ? containerTarget(container).rect : panes?.get(place.anchorTo);
  if (!within) return clampToContainer(place, size, container);
  return cornerOrigin(place.anchor, size, within, inset);
}

export function rectOf(
  item: LayoutItem,
  place: FloatingPlacement,
  container: Size,
  inset: number,
  panes?: ReadonlyMap<string, Rect>,
): Rect {
  const size = sizeOf(item);
  const origin = resolveOrigin(place, size, container, inset, panes);
  return { x: origin.x, y: origin.y, w: size.w, h: size.h };
}

/** {@link floatingStrategy}'s state: where the floating items rest, plus
 *  whatever state the wrapped strategy keeps for the tiled ones. */
export interface FloatingState<TInner = unknown> {
  /** Where each floating item rests, by item id. */
  at: Record<string, FloatingPlacement>;
  /** The wrapped strategy's own state, or undefined when nothing is wrapped. */
  inner: TInner;
}

/** `container.config` keys {@link floatingStrategy} reads. */
export interface FloatingConfig {
  inset?: number;
  snapThreshold?: number;
  defaultAnchor?: Corner;
  /** Height of the drag band at the top of a floating item. `0` makes the whole
   *  item the handle, which covers its content. */
  handleSize?: number;
  /** Also snap to the corners of the panes the inner strategy placed, not only
   *  the container's own. Costs one extra inner layout pass per drag event. */
  snapToPanes?: boolean;
}

/** Pixels between a snapped item and its target's edges. */
export const DEFAULT_INSET = 12;
/** How near a corner a drag must end to snap to it, in pixels. */
export const DEFAULT_SNAP_THRESHOLD = 12;
/** The corner a floating item takes when nothing says otherwise. */
export const DEFAULT_ANCHOR: Corner = 'bottom-left';

/** Affordance id prefix, so `reduce` can route without knowing the inner strategy. */
export const FLOATING_DRAG_PREFIX = 'floating:drag:';

function seed(options: Record<string, unknown> | undefined): FloatingPlacement {
  const anchor = (options as FloatingConfig | undefined)?.defaultAnchor ?? DEFAULT_ANCHOR;
  return { x: 0, y: 0, anchor };
}

/**
 * Wraps another strategy so items marked `meta.floating` are dragged freely
 * and corner-snapped, while the rest are tiled by `inner` as usual. Called
 * with no argument, everything floats.
 *
 * Anchors are sticky: a snapped item keeps its corner across container
 * resizes rather than holding the pixel position it happened to land on.
 * @group Strategies
 */
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
      snapToPanes: 'boolean',
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
      // The panes are the inner strategy's own placements; a floating item is
      // never one of them, so this cannot anchor an item to itself.
      const panes = cfg.snapToPanes ? result.placements : undefined;
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
        const rect = rectOf(item, state.at[item.id] ?? seed(options), container, inset, panes);
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

      // Pane corners are the inner strategy's placements, which only it can
      // produce — so ask it, at the cost of one layout pass per drag event.
      const panes =
        cfg.snapToPanes && inner
          ? inner.layout({
              items: context.items.filter((i) => !isFloating(i)),
              container: context.container,
              state: state.inner as TInner,
              options: context.options,
            }).placements
          : undefined;
      const targets: SnapTarget[] = [containerTarget(context.container)];
      if (panes) for (const [paneId, rect] of panes) targets.push({ id: paneId, rect });

      // An anchor set by anything but a drag — the seed, or a resize since —
      // leaves x/y nowhere near where the item renders, so accumulating from
      // them teleports the panel on the first move. Re-base on where it rests
      // when the two disagree; a drag-set anchor always agrees, which is what
      // lets a slow drag accumulate past the corner and escape.
      const anchored =
        place.anchor === null ? null : resolveOrigin(place, size, context.container, inset, panes);
      const stale =
        anchored !== null &&
        (Math.abs(anchored.x - place.x) > threshold || Math.abs(anchored.y - place.y) > threshold);
      const base = stale && anchored ? anchored : place;

      const next = clampToContainer({ x: base.x + dx, y: base.y + dy }, size, context.container);
      const hit = snapCorner(next, size, targets, inset, threshold, eligibleCorners(item));

      trace(
        'layout',
        `floating: ${id} -> ${hit ? `${hit.corner} of ${hit.to ?? 'container'}` : `${next.x},${next.y}`}`,
      );
      const placed: FloatingPlacement = { ...next, anchor: hit?.corner ?? null };
      if (hit?.to != null) placed.anchorTo = hit.to;
      return { ...state, at: { ...state.at, [id]: placed } };
    },

    canAccept(items, options) {
      if (!inner?.canAccept) return true;
      return inner.canAccept(
        items.filter((i) => !isFloating(i)),
        options,
      );
    },

    navigate(input) {
      if (!inner?.navigate) return undefined;
      return inner.navigate({ ...input, items: input.items.filter((i) => !isFloating(i)) });
    },
  };
}
