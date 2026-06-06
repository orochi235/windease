# windease — concepts and terminology

Canonical reference for the vocabulary windease uses. Skim top-to-bottom for
the mental model; jump to a section when you hit a term you don't recognize.

The library is mid-flight between two generations of its API:

- **v0.2 — unified node model (recommended).** `WindeaseNodeStore` with
  three named primitives (`Panel`, `Group`, `Zone`) on top of a unified
  `Node` type. Supports recursive zones (panels hosting children).
- **v0.1 — legacy (deprecated).** `WindeaseStore` with separate `Window`
  and `Zone` records. Marked `@deprecated`; still works; ships through
  v0.2.x for backwards compatibility.

New code targets v0.2. The v0.1 sections at the end of this doc cover what
remains until the legacy surface is removed.

## v0.2 — Mental model

windease v0.2 is a **single tree of typed nodes.** One `Node` type carries
capability records (`container`, `slot`, `focus`, `lifecycle`). Three
constructors — `createZone`, `createGroup`, `createPanel` — produce nodes
with the right shape for each role.

Three structural roles (`kind`):

- **Zone** — Container, no parent. The root of a sub-tree. Has a layout
  strategy that places its visible children.
- **Group** — Container + parent slot. A widget-shaped container — occupies
  one position in a parent's layout but renders children inside its own
  region.
- **Panel** — Parent slot + focus, optional container. A leaf renderable
  unless `container` is populated, in which case it hosts its own child
  tree (recursive panel; "tray inside a window").

A node's `kind` is the only thing about it that's closed-enum. Recursion
falls out: a panel with a `container` capability is, structurally, both a
"window" and a "zone" — without two records.

## v0.2 — Identity

`NodeId = string & { __brand: 'NodeId' }`. Mint via `asNodeId(s)`. Both
`WindowId` and `ZoneId` are deprecated aliases for `NodeId`.

## v0.2 — Capabilities

Every node has `lifecycle` (the FSM is universal). Other capabilities are
optional and reflect role:

| Capability  | What it adds                                    | Present on (default)          |
| ----------- | ----------------------------------------------- | ----------------------------- |
| `lifecycle` | mount → visible ↔ hidden → destroyed FSM         | every node                    |
| `container` | hosts children with a strategy                  | zones, groups, recursive panels |
| `slot`      | parent reference + per-membership `placement` + transit FSM | panels, groups       |
| `focus`     | focused ↔ blurred FSM (single-focus invariant)  | panels                        |

The capability shape is validated against `kind` at `registerNode` and
`hydrate` time. Hand-rolling a `Node` literal whose shape doesn't match
`kind` throws `KindShapeError`.

## v0.2 — Two scopes of free-form data

Two paths for free-form data on a node; lifetimes differ:

| Where                  | Lifetime                                       | Use for                                                 |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `node.meta`            | Intrinsic; survives `moveNode`                 | Window-intrinsic consumer data (title, URL, etc.)       |
| `node.slot.placement`  | Per-membership; cleared on detach              | State that exists *because of this placement* — pin flags, slot-specific UI state |
| `node.container.config` | Container-strategy options                     | Strategy options (`cols`, `gap`, etc.)                  |
| `NodeHints`            | Layout-only soft prefs                         | `minSize`, `preferredSize`, `order`                     |

The `node.meta` vs `node.slot.placement` split replaces v0.1's
`WindowRecord.meta` vs `ZoneItemMeta` confusion. Different paths, different
words — the type system makes them non-interchangeable.

**Reserved keys on `slot.placement`:**

- `pinned: true` — promotes to the **pinned-prefix** of the parent's
  `childIds`. Strategies render the node earlier; reorder operations that
  try to put it past an unpinned sibling are silently snapped back.
- `locked: true` — implies pinned at the layout layer, AND the React layer
  refuses to start a drag from this node. Use for system chrome that owns
  its slot for the session.

`setAllowsPinning(id, false)` opts a container out of the pinned-prefix
invariant (a tool strip, a tabbed group). `locked` still suppresses drag.

## v0.2 — Store API

`WindeaseNodeStore` exposes one map (`nodes: Map<NodeId, Node>`) and
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
- `setAllowsPinning` — flip pin invariant; clears pin flags when disabled.
- `showNode` / `hideNode` — lifecycle transitions. Hidden children are
  excluded from layout.
- `focusNode` / `blurAll` — single-focus invariant enforced.

Selectors: `getNode`, `getChildren`, `getParent`, `getAncestors`,
`isContainer`, `isSlotted`, `hasFocus`, `getContainerView`.

## v0.2 — Layout strategies

Strategies remain pure functions of `{ items, container, state, options }`
returning `LayoutResult { placements, affordances, unplaced? }`. v0.2 adds
a `LayoutNode` shape with `placement` and `isContainer` fields. The
adapter `runStrategyForContainer(store, parentId, viewport, strategy, state)`
maps a v0.2 node tree onto the v0.1 strategy signature; new strategies can
target `LayoutNode` directly.

**Recursion is mount-time, not strategy-time.** A strategy lays out the
children it's handed. When a child is itself a container
(`isContainer: true`), the strategy treats it as any other slotted item.
The React `NodeRenderer` then mounts the child's own strategy inside the
placement rect. Existing built-in strategies (grid, stack, strip,
binarySplit, recursiveSplit) work unchanged on recursive trees.

Built-ins:

- **`gridStrategy`** — `cols`, `rows`, `orientation`, `maxCols`, `maxRows`,
  `maxItems`, `gap`, `padding`. `maxItems` mutually exclusive with
  `maxCols`/`maxRows`.
