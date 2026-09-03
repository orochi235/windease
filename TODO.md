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

- **A geometry read straight after `openStory` can catch a preset tree
  mid-layout.** Fixed for `declarative-keyboard.spec.ts`, which read the left
  column's pane boxes before the column had measured itself and placed them —
  the panes render in flow at full height until then, and `openStory` cannot
  wait that out, because every preset stamps `data-node` and the zone above them
  satisfies it on the first paint. That spec polls now.

  `settledBox` (`e2e/fixtures.ts`) is the poll to reach for — a box read the
  instant a gesture changes the layout is a frame of the settle animation
  rather than the layout, which reads as "the gesture did nothing". Still
  exposed, worst first by ratio of geometry reads to polls:
  `floating.spec.ts` (18 reads, none), `resize.spec.ts` (10, none),
  `content-sizing.spec.ts` (17, 4 — and it has actually failed this way),
  `stacking.spec.ts` and `declarative-drop.spec.ts` (6, none).

- **The suite fails under machine load, and the failing specs move between
  runs.** Reproduces readily once the load average passes roughly twice the
  core count — three consecutive full runs at 25–32 on a 12-core machine
  produced three non-overlapping failure sets. That wandering is the signature:
  a red run whose failures move when you re-run it is the machine, not your
  change. `--workers=2` does not rescue it, and re-running one spec alone
  always passes, so isolation proves nothing either way.

  Three distinct modes, and only the first is bounded by anything:

  - **Story-load margin.** `openStory` waits for the first placed node; against
    a cold Vite cache under load that cost 6216ms on Firefox against 2381ms on
    WebKit, past the default 5s. Now a condition-based wait with a 30s budget
    (`e2e/fixtures.ts`), sized against the 15.4s the slowest cold-cache test
    takes. `scripts/probe-story-load.mjs` measures it per engine.
  - **Whole-test timeout**, seen on both Firefox and WebKit: a single call
    never resolves — `keyboard.press`, a drop — and the test hits Playwright's
    own 30s. Nothing bounds this; it is starvation, and raising the budget only
    trades a red run for a slow one.
  - **A geometry assertion read mid-layout**, the entry above — a real
    `toBeGreaterThan` failure rather than a timeout, so it is the one mode that
    can be mistaken for a genuine regression.

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

## Strategy for partitioning workspace [MED]

Zones nested under one root container already tile, with draggable gutters
between them: the Ladle Playground builds a single root `strip` and derives
`main`, `sidebar` and `dock` from it through `store.split`. Zones a consumer
composes as *separate roots* in its own CSS share one coordinate space too —
each root `<Container>` measures itself into the geometry registry
([design](docs/superpowers/specs/2026-08-22-root-origin-geometry-design.md)) —
so directional navigation and `Shift`-arrow moves cross between them. What the
library has no opinion about is the arrangement itself: collapsible sidebars,
gutters *between* roots, full-screen takeover.

**A `<Workspace>` primitive is not what a consumer is asking for.**
`brainhouse/client`, the only application consumer, composes its shell from one
root container plus its own CSS, and both things it hand-rolls against the
library are *sizing*: a loop fitting a section to its content until a gutter
drag stops it, and a clamp capping a sidebar's width. The first is
`hints.sizing` plus the release recipe in the README's **Sizing a pane to its
contents**; the second is `hints.maxSize`. Neither is an arrangement primitive
([design](docs/superpowers/specs/2026-08-24-content-size-rearm-design.md)).

Still open, waiting for a consumer to ask:

- The arrangement itself — a gutter *between* separate roots, a collapsible
  sidebar, full-screen takeover of one zone.
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
suppressed under `prefers-reduced-motion`). A prospective split previews as a
live layout (`splitPreview: 'layout'`, now the default). Per-child resize
shipped in 0.5.0 via `placement.size`; `resizeMode: 'neighbor'` makes a seam
behave like a splitter rather than pushing panes down the stack.

Still open:

- **Inter-zone resize** — dragging the gutter *between* zones is a
  workspace-level concern; see "Strategy for partitioning workspace".

- **A preset drop draws no split preview [MED].** `<Zone>` and `<Panel>` now
  resolve a `split` intent, but `splitPreview` is a `<Container>` render, so a
  preset split is aimed blind. The same is true of the insertion preview, which
  `<Container>` feeds through `host.setPreview`. What a preset would need is
  already built — `LayoutPreview.split` and `ContainerHost`'s overlay are where
  the work lives, and both are preset-agnostic; the presets just never build the
  bag ([design](docs/superpowers/specs/2026-08-26-split-layout-preview-design.md)).

