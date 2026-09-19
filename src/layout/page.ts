import type {
  Affordance,
  LayoutEvent,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
  StatefulLayoutStrategy,
  StrategyCommand,
} from '../layout-types.js';
import type { NodeId } from '../node.js';
import { trace } from '../trace.js';

/** Where a child's page comes from: its own `placement.page`, or the order
 *  children fill pages in. */
export type PageMode = 'assigned' | 'flowed';

const PAGE_MODES: readonly PageMode[] = ['assigned', 'flowed'];
const BAR_SIDES = ['top', 'bottom'] as const;

interface PageConfig {
  mode?: PageMode;
  pages?: number;
  bar?: number;
  barSide?: (typeof BAR_SIDES)[number];
  inner?: Record<string, unknown>;
}

/** The page shown, zero-based, and the wrapped strategy's own state. */
export interface PageState<TInner> {
  page: number;
  inner: TInner;
}

/** What each switcher affordance carries in `meta`. */
export interface PageAffordanceMeta {
  page: number;
  count: number;
  current: boolean;
}

/** Affordance id prefix, so dispatch can route without knowing the inner strategy. */
const PAGE_PREFIX = 'page:';

const isOwn = (affordanceId: string) => affordanceId.startsWith(PAGE_PREFIX);

function innerOptions(options: Record<string, unknown>): Record<string, unknown> {
  const inner = (options as PageConfig).inner;
  return inner && typeof inner === 'object' ? inner : {};
}

function barSize(cfg: PageConfig): number {
  const bar = cfg.bar;
  return typeof bar === 'number' && Number.isFinite(bar) && bar > 0 ? bar : 0;
}

/** The area `inner` lays out in, and how far down it starts. */
function areaOf(container: Size, cfg: PageConfig): { size: Size; dy: number } {
  const bar = Math.min(barSize(cfg), container.h);
  return {
    size: { w: container.w, h: container.h - bar },
    dy: cfg.barSide === 'top' ? bar : 0,
  };
}

function assignedPage(item: LayoutItem): number {
  const page = item.meta?.page;
  if (page === undefined) return 0;
  if (typeof page === 'number' && Number.isInteger(page) && page >= 0) return page;
  trace('layout', `page: ${item.id} has page ${JSON.stringify(page)}, shown on page 0`);
  return 0;
}

interface Paged {
  /** Each page's items, in item order. */
  pages: LayoutItem[][];
  /** The page shown: the stored page, clamped to the pages there are. */
  shown: number;
  /** `inner`'s result for the shown page. */
  result: LayoutResult<string>;
}

function clampPage(page: number, count: number): number {
  const p = Number.isInteger(page) ? page : 0;
  return Math.max(0, Math.min(p, count - 1));
}

function paginate<TInner>(
  inner: LayoutStrategy<TInner, string, unknown>,
  items: LayoutItem[],
  size: Size,
  state: PageState<TInner>,
  options: Record<string, unknown>,
): Paged {
  const cfg = options as PageConfig;
  const innerOpts = innerOptions(options);
  if (cfg.mode === 'flowed') {
    const flowOpts = { ...innerOpts, overflowMode: 'unplaced' };
    const pages: LayoutItem[][] = [];
    const results: LayoutResult<string>[] = [];
    let remaining = items;
    while (remaining.length > 0) {
      let result = inner.layout({
        items: remaining,
        container: size,
        state: state.inner,
        options: flowOpts,
      });
      const spilled = new Set(result.unplaced ?? []);
      let onPage = remaining.filter((i) => !spilled.has(i.id));
      if (onPage.length === 0) {
        // Too big for an empty page: give it one of its own so the loop ends.
        onPage = remaining.slice(0, 1);
        trace('layout', `page: ${onPage[0]?.id} fits no page, given page ${pages.length} alone`);
        result = inner.layout({
          items: onPage,
          container: size,
          state: state.inner,
          options: flowOpts,
        });
      }
      const taken = new Set(onPage.map((i) => i.id));
      pages.push(onPage);
      results.push(result);
      remaining = remaining.filter((i) => !taken.has(i.id));
    }
    if (pages.length === 0) pages.push([]);
    const shown = clampPage(state.page, pages.length);
    const result =
      results[shown] ??
      inner.layout({
        items: [],
        container: size,
        state: state.inner,
        options: flowOpts,
      });
    return { pages, shown, result };
  }

  const pages: LayoutItem[][] = [];
  const min = typeof cfg.pages === 'number' && Number.isFinite(cfg.pages) ? cfg.pages : 1;
  for (let k = 0; k < Math.max(1, Math.floor(min)); k++) pages.push([]);
  for (const item of items) {
    const p = assignedPage(item);
    while (pages.length <= p) pages.push([]);
    pages[p]?.push(item);
  }
  const shown = clampPage(state.page, pages.length);
  const result = inner.layout({
    items: pages[shown] ?? [],
    container: size,
    state: state.inner,
    options: innerOpts,
  });
  return { pages, shown, result };
}

