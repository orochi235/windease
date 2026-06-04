# windease workspace partitioning — design spec

**Date:** 2026-06-04
**Status:** approved for implementation planning
**Targets:** `@windease/core@0.2.0`, `@windease/react@0.2.0` (breaking)

## Purpose

v0.1 ships zones and windows but has no opinion about how multiple zones are
arranged in the viewport. The Ladle Playground used raw CSS Grid to arrange
its three zones. This spec adds a `<Workspace>` React component and a
generalized `LayoutStrategy` interface so consumers can declare multi-zone
layouts — including draggable splits — without writing custom CSS.

The work also unifies the existing zone-internal layout abstraction
(`gridStrategy` / `stackStrategy` / `stripStrategy`) with the new
workspace-level one under a single strategy interface. That's a breaking
change to `@windease/core`; v0.2 absorbs it.

## Scope

In scope:

- A unified `LayoutStrategy` interface that handles both zone-internal layout
  (windows within a zone) and workspace-level layout (zones within the
  viewport).
- Strategies emit two things: `placements` (per-item rectangles) and
  `affordances` (interactive elements like draggable gutters).
- A `<Workspace>` React component that hosts a strategy, runs it, renders
  affordances, and folds user gestures back into strategy state via a pure
  `reduce` method.
- Two built-in workspace strategies: `binarySplit` (one draggable split,
  two children) and `recursiveSplit` (arbitrary tree of nested splits).
- Migration of the three existing zone strategies to the new interface.
- Built-in affordance kinds: `drag-x`, `drag-y`, `drag-xy`, `click`,
  `keypress`. Consumers can register custom kinds.

Out of scope (deferred to TODO):

- Named workspace templates (`'main-sidebar-dock'` etc.) — sugar over
  `recursiveSplit`'s initial state.
- Per-window resize handles inside a zone (the interface supports it; no
  zone strategy emits them yet).
- Cross-zone gutter coordination beyond what naturally happens when a zone's
  viewport changes.
- Persistence — `<Workspace>` exposes state via callback; consumer chooses
  storage. Consistent with the v0.1 stance.

## Decisions

1. **Unified strategy interface.** One `LayoutStrategy<TState, TId, TMeta>`
   type handles both layers. Zone strategies use `TState = void` and emit
   `affordances: []`. Workspace strategies carry state (split ratios, trees)
   and emit affordances.
2. **Affordances are first-class.** Strategies emit them alongside
   placements. They describe interactive elements declaratively — kind,
   rect, cursor, opaque meta. The strategy never holds React state setters
   or closures; the renderer wires events.
3. **Workspace dispatches via `reduce`.** `<Workspace>` translates pointer
   gestures and clicks into typed `LayoutEvent`s, dispatches them to
   `strategy.reduce(state, event)`, and uses the returned state on next
   render. Pure-function strategy, React state-of-the-truth in `<Workspace>`.
4. **Drag math owned by the strategy.** `<Workspace>` provides raw pixel
   deltas; the strategy translates pixels to its own units (ratios, etc.).
   Affordance `meta` may carry a `pixelsPerUnit` so the reduce stays a pure
   function with no external dependency on container size.
5. **Persistence via callback.** `<Workspace>` exposes `onStateChange`;
   state is plain JSON-serializable data; `initialState` reseeds it. The
   core store is unaware of workspace state.
6. **Breaking change to core.** The existing `LayoutStrategy` is reshaped.
   Zone strategies migrate. No external consumers yet, so no compatibility
   shim.

## Unified `LayoutStrategy` interface

