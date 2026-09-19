import type {
  Affordance,
  LayoutEvent,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
  StatefulLayoutStrategy,
} from '../layout-types.js';
import { asNodeId } from '../node.js';
import { RAISE_MODES } from '../policies.js';
import { trace } from '../trace.js';
import { onTopLayer } from './layer.js';

/** The values `container.config.minimize` accepts. */
export const DESKTOP_MINIMIZE = ['shade', 'icon'] as const;

/** The values `container.config.clamp` accepts. */
export const DESKTOP_CLAMP = ['bar', 'all'] as const;

/** The values `container.config.overflow` accepts. */
export const DESKTOP_OVERFLOW = ['clip', 'scroll'] as const;

/** The values `drag` accepts, in config or in a window's placement. */
export const DESKTOP_DRAG = [true, false, 'x', 'y'] as const;

/** The corners `container.config.iconFrom` accepts. */
export const DESKTOP_ICON_FROM = ['top-left', 'bottom-left', 'top-right', 'bottom-right'] as const;

/** `container.config` keys {@link desktopStrategy} reads. */
export interface DesktopConfig {
  /** `'shade'` rolls a minimized window up in place; `'icon'` hands it to the
   *  icon layer, and shades it when there is none. */
  minimize?: (typeof DESKTOP_MINIMIZE)[number];
  shadeHeight?: number;
  iconWidth?: number;
  iconHeight?: number;
  /** Offset between successive windows that carry no position. */
  cascade?: number;
  /** Move windows by their title band: `true` on both axes, `'x'` or `'y'` on
   *  one. A window's own `placement.drag` overrides it. */
  drag?: (typeof DESKTOP_DRAG)[number];
  /** Height of the title band a window is dragged by. */
  handleSize?: number;
  /** Keep windows reachable, on layout and after a drag: `'bar'` keeps the title
   *  band inside the container, `'all'` the whole window where it fits. */
  clamp?: (typeof DESKTOP_CLAMP)[number];
  /** `'scroll'` (the default) reports windows past any edge as `overflow`, so a
   *  host can scroll to them; `'clip'` reports none. */
  overflow?: (typeof DESKTOP_OVERFLOW)[number];
  /** Put a click box at the right of each title band that flips the window's
   *  `minimized`, and one over each iconified window that restores it. */
  minimizable?: boolean;
  /** Resize windows from their edges and corners. A window's own
   *  `placement.resize` overrides it. */
  resize?: boolean;
  /** Thickness of the edges `resize` grabs; corners are twice it. */
  edgeSize?: number;
  /** The corner the icon layer fills from. `inner` lays icons out from the
   *  top-left as usual, and the desktop mirrors its result into this corner. */
  iconFrom?: (typeof DESKTOP_ICON_FROM)[number];
}

/** {@link desktopStrategy}'s state: only whatever the wrapped strategy keeps. */
export interface DesktopState<TInner = unknown> {
  inner: TInner;
}

export const DEFAULT_SHADE_HEIGHT = 28;
export const DEFAULT_ICON_SIZE = 64;
export const DEFAULT_CASCADE = 24;
export const DEFAULT_HANDLE_SIZE = 22;
export const DEFAULT_EDGE_SIZE = 6;

/** Affordance id prefixes, so dispatch can route without knowing the inner strategy. */
export const DESKTOP_DRAG_PREFIX = 'desktop:drag:';
export const DESKTOP_MINIMIZE_PREFIX = 'desktop:minimize:';
export const DESKTOP_RESIZE_PREFIX = 'desktop:resize:';

const DRAG_KIND = { xy: 'drag-xy', x: 'drag-x', y: 'drag-y' } as const;

function dragAxes(item: LayoutItem, cfg: DesktopConfig): keyof typeof DRAG_KIND | null {
  const own = item.meta?.drag;
  const drag = own === undefined ? cfg.drag : own;
  if (drag === true) return 'xy';
  return drag === 'x' || drag === 'y' ? drag : null;
}

interface Point {
  x: number;
  y: number;
}

/** Top-left edge first on an axis the window cannot fit. */
function clampWindow(
  at: Point,
  size: Size,
  container: Size,
  mode: DesktopConfig['clamp'],
  band: number,
): Point {
  const h = mode === 'all' ? size.h : Math.min(band, size.h);
  return {
    x: Math.max(0, Math.min(at.x, container.w - size.w)),
    y: Math.max(0, Math.min(at.y, container.h - h)),
  };
}

