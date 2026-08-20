# windease — concepts and terminology

Canonical reference for the vocabulary windease uses. Skim top-to-bottom for
the mental model; jump to a section when you hit a term you don't recognize.

## Mental model

A windease tree is made of **nodes**. A node can hold any combination of
four optional capabilities — `lifecycle`, `container`, `membership`, `focus` —
and the public API mostly cares about which ones are present. There are
no fundamentally distinct "window" and "zone" types; everything is the
same Node shape with different capabilities set.

Three combinations show up so often that windease ships **presets** for
them. These live entirely in the consumer-facing surface — the core
doesn't enforce or interpret them:

- **Zone** — `container`, no `membership`. A rootless container; the top of a
  sub-tree. Has a layout strategy that places its visible children.
- **Group** — `container` + `membership`. A widget-shaped container — occupies
  one position in a parent's layout but renders children inside its own
  region.
- **Panel** — `membership` + `focus`. A leaf renderable. Set `container` on a
  panel too and it hosts its own child tree — the "tray inside a window"
  pattern. No separate type for a recursive panel; it's just a panel that
  happens to be a container.

The two capabilities are independent axes, and it's worth reading them
separately because they answer opposite questions:

- `container` — **can I have children?** It holds `childOrder`, the canonical
  record of this node's children and their order.
- `membership` — **do I have a parent?** It holds `parentId`, my `placement`
  within that parent, and the transit FSM for moving between parents.

So a zone is not the childless one — it's the one that has children but no
parent, i.e. a **root**. The childless one is a panel. A node with both is a
group, which means *a zone with a parent is structurally just a group*; that
is the whole distinction between the two presets.

As of 1.0.0 that distinction is only a label: `createZone` takes an optional
`parentId`, and with one it produces exactly what the removed `createGroup`
produced but for `kind`. So `kind: 'zone'` no longer implies "root" —
a nested zone carries `kind: 'zone'` and styles as `.windease-zone` unless you
pass a `kind` override.

Presets ship two ways: `createPanel` / `createZone` node constructors, and the
React components `<Panel>` / `<Zone>` that supply default chrome. Both set
`node.kind` to `'panel'` / `'zone'` by default so a `ChromeMap` can dispatch
on it; pass `kind="group"` (constructor: set `.kind` after construction) for
the group shape's `.windease-group` styling.

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
| `membership` | parent reference + per-membership `placement` + transit FSM | panels, groups       |
| `focus`     | focused ↔ blurred FSM (single-focus invariant)  | panels                        |

The core does not enforce any relationship between `kind` and the
capabilities a node carries. Validation is structural only — membership's
`parentId` must reference a node with a `container`, no cycles, single
focus across the store, etc.

## Two scopes of free-form data

Two paths for free-form data on a node; lifetimes differ:

| Where                  | Lifetime                                       | Use for                                                 |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `node.meta`            | Intrinsic; survives `moveNode`                 | Window-intrinsic consumer data (title, URL, etc.)       |
| `node.membership.placement`  | Per-membership; cleared on detach              | State that exists *because of this placement* — the held pin index, placement-specific UI state |
| `node.container.config` | Container-strategy options                    | Strategy options (`cols`, `gap`, etc.)                  |
| `NodeHints`            | Layout-only soft prefs                         | `minSize`, `maxSize`, `preferredSize`, `order`          |

**Reserved keys on `membership.placement`:**

- `pinned: number` — the index this node holds in the parent's `childOrder`.
  A pinned node keeps that slot against third parties: another node's insert
  or reorder is routed around it. The pin itself yields only when the pinned
  node is the one being reordered. Not writable through `patchPlacement` /
  `setPlacement` — both throw and name `setPinned`/`unpin` instead. See
  `store.setPinned` / `unpin` / `getPinnedIndex` below, and `node.lock` for
  the separate, unrelated notion of permission.
- `size: { w?, h? }` — fixed pixel extent honored by strip / split
  along their main axis (the public "fixed-px pane" API; set via
  `store.patchPlacement`). On `split`, a gutter drag **clears** this key on
  the two affected panes, reverting them to ratio control. Pair with
  `hints.maxSize` for an "auto up to a cap" pane.

`setAllowsPinning(id, false)` opts a container out of the pin invariant
entirely (a tool strip, a tabbed group) — children can no longer hold an
index in it.

## `node.lock`