```ts
type ItemId = string;
type Rect = { x: number; y: number; w: number; h: number };
type Size = { w: number; h: number };

interface LayoutItem {
  id: ItemId;
  hints?: { minSize?: Size; preferredSize?: Size };
}

type BuiltinAffordanceKind = 'drag-x' | 'drag-y' | 'drag-xy' | 'click' | 'keypress';

interface Affordance<TMeta = unknown> {
  id: string;
  kind: BuiltinAffordanceKind | string;   // custom kinds widen the union
  rect: Rect;
  cursor?: string;
  meta?: TMeta;
}

interface LayoutResult<TId extends string = string, TMeta = unknown> {
  placements: Map<TId, Rect>;
  affordances: Affordance<TMeta>[];
}

interface LayoutEvent {
  affordanceId: string;
  kind: 'drag' | 'click' | 'key';
  payload: { dx?: number; dy?: number; key?: string };
}

interface LayoutStrategy<
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
  reduce?(state: TState, event: LayoutEvent): TState;
}
```

Stateless strategies (the current zone trio) omit `initialState` and
`reduce`, ignore `state` in `layout`, and emit `affordances: []`.

## `<Workspace>` component

```tsx
interface WorkspaceProps<TState, TMeta> {
  strategy: LayoutStrategy<TState, ItemId, TMeta>;
  items: LayoutItem[];
  options?: Record<string, unknown>;
  initialState?: TState;
  onStateChange?(state: TState): void;
  children: (item: LayoutItem, placement: Rect) => ReactNode;
  affordanceRenderers?: Record<
    string,
    (affordance: Affordance<TMeta>, dispatch: (event: LayoutEvent) => void) => ReactNode
  >;
}

function Workspace<TState, TMeta>(props: WorkspaceProps<TState, TMeta>): JSX.Element;
```

Behavior:

- Holds `state` and `containerSize` in React state. Seeds state from
  `props.initialState ?? strategy.initialState(items)`. If the strategy
  declares neither and `initialState` is omitted, throws a clear error.
- Measures its root via `ResizeObserver`. First render before measurement
  yields an empty container; nothing renders. Same posture as `<Zone>`.
- Each render: runs `strategy.layout({ items, container, state, options })`.
- Renders one wrapper per item with CSS custom properties
  (`--w-x`/`--w-y`/`--w-w`/`--w-h`) and a `windease-workspace-item` class.
  Calls `props.children(item, rect)` for content. Same custom-property
  convention as `<Zone>`; consumer CSS positions via `var(--w-x)` etc.
- Renders affordances:
  - **Built-in kinds.** `drag-x` / `drag-y` / `drag-xy` get a
    `windease-affordance` wrapper with pointer-down handler that uses
    `setPointerCapture` and dispatches `{ kind: 'drag', payload: { dx, dy } }`
    per pointermove. `click` dispatches `{ kind: 'click' }`. `keypress`
    renders with `tabIndex={0}` and dispatches `{ kind: 'key', payload: { key } }`.
  - **Custom kinds.** Resolved via `affordanceRenderers[kind]`. Throws if
    neither built-in nor renderer is found.
- After dispatching: state ← `strategy.reduce(state, event)`; re-renders;
  calls `onStateChange(newState)` if provided.

## Built-in strategies

### `binarySplit`

```ts
interface BinarySplitState { ratio: number; }
interface BinarySplitOptions {
  direction: 'horizontal' | 'vertical';
  gutterSize?: number;   // default 4
  minRatio?: number;     // default 0.05
  maxRatio?: number;     // default 0.95
}
interface BinarySplitMeta {
  pixelsPerUnit: number;   // 1 / (containerSize on relevant axis)
}
```

Throws `WindeaseError('WRONG_ITEM_COUNT', ...)` if `items.length !== 2`. Emits one
drag affordance at the gutter (`drag-x` for horizontal, `drag-y` for
vertical). `reduce` adds `delta * pixelsPerUnit` to `ratio` and clamps to
`[minRatio, maxRatio]`.

### `recursiveSplit`

```ts
type SplitNode =
  | { kind: 'leaf'; id: ItemId }
  | {
      kind: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      a: SplitNode;
      b: SplitNode;
    };
interface RecursiveSplitOptions {
  gutterSize?: number;
  minRatio?: number;
  maxRatio?: number;
}
interface RecursiveSplitMeta {
  path: number[];          // walk to the targeted split
  pixelsPerUnit: number;
}
```

