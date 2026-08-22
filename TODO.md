# TODO

Future work, sectioned by item. Append new ideas here rather than scattering
them. Tag major items with `[HIGH]`. What has already shipped is in
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

**One thing a `<Workspace>` has to solve, found building the keyboard-move
story.** Sibling *root* containers share a coordinate space they cannot
distinguish: `<Container>` composes each child rect against its own registry
entry, and a root has none, so every root's children land at origin `(0,0)`
and overlap. Directional navigation and `Shift`-arrow moves therefore work
*within* a root and between containers nested under a common placed parent —
which is why that story nests two groups under one root — but not between two
top-level zones laid out by consumer CSS. Whatever owns multi-zone layout has
to report each zone's origin into the geometry registry; a `scrollRef`-shaped
input on the zone would do it without the core learning about the DOM.

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
WebKit; the config starts Ladle itself, so there is nothing to run first. 48
specs across eleven files cover the gestures jsdom cannot: gutter resize
including pointer-capture tracking after the cursor leaves the handle,
cross-zone drag with escape-cancel and drop-outside, ResizeObserver relayout on
viewport change, insertion index against a pinned head, and — in
`capabilities.spec.ts` — keyboard move, flow mode, grid `overflowMode` and a
drag held at a scrolling container's edge. All three engines pass the
pointer-capture cases unmodified.

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
Coalescing shipped as `setAutoUnsplit`; these two are what is left, in the
order they should be done.

- **Tab-stacking two panes into one.** Drop A onto B's body and the two
  become a tabbed stack. The real work is not the merge, it is drop *intent*:
  the hit-test has to separate "into the seam between B and C" from "onto B
  itself", which `insertionIndexByMidpoint` deliberately does not do — it
  answers only the first question. Needs a stack container preset and a tab
  strip on top of that. The largest of the three by a wide margin.

- **Joining panes by dragging a seam past a neighbor's floor.** A resize
  gesture that ends in a destroy. It has to answer to `lock.destroy` on a
  pane the gesture never targeted, and the point of no return has to be
  visible before the pointer is released, or the user destroys a pane by
  overshooting. The gesture is small; the affordance design is not.

Neither is blocked on anything.


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
