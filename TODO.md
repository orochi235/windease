# TODO

Future work, sectioned by item. Append new ideas here rather than scattering
them. Tag major items with `[HIGH]`, and ones worth doing but not next with
`[MED]`. What has already shipped is in
[`CHANGELOG.md`](CHANGELOG.md).

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

Zones nested under one root container already tile, with draggable gutters
between them: the Ladle Playground builds a single root `strip` and derives
`main`, `sidebar` and `dock` from it through `store.split`. Zones a consumer
composes as *separate roots* in its own CSS share one coordinate space too —
each root `<Container>` measures itself into the geometry registry
([design](docs/superpowers/specs/2026-08-22-root-origin-geometry-design.md)) —
so directional navigation and `Shift`-arrow moves cross between them. What the
library has no opinion about is the arrangement itself: collapsible sidebars,
gutters *between* roots, full-screen takeover.

Open questions:

- Does windease need a `<Workspace>` primitive that owns the multi-zone
  layout (collapsible sidebar, resizable gutters, full-screen takeover of one
  zone)? Or does that stay entirely in consumer CSS?
- Should zones know about each other for purposes like "dock at the bottom of
  whichever zone has focus" or "promote selected window to main zone"?
- Dynamic zone creation/teardown: brainhouse's worktree grouping might want
  zones that appear and disappear as worktrees are added/removed. Today
  `registerNode`/`unregisterNode` work; what's missing is a UX for it.

## Preset panes carry no ARIA role or name

`PresetShell` (`src/react/presets.tsx`) gives a pane that declares `focus` the
same roving tab stop `<Container>` gives the children it renders, but not the
`role="group"` and `aria-label` that go with it there — writing both literally
needs a biome suppression, and writing them conditionally trips
`useValidAriaProps`. A screen reader still hears the move through
`bindAnnouncer`; what is missing is the name on arrival.

Also still open: a `<Panel>` that is both a container and declares
`hints.render: 'flow'` reports no child geometry. `usePublishGeometry` reads
placements, and a flow container has none; the DOM measurement that covers this
for `<Container>` (`measureFlow`) stays there because it harvests the children
`<Container>` itself rendered. `<Zone>` is unaffected — a flow zone never takes
the layout-hosting path.

## Drag and drop

Shipped, and documented in the README's Drag and drop and Resize sections:
`<DragHandle>`, drop-target highlighting with an insertion-point preview,
reorder within a zone, a cursor-following ghost (`defaultDragOverlay`, replaced
via `renderOverlay`), and the settle animation (`settleMs` on `<Container>`,
suppressed under `prefers-reduced-motion`). Per-child resize shipped in 0.5.0
via `placement.size`; `resizeMode: 'neighbor'` makes a seam behave like a
splitter rather than pushing panes down the stack.

Still open:

- **Inter-zone resize** — dragging the gutter *between* zones is a
  workspace-level concern; see "Strategy for partitioning workspace".

- **A seam in an over-squeezed strip reports a slider with no range.**
  `finishBounds` (`src/layout/strip.ts`) sets `atMin` and `atMax` from
  `valueNow` against the bounds, so a container narrower than the sum of its
  panes' `minSize` floors leaves every pane at its floor with
  `valueNow === valueMin === valueMax` — both flags true, and a screen reader
  hears `aria-valuemin === aria-valuemax`. Pre-existing and unrelated to any one
  gesture; found because seam-join read those flags and armed on the first move
  in either direction, which is fixed. What a seam with no room should report
  instead is the open question.

- **Drop on a pane's edge to split it [HIGH].** Drag A over the left third of
  B and drop: B splits, A takes the new half. The gesture every tiling manager
  and VS Code has, and the one standard drop semantic this library does not.
  What was the hard part is done: `resolveDropIntent` already resolves a
  `split` intent with its edge from the cross-axis bands, and `store.split`
  already does the mutation. What is left is the commit path — `split` then
  move A into the new half — and a preview. Until then the hover refuses a
  split intent, so nothing emits one and `<Container>` never enables the
  bands.

- **A split has no live layout preview [MED].** Hovering an insertion makes the
  destination lay out as if the drop had happened — `<Container>` feeds
  `host.setPreview` an `insertId`/`insertIndex` and the panes part to make room
  (`Container.tsx:206`, `useContainerLayout.ts:84`). A split gets a drawn
  element instead (`splitPreview: 'element'`), because `LayoutPreview` models
  one extra item in a container's child list and a split preview is a nested
  group that does not exist yet: the parent must place a group in the hovered
  pane's slot and something must lay out its interior. Adding `'layout'` to
  `splitPreview` is a non-breaking addition to the union whenever that is worth
  building.

