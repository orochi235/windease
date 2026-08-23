import type {
  Affordance,
  AffordanceJoin,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import { selectByCapacity } from './capacity.js';
import { clampExplicitSizes } from './resize.js';
import { DEFAULT_JOIN_THRESHOLD } from './seam-join.js';

interface StripConfig {
  axis?: 'x' | 'y';
  gap?: number;
  padding?: number;
  /**
   * When true, items without a preferredSize along the main axis share any
   * leftover space. When false (default), hintless items use defaultItemSize.
   */
  fill?: boolean;
  /**
   * Main-axis size assigned to items without preferredSize when fill=false.
   * Defaults to 0. Ignored when fill=true.
   */
  defaultItemSize?: number;
  /**
   * When true (default), trailing-edge resize affordances are emitted on
   * every non-last child. Consumers can set false to disable.
   */
  resizable?: boolean;
  /**
   * How a resize affordance distributes its delta.
   *
   * `'redistribute'` (default) writes only the dragged child; the delta is
   * absorbed by whichever siblings are unconstrained, spread across all of
   * them. Right for a fill row.
   *
   * `'neighbor'` writes the dragged child and the one after it, leaving the
   * rest alone — the seam moves and nothing beyond it does, which is how a
   * splitter behaves. Total extent is conserved.
   */
  resizeMode?: 'redistribute' | 'neighbor';
  /**
   * When true, pushing a seam past a pane's floor arms a join: releasing there
   * destroys that pane. What becomes of the freed extent is ordinary re-layout,
   * so panes carrying an explicit `placement.size` under `fill: false` leave it
   * empty rather than absorbing it. Off by default — the gesture deletes a pane
   * with no confirmation step.
   *
   * Ignored unless `resizeMode: 'neighbor'`; a redistribute seam spreads its
   * delta across every sibling and so has no single pane to name as the victim.
   */
  joinOnOvershoot?: boolean;
  /** Main-axis pixels past the floor before the join arms. Defaults to 24. */
  joinThreshold?: number;
  /**
   * Absolute cap on the number of items the zone accepts. Items beyond this
   * count go to `unplaced` and the default `canAccept` rejects drops that
   * would overflow it.
   */
  maxItems?: number;
  /**
   * What to do when the panes ask for more main-axis extent than the container
   * has.
   *
   * `'squeeze'` (default) scales them down until floors bind, then reports the
   * remainder as `overflow`.
   *
   * `'scroll'` lays out at the extent the panes asked for and reports the
   * whole excess as `overflow`, for a host that sizes a scrolling box to it.
   * A measured pane holds at its measurement rather than shrinking below it.
   *
   * `'unplace'` places what fits at full extent and sends the rest to
   * `unplaced`. Composes with `maxItems`, which caps by count instead.
   */
  overflowMode?: 'squeeze' | 'scroll' | 'unplace';
}

function explicitAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  const size = (item as unknown as { placement?: { size?: { w?: number; h?: number } } }).placement
    ?.size;
  const v = axis === 'x' ? size?.w : size?.h;
  return typeof v === 'number' ? v : undefined;
}

/** A measured content extent, honored only on an axis the item asked to be
 *  sized by content. Absent until an adapter has measured — the first layout
 *  pass always runs without it.
 *
 *  Floored at `minSize` here, unlike an explicit `placement.size`, which
 *  `clampExplicitSizes` renders as written even below the item's own minimum.
 *  That exemption exists so a consumer can deliberately collapse a pane; a
 *  measurement states no such intent. */
function naturalAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  const asked = axis === 'x' ? item.hints?.sizing?.w : item.hints?.sizing?.h;
  if (asked !== 'content') return undefined;
  const v = axis === 'x' ? item.natural?.w : item.natural?.h;
  return typeof v === 'number' ? Math.max(v, effectiveMinAxis(item, axis)) : undefined;
}

