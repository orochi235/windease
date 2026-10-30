# TODO

Future work, sectioned by item. Append new ideas here rather than scattering
them. Tag major items with `[HIGH]`, and ones worth doing but not next with
`[MED]`. What has already shipped is in
[`CHANGELOG.md`](CHANGELOG.md).

## Test-harness gaps

- **WebKit sometimes leaves Chrome's 150th tab open after its close button is
  clicked** (2026-10-30). `exotic-desktop.spec.ts:293`, "closing the active
  last tab falls back to the first tab", times out waiting for
  `tab-chrome-tab-150` to go. It failed in two consecutive full fleet runs on
  main from 24ec47d (lay out only visible children), on the first try and the
  retry in one and on the first try only in the other, which ran on an
  uncontended fleet. It passed in the run at bca6f04 just before, and 3/3 when
  run alone. That it is always this one test, rather than a wandering set, is
  why it does not look like the load mode below. Unknown whether 24ec47d
  caused it.

- **A geometry read outside a poll can catch a layout that is still arriving.**
  Panes render in flow until their container has measured itself, and animate
  between placements after that, so a box read the instant a story opens or a
  gesture ends is a frame on the way to the layout. It reads as "the gesture
  did nothing". `openStory` cannot wait it out: every preset stamps
  `data-node`, and the zone above them satisfies it on the first paint.

  The rule, stated on `boxOf` in `e2e/fixtures.ts`: a read that feeds a gesture
  or stands as a baseline uses `settledBox`, and an assertion about where
  something ended up goes through `expect.poll`.

  `e2e/raw-geometry.grit`, a Biome plugin, fails the lint on a `boundingBox()`
  outside `fixtures.ts` and on an awaited `boxOf` in a test body outside
  `expect.poll`.

  Still short of it:

  - Assertions about the layout a story opens with read `settledBox` and then
    `expect`. The lint cannot tell one from a baseline.
  - An assertion that a gesture moved nothing reads a settled box, since a poll
    would pass at once. It still passes on a read taken before a wrong change
    starts; only a separate signal that the gesture landed would close that.

- **The suite fails under machine load, and the failing specs move between
  runs.** Reproduces readily once the load average passes roughly twice the
  core count — three consecutive full runs at 25–32 on a 12-core machine
  produced three non-overlapping failure sets. That wandering is the signature:
  a red run whose failures move when you re-run it is the machine, not your
  change. `--workers=2` does not rescue it, and re-running one spec alone
  always passes, so isolation proves nothing either way.

  `scripts/flake-census.mjs` measures this rather than reasoning about it:
  it repeat-runs the suite in an `idle` and a `loaded` arm and ranks every
  test by failure rate and mode. The ordering above is a heuristic until a
  census replaces it.

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

## Workspace

Zones nested under one root container tile, with draggable gutters between
them: the Ladle Playground builds a single root `strip` and derives `main`,
`sidebar` and `dock` from it through `store.split`. Zones a consumer composes
as *separate roots* in its own CSS share one coordinate space
([design](docs/superpowers/specs/2026-08-22-root-origin-geometry-design.md)),
and `<Workspace>` gives them seams, a root that hides when its seam is pushed
past the floor, and one root zoomed over the rest — documented in the README's
**Workspace: seams between separate roots**, with `arrangeWorkspace`
(`src/workspace.ts`) underneath.

No consumer has used it yet: `brainhouse/client` and `@weasel-js/labkit` both
build their shells as nested strips.

Open question:

- **Zone roles, if apps keep writing the same lookup.** Today an app keeps its
  own ids for "main" and "dock"; `store.getRoot` and `moveNode` cover "which
  zone has focus" and "promote to main" (README, Workspace). The next step, if
  wanted, is `hints.role` on a root (free-form, never interpreted, carried by
  snapshots since they copy `hints` whole) and `store.rootWithRole(role)`, so
  generic UI such as a "Send to main" command can be written against roles. It
  adds without breaking anything, so long as nothing else claims `hints.role`.
  Name it there rather than on `meta` (app data) or `kind` (chrome dispatch).
  A dock that follows the focused root is a separate step: `<Workspace>` would
  start placing roots, which today only the app's CSS does, so it needs a
  design first.

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