`node.lock` answers *who may operate on this node?* — the opposite question
from `pinned`, which answers *where does this node end up?* A node can be
pinned and unlocked (holds its slot, user can still drag it away), locked
and unpinned (untouchable, but free to be reordered by others), both, or
neither.

`lock` is a `LockSet` — `Partial<Record<LockAxis, boolean>>` — node-intrinsic
like `meta`, so it survives `moveNode`. Which axes apply depends on the
node's capabilities; axes a node doesn't support are dropped silently on
write, so `store.setLock(id, true)` is safe to call without checking shape
first.

| Axis      | Requires     | Guards                                                     |
| --------- | ------------ | ----------------------------------------------------------- |
| `move`    | `membership` | `moveNode` (as source), `reorderInParent`                   |
| `resize`  | `membership` | `patchPlacement`, reserved `size` key only                  |
| `destroy` | —            | `unregisterNode`                                             |
| `accept`  | `container`  | `moveNode` (as target)                                       |
| `dragOut` | `container`  | `moveNode` where the source's parent is this node             |
| `arrange` | `container`  | `setChildOrder`, `setContainerState`, `updateContainerConfig`, `setPinned`/`unpin` |

`setPinned`/`unpin` check the *parent's* `arrange`, not the child's `move`:
pinning is an arrangement of the container, and any reorder it causes is one
`arrange` already covers. Guarding it elsewhere would leave a side door around
`setChildOrder`.

A guarded call on a locked axis throws `LockedError(id, axis, op)`. Locks
constrain direct user manipulation; imperative host code that means to bypass
one passes `{ force: true }` to the mutating call, or wraps in
`store.withLocksSuspended(fn)` — the React gesture paths (drag, resize, drop)
never do either, so "the user cannot do this" holds. A preset's declarative
prop reconcile follows the same rule, but per field, not per axis:
`childOrder` and `pinned` skip under `lock.arrange` because a `move`-gated
drag writes the same `childOrder` array, and forcing a stale prop would
revert it — `arrange` itself never gates that drag; freezing drag-reordering
needs `lock.move` on the children. `container.state` skips too, for the more
direct reason that `dispatchAffordance` writes it through the same `arrange`
check. `placement.size` and node existence force instead, because their only
other writer is the gesture the very same lock already blocks (`resize`,
`destroy`). `deserialize` and `HistoryController` use `withLocksSuspended`
internally, so restoring a snapshot or undoing is never blocked by a lock.

`lock.destroy` on a child does not veto an ancestor's cascade destroy — it
only blocks `unregisterNode` called directly on that node. To protect a
subtree, lock the ancestor. It also doesn't keep a node mounted: a node
cannot outlive the JSX that owns it, so removing a locked `<Panel>` from JSX
still unregisters it on unmount.

### `acceptsDrops` vs. `lock.accept`

Easily confused, answer different questions. `acceptsDrops` (a React preset
prop) registers the element as a drop target at all. `lock.accept` rejects
drops that arrive at one that's already registered. Setting the wrong one
produces silence — the drop target exists but nothing lands, or vice versa.

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
- `reorderInParent(id, at)` — held pin slots preserved.
- `setPlacement` / `patchPlacement` — membership.placement merge-patches;
  throw if the patch contains `pinned`.
- `setMeta` — node.meta merge-patch.
- `updateContainerConfig` — strategy config merge-patch.
- `setAllowsPinning` — container policy flag; opts out of the pin invariant.
- `setLock(id, input)` / `getLock(id)` / `isLocked(id, axis)` —
  read/write `node.lock`.
- `withLocksSuspended(fn)` — runs `fn` with every lock guard bypassed.
- `setPinned(id, at?)` / `unpin(id)` / `getPinnedIndex(id)` — hold or
  release a `childOrder` index.
- `setContainerState` / `getContainerState` — persist strategy state (e.g.
  resize ratios) on the container.
- `setStrategy(id, strategyId)` — swap a container's layout strategy;
  drops the outgoing strategy's `container.state`, since it belongs to the
  strategy leaving.
- `ensureContainer(id, strategyId, config)` — give a container-less node a
  container; no-op if it already has one.
- `split(id, input)` / `unsplit(groupId)` — composite operations built on
  the primitives above. `split` wraps a node in a new strip/grid group,
  flattens new siblings into a matching-axis strip parent, or reconfigures
  a root in place, depending on the target's position; `unsplit` dissolves
  a group into its parent. See
  `docs/superpowers/specs/2026-08-19-split-operation-design.md`.
