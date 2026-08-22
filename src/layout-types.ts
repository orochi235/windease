import type { NodeId } from './node.js';
import type { Store } from './store.js';

export type ItemId = string;
export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

export interface LayoutItem {
  id: ItemId;
  hints?: {
    minSize?: Size;
    /** Ceiling honored by the strip / stack / split strategies along their
     *  main axis (and by split's ratio/explicit clamping). */
    maxSize?: Size;
    preferredSize?: Size;
    /** Per-axis request to be sized by measured content. See `NodeHints`. */
    sizing?: { w?: 'content'; h?: 'content' };
  };
  /**
   * Measured content extent, supplied by whatever adapter can measure. Present
   * only for items whose `hints.sizing` asked for it and only once a
   * measurement exists, so a strategy must still fall back when it is absent —
   * the first layout pass always runs without it.
   *
   * An input, never a call: the core does not measure, and a headless caller
   * that supplies nothing gets the pre-existing behavior.
   */
  natural?: Size;
  /**
   * Per-membership placement intent projected from `node.membership.placement`.
   * `size` is the public "fixed-px pane" API: set it via `store.patchPlacement`
   * to pin a pane's main-axis extent. The strip / stack / split strategies
   * honor it; split's gutter drag clears it (reverting to ratio control).
   * Either `Size` dimension is optional.
   *
   * `span` is grid's cell-count analog of `size` — `cols`/`rows` are counts,
   * not pixels. Only `gridStrategy` reads it.
   */
  placement?: {
    size?: { w?: number; h?: number };
    span?: { cols?: number; rows?: number };
  };
  /**
   * The node's whole `membership.placement` bag, projected by
   * `nodeToLayoutItem`. Strategies read flags like `pinned` here rather than
   * from `placement`, which surfaces only the typed `size` key.
   */
  meta?: Record<string, unknown>;
}

/**
 * shape strategies see when running over `Store` nodes.
 * Built from a Node via `nodeToLayoutItem` / `getLayoutNodes`. `placement`
 * carries the per-membership bag (`pinned` etc.); `meta` is intrinsic.
 */
export interface LayoutNode {
  id: string;
  /** Free-form role label echoed from `node.kind` (optional). */
  kind?: string;
  hints: {
    minSize?: Size;
    preferredSize?: Size;
    order?: number;
  };
  meta: Record<string, unknown>;
  placement: Record<string, unknown>;
  isContainer: boolean;
  activity: Record<string, unknown>;
}

/** Strategies by `container.strategyId`. Lives here rather than in the React
 *  layer because `ContainerHost` resolves strategies with no binding present. */
export type StrategyRegistry = ReadonlyMap<string, LayoutStrategy<unknown, string, unknown>>;

export type BuiltinAffordanceKind =
  | 'drag-x'
  | 'drag-y'
  | 'drag-xy'
  | 'resize-x'
  | 'resize-y'
  | 'resize-xy'
  | 'click'
  /** @deprecated Never emitted or dispatched. Keyboard resize is a synthesized
   *  drag in the DOM adapter; see docs/superpowers/specs/2026-08-21-keyboard-navigation-design.md.
   *  Removed at 2.0.0. */
  | 'keypress';

export interface Affordance<TMeta = unknown> {
  id: string;
  kind: BuiltinAffordanceKind | string;
  rect: Rect;
  cursor?: string;
  meta?: TMeta;
  /**
   * The single child whose stored `placement.size` this affordance mutates
   * via `dispatchAffordance`. Present only on single-child resize
   * affordances (strip/stack); gutters have no one child to name.
   */
  childId?: NodeId | string;
  /**
   * Every id whose rendered rect changes when this affordance is dragged.
   * Populated on gutters (all leaves on both sides) and on single-child
   * resize affordances (`[childId]`), so the React layer can suppress a
   * drag when any affected pane is resize-locked without branching on kind.
   */
  affects?: (NodeId | string)[];
  /**
   * The extent this affordance adjusts, and the range it can actually reach.
   *
   * Emitted by the strategy because only the strategy knows the *effective*
   * bounds: a child's own `maxSize` is not the ceiling when siblings' minimums
   * already claim the remaining extent. A host re-deriving this would be
   * recomputing what the layout pass just computed, and would advertise a
   * maximum the drag refuses to reach.
   *
   * Named for what it is rather than for the DOM: a DOM adapter maps these
   * onto `aria-valuenow` / `aria-valuemin` / `aria-valuemax` /
   * `aria-orientation`, and a non-DOM host reads them directly.
   *
   * `valueMin` is never above `valueNow`, so the range always contains the
   * current value — a pane deliberately sized under its own `minSize` (a
   * collapsed palette) reports its own extent as the floor rather than an
   * unreachable one.
   */
  bounds?: {
    orientation: 'horizontal' | 'vertical';
    valueNow: number;
    valueMin: number;
    valueMax: number;
    /** Set by the code that performed the clamp, not derived by comparing
     *  `valueNow` to the bounds — float equality is not a reliable test. */
    atMin: boolean;
    atMax: boolean;
    /**
     * How far one keyboard press should move this affordance, in the same
     * units as `valueNow`. Absent means the host picks (`<Container>` uses
     * `affordanceKeyStep`). A strategy whose units are not pixels sets it, so
     * one press is one meaningful increment rather than 8 of something.
     */
    step?: number;
  };
}

