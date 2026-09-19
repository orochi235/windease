import type { LayoutItem, LayoutResult, LayoutStrategy, Rect, Size } from '../layout-types.js';
import { STACK_FALLBACK, STACK_SHOW, STACK_TEAR } from '../policies.js';
import { trace } from '../trace.js';
import { zoomedOf, zoomLayout } from './zoom.js';

/** The values a stack's `config.tabs` accepts. `'strip'` is one band of tabs;
 *  `'stacked'` is i3's stacked layout, one title bar per child. */
export const STACK_TABS = ['strip', 'stacked'] as const;

/** The values a stack's `config.side` accepts: the edge the tab band sits on. */
export const STACK_SIDES = ['top', 'bottom', 'left', 'right'] as const;

/** One of {@link STACK_TABS}. */
export type StackTabs = (typeof STACK_TABS)[number];
/** One of {@link STACK_SIDES}. */
export type StackSide = (typeof STACK_SIDES)[number];

interface StackConfig {
  /** Which child fills the body. Defaults to the first in `childOrder`. */
  activeId?: string;
  /** The band's thickness for `tabs: 'strip'`. An input, not a measurement —
   *  the core never measures the tabs it does not draw. */
  headerSize?: number;
  tabs?: StackTabs;
  side?: StackSide;
  /** One title bar's thickness for `tabs: 'stacked'`. Defaults to `headerSize`. */
  tabSize?: number;
  padding?: number;
  /** A child that fills the whole container, header band included, while
   *  every other child is withheld. `activeId` is left alone for when it
   *  clears. */
  zoom?: string;
}

/** Where a stack's tab band sits, the body beside it, and, for
 *  `tabs: 'stacked'`, each child's title bar in child order. */
export interface StackBands {
  band: Rect;
  body: Rect;
  bars?: Rect[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The band a stack reserves for its tabs and the body it leaves, for `count`
 * children. Pure; `stackStrategy` lays out with it and emits the band as
 * channels.
 *
 * @group Layout
 */
export function stackBands(
  options: Record<string, unknown>,
  container: Size,
  count: number,
): StackBands {
  const cfg = options as StackConfig;
  const padding = num(cfg.padding);
  const stacked = cfg.tabs === 'stacked';
  const bar = stacked ? num(cfg.tabSize ?? cfg.headerSize) : 0;
  const side: StackSide = STACK_SIDES.includes(cfg.side as StackSide)
    ? (cfg.side as StackSide)
    : 'top';
  const horizontal = side === 'top' || side === 'bottom';
  const room = horizontal ? container.h : container.w;
  const thickness = Math.min(room, stacked ? bar * count : num(cfg.headerSize));

  const band: Rect = horizontal
    ? { x: 0, y: side === 'top' ? 0 : container.h - thickness, z: 0, w: container.w, h: thickness }
    : {
        x: side === 'left' ? 0 : container.w - thickness,
        y: 0,
        z: 0,
        w: thickness,
        h: container.h,
      };
  const lead = side === 'top' || side === 'left' ? thickness : 0;
  const body: Rect = {
    x: (horizontal ? 0 : lead) + padding,
    y: (horizontal ? lead : 0) + padding,
    z: 0,
    w: Math.max(0, container.w - (horizontal ? 0 : thickness) - padding * 2),
    h: Math.max(0, container.h - (horizontal ? thickness : 0) - padding * 2),
  };
  if (!stacked) return { band, body };
  const bars = Array.from(
    { length: count },
    (_, i): Rect =>
      horizontal
        ? { x: band.x, y: band.y + i * bar, z: 0, w: band.w, h: bar }
        : { x: band.x + i * bar, y: band.y, z: 0, w: bar, h: band.h },
  );
  return { band, body, bars };
}

/**
 * One child visible, the rest withheld. The tabs are the consumer's to draw;
 * the strategy reserves a band for them on `side` and reports it to every
 * child as channels (`bandX`/`bandY`/`bandW`/`bandH`, plus that child's own
 * title bar as `tabX`/`tabY`/`tabW`/`tabH` under `tabs: 'stacked'`).
 *
 * @group Layout
 */
export const stackStrategy: LayoutStrategy<void, string> = {
  name: 'stack',
  configSpec: {
    activeId: 'string',
    headerSize: 'number',
    tabs: STACK_TABS,
    side: STACK_SIDES,
    tabSize: 'number',
    padding: 'number',
    show: STACK_SHOW,
    fallback: STACK_FALLBACK,
    tear: STACK_TEAR,
    tearSize: 'object',
    zoom: 'string',
  },
  layout({
    items,
    container,
    options,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
  }): LayoutResult<string> {
    const cfg = options as StackConfig;
    const padding = cfg.padding ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) return { placements, affordances: [] };
    const zoomed = zoomedOf(items, cfg.zoom);
    if (zoomed) return zoomLayout(items, zoomed, container, padding);

    const { band, body, bars } = stackBands(options, container, items.length);
    const active = items.find((i) => i.id === cfg.activeId) ?? items[0]!;
    placements.set(active.id, body);

    const unplaced = items.filter((i) => i.id !== active.id).map((i) => i.id);
    const result: LayoutResult<string> = { placements, affordances: [] };
    if (unplaced.length > 0) result.unplaced = unplaced;
    if (band.w > 0 && band.h > 0) {
      const shared = { bandX: band.x, bandY: band.y, bandW: band.w, bandH: band.h };
      result.channels = new Map(
        items.map((item, i) => {
          const bar = bars?.[i];
          return [
            item.id,
            bar ? { ...shared, tabX: bar.x, tabY: bar.y, tabW: bar.w, tabH: bar.h } : shared,
          ];
        }),
      );
    }
    trace(
      'layout',
      `stack: active=${active.id}, ${unplaced.length} withheld of ${items.length}, band ${band.w}x${band.h}@${band.x},${band.y}`,
    );
    return result;
  },
};
