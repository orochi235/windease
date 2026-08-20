# TODO

Future work, sectioned by item. Append new ideas here rather than scattering
them. Tag major items with `[HIGH]`.

## Test-harness gaps

- **An `expect` inside a `store.events` handler can never fail a test.**
  `TypedEmitter.emit` catches and logs listener throws
  (`src/events.ts:22-25`), so a failing assertion there prints
  `[windease] event listener threw` and the test still passes. Use
  `recordEvents` (`src/test-utils/record-events.ts`) and assert after the
  mutation returns. The one live instance has been fixed; nothing
  prevents a new one, so this stays on the list as a review item.

## Shipped in 0.8.0

- **Throttle introspection.** `store.getPending(id)` returns a
  `PendingPublish` snapshot of what is currently being withheld for that
  node, or `null` when nothing is. The paired `throttle.pending` /
  `throttle.published` events fire once each per withholding episode,
  which is what lets a consumer maintain a leak-free set of
  currently-withheld node ids. Payload types are exported from the entry
  point. The `Throttling` Ladle stories are driven off these rather than
  off log diffing.

  This was written against 0.7.0 but missed the 0.7.0 publish — see the
  note under that heading.

## Shipped in 0.7.0

- **Optional transition throttling.** `new Store({ throttle })` opts into
  three mechanisms over one flush pipeline: `notifyMs` time-window
  coalescing, per-machine `dwell` (a debounce with a `maxWaitMs`
  starvation cap), and `stagger` waves for mass transitions. Gates
  observation only — `getNode()` returns the published view while
  `getNodeTruth()` / `nodesTruth` / `rootIdsTruth` / `focusedIdTruth`
  return truth, so snapshot and history are unaffected. Identity-equal
  passthrough when the option is omitted. `store.flushNow()` collapses
  pending latency. Traced under the `throttle` category. Demoed by the
  `Throttling` Ladle stories.
- **`deserialize(store, snap)` overload.** Hydrates into an existing store
  rather than returning a new one, preserving its throttle policy and its
  subscribers — which is what makes undo work on a bound React tree. The
  single-arg form is unchanged and still returns a fresh store built with
  default options. Note the in-place form emits `node.unregistered` /
  `node.cascadeDestroyed` as it clears the target.

**Note on what 0.7.0 actually contains.** It was published from
`8c27511` (the PR #1 merge), not from the `chore: 0.7.0` bump commit that
named it, so the registry tarball is that merge's tree. It has the
throttling core and the `deserialize` overload above; it does **not**
have `getPending` or the throttle events, which landed afterwards and are
released in 0.8.0. `v0.7.0` and `v0.4.0` were tagged retroactively —
`v0.7.0` at the commit the registry timestamp points to, `v0.4.0` at its
bump commit (0.4.0 was never published to npm at all). The
tag/version guard in `.github/workflows/release.yml` exists so this
cannot recur.

## Shipped in 0.5.0

- **Resizable children.** `placement.size?: { w?, h? }` reserved key is
  honored by `stack` / `strip` / `split` strategies; `hints.maxSize` is
  a new clamp ceiling alongside `hints.minSize`. Non-last children in
  stack/strip get trailing-edge resize affordances; split gutters now
  clear `placement.size` on both panes before applying the ratio change.
  Grid still ignores explicit sizes (multi-cell spans deferred). Snapshot
  round-trips without a schema change.

## Shipped in 0.4.0

- **Declarative JSX tree binding.** `<Zone>` / `<Group>` / `<Panel>`
  presets register themselves with the store on mount, unregister on
  unmount, and reconcile sibling order from JSX child order each render.
  Imperative and declarative ids coexist under the same parent.
  `<Provider>` auto-creates a Store when none is provided. Public
  surface: `ParentContext` / `ParentScope` / `useParentId`,
  `LayoutContext` family, `defaultChildSort`, and the three preset prop
  types.

## Pinning items within a zone

Baseline shipped: `placement.pinned` is the numeric index a node holds in its
parent's `childOrder`, set through `store.setPinned` / `unpin` (0.9.0 replaced
the boolean-plus-`resortByPin` prefix model). Strategies see it through
`LayoutItem.meta.pinned` if they want extra behavior. Snapshot round-trips,
undo works (history captures full store state).

Followups:

- Strategy-specific pin behavior beyond ordering: grid pinning could mean a
  fixed `(col, row)` cell once variable-cell layout lands; strip/stack
  already get correct behavior for free via the prefix.
- DnD affordance: drag-handle hint or refusal animation when trying to
  drop *above* a pinned window in the unpinned section (currently the
  reorder snaps silently — fine, but a hint would be friendlier).
- Pin-while-dragging: today the in-flight item is excluded from the
  destination's prospective list, so pin-prefix calculation during hover
  ignores it; verify this matches user expectations once a real consumer
  ships pinning UI.