- **The declarative presets have no drop hit-test.** `stackOnDrop` and
  `splitOnDrop` are `<Container>` props, and the drop target the presets
  register through `PresetShell` passes no `getDropIntent` at all — it passes no
  `getInsertionIndex` either, so a `<Zone>` drop has always appended. Two
  features now depend on this: neither stacking nor drop-on-edge works under
  `<Zone>` / `<Panel>`, and a preset that silently appends where the same
  gesture splits under `<Container>` reads as a bug. Giving the presets an
  intent means giving them a hit-test first, which is the same work either way;
  nothing about the resolver is imperative-only, and fixing it also fixes plain
  appending for every preset drop.

- **`<Zone config>` is read once, at creation.** `makeReconciler` reconciles
  `meta`, `hints`, `placement`, `lock` and `pinned`, and `<Zone>` adds
  `state` — but nothing reconciles `config`, so re-rendering with a changed
  `config` prop is silently ignored and the only way to change it is
  `store.updateContainerConfig`. Found while testing a stack's `activeId`.
  Either reconcile it or say in the prop's doc that it is initial-only; today
  it reads as a controlled prop and is not one.

- **Switching a stack's tab is gated by `lock.arrange`.** `useStack().activate`
  writes through `updateContainerConfig`, which asserts that axis, so a stack
  locked against rearrangement also cannot switch tabs. Activation is not
  arrangement. The fix is a lock axis or an exemption, and neither is obviously
  worth it — recorded in the drop-intent design as a known wart.

- **A stack's body swallows clicks on its own tab strip.** The nested
  `<Container>` is a full-box element overlapping the band `headerSize`
  reserved, so a strip drawn before it in DOM order needs raising — the story
  does it with one `z-index`. Every consumer drawing a strip will hit this.
  Either the reserved band should not be part of the body element, or the
  README's one-line warning is the whole fix.

- **Two gesture pipelines are converging.** `DragController` drags panes and
  owns arm/cancel/commit/lock/undo/announce; `AffordanceHandle` drags seams and
  owns none of it, because until now a seam drag only wrote `placement.size`.
  Seam-join is the first seam gesture that mutates the tree, so it reimplements
  all six in the React layer. One duplicate is not yet an abstraction — the
  point to extract a shared gesture lifecycle is when a third copy appears, and
  the seam to watch is `trackJoin` (`src/layout/seam-join.ts`), which is already
  shaped for it. Tab-stacking did not add one: drop intent rides
  `DragController`, which already owns all six.

- **Open question, nothing decided: should input binding come from
  `@weasel-js/gestures`?** That package (1.0.4, zero dependencies, no React or
  DOM) is a route grammar — `drag.handle`, `alt+drag.seam` — parsed and matched
  against a normalized input event, plus a `describeRoute` that renders a
  binding in plain English. It answers "which input happened and what is bound
  to it," which windease has no vocabulary for at all: today a seam drag starts
  because `pointerdown` is wired to a handle, and a consumer cannot rebind it.

  It does *not* answer the harder half — an in-flight gesture accumulating
  toward a commit, its intent resolved from geometry (overshoot past a clamp,
  edge band, midpoint) and gated by locks. Every drag semantic this library has
  or wants is one `drag` atom to that grammar.

  So the trigger that would justify the dependency is a consumer asking to
  *rebind* a gesture, not the semantics catalog growing. Nobody has asked.
  Weigh against it: `@weasel-js/labkit` already depends on `windease ^1.2.1`,
  so taking the dependency puts both directions across one repo boundary and
  makes a coordinated change a two-release sequence. Worth stealing regardless
  of the outcome: the `GESTURE_DESCRIPTORS` shape, one table every consumer
  reflects off, so adding an entry updates the matcher and the UI together.

## Policies the library exports but nobody can replace [MED]

`<Container>` ships two props of the same shape: `overlay` and `affordances`
each take the built-in default *or* a function that replaces it, with the
component still doing the measuring and handing the result over as context.
`dropIntent` is the third. Each entry below is a pure policy the library
exports and then calls from exactly one hardcoded site, so a consumer who
wants a different rule can only re-implement it and correct the result after
the fact.