`initialState(items)` produces an equal-ratio right-leaning tree (for
`[a, b, c]`: split-h(0.5, a, split-h(0.5, b, c))). `layout` walks the tree:
each leaf becomes a placement; each internal split becomes a drag
affordance. `reduce` walks to the targeted split by `path` and updates its
ratio (clamped).

If a leaf references an `id` not in `items`, `layout` drops it and warns
once per `id` per session. Same softness as `<Zone>`'s missing-placement
behavior. Items not represented in the tree are not placed.

## Migration of zone strategies

`gridStrategy`, `stackStrategy`, `stripStrategy` move to the new shape:

```ts
const gridStrategy: LayoutStrategy<void, WindowId> = {
  name: 'grid',
  layout({ items, container, options }) {
    return {
      placements: new Map<WindowId, Rect>(...),
      affordances: [],
    };
  },
};
```

`<Zone>` adapts: maps `zone.windowIds` + `store.getWindow(id).hints` →
`LayoutItem[]`; passes `container = viewport`, `options = zone.config`,
`state = undefined`. Reads `result.placements`; ignores `result.affordances`
for now (the interface lets a future zone strategy emit them).

`ZoneRecord.strategy` typing widens to `LayoutStrategy` with default
generics. `zone.config: Record<string, unknown>` stays — passed as
`options` at the boundary.

## Error handling

- Extend the existing `WindeaseError` code union with `'WRONG_ITEM_COUNT'`, `'UNKNOWN_AFFORDANCE_KIND'`, `'NO_INITIAL_STATE'`. No new error class; consistent with v0.1.
- Programmer errors (item count mismatch, unknown affordance with no
  renderer, missing initial state with no `initialState` factory) throw.
- Soft errors (orphan leaves, missing placements) `console.warn` once per
  identity per session — same module-level `warned` Set pattern as `<Zone>`.

## Testing

- **Strategy unit tests** (Vitest):
  - `binarySplit`: layout produces correct rects + one drag affordance;
    reduce updates ratio with clamping; wrong item count throws.
  - `recursiveSplit`: layout for several tree shapes; reduce hits the right
    split via path; orphan leaves drop with a warning; new items appear
    unplaced.
- **`<Workspace>` tests** (jsdom):
  - Renders placements at correct CSS custom properties.
  - Pointer drag dispatches `{ dx, dy }` events; state updates;
    `onStateChange` fires.
  - Custom affordance renderer is invoked for unknown kinds; throws when
    neither built-in nor renderer matches.
  - Initial state derived from `strategy.initialState` when not supplied.
- **Ladle stories**:
  - `BinarySplit.stories.tsx` — one draggable gutter.
  - `RecursiveSplit.stories.tsx` — the four-pane layout from the mockup,
    drag any gutter, snapshot/hydrate buttons (consumer-side persistence
    demo).
  - Update existing `Playground.stories.tsx` to use `<Workspace>` instead
    of the hand-written CSS Grid, so it doubles as integration coverage.

## Tooling

- Same npm workspaces / TS / Vitest / Biome / Ladle stack. No new runtime
  deps.
- `@windease/core@0.2.0`: breaking change (new strategy interface). Bump
  version, write CHANGELOG note.
- `@windease/react@0.2.0`: gains `<Workspace>`. No other breaking surface.

## TODO followups spawned by this work

- Named workspace templates (`'main-sidebar-dock'` etc.) as sugar over
  `recursiveSplit.initialState`.
- Per-window resize within a zone (zone strategy emits drag affordances at
  window edges; `<Zone>` learns to render affordances same way `<Workspace>`
  does).
- Workspace-level keyboard verbs (`splitGrow`, `splitShrink`, focus
  traversal) as a strategy-agnostic layer on top of `keypress` affordances.

## Open questions

None blocking. Reassess at plan time:

- Should `LayoutItem.hints` grow a `weight` field for proportional sizing?
  Currently `recursiveSplit` distributes equally; consumers wanting weighted
  initial splits supply their own `initialState`.
