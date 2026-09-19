import type {
  Affordance,
  AffordanceJoin,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
  StickyInset,
} from '../layout-types.js';
import { trace } from '../trace.js';
import { selectByCapacity } from './capacity.js';
import { clampExplicitSizes } from './resize.js';
import { DEFAULT_JOIN_THRESHOLD } from './seam-join.js';
import { zoomedOf, zoomLayout } from './zoom.js';

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
  /**
   * What pushing a seam past a pane's floor does. `'join'` is
   * `joinOnOvershoot: true`: releasing destroys the pane. `'hide'` hides it
   * instead, as VS Code does with a sidebar dragged shut, and the pane's size
   * is kept for `showNode`; a pane with `lock.hide` never arms, and its seam
   * clamps. Outranks `joinOnOvershoot`; the same `resizeMode: 'neighbor'`
   * requirement applies.
   */
  overshoot?: 'join' | 'hide';
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
   * A pane whose placement sets `sticky: true` is reported in
   * `LayoutResult.sticky`, so a host holds it at the leading edge while the
   * rest scroll (Firefox's pinned tabs).
   *
   * `'unplaced'` places what fits at full extent and sends the rest to
   * `unplaced`. Composes with `maxItems`, which caps by count instead.
   */
  overflowMode?: 'squeeze' | 'scroll' | 'unplaced';
  /**
   * Where main-axis space the panes leave goes: `'start'` (default) packs them
   * at the leading edge, `'center'` and `'end'` shift the row, and `'between'`
   * spreads the space into the gaps, leaving a lone pane at the start. Nothing
   * moves when the panes fill or overflow the row.
   */
  justify?: 'start' | 'center' | 'end' | 'between';
  /**
   * Main-axis quantum, the way tmux and Emacs size panes in character cells.
   * Each pane's extent rounds to the nearest multiple, never under a floor it
   * was not stored under, and the rounding remainder goes to the last pane that
   * does not ask for pixels (else the last pane), so the row fills exactly as
   * it would unstepped. Seam drags snap to the step nearest the pointer, and a
   * seam's bounds narrow to whole steps. `gap` and `padding` are not stepped.
   */
  step?: number;
  /**
   * The child that fills the container, inside `padding`, while the rest are
   * withheld as `unplaced` and keep their placement to return to (tmux's
   * prefix-z). No seams are emitted while zoomed. An id naming no visible
   * child is ignored.
   */
  zoom?: string;
}

/** A size input as the row may use it: finite and non-negative. Anything else
 *  (a corrupt persisted size, a NaN from a consumer's arithmetic) is treated
 *  as absent rather than rendered, and traced so it can be found. */
function sane(v: unknown, item: LayoutItem, field: string): number | undefined {
  if (typeof v !== 'number') return undefined;
  if (Number.isFinite(v) && v >= 0) return v;
  trace('layout', `strip: ignoring ${field} ${v} on ${item.id}`);
  return undefined;
}

function explicitAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  const size = item.placement?.size;
  return sane(axis === 'x' ? size?.w : size?.h, item, `placement.size.${axis === 'x' ? 'w' : 'h'}`);
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
  const v = sane(axis === 'x' ? item.natural?.w : item.natural?.h, item, 'natural');
  return v !== undefined ? Math.max(v, effectiveMinAxis(item, axis)) : undefined;
}

/** The extent this item is asking for, whatever it asked with. A measurement
 *  is a stated size like any other: it scales under pressure and it loses to
 *  an explicit `placement.size`, which is how a gutter drag pins a pane. */
function requestedAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  return explicitAxis(item, axis) ?? naturalAxis(item, axis);
}

/** The fraction of the row this item asks for, when it states one and no
 *  pixel size outranks it. Zero is refused with the rest: a pane that shares
 *  nothing is the fill pane it would otherwise be. */
function shareAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  if (requestedAxis(item, axis) !== undefined) return undefined;
  const v = item.placement?.share;
  if (typeof v !== 'number') return undefined;
  if (Number.isFinite(v) && v > 0) return v;
  trace('layout', `strip: ignoring placement.share ${v} on ${item.id}`);
  return undefined;
}

function effectiveMinAxis(item: LayoutItem, axis: 'x' | 'y'): number {
  const m = item.hints?.minSize;
  return sane(axis === 'x' ? m?.w : m?.h, item, 'minSize') ?? 0;
}

function effectiveMaxAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  const m = item.hints?.maxSize;
  return sane(axis === 'x' ? m?.w : m?.h, item, 'maxSize');
}

/** The row's `step`, when it is a usable one. */
function stepOf(cfg: StripConfig): number | undefined {
  const v = cfg.step;
  if (v === undefined) return undefined;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  trace('layout', `strip: ignoring step ${String(v)}`);
  return undefined;
}

const EPS = 1e-9;
const stepDown = (v: number, step: number) => Math.floor(v / step + EPS) * step;
const stepUp = (v: number, step: number) => Math.ceil(v / step - EPS) * step;

/** `v` at the nearest whole step inside the item's limits. A pane stored
 *  under its floor stays under it, as it does unstepped. */
function snapAxis(v: number, item: LayoutItem, axis: 'x' | 'y', step: number): number {
  let out = Math.round(v / step) * step;
  const min = effectiveMinAxis(item, axis);
  const max = effectiveMaxAxis(item, axis);
  if (v >= min - EPS && out < min) out = stepUp(min, step);
  if (max !== undefined && out > max) {
    out = stepDown(max, step);
    if (out < min) out = Math.min(v, max);
  }
  return out;
}

/** `sizes` snapped to `step`, the rounding remainder given to one pane so the
 *  row's total is unchanged. */
function stepped(items: LayoutItem[], sizes: number[], axis: 'x' | 'y', step: number): number[] {
  const out = sizes.map((v, i) => snapAxis(v, items[i]!, axis, step));
  const drift = sizes.reduce((s, v) => s + v, 0) - out.reduce((s, v) => s + v, 0);
  if (Math.abs(drift) > EPS && out.length > 0) {
    let k = items.length - 1;
    while (k >= 0 && requestedAxis(items[k]!, axis) !== undefined) k--;
    if (k < 0) k = items.length - 1;
    out[k] = Math.max(0, (out[k] ?? 0) + drift);
  }
  return out;
}

/** `bounds` narrowed to whole steps, never so far that the range excludes
 *  where the seam sits. */
function stepBounds(
  b: NonNullable<Affordance['bounds']>,
  step: number,
): NonNullable<Affordance['bounds']> {
  const valueMin = Math.min(stepUp(b.valueMin, step), b.valueNow);
  const valueMax = Math.max(stepDown(b.valueMax, step), b.valueNow);
  return {
    ...b,
    valueMin,
    valueMax,
    atMin: b.valueNow <= valueMin + EPS,
    atMax: b.valueNow >= valueMax - EPS,
    step,
  };
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
  step?: number,
): NonNullable<Affordance['bounds']> {
  const b = rawBoundsFor(item, valueNow, placedItems, axis, usableMain, pair);
  return step === undefined ? b : stepBounds(b, step);
}

