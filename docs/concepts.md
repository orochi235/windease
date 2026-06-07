# windease — concepts and terminology

Canonical reference for the vocabulary windease uses. Skim top-to-bottom for
the mental model; jump to a section when you hit a term you don't recognize.

## Mental model

A windease tree is made of **nodes**. A node can hold any combination of
four optional capabilities — `lifecycle`, `container`, `slot`, `focus` —
and the public API mostly cares about which ones are present. There are
no fundamentally distinct "window" and "zone" types; everything is the
same Node shape with different capabilities set.

Three combinations show up so often that windease ships **presets** for
them. These live entirely in the consumer-facing surface — the core
doesn't enforce or interpret them:

- **Zone** — `container`, no `slot`. A rootless container; the top of a
  sub-tree. Has a layout strategy that places its visible children.
- **Group** — `container` + `slot`. A widget-shaped container — occupies
  one position in a parent's layout but renders children inside its own
  region.
- **Panel** — `slot` + `focus`. A leaf renderable. Set `container` on a
  panel too and it hosts its own child tree — the "tray inside a window"
  pattern. No separate type for a recursive panel; it's just a panel that
  happens to be a container.

Presets ship two ways: `createPanel` / `createGroup` / `createZone` node
constructors, and the React components `<Panel>` / `<Group>` / `<Zone>`
that supply default chrome. Both set `node.kind` to `'panel'` / `'group'`
/ `'zone'` as a label so a `ChromeMap` can dispatch on it.

`node.kind` is just a free-form string — the core stores it, the React
chrome map dispatches on it, nothing inside windease enforces it. Build
nodes with whatever capability shape you want; the store accepts any
internally-consistent combination.

## Identity

`NodeId = string & { __brand: 'NodeId' }`. Mint via `asNodeId(s)`.

## Capabilities

Every node has `lifecycle` (the FSM is universal). Other capabilities are
optional and reflect role:

| Capability  | What it adds                                    | Present on (default)          |
| ----------- | ----------------------------------------------- | ----------------------------- |
| `lifecycle` | mount → visible ↔ hidden → destroyed FSM         | every node                    |
| `container` | hosts children with a strategy                  | zones, groups, recursive panels |
| `slot`      | parent reference + per-membership `placement` + transit FSM | panels, groups       |
| `focus`     | focused ↔ blurred FSM (single-focus invariant)  | panels                        |

The core does not enforce any relationship between `kind` and the
capabilities a node carries. Validation is structural only — slot's
`parentId` must reference a node with a `container`, no cycles, single
focus across the store, etc.

## Two scopes of free-form data

Two paths for free-form data on a node; lifetimes differ:

| Where                  | Lifetime                                       | Use for                                                 |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `node.meta`            | Intrinsic; survives `moveNode`                 | Window-intrinsic consumer data (title, URL, etc.)       |
| `node.slot.placement`  | Per-membership; cleared on detach              | State that exists *because of this placement* — pin flags, slot-specific UI state |
| `node.container.config` | Container-strategy options                    | Strategy options (`cols`, `gap`, etc.)                  |
| `NodeHints`            | Layout-only soft prefs                         | `minSize`, `preferredSize`, `order`                     |

**Reserved keys on `slot.placement`:**

- `pinned: true` — promotes to the **pinned-prefix** of the parent's
  `childIds`. Strategies render the node earlier; reorder operations that
  try to put it past an unpinned sibling are silently snapped back.
- `locked: true` — implies pinned at the layout layer, AND the React layer
  refuses to start a drag from this node. Use for system chrome that owns
  its slot for the session.

`setAllowsPinning(id, false)` opts a container out of the pinned-prefix
invariant (a tool strip, a tabbed group). `locked` still suppresses drag.

## Store API

`Store` exposes one map (`nodes: Map<NodeId, Node>`) and
record-replacement mutations — every change produces a fresh `Node`
reference so React's `useSyncExternalStore` invalidates correctly. Key
methods:

- `registerNode(node)` / `unregisterNode(id)` — cascade-destroys
  descendants depth-first.
- `moveNode(id, newParentId, at?)` — atomic transit
  `idle → releasing → claiming → idle`. Throws `CycleError` on a move into
  the node's own descendant.
- `reorderInParent(id, at)` — pinned-prefix preserved.
- `setPlacement` / `patchPlacement` — slot.placement merge-patches.
- `setMeta` — node.meta merge-patch.
- `updateContainerConfig` — strategy config merge-patch.
- `setAllowsPinning` / `setAllowsDrop` / `setAllowsDragOut` — container
  policy flags.
- `setContainerState` / `getContainerState` — persist strategy state (e.g.
  resize ratios) on the container.
- `showNode` / `hideNode` — lifecycle transitions. Hidden children are
  excluded from layout.
- `focusNode` / `blurAll` — single-focus invariant enforced.

Selectors: `getNode`, `getChildren`, `getParent`, `getAncestors`,
`isContainer`, `isSlotted`, `hasFocus`, `getContainerView`.

## Layout strategies

Strategies are pure functions of `{ items, container, state, options }`
returning `LayoutResult { placements, affordances, unplaced? }`. They also
expose an optional `reduce(state, event, context)` that turns affordance
drag events into new state, and an optional `canAccept(items, options)`
that the drag controller consults before accepting a drop.