- **A preset drop draws a split preview — shipped.** `<Zone>` and
  `<Panel container>` build the same `LayoutPreview` `<Container>` does from the
  intent their own hit-test resolved, so both the insertion gap and the split
  halves show under the cursor. `splitPreview` is a preset prop now, with the
  same three modes. `useDropPreview` (`src/react/dnd/useDropPreview.ts`) is the
  one place the bag is built; `presets.split-preview.test.tsx` and the preview
  block in `e2e/declarative-drop.spec.ts` cover it, driving the
  **Declarative / Drop intent** story's `splitPreview` toggle.

- **The presets edge-scroll — shipped.** `scrollRef` and `edgeScroll` are
  preset props, so a `<Zone>` reports its wrapper's offset to the geometry
  registry and registers the scroll bag `DragController` ramps against.
  `presets.scroll.test.tsx` covers both halves; the
  **Scrolling / Preset drag to the edge to scroll** story is what
  `e2e/capabilities.spec.ts` drives.

- **`insertionIndexByMidpoint` and `axisFromRects` stay unreplaceable,
  deliberately.** `dropIntent` subsumes both, because replacing the resolver
  replaces the calls to them.

- **Pane drags and seam drags share one gesture lifecycle (2026-10-27).**
  `Gesture` (`src/gesture.ts`) is headless. A drag runs through it in four
  steps: `begin` under a lock check, `offer` a target under another lock check,
  `release` to commit, or `cancel`. The commit runs inside one labeled
  transaction unless the store call it makes is already one undo step. While
  armed, `state().message` is the line a live region reads. Each pipeline keeps
  its own reducer for deciding what to offer: `DragEngine`'s hit-test and accept
  checks, `trackBury`, `trackReveal`. `DragEngine` runs every pane drag through
  a `Gesture`. `AffordanceHandle` and `RevealHandle` bind one with `useGesture`
  (`src/react/useGesture.ts`). `cancelOnEscape` (`src/gesture-dom.ts`) is the
  window Escape binding all three use. The window `pointerup` safety net is
  still written twice, in `DragController` and `RevealHandle`. `Gesture` is not
  exported: a consumer writing a function-form `affordances` renderer still
  rebuilds the lifecycle by hand.

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
  Weigh against it: `@weasel-js/labkit` already depends on `windease ^2.0.0`,
  so taking the dependency puts both directions across one repo boundary and
  makes a coordinated change a two-release sequence. Worth stealing regardless
  of the outcome: the `GESTURE_DESCRIPTORS` shape, one table every consumer
  reflects off, so adding an entry updates the matcher and the UI together.

## Focus bookkeeping

Nothing open. `strategy.navigate`'s answer is validated now — an id naming a
node with no `focus` capability, and a `navigate` that throws, are traced on
`workspace` and answered by the geometric search, the same contract a
replacement `resolveNavigation` policy already had (`src/focus/resolve.ts`).

## Playwright e2e suite

Shipped. `npm run test:e2e` drives the Ladle stories in Chromium, Firefox and
WebKit; the config starts Ladle itself, so there is nothing to run first. A tag
cannot publish without a green run of it (`scripts/require-green-ci.sh`, called
from `release.yml`). The specs cover the gestures jsdom
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

## Strategy wrappers forward through one helper

`floating`, `desktop`, `page` and `warp` forward their inner strategy's hooks
through `forwardInner` (`src/layout/forward.ts`), each describing how its frame
differs — which children, which config, which state, and how a point moves.
`wrapper-forwarding.test.ts` fails when a wrapper drops a hook in
`FORWARDED_HOOKS` (2026-10-27). Still open:

- **`cellAt` and `canAccept` under `page`.** Neither is handed container state,
  so page cannot know which page shows; grid's `drop.cell` does nothing under
  `pageStrategy(gridStrategy)`. Closing it means adding `state` to both hooks'
  input. Whether a paged inner's capacity should count per page or not at all
  is undecided either way.
- **`getDropPreview` is forwarded by no wrapper.** Each wrapper reshapes the
  inner result, so the fast path would answer in the wrong frame; the host
  falls back to `layout({ preview })`, which is correct and slower.
- **Key-name drift**: desktop's `resize` / `overflow` against strip and grid's
  `resizable` / `overflowMode`; `handleSize` defaults to 0 on floating and 22
  on desktop; repel's `gap` defaults to 8, every other strategy's to 0.

## Loose ends

- typedoc runs from a pinned `npx` install carrying TypeScript 6.0.3
  (`docs:api`), because it needs the compiler API that TypeScript 7 dropped.
  Move it back to a devDependency once typedoc supports TS 7.
- `scripts/strip-ladle-tsx.sh` (run from `prepare`) works around Ladle shipping
  raw `.tsx` in its typings, which fails typecheck under TS 7. Drop it once
  Ladle ships only `.d.ts` there.
- **Every `REJECT` trace in `DragEngine.checkAccept` fires per pointermove
  sample**, not per hover transition — the per-frame chatter the tracing tenet
  in `CLAUDE.md` warns against. Left as is: those lines are the whole record of
  why a drop was refused, and `dnd` is off by default.
- **Four React tests print "Cannot update a component (`ZoneWithLayout`) while
  rendering a different component (`Panel`)"** (one names `PresetShell`), and
  still pass: the controlled-placement hide in `seam-bury.test.tsx`,
  `palette-dock.test.tsx`, `presets-affordances.test.tsx`, and the lock rerender
  in `lock.test.tsx`. All four printed it when `src/react` ran as a whole on the
  fleet at `c84beef`. Run alone, `seam-bury.test.tsx` and
  `palette-dock.test.tsx` print nothing. Something in `Panel`'s render sets its
  parent's state.
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
Coalescing shipped as `setAutoUnsplit` and seam join as `joinOnOvershoot`, since
renamed burying, `overshoot: 'destroy'` (2026-10-28);
tab-stacking is what is left.

- **Tab-stacking two panes into one — shipped.** `<Container stackOnDrop>`
  turns a drop in the middle of a pane into a tabbed stack. `resolveDropIntent`
  answers the hit-test, `store.stackNodes` does the wrap, `stackStrategy` shows
  the active child, and `useStack` is the tab model the consumer draws from.
  Documented in the README's Drag and drop section; `src/dnd/dropIntent.ts`,
  `src/layout/stack.ts` and `e2e/tab-stack.spec.ts`.

- **Burying panes by dragging a seam past a neighbor's floor — shipped.** A
  strip opts in with `overshoot: 'destroy'`; overshooting a floor by `buryThreshold`
  arms the gesture and releasing there closes the pane, with `lock.destroy` on
  the pane or any descendant refusing to arm. Documented in the README's Resize
  section; `src/layout/seam-bury.ts` and `e2e/seam-bury.spec.ts`.

All three have shipped. Drop-on-edge is what the intent hit-test was built for.


## Canvas-host ergonomics

Raised by klieg's tube lab (`packages/core/dev/tube-lab`), a WebGL consumer. It draws
its panels as scissor rects on one `WebGLRenderer`, so the canvas is one element
spanning the whole zone rather than one per window. Both ergonomics it asked for shipped —
`.windease-zone--unclipped` and `observePixelRatio`.

