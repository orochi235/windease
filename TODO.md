# TODO

Future work, sectioned by item. Append new ideas here rather than scattering
them. Tag major items with `[HIGH]`. What has already shipped is at the bottom
under Release history.

## Test-harness gaps

- **An `expect` inside a `store.events` handler can never fail a test.**
  `TypedEmitter.emit` catches and logs listener throws
  (`src/events.ts:22-25`), so a failing assertion there prints
  `[windease] event listener threw` and the test still passes. Use
  `recordEvents` (`src/test-utils/record-events.ts`) and assert after the
  mutation returns. The one live instance has been fixed; nothing
  prevents a new one, so this stays on the list as a review item.

- **A spec fails under parallel load about 1% of the time, on any engine.**
  Seen as `keyboard.spec.ts` "F6 cycles from inside a text input" on Firefox
  in a full three-engine run, green 48/48 in isolation. No diagnosis yet. This
  is what the old "WebKit is flaky" entry described — a different spec each
  time, only under contention — but that entry's headline case turned out to
  be the stale-hover drop defect, which is fixed and was never timing.

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

## Drag and drop

Shipped, and documented in the README's Drag and drop and Resize sections:
`<DragHandle>`, drop-target highlighting with an insertion-point preview,
reorder within a zone, a cursor-following ghost (`defaultDragOverlay`, replaced
via `renderOverlay`), and the settle animation (`settleMs` on `<Container>`,
suppressed under `prefers-reduced-motion`). Per-child resize shipped in 0.5.0
via `placement.size`; `resizeMode: 'neighbor'` makes a seam behave like a
splitter rather than pushing panes down the stack.

Still open:

- **Keyboard-driven equivalents.** No key moves a node — the focused pane
  cannot be sent to another zone, or to an index in its own parent, without a
  pointer. Focus navigation and `bindAnnouncer` are both in place, and the
  announcer already speaks `node.moved` / `node.reordered`, so what is missing
  is the gesture and its keymap.
- **Inter-zone resize** — dragging the gutter *between* zones is a
  workspace-level concern; see "Strategy for partitioning workspace".
- **Grid resize gutters** are tracked under the hosting wishlist below, with
  the `patchPlacement` span lock-gate that lands with them.

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

## Drag-into (windows ↔ zones ↔ groups)

Blocked on Groups. Dragging a window onto another window should be able to
*form* a group, dragging into an empty zone should claim that zone, and
dragging onto a group's drop region should join it. Edge cases: rejecting drops
a strategy can't accept (e.g. a 2-pane binarySplit), insertion-point previews
for ordered strategies, and what happens to a single-member group when its last
sibling leaves.

## Playwright e2e suite

Shipped. `npm run test:e2e` drives the Ladle stories in Chromium, Firefox and
WebKit; the config starts Ladle itself, so there is nothing to run first. 39
specs across nine files cover the gestures jsdom cannot: gutter resize
including pointer-capture tracking after the cursor leaves the handle,
cross-zone drag with escape-cancel and drop-outside, ResizeObserver relayout on
viewport change, and insertion index against a pinned head. All three engines
pass the pointer-capture cases unmodified.

Still uncovered:

- Drop *intent* — "into the seam between B and C" versus "onto B itself". Not
  a gap in the suite so much as in the library; see Merging adjacent nodes.

`e2e/focus-drag.spec.ts`, `e2e/snapshot-roundtrip.spec.ts` and
`e2e/stacking.spec.ts` close the three that were listed here. The stacking
specs hit-test with `elementFromPoint` rather than asserting z-index, because
what matters is what a pointer lands on: a nested container's affordance layer
must beat its parent's, and neither may swallow the pane content or a drag
handle beside it. The round-trip drives `serialize` / `deserialize` from the
page — `RecursiveSplit.stories.tsx` exposes them for it — since hydrating in
place makes the React layer rebuild against a store emptied underneath it,
which no headless test exercises.

One thing the suite surfaced that is worth knowing: the split story passes an
explicit `viewport` prop, so it never exercises the ResizeObserver path at
all. Reflow coverage has to use a ref-measured fixture.