function rawBoundsFor(
  item: LayoutItem,
  valueNow: number,
  placedItems: LayoutItem[],
  axis: 'x' | 'y',
  usableMain: number,
  pair?: { item: LayoutItem; extent: number },
): NonNullable<Affordance['bounds']> {
  const own = effectiveMinAxis(item, axis);
  const max = effectiveMaxAxis(item, axis);

  if (pair) {
    const { lo, hi } = neighborRange(item, valueNow, pair.item, pair.extent, axis);
    return finishBounds(axis, valueNow, valueNow + lo, valueNow + hi);
  }
  const otherMinSum = placedItems
    .filter((it) => it.id !== item.id)
    .reduce((s, it) => s + effectiveMinAxis(it, axis), 0);
  let valueMax = usableMain - otherMinSum;
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

/** How far a neighbor seam may move from where it sits: `lo <= 0 <= hi`, in
 *  main-axis pixels added to `a` and taken from `b`. A pane already past one of
 *  its limits (a sliver stored under its min) may not move further past it, but
 *  is never pushed back inside it either, so a drag can stall and never reverse. */
function neighborRange(
  a: LayoutItem,
  baseA: number,
  b: LayoutItem,
  baseB: number,
  axis: 'x' | 'y',
): { lo: number; hi: number } {
  const maxA = effectiveMaxAxis(a, axis);
  const maxB = effectiveMaxAxis(b, axis);
  const lo = Math.max(
    Math.min(0, effectiveMinAxis(a, axis) - baseA),
    maxB === undefined ? Number.NEGATIVE_INFINITY : Math.min(0, baseB - maxB),
  );
  const hi = Math.min(
    maxA === undefined ? Number.POSITIVE_INFINITY : Math.max(0, maxA - baseA),
    Math.max(0, baseB - effectiveMinAxis(b, axis)),
  );
  return { lo, hi };
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
  const { sizes } = resolveRow(placedItems, cfg, axis, usableMain);
  const step = stepOf(cfg);
  return step === undefined ? sizes : stepped(placedItems, sizes, axis, step);
}

/** `mainSizes`, plus the extent the pixel-sized panes leave, which is what a
 *  share is a fraction of. */
function resolveRow(
  placedItems: LayoutItem[],
  cfg: StripConfig,
  axis: 'x' | 'y',
  usableMain: number,
): { sizes: number[]; shareSpace: number } {
  // Under `scroll` the row is laid out against what it asked for rather than
  // what it has, so nothing scales and the excess is reported instead. A
  // measured pane holds at its measurement for the same reason an explicit
  // one does: it is what the pane asked for.
  const hinted = sizedByHints(placedItems, axis);
  const intrinsicMain = placedItems.reduce(
    (sum, it) => sum + intrinsicAxis(it, axis, cfg, hinted),
    0,
  );
  // A hint-sized row has never scaled preferredSize under `squeeze` either,
  // despite that mode's docstring; which one is right is an open question.
  const budget =
    cfg.overflowMode === 'scroll' || hinted ? Math.max(usableMain, intrinsicMain) : usableMain;

  // Once any child states a size, every child without one shares the rest and
  // preferredSize is not consulted; otherwise preferredSize (or, under
  // `fill: false`, defaultItemSize) is what each child states.
  const clamp = clampExplicitSizes({
    available: budget,
    items: placedItems.map((it) => ({
      id: it.id,
      explicit: hinted ? hintedAxis(it, axis, cfg) : requestedAxis(it, axis),
      share: hinted ? undefined : shareAxis(it, axis),
      min: effectiveMinAxis(it, axis),
      max: effectiveMaxAxis(it, axis),
    })),
  });
  const sizes = placedItems.map((it) => clamp.get(it.id) ?? 0);
  const pixels = placedItems.reduce(
    (sum, it, i) => sum + (requestedAxis(it, axis) !== undefined ? (sizes[i] ?? 0) : 0),
    0,
  );
  return { sizes, shareSpace: Math.max(0, budget - pixels) };
}

/** Whether the row is sized by hints, because no child states a size. */
function sizedByHints(items: LayoutItem[], axis: 'x' | 'y'): boolean {
  return !items.some(
    (it) => requestedAxis(it, axis) !== undefined || shareAxis(it, axis) !== undefined,
  );
}

function preferredAxis(item: LayoutItem, axis: 'x' | 'y'): number | undefined {
  const p = item.hints?.preferredSize;
  const v = sane(axis === 'x' ? p?.w : p?.h, item, 'preferredSize');
  return v !== undefined && v > 0 ? v : undefined;
}

/** What a child of a hint-sized row asks for: its preferredSize, else the
 *  row's defaultItemSize under `fill: false`, floored at its min. Undefined for
 *  a child that shares whatever the others leave. */
function hintedAxis(item: LayoutItem, axis: 'x' | 'y', cfg: StripConfig): number | undefined {
  const fallback = (cfg.fill ?? false) ? undefined : (cfg.defaultItemSize ?? 0);
  const v = preferredAxis(item, axis) ?? fallback;
  return v === undefined ? undefined : Math.max(v, effectiveMinAxis(item, axis));
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
  const mode = cfg.overshoot ?? (cfg.joinOnOvershoot ? 'join' : undefined);
  if (mode !== 'join' && mode !== 'hide') return undefined;
  if (mode === 'join') {
    return {
      atMin: item.id,
      atMax: next.id,
      threshold: cfg.joinThreshold ?? DEFAULT_JOIN_THRESHOLD,
    };
  }
  const minHides = item.lock?.hide !== true;
  const maxHides = next.lock?.hide !== true;
  if (!minHides && !maxHides) return undefined;
  return {
    ...(minHides ? { atMin: item.id } : {}),
    ...(maxHides ? { atMax: next.id } : {}),
    threshold: cfg.joinThreshold ?? DEFAULT_JOIN_THRESHOLD,
    action: 'hide',
  };
}

/** What a drag stores for one pane: a pixel size, or a share of the row. */
type Stored = { size: number } | { share: number | undefined };

function writeStored(store: unknown, id: string, axis: 'x' | 'y', value: Stored): void {
  const s = store as {
    getNode: (id: string) => { membership?: { placement?: Record<string, unknown> } } | undefined;
    patchPlacement: (id: string, patch: Record<string, unknown>) => void;
  };
  if ('share' in value) {
    s.patchPlacement(id, { share: value.share });
    return;
  }
  const existing = (s.getNode(id)?.membership?.placement?.size ?? {}) as { w?: number; h?: number };
  s.patchPlacement(id, {
    size: axis === 'x' ? { ...existing, w: value.size } : { ...existing, h: value.size },
  });
}

/**
 * What each pane in `writes` stores to render at its new extent. A row holding
 * any share stays proportional: every pane written that does not already ask
 * for pixels (an explicit size or a measurement) stores a share of the extent
 * the pixel panes leave once their own writes land. A share of nothing is
 * cleared rather than stored as zero.
 */
function toStored(
  items: LayoutItem[],
  writes: ReadonlyMap<string, number>,
  cfg: StripConfig,
  axis: 'x' | 'y',
  usableMain: number,
): Map<string, Stored> {
  const out = new Map<string, Stored>();
  const proportional = items.some((it) => shareAxis(it, axis) !== undefined);
  const byPixels = (it: LayoutItem) => !proportional || requestedAxis(it, axis) !== undefined;
  const pixelWrites = new Map<string, number>();
  for (const it of items) {
    const v = writes.get(it.id);
    if (v !== undefined && byPixels(it)) pixelWrites.set(it.id, v);
  }
  for (const [id, v] of pixelWrites) out.set(id, { size: v });
  if (pixelWrites.size === writes.size) return out;

  const { shareSpace } = resolveRow(applyStored(items, out, axis), cfg, axis, usableMain);
  for (const it of items) {
    const v = writes.get(it.id);
    if (v === undefined || byPixels(it)) continue;
    // With nothing to be a fraction of, pixels are the only faithful record.
    if (shareSpace <= 0) out.set(it.id, { size: v });
    else out.set(it.id, { share: v > 0 ? v / shareSpace : undefined });
  }
  return out;
}

/** `items` as they will read once `stored` lands in their placement. */
function applyStored(
  items: LayoutItem[],
  stored: ReadonlyMap<string, Stored>,
  axis: 'x' | 'y',
): LayoutItem[] {
  return items.map((it) => {
    const v = stored.get(it.id);
    if (v === undefined) return it;
    if ('share' in v) {
      const { share: _, ...rest } = it.placement ?? {};
      return { ...it, placement: v.share === undefined ? rest : { ...rest, share: v.share } };
    }
    const size = { ...it.placement?.size, [axis === 'x' ? 'w' : 'h']: v.size };
    return { ...it, placement: { ...it.placement, size } };
  });
}

/** `items` as they will read once `writes`, in main-axis pixels, are stored. */
function withWrites(
  items: LayoutItem[],
  writes: ReadonlyMap<string, number>,
  cfg: StripConfig,
  axis: 'x' | 'y',
  usableMain: number,
): LayoutItem[] {
  return applyStored(items, toStored(items, writes, cfg, axis, usableMain), axis);
}

/**
 * New sizes for every pane but `index` that together give up `delta` — take it
 * when positive, absorb it when negative. The panes after the seam go first, so
 * the seam follows the pointer and the panes before it stay put; those reach
 * in only for what the rest cannot give. Each pane moves in proportion to its
 * rendered `sizes`, none past its own floor or cap, or past where it already was.
 */
function shareOut(
  items: LayoutItem[],
  sizes: number[],
  index: number,
  delta: number,
  axis: 'x' | 'y',
): Map<string, number> {
  const out = new Map<string, number>();
  items.forEach((it, i) => {
    if (i !== index) out.set(it.id, sizes[i] ?? 0);
  });
  const spread = (indices: number[], amount: number): number => {
    let open = indices;
    let remaining = amount;
    for (let pass = 0; pass < items.length && Math.abs(remaining) > 1e-9 && open.length; pass++) {
      const total = open.reduce((s, i) => s + (out.get(items[i]!.id) ?? 0), 0);
      if (total <= 0) break;
      const still: number[] = [];
      let moved = 0;
      for (const i of open) {
        const it = items[i]!;
        const now = out.get(it.id) ?? 0;
        const floor = Math.min(effectiveMinAxis(it, axis), now);
        const cap = Math.max(effectiveMaxAxis(it, axis) ?? Number.POSITIVE_INFINITY, now);
        let want = now - (remaining * now) / total;
        if (want < floor) want = floor;
        else if (want > cap) want = cap;
        else still.push(i);
        moved += now - want;
        out.set(it.id, want);
      }
      remaining -= moved;
      open = still;
    }
    return remaining;
  };
  const after = items.map((_, i) => i).filter((i) => i > index);
  const before = items.map((_, i) => i).filter((i) => i < index);
  spread(before, spread(after, delta));
  return out;
}

/** What this item asks to occupy on the main axis when nothing compresses it. */
function intrinsicAxis(
  item: LayoutItem,
  axis: 'x' | 'y',
  cfg: StripConfig,
  hinted: boolean,
): number {
  const v =
    requestedAxis(item, axis) ??
    (hinted ? hintedAxis(item, axis, cfg) : undefined) ??
    effectiveMinAxis(item, axis);
  const max = effectiveMaxAxis(item, axis);
  return max !== undefined && v > max ? max : v;
}

/** The offset of the first pane and the step between panes once `justify`
 *  has placed `free` pixels of unused main axis. */
function justified(
  cfg: StripConfig,
  free: number,
  gap: number,
  count: number,
): { lead: number; spacing: number } {
  if (!(free > 0)) return { lead: 0, spacing: gap };
  switch (cfg.justify) {
    case 'center':
      return { lead: free / 2, spacing: gap };
    case 'end':
      return { lead: free, spacing: gap };
    case 'between':
      return { lead: 0, spacing: count > 1 ? gap + free / (count - 1) : gap };
    default:
      return { lead: 0, spacing: gap };
  }
}

/** Depth of a sticky pane and its seam: above the panes that scroll under
 *  it, and above their seams, which a host draws at depth 1. */
const STICKY_Z = 2;

/**
 * Where each `placement.sticky` pane sticks: its inset from the visible
 * leading edge once scrolling would carry it past, stacked after the sticky
 * panes before it. Raises those panes and their seams to `STICKY_Z` in place.
 */
function stickTo(
  items: LayoutItem[],
  sizes: number[],
  axis: 'x' | 'y',
  padding: number,
  spacing: number,
  placements: Map<string, Rect>,
  affordances: Affordance[],
): Map<string, StickyInset> {
  const out = new Map<string, StickyInset>();
  const seams = new Map(affordances.map((a) => [a.childId, a]));
  let at = padding;
  items.forEach((it, i) => {
    if (it.meta?.sticky !== true) return;
    const size = sizes[i] ?? 0;
    const rect = placements.get(it.id);
    if (rect) placements.set(it.id, { ...rect, z: STICKY_Z });
    out.set(it.id, axis === 'x' ? { x: at } : { y: at });
    const seam = seams.get(it.id);
    if (seam) {
      seam.rect = { ...seam.rect, z: STICKY_Z };
      seam.sticky = axis === 'x' ? { x: at + size - 2 } : { y: at + size - 2 };
    }
    at += size + spacing;
  });
  return out;
}

/** The extent a drag asks `sizes[index]` to take. Under a step a few pixels
 *  round to nothing, so a pointer drag resolves against the pointer rather
 *  than accumulating deltas; a keyboard step carries no pointer. */
function steppedTarget(
  cfg: StripConfig,
  sizes: number[],
  index: number,
  axis: 'x' | 'y',
  usableMain: number,
  delta: number,
  point: { x: number; y: number } | undefined,
): number {
  const base = sizes[index] ?? 0;
  if (stepOf(cfg) === undefined || !point) return base + delta;
  const used = sizes.reduce((s, v) => s + v, 0);
  const { lead, spacing } = justified(cfg, usableMain - used, cfg.gap ?? 0, sizes.length);
  let start = (cfg.padding ?? 0) + lead;
  for (let i = 0; i < index; i++) start += (sizes[i] ?? 0) + spacing;
  return (axis === 'x' ? point.x : point.y) - start;
}

/** Capacity-selected subset both `layout` and `dispatchAffordance` must agree
 *  on — the two drifting apart is the whole class of bug this closes. So the
 *  size budget under `overflowMode: 'unplaced'` is resolved here too, not at
 *  the one call site that happens to need it. */
function placedOf(
  items: LayoutItem[],
  cfg: StripConfig,
  axis: 'x' | 'y',
  main: number,
): { placed: LayoutItem[]; unplaced: string[] } {
  const cap = cfg.maxItems !== undefined ? Math.max(1, cfg.maxItems) : Number.POSITIVE_INFINITY;
  const byCount = selectByCapacity(items, Math.min(items.length, cap));
  if (cfg.overflowMode !== 'unplaced') return byCount;

  const gap = cfg.gap ?? 0;
  const padding = cfg.padding ?? 0;
  const placed: LayoutItem[] = [];
  const unplaced = [...byCount.unplaced];
  const hinted = sizedByHints(byCount.placed, axis);
  let used = 2 * padding;
  for (const item of byCount.placed) {
    const need = intrinsicAxis(item, axis, cfg, hinted) + (placed.length > 0 ? gap : 0);
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

/**
 * Stacks children along one axis, sharing the main-axis extent and filling the
 * cross axis. `{ axis: 'y' }` is what used to be called "stack". Config takes
 * `axis`, `gap` and `padding`.
 *
 * Honors `placement.size` on the main axis for fixed-px panes and
 * `placement.share` for proportional ones, and emits a gutter between each
 * pair. `store.split` builds nested strips, which is how binary splits are made.
 * @group Strategies
 */
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
    overshoot: ['join', 'hide'],
    joinThreshold: 'number',
    maxItems: 'number',
    step: 'number',
    zoom: 'string',
    overflowMode: ['squeeze', 'scroll', 'unplaced'],
    justify: ['start', 'center', 'end', 'between'],
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
    const step = stepOf(cfg);

    const placements = new Map<string, Rect>();
    const affordances: Affordance[] = [];
    if (items.length === 0) {
      const empty: LayoutResult<string> = { placements, affordances };
      if (preview) empty.isPreview = true;
      return empty;
    }

    const zoomed = zoomedOf(items, cfg.zoom);
    if (zoomed) {
      const result = zoomLayout(items, zoomed, container, padding);
      if (preview) result.isPreview = true;
      return result;
    }

    const main = axis === 'x' ? container.w : container.h;
    const { placed: placedItems, unplaced } = placedOf(items, cfg, axis, main);

    const usableMain = main - 2 * padding - gap * (placedItems.length - 1);
    const sizes = mainSizes(placedItems, cfg, axis, usableMain);
    const { lead, spacing } = justified(
      cfg,
      usableMain - sizes.reduce((s, v) => s + v, 0),
      gap,
      placedItems.length,
    );

    if (axis === 'x') {
      const y = padding;
      const h = Math.max(0, container.h - 2 * padding);
      let x = padding + lead;
      for (let i = 0; i < placedItems.length; i++) {
        const item = placedItems[i]!;
        const w = sizes[i]!;
        placements.set(item.id, { x, y, z: 0, w, h });
        if (resizable && i < placedItems.length - 1) {
          const join = joinFor(cfg, item, placedItems[i + 1]);
          affordances.push({
            id: `resize-x-${item.id}`,
            kind: 'resize-x',
            rect: { x: x + w - 2, y, z: 0, w: 4, h },
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
              step,
            ),
            ...(join ? { join } : {}),
          });
        }
        x += w + spacing;
      }
    } else {
      const x = padding;
      const w = Math.max(0, container.w - 2 * padding);
      let y = padding + lead;
      for (let i = 0; i < placedItems.length; i++) {
        const item = placedItems[i]!;
        const h = sizes[i]!;
        placements.set(item.id, { x, y, z: 0, w, h });
        if (resizable && i < placedItems.length - 1) {
          const join = joinFor(cfg, item, placedItems[i + 1]);
          affordances.push({
            id: `resize-y-${item.id}`,
            kind: 'resize-y',
            rect: { x, y: y + h - 2, z: 0, w, h: 4 },
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
              step,
            ),
            ...(join ? { join } : {}),
          });
        }
        y += h + spacing;
      }
    }
    const result: LayoutResult<string> = { placements, affordances };
    if (cfg.overflowMode === 'scroll') {
      const sticky = stickTo(placedItems, sizes, axis, padding, spacing, placements, affordances);
      if (sticky.size > 0) result.sticky = sticky;
    }
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
    if (zoomedOf(items, cfg.zoom)) return;
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
    const step = stepOf(cfg);
    const want = steppedTarget(cfg, sizes, index, axis, usableMain, delta, event.payload.point);

    if (cfg.resizeMode === 'neighbor') {
      const next = placedItems[index + 1];
      // Affordances are only emitted on non-last children, so a missing
      // neighbor means a caller-built event; there is nothing to pair with.
      if (!next) return;

      const baseA = sizes[index] ?? 0;
      const baseB = sizes[index + 1] ?? 0;
      const { lo, hi } = neighborRange(item, baseA, next, baseB, axis);
      let d: number;
      if (step === undefined) {
        d = Math.min(hi, Math.max(lo, delta));
      } else {
        let t = Math.round(want / step) * step;
        if (t > baseA + hi) t = stepDown(baseA + hi, step);
        if (t < baseA + lo) t = stepUp(baseA + lo, step);
        // A range narrower than one step holds no whole step to land on.
        if (t > baseA + hi + EPS || t < baseA + lo - EPS) return;
        d = t - baseA;
      }
      if (d === 0) return;

      // Two new sizes can move the rest of the row: a squeezed row rescales
      // against the new stored sum, and a row sized by preferredSize leaves that
      // path for the stored-size one. Pin whatever would move where it renders.
      const writes = new Map<string, number>([
        [item.id, baseA + d],
        [next.id, baseB - d],
      ]);
      for (let pass = 0; pass < placedItems.length; pass++) {
        const after = mainSizes(
          withWrites(placedItems, writes, cfg, axis, usableMain),
          cfg,
          axis,
          usableMain,
        );
        const pinned = writes.size;
        placedItems.forEach((it, i) => {
          const now = sizes[i] ?? 0;
          if (!writes.has(it.id) && Math.abs((after[i] ?? 0) - now) > 1e-6) writes.set(it.id, now);
        });
        if (writes.size === pinned) break;
      }
      if (writes.size > 2)
        trace('layout', `strip: pinned ${writes.size - 2} panes beside ${childId}`);
      for (const [id, v] of toStored(placedItems, writes, cfg, axis, usableMain))
        writeStored(store, id, axis, v);
      return;
    }

    const base = sizes[index] ?? 0;

    const down = (v: number) => (step === undefined ? v : stepDown(v, step));
    const up = (v: number) => (step === undefined ? v : stepUp(v, step));
    let next = step === undefined ? base + delta : Math.round(want / step) * step;
    const min = effectiveMinAxis(item, axis);
    const max = effectiveMaxAxis(item, axis);
    const otherMinSum = placedItems
      .filter((it) => it.id !== childId)
      .reduce((s, it) => s + effectiveMinAxis(it, axis), 0);
    // A sibling ceiling tighter than this child's own min must not win: floor
    // last, so the row overflows rather than writing a size the child forbids.
    const ceiling = usableMain - otherMinSum;
    if (next > ceiling) next = down(ceiling);
    if (next < min) next = up(min);
    if (max !== undefined && next > max) next = down(max);
    // A pane stored under its floor (a minimized group) sits outside the range
    // above; clamping into it would move the seam against the pointer.
    if ((next - base) * delta < 0) return;
    if (step !== undefined && next === base) return;

    const writes = new Map<string, number>([[childId as string, next]]);
    const after = mainSizes(
      withWrites(placedItems, writes, cfg, axis, usableMain),
      cfg,
      axis,
      usableMain,
    );
    if (Math.abs((after[index] ?? 0) - next) > 1e-6) {
      // Nothing absorbs the change — every other pane holds a stored size, or
      // the row was squeezed — so the new size alone would rescale the row and
      // move the seam by some other amount, even backward. The others give up
      // the delta instead, in proportion to where they render.
      for (const [id, size] of shareOut(placedItems, sizes, index, next - base, axis)) {
        writes.set(id, size);
      }
      trace('layout', `strip: ${childId} took ${next - base} from ${writes.size - 1} panes`);
    }
    for (const [id, v] of toStored(placedItems, writes, cfg, axis, usableMain))
      writeStored(store, id, axis, v);
  },
};