function isOwnAffordance(id: string): boolean {
  return (
    id.startsWith(DESKTOP_DRAG_PREFIX) ||
    id.startsWith(DESKTOP_MINIMIZE_PREFIX) ||
    id.startsWith(DESKTOP_RESIZE_PREFIX)
  );
}

type Edge = 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se';
const EDGES: readonly Edge[] = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
const EDGE_CURSOR: Record<Edge, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  w: 'ew-resize',
  e: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};

function resizable(item: LayoutItem, cfg: DesktopConfig): boolean {
  const own = item.meta?.resize;
  return (own === undefined ? cfg.resize : own) === true;
}

/** Which side an edge moves on each axis, or null where it moves none. */
function sidesOf(edge: Edge): { x: 'w' | 'e' | null; y: 'n' | 's' | null } {
  const x = edge.includes('w') ? 'w' : edge.includes('e') ? 'e' : null;
  const y = edge.startsWith('n') ? 'n' : edge.startsWith('s') ? 's' : null;
  return { x, y };
}

interface EdgeRange {
  now: number;
  min: number;
  max: number;
}

/**
 * Where one side of a window may go, as a position on its axis: far enough to
 * leave the window its floor, near enough to keep it under `maxSize`, and no
 * further out than the container unless it is already past it. Always contains
 * where the side is now.
 */
function edgeRange(
  side: 'w' | 'e' | 'n' | 's',
  rect: Rect,
  item: LayoutItem,
  container: Size,
  edgeSize: number,
): EdgeRange {
  const horizontal = side === 'w' || side === 'e';
  const start = horizontal ? rect.x : rect.y;
  const extent = horizontal ? rect.w : rect.h;
  const end = start + extent;
  const limit = horizontal ? container.w : container.h;
  const floor = horizontal ? item.hints?.minSize?.w : item.hints?.minSize?.h;
  const cap = horizontal ? item.hints?.maxSize?.w : item.hints?.maxSize?.h;
  const lo = floor ?? Math.max(1, 2 * edgeSize);
  const hi = cap ?? Number.POSITIVE_INFINITY;
  if (side === 'e' || side === 's') {
    const max = Math.min(start + hi, Math.max(limit, end));
    return { now: end, min: Math.min(start + lo, end), max: Math.max(max, end) };
  }
  const min = Math.max(end - hi, Math.min(0, start));
  return { now: start, min: Math.min(min, start), max: Math.max(end - lo, start) };
}

function edgeRect(edge: Edge, rect: Rect, edgeSize: number): Rect | null {
  const e = Math.min(edgeSize, rect.w / 2, rect.h / 2);
  const c = Math.min(2 * edgeSize, rect.w / 2, rect.h / 2);
  if (e <= 0) return null;
  const { x, y, z, w, h } = rect;
  const along = (len: number) => (len - 2 * c > 0 ? len - 2 * c : null);
  switch (edge) {
    case 'n':
    case 's': {
      const len = along(w);
      return len === null ? null : { x: x + c, y: edge === 'n' ? y : y + h - e, z, w: len, h: e };
    }
    case 'w':
    case 'e': {
      const len = along(h);
      return len === null ? null : { x: edge === 'w' ? x : x + w - e, y: y + c, z, w: e, h: len };
    }
    default:
      return {
        x: edge.endsWith('w') ? x : x + w - c,
        y: edge.startsWith('n') ? y : y + h - c,
        z,
        w: c,
        h: c,
      };
  }
}

function resizeAffordances(
  item: LayoutItem,
  rect: Rect,
  container: Size,
  edgeSize: number,
): Affordance[] {
  const out: Affordance[] = [];
  for (const edge of EDGES) {
    const at = edgeRect(edge, rect, edgeSize);
    if (!at) continue;
    const { x, y } = sidesOf(edge);
    const aff: Affordance = {
      id: `${DESKTOP_RESIZE_PREFIX}${edge}:${item.id}`,
      kind: x && y ? 'resize-xy' : x ? 'resize-x' : 'resize-y',
      rect: at,
      cursor: EDGE_CURSOR[edge],
      label: 'resize',
      childId: item.id,
      affects: [item.id],
    };
    const side = x ?? y;
    if (side && !(x && y)) {
      const r = edgeRange(side, rect, item, container, edgeSize);
      aff.bounds = {
        orientation: x ? 'horizontal' : 'vertical',
        valueNow: r.now,
        valueMin: r.min,
        valueMax: r.max,
        atMin: r.now <= r.min,
        atMax: r.now >= r.max,
      };
    }
    out.push(aff);
  }
  return out;
}

