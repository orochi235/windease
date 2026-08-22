# Changelog

What changed in each published version, for someone deciding whether to upgrade.
Migration steps for breaking changes live in the README under
[Breaking changes](README.md#breaking-changes); entries here link there rather than
repeating them. `scripts/check-changelog.sh` fails a release whose version has no
section below.

## Unreleased

### Added

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
- **`overflowMode` on strip**, with the host box sized to it.
- **Affordances and content sizing in the declarative path.** `hints` is a prop on
  `<Zone>` / `<Panel>`, and affordances reach the presets, so the declarative and
  imperative paths no longer disagree about what a container can express.

### Changed

- **`lock.arrange` gates `reorderInParent`.** The axis already refused
  `setChildOrder`, so the same rearrangement landed or was refused depending on which
  method made it — a drop into an arrange-locked container was blocked and a direct
  `reorderInParent` was not. It now asserts `arrange` on the parent alongside `move`
  on the node; pass `{ force: true }` where the reorder is the lock owner's own doing.
  `graft` with `at` refuses an arrange-locked parent in its pre-pass, so a rejected
  graft still mutates nothing. `splitNode` and `unsplit` are unaffected — both
  validate the axis before opening their transaction.
  See [Breaking changes](README.md#breaking-changes).
- **`lock.arrange` applies to any node.** It used to be dropped from the lock set of a
  node with no container, so `setLock(panel, { arrange: true })` stored nothing and the
  panel could still gain one. `setLock(id, true)` and `createNode({ lock: true })` now
  resolve to a set including `arrange: true` on a leaf, and that axis is in the snapshot
  — update any test asserting on an exact `LockSet`.
  See [Breaking changes](README.md#breaking-changes).

### Fixed

- A strip pane resizes from the extent it renders at.
- A drop resolves against the release point rather than the last sampled frame.
- The caret stays in the layout across a drag.
- The strategy registry compares by entry rather than by object identity.

## 1.2.1 — 2026-08-22

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

## 1.2.0 — 2026-08-21

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

## 1.1.0 — 2026-08-20

- **`container.added` event.** `ensureContainer` now emits
  `{ id, strategyId }` when it actually adds a container, closing the one
  structural mutation that changed a node's capabilities silently. Not emitted
  for a node registered with a container already on it, nor on the no-op path.
- **`StatefulLayoutStrategy<TState>`.** A `LayoutStrategy` with `initialState`
  required rather than optional, so a strategy author can hand its result
  straight to `layout({ state })` without narrowing. `LayoutStrategy` keeps the
  optional signature, because a host resolving one out of a `StrategyRegistry`
  cannot know whether it seeds.

## 1.0.1 — 2026-08-20

- **`createZone` / `createPanel` collapsed into one `createNode`.** The split
  between them was arbitrary — both "middles" were already reachable (a zone
  with a `parentId` was what `createGroup` used to build; a panel with a
  `container` was the documented recursive-panel case). `container`,
  `membership` (via `parentId`), and `focus` are now independent opt-in
  fields on one constructor. `<Zone>` and `<Panel>` stay as React presets over
  `createNode`. See README for the mechanical call-site rewrite.

## 1.0.0 — 2026-08-20

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

### Removals

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

## 0.8.0 — 2026-08-04

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

## 0.7.0 — 2026-08-04

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

## 0.5.0 — 2026-06-07

- **Resizable children.** `placement.size?: { w?, h? }` reserved key is
  honored by `stack` / `strip` / `split` strategies; `hints.maxSize` is
  a new clamp ceiling alongside `hints.minSize`. Non-last children in
  stack/strip get trailing-edge resize affordances; split gutters now
  clear `placement.size` on both panes before applying the ratio change.
  Grid still ignores explicit sizes (multi-cell spans deferred). Snapshot
  round-trips without a schema change.

## 0.4.0 — 2026-06-07

- **Declarative JSX tree binding.** `<Zone>` / `<Group>` / `<Panel>`
  presets register themselves with the store on mount, unregister on
  unmount, and reconcile sibling order from JSX child order each render.
  Imperative and declarative ids coexist under the same parent.
  `<Provider>` auto-creates a Store when none is provided. Public
  surface: `ParentContext` / `ParentScope` / `useParentId`,
  `LayoutContext` family, `defaultChildSort`, and the three preset prop
  types.