A consumer registering `useDropTarget` for a zone id its `<Container>` already
registered silently loses the default `getInsertionIndex` — child effects run
before parent effects, so the consumer's registration wins and every drop
appends. `DragController` traces the overwrite but nothing surfaces it to a
consumer. Both `Playground` and `ParallelZonesDnd` document the trap and avoid
it; `e2e/drag.spec.ts` pins the parallel-zones case.

## Loose ends

- Strip strategy returns zero width/height when a panel has no
  `preferredSize` — intentional for fixed-size toolbars but worth a doc
  comment.
- TypeScript is held at 6.x because typedoc 0.28's peer range stops at
  `6.0.x`. Revisit TS 7 (the Go port) once typedoc ships support.
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
of it has now shipped: four items in 1.2.0, and the overflow policy plus the
declarative-path gaps after it.

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

- **Shipped: size-driven overflow, signal and policy.**
  `LayoutResult.overflow` reports how far the placed content exceeds the
  container per axis, absent when it fits. Distinct from `unplaced`, which is
  capacity by *count* — a row can overflow with everything placed.

  `overflowMode` on strip config turns that signal into a policy.
  `'squeeze'` (default) is the original behavior: scale until floors bind,
  then report the remainder. `'scroll'` lays out at the extent the panes
  asked for and reports the whole excess; `<Container>`, `<Zone>` and
  `<Panel>` size their box to `viewport + overflow`, so the consumer only
  has to put `overflow: auto` on a wrapper. `'unplace'` places what fits at
  full extent and sends the rest to `unplaced`, composing with `maxItems`
  rather than replacing it.

  The interaction with content sizing was the sharp edge, and it was silent.
  A measured size is a *stated* size: it scales under pressure. A dock of
  `hints.sizing: { h: 'content' }` palettes declaring no `minSize` therefore
  had a clamp floor of zero — every palette quietly shrank below the height
  it asked for, and `overflow` stayed absent because nothing was floored.
  Laying out against the intrinsic extent under `scroll` holds each pane at
  its measurement and reports the difference. Under `squeeze` the shrink is
  still what happens, which is what `squeeze` means.

  Size-driven unplacing resolves inside `placedOf`, beside the count cap, so
  `layout` and `dispatchAffordance` cannot disagree about which panes are
  placed. `canAccept` still gates on `maxItems` only: it has no container
  size to test against and runs on every pointermove.

  Left undone: the one pane that must be placed when nothing fits is clamped
  to the container rather than overflowed, so `unplace` never reports
  overflow. That is a choice, not a law — a consumer who would rather see
  the overflow has no way to ask.

- **Shipped: affordances in the declarative path.** `<Zone>` and `<Panel>`
  render the strategy's affordances through the same `AffordanceLayer` that
  `<Container>` uses, so a seam is the same element with the same keyboard
  contract whichever path built the tree. `ZoneProps.affordances` had been
  declared and documented as reserved, which meant a consumer could pass it
  and watch nothing happen. Wiring it removed the reason labkit's
  `WorkspaceGrid` hand-rolled a store — mint a node per child, sync
  registration and `childOrder` on every change — to get resizable panes.

  Declaring `placement` and dragging a seam were a live fight: reconcile runs
  every render and forces the declared bag back, so the drag was reverted on
  the next one. Resolved the way controlled child order already resolves it.
  `ContainerHost.registerPlacementControl` diverts the write to the host and
  leaves the store untouched, surfaced as `<Panel onPlacementChange>`; an
  uncontrolled sibling in the same row still commits normally. Declaring
  `placement` *without* a handler still stomps the drag, which is now the
  documented meaning of declaring it.