/** The extent this item is asking for, whatever it asked with. A measurement
 *  is a stated size like any other: it scales under pressure and it loses to
 *  an explicit `placement.size`, which is how a gutter drag pins a pane. */
function requestedAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  return explicitAxis(item, axis) ?? naturalAxis(item, axis);
}

function effectiveMinAxis(item: LayoutItem, axis: 'x' | 'y'): number {
  const m = item.hints?.minSize;
  if (!m) return 0;
  return axis === 'x' ? m.w : m.h;
}

function effectiveMaxAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  const m = (item as unknown as { hints?: { maxSize?: { w?: number; h?: number } } }).hints
    ?.maxSize;
  if (!m) return undefined;
  const v = axis === 'x' ? m.w : m.h;
  return typeof v === 'number' ? v : undefined;
}

/** Effective reach of a resize affordance on `item`, given what siblings'
 *  minimums already claim. Mirrors `dispatchAffordance`'s clamp order.
 *
 *  `pair` is the neighbor under `resizeMode: 'neighbor'`, where the two panes
 *  conserve their total and the reach is bounded by the neighbor's limits
 *  rather than by every sibling's. Without it the affordance advertises a
 *  maximum the drag refuses to reach — which a DOM adapter publishes as
 *  `aria-valuemax`, promising a screen-reader user an extent that does not
 *  exist. */
function boundsFor(
  item: LayoutItem,
  valueNow: number,
  placedItems: LayoutItem[],
  axis: 'x' | 'y',
  usableMain: number,
  pair?: { item: LayoutItem; extent: number },
): NonNullable<Affordance['bounds']> {
  const own = effectiveMinAxis(item, axis);
  const max = effectiveMaxAxis(item, axis);

  let valueMax: number;
  if (pair) {
    const total = valueNow + pair.extent;
    valueMax = total - effectiveMinAxis(pair.item, axis);
    const pairMax = effectiveMaxAxis(pair.item, axis);
    if (pairMax !== undefined && total - pairMax > own) {
      // The neighbor's own ceiling stops this pane shrinking any further.
      return finishBounds(axis, valueNow, Math.max(own, total - pairMax), valueMax, max);
    }
  } else {
    const otherMinSum = placedItems
      .filter((it) => it.id !== item.id)
      .reduce((s, it) => s + effectiveMinAxis(it, axis), 0);
    valueMax = usableMain - otherMinSum;
  }
  if (max !== undefined && max < valueMax) valueMax = max;
  if (valueMax < own) valueMax = own;
  // A pane sized under its own min (a collapsed palette) would otherwise
  // advertise a range that excludes where it currently sits.
  const valueMin = Math.min(own, valueNow);
  if (valueMax < valueMin) valueMax = valueMin;

  return finishBounds(axis, valueNow, valueMin, valueMax, max);
}

function finishBounds(
  axis: 'x' | 'y',
  valueNow: number,
  valueMin: number,
  valueMax: number,
  ownMax?: number,
): NonNullable<Affordance['bounds']> {
  let hi = ownMax !== undefined && ownMax < valueMax ? ownMax : valueMax;
  if (hi < valueMin) hi = valueMin;
  return {
    orientation: axis === 'x' ? 'horizontal' : 'vertical',
    valueNow,
    valueMin,
    valueMax: hi,
    atMin: valueNow <= valueMin,
    atMax: valueNow >= hi,
  };
}

/** The main-axis extent every placed item receives. `layout` writes these into
 *  the rects and `dispatchAffordance` resizes from them; computing the row
 *  twice is how a seam came to advertise a base its pane never rendered at. */