const shift = (r: Rect, dy: number): Rect => (dy === 0 ? r : { ...r, y: r.y + dy });

function switchers(count: number, shown: number, container: Size, cfg: PageConfig): Affordance[] {
  const bar = Math.min(barSize(cfg), container.h);
  if (bar === 0) return [];
  const y = cfg.barSide === 'top' ? 0 : container.h - bar;
  const w = container.w / count;
  return Array.from({ length: count }, (_, page) => {
    const meta: PageAffordanceMeta = { page, count, current: page === shown };
    return {
      id: `${PAGE_PREFIX}${page}`,
      kind: 'click',
      rect: { x: page * w, y, z: 0, w, h: bar },
      name: `Page ${page + 1} of ${count}`,
      meta,
    };
  });
}

function withPage<TInner>(state: PageState<TInner>, page: number): PageState<TInner> {
  if (page === state.page) return state;
  trace('layout', `page: ${state.page} → ${page}`);
  return { ...state, page };
}

/**
 * Shows one page of children at a time and hands that page to `inner`. A
 * child's page is its `placement.page` under `mode: 'assigned'` — virtual
 * desktops — or, under `mode: 'flowed'`, wherever `inner` ran out of room for
 * it — pagination. The page shown lives in state and changes through the
 * switcher affordances in `bar`, or through the `page` / `next` / `prev`
 * commands. `inner`'s config goes under `config.inner`.
 *
 * @group Strategies
 */
