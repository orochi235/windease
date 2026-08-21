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

## DOM-proxy focus adapter for canvas hosts

Medium priority. A canvas surface has no accessibility tree, so the standard
technique is a parallel DOM tree of invisible focusable proxies positioned from
`placements` — giving the surface real focus, real tab order and real
screen-reader output. That logic is non-trivial and reusable, which is what
would earn it a place in the library.

Not built yet because there is no second consumer and no way to test it: there
is no WebGL in windease's dev dependencies, and the one WebGL consumer
(`blitsklieg`, `packages/core/dev/tube-lab`) is a React DOM app drawing into a
canvas from `placements`, so it uses the DOM adapter unchanged. Ships as a
documented recipe first; promote when a host actually needs it.

Depends on the adapter seam in
`docs/superpowers/specs/2026-08-21-keyboard-navigation-design.md`.

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
- **`DragController` is the outstanding DOM-independence violation.** It holds
  `window` keydown/pointerup listeners, `Element` refs, `getBoundingClientRect`
  hit-testing, and `parentElement` depth walking (`src/dnd/DragController.ts:157`,
  `320-368`), and it ships from the core entry. The transit/ownership FSM is
  core; the pointer plumbing wants to sit behind an adapter, the way
  `ContainerHost.setViewport` / `observe` and `insertionIndexByMidpoint` /
  `childRectsForContainer` already split. See the DOM-independence tenet in
  CLAUDE.md.
- **Two dead affordance hooks are deprecated, not yet removed.**
  `BuiltinAffordanceKind`'s `'keypress'` member and `LayoutEvent`'s `kind: 'key'`
  are never emitted, dispatched, or handled; keyboard resize reaches a strategy
  as a synthesized `'drag'` instead. Both are `@deprecated` and removed at 2.0.0.
  Deprecated rather than deleted because both types are exported from the entry
  point, so narrowing either breaks a consumer who annotated against it — the
  `| string` on `Affordance.kind` protects assignment into that field, not a
  direct use of the exported union.
- `applyReconfigure` merge-patches the container config, so a key from the
  abandoned strategy survives (a `grid` root's `cols` outlives the switch to
  `strip`). Deliberate — replacing wholesale would discard consumer intent like
  `gap` — and pinned by a test. Revisit only if a strategy ever rejects unknown
  keys.

## Wishlist: docked tool palettes [HIGH]

Gaps found evaluating windease as the layout engine for a sidebar of
resizable tool palettes (the weasel case). Everything structural is already
here — a `stripStrategy` zone on `{ axis: 'y' }`, gutters, per-child
min/max, DnD between docks, sizes that round-trip through `serialize`. These
five are what a consumer would still have to build.

- **Content-driven sizing.** Strip derives extents from `placement.size`,
  `hints.preferredSize`, or an equal share (`src/layout/strip.ts:114-131`).
  There is no way to say "as tall as my contents," so a palette that wants
  its natural height forces the consumer to measure the DOM and write
  `preferredSize` back — a layout pass keyed on the output of a layout pass.
  Wants either an `auto` sentinel that `<Container>` resolves by measuring
  before it runs the strategy, or measured natural sizes as a strategy input
  alongside `hints`.

- **Collapse is userland; `minSize` no longer floors an explicit size.**
  Was "collapse as a state." It isn't one. With an explicit or content-derived
  size, collapse is a size: write `placement.size` down to the header extent,
  write it back to expand. `transact` makes that one undo step and `meta`
  round-trips a remembered extent through `serialize`, so nothing was missing
  except one conflict — `clampExplicitSizes` floored explicit sizes at
  `hints.minSize`, so a palette declaring a minimum for its *expanded* state
  could not be shrunk below it, and the consumer had to stash and restore
  `minSize` too.

  Resolved by splitting the two jobs `minSize` was doing. It is still a hard
  floor on the resize path — a gutter drag refuses to cross it — and no longer
  a floor on the layout path for an item that stated a size. An item that
  states nothing is still floored at its min. The freeze-and-leave-the-pool
  scaling is unaffected: its floor is `Math.min(min, requested)`, so an
  explicit 32 against a min of 120 freezes at 32 rather than collapsing toward
  zero under pressure.

  What the docs owe the pattern, from the keyboard-navigation review: a
  collapsed pane keeps its accessible name, and its expand control must be
  keyboard-reachable in whatever still renders. A pane that can be collapsed
  and not reopened from the keyboard is worse than no collapse.

- **Size-driven overflow.** `maxItems` + `unplaced` model *count* capacity;
  nothing models "the children's minimums no longer fit the extent."
  `clampExplicitSizes` scales explicit sizes proportionally and does not
  re-floor them at `min` (`src/layout/resize.ts:56-64`), so under pressure
  explicit panes squeeze past their declared minimum while unconstrained
  siblings hold theirs — and once `unconstrainedMinSum` exceeds `available`
  the row overflows its container with no signal. Wants an overflow policy
  on strip (squeeze / scroll / unplace) and a `LayoutResult` flag saying the
  content exceeded the extent, so a consumer can scroll instead of crush.

- **Keyboard resize and ARIA.** `keypress` is in `BuiltinAffordanceKind`
  (`src/layout-types.ts:71`) and nothing emits, dispatches, or handles it;
  there is no `role`, `aria-*`, or `tabIndex` anywhere in library code. A
  gutter is pointer-only, which fails a keyboard user outright. Wants
  gutters rendered as `role="separator"` with `aria-orientation` /
  `aria-valuenow` / an accessible name, arrow keys stepping through the
  existing `dispatchAffordance` path, and a labelled region per panel.