function mainSizes(
  placedItems: LayoutItem[],
  cfg: StripConfig,
  axis: 'x' | 'y',
  usableMain: number,
): number[] {
  // Under `scroll` the row is laid out against what it asked for rather than
  // what it has, so nothing scales and the excess is reported instead. A
  // measured pane holds at its measurement for the same reason an explicit
  // one does: it is what the pane asked for.
  const intrinsicMain = placedItems.reduce((sum, it) => sum + intrinsicAxis(it, axis), 0);
  const budget = cfg.overflowMode === 'scroll' ? Math.max(usableMain, intrinsicMain) : usableMain;

  // If any child has explicit placement.size on the main axis, use the clamp
  // helper for the whole row. Otherwise take the preferredSize/fill path.
  if (placedItems.some((it) => requestedAxis(it, axis) !== undefined)) {
    const clamp = clampExplicitSizes({
      available: budget,
      items: placedItems.map((it) => ({
        id: it.id,
        explicit: requestedAxis(it, axis),
        min: effectiveMinAxis(it, axis),
        max: effectiveMaxAxis(it, axis),
      })),
    });
    return placedItems.map((it) => clamp.get(it.id) ?? 0);
  }

  const fill = cfg.fill ?? false;
  const preferred = placedItems.map((item) =>
    axis === 'x' ? (item.hints?.preferredSize?.w ?? 0) : (item.hints?.preferredSize?.h ?? 0),
  );
  const totalPreferred = preferred.reduce((sum, v) => sum + v, 0);
  const flexCount = preferred.filter((v) => v === 0).length;
  const flexMain =
    fill && flexCount > 0 ? Math.max(0, (usableMain - totalPreferred) / flexCount) : 0;
  const fallbackMain = fill ? flexMain : (cfg.defaultItemSize ?? 0);
  // Floor at min here too: without it `minSize` is honored only when some
  // sibling happens to carry an explicit size, and ignored otherwise.
  return placedItems.map((item, i) => {
    const v = preferred[i] ?? 0;
    return Math.max(v > 0 ? v : fallbackMain, effectiveMinAxis(item, axis));
  });
}

/** The join a seam between `item` and `next` declares, or undefined when this
 *  container has not opted in. */
function joinFor(
  cfg: StripConfig,
  item: LayoutItem,
  next: LayoutItem | undefined,
): AffordanceJoin | undefined {
  if (!next) return undefined;
  if (cfg.resizeMode !== 'neighbor') return undefined;
  if (!(cfg.joinOnOvershoot ?? false)) return undefined;
  return {
    atMin: item.id,
    atMax: next.id,
    threshold: cfg.joinThreshold ?? DEFAULT_JOIN_THRESHOLD,
  };
}

function writeSize(store: unknown, id: string, axis: 'x' | 'y', value: number): void {
  const s = store as {
    getNode: (id: string) => { membership?: { placement?: Record<string, unknown> } } | undefined;
    patchPlacement: (id: string, patch: Record<string, unknown>) => void;
  };
  const existing = (s.getNode(id)?.membership?.placement?.size ?? {}) as { w?: number; h?: number };
  s.patchPlacement(id, {
    size: axis === 'x' ? { ...existing, w: value } : { ...existing, h: value },
  });
}

/** What this item asks to occupy on the main axis when nothing compresses it. */
function intrinsicAxis(item: LayoutItem, axis: 'x' | 'y'): number {
  return requestedAxis(item, axis) ?? effectiveMinAxis(item, axis);
}

/** Capacity-selected subset both `layout` and `dispatchAffordance` must agree
 *  on — the two drifting apart is the whole class of bug this closes. So the
 *  size budget under `overflowMode: 'unplace'` is resolved here too, not at
 *  the one call site that happens to need it. */