A `LayoutNode` shape (with `placement` and `isContainer` fields) projects
each child for the strategy. The adapter
`runStrategyForContainer(store, parentId, viewport, strategy, state)` maps
a node tree onto the strategy signature.

**Recursion is mount-time, not strategy-time.** A strategy lays out the
children it's handed. When a child is itself a container
(`isContainer: true`), the strategy treats it as any other slotted item.
The React `NodeRenderer` then mounts the child's own strategy inside the
placement rect. Built-in strategies (grid, stack, strip, split) work
unchanged on recursive trees.

Built-ins:

- **`gridStrategy`** — `cols`, `rows`, `orientation`, `maxCols`, `maxRows`,
  `maxItems`, `gap`, `padding`. `maxItems` mutually exclusive with
  `maxCols`/`maxRows`.
- **`stackStrategy`** / **`stripStrategy`** — main-axis stacks with
  `fill`, `defaultItemSize`, `axis` (strip only), `gap`, `padding`.
- **`splitStrategy`** — workspace-level splits with draggable gutters.
  Default behavior accepts any N≥2 items; pass `recursive: false` in
  config to require exactly 2 items. Honors child `hints.minSize` as a
  pixel floor.

## React layer

```tsx
<Provider store={store}>
  <StrategyRegistryProvider strategies={{ grid: gridStrategy, stack: stackStrategy }}>
    <Container
      parentId={asNodeId('z')}
      chrome={{ panel: panelHandler, zone: zoneHandler }}
      viewport={{ w: 720, h: 480 }}
    />
  </StrategyRegistryProvider>
</Provider>
```

`chrome` is either a `Record<string, ChromeHandler>` keyed by
`node.kind`, or a single `(args) => ReactNode` function. Handlers
receive `{ node, children }`. A recursive panel mounts
`<Container parentId={node.id} chrome={chrome} />` inside its own
template at the position it wants the tray to live.

For the convention `kind` values `'panel'`, `'group'`, `'zone'` the
React layer ships preset chrome components — `<Panel>`, `<Group>`,
`<Zone>` — that supply default styling. They're plain wrappers; pass
`className`/`style` to override, or write your own from scratch.

Hooks: `useNode(id)`, `useNodeSelector(id, select)`, `useChildren(parentId)`,
`useFocusedNode()`, `useRootNodes()`, `useContainerLayout(parentId, ref, viewport?)`.

DnD scaffolding: `<DragProvider>`, `useDragHandle(id)`, `<DragHandle>`,
`useDropTarget(id, ref, canAccept?)`, `useDragState()`. Drop targets register
element rects; the controller's innermost-wins hit-test runs on pointermove
and calls `store.moveNode` on drop. The controller honors:
`container.allowsDrop`, `container.allowsDragOut`, `slot.placement.locked`,
and the destination strategy's `canAccept`.

Pass `affordances` to `<Container>` to render the strategy's
interactive gutters; `affordanceHitPad` (default 4) widens the pointer-hit
area beyond the visual rect.

## Events

```ts
node.registered                  | node.unregistered
node.transitioned (lifecycle/transit/focus)
node.moved                       | node.reordered
node.placementChanged (batched) | node.metaChanged (batched)
node.activityChanged
node.cascadeDestroyed
container.configChanged          | container.allowsPinningChanged
container.allowsDropChanged      | container.allowsDragOutChanged
container.stateChanged
```

One bus on the store (`store.events`); DnD events fire from the controller.

## Snapshot

`serialize(store)` produces a v2 snapshot. `deserialize(snap)` validates the
version and returns a fresh `Store`. Transit state is not
serialized; hydrate always initializes to `'idle'`. Hydrate validates
bidirectional parent-child links, multi-focus, cycles.

## Errors

Class hierarchy under `WindeaseError`:

- `NodeNotFoundError` (`code: 'unknown-node'`)
- `DuplicateNodeError` (`'duplicate-id'`)
- `CapabilityMissingError` (`'capability-missing'`)
- `CycleError` (`'cycle-detected'`)
- `StrategyRejectionError` (`'strategy-rejected'`)
- `InvariantViolationError` (free-form `code` + `context`)

Catch on `instanceof` or `.code`, not message text.

## Tracing

`trace(category, message, data?)`. Categories: `dnd`, `history`, `layout`,
`store`, `workspace`, `container`. Enable per-category via
`WINDEASE_TRACE=dnd,history npm test` or `configureTrace('*')`.

## CSS surface

`windease/styles.css` ships the structural rules consumers depend on:

- `.windease-zone` — relative + clipping + fills parent.
- `.windease-window` — placement from `--w-x/y/w/h` custom props +
  `container-type: size` for `@container windease-window (…)` queries.
- `.windease-insertion-line` — `background: currentColor` default.

`Container` uses inline absolute positioning; consumer chrome supplies
the rest of the visual styling.

## History

`HistoryController<T>` is a snapshot stack with transactions. Wire it
externally: snapshot → push on mutations you want to track, hydrate the
returned snapshot on undo. Container state (resize ratios, split trees) is
captured by `serialize` but conventionally excluded from the history path
— resize gestures shouldn't pollute the undo timeline.