function minimizeToggle(id: string, rect: Rect, minimized: boolean): Affordance {
  return {
    id: `${DESKTOP_MINIMIZE_PREFIX}${id}`,
    kind: 'click',
    rect,
    cursor: 'pointer',
    label: minimized ? 'restore' : 'minimize',
    childId: id,
  };
}

/** Which axes `iconFrom` flips the icon layer on; null when it flips none. */
interface Mirror {
  x: boolean;
  y: boolean;
}

function mirrorOf(cfg: DesktopConfig): Mirror | null {
  const x = cfg.iconFrom === 'top-right' || cfg.iconFrom === 'bottom-right';
  const y = cfg.iconFrom === 'bottom-left' || cfg.iconFrom === 'bottom-right';
  return x || y ? { x, y } : null;
}

const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' } as const;

function flipRect(r: Rect, m: Mirror | null, c: Size): Rect {
  if (!m) return r;
  return { ...r, x: m.x ? c.w - r.x - r.w : r.x, y: m.y ? c.h - r.y - r.h : r.y };
}

function flipPoint(p: Point, m: Mirror | null, c: Size): Point {
  if (!m) return p;
  return { x: m.x ? c.w - p.x : p.x, y: m.y ? c.h - p.y : p.y };
}

/** A mirror is its own inverse, so this maps the inner strategy's frame to the
 *  desktop's and back. `bounds` values are left alone: they may be sizes. */
function flipResult(r: LayoutResult<string>, m: Mirror | null, c: Size): LayoutResult<string> {
  if (!m) return r;
  const out: LayoutResult<string> = {
    ...r,
    placements: new Map([...r.placements].map(([id, rect]) => [id, flipRect(rect, m, c)])),
    affordances: r.affordances.map((a) => ({ ...a, rect: flipRect(a.rect, m, c) })),
  };
  if (r.overflow) {
    const { w, h, left = 0, top = 0 } = r.overflow;
    const over = { w: m.x ? left : w, h: m.y ? top : h };
    const near = { left: m.x ? w : left, top: m.y ? h : top };
    out.overflow = over;
    if (near.left > 0) out.overflow.left = near.left;
    if (near.top > 0) out.overflow.top = near.top;
  }
  return out;
}

function flipEvent(e: LayoutEvent, m: Mirror | null, c: Size): LayoutEvent {
  if (!m) return e;
  const { dx, dy, point } = e.payload;
  const payload: LayoutEvent['payload'] = {};
  if (dx !== undefined) payload.dx = m.x ? -dx : dx;
  if (dy !== undefined) payload.dy = m.y ? -dy : dy;
  if (point) payload.point = flipPoint(point, m, c);
  return { ...e, payload };
}

interface Layers {
  icons: LayoutItem[];
  windows: LayoutItem[];
}

function layers(
  items: readonly LayoutItem[],
  options: Record<string, unknown> | undefined,
  hasInner: boolean,
): Layers {
  const cfg = (options ?? {}) as DesktopConfig;
  const iconify = cfg.minimize === 'icon' && hasInner;
  const icon: Size = {
    w: cfg.iconWidth ?? DEFAULT_ICON_SIZE,
    h: cfg.iconHeight ?? DEFAULT_ICON_SIZE,
  };
  const out: Layers = { icons: [], windows: [] };
  for (const item of items) {
    if (item.meta?.icon === true) out.icons.push(item);
    else if (iconify && item.meta?.minimized === true) {
      // Its own size is the window's; only the icon size applies down there.
      const asIcon: LayoutItem = { id: item.id, natural: icon };
      if (item.meta) asIcon.meta = item.meta;
      out.icons.push(asIcon);
    } else out.windows.push(item);
  }
  return out;
}

function windowSize(item: LayoutItem): Size | null {
  const w = item.placement?.size?.w ?? item.natural?.w ?? item.hints?.preferredSize?.w;
  const h = item.placement?.size?.h ?? item.natural?.h ?? item.hints?.preferredSize?.h;
  const usable = (n: number | undefined): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n > 0;
  return usable(w) && usable(h) ? { w, h } : null;
}

interface PlacedWindow {
  item: LayoutItem;
  rect: Rect;
  minimized: boolean;
}

/** Where each window shows, and the ones with no size to show at. Shared by
 *  `layout` and the resize dispatch, which works from where a window shows. */