- **A wrap drop is asked about the wrong child list [MED].**
  `DragEngine.checkAccept` (`src/dnd/DragEngine.ts:349`) gates on `checkIntent`
  and then falls through to the acceptance block regardless, so a `stack` or
  `split` intent is asked about `[...children, dragged]` — but a wrap drop does
  not change the parent's child count: stacking `p` onto `a` in `[a, b]` yields
  `[stack-1, b]`. A `strip` at `maxItems: 2` therefore refuses a stack that
  would have left it at two. This already governed `strategy.canAccept`;
  `acceptPolicy` now inherits it. The fix is a prospective list that knows the
  intent, with its own tests.

- **The presets cannot edge-scroll [MED].** `scrollRef` is a `<Container>` prop
  (`src/react/Container.tsx:103`), so a preset's `scrollEl` is always null and
  `DragController` never registers the scroll bag for it. That is why
  `edgeScroll` ships on `<Container>` alone — the presets would need a
  `scrollRef` of their own before the ramp meant anything there.

- **`insertionIndexByMidpoint` and `axisFromRects` stay unreplaceable,
  deliberately.** `dropIntent` subsumes both, because replacing the resolver
  replaces the calls to them.

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

## Focus bookkeeping

- **`strategy.navigate`'s answer is never validated [MED].**
  `src/focus/resolve.ts:102` casts it `as NodeId` and returns it, so a custom
  strategy can name a node with no focus capability — and `FocusProvider` calls
  `store.focusNode(to)` from a raw `keydown` listener with no try/catch
  (`src/react/focus/FocusProvider.tsx:225`), so the `CapabilityMissingError`
  takes out the keypress. `resolveNavigation` validates a *policy's* answer with
  `isFocusable`; the strategy path beside it does not.

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
WebKit; the config starts Ladle itself, so there is nothing to run first. A tag
cannot publish without a green run of it (`scripts/require-green-ci.sh`, called
from `release.yml`). 87 specs across eighteen files cover the gestures jsdom
cannot: gutter resize including pointer-capture tracking after the cursor leaves
the handle, cross-zone drag with escape-cancel and drop-outside, ResizeObserver
relayout on viewport change, insertion index against a pinned head, a seam
pushed past its clamp until the join arms, and — in `capabilities.spec.ts` —
keyboard move, flow mode, grid `overflowMode` and a drag held at a scrolling
container's edge. All three engines pass the pointer-capture cases unmodified.

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

- **`store.subscribe` cannot be passed detached.** It is a prototype method
  reading `this.subscribers`, so the idiomatic
  `useSyncExternalStore(store.subscribe, ...)` throws
  `Cannot read properties of undefined (reading 'subscribers')` — and that is
  the first thing a consumer wiring the store into React writes. Every shipped
  hook goes through the provider and never hits it. Making it an arrow property
  fixes it without changing the signature.

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
- **Every `REJECT` trace in `DragEngine.checkAccept` fires per pointermove
  sample**, not per hover transition — the per-frame chatter the tracing tenet
  in `CLAUDE.md` warns against. Left as is: those lines are the whole record of
  why a drop was refused, and `dnd` is off by default.
- **`unplace` never reports overflow.** The one pane that must be placed when
  nothing fits is clamped to the container rather than overflowed, so a
  consumer who would rather see the excess than a clamped pane has no way to
  ask for it. A choice, not a law — revisit if anyone wants the other one.
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

## Floating chrome: z-order [MED]

`floatingStrategy` shipped, but `LayoutResult` still carries no stacking order,
so nothing in the contract says a floating item renders above a tiled one —
today that falls to the host's render order. The options were an optional `z` on
`LayoutResult`, or a separate `floating?: Map<ItemId, Rect>` key alongside
`placements`. Both widen a type every strategy and every host shares, to serve a
need only this strategy has so far, so it waits for a second caller.

## Floating chrome: no keyboard move [MED]

`AffordanceLayer` binds its key handler only to an affordance carrying `bounds`,
which models a one-axis range — a seam's extent — and a free position is two
axes with no meaningful min or max. So a floating panel is pointer-only, and a
keyboard user cannot move it. Either `bounds` grows a two-axis form or the
affordance layer takes a second keyboard contract; neither is worth designing
before something wants it.

First consumer: klieg's corner lab, through a `FloatingPanel` in
`@weasel-js/labkit`.