- `transact(fn, label?)` — runs `fn` as one logical change, emitting
  `transaction.begin` / `transaction.end` around it (re-entrant: only the
  outermost call emits). Bracket history pushes on that pair to get one
  undo step per composite operation. `split` and `unsplit` already run
  inside one.
- `showNode` / `hideNode` — lifecycle transitions. Hidden children are
  excluded from layout.
- `focusNode` / `blurAll` — single-focus invariant enforced.

Selectors: `getNode`, `getChildren`, `getParent`, `getAncestors`,
`isContainer`, `isMember`, `hasFocus`, `getContainerView`.

## Truth vs. published

Store-wide split, opt-in via `new Store({ throttle })`. **Truth** is
updated synchronously by every mutation — it's what `Machine.send()`
always acts on. **Published** is the projection subscribers and the React
layer actually observe; with a `throttle` policy configured it can lag
truth by up to `dwellMs`/`notifyMs`, gated by the `Publisher` (see
`src/throttle.ts`). With no policy, published *is* truth by object
identity — a hard requirement, not an optimization, so an unthrottled
`Store` pays no cost.

| Read                              | Sees       |
| ---------------------------------- | ---------- |
| `getNode(id)` / `nodes`            | published  |
| `focusedId` / `rootIds`            | published  |
| `getNodeTruth(id)` / `nodesTruth`  | truth      |
| `focusedIdTruth` / `rootIdsTruth`  | truth      |
| `getPending(id)`                   | pending    |

`serialize()` and `HistoryController` always read truth — a snapshot or an
undo entry is never the lagged value. `store.flushNow()` collapses
published up to truth immediately, bypassing every gate. Dwell gates
**observation, never truth**: only an FSM transition on a configured
machine starts or restarts a dwell, and only the whole record (not
individual fields) is held.

**Pending** is the third observable state: a node whose truth has moved
but whose published record hasn't caught up yet. `store.getPending(id)`
returns a `PendingPublish` snapshot of the current episode — `since`,
`touched`, `dwellMs`, `machine` (the machine that set that `dwellMs`, or
`null`), `bypass`, `coalesced` (internal dirty-marks folded into this
episode, not a count of store operations), and `eligibleAt` — or `null`
when nothing is withheld, which is always the case on an un-throttled
store.
`eligibleAt` is when the gate *opens*, not when the node will publish:
`notifyMs` coalescing and stagger waves can both defer the actual flush
past it. Two paired events on `store.events` mark the episode's edges:
`throttle.pending` (`{ id, since }`, fired when the entry is created,
before the dwell gate has settled — no `dwellMs`/`eligibleAt` yet) and
`throttle.published` (`{ id, heldMs, coalesced, forced }`, where `coalesced`
is again dirty-marks, not store operations). Exactly one
`throttle.published` follows each `throttle.pending` for the same id,
including a node unregistered while pending or dropped by `deserialize`
— so a consumer maintaining a `Set<NodeId>` of withheld nodes is correct
at every point, not merely balanced at the end.

Full mechanism (dwell debounce, stagger waves, `maxWaitMs` starvation cap)
is in `docs/superpowers/specs/2026-08-03-transition-throttling-design.md`;
this section is the vocabulary, not the design.

## Layout strategies

Strategies are pure functions of `{ items, container, state, options }`
returning `LayoutResult { placements, affordances, unplaced? }`. They also
expose an optional `reduce(state, event, context)` that turns affordance
drag events into new state, and an optional `canAccept(items, options)`
that the drag controller consults before accepting a drop.

`items` are `LayoutItem`s, projected from each child by `nodeToLayoutItem`.
It splits `membership.placement` two ways: the whole bag lands in `meta`, and
`size` alone is re-surfaced as the typed `placement.size`. So a strategy reads
`pinned` from `item.meta`, never from `item.placement`. Both entry points —
`runStrategyForContainer(store, parentId, viewport, strategy, state)` and the
React `useContainerLayout` — feed strategies through that adapter. The exported
`LayoutNode` shape is a separate projection (`nodeToLayoutNode`) that no
strategy receives.

**Recursion is mount-time, not strategy-time.** A strategy lays out the
children it's handed. When a child is itself a container
(`isContainer: true`), the strategy treats it as any other parented item.
The React `NodeRenderer` then mounts the child's own strategy inside the
placement rect. Built-in strategies (grid, strip, split) work
unchanged on recursive trees.

