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

## On main, unreleased — ships as 1.2.0

Not on npm yet: `package.json` still says 1.1.0 and no tag exists. The subtree
serialize/graft work goes out under the same 1.2.0.

- **Keyboard navigation and focus.** The layout is now reachable by keyboard
  and legible to a screen reader, at a cost of exactly one Tab stop for the
  whole tree. Arrows and `Home`/`End` move between panes when the wrapper
  itself has focus; `F6`/`Shift+F6` cycle from anywhere, including inside
  content that eats the arrows. Tab is never intercepted.
- **`focus.successor`.** Destroying or hiding the focused node names a
  replacement — next sibling, previous sibling, the parent's remembered
  child, the parent, then the first visible leaf — instead of dropping focus
  to the document. `ContainerCap.lastFocusedId` backs the memory and is
  deliberately session-only, not serialized.
- **`LayoutStrategy.navigate?`.** A strategy can override directional
  resolution for its own children: an id wins, `undefined` falls through to
  the geometric search, `null` declares the direction dead there.
- **`prefers-reduced-motion`** now suppresses the settle transition.
- **Content-driven sizing.** `hints.sizing: { h: 'content' }` asks to be sized
  by measured content. The measurement reaches strategies as
  `LayoutItem.natural`, supplied by an adapter — `ContainerHost.setNaturalSize`
  is the headless API and `observeNatural` the DOM convenience over it,
  mirroring `setViewport` / `observe`. A `layout()` call with no measurement
  behaves exactly as before.
- **Keyboard resize gutters.** `role="separator"` with `aria-orientation` and
  the value triple, arrow keys plus `Home`/`End`, and an accessible name
  composed from the panes the gutter moves. `<Container>` takes
  `affordanceKeyStep` and `affordanceTabStops`.
- **`Affordance.bounds` honors `resizeMode: 'neighbor'`.** It reported the
  whole row's slack while the drag stopped at the neighbor's minimum. Behavior
  change for anyone reading `valueMax` off a paired affordance — the number is
  now the one the drag will actually reach.
- **`store.hasFocus` renamed to `canFocus`.** It answers "does this node have
  a focus machine", but sat one method from `focusedId` and read as a state
  check — both workstreams building on focus misread it. `hasFocus` remains as
  a deprecated delegating alias, removed at 2.0.0, so nothing breaks in a
  minor.

Still missing: `announce()` ships on `FocusAdapter` with no call site. Moving
real DOM focus announces the pane name for free, so what is left uncovered is
the change with no accompanying focus movement — a successor chosen after a
destroy, or a pane relocated to another zone. Needs a live region, which the
keyboard-navigation design deliberately did not specify.

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
min/max, DnD between docks, sizes that round-trip through `serialize`. All
five are now closed except the overflow *policy*, which is deliberately
parked.

- **Shipped: content-driven sizing.** `hints.sizing: { w?: 'content'; h?:
  'content' }` declares the request per axis; the measurement arrives as
  `LayoutItem.natural`. Measurement is an input, never a call, so the core
  stays arithmetic and a headless `layout()` behaves as it always did.

  In strip a measurement is a stated size: it scales under pressure and loses
  to `placement.size`. **A gutter drag therefore pins the pane** — the write to
  `placement.size` outranks the measurement and the pane stops tracking its
  content. Clearing the size resumes tracking. Unlike an explicit size it is
  floored at `minSize`; that exemption exists so a consumer can deliberately
  collapse a pane, and a measurement states no such intent.

  Two passes, not one: a pane's natural height depends on the width the layout
  just assigned it. It converges because the measured element is never the one
  the extent was written to (`<Container>` measures an inner auto-height div),
  and because `setNaturalSize` drops sub-pixel changes. The convergence test
  asserts a pass count — a test on the final rect passes just as happily
  against a loop that never stops.

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

- **Size-driven overflow: signal shipped, policy still open.**
  `LayoutResult.overflow` reports how far the placed content exceeds the
  container per axis, absent when it fits. Distinct from `unplaced`, which is
  capacity by *count* — a row can overflow with everything placed. Strip sets
  it once floors bind and the row cannot shrink further; a row whose panes
  declare no floor is still squeezed, which is correct.

  Fixed alongside it: the fill path ignored `hints.minSize` entirely, so a
  minimum was honored only when some sibling happened to carry an explicit
  size. Three panes each declaring 150 in a 300px column rendered at 100. Both
  paths now floor at min. This is a behavior change for a consumer who set
  `minSize` on a filled strip and relied on it being ignored.

  Still open is the *policy* — `squeeze` / `scroll` / `unplace` as a strip
  config. The signal is what a consumer needs to implement any of them
  themselves; the policy is sugar over it, and worth waiting for a second
  consumer to ask.

