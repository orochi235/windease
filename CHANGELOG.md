# Changelog

What changed in each published version, for someone deciding whether to upgrade.
Migration steps for breaking changes live in the README under
[Breaking changes](README.md#breaking-changes); entries here link there rather than
repeating them. `scripts/check-changelog.sh` fails a release whose version has no
section below.

## Unreleased

### Added

- **`LayoutResult.channels`** carries per-placement numbers the core never
  reads — an opacity, a rotation, an LOD tier — from a strategy to its host.
  Deliberately untyped (`Map<id, Record<string, number>>`): the library commits
  to the transport, not to a vocabulary it has no predicate over, and every
  value being a `number` is what lets a host interpolate two results without
  knowing what any key means. `ContainerHost` republishes it unchanged and
  leaves the field absent when a strategy emits none.

- **`store.moveNodes(ids, toParentId, at?)`** moves a set of nodes into one
  parent as a single operation. The set is validated in full before the first
  mutation — a `moveNode` loop that meets a locked node halfway throws with the
  earlier nodes already moved, and `transact` does not roll back. `at` resolves
  once so the run lands in source order rather than reversed, and the source
  container is judged for `autoUnsplit` on the state after the whole batch, so
  it cannot dissolve out from under the rest of the run. See
  [Moving several panes at once](README.md#moving-several-panes-at-once).

- **`placeRunRespectingPins(order, movingIds, desired, pinnedIndexOf)`** is the
  existing `placeRespectingPins` rule for a whole run: the moving ids take
  consecutive free slots at or after `desired`, so a batch inserted next to a
  pin stays contiguous instead of being interleaved with it.
  `placeRespectingPins` is now the single-node case of it.

- **`DropIntentContext` is exported from `windease/react`.** It is the argument
  type of the public `<Container dropIntent>` / `<Zone dropIntent>` prop, and
  had no importable name — a consumer writing the callback anywhere but inline
  could not annotate it.

- **`gridTiling(items, options)`** reports the columns and rows a grid config
  produces, taking no container and laying nothing out. A host sizing a grid to
  its own content previously had to call `gridStrategy.layout()` at a throwaway
  height and invert the cell arithmetic to recover the row count — a grid
  derives its tiling from the item count, the spans and the config alone, so
  the number was always available without a pass. Reports counts rather than an
  extent: grid has no opinion about row height. See
  [Sizing a grid to its rows](README.md#sizing-a-grid-to-its-rows).

- **Three built-in policies are now replaceable.** Each is tri-state: return a
  value to choose it, a deliberate negative to refuse, or `undefined` to fall
  through to the built-in. A policy that throws, or answers with something the
  library cannot use, is traced and treated as `undefined`.

  - `new Store({ chooseSuccessor })` — who takes focus when the focused node is
    destroyed or hidden, from `{ store, departing, reason }`. `null` focuses
    nobody, deliberately.
  - `new Store({ resolveNavigation })` — how a direction or intent resolves to a
    node, consulted ahead of `strategy.navigate` and the geometric fallback. The
    id it returns must name a focusable, visible node.
  - `acceptPolicy` on `<Container>`, `<Zone>` and `<Panel>` — whether a container
    takes a drop, from `{ items, options, sourceId }`. This one widens as well
    as narrows: `true` accepts where the strategy would refuse. `lock.accept`
    still refuses regardless; a lock is not a policy.

  Acceptance and capacity stay separate decisions, which bites on a `strip`:
  `maxItems` caps what the strategy places as well as what it accepts, so
  `acceptPolicy: () => true` on a full strip takes the pane and then withholds it
  into `unplaced`, where it renders nothing.

  New exported types: `SuccessorInput`, `SuccessorPolicy`, `NavigationPolicy`
  and `AcceptContext` — the last also from `windease/react`. See
  [Replacing the built-in rules](README.md#replacing-the-built-in-rules), and
  the playground's Policies section, which runs each policy beside the built-in
  it replaces.

- **`<Container edgeScroll={{ margin, maxRate }}>`** reshapes the auto-scroll
  ramp a drag follows near the edge of a scrolling container; the previously
  hardcoded values are its defaults. A tuning bag, not a policy: nothing to
  refuse, nothing to defer to. `<Container>` only — the presets take no
  `scrollRef` and never auto-scroll at all. `EdgeScrollOptions` is exported from
  `windease` and `windease/react`. See
  [Telling windease where the scroll got to](README.md#telling-windease-where-the-scroll-got-to).

- **Strategies can declare conflicting config keys**, through
  `LayoutStrategy.configConflicts`, and `ContainerHost` traces them alongside
  the typos `configSpec` already catches. Two shapes: `exclusive` keys that
  cancel each other, and an `ignored` key that some other key's branch never
  reads. `gridStrategy` declares its own — setting `cols` has always made
  `maxCols`, `rows` and `orientation` dead config, silently.

- **Eight public props that had no demo now have one, each operable and each
  covered by a Playwright spec.** `affordanceHitPad`, `affordanceKeyStep` and
  `affordanceTabStops` in `Affordance tuning / Tuning`; `overlay` in
  `Affordance tuning / Layout overlay`; `onPlacementChange` and
  `onChildOrderChange` in `Controlled`; `FocusProvider announce` in
  `Announcements`, which unhides the live region so the spoken text is on
  screen; and `dropIntent` in `Declarative / Custom drop intent`, which refuses
  a stack onto a pane too narrow for a tab strip. Guide chapters 4.01, 5.02,
  6.05, 7.08 and 7.11 embed them.

- **A guide, published beside the playground.** Sixty-four chapters across ten
  sections, ordered by what each capability costs to adopt rather than by the
  order features shipped — which surfaces that resize needs no `DragProvider`
  and that keyboard and drag are parallel opt-ins, neither gating the other.
  Chapters embed the existing stories by importing them, so a demo cannot drift
  from the page describing it. Written as MDX under `src/guide`, excluded from
  the published build. Every chapter carries a first-draft banner: the prose has
  not been edited or checked line by line against the code.

- **Monospace across the playground and guide is 2px smaller.** Ladle renders
  inline `code` at the body's own 16px, and monospace at a serif's px reads a
  size too big. Body code drops to 14, code blocks and table cells to 11;
  headings keep their own proportion.

- **`Flow mode / FlowVersusPlaced` demonstrates what flow gives up instead of
  asserting it.** Both modes now pass `affordances` and `settleMs`, so placed
  gets draggable gutters and a settle transition and flow visibly gets neither
  — the props are inert there rather than rejected. A "rotate order" control
  makes the transition visible without a drag.

- **`Policies/Accept` starts with room in one zone.** Every zone was seeded at
  its `maxItems` cap, so no drop could visibly re-lay-out a destination —
  acceptance was always immediately followed by withholding, and the layout
  looked frozen on any drop. Lenient now holds one pane, so the first drop
  resizes both panes and the second demonstrates the cap.

- **The README and `docs/concepts.md` said there were two built-in strategies.**
  There are four. Both documents still carried the 0.9.0 line that "there is no
  separate stack strategy", written before 1.3.0 reused the name for tab
  stacking — which the README then documented 600 lines further down, and which
  `concepts.md` denied outright. `floatingStrategy` was missing from both lists,
  and `concepts.md` counted `split` as a strategy when `store.split` is a verb
  over the tree. The 0.9.0 migration row now says which `stackStrategy` it
  means.

- **The README said panels carry `transit` and `focus`.** `transit` comes with
  `membership`, so any node with a parent has one, a nested zone included;
  `focus` is opt-in per node through `createNode({ focus: true })`, which
  `<Panel>` passes and `<Zone>` does not. The old wording reintroduced a panel
  type in the same list that opens by saying there are no types.

- **Every symbol in the API reference now carries a description.** The
  generated reference had rendered 143 of its 230 entries — including `Node`,
  `LayoutStrategy`, `createNode` and each error class — as a bare signature
  over a populated member table, because the TSDoc sat on the members rather
  than the declaration. No API changed.

- **`overflowMode: 'unplace'` is now `'unplaced'`.** Breaking, on both
  `stripStrategy` and `gridStrategy`. The mode populates `LayoutResult.unplaced`
  and every trace and doc calls the result "unplaced", so the config value now
  matches the thing it produces. `'unplace'` was also a coined verb — English
  does not unplace anything — where `unplaced` is an ordinary adjective.
  `configSpec` rejects the old value, so a stale config surfaces as a `layout`
  trace rather than silently falling back to `'squeeze'`.

### Fixed

- **Two nodes reported `focused` after a focus succession.** When the focused
  node was destroyed or hidden, the departing node was never sent `blur` — it
  kept `node.focus.state === 'focused'` alongside its successor, and emitted no
  `node.transitioned`, so a host drawing a focus ring from the node field drew
  two of them. `store.focusedId` was always right; only the node field lied.

- **The announcements docs listed two spoken changes where the announcer has
  always spoken three.** A reorder among siblings is announced too, and was
  missing from both the README and guide 6.05.

- **`updateContainerConfig` no longer republishes a patch that changed
  nothing.** The merge branch always allocates, so the existing reference check
  never fired and a host recomputing its config from a `ResizeObserver` emitted
  `container.configChanged` and scheduled a notify on every tick. Now compared
  by value, matching what the React reconciler already did on its own path.

### Changed

- **`Rect` now carries a required `z`.** Breaking for hand-built rects; every
  rect the library emits sets it, so read sites need no `?? 0`. The shipped
  strategies are planar and emit `0`. See
  [Breaking changes](README.md#breaking-changes).

- **`DropTarget.canAccept(sourceId)` is deprecated**, removed at 2.0.0. Use
  `acceptPolicy`, which sees the prospective child list and the container's
  config, and can widen a strategy's answer as well as narrow it. The old
  callback still runs, as a trailing veto after `acceptPolicy` and the strategy
  have both agreed. A target registered by hand moves over with
  `useDropTarget(id, ref, { acceptPolicy })`, which forwards the new bag.

- **A prospective split now previews as a layout, not a shade.** Hovering a pane's cross-axis
  edge with `splitOnDrop` lays the destination out as if the drop had happened: the pane under
  the cursor shrinks to the half it will actually get and the dragged pane's rect fills the
  other, both placed by running the strategy the new strip will be created with — `splitConfig`
  included — so the preview and the committed layout cannot disagree. Insertion has previewed
  this way since it shipped; a split was the odd one out.

  `<Container splitPreview>` accordingly grows a `'layout'` member and defaults to it. Nothing
  in the API broke, but panes now move during a hover — see
  [Breaking changes](README.md#breaking-changes) for what that touches and how to opt out.

### Fixed

- **A split intent no longer flips to an insert mid-hover.** The drop hit-test read live DOM
  rects, so once a preview displaced a pane the next `pointermove` resolved the intent against
  geometry the preview itself had produced — cross into a pane's top band and the pane shrank
  out from under the cursor, turning the drop back into a plain insert. Only reachable with the
  new layout preview; the hit-test now resolves against the un-displaced row.

- **A preset rendering in flow now reports its children's geometry.** A `<Zone>` or `<Panel>`
  that both hosts a container and declares `hints.render: 'flow'` runs no strategy, so it has
  no placements to publish — and nothing measured the children the browser had arranged
  instead. They reached the focus registry with no rects at all, so directional keyboard
  navigation could not score them: arrow keys neither moved within such a column nor crossed
  out of it. The presets now measure in flow, as `<Container>` already did.

- **A drag no longer dies partway through on WebKit.** A `<DragHandle>` and an affordance hit
  area are plain elements the browser was free to drag itself, and WebKit does: partway through
  a pointer gesture it starts a native drag and stops delivering pointer events entirely — no
  further `pointermove`, no `pointerup`, no `pointercancel` — so the pane or seam freezes where
  it was and the handle never learns the gesture ended. Both now refuse it. Reproduced on Linux
  WebKit, where a floating panel dragged off a corner it had snapped to could not leave.

## 1.3.0

### Added

- **A drop hit-test on the declarative presets.** `<Zone>` and
  `<Panel container={…}>` take `stackOnDrop`, `splitOnDrop` and `dropIntent`, and
  resolve a cursor into an insertion index, a stack or a split — the hit-test
  `<Container>` runs, now shared by both. Before this a preset drop appended
  regardless of where the cursor was, and neither tab-stacking nor drop-on-edge
  reached the declarative API at all. A preset that hosts a layout now publishes
  `data-node-container`, and a child it places imperatively publishes
  `data-node`, so both are visible to the harvest. Presets draw no split preview
  band; that stays a `<Container>` render.

- **`floatingStrategy(inner?)`.** Places items marked `floating` in their placement bag
  free over the container — snapping to corners by per-axis distance, with the eligible
  corners per item in `snapCorners` — and hands every other item to the wrapped strategy
  against the full container, so tiling is unchanged and the panel reserves no space.
  `handleSize` confines the drag handle to a band, since an affordance covering the whole
  panel makes the panel's own controls unclickable; a host wanting a different grab rule
  turns the built-in handles off and dispatches `floating:drag:<id>` itself. `snapToPanes`
  adds every placed pane's corners to the snap targets, and the item remembers which pane
  it caught so it rides that pane through a reflow. Stacking order stays the host's, and
  an item nothing has sized yet is withheld into `unplaced` rather than placed at zero
  size.

- **Drop intent.** `resolveDropIntent(rects, cursor, axis, options)` turns child rects and a
  cursor into what the drop is asking for — `insert` at a seam, `stack` onto a child, or
  `split` a child — instead of only an insertion index. Main-axis bands resolve to
  `insert`, cross-axis bands to `split`, and the centre to `stack`, with corners going to
  the main axis; `band` is the fraction of the child each band takes, 0.25 by default and
  clamped so a centre always survives. Bands are carved only for the intents `options`
  enables, so with none enabled it returns exactly what `insertionIndexByMidpoint`
  returns. `DropTarget` and `useDropTarget` take `getDropIntent` beside the existing
  `getInsertionIndex`, which still works unchanged. A `split` intent also carries the
  `axis` of the strip it would create — the cross axis of the container that resolved it.
- **Tab stacking.** Pass `stackOnDrop` to `<Container>` and a drop in the middle of a pane
  puts both panes in one tabbed stack. `stackStrategy` places the active child in the
  container less its `headerSize` band and reports the rest in `unplaced`; `activeId` in
  the container config picks it, falling back to the first child. `store.stackNodes`
  performs the wrap — a new container in the onto-pane's slot, inheriting its placement,
  holding both — validating every lock and cycle before opening its transaction, so a
  refused call writes nothing and a host recording history per transaction gets one undo
  step. It carries `autoUnsplit`, so dragging the last tab out dissolves it. The tab strip
  is the consumer's to draw; `useStack(containerId)` gives `{ tabs, activeId, activate }`,
  and `<DragProvider stackConfig>` says what config a drop-created stack gets. Activation
  writes through `updateContainerConfig`, which `lock.arrange` gates.
- **Drop on edge.** Pass `splitOnDrop` to `<Container>` and a drop near a pane's
  cross-axis edge splits that pane: its slot becomes a two-pane strip holding it and the
  dropped pane, dropped one first for a `'start'` edge. `store.splitInto(sourceId,
  ontoId, { id, axis, edge, config })` performs the wrap, validating every lock and cycle
  before opening its transaction, so a refused call writes nothing and a host recording
  history per transaction gets one undo step. The strip inherits the onto-pane's placement
  and pinned index, and clears `placement.size` on both children, each having been measured
  against the parent it left; it carries `autoUnsplit`, so dragging either pane back out
  dissolves the pair. `<DragProvider splitConfig>` says what config a drop-created strip
  gets — the seam is already draggable without it. `splitPreview` (`'element'` by default)
  positions a `div.windease-split-preview` over the half the drop would take, with a
  default appearance in `styles.css`; `'none'` leaves the drawing to you.
  `splitOnDrop` and `stackOnDrop` are independent, and with split on and stack off the
  centre of a pane still resolves to an insert.
- **`<Container dropIntent>`.** Replaces the built-in drop hit-test outright, receiving the
  measured child rects with the dragged node removed, the cursor, the container's axis and
  the dragged node's id. The container keeps doing the measuring and the axis inference.
  This is how band thickness, quadrant hit-tests and per-pane refusals are expressed, so no
  `band` prop ships.

- **Seam join.** On a strip with `resizeMode: 'neighbor'`, `joinOnOvershoot: true` lets a
  seam drag end in a destroy: push the seam past a pane's floor, keep pushing, and
  releasing there closes that pane. Off by default, because the gesture deletes a pane
  with no confirmation step; `joinThreshold` is how many main-axis pixels past the floor
  it arms at, 24 by default. The pane about to close and its seam both carry
  `data-join-armed`, which `styles.css` gives a visible default — override those two
  selectors to restyle. `Escape` cancels, a cancelled pointer never commits, and from
  the keyboard `Enter` commits an armed seam while `End` still only resizes. A pane
  under `lock: { destroy: true }`, or holding a descendant that is, never arms, and its
  seam still resizes down to the floor. The destroy runs in one transaction, so a host
  recording history per transaction gets a single undo step. `trackJoin`,
  `DEFAULT_JOIN_THRESHOLD`, `TrackJoinInput`, `JoinState`, `destroyBlockedBy` and
  `Affordance.join` / `AffordanceJoin` are exported for a host driving its own seams.
- **`store.setAutoUnsplit(id, true)`.** A container opted into this collapses when a
  removal leaves it holding one child, lifting the survivor into the grandparent with
  the group's placement and pinned index. Opt-in on the container, because the trigger
  cannot live in `removeNode` — a zone the consumer created on purpose would evaporate
  the moment it emptied. It fires on the transition only, not on any container that
  happens to hold one child, so a group can still be built up a pane at a time. The
  collapse joins the removal's transaction rather than landing as a second undo step.
- **`LayoutStrategy.configSpec`.** A strategy that declares the keys it understands gets
  typos in `container.config` reported as `layout` traces instead of silently taking the
  default. `strip` and `grid` declare one; a strategy without one is not checked.
  `checkStrategyConfig(name, config, spec)` is exported for hosts that would rather
  assert on config than read traces. See [Breaking changes](README.md#breaking-changes).
- **In-flow render mode.** A container declaring `hints.render: 'flow'` runs no
  strategy: its children render as ordinary in-flow elements and the consumer's CSS
  arranges them, for a host adopting windease into a layout that is already a working
  CSS grid. Drag and drop is unaffected — the hit-test always measured the DOM — and
  directional navigation still works because the rects reach the resolver by
  measurement, composed into the same space as every placed container. What a flow
  container gives up is everything downstream of the strategy pass: placements,
  affordances, `unplaced`, `overflowMode`, `hints.sizing`, and the settle animation.
  `ContainerLayout` gains `mode`, `strategyId` becomes optional on a flow `<Zone>`,
  and the drop axis is read off the arrangement CSS produced rather than off a
  config a flow container has no reason to set (`axisFromRects`, exported).
  Additive: a container that declares nothing behaves exactly as before.
- **Keyboard move.** `Shift` plus an arrow moves the focused pane into the slot that
  arrow would have navigated to — a reorder among siblings, a reparent when the target
  lives in another container — so one resolution backs both gestures and a strategy's
  `navigate?` override applies to moving as well as to navigating. Focus rides along
  and `bindAnnouncer` speaks the result. Every refusal is silent rather than thrown:
  the edge of the tree, a `move`-locked pane, an `accept`- or `dragOut`-locked
  container, an `arrange`-locked parent, or a move that would nest a node in itself.
  `resolveMove` returns the plan and `applyMove` performs it, both exported for a host
  binding its own keys.
- **Scroll offset as an input.** `ContainerHost.setScroll({ x, y })` with
  `observeScroll(el)` beside it, mirroring `setViewport` / `observe`, and
  `scrollRef` on `<Container>` to wire it. Placements stay unscrolled; what moves is
  the position a pane is *reported* at, which is what directional keyboard navigation
  compares — so a scrolled container is no longer navigated against positions its
  panes have left, and a scrolled container beside an unscrolled one now agree about
  where they are. Each container answers for its own offset, so nesting composes, and
  a flow container needs none because it is measured from the DOM. `ContainerLayout`
  gains `scroll`. Scrolling does not re-run the strategy.
- **Auto-scroll during a drag.** Dragging a pane toward the edge of a scrolling
  container scrolls it, and keeps scrolling while the cursor is held there rather
  than moving one step per pointer event. Driven by the same `scrollRef`, so a
  container without one never auto-scrolls. `edgeScrollDelta(bounds, point, options)`
  is the arithmetic alone — pure, exported, and the whole of what the engine does;
  `DropTarget.scroll` is the seam the DOM host fills, keeping the scrolling itself
  out of `DragEngine`. `DropTargetOptions` takes `scrollEl` and `edgeScroll`.
- **`overflowMode` on grid**, the same `squeeze` / `scroll` / `unplace` vocabulary
  strip uses. A grid derives its cells from the container, so it only overflows once
  an item states a `hints.minSize` floor: `scroll` holds the cells at their floor and
  reports the excess, `unplace` keeps the rows that fit and sends the rest to
  `unplaced`, composing with the existing count caps. `squeeze` is the default and is
  what grid has always done, so nothing changes for a container that declares nothing.
- **`overflowMode` on strip**, with the host box sized to it.
- **Affordances and content sizing in the declarative path.** `hints` is a prop on
  `<Zone>` / `<Panel>`, and affordances reach the presets, so the declarative and
  imperative paths no longer disagree about what a container can express.
- **`store.setActiveChild(containerId, childId)`.** Shows a child of a stack. No lock
  gates it — `arrange` governs how a container's children are arranged, and which one a
  stack shows is not an arrangement, so a stack locked against rearrangement still
  switches tabs. `useStack().activate` writes through it, and refuses an id that is not a
  child of the container.
- **A name on a preset pane a screen reader lands on.** `<Zone>` / `<Panel>` gave a pane
  that declares `focus` the same roving tab stop `<Container>` gives the children it
  renders, but not the `role="group"` and `aria-label` that go with it there — so arriving
  by keyboard announced nothing. A pane that declares no focus takes no tab stop and still
  gets neither.

### Changed

- **`<Zone config>` and `<Panel container={{ config }}>` are reconciled.** Re-rendering
  with a changed `config` prop was silently ignored, so the only way to change one was
  `store.updateContainerConfig` — the prop read as controlled and was not. It is now
  diffed against what the last render declared: a key the prop drops is deleted, and a key
  a gesture wrote (a stack's `activeId`) is left alone, so a tab click is not undone by the
  next render. Skipped entirely while the container is `arrange`-locked, like the other
  reconciled fields.
- **Destroying a subtree refuses when any node in it is destroy-locked.**
  `unregisterNode` asserted `lock.destroy` on the id it was handed and then cascaded with
  no further checks, so a locked descendant died silently. It now throws `LockedError`
  naming the descendant that refused, and writes nothing. `{ force: true }` and
  `withLocksSuspended` still destroy through it — which is what React unmount, `unsplit`
  and `hydrate` already use. A host that relied on the cascade to clear a locked
  descendant now has to force the call.
- **A seam with no room to move reports `aria-disabled`.** A container squeezed under the
  sum of its panes' `minSize` floors leaves every pane at its floor, and the seam between
  them reported a slider whose `aria-valuemin` equalled its `aria-valuemax`. It keeps its
  tab stop and its position in the reading order; what changes is that it no longer
  promises travel it cannot make.
- **A child a strategy withheld now renders nothing under `<Zone>` / `<Panel>`.** It
  previously fell back to normal flow, unpositioned, because those presets treat a missing
  rect as "nobody is placing me" — which is still what flow mode and an unregistered
  strategy mean. `unplaced` now carries the difference, and `<Container>` has always
  dropped these children, so the two paths agree. Affects grid `overflowMode: 'unplace'`
  and `maxItems` overflow rendered through the declarative presets: those cells disappear
  rather than stacking up below the zone. Render them from `useIsUnplaced` or the
  container view if you were relying on the old behaviour.
