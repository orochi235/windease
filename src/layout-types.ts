import type { ConfigConflict, ConfigSpec } from './layout/config-check.js';
import type { NodeId } from './node.js';
import type { Store } from './store.js';

/** A layout item's identifier. Plain `string`, not `NodeId`: strategies run
 *  over items that need not come from a store. */
export type ItemId = string;
/** Position and extent, in the container's coordinate space. Origin is the
 *  container's top-left, not the viewport's. */
export type Rect = { x: number; y: number; w: number; h: number };
/** A width/height pair with no position. */
export type Size = { w: number; h: number };

/**
 * One child as a strategy sees it: an id plus the hints, measurements and
 * placement intent needed to size it. Projected from a `Node` by
 * `nodeToLayoutItem`, but constructible by hand — strategies are pure
 * functions over these and never touch a store or the DOM.
 */
export interface LayoutItem {
  id: ItemId;
  hints?: {
    minSize?: Size;
    /** Ceiling honored by `stripStrategy` along its main axis. */
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
   * to pin a pane's main-axis extent. `stripStrategy` honors it, and its
   * gutter drag clears it. Either `Size` dimension is optional.
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

/**
 * The affordance kinds the shipped React layer knows how to render and drive.
 * `Affordance.kind` widens to `string`, so a strategy may emit its own kind
 * and supply a renderer for it.
 */
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

/**
 * Who a seam destroys when the gesture is pushed past each end of its range.
 * A strategy that omits this emits a seam that clamps and nothing more.
 *
 * `atMax` is the node destroyed by pushing toward `bounds.valueMax` (the
 * neighbor's floor breaks); `atMin` the one destroyed pushing the other way
 * (the dragged pane's own floor breaks). Either may be absent.
 */
export interface AffordanceJoin {
  atMin?: NodeId | string;
  atMax?: NodeId | string;
  /** Main-axis pixels past the clamp before the gesture arms. */
  threshold: number;
}

/**
 * An interactive region a strategy emits alongside its placements — a resize
 * edge, a gutter between panes, a click target. The strategy describes it in
 * layout coordinates and the host renders and binds it, which is what keeps
 * the core free of the DOM: `bounds` carries `orientation` / `valueNow` and an
 * adapter maps those onto `aria-*`.
 */
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
  /**
   * Present when overshooting this affordance destroys a node. The host reads
   * it through `trackJoin`; absent means the seam only ever resizes.
   */
  join?: AffordanceJoin;
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
  /**
   * Present when the drop splits `ontoId`'s slot instead of inserting a
   * sibling. `insertIndex` means nothing then — the parent's child list keeps
   * its length, because the group takes the slot `ontoId` already held.
   *
   * `config` is the prospective group's strategy config, which the host cannot
   * derive; without it the halves are off by whatever `gap` and `padding` the
   * drop will actually commit with.
   */
  split?: {
    ontoId: string;
    edge: 'start' | 'end';
    axis: 'x' | 'y';
    config?: Record<string, unknown>;
  };
}

/**
 * What a strategy returns: where each child goes, what the user can grab, and
 * what didn't fit. An item absent from `placements` is not rendered, so a
 * strategy that drops an item should also report it in `unplaced`.
 */
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

/**
 * A gesture on an affordance, fed back to the strategy through `reduce` and
 * `dispatchAffordance`. Coordinates are container-relative and deltas are
 * cumulative from the gesture's start, not per-frame.
 */
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

/**
 * The layout contract: a pure function from `{ items, container, state,
 * options }` to a `LayoutResult`, plus optional hooks for gesture handling,
 * drop acceptance and keyboard navigation. Everything beyond `name` and
 * `layout` is optional, and a strategy is free to ignore inputs it doesn't
 * understand.
 *
 * Implementations must not read or write the DOM, measure anything, or mutate
 * their inputs — measurement arrives as `LayoutItem.natural`, filled in by an
 * adapter. Register one with `StrategyRegistryProvider` and name it from
 * `container.strategyId`.
 */
export interface LayoutStrategy<TState = void, TId extends string = string, TMeta = unknown> {
  name: string;
  /**
   * The config keys this strategy understands. Declaring it turns a typo in
   * `container.config` — an unknown key, a misspelled enum value, a string
   * where a number belongs — into a `layout` trace instead of a silent
   * fallback to the default. Optional; a strategy without one is not checked.
   */
  configSpec?: ConfigSpec;
  /**
   * Config keys that conflict with each other, which `configSpec` cannot
   * express because each key is individually valid. Reported through the same
   * `layout` trace as a typo — the failure otherwise is silent, and looks like
   * the strategy ignoring a setting for no reason.
   */
  configConflicts?: readonly ConfigConflict[];
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