- **Shipped: keyboard resize.** A gutter renders as `role="separator"` with
  `aria-orientation` and `aria-valuenow` / `aria-valuemin` / `aria-valuemax`,
  and takes arrow keys along its orientation plus `Home` / `End`. A key
  synthesizes the same `'drag'` the pointer sends through `dispatchAffordance`,
  so the strategy clamps once rather than twice. (`keypress` on
  `BuiltinAffordanceKind` and `LayoutEvent`'s `kind: 'key'` stay dead and
  `@deprecated`; see Loose ends.)

  The accessible name is composed by the adapter from `affordance.affects`
  using `accessibleName` — affordances never carried a `label`, contrary to
  what this entry claimed before.

  The `resizeMode: 'neighbor'` trap this entry recorded was real and is now
  fixed at the source: `bounds` reported the whole row's slack while the drag
  stopped at the neighbor's minimum. Advisory numbers could absorb that; an
  `aria-valuemax` promising an extent that does not exist could not.

  Still not announced: nothing writes a live region, so a step that is
  truncated by the neighbor rather than by the focused pane is visible in
  `aria-valuenow` and not narrated. `atMin` / `atMax` describe the dragged
  child, so narrating from them would state something false.

- **Shipped: `resizeMode: 'neighbor'`.** Strip's default still writes only the
  dragged child and lets the delta be absorbed by whichever siblings are
  unconstrained — right for a fill row, wrong for a splitter, where dragging
  one seam visibly moved panes far down the stack. Under `'neighbor'` the drag
  writes explicit sizes to the dragged child and the one after it and leaves
  the rest alone; total extent is conserved, and the delta stops at whichever
  of the two neighbors binds first rather than spilling past it. The affordance
  reports `affects: [child, next]` in this mode, so resize-lock suppression
  covers both panes without the React layer branching on config.

  Default unchanged, so this is additive.

  Grid's equivalent — a gutter that writes `span` — is still open, and is the
  same pairing semantics applied to cell counts. Build it against this rather
  than reinventing the clamping. Fold in the `patchPlacement` span lock-gate
  then.

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

- **Shipped: subtree serialize / graft.** `serialize(store, { root })` emits a
  v5 snapshot of one node and its descendants, with the root's own placement in
  a top-level `rootPlacement`; `graft(store, snap, parentId, { at, force })`
  attaches one under a named parent and returns its id. Colliding ids reject
  rather than remap — the snapshot's ids are the host's record keys — and the
  check is a pre-pass, so a rejected graft mutates nothing. One transaction, so
  one undo step. Graft never moves focus. A subtree snapshot is an ordinary v5
  snapshot, so `deserialize` still opens one as a standalone store.

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

- **Shipped: `.windease-zone--unclipped`.** `.windease-zone` still clips by
  default; adding the modifier keeps the positioning and the container queries
  and drops `overflow: hidden`. Two classes rather than `!important`, so
  consumer rules are unaffected.
- **Deliver DPR changes alongside placements.** Placements give a host its
  rects in CSS pixels, which is most of what a canvas needs; a
  `devicePixelRatio` change still leaves every consumer wiring its own
  `matchMedia` to know the backing store must be resized. Dragging a window
  between displays is the common case.
- **Verified gone, and pinned.** `src/split.no-silent-drop.test.ts` covers a
  panel registered after `store.split` built the tree, one added after
  container state was already seeded with a stale 0.8-shaped tree, and the
  same under `grid`. All three are placed. With one tree there is nothing for
  a second to disagree with, which is what `splitStrategy`'s removal bought.

Note the consumer is pinned at `^0.8.0` and has not taken 1.0 yet, so it still
carries a hand-rolled balanced-tree builder (`tree.ts`) working around
`initialState`. Deleting that is klieg's migration to do, not a windease item —
but it means feedback from that lab is 0.8-shaped until the upgrade lands.