function placedOf(
  items: LayoutItem[],
  cfg: StripConfig,
  axis: 'x' | 'y',
  main: number,
): { placed: LayoutItem[]; unplaced: string[] } {
  const cap = cfg.maxItems !== undefined ? Math.max(1, cfg.maxItems) : Number.POSITIVE_INFINITY;
  const byCount = selectByCapacity(items, Math.min(items.length, cap));
  if (cfg.overflowMode !== 'unplace') return byCount;

  const gap = cfg.gap ?? 0;
  const padding = cfg.padding ?? 0;
  const placed: LayoutItem[] = [];
  const unplaced = [...byCount.unplaced];
  let used = 2 * padding;
  for (const item of byCount.placed) {
    const need = intrinsicAxis(item, axis) + (placed.length > 0 ? gap : 0);
    // The first pane is placed whatever its extent: an empty container hides
    // the overflow instead of showing it.
    if (placed.length > 0 && used + need > main) {
      unplaced.push(item.id);
      continue;
    }
    used += need;
    placed.push(item);
  }
  return { placed, unplaced };
}

/** @group Strategies */
export const stripStrategy: LayoutStrategy<void, string> = {
  name: 'strip',
  configSpec: {
    axis: ['x', 'y'],
    gap: 'number',
    padding: 'number',
    fill: 'boolean',
    defaultItemSize: 'number',
    resizable: 'boolean',
    resizeMode: ['redistribute', 'neighbor'],
    joinOnOvershoot: 'boolean',
    joinThreshold: 'number',
    maxItems: 'number',
    overflowMode: ['squeeze', 'scroll', 'unplace'],
  },
  canAccept(items, options): boolean {
    const cap = (options as StripConfig).maxItems;
    if (cap === undefined) return true;
    return items.length <= Math.max(1, cap);
  },
  layout({
    items,
    container,
    options,
    preview,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
    preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } };
  }): LayoutResult<string> {
    const cfg = options as StripConfig;
    const axis = cfg.axis ?? 'x';
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;
    const resizable = cfg.resizable ?? true;

    const placements = new Map<string, Rect>();
    const affordances: Affordance[] = [];
    if (items.length === 0) {
      const empty: LayoutResult<string> = { placements, affordances };
      if (preview) empty.isPreview = true;
      return empty;
    }

    const main = axis === 'x' ? container.w : container.h;
    const { placed: placedItems, unplaced } = placedOf(items, cfg, axis, main);

    const usableMain = main - 2 * padding - gap * (placedItems.length - 1);
    const sizes = mainSizes(placedItems, cfg, axis, usableMain);

    if (axis === 'x') {
      const y = padding;
      const h = container.h - 2 * padding;
      let x = padding;
      for (let i = 0; i < placedItems.length; i++) {
        const item = placedItems[i]!;
        const w = sizes[i]!;
        placements.set(item.id, { x, y, w, h });
        if (resizable && i < placedItems.length - 1) {
          const join = joinFor(cfg, item, placedItems[i + 1]);
          affordances.push({
            id: `resize-x-${item.id}`,
            kind: 'resize-x',
            rect: { x: x + w - 2, y, w: 4, h },
            cursor: 'ew-resize',
            childId: item.id,
            affects:
              cfg.resizeMode === 'neighbor' && placedItems[i + 1]
                ? [item.id, placedItems[i + 1]!.id]
                : [item.id],
            bounds: boundsFor(
              item,
              w,
              placedItems,
              'x',
              usableMain,
              cfg.resizeMode === 'neighbor' && placedItems[i + 1]
                ? { item: placedItems[i + 1]!, extent: sizes[i + 1]! }
                : undefined,
            ),
            ...(join ? { join } : {}),
          });
        }
        x += w + gap;
      }
    } else {
      const x = padding;
      const w = container.w - 2 * padding;
      let y = padding;
      for (let i = 0; i < placedItems.length; i++) {
        const item = placedItems[i]!;
        const h = sizes[i]!;
        placements.set(item.id, { x, y, w, h });
        if (resizable && i < placedItems.length - 1) {
          const join = joinFor(cfg, item, placedItems[i + 1]);
          affordances.push({
            id: `resize-y-${item.id}`,
            kind: 'resize-y',
            rect: { x, y: y + h - 2, w, h: 4 },
            cursor: 'ns-resize',
            childId: item.id,
            affects:
              cfg.resizeMode === 'neighbor' && placedItems[i + 1]
                ? [item.id, placedItems[i + 1]!.id]
                : [item.id],
            bounds: boundsFor(
              item,
              h,
              placedItems,
              'y',
              usableMain,
              cfg.resizeMode === 'neighbor' && placedItems[i + 1]
                ? { item: placedItems[i + 1]!, extent: sizes[i + 1]! }
                : undefined,
            ),
            ...(join ? { join } : {}),
          });
        }
        y += h + gap;
      }
    }
    const result: LayoutResult<string> = { placements, affordances };
    // Children hold their constraints and the row grows past the container
    // rather than crushing them; say so instead of leaving it to be noticed.
    const consumed =
      sizes.reduce((sum, v) => sum + v, 0) + gap * (placedItems.length - 1) + 2 * padding;
    const excess = consumed - main;
    if (excess > 0) result.overflow = axis === 'x' ? { w: excess, h: 0 } : { w: 0, h: excess };
    if (unplaced.length > 0) result.unplaced = unplaced;
    if (preview) result.isPreview = true;
    return result;
  },
  dispatchAffordance({ event, affordance, store, items, container, options }) {
    if (event.kind !== 'drag') return;
    if (affordance.kind !== 'resize-x' && affordance.kind !== 'resize-y') return;
    const childId = affordance.childId;
    if (!childId) return;
    const axis: 'x' | 'y' = affordance.kind === 'resize-x' ? 'x' : 'y';
    const delta = axis === 'x' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
    if (delta === 0) return;

    const cfg = options as StripConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;
    const main = axis === 'x' ? container.w : container.h;
    // A resize affordance is only ever emitted for a placed item (see `layout`),
    // but `items` is caller-supplied — guard rather than assume.
    const { placed: placedItems } = placedOf(items, cfg, axis, main);
    const item = placedItems.find((it) => it.id === childId);
    if (!item) return;

    const usableMain = main - 2 * padding - gap * (placedItems.length - 1);
    const sizes = mainSizes(placedItems, cfg, axis, usableMain);
    const index = placedItems.indexOf(item);

    if (cfg.resizeMode === 'neighbor') {
      const next = placedItems[index + 1];
      // Affordances are only emitted on non-last children, so a missing
      // neighbor means a caller-built event; there is nothing to pair with.
      if (!next) return;

      const baseA = sizes[index] ?? 0;
      const baseB = sizes[index + 1] ?? 0;
      const minA = effectiveMinAxis(item, axis);
      const maxA = effectiveMaxAxis(item, axis);
      const minB = effectiveMinAxis(next, axis);
      const maxB = effectiveMaxAxis(next, axis);

      let d = delta;
      if (baseA + d < minA) d = minA - baseA;
      if (maxA !== undefined && baseA + d > maxA) d = maxA - baseA;
      if (baseB - d < minB) d = baseB - minB;
      if (maxB !== undefined && baseB - d > maxB) d = baseB - maxB;
      if (d === 0) return;

      writeSize(store, childId as string, axis, baseA + d);
      writeSize(store, next.id, axis, baseB - d);
      return;
    }

    const base = sizes[index] ?? 0;

    let next = base + delta;
    const min = effectiveMinAxis(item, axis);
    const max = effectiveMaxAxis(item, axis);
    const otherMinSum = placedItems
      .filter((it) => it.id !== childId)
      .reduce((s, it) => s + effectiveMinAxis(it, axis), 0);
    // A sibling ceiling tighter than this child's own min must not win: floor
    // last, so the row overflows rather than writing a size the child forbids.
    const ceiling = usableMain - otherMinSum;
    if (next > ceiling) next = ceiling;
    if (next < min) next = min;
    if (max !== undefined && next > max) next = max;

    writeSize(store, childId as string, axis, next);
  },
};
