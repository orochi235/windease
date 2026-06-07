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
 * shape strategies see when running over `WindeaseStore` nodes.
 * Built from a Node via `nodeToLayoutItem` / `getLayoutNodes`. `placement`
 * carries the per-membership bag (pinned/locked etc.); `meta` is intrinsic.
 */
export interface LayoutNode {
  id: string;
  kind: 'panel' | 'group' | 'zone';
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

export interface LayoutResult<TId extends string = string, TMeta = unknown> {
  placements: Map<TId, Rect>;
  affordances: Affordance<TMeta>[];
  /**
   * Items the strategy chose not to place (e.g. grid overflow when capacity
   * is capped). Consumers may render these in an overflow tray or hide them.
   */
  unplaced?: TId[];
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
}