function placeWindows(
  windows: readonly LayoutItem[],
  cfg: DesktopConfig,
  container: Size,
): { windows: PlacedWindow[]; unplaced: string[] } {
  const shadeHeight = cfg.shadeHeight ?? DEFAULT_SHADE_HEIGHT;
  const cascade = cfg.cascade ?? DEFAULT_CASCADE;
  const handleSize = cfg.handleSize ?? DEFAULT_HANDLE_SIZE;
  const out: PlacedWindow[] = [];
  const unplaced: string[] = [];
  let slot = 0;
  for (const item of windows) {
    const size = windowSize(item);
    if (!size) {
      trace('layout', `desktop: ${item.id} has no size, unplaced`);
      unplaced.push(item.id);
      continue;
    }
    const { x, y } = item.meta ?? {};
    let at: Point;
    if (Number.isFinite(x) && Number.isFinite(y)) at = { x: x as number, y: y as number };
    else {
      const bad = (n: unknown) => typeof n === 'number' && !Number.isFinite(n);
      if (bad(x) || bad(y)) {
        trace('layout', `desktop: ${item.id} at non-finite (${x}, ${y}), cascaded`);
      }
      at = { x: slot * cascade, y: slot * cascade };
      slot++;
    }
    const minimized = item.meta?.minimized === true;
    if (minimized && cfg.minimize === 'icon') {
      trace('layout', `desktop: ${item.id} minimized to an icon with no icon layer, shaded`);
    }
    const h = minimized ? shadeHeight : size.h;
    if (cfg.clamp) {
      const kept = clampWindow(at, { w: size.w, h }, container, cfg.clamp, handleSize);
      if (kept.x !== at.x || kept.y !== at.y) {
        trace('layout', `desktop: ${item.id} clamped (${at.x}, ${at.y}) → (${kept.x}, ${kept.y})`);
        at = kept;
      }
    }
    out.push({ item, rect: { x: at.x, y: at.y, z: 0, w: size.w, h }, minimized });
  }
  let z = 0;
  for (const top of [false, true]) {
    for (const p of out) if (onTopLayer(p.item) === top) p.rect.z = ++z;
  }
  return { windows: out, unplaced };
}

type DispatchContext = Parameters<NonNullable<LayoutStrategy['dispatchAffordance']>>[0];

/** Moves one or two sides of a window within {@link edgeRange}, writing
 *  `placement.size` and, for the left and top sides, `x` / `y`. */
function resizeWindow(ctx: DispatchContext, windows: readonly LayoutItem[]): void {
  const { event, store, container } = ctx;
  const rest = event.affordanceId.slice(DESKTOP_RESIZE_PREFIX.length);
  const cut = rest.indexOf(':');
  const edge = rest.slice(0, cut) as Edge;
  const id = asNodeId(rest.slice(cut + 1));
  if (!EDGES.includes(edge)) return;
  if (store.isLocked(id, 'resize')) {
    trace('layout', `desktop: ${id} resize refused (lock.resize)`);
    return;
  }
  const cfg = ctx.options as DesktopConfig;
  const shown = placeWindows(windows, cfg, container).windows.find((p) => p.item.id === id);
  if (!shown || shown.minimized) return;
  const { item, rect } = shown;
  const edgeSize = cfg.edgeSize ?? DEFAULT_EDGE_SIZE;
  const moveLocked = store.isLocked(id, 'move');
  const sides = sidesOf(edge);
  const next = { ...rect };
  for (const side of [sides.x, sides.y]) {
    if (!side) continue;
    if (moveLocked && (side === 'w' || side === 'n')) {
      trace('layout', `desktop: ${id} ${side} side refused (lock.move)`);
      continue;
    }
    const horizontal = side === 'w' || side === 'e';
    const raw = horizontal ? event.payload.dx : event.payload.dy;
    if (raw === undefined || !Number.isFinite(raw) || raw === 0) continue;
    const r = edgeRange(side, rect, item, container, edgeSize);
    const to = Math.max(r.min, Math.min(r.max, r.now + raw));
    if (side === 'e') next.w = to - rect.x;
    else if (side === 's') next.h = to - rect.y;
    else if (side === 'w') {
      next.x = to;
      next.w = rect.x + rect.w - to;
    } else {
      next.y = to;
      next.h = rect.y + rect.h - to;
    }
  }
  if (next.w === rect.w && next.h === rect.h) return;
  const size = { ...(item.placement?.size ?? {}) };
  if (next.w !== rect.w) size.w = next.w;
  if (next.h !== rect.h) size.h = next.h;
  const patch: Record<string, unknown> = { size };
  if (next.x !== rect.x || next.y !== rect.y) {
    patch.x = next.x;
    patch.y = next.y;
  }
  trace(
    'layout',
    `desktop: ${id} resized from ${edge} to ${next.w}x${next.h} at ${next.x},${next.y}`,
  );
  store.patchPlacement(id, patch);
}