The lab no longer imports windease. Since `klieg@f441b90` (2026-08-22) it tiles
through `@weasel-js/labkit`'s `<Workspace>`, which brings windease in as its own
dependency, and reads each tile's rect back from the DOM instead of from
`placements`. Anything it asks for now arrives by way of labkit.

## Exotic presets: open questions [MED]

Rescued from the `exotic-layout-fixtures` handoff when that worktree was
removed; the branch itself is merged. The build status of the preset schema
lives in the phase table of
[`docs/superpowers/specs/2026-09-18-declarative-presets-design.md`](docs/superpowers/specs/2026-09-18-declarative-presets-design.md),
checked against the code on 2026-10-12.

Decided in conversation and recorded nowhere else:

- **The finish line** is that the schema expresses essentially every behavior
  the presets' products have, with stories drawing chrome only. "A key needs 2+
  presets" was rejected as the bar, though it is a fine order to start in.
- Presets are meant to become canned presets. Whether they ship publicly, out
  of `test-utils`, is undecided.
- Sample data (titles, content sizes, generated items, CSS) stays separate from
  mechanics, in code and in the story tabs.
- Desktop `overflow` defaults to `'scroll'`, today's behavior; presets opt into
  `'clip'`.
- Excel's preset scrolls both ways behind `sticky` headings (2026-10-26); the
  Exotic grid story gives any preset whose root sets `overflowMode: 'scroll'`
  a scroll box at its viewport.

Everything the design doc names is built. Built with no preset using it: `zoom`, `drop`, pages, stack `tabs: 'stacked'` and
floating `snap: 'fill'`. The Firefox and Win 10 presets set `reorder`; Chrome's
tabs are a stack's band, drawn by the story, so the key does not reach them.

Open, grouped by what they touch:

- **strip** — under `justify: 'between'` only the first seam follows the
  pointer, since every pane's size moves every gap; `resizeMode: 'neighbor'`
  is the answer today.
- **grid** — capacity by width under fixed cells; pinned vs celled
  priority. Flowed items under a row cap still cost O(items² × span) in resize
  reach — 200 panels under `maxRows: 420` take 2.0s a layout, measured
  2026-10-26 — because first-fit packing is not monotone in span, so every span
  is probed; going further needs reach to be bounded or computed lazily.
- **accepts and locks** — `accepts: false` and `lock.accept` both stay
  (accepts is drag-only); stack/split drops honor `accepts.kinds`, and count
  toward `accepts.max` only where they add a child. `lock: true` does *not*
  include the `hide` axis, which protects apps that lock with `true` and still hide via a
  View menu — making `true` mean every axis needs a README breaking-change note.
- **reorder** — a `<Zone>` declaring `reorder` or `raise` (the latter since
  2026-10-26) keeps the store's order (acting as `sort={preserveStoreOrder}`)
  unless `sort` is passed: keep that implicit or make it opt-in? Press-and-hold to start a touch drag, so a swipe still
  scrolls a list of `reorder` rows, would beat `touchScroll` turning touch
  drags off; it is a new gesture mode in `DragController`.
- **stack** — Stacked with `side` left/right gives vertical
  columns, which i3 has no equivalent for. `strict` never applies to
  drop-splits, since `DragProvider` carries no size.
- **view, tear, step/zoom** — persist `view` in snapshots? `<Panel container>`
  view/fit; pass scale to custom affordance renderers. The default body-size
  tear is huge (`tearSize` is the practical answer); a drag-start threshold.
- **packers** — per-box rotation greed can load less than upright (van 5/14 vs
  7; pallets on column/shelf). `justified` without `minRowHeight` can crush
  most of a feed into one row: the Justified story at width 520, row height
  220 puts 35 photos in one 6px row, because summed squared deviation charges
  per row and the panoramas cost more apart than together. Should a floor
  default to some fraction of `rowHeight`, or the cost weigh each row by its
  items?
- **elsewhere** — a viewport vs border-box zone makes rows 2px wider than a
  bordered zone; is that a library fix?
