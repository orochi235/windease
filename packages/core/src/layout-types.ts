export type ItemId = string;
export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

export interface LayoutItem {
  id: ItemId;
  hints?: {
    minSize?: Size;
    preferredSize?: Size;
  };
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
    context: { container: Size; options: Record<string, unknown> },
  ): TState;
}