## Strategy for partitioning workspace [HIGH]

Right now consumers compose zones by laying them out in plain CSS (see the
Ladle Playground: a CSS grid with `main`, `sidebar`, `dock` slots). The
library has no opinion about how zones relate to each other in the visible
workspace.

Open questions:

- Does windease need a `<Workspace>` primitive that owns the multi-zone
  layout (collapsible sidebar, resizable gutters, full-screen takeover of one
  zone)? Or does that stay entirely in consumer CSS?
- Should zones know about each other for purposes like "dock at the bottom of
  whichever zone has focus" or "promote selected window to main zone"?
- Dynamic zone creation/teardown: brainhouse's worktree grouping might want
  zones that appear and disappear as worktrees are added/removed. Today
  `registerNode`/`unregisterNode` work; what's missing is a UX for it.

## Drag-and-drop support [HIGH]

Spec calls drag "designed for, not shipped." The transit FSM, ownership
transitions, and the `moveNode(id, newParentId, at?)` API already exist; what's
missing is the pointer-driven UX layer.

Scope:

- Pointer/touch drag handles on window headers (consumer opts in).
- Drop-target indicators on zones (highlight on hover, insertion-point
  preview).
- Reorder-within-zone via drag (already supported programmatically via
  `reorderInParent`).
- Animations: optional FLIP-style animation as windows settle into their new
  placements.
- Accessibility: keyboard-driven equivalents (move selected window to
  zone/index).

## Resize support [HIGH]

Per-window resize is currently not addressed. Layout strategies decide sizes
from hints; the user can't drag a window edge to grow it.

Open questions:

- Per-strategy: does grid even allow resize, or only stack/strip with
  preferredSize updates? Probably the latter — grid resize implies
  variable-sized cells, which the current strategy doesn't model.
- Persistence: a resized window's new preferredSize should survive (consumer
  writes it back through `meta` or via a new `setHints` API).
- Inter-zone resize: dragging the gutter between zones is a workspace-level
  concern (see "Strategy for partitioning workspace").

## Groups

A "group" wraps multiple windows so they move, drag, and (potentially) resize
as a unit. Open questions: is a group a special kind of window, a sibling
concept to zones, or a layout strategy that nests its own children? Visual
treatment (tabbed group vs. accordion vs. side-by-side strip) probably wants
to be a strategy choice on the group itself. Persistence needs a stable group
id and a way to express membership in snapshots.

## Drag ghosts [HIGH]

Today's v0.2 DnD ships no ghost — the source stays put while the cursor
moves around, so the drag relies entirely on the drop-target highlight
to convey intent. A semi-transparent representation of the dragged node
that follows the cursor (DOM clone or a portal-mounted summary card)
would make targeting obvious, especially across zones. Options:

- Render a portal child of `<NodeDragProvider>` positioned at
  `clientX/clientY - offset` whenever the controller is active. Chrome
  handlers stay unchanged.
- Let consumers provide a `renderGhost(node)` callback, defaulting to a
  clone of the dragged element with `opacity: 0.6`.
- Decide whether the ghost should be element-relative (`transform:
  translate`) or document-relative (fixed positioning) — fixed wins for
  cross-zone drags, but watch for transforms on ancestors.

## Drag-into (windows ↔ zones ↔ groups)

Once groups exist and drag-and-drop is wired up, dragging a window onto
another window should be able to *form* a group, dragging into an empty zone
should claim that zone, and dragging onto a group's drop region should join
it. Edge cases: rejecting drops a strategy can't accept (e.g. a 2-pane
binarySplit), insertion-point previews for ordered strategies, and what
happens to a single-member group when its last sibling leaves.

## Playwright e2e suite

Shipped. `npm run test:e2e` drives the Ladle stories in real Chromium; the
config starts Ladle itself, so there is nothing to run first. 11 specs across
four files cover the gestures jsdom cannot: gutter resize including
pointer-capture tracking after the cursor leaves the handle, cross-zone drag
with escape-cancel and drop-outside, ResizeObserver relayout on viewport
change, and insertion index against a pinned head.

Still uncovered:

- **Only Chromium runs.** The stated cross-browser value was pointer capture;
  adding webkit/firefox is a line in `playwright.config.ts` projects plus
  install time on every CI run.
- Focus management across drag-induced re-renders.
- Snapshot/hydrate with persisted container state (resize ratios).
- CSS stacking between affordance hit areas and consumer chrome.

One thing the suite surfaced that is worth knowing: the split story passes an
explicit `viewport` prop, so it never exercises the ResizeObserver path at
all. Reflow coverage has to use a ref-measured fixture.

