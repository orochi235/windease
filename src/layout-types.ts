import type { Store } from './store.js';
import type { NodeId } from './node.js';

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
  };
  /**
   * Per-membership placement intent projected from `node.slot.placement`.
   * `size` is the public "fixed-px pane" API: set it via `store.patchPlacement`
   * to pin a pane's main-axis extent. The strip / stack / split strategies
   * honor it; split's gutter drag clears it (reverting to ratio control).
   * Either `Size` dimension is optional.
   */
  placement?: {
    size?: { w?: number; h?: number };
  };
  /**
   * Free-form per-item meta carried over from the zone's `itemMeta` map.
   * Strategies can read flags like `pinned` here; consumers set values via
   * `store.setItemMeta` / `store.patchItemMeta`.
   */
  meta?: Record<string, unknown>;
}

/**
 * shape strategies see when running over `Store` nodes.
 * Built from a Node via `nodeToLayoutItem` / `getLayoutNodes`. `placement`
 * carries the per-membership bag (pinned/locked etc.); `meta` is intrinsic.
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

export type BuiltinAffordanceKind =
  | 'drag-x'
  | 'drag-y'
  | 'drag-xy'
  | 'resize-x'
  | 'resize-y'
  | 'resize-xy'
  | 'click'
  | 'keypress';

export interface Affordance<TMeta = unknown> {
  id: string;
  kind: BuiltinAffordanceKind | string;
  rect: Rect;
  cursor?: string;
  meta?: TMeta;
  /**
   * Present on resize affordances; absent on existing gutter/drag affordances.
   * Identifies the child whose `placement.size` will be mutated when the
   * strategy's `dispatchAffordance` hook fires.
   */
  childId?: NodeId | string;
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
   * True when this result was produced in response to a `preview` input and
   * the strategy honored it. `<Container>` uses this to know whether to
   * suppress the source's real chrome (it's rendered as the ghost instead).
   */
  isPreview?: boolean;
}

export interface LayoutEvent {
  affordanceId: string;
  kind: 'drag' | 'click' | 'key';
  payload: { dx?: number; dy?: number; key?: string };
}

export interface LayoutStrategy<
  TState = void,
  TId extends string = string,
  TMeta = unknown,
> {
  name: string;
  initialState?(items: LayoutItem[]): TState;
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