/**
 * Optional "preview" hint passed into `LayoutStrategy.layout()` when the host
 * (e.g. `<Container>`) is showing a live drop preview. The strategy should lay
 * out as if `insertId` were inserted at the cursor (or at `insertIndex` when
 * the host knows the prospective slot). Cursor is in container-relative coords.
 *
 * Strategies that ignore this field still work — the preview just falls back
 * to the real layout.
 */
export interface LayoutPreview {
  insertId: string;
  insertIndex?: number;
  cursor: { x: number; y: number };
}

export interface LayoutResult<TId extends string = string, TMeta = unknown> {
  placements: Map<TId, Rect>;
  affordances: Affordance<TMeta>[];
  /**
   * Items the strategy chose not to place (e.g. grid overflow when capacity
   * is capped). Consumers may render these in an overflow tray or hide them.
   */
  unplaced?: TId[];
  /**
   * How far the placed content exceeds the container, per axis; absent when it
   * fits. A strategy sets this instead of shrinking children past what their
   * constraints allow, so a host can scroll, clip, or resize deliberately
   * rather than discovering the crush visually.
   *
   * Distinct from `unplaced`, which is capacity by *count*. A row can overflow
   * with everything placed.
   */
  overflow?: { w: number; h: number };
  /**
   * True when this result was produced in response to a `preview` input and
   * the strategy honored it. `<Container>` uses this to know whether to
   * suppress the source's real chrome (it's rendered as the ghost instead).
   */
  isPreview?: boolean;
}

export interface LayoutEvent {
  affordanceId: string;
  /**
   * `'key'` is never constructed or handled — an arrow key reaches a strategy
   * as a synthesized `'drag'`, so it goes through the same write-path clamp as
   * a pointer drag. Deprecated rather than removed because this union has no
   * `| string` escape; removed at 2.0.0.
   */
  kind: 'drag' | 'click' | 'key';
  /**
   * `point` is the pointer in container-relative coordinates, present only on
   * a pointer drag. A strategy whose extents are continuous can work from
   * `dx`/`dy` alone; one whose extents are quantized cannot — a few pixels
   * rounds to no change every time, so the drag never accumulates. Those read
   * `point` and resolve against it, which is also self-correcting rather than
   * drift-prone.
   */
  payload: { dx?: number; dy?: number; key?: string; point?: { x: number; y: number } };
}

/**
 * A `LayoutStrategy` that seeds its own state, with `initialState` required
 * rather than optional. Declare a stateful strategy as this and
 * `strategy.initialState(items)` types as `TState`, so its result can be
 * handed straight to `layout({ state })` without narrowing. `LayoutStrategy`
 * keeps the optional signature because a host reading one out of a
 * `StrategyRegistry` cannot know whether it seeds.
 */
export type StatefulLayoutStrategy<
  TState,
  TId extends string = string,
  TMeta = unknown,
> = LayoutStrategy<TState, TId, TMeta> & {
  initialState(items: LayoutItem[], options?: Record<string, unknown>): TState;
};

export interface LayoutStrategy<TState = void, TId extends string = string, TMeta = unknown> {
  name: string;
  /** Seed state for a container that has none persisted yet. `options` is the
   *  container's strategy config, so the seed can honor it. */
  initialState?(items: LayoutItem[], options?: Record<string, unknown>): TState;
  layout(input: {
    items: LayoutItem[];
    container: Size;
    state: TState;
    options: Record<string, unknown>;
    /**
     * When set, the strategy should lay out as if `preview.insertId` were
     * inserted at `preview.insertIndex` (or at the cursor when index is
     * undefined). The strategy MAY ignore this and return the regular
     * layout — the host falls back gracefully. When honored, set
     * `result.isPreview = true`.
     */
    preview?: LayoutPreview;
  }): LayoutResult<TId, TMeta>;
  reduce?(
    state: TState,
    event: LayoutEvent,
    context: { container: Size; options: Record<string, unknown>; items: LayoutItem[] },
  ): TState;
  /**
   * Optional store-mutating dispatch path for affordances that change
   * per-child placement (e.g. resize edges) rather than container state.
   * Called by the React layer's `useContainerLayout` BEFORE `reduce`, so
   * the strategy can choose to handle a given affordance here, in `reduce`,
   * or in both.
   */
  dispatchAffordance?(ctx: {
    event: LayoutEvent;
    affordance: Affordance<TMeta>;
    store: Store;
    parentId: NodeId;
    container: Size;
    options: Record<string, unknown>;
    items: LayoutItem[];
  }): void;
  /**
   * Optional hook used by DnD to reject drops the strategy can't lay out.
   * Receives the prospective post-drop items list. Return false to reject.
   * Strategies that don't implement it are treated as accept-all.
   */
  canAccept?(items: LayoutItem[], options: Record<string, unknown>): boolean;
  /**
   * Optional override for directional keyboard navigation within this
   * container. Return an item id to win, `undefined` to fall through to
   * geometric resolution, or `null` to declare the direction dead here.
   */
  navigate?(input: {
    items: LayoutItem[];
    from: TId;
    direction: 'left' | 'right' | 'up' | 'down';
    options: Record<string, unknown>;
  }): TId | null | undefined;
  /**
   * Optional fast-path preview. When defined and returns non-null, the host
   * uses this instead of calling `.layout({ preview })`. Useful when preview
   * placements are cheap to compute directly (e.g. grid cells given an index).
   * Return null to delegate to the canonical `.layout()` path.
   */
  getDropPreview?(input: {
    items: LayoutItem[];
    container: Size;
    options: Record<string, unknown>;
    insertId: TId;
    insertIndex: number | undefined;
    cursor: { x: number; y: number };
  }): { placements: Map<TId, Rect>; accepted: boolean } | null;
}