- **`chooseSuccessor`** (`src/focus/successor.ts:30`) picks who receives focus
  when the focused node is destroyed. Wanting the left sibling rather than the
  successor means listening for the focus event and moving focus again.
- **`resolveNavigation`** (`src/focus/resolve.ts:77`) resolves directional
  keyboard navigation from geometry. It already takes a `ResolveInput` bag, so
  the callback shape is designed; nothing accepts one.
- **A container's `canAccept`.** `<Container>` passes `undefined` for the drop
  target's (`Container.tsx:302`), so per-container acceptance is only
  expressible through a strategy's `canAccept` — per-strategy, not
  per-container — or `lock.accept`, which is all or nothing.
- **Edge-scroll tuning.** `<Container>` forwards only `scrollEl` to
  `DropTargetOptions`, leaving `edgeScroll`'s rate and threshold unreachable.
  Not a resolver, but the same dead end.

`insertionIndexByMidpoint` and `axisFromRects` are deliberately absent:
`dropIntent` subsumes both, because replacing the resolver replaces the calls
to them.

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
WebKit; the config starts Ladle itself, so there is nothing to run first. 62
specs across fourteen files cover the gestures jsdom cannot: gutter resize
including pointer-capture tracking after the cursor leaves the handle,
cross-zone drag with escape-cancel and drop-outside, ResizeObserver relayout on
viewport change, insertion index against a pinned head, a seam pushed past its
clamp until the join arms, and — in `capabilities.spec.ts` — keyboard move, flow
mode, grid `overflowMode` and a drag held at a scrolling container's edge. All
three engines pass the pointer-capture cases unmodified.

Nothing listed here is uncovered. `e2e/tab-stack.spec.ts` closed the last one —
drop *intent*, "into the seam between B and C" versus "onto B itself" — which
was a library gap rather than a suite gap. It drives the band geometry a real
pointer resolves against, which jsdom has no layout to answer.

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
- **`unplace` never reports overflow.** The one pane that must be placed when
  nothing fits is clamped to the container rather than overflowed, so a
  consumer who would rather see the excess than a clamped pane has no way to
  ask for it. A choice, not a law — revisit if anyone wants the other one.
- **`unregisterNode`'s cascade does not check descendant locks.** It asserts
  `lock.destroy` on the id it is handed, then clears the subtree through
  `detachAndRemove`, which asserts nothing — so a destroy-locked node nested
  inside a destroyed subtree dies silently. Nothing reaches this today by
  gesture; seam-join is the first thing that would, and it declines to, by
  refusing to arm when any descendant is locked (`destroyBlockedBy`). Fixing it
  in the store is the real repair, and it is a behavior change: hosts that
  destroy a subtree today would start throwing.
- `applyReconfigure` merge-patches the container config, so a key from the
  abandoned strategy survives (a `grid` root's `cols` outlives the switch to
  `strip`). Deliberate — replacing wholesale would discard consumer intent like
  `gap` — and pinned by a test. Revisit only if a strategy ever rejects unknown
  keys.

## Consumer evaluations, both closed

Two hosts were evaluated against windease and every gap either found has
shipped: a sidebar of resizable tool palettes (the weasel case) and an app
that already owns its workspace list and wanted geometry and gestures only
(`@weasel-js/labkit`). What they produced is in [`CHANGELOG.md`](CHANGELOG.md)
under 1.2.0 and Unreleased; the patterns they argued for — content sizing,
collapse, overflow policy, controlled child order, in-flow rendering — are
documented in the README.

Keep this section as the note that neither evaluation is a live workstream.
A third consumer is the thing that would earn a new one.

## Merging adjacent nodes

Filed as one question — "should adjacent nodes be able to merge?" — but it was
three unrelated features sharing a verb, and separating them was the point.
Coalescing shipped as `setAutoUnsplit` and seam-join as `joinOnOvershoot`;
tab-stacking is what is left.

- **Tab-stacking two panes into one — shipped.** `<Container stackOnDrop>`
  turns a drop in the middle of a pane into a tabbed stack. `resolveDropIntent`
  answers the hit-test, `store.stackNodes` does the wrap, `stackStrategy` shows
  the active child, and `useStack` is the tab model the consumer draws from.
  Documented in the README's Drag and drop section; `src/dnd/dropIntent.ts`,
  `src/layout/stack.ts` and `e2e/tab-stack.spec.ts`.

