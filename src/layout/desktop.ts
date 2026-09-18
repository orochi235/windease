import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Size,
  StatefulLayoutStrategy,
} from '../layout-types.js';
import { trace } from '../trace.js';

/** The values `container.config.minimize` accepts. */
export const DESKTOP_MINIMIZE = ['shade', 'icon'] as const;

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
}

/** {@link desktopStrategy}'s state: only whatever the wrapped strategy keeps. */
export interface DesktopState<TInner = unknown> {
  inner: TInner;
}

export const DEFAULT_SHADE_HEIGHT = 28;
export const DEFAULT_ICON_SIZE = 64;
export const DEFAULT_CASCADE = 24;

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
    },

    initialState(items, options) {
      return { inner: inner?.initialState?.(layers(items, options, hasInner).icons, options) };
    },

    layout({ items, container, state, options, preview }) {
      const cfg = options as DesktopConfig;
      const shadeHeight = cfg.shadeHeight ?? DEFAULT_SHADE_HEIGHT;
      const cascade = cfg.cascade ?? DEFAULT_CASCADE;
      const { icons, windows } = layers(items, options, hasInner);

      const innerInput = { items: icons, container, state: state.inner as TInner, options };
      const result: LayoutResult<string> = inner
        ? inner.layout(preview ? { ...innerInput, preview } : innerInput)
        : { placements: new Map(), affordances: [] };

      const placements = new Map(result.placements);
      const unplaced = [...(result.unplaced ?? [])];
      if (!inner) for (const icon of icons) unplaced.push(icon.id);

      let overW = result.overflow?.w ?? 0;
      let overH = result.overflow?.h ?? 0;
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
        rank++;
        placements.set(item.id, { x: at.x, y: at.y, z: rank, w: size.w, h });
        overW = Math.max(overW, at.x + size.w - container.w);
        overH = Math.max(overH, at.y + h - container.h);
      }

      trace(
        'layout',
        `desktop: ${rank} windows over ${icons.length} icons in ${inner?.name ?? 'nothing'}`,
      );
      const out: LayoutResult<string> = { ...result, placements };
      delete out.unplaced;
      delete out.overflow;
      if (unplaced.length > 0) out.unplaced = unplaced;
      if (overW > 0 || overH > 0) out.overflow = { w: Math.max(0, overW), h: Math.max(0, overH) };
      return out;
    },

    reduce(state, event, context) {
      if (!inner?.reduce) return state;
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