- **`stackStrategy`** / **`stripStrategy`** — main-axis stacks with
  `fill`, `defaultItemSize`, `axis` (strip only), `gap`, `padding`.
- **`binarySplit`** / **`recursiveSplit`** — workspace-level splits with
  draggable gutters.

## v0.2 — React layer

```tsx
<WindeaseNodeProvider store={nodeStore}>
  <StrategyRegistryProvider strategies={{ grid: gridStrategy, stack: stackStrategy }}>
    <NodeContainer
      parentId={asNodeId('z')}
      chrome={{ panel, group, zone }}
      viewport={{ w: 720, h: 480 }}
    />
  </StrategyRegistryProvider>
</WindeaseNodeProvider>
```

Chrome handlers are keyed by `kind` and receive `{ node, children }`. A
recursive panel mounts `<NodeContainer parentId={node.id} chrome={chrome} />`
inside its own template at the position it wants the tray to live.

Hooks: `useNode(id)`, `useNodeSelector(id, select)`, `useChildren(parentId)`,
`useFocusedNode()`, `useRootNodes()`, `useContainerLayout(parentId, ref, viewport?)`.

DnD scaffolding: `NodeDragProvider`, `useNodeDragHandle(id)`,
`<NodeDragHandle>`, `useNodeDropTarget(id, ref, canAccept?)`,
`useNodeDragState()`. Drop targets register element rects;
controller's innermost-wins hit-test runs on pointermove and calls
`store.moveNode` on drop.

## v0.2 — Events

```ts
node.registered                  | node.unregistered
node.transitioned (lifecycle/transit/focus)
node.moved                       | node.reordered
node.placementChanged (batched) | node.metaChanged (batched)
node.cascadeDestroyed
container.configChanged          | container.allowsPinningChanged
dnd.dragStart | dnd.hover | dnd.drop | dnd.cancel
```

One bus on the store (`store.events`); DnD events fire from the
controller.

## v0.2 — Snapshot

`serializeNodes(store)` produces a v2 snapshot.
`deserializeToNodeStore(snap)` accepts either a v1 or v2 snapshot and
returns a fresh `WindeaseNodeStore`. v1 → v2 migration runs in-process;
unowned v1 windows are dropped with a `console.warn`. Transit state is not
serialized; hydrate always initializes to `'idle'`. Hydrate validates
bidirectional parent-child links, multi-focus, cycles.

## v0.2 — Errors

Class hierarchy under `WindeaseError`:

- `NodeNotFoundError` (`code: 'unknown-node'`)
- `DuplicateNodeError` (`'duplicate-id'`)
- `KindShapeError` (`'kind-shape-mismatch'`)
- `CapabilityMissingError` (`'capability-missing'`)
- `CycleError` (`'cycle-detected'`)
- `StrategyRejectionError` (`'strategy-rejected'`)
- `InvariantViolationError` (free-form `code` + `context`)

Catch on `instanceof` or `.code`, not message text.

## v0.2 — Tracing

Same `trace(category, message, data?)` API. v0.2 added a `'container'`
category; `'zone'` is a deprecated alias kept for one minor version.
Categories: `dnd`, `history`, `layout`, `store`, `workspace`, `container`,
`zone` (deprecated).

---

## v0.1 — Legacy mental model (deprecated)

The v0.1 API remains exported for backwards compatibility through v0.2.x.
New code should target v0.2. The original mental model:

- **Window** (`WindowRecord`) — leaf renderable with lifecycle/transit/focus
  FSMs. Owned by zero or one `Zone`.
- **Zone** (`ZoneRecord`) — ordered container of windows + a layout
  strategy.
- **Workspace** — a CSS arrangement of zones in screen space.

The four-bucket data split (`WindowHints`, `WindowRecord.meta`,
`ZoneRecord.config`, `ZoneItemMeta`) maps onto v0.2 as:

- `WindowHints` → `node.hints`
- `WindowRecord.meta` → `node.meta`
- `ZoneRecord.config` → `node.container.config`
- `ZoneItemMeta` → `node.slot.placement`

v0.1 store APIs (`registerZone`, `createWindow`, `claim`, `moveWindow`,
`setItemMeta`, etc.) and React hooks (`useWindow`, `useZone`,
`useItemMeta`) carry `@deprecated` JSDoc and map onto the corresponding
v0.2 surfaces above.

## v0.1 — Drag-and-drop (deprecated)

The v0.1 `<Zone>` ships pointer-driven DnD with axis-inferred insertion
lines, rejection styling, locked-source suppression, and history
transaction integration. v0.2 ships DnD scaffolding (`NodeDragController`,
`useNodeDragHandle`, `useNodeDropTarget`) and leaves insertion-line
rendering to the consumer until parity ships in a future v0.2.x release.

## CSS surface

`@windease/react/styles.css` ships the structural rules:

- `.windease-zone` — relative + clipping + fills parent (v0.1)
- `.windease-window` — placement from `--w-x/y/w/h` custom props +
  `container-type: size` for `@container windease-window (…)` queries
- `.windease-insertion-line` — `background: currentColor` default

v0.2's `NodeContainer` uses inline absolute positioning rather than CSS
custom props; consumers style the chrome.

## History

`HistoryController<T>` is a snapshot stack with transactions. The v0.1
`<WindeaseProvider history={…}>` integrates it; drag gestures auto-begin
and auto-commit transactions. v0.2 history hookup ships in a future
release; until then consumers can snapshot manually via `serializeNodes`.