- **Shipped: content sizing in the declarative path.** `hints` is a prop on
  the presets, so `sizing: { h: 'content' }` is reachable without building
  the tree store-first, and the presets wrap a measured pane in the same
  measurement box `<Container>` uses. They read the *parent's* layout scope
  for it, so a nested container measures against whatever sizes it rather
  than against itself.

  Hints had no store setter at all — they were fixed at `registerNode` — so
  a prop that changed after mount would have been a silent no-op. `setHints`
  patches like `setMeta` and compares by value, because a binding rebuilds
  `hints` from props on every render and identity would invalidate the
  layout forever.

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

  Still not announced, and now by choice rather than for want of a mechanism:
  the live region `bindAnnouncer` added is for structural change, and resize
  does not use it. Under `resizeMode: 'neighbor'` a step can be truncated by the
  neighbor's limit while the focused pane is nowhere near its own, and
  `atMin` / `atMax` describe the dragged child — so narrating from them would
  state something false. `aria-valuenow` carries the truth. Anyone wiring
  resize into the announcer has to solve that first.

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

## Merging adjacent nodes

Filed as one question — "should adjacent nodes be able to merge?" — but it is
three unrelated features sharing a verb. They want separating before any of
them is scoped, because only one is cheap and none is on the path to a
palette dock.

- **Tab-stacking two panes into one.** Drop A onto B's body and the two
  become a tabbed stack. The real work is not the merge, it is drop *intent*:
  the hit-test has to separate "into the seam between B and C" from "onto B
  itself", which `insertionIndexByMidpoint` deliberately does not do — it
  answers only the first question. Needs a stack container preset and a tab
  strip on top of that. The largest of the three by a wide margin.

- **Shipped: coalescing a container that drops to one child.**
  `store.setAutoUnsplit(id, true)` collapses a container when a removal leaves
  it holding one child, lifting the survivor into the grandparent with the
  group's placement and pinned index. Opt-in on the container, as this entry
  argued: the trigger cannot live in `removeNode`, or a zone the consumer
  created on purpose would evaporate the moment it emptied.

  Two things this entry did not know. It fires on the *transition* only, not
  on any container holding one child — otherwise a group could never be built
  up a pane at a time. And it cannot cascade: `unsplit` swaps the group for
  its survivor, so the grandparent's count is unchanged, which is why the
  upward walk that looked necessary is not.

  Undo granularity resolved as this entry wanted: `unregisterNode` now opens a
  transaction, so the collapse joins the removal rather than landing as a
  second step. Every removal emits `transaction.begin` / `transaction.end`
  now, which a consumer bracketing history on that pair will see.

- **Joining panes by dragging a seam past a neighbor's floor.** A resize
  gesture that ends in a destroy. It has to answer to `lock.destroy` on a
  pane the gesture never targeted, and the point of no return has to be
  visible before the pointer is released, or the user destroys a pane by
  overshooting. The gesture is small; the affordance design is not.

None of the three is blocked on anything. The order to do them in, if asked,
is coalescing, then seam-join, then tab-stacking.

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

  **Shipped, both halves.** The uncontrolled one needed no new mechanism, only
  a name: `ChildSort` already received the parent's current store order and
  `<Zone>` already took a `sort` prop, so `preserveStoreOrder` short-circuits
  reconcile with no `setChildOrder`, no `arrange` lock and no round-trip.

  The controlled half is `<Container onChildOrderChange>`, registered on the
  `DragController` through its own `registerOrderControl` registry rather than
  on `registerDropTarget` — a second registration for the same id silently
  replaces the first there, which is the trap already recorded against the
  Playwright suite.

  Two rules worth not re-litigating. A drop involving a controlled parent
  writes nothing to the store, even when the *other* side is uncontrolled:
  committing the move and also asking the host to commit it applies one gesture
  twice, so the uncontrolled counterpart is the host's to update. And only
  library-mediated gestures are intercepted — `store.reorderInParent` called
  directly is the host acting on itself. The prospective order is computed with
  `placeRespectingPins`, the same helper the store uses, so a pinned prefix
  cannot depend on who owns order.

- **Shipped: subtree serialize / graft.** `serialize(store, { root })` emits a
  v5 snapshot of one node and its descendants, with the root's own placement in
  a top-level `rootPlacement`; `graft(store, snap, parentId, { at, force })`
  attaches one under a named parent and returns its id. Colliding ids reject
  rather than remap — the snapshot's ids are the host's record keys — and the
  check is a pre-pass, so a rejected graft mutates nothing. One transaction, so
  one undo step. Graft never moves focus. A subtree snapshot is an ordinary v5
  snapshot, so `deserialize` still opens one as a standalone store.

