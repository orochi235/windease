import type { Affordance, LayoutEvent, LayoutItem, LayoutStrategy, Size } from '../layout-types.js';

type Direction = 'left' | 'right' | 'up' | 'down';
type Point = { x: number; y: number };

/**
 * The wrapper's side of a forwarded call, before `InnerView` turns it into the
 * inner strategy's. `container` is absent where the hook is not handed one
 * (`canAccept`, `navigate`, a `land` with no host size), and `state` is the
 * wrapper's own: handed to `reduce`, `command` and `land`, read from the store
 * for `dispatchAffordance`, absent elsewhere.
 */
export interface ViewContext<TState> {
  items: LayoutItem[];
  options: Record<string, unknown>;
  container?: Size;
  state?: TState | undefined;
}

/**
 * How a wrapping strategy presents itself to the strategy inside it. Each
 * field carries one kind of argument from the wrapper's frame into the inner
 * strategy's; an absent field passes it through unchanged.
 */
export interface InnerView<TState, TInner> {
  /** The children the inner strategy sees. */
  items?(ctx: ViewContext<TState>): LayoutItem[];
  /** The inner strategy's config. */
  options?(options: Record<string, unknown>): Record<string, unknown>;
  /** The area the inner strategy lays out in. */
  container?(container: Size, options: Record<string, unknown>): Size;
  /** A point in the wrapper's frame, in the inner strategy's. */
  point?(point: Point, ctx: ViewContext<TState> & { container: Size }): Point;
  /** Defaults to carrying `payload.point` through `point`, deltas unchanged. */
  event?(event: LayoutEvent, ctx: ViewContext<TState> & { container: Size }): LayoutEvent;
  affordance?(affordance: Affordance, ctx: ViewContext<TState> & { container: Size }): Affordance;
  direction?(direction: Direction, options: Record<string, unknown>): Direction;
  /** Affordances the wrapper answers itself, which never reach the inner strategy. */
  owns?(affordanceId: string): boolean;
  /** Where the inner strategy's state lives in the wrapper's. Absent: they share one. */
  state?: { inner(state: TState): TInner; wrap(state: TState, inner: TInner): TState };
}

/** The hooks `forwardInner` can forward. `layout`, `initialState`, `getDropPreview` and
 *  `float` answer about the wrapper's own output, so each wrapper writes its own. */
export const FORWARDED_HOOKS = [
  'reduce',
  'dispatchAffordance',
  'command',
  'land',
  'canAccept',
  'navigate',
  'cellAt',
] as const;
export type ForwardedHook = (typeof FORWARDED_HOOKS)[number];

type Hooks<TState> = Partial<Pick<LayoutStrategy<TState, string, unknown>, ForwardedHook>>;

/**
 * Every forwardable hook `inner` has, translated through `view`, except those in
 * `withhold`. A wrapper spreads the result and overrides the hooks it answers in
 * part itself, calling the forwarded one for the rest.
 */
export function forwardInner<TState, TInner>(
  inner: LayoutStrategy<TInner, string, unknown> | undefined,
  view: InnerView<TState, TInner>,
  withhold: readonly ForwardedHook[] = [],
): Hooks<TState> {
  if (!inner) return {};
  const items = (ctx: ViewContext<TState>) => view.items?.(ctx) ?? ctx.items;
  const options = (o: Record<string, unknown>) => view.options?.(o) ?? o;
  const container = (c: Size, o: Record<string, unknown>) => view.container?.(c, o) ?? c;
  const point = (p: Point, ctx: ViewContext<TState> & { container: Size }) =>
    view.point?.(p, ctx) ?? p;
  const event = (e: LayoutEvent, ctx: ViewContext<TState> & { container: Size }) => {
    if (view.event) return view.event(e, ctx);
    const at = e.payload.point;
    return at && view.point ? { ...e, payload: { ...e.payload, point: point(at, ctx) } } : e;
  };
  const unwrap = (s: TState) => (view.state ? view.state.inner(s) : (s as unknown as TInner));
  const rewrap = (s: TState, next: TInner) => {
    if (next === unwrap(s)) return s;
    return view.state ? view.state.wrap(s, next) : (next as unknown as TState);
  };
  const owned = (id: string) => view.owns?.(id) ?? false;
  const has = (hook: ForwardedHook) => inner[hook] !== undefined && !withhold.includes(hook);

  const out: Hooks<TState> = {};
  const { reduce, dispatchAffordance, command, land, canAccept, navigate, cellAt } = inner;

  if (reduce && has('reduce')) {
    out.reduce = (state, e, context) => {
      if (owned(e.affordanceId)) return state;
      const ctx = { ...context, state };
      return rewrap(
        state,
        reduce.call(inner, unwrap(state), event(e, ctx), {
          container: container(context.container, context.options),
          options: options(context.options),
          items: items(ctx),
        }),
      );
    };
  }
  if (dispatchAffordance && has('dispatchAffordance')) {
    out.dispatchAffordance = (dctx) => {
      if (owned(dctx.event.affordanceId)) return;
      const state = dctx.store.getContainerState(dctx.parentId) as TState | undefined;
      const ctx = { items: dctx.items, options: dctx.options, container: dctx.container, state };
      dispatchAffordance.call(inner, {
        ...dctx,
        event: event(dctx.event, ctx),
        affordance: view.affordance ? view.affordance(dctx.affordance, ctx) : dctx.affordance,
        container: container(dctx.container, dctx.options),
        options: options(dctx.options),
        items: items(ctx),
      });
    };
  }
  if (command && has('command')) {
    out.command = (state, cmd, context) =>
      rewrap(
        state,
        command.call(inner, unwrap(state), cmd, {
          container: container(context.container, context.options),
          options: options(context.options),
          items: items({ ...context, state }),
        }),
      );
  }
  if (land && has('land')) {
    out.land = (lctx) => {
      const size = lctx.container ? container(lctx.container, lctx.options) : null;
      const ctx: ViewContext<TState> = {
        items: lctx.items,
        options: lctx.options,
        state: lctx.state,
        ...(lctx.container ? { container: lctx.container } : {}),
      };
      return rewrap(
        lctx.state,
        land.call(inner, {
          ...lctx,
          state: unwrap(lctx.state),
          container: size,
          options: options(lctx.options),
          items: items(ctx),
        }),
      );
    };
  }
  if (canAccept && has('canAccept')) {
    out.canAccept = (all, o) =>
      canAccept.call(inner, items({ items: all, options: o }), options(o));
  }
  if (navigate && has('navigate')) {
    out.navigate = (input) =>
      navigate.call(inner, {
        ...input,
        items: items(input),
        options: options(input.options),
        direction: view.direction?.(input.direction, input.options) ?? input.direction,
      });
  }
  if (cellAt && has('cellAt')) {
    out.cellAt = (input) =>
      cellAt.call(inner, {
        ...input,
        items: items(input),
        options: options(input.options),
        container: container(input.container, input.options),
        point: point(input.point, input),
      });
  }
  return out;
}