A consumer registering `useDropTarget` for a zone id its `<Container>` already
registered silently loses the default `getInsertionIndex` — child effects run
before parent effects, so the consumer's registration wins and every drop
appends. `DragController` traces the overwrite but nothing surfaces it to a
consumer. Both `Playground` and `ParallelZonesDnd` document the trap and avoid
it; `e2e/drag.spec.ts` pins the parallel-zones case.

## Shipped in 1.0.0

- **`split` / `unsplit` store operations.** Split is a verb over the node tree,
  not a strategy: `store.split(id, { direction })` wraps a node in a strip
  group, flattens into a matching-axis parent, or reconfigures a root in place.
  Directions are `'x'`, `'y'`, `'both'` (nested strips, `into: [cols, rows]`)
  and `'grid'`. All ids are caller-supplied. `store.unsplit(groupId)` dissolves
  a group into its parent; nothing auto-collapses.
- **`Store.transact(fn, label?)`** with `transaction.begin` /
  `transaction.end`, so a composite operation is one undo step. Also
  `setStrategy` — which clears `container.state`, since it belongs to the
  outgoing strategy — and `ensureContainer`.
- **`createZone` takes an optional `parentId`**, which fixed `<Zone>` inside
  `<Zone>` silently registering as a root. `<Zone>` gained a `kind` prop.

## Removed in 1.0.0

- **`splitStrategy`** and its `SplitNode` / `SplitOptions` / `SplitMeta` types.
  It kept a second tree in `container.state` describing what the node tree
  already described, and every known split bug was the two disagreeing. Use
  `store.split`. Saved layouts migrate automatically at snapshot v5.
- **`stackStrategy`.** It was `stripStrategy` on the y axis; strip gained the
  capacity handling that was the only thing stack had. Use
  `stripStrategy` with `{ axis: 'y', fill: true }` — the `fill` matters, since
  strip's default is off and omitting it collapses hintless children to zero.
- **`createGroup` and `<Group>`.** Once `parentId` became optional on
  `createZone`, a group was a zone with a parent and nothing else. The word is
  reserved for the feature under "## Groups" — windows that move as a unit —
  which is what a user means by it. Use `createZone({ parentId })` and
  `<Zone parentId kind="group">`, which keeps `.windease-group` and
  `chrome['group']` working.

## Shipped in 1.1.0

- **`container.added` event.** `ensureContainer` now emits
  `{ id, strategyId }` when it actually adds a container, closing the one
  structural mutation that changed a node's capabilities silently. Not emitted
  for a node registered with a container already on it, nor on the no-op path.
- **`StatefulLayoutStrategy<TState>`.** A `LayoutStrategy` with `initialState`
  required rather than optional, so a strategy author can hand its result
  straight to `layout({ state })` without narrowing. `LayoutStrategy` keeps the
  optional signature, because a host resolving one out of a `StrategyRegistry`
  cannot know whether it seeds.

## Shipped in 1.0.1

- **`createZone` / `createPanel` collapsed into one `createNode`.** The split
  between them was arbitrary — both "middles" were already reachable (a zone
  with a `parentId` was what `createGroup` used to build; a panel with a
  `container` was the documented recursive-panel case). `container`,
  `membership` (via `parentId`), and `focus` are now independent opt-in
  fields on one constructor. `<Zone>` and `<Panel>` stay as React presets over
  `createNode`. See README for the mechanical call-site rewrite.

## Loose ends

- Layout strategies cast `container.config as XConfig` unchecked. Typos at
  registration time become silent runtime quirks.
- Strip strategy returns zero width/height when a panel has no
  `preferredSize` — intentional for fixed-size toolbars but worth a doc
  comment.
- TypeScript is held at 6.x because typedoc 0.28's peer range stops at
  `6.0.x`. Revisit TS 7 (the Go port) once typedoc ships support.
- `gridStrategy` honors `placement.span` (cell-count spans, reserved and
  clamped) but has no resize affordances that write it, so
  `split(id, { direction: 'grid' })` still produces a tiling with no
  draggable gutters. Wiring a gutter that mutates `span` on drag is the
  remaining capability gap against the `splitStrategy` this release removed.
- `patchPlacement` lock-gates `size` writes behind the `resize` axis but not
  `span` — a resize-locked node's grid span can still be changed directly.
  Unguarded because nothing writes `span` yet (see the gutter gap above); fold
  the gate in when a gutter lands.
- **A node cannot be locked against gaining a container.** `resolveLock` drops
  axes the node's current capabilities don't support, and `arrange` requires an
  existing `container` — so `setLock(panel, { arrange: true })` silently stores
  nothing and `ensureContainer` proceeds. The guard works only once a container
  is already present, which is the case it is least needed for.
- `applyReconfigure` merge-patches the container config, so a key from the
  abandoned strategy survives (a `grid` root's `cols` outlives the switch to
  `strip`). Deliberate — replacing wholesale would discard consumer intent like
  `gap` — and pinned by a test. Revisit only if a strategy ever rejects unknown
  keys.
