import type {
  Affordance,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
  StatefulLayoutStrategy,
} from '../layout-types.js';
import { asNodeId } from '../node.js';
import { trace } from '../trace.js';

/** The values `container.config.minimize` accepts. */
export const DESKTOP_MINIMIZE = ['shade', 'icon'] as const;

/** The values `container.config.clamp` accepts. */
export const DESKTOP_CLAMP = ['bar', 'all'] as const;

/** The values `container.config.overflow` accepts. */
export const DESKTOP_OVERFLOW = ['clip', 'scroll'] as const;

/** The values `drag` accepts, in config or in a window's placement. */
export const DESKTOP_DRAG = [true, false, 'x', 'y'] as const;

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
}

/** {@link desktopStrategy}'s state: only whatever the wrapped strategy keeps. */
export interface DesktopState<TInner = unknown> {
  inner: TInner;
}

export const DEFAULT_SHADE_HEIGHT = 28;
export const DEFAULT_ICON_SIZE = 64;
export const DEFAULT_CASCADE = 24;
export const DEFAULT_HANDLE_SIZE = 22;

/** Affordance id prefixes, so dispatch can route without knowing the inner strategy. */
export const DESKTOP_DRAG_PREFIX = 'desktop:drag:';
export const DESKTOP_MINIMIZE_PREFIX = 'desktop:minimize:';

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
  return id.startsWith(DESKTOP_DRAG_PREFIX) || id.startsWith(DESKTOP_MINIMIZE_PREFIX);
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
      drag: DESKTOP_DRAG,
      handleSize: 'number',
      clamp: DESKTOP_CLAMP,
      overflow: DESKTOP_OVERFLOW,
      minimizable: 'boolean',
    },

    initialState(items, options) {
      return { inner: inner?.initialState?.(layers(items, options, hasInner).icons, options) };
    },

    layout({ items, container, state, options, preview }) {
      const cfg = options as DesktopConfig;
      const shadeHeight = cfg.shadeHeight ?? DEFAULT_SHADE_HEIGHT;
      const cascade = cfg.cascade ?? DEFAULT_CASCADE;
      const handleSize = cfg.handleSize ?? DEFAULT_HANDLE_SIZE;
      const { icons, windows } = layers(items, options, hasInner);

      const innerInput = { items: icons, container, state: state.inner as TInner, options };
      const result: LayoutResult<string> = inner
        ? inner.layout(preview ? { ...innerInput, preview } : innerInput)
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

      let overW = result.overflow?.w ?? 0;
      let overH = result.overflow?.h ?? 0;
      let overLeft = result.overflow?.left ?? 0;
      let overTop = result.overflow?.top ?? 0;
      let rank = 0;
      let slot = 0;
      for (const item of windows) {
        const size = windowSize(item);
        if (!size) {
          trace('layout', `desktop: ${item.id} has no size, unplaced`);
          unplaced.push(item.id);
          continue;
        }
        const { x, y } = item.meta ?? {};
        let at: { x: number; y: number };
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
            trace(
              'layout',
              `desktop: ${item.id} clamped (${at.x}, ${at.y}) → (${kept.x}, ${kept.y})`,
            );
            at = kept;
          }
        }
        rank++;
        const rect = { x: at.x, y: at.y, z: rank, w: size.w, h };
        placements.set(item.id, rect);
        const axes = dragAxes(item, cfg);
        if (axes) {
          affordances.push({
            id: `${DESKTOP_DRAG_PREFIX}${item.id}`,
            kind: DRAG_KIND[axes],
            rect: { ...rect, h: Math.min(handleSize, h) },
            cursor: 'grab',
            label: 'move',
            childId: item.id,
          });
        }
        if (cfg.minimizable) {
          const side = Math.min(handleSize, h, size.w);
          const box = { x: at.x + size.w - side, y: at.y, z: rank, w: side, h: side };
          affordances.push(minimizeToggle(item.id, box, minimized));
        }
        overW = Math.max(overW, at.x + size.w - container.w);
        overH = Math.max(overH, at.y + h - container.h);
        overLeft = Math.max(overLeft, -at.x);
        overTop = Math.max(overTop, -at.y);
      }

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
        inner.dispatchAffordance({ ...ctx, items });
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
      return { ...state, inner: inner.reduce(state.inner as TInner, event, { ...context, items }) };
    },

    canAccept(items, options) {
      if (!inner?.canAccept) return true;
      return inner.canAccept(layers(items, options, hasInner).icons, options);
    },

    navigate(input) {
      if (!inner?.navigate) return undefined;
      const items = layers(input.items, input.options, hasInner).icons;
      return inner.navigate({ ...input, items });
    },
  };
}