export function pageStrategy<TInner>(
  inner: LayoutStrategy<TInner, string, unknown>,
): StatefulLayoutStrategy<PageState<TInner>, string> {
  const initialInner = (items: LayoutItem[], options: Record<string, unknown>) =>
    inner.initialState?.(items, innerOptions(options)) as TInner;

  /** The shown page's items, for the hooks that are handed every child. */
  const shownItems = (
    items: LayoutItem[],
    state: PageState<TInner>,
    options: Record<string, unknown>,
    container: Size,
  ) => {
    const { pages, shown } = paginate(
      inner,
      items,
      areaOf(container, options).size,
      state,
      options,
    );
    return pages[shown] ?? [];
  };

  const unshift = (event: LayoutEvent, dy: number): LayoutEvent => {
    const point = event.payload.point;
    if (dy === 0 || !point) return event;
    return { ...event, payload: { ...event.payload, point: { x: point.x, y: point.y - dy } } };
  };

  return {
    name: `page(${inner.name})`,

    configSpec: {
      mode: PAGE_MODES,
      pages: 'number',
      bar: 'number',
      barSide: BAR_SIDES,
      inner: 'object',
    },

    initialState(items, options = {}) {
      return { page: 0, inner: initialInner(items, options) };
    },

    layout({ items, container, state, options }) {
      const cfg = options as PageConfig;
      const { size, dy } = areaOf(container, cfg);
      const safe = state ?? { page: 0, inner: initialInner(items, options) };
      const { pages, shown, result } = paginate(inner, items, size, safe, options);

      const placements = new Map<string, Rect>();
      for (const [id, rect] of result.placements) placements.set(id, shift(rect, dy));
      const affordances: Affordance[] = result.affordances.map((a) =>
        dy === 0 ? a : { ...a, rect: shift(a.rect, dy) },
      );
      affordances.push(...switchers(pages.length, shown, container, cfg));

      const unplaced = new Set(result.unplaced ?? []);
      const channels = new Map<string, Record<string, number>>();
      pages.forEach((page, k) => {
        for (const item of page) {
          if (k !== shown) unplaced.add(item.id);
          channels.set(item.id, { ...(k === shown ? result.channels?.get(item.id) : {}), page: k });
        }
      });
      for (const id of placements.keys()) unplaced.delete(id);

      trace(
        'layout',
        `page: ${cfg.mode ?? 'assigned'} page ${shown + 1}/${pages.length}, ` +
          `${placements.size} placed, ${unplaced.size} withheld`,
      );
      const out: LayoutResult<string> = { ...result, placements, affordances, channels };
      delete out.unplaced;
      if (unplaced.size > 0) out.unplaced = [...unplaced];
      delete out.isPreview;
      return out;
    },

    reduce(state, event, context) {
      if (isOwn(event.affordanceId)) {
        if (event.kind !== 'click') return state;
        const to = Number(event.affordanceId.slice(PAGE_PREFIX.length));
        return Number.isInteger(to) ? withPage(state, to) : state;
      }
      if (!inner.reduce) return state;
      const { size, dy } = areaOf(context.container, context.options);
      const items = shownItems(context.items, state, context.options, context.container);
      const next = inner.reduce(state.inner, unshift(event, dy), {
        container: size,
        options: innerOptions(context.options),
        items,
      });
      return next === state.inner ? state : { ...state, inner: next };
    },

    dispatchAffordance(ctx) {
      if (isOwn(ctx.event.affordanceId) || !inner.dispatchAffordance) return;
      const stored = ctx.store.getContainerState(ctx.parentId) as PageState<TInner> | undefined;
      const state = stored ?? { page: 0, inner: initialInner(ctx.items, ctx.options) };
      const { size, dy } = areaOf(ctx.container, ctx.options);
      inner.dispatchAffordance({
        ...ctx,
        event: unshift(ctx.event, dy),
        affordance: { ...ctx.affordance, rect: shift(ctx.affordance.rect, -dy) },
        container: size,
        options: innerOptions(ctx.options),
        items: shownItems(ctx.items, state, ctx.options, ctx.container),
      });
    },

    command(state, cmd: StrategyCommand, context) {
      const { pages, shown } = paginate(
        inner,
        context.items,
        areaOf(context.container, context.options).size,
        state,
        context.options,
      );
      const last = pages.length - 1;
      if (cmd.type === 'next') return withPage(state, Math.min(shown + 1, last));
      if (cmd.type === 'prev') return withPage(state, Math.max(shown - 1, 0));
      if (cmd.type === 'page' && typeof cmd.to === 'number' && Number.isInteger(cmd.to)) {
        return withPage(state, clampPage(cmd.to, pages.length));
      }
      trace('layout', `page: command ${JSON.stringify(cmd)} ignored`);
      return state;
    },

    land({ ids, state, store, options, items, container }) {
      if ((options as PageConfig).mode === 'flowed') return state;
      const size = container ? areaOf(container, options).size : { w: 0, h: 0 };
      // Count pages without the arrivals: the page they carried is another container's.
      const arriving = new Set<string>(ids);
      const staying = items.filter((i) => !arriving.has(i.id));
      const { shown } = paginate(inner, staying, size, state, options);
      for (const id of ids) {
        if (store.getNode(id)?.membership?.placement.page === shown) continue;
        trace('layout', `page: ${id} landed on page ${shown}`);
        store.patchPlacement(id as NodeId, { page: shown });
      }
      return state;
    },

    navigate(input) {
      if (!inner.navigate || (input.options as PageConfig).mode === 'flowed') return undefined;
      const from = input.items.find((i) => i.id === input.from);
      if (!from) return undefined;
      const page = assignedPage(from);
      return inner.navigate({
        ...input,
        items: input.items.filter((i) => assignedPage(i) === page),
        options: innerOptions(input.options),
      });
    },
  };
}