/**
 * Lays windows out the way a desktop does: each at the `x` / `y` its placement
 * carries, overlapping freely, stacked in item order — later is nearer, `z`
 * counting up from 1 — and shaded or iconified when `minimized`. Items marked
 * `icon` are tiled underneath at `z` 0 by `inner`.
 *
 * Nothing is dragged and nothing is kept: every position is the host's to
 * write, and raising a window is moving it to the end of `childOrder`.
 * @group Strategies
 */
export function desktopStrategy<TInner>(
  inner?: LayoutStrategy<TInner, string, unknown>,
): StatefulLayoutStrategy<DesktopState<TInner | undefined>, string> {
  const hasInner = inner !== undefined;
  return {
    name: inner ? `desktop(${inner.name})` : 'desktop',

    configSpec: {
      ...(inner?.configSpec ?? {}),
      minimize: DESKTOP_MINIMIZE,
      shadeHeight: 'number',
      iconWidth: 'number',
      iconHeight: 'number',
      cascade: 'number',
      raise: RAISE_MODES,
      drag: DESKTOP_DRAG,
      handleSize: 'number',
      clamp: DESKTOP_CLAMP,
      overflow: DESKTOP_OVERFLOW,
      minimizable: 'boolean',
      resize: 'boolean',
      edgeSize: 'number',
      iconFrom: DESKTOP_ICON_FROM,
    },

    initialState(items, options) {
      return { inner: inner?.initialState?.(layers(items, options, hasInner).icons, options) };
    },

    layout({ items, container, state, options, preview }) {
      const cfg = options as DesktopConfig;
      const handleSize = cfg.handleSize ?? DEFAULT_HANDLE_SIZE;
      const { icons, windows } = layers(items, options, hasInner);

      const mirror = mirrorOf(cfg);
      const innerInput = { items: icons, container, state: state.inner as TInner, options };
      const innerPreview = preview && {
        ...preview,
        cursor: flipPoint(preview.cursor, mirror, container),
      };
      const result: LayoutResult<string> = inner
        ? flipResult(
            inner.layout(innerPreview ? { ...innerInput, preview: innerPreview } : innerInput),
            mirror,
            container,
          )
        : { placements: new Map(), affordances: [] };

      const placements = new Map(result.placements);
      const affordances: Affordance[] = [...result.affordances];
      const unplaced = [...(result.unplaced ?? [])];
      if (!inner) for (const icon of icons) unplaced.push(icon.id);
      if (cfg.minimizable) {
        for (const icon of icons) {
          if (icon.meta?.icon === true || icon.meta?.minimized !== true) continue;
          const rect = placements.get(icon.id);
          if (rect) affordances.push(minimizeToggle(icon.id, rect, true));
        }
      }

      const edgeSize = cfg.edgeSize ?? DEFAULT_EDGE_SIZE;
      const placed = placeWindows(windows, cfg, container);
      unplaced.push(...placed.unplaced);
      let overW = result.overflow?.w ?? 0;
      let overH = result.overflow?.h ?? 0;
      let overLeft = result.overflow?.left ?? 0;
      let overTop = result.overflow?.top ?? 0;
      for (const { item, rect, minimized } of placed.windows) {
        placements.set(item.id, rect);
        const axes = dragAxes(item, cfg);
        if (axes) {
          affordances.push({
            id: `${DESKTOP_DRAG_PREFIX}${item.id}`,
            kind: DRAG_KIND[axes],
            rect: { ...rect, h: Math.min(handleSize, rect.h) },
            cursor: 'grab',
            label: 'move',
            childId: item.id,
          });
        }
        if (!minimized && resizable(item, cfg)) {
          affordances.push(...resizeAffordances(item, rect, container, edgeSize));
        }
        if (cfg.minimizable) {
          const side = Math.min(handleSize, rect.h, rect.w);
          const box = { x: rect.x + rect.w - side, y: rect.y, z: rect.z, w: side, h: side };
          affordances.push(minimizeToggle(item.id, box, minimized));
        }
        overW = Math.max(overW, rect.x + rect.w - container.w);
        overH = Math.max(overH, rect.y + rect.h - container.h);
        overLeft = Math.max(overLeft, -rect.x);
        overTop = Math.max(overTop, -rect.y);
      }
      const rank = placed.windows.length;

      trace(
        'layout',
        `desktop: ${rank} windows over ${icons.length} icons in ${inner?.name ?? 'nothing'}`,
      );
      const out: LayoutResult<string> = { ...result, placements, affordances };
      delete out.unplaced;
      delete out.overflow;
      if (unplaced.length > 0) out.unplaced = unplaced;
      const over =
        cfg.overflow !== 'clip' && (overW > 0 || overH > 0 || overLeft > 0 || overTop > 0);
      if (over) {
        out.overflow = { w: Math.max(0, overW), h: Math.max(0, overH) };
        if (overLeft > 0) out.overflow.left = overLeft;
        if (overTop > 0) out.overflow.top = overTop;
      }
      return out;
    },

    dispatchAffordance(ctx) {
      const { event, affordance, store } = ctx;
      if (!isOwnAffordance(event.affordanceId)) {
        if (!inner?.dispatchAffordance) return;
        const items = layers(ctx.items, ctx.options, hasInner).icons;
        const mirror = mirrorOf(ctx.options as DesktopConfig);
        inner.dispatchAffordance({
          ...ctx,
          items,
          event: flipEvent(event, mirror, ctx.container),
          affordance: { ...affordance, rect: flipRect(affordance.rect, mirror, ctx.container) },
        });
        return;
      }
      if (event.affordanceId.startsWith(DESKTOP_MINIMIZE_PREFIX)) {
        if (event.kind !== 'click') return;
        const id = asNodeId(event.affordanceId.slice(DESKTOP_MINIMIZE_PREFIX.length));
        const minimized = store.getNode(id)?.membership?.placement.minimized === true;
        trace('layout', `desktop: ${id} ${minimized ? 'restored' : 'minimized'} by its toggle`);
        store.patchPlacement(id, { minimized: !minimized });
        return;
      }
      if (event.kind !== 'drag') return;
      if (event.affordanceId.startsWith(DESKTOP_RESIZE_PREFIX)) {
        resizeWindow(ctx, layers(ctx.items, ctx.options, hasInner).windows);
        return;
      }
      const id = asNodeId(event.affordanceId.slice(DESKTOP_DRAG_PREFIX.length));
      if (store.isLocked(id, 'move')) {
        trace('layout', `desktop: ${id} drag refused (lock.move)`);
        return;
      }
      const { dx: rawX, dy: rawY } = event.payload;
      const dx = affordance.kind === 'drag-y' || !Number.isFinite(rawX) ? 0 : (rawX as number);
      const dy = affordance.kind === 'drag-x' || !Number.isFinite(rawY) ? 0 : (rawY as number);
      if (dx === 0 && dy === 0) return;
      // From where it shows, not the stored value: a cascaded window has none.
      let next = { x: affordance.rect.x + dx, y: affordance.rect.y + dy };
      const cfg = ctx.options as DesktopConfig;
      const item = ctx.items.find((i) => i.id === id);
      const size = item && windowSize(item);
      if (cfg.clamp && size) {
        const h =
          item.meta?.minimized === true ? (cfg.shadeHeight ?? DEFAULT_SHADE_HEIGHT) : size.h;
        const band = cfg.handleSize ?? DEFAULT_HANDLE_SIZE;
        next = clampWindow(next, { w: size.w, h }, ctx.container, cfg.clamp, band);
      }
      trace('layout', `desktop: ${id} dragged to ${next.x},${next.y}`);
      store.patchPlacement(id, next);
    },

    reduce(state, event, context) {
      if (!inner?.reduce || isOwnAffordance(event.affordanceId)) return state;
      const items = layers(context.items, context.options, hasInner).icons;
      const flipped = flipEvent(
        event,
        mirrorOf(context.options as DesktopConfig),
        context.container,
      );
      return {
        ...state,
        inner: inner.reduce(state.inner as TInner, flipped, { ...context, items }),
      };
    },

    canAccept(items, options) {
      if (!inner?.canAccept) return true;
      return inner.canAccept(layers(items, options, hasInner).icons, options);
    },

    navigate(input) {
      if (!inner?.navigate) return undefined;
      const items = layers(input.items, input.options, hasInner).icons;
      const mirror = mirrorOf(input.options as DesktopConfig);
      const { direction } = input;
      const across = direction === 'left' || direction === 'right' ? mirror?.x : mirror?.y;
      return inner.navigate({
        ...input,
        items,
        direction: across ? OPPOSITE[direction] : direction,
      });
    },
  };
}