- **Two-sided gutter drags.** Strip's `dispatchAffordance` writes
  `placement.size` to the child before the gutter only
  (`src/layout/strip.ts:225-241`); the delta is absorbed implicitly by
  whichever siblings happen to be unconstrained, redistributed across all of
  them rather than the immediate neighbor. That is the right default for a
  fill row, but it is not how a splitter behaves — dragging one seam visibly
  moves panes far down the stack. Wants a strip config for the pairing mode,
  where a drag writes explicit sizes to both neighbors and leaves the rest
  alone.

## Wishlist: hosting an app that already has a workspace store [HIGH]

Gaps found evaluating windease as the window manager for labkit's workspaces
(`@weasel-js/labkit`), a host that already owns a workspace list, its order,
and its persistence in zustand and wants windease for geometry and gestures
only. The generic case is any app adopting windease into an existing store
rather than starting from one.

Two things this evaluation expected to need and found already shipped:
`gridStrategy` auto-balances to `ceil(sqrt(n))` with an `orientation` bias
when neither `cols` nor `rows` is set, which is the host's whole hand-rolled
grid sizer; and `HistoryController<TSnapshot>` is generic and unattached, so
a host with its own per-item undo stacks simply doesn't wire it.

- **Controlled `childOrder`.** A host that renders its own records as JSX has
  two writers for order — the binding (`reconcileChildOrder`) and the user's
  drop — and no way to let the second win. Unlocked, the next host-driven
  render reverts the drop, because `defaultChildSort` falls back to declared
  JSX position. Arrange-locked, the drop never lands: `setChildOrder` asserts
  on the same axis (`src/store.ts:482`) that `reconcileChildOrder` skips on
  (`src/reconcile.ts:120`). The host's only route today is echoing
  `node.reordered` / `node.moved` back into its own store and re-rendering,
  which inverts who owns order and is the bulk of an integration. Wants the
  React distinction: a declared order treated as *initial* (uncontrolled), or
  an `onChildOrderChange` intent the host commits, so "host declares, user
  rearranges" needs no round-trip.

  **Mostly addressed.** `ChildSort` already receives the parent's current store
  order as its second argument, and `<Zone>` already takes a `sort` prop, so the
  uncontrolled half needed no new mechanism — only a name. `preserveStoreOrder`
  ships it: reconcile short-circuits, no `setChildOrder` runs, no `arrange`
  lock, no round-trip. Still open is the *controlled* half — an
  `onChildOrderChange` intent for a host that wants to approve or transform a
  reorder rather than just keep it.

- **Subtree serialize / hydrate.** `serialize(store)` is whole-store
  (`src/snapshot.ts:51`). A host whose own saved states are per-item — one
  saved workspace, not the session — cannot round-trip a single node's
  placement without carrying, and then reconciling, a snapshot of the entire
  tree. Wants `serialize(store, { root: id })` and a hydrate that grafts a
  subtree under a named parent.

- **Grid resize gutters** (promoted from Loose ends). Auto-balance lives in
  `gridStrategy`; draggable seams live in `stripStrategy`. A host that wants
  both has to give one up — nesting strips via `store.split` discards the
  `ceil(sqrt(n))` arrangement that made the grid worth adopting. This is the
  same gutter-writes-`span` gap already recorded against the removed
  `splitStrategy`; the workspace-tiling case is what makes it load-bearing
  rather than a symmetry complaint. Fold in the `patchPlacement` span
  lock-gate at the same time.

- **In-flow render mode, per zone.** `docs/explorations/2026-06-04-flexbox-passive-zones.md`
  declined replacing the passive strategies with CSS, and its "what's lost"
  list holds up — item 3, auto-balance, is exactly what this host wants to
  keep. But the choice was framed as all-or-nothing, and step 1 of its own
  rollout (passive mode alongside strategy zones) is the useful half: a host
  adopting windease for gestures on some zones shouldn't have to trade a
  working CSS grid for a JS layout pass and absolute rects on the zones that
  are a plain tiling. Note the decline also rested on "a single-app project
  with no external consumers yet" — an adopting host is that consumer.

## Canvas-host ergonomics

Raised by klieg's tube lab (`packages/core/dev/tube-lab`), the WebGL consumer
already described under "DOM-proxy focus adapter for canvas hosts". It draws
sixteen panels as scissor rects on one `WebGLRenderer`, positioning them from
placements, so the canvas is one element spanning the whole zone rather than
one per window.

- **Let a zone opt out of `overflow: hidden` without opting out of the
  stylesheet.** `.windease-zone` sets `position: relative; overflow: hidden`,
  which clips a host canvas that spans the zone. The lab's workaround is to
  withhold the `windease-zone` class entirely — so it forfeits the positioning
  and the container queries too, to escape one property. A modifier class, or
  splitting clipping out of the base rule, would cost nothing.
- **Deliver DPR changes alongside placements.** Placements give a host its
  rects in CSS pixels, which is most of what a canvas needs; a
  `devicePixelRatio` change still leaves every consumer wiring its own
  `matchMedia` to know the backing store must be resized. Dragging a window
  between displays is the common case.
- **Verify the silent-drop bug is gone.** Under 0.8's `splitStrategy` a panel
  the layout tree did not know about was dropped with no error — the lab
  documents it as a trap. That looks like the two-trees-disagreeing class of
  bug `splitStrategy`'s removal was meant to end, but nothing has confirmed it
  against 1.x, and "silently" is the part worth a regression test either way.

Note the consumer is pinned at `^0.8.0` and has not taken 1.0 yet, so it still
carries a hand-rolled balanced-tree builder (`tree.ts`) working around
`initialState`. Deleting that is klieg's migration to do, not a windease item —
but it means feedback from that lab is 0.8-shaped until the upgrade lands.