- **Joining panes by dragging a seam past a neighbor's floor — shipped.** A
  strip opts in with `joinOnOvershoot`; overshooting a floor by `joinThreshold`
  arms the gesture and releasing there closes the pane, with `lock.destroy` on
  the pane or any descendant refusing to arm. Documented in the README's Resize
  section; `src/layout/seam-join.ts` and `e2e/seam-join.spec.ts`.

All three have shipped. Drop-on-edge is what the intent hit-test was built for.


## Canvas-host ergonomics

Raised by klieg's tube lab (`packages/core/dev/tube-lab`), the WebGL consumer
already described under "DOM-proxy focus adapter for canvas hosts". It draws
sixteen panels as scissor rects on one `WebGLRenderer`, positioning them from
placements, so the canvas is one element spanning the whole zone rather than
one per window. Both ergonomics it asked for shipped —
`.windease-zone--unclipped` and `observePixelRatio`.

Note the consumer is pinned at `^0.8.0` and has not taken 1.0 yet, so it still
carries a hand-rolled balanced-tree builder (`tree.ts`) working around
`initialState`. Deleting that is klieg's migration to do, not a windease item —
but it means feedback from that lab is 0.8-shaped until the upgrade lands.

## Floating chrome over a tiled zone [HIGH]

Every shipped strategy tiles: `grid`, `strip` and `stack` partition their
container between their children. Nothing places a window free *over* content,
which is what viewport chrome — a legend, a minimap, an inspector puck — needs.

Planned in `docs/superpowers/plans/2026-08-23-floating-strategy.md`, against a
design in klieg at
`docs/superpowers/specs/2026-08-23-legend-palette-design.md`.

`floatingStrategy(inner?)` is a decorator rather than a peer. `layout()` splits
`items` on `meta.floating`, hands the rest to `inner` against the **full**
container so tiling is unchanged and reserves no room for the panel, places the
floating ones from its own state, and merges both into one `placements` map.
Affordance ids are namespaced (`floating:drag:<id>`) so `reduce` routes by
prefix. `canAccept` and `navigate` delegate, with floating items filtered out so
the inner strategy never counts them; `configSpec` is the union of both. No
existing strategy changes, and a container that wants no tiling wraps nothing.

Three findings from designing it, each of which shaped the API:

- **Eligible corners cannot be container config.** `ConfigFieldSpec` is
  `'number' | 'boolean' | 'string' | readonly string[]`, where the array form is
  an enum of allowed *scalars* (`field.includes(value)`), and
  `checkStrategyConfig` reports unknown keys — so a list-valued config key both
  fails validation and cannot be declared. Eligible corners are therefore
  per-item `meta.snapCorners`, which is also the better semantics: `LayoutItem.meta`
  *is* the `membership.placement` bag where `pinned` already lives, and two
  floating panels in one container can differ. Container config keeps only the
  scalars `inset`, `snapThreshold` and `defaultAnchor`.

- **State is `{ x, y, anchor }`, not `{ anchor } | { x, y }`.** The union
  deadlocks: while snapped, `layout()` resolves to the corner origin, so every
  incoming delta is measured from that same origin and a slow drag outward
  re-snaps forever. The continuous position must always accumulate, with
  `anchor` a sticky cache over it. Storing `anchor` is still what makes a resize
  exact. The visible consequence is correct sticky-snap behavior: un-snapping
  jumps the panel up to `snapThreshold` px at once.

- **`reduce` must work from absolute `payload.point`, not `dx`/`dy`.** Per the
  `LayoutEvent` doc, a strategy whose extents are quantized never accumulates
  small deltas. Motion is the difference between successive absolute points, so
  the first event of a gesture only records the pointer and moves nothing.

There is no drag-end event (`LayoutEvent.kind` is `'drag' | 'click' | 'key'`), so
the snap is live during the drag and commits wherever the pointer is released,
rather than resolving on release.

**Deferred — `LayoutResult` carries no z-order.** Nothing in the contract says a
floating item renders above a tiled one; today that falls to the host's render
order. The options were an optional `z` on `LayoutResult`, or a separate
`floating?: Map<ItemId, Rect>` key alongside `placements`. Both widen a type
every strategy and every host shares, to serve a need only this strategy has so
far, so it stays the host's problem until a second caller wants it.

First consumer: klieg's corner lab, through a `FloatingPanel` in
`@weasel-js/labkit`.
