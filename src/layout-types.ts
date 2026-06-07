export type ItemId = string;
export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

export interface LayoutItem {
  id: ItemId;
  hints?: {
    minSize?: Size;
    preferredSize?: Size;
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

export type BuiltinAffordanceKind = 'drag-x' | 'drag-y' | 'drag-xy' | 'click' | 'keypress';

export interface Affordance<TMeta = unknown> {
  id: string;
  kind: BuiltinAffordanceKind | string;
  rect: Rect;
  cursor?: string;
  meta?: TMeta;
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