Built-ins:

- **`gridStrategy`** — `cols`, `rows`, `orientation`, `maxCols`, `maxRows`,
  `maxItems`, `gap`, `padding`. `maxItems` mutually exclusive with
  `maxCols`/`maxRows`.
- **`stripStrategy`** — main-axis stack with `axis` ('x' or 'y'), `fill`,
  `defaultItemSize`, `gap`, `padding`, `maxItems`. There is no separate
  "stack" strategy — `{ axis: 'y', fill: true }` is what stack was; strip
  covers both axes. Honors child `hints.minSize` as a pixel floor and
  `hints.maxSize` as a ceiling, plus `placement.size` for a fixed-px pane.
  `store.split(id, input)` (see Store API) builds nested strip trees —
  workspace-level splits with draggable gutters — without a dedicated
  strategy of its own.

## React layer

```tsx
<Provider store={store}>
  <StrategyRegistryProvider strategies={{ grid: gridStrategy, strip: stripStrategy }}>
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

For the convention `kind` values `'panel'` and `'zone'` (which also covers
`'group'` — pass `<Zone kind="group">`) the React layer ships preset chrome
components — `<Panel>`, `<Zone>` — that supply default styling. They're
plain wrappers; pass `className`/`style` to override, or write your own
from scratch.

Hooks: `useNode(id)`, `useNodeSelector(id, select)`, `useChildren(parentId)`,
`useFocusedNode()`, `useRootNodes()`, `useContainerLayout(parentId, ref, viewport?)`.

DnD scaffolding: `<DragProvider>`, `useDragHandle(id)`, `<DragHandle>`,
`useDropTarget(id, ref, canAccept?)`, `useDragState()`. Drop targets register
element rects; the controller's innermost-wins hit-test runs on pointermove
and calls `store.moveNode` on drop. The controller honors `lock.accept`
(target), `lock.dragOut` (source's parent), `lock.move` (source), and the
destination strategy's `canAccept`.

Pass `affordances` to `<Container>` to render the strategy's interactive
gutters; `affordanceHitPad` (default 4) widens the pointer-hit area beyond
the visual rect. Affordances are suppressed — not rendered, dispatch
refused — when the container has `lock.arrange`, or when any pane the
affordance would resize has `lock.resize`.

`<Panel>` accepts `lock` and `pinned` props, reconciled like `meta` /
`placement`. `<Zone>` accepts `lock` but not `pinned` at all — even with a
`parentId`, where `store.setPinned` would work fine — a leftover from when a
zone could never have a parent; see `TODO.md`. The generic `placement` prop
throws if given a `pinned` key on either preset; use the dedicated prop, or
`store.setPinned` directly on a parented zone.

## Events

```ts
node.registered                  | node.unregistered
node.transitioned (lifecycle/transit/focus)
node.moved                       | node.reordered
node.placementChanged (batched) | node.metaChanged (batched)
node.lockChanged                 | node.pinnedChanged
node.activityChanged
node.cascadeDestroyed
container.configChanged          | container.allowsPinningChanged
container.stateChanged
```

One bus on the store (`store.events`); DnD events fire from the controller.

## Snapshot

`serialize(store)` produces a v4 snapshot. `deserialize(snap)` accepts v2,
v3, and v4, migrating older shapes on read, and returns a fresh `Store`.
Transit state is not
serialized; hydrate always initializes to `'idle'`. Hydrate validates
bidirectional parent-child links, multi-focus, cycles.

## Errors

Class hierarchy under `WindeaseError`:

- `NodeNotFoundError` (`code: 'unknown-node'`)
- `DuplicateNodeError` (`'duplicate-id'`)
- `CapabilityMissingError` (`'capability-missing'`)
- `CycleError` (`'cycle-detected'`)
- `StrategyRejectionError` (`'strategy-rejected'`)
- `LockedError` (`'locked'`)
- `PinIndexError` (`'pin-index-out-of-range'`)
- `InvariantViolationError` (free-form `code` + `context`)

Catch on `instanceof` or `.code`, not message text.

## Tracing

`trace(category, message, data?)`. Categories: `dnd`, `history`, `layout`,
`store`, `throttle`, `workspace`, `container`. Enable per-category via
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