- **Shipped: grid resize gutters.** `gridStrategy` takes `resizable: true` and
  emits `resize-x-<id>` / `resize-y-<id>` on each item whose span can move,
  writing `placement.span`. Auto-balance and draggable seams are no longer an
  either/or. `patchPlacement` now lock-gates `span` behind the `resize` axis
  alongside `size`, closing the Loose-ends gap.

  It is **not** strip's pairing semantics, and trying to copy them was the
  wrong instinct: a grid packs rather than pairs, so growing an item costs
  whoever no longer fits rather than one named neighbor. `valueMax` is the
  largest span at which every sibling is still placed — which in an unbounded
  grid means the grid grows a row rather than dropping anyone.

  Two contract additions this needed, both additive:

  - **`LayoutEvent.payload.point`**, the pointer in container-relative
    coordinates. A quantized extent cannot accumulate incremental `dx`: a few
    pixels round to the span it already has, every time, so the drag never
    moves. Grid resolves against the pointer instead, which is also
    self-correcting rather than drift-prone. Strip ignores it.
  - **`Affordance.bounds.step`**, how far one keyboard press should move this
    affordance in its own units. `<Container>`'s `affordanceKeyStep` is 8
    pixels, which is meaningless against a value counted in cells.

  A seam is emitted when the span *can* move in either direction, not when a
  cell follows it — keying on the latter drops the handle from an item spanning
  to the edge and leaves it grown with no way back.

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
- **Shipped: `observePixelRatio(cb)`.** Reports `devicePixelRatio` now and on
  every change, returning a teardown, so a canvas host has one handler for
  mount and update instead of hand-rolling `matchMedia`.

  Deliberately **not** on `ContainerHost`, which is where the ask ("alongside
  placements") pointed. Viewport and natural size are layout inputs — strategies
  read them and placements change. Nothing in `layout()` reads the ratio and no
  placement moves with it, so routing it through the layout host would make the
  host a bus for a value it never consumes. A ratio change and a placement
  change are independent triggers for the same host-side resize; coupling them
  would notify a canvas host on every ordinary resize.

  This is not the tenet exception it was recorded as being. `observe` and
  `observeNatural` are the sanctioned "thin DOM wrapper beside the pure
  function," and `setPixelRatio(2)` would touch no DOM at all — the reason to
  keep it off the host is that DPR is not layout state, not the tenet.

  The trap it exists to solve: a resolution media query embeds the ratio it was
  built with, so its listener fires once and is then permanently false. Every
  change has to re-arm at the new ratio. `src/pixel-ratio.test.ts` pins that by
  asserting the query sequence, and goes red when the re-arm is removed.
- **Verified gone, and pinned.** `src/split.no-silent-drop.test.ts` covers a
  panel registered after `store.split` built the tree, one added after
  container state was already seeded with a stale 0.8-shaped tree, and the
  same under `grid`. All three are placed. With one tree there is nothing for
  a second to disagree with, which is what `splitStrategy`'s removal bought.

Note the consumer is pinned at `^0.8.0` and has not taken 1.0 yet, so it still
carries a hand-rolled balanced-tree builder (`tree.ts`) working around
`initialState`. Deleting that is klieg's migration to do, not a windease item —
but it means feedback from that lab is 0.8-shaped until the upgrade lands.

## Release history

### 1.2.1

- **`<Container>` renders nothing under React StrictMode.** `destroy()` was
  one-way. `useContainerLayout` held its host in a `useMemo` and destroyed it
  in the effect cleanup, so StrictMode's mount / teardown / remount handed the
  second mount the same instance the first had just unsubscribed — one render,
  then silence, with no error to explain it. The constructor's wiring moves to
  `#wire()` and a new public `ContainerHost.attach()` re-runs it on a destroyed
  host, so mount and remount are symmetric. Headless construction is unchanged.
  Found consuming 1.2.0 from `@weasel-js/labkit`, whose Vite examples use
  StrictMode like every React template does.

  Testing a `dist` swap in a Vite consumer needs `node_modules/.vite` cleared
  first — the dep pre-bundle serves the old copy and the before/after lies.

### 1.2.0

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
- **Grid resize gutters.** `gridStrategy` with `resizable: true` emits seams
  that write `placement.span`, so auto-balance and draggable seams compose.
  `patchPlacement` lock-gates `span` behind `resize`. Adds
  `LayoutEvent.payload.point` and `Affordance.bounds.step`, both additive.
- **Controlled child order.** `<Container onChildOrderChange>` hands the host
  the order a drop would have produced and writes nothing, for a host whose own
  store is the authority. `DragController.registerOrderControl` is the
  binding-free equivalent.
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

- **`DragEngine`, the DOM-free half of `DragController`.** Ownership,
  acceptance and hit-testing over `bounds()` callbacks, with the frame
  scheduler injected; `DragController` is unchanged for consumers and is now
  the DOM host that measures elements, walks `parentElement` for depth, stamps
  `data-drop-*` and binds the window listeners. Closes the tenet violation.
  A synchronous scheduler used to wedge the pending-frame handle after the
  first sample — found by the headless tests, which need no faked `Element`.

- **Announcements for changes that move no focus.** `bindAnnouncer(store,
  adapter)` composes text from `focus.successor`, `node.moved` and
  `node.reordered` and hands it to `FocusAdapter.announce`; `<FocusProvider>`
  renders a polite live region and wires it, opt out with `announce={false}`.
  Scoped to the focused node and subtrees focus sits inside, so a host moving
  panes the user is not in stays silent. `FocusAdapter` now has a real DOM
  implementation behind the seam rather than an interface with no callers —
  `present` moves the caret, and a canvas host swaps both methods.

- **`observePixelRatio`.** A canvas host learns about `devicePixelRatio`
  changes without hand-rolling the `matchMedia` re-subscription. Standalone and
  additive; see "Canvas-host ergonomics" for why it is not on `ContainerHost`.

### 1.1.0

- **`container.added` event.** `ensureContainer` now emits
  `{ id, strategyId }` when it actually adds a container, closing the one
  structural mutation that changed a node's capabilities silently. Not emitted
  for a node registered with a container already on it, nor on the no-op path.
- **`StatefulLayoutStrategy<TState>`.** A `LayoutStrategy` with `initialState`
  required rather than optional, so a strategy author can hand its result
  straight to `layout({ state })` without narrowing. `LayoutStrategy` keeps the
  optional signature, because a host resolving one out of a `StrategyRegistry`
  cannot know whether it seeds.

### 1.0.1

- **`createZone` / `createPanel` collapsed into one `createNode`.** The split
  between them was arbitrary — both "middles" were already reachable (a zone
  with a `parentId` was what `createGroup` used to build; a panel with a
  `container` was the documented recursive-panel case). `container`,
  `membership` (via `parentId`), and `focus` are now independent opt-in
  fields on one constructor. `<Zone>` and `<Panel>` stay as React presets over
  `createNode`. See README for the mechanical call-site rewrite.

### 1.0.0

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

### 1.0.0 removals

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

### 0.8.0

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

### 0.7.0

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

### 0.5.0

- **Resizable children.** `placement.size?: { w?, h? }` reserved key is
  honored by `stack` / `strip` / `split` strategies; `hints.maxSize` is
  a new clamp ceiling alongside `hints.minSize`. Non-last children in
  stack/strip get trailing-edge resize affordances; split gutters now
  clear `placement.size` on both panes before applying the ratio change.
  Grid still ignores explicit sizes (multi-cell spans deferred). Snapshot
  round-trips without a schema change.

### 0.4.0

- **Declarative JSX tree binding.** `<Zone>` / `<Group>` / `<Panel>`
  presets register themselves with the store on mount, unregister on
  unmount, and reconcile sibling order from JSX child order each render.
  Imperative and declarative ids coexist under the same parent.
  `<Provider>` auto-creates a Store when none is provided. Public
  surface: `ParentContext` / `ParentScope` / `useParentId`,
  `LayoutContext` family, `defaultChildSort`, and the three preset prop
  types.
