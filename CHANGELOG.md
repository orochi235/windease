# Changelog

What changed in each published version, for someone deciding whether to upgrade.
Migration steps for breaking changes live in the README under
[Breaking changes](README.md#breaking-changes); entries here link there rather than
repeating them. `scripts/check-changelog.sh` fails a release whose version has no
section below.

## Unreleased

### Added

- **Children reorder by drag when their container declares `reorder`.** Set
  `reorder: true` in a container's config and every child becomes draggable by
  the wrapper `<Container>` or the preset already renders, with no
  `DragHandle` in the chrome: it reorders within the container and moves to any
  other container that accepts it, under the usual locks and `accepts` rules.
  `reorder: 'handle'` starts a drag only from an element inside the child
  marked `data-windease-handle`. A press on a seam or other affordance, or in a
  text field, never starts one, and without a `DragProvider` the key does
  nothing. A preset zone that declares `reorder` keeps the order the user
  dropped rather than reverting to JSX order. See
  [Reordering children by drag](README.md#reordering-children-by-drag).

- **`<DragProvider dragThreshold>`**: how many pixels a press travels before it
  becomes a drag. Default 4; `0` starts on press.

- **A tab can be torn out of a stack and docked back, from config.** Set
  `tear: 'float'` in a stack's config: dragging a tab out onto the nearest
  container above it whose strategy floats children (`floatingStrategy`,
  `desktopStrategy`) floats it there, top-left corner at the drop point, at the
  stack body's size or at `tearSize`. Dropping a floating child back on the
  stack docks it as a tab. Each is one transaction, so one undo step.
  `floatNode` and `dockNode` do the same from host code, and
  `accepts: 'tear'` makes a container take tear-outs and refuse every other
  drop. A custom strategy joins in by carrying the new optional `float` hook.

- **`justifiedStrategy` lays out justified rows, like Flickr and Google
  Photos.** Each item keeps its aspect and every row but the last is scaled to
  fill the width exactly. Config: `rowHeight` (the target, default 200), `gap`,
  `maxRowHeight`, and `justifyLast` to stretch the last row too. Row breaks are
  chosen to keep the rows' heights as close to `rowHeight` as possible overall.
  See [Justified rows of photos](README.md#justified-rows-of-photos).

- **`hints.aspect` states the width ÷ height a node keeps when scaled.**
  `justifiedStrategy` reads it before the measured or preferred size; no other
  built-in strategy honors it yet.

- **Strip `step` sizes panes in whole multiples of a number.** `step: 12` on a
  strip's config rounds each pane to 12px, the way tmux and Emacs size panes in
  character cells. The last pane without a pixel `size` takes the rounding
  remainder, so the row still fills. Seam drags land on whole steps, each arrow
  press moves a seam one step, and a seam's reported range narrows to whole
  steps.

- **Strip `overshoot: 'hide'` hides a pane pushed past its floor instead of
  closing it.** The seam arms exactly as `joinOnOvershoot` does, but releasing
  hides the pane, the way VS Code closes a sidebar dragged shut, and puts the
  rest of the row back at the sizes the drag found. `store.showNode` returns
  the pane at its old size. `overshoot: 'join'` is the same as
  `joinOnOvershoot: true`, which keeps working. `AffordanceJoin` gains
  `action: 'destroy' | 'hide'`, and `captureSeam` and `commitJoin` carry out a
  release for hosts that drive seams without React.

- **`zoom` on a strip's or stack's config fills the container with one
  child.** Like tmux's prefix-z, the named child takes the whole container and
  the rest go to `unplaced` with their placements untouched, so clearing
  `zoom` restores the row. A zoomed strip emits no seams; a zoomed stack child
  covers the `headerSize` band too. An id naming no visible child is ignored.

- **`placement.sticky` keeps a strip pane in view while the rest scroll.**
  Under `overflowMode: 'scroll'`, a pane whose placement sets `sticky: true`
  holds at the start of the row once the scroll reaches it, like Firefox's
  pinned tabs, and draws above what scrolls under it. The strategy reports
  where each sticky pane sticks in `LayoutResult.sticky` (carried on
  `ContainerLayout.sticky`) and never sees the scroll; `<Container>`, `<Zone>`
  and `<Panel>` apply it with the new `stuckRect(rect, inset, scroll)`. That
  scroll is in layout pixels; under a `view`, the new `toLayoutScroll(scroll,
  view)` converts a scroller's offset to them.

- **A container can refuse drops from its config.** Set `accepts` in any
  container's `config`: `false` refuses every drop, `{ kinds: ['panel'] }`
  refuses a dragged node whose `kind` is not listed, and `{ max: 3 }` refuses a
  drop that would leave more than three visible children (reordering inside
  the container still works). It needs no callback, so a snapshot or preset can
  carry it. The drag checks `lock.accept` first, then `accepts`, then
  `acceptPolicy`, then the strategy's `canAccept`; `acceptPolicy` returning
  `true` does not override `accepts`.

- **Stack and split drops can be switched on from container config.**
  `drop: { stack: true, split: true }` in a container's `config` does what the
  `stackOnDrop` and `splitOnDrop` props do on `<Container>`, `<Zone>` and
  `<Panel>`, so a snapshot or preset carries it. A prop that is set, `false`
  included, wins over the config.

- **`checkStrategyConfig` accepts `accepts` and `drop` on every strategy.** They
  are container keys no strategy's `configSpec` declares, so setting either
  would otherwise trace an unknown key. A near miss such as `accept` still
  traces, now suggesting `accepts`.

- **Container config `raise: 'focus' | 'click'` brings a window to the top
  without host code.** When a child of the container, or anything inside it,
  takes focus, the store moves that child last in `childOrder`, where desktop
  and floating draw it on top. `'click'` also raises on a click that moves no
  focus, through `<Container>`. A pinned child keeps its slot, other pins are
  routed around, a container locked against `arrange` is left alone, and the
  focus change and the raise are one transaction. `store.raise(id)` does the
  same on demand.

- **Stack config `show: 'dropped'` makes an arriving child the active tab.** A
  child moved in by `moveNode` or `moveNodes` (the first of the batch), or
  registered into the stack, is written to `activeId`, so a drop shows what
  was dropped without a `node.moved` listener. A reorder inside the stack
  activates nothing. Set it after registering a stack's initial children, or
  the last one registered becomes active.

- **Stack config `fallback: 'next' | 'prev' | 'first'` picks the tab that shows
  when the active one goes.** When the active child is unregistered, hidden or
  moved out, `'next'` activates the visible tab after it and `'prev'` the one
  before, each taking the other side at an end; `'first'` clears `activeId`.
  Without the key nothing changes: the departed id stays in config and the
  stack shows its first child. The write is part of the same `unregisterNode`
  or `moveNodes` transaction.

- **`placement.share` sizes a strip pane as a fraction of its row.** Unlike a
  pixel `placement.size`, it survives a container resize: a row saved at 3840px
  and shown at 960px keeps its proportions, where pixel sizes were squeezed and
  left a pane without one nothing. Pixel sizes are taken out first, shares split
  what they leave, and panes with neither share the rest. A seam drag on a row
  holding any share writes shares back, so the row stays proportional. See
  [Sizing panes by share](README.md#sizing-panes-by-share).

- **`justify` on `stripStrategy` places the space panes leave.** When capped or
  hint-sized panes don't fill the row, `'center'` and `'end'` move them and
  `'between'` spreads the space into the gaps. The default `'start'` is today's
  layout. See [When panes leave room](README.md#when-panes-leave-room).

- **`drag` on `desktopStrategy`.** `drag: true` puts a `drag-xy` affordance over
  each window's title band, `handleSize` tall (22 by default), and dragging it
  writes the window's `x` / `y`; `'x'` and `'y'` move on one axis only. A window's
  own `placement.drag` overrides the config, and `lock.move` refuses the drag. The
  desktop also hands its inner strategy's affordances to that strategy's
  `dispatchAffordance`, which it dropped before. See
  [Desktop windows](README.md#desktop-windows).

- **`clamp` on `desktopStrategy`** keeps windows reachable. `'bar'` keeps each
  window's title band inside the desktop, `'all'` the whole window where it fits.
  It applies on layout as well as on drag, so a window restored from a layout
  saved on a larger screen is pulled back into view, with a `layout` trace.

- **`overflow` on `desktopStrategy`, and overflow past the left and top edges.**
  `LayoutResult.overflow` gains optional `left` and `top` for content at negative
  coordinates, and the desktop now reports them: a window at `x = -1800` used to
  be unreachable. `<Container>` and the presets put a matching margin before the
  box, and scroll `scrollRef` by it so the origin stays put on screen.
  `overflow: 'clip'` reports no overflow at all; `'scroll'`, the default, is
  the old behavior plus the two new edges.

- **`minimizable` on `desktopStrategy`.** Each window gets a `click` affordance at
  the right of its title band that flips `placement.minimized`, and an iconified
  window gets one over its icon to restore it. The built-in affordance layer now
  renders `click` affordances, as a named `<button>`; it rendered them as inert
  drag handles before.

- **`resize` on `desktopStrategy`.** `resize: true` gives each window a
  `resize-x` or `resize-y` affordance on each edge and a `resize-xy` on each
  corner, inside the window's border: edges `edgeSize` thick (6 by default),
  corners twice that. Dragging one writes `placement.size`, and the left and top
  edges also write `x` / `y` so the opposite edge stays put. A window stops at
  its `hints.minSize` (twice `edgeSize` without one) and `hints.maxSize`, and a
  growing edge stops at the desktop's edge. Each edge reports `bounds` as its
  position, so a keyboard press moves it the way the arrow points. `lock.resize`
  refuses the resize, `lock.move` refuses the left and top edges, a shaded window
  gets no edges, and a window's own `placement.resize` overrides the config. See
  [Desktop windows](README.md#desktop-windows).

- **`wrap` on `desktopStrategy`** restarts the cascade at the top-left once the
  next window would leave the desktop on either axis, as classic window managers
  do. A window too big for the desktop still starts at the top-left. Without it,
  the cascade runs on past the edge as before.

- **`iconFrom` on `desktopStrategy`** picks the corner the icon layer fills
  from: `'top-left'` (the default), `'bottom-left'` (Windows 3.1, rows going up),
  `'top-right'` or `'bottom-right'`. The inner strategy still lays icons out from
  the top-left, and the desktop mirrors its placements, affordances and overflow
  into the corner, and mirrors pointer deltas, preview cursors and navigation
  directions back on their way in, so any inner strategy works unchanged. Rows
  that run past the top are reported as `overflow.top`.

- **Placement `layer: 'top'` keeps a window above the rest, on `desktopStrategy`
  and `floatingStrategy`.** For GIMP's docks and Mac OS 9's palettes. On a desktop,
  windows without it take `z` 1 up in child order and top-layer windows follow, so
  raising a window moves it to the top of its own layer and never over a
  top-layer one. On floating, which leaves its items at `z` 0 and to DOM order, a
  top-layer item takes `z` 2 and up in child order. Any other value is the normal
  layer. See [Desktop windows](README.md#desktop-windows).

- **An affordance handle stacks at its rect's `z`**, so a window's title band sits
  above that window and below the ones in front of it. `Affordance.label` names
  what a gesture does (`'move'`), and the handle's accessible name uses it in
  place of "resize".

- **A config spec can list booleans beside strings**, as `drag: [true, false,
  'x', 'y']` does.

- **A grid child can sit at a given cell.** `placement.cell: { col, row }`
  puts a child's top-left corner at that zero-based cell, the way a Grafana
  panel sits at its `gridPos`; the rest flow into the free cells in order. A
  cell that collides or falls outside a capped grid goes to `unplaced`. A move
  or reorder clears `cell`, so dragging a celled child drops it into the flow.

- **Grid cells can keep a fixed size.** `cell: { w, h }` in the grid config
  stops cells stretching to fill the container; with a fixed width and no
  `cols`, the grid fits as many columns as the width holds and wraps the rest.
  `gridTiling` takes an optional container for that fit.

- **Grid `justify` places the leftover width.** When the occupied columns don't
  span the container, `justify: 'start' | 'center' | 'end' | 'between' |
  'evenly'` puts the leftover before, around or between whole columns, so an
  iOS-style dock spaces its icons evenly.

- **`ConfigSpec` accepts `'object'`** for a config key that holds a plain
  object, such as grid's `cell`.

- **Pan and zoom a container with `view`, or fit a designed size with `fit`.**
  `<Container view={{ x, y, scale }}>` and `<Zone view>` draw the laid-out box
  translated and scaled; layout is unchanged. `fit="contain" | "width"` scales
  the designed `viewport` to the space the container is shown in, so a
  1024×768 desktop fits a 512px frame. Window drags, seams, resize handles and
  drops all follow the pointer under a scale, nested scales included, and
  arrow-key steps stay in layout pixels. Headless, `ContainerHost.setView` sets
  it and `layout().view` reports it; `fitScale`, `fitView`, `zoomView`,
  `toLayoutDelta` and `toLocalPoint` are the pure arithmetic, and
  `elementScale` / `observeFit` the DOM helpers over them.

### Changed

- **A `DragHandle` drag starts after 4px of travel, not on press.** A click on
  a handle, or on a button inside one, now clicks, and the click that ends a
  drag is swallowed. `<DragProvider dragThreshold={0}>` restores starting on
  press. `useDragHandle` follows the gesture on `window` from the press, so only
  its `onPointerDown` does anything; the other three handlers remain as no-ops.
  A secondary-button press no longer starts a drag.

### Fixed

- **Pressing a window's title bar or minimize box raises it under `raise`.**
  The desktop draws those controls in the affordance layer beside the window,
  so the window's own click-raise never saw the press; only a click on its body
  raised it. A press on an affordance that belongs to one child now raises that
  child when its parent sets `raise`.

- **A drop preview's cursor is in the container's own pixels.** `LayoutPreview.cursor`
  promised container-relative coordinates and got the page's; a strategy
  reading it was off by the container's offset, and by its scale under a view.
  No built-in strategy reads it.

- **Keyboard navigation sees panes where a scaled container draws them.** A
  container shown under a `view` published its children's rects unscaled, so
  directional navigation compared positions they no longer occupied.

- **Drag auto-scroll runs at the same on-screen rate inside a scaled
  container.** The ramp is in screen pixels and a scroller scrolls in its own.

- **A grid's drop preview keeps its children's spans.** The fast preview path
  handed the strategy bare ids, so every child previewed as one cell while a
  drag hovered.

- **A preset's own render error is no longer reported as an id collision.**
  When a `<Panel>` or `<Zone>` threw while rendering — `pinned` passed inside
  `placement`, say — React retried the tree, and the retry found the parent
  already registered by the abandoned attempt and threw `node "…" is already
  mounted by another zone`, naming the parent and hiding the real error. The
  retry now takes over a registration that never committed, so the error that
  surfaces is the one that happened.

- **A default-mode strip seam moves by exactly the drag.** When every pane
  holds a stored size, or the row is squeezed — a layout saved on a bigger
  screen — the drag wrote only the dragged pane's size, so the row rescaled
  around it and the seam moved some other amount, often backward: in a Dockview
  layout saved at 1600px and shown at 960px, a 40px drag moved seams 90–150px
  the wrong way. The panes after the seam now give up the delta, in proportion
  to their size and never past a floor; the panes before it move only when
  those cannot.

- **Panes inside a group move with it while a seam drag resizes the group.**
  A seam drag switched off the settle transition only in the container that
  owns the seam, so a container nested in a resized pane kept easing its own
  children over `settleMs`: they trailed the group's box and grew in from its
  left edge. The drag now switches it off for every container inside the one
  being resized, and a `<Zone>` honors its own seam drags, which it ignored.

- **`checkStrategyConfig` reports a number config that is `NaN` or infinite.**
  It checked only the type, so `cols: NaN` passed as a number.

- **`gridStrategy` no longer hangs on a `NaN` or infinite number.** `cols: NaN`,
  or a `NaN` or infinite `placement.span` in a grid with no row cap, looped
  forever looking for a cell. A non-finite `cols`, `rows`, `maxCols`, `maxRows`
  or `maxItems` is now ignored, as if unset, and a fractional one rounds down.

- **A `NaN` span in `gridStrategy` takes one cell.** One `NaN` `span.rows` made
  every rect in the grid `NaN`, and under a row cap a `NaN` span sent its item to
  `unplaced`. An infinite span fills the grid on a capped axis and takes one cell
  otherwise; `cols: Infinity` no longer produces `NaN` rects.

- **`gridStrategy` auto-balance fills `maxCols` × `maxRows`.** It chose columns
  from the square root of the item count, then applied `maxRows` as a hard cap,
  so a 4×1 dock placed two of three items and a 7×5 page placed 30 of 35. Columns
  now grow until the rows hold everything, up to `maxCols`; a lone `maxRows`
  grows columns without limit.

- **`gridStrategy.canAccept` counts capacity as `maxCols` × `maxRows`.** It used
  the same square-root column count and ignored `fill: false`, so a 7×5 page
  holding 30 items refused a 31st.

- **A fixed `rows` grid grows sideways for spanned items.** Columns came from the
  item count alone, so wide and large tiles went to `unplaced` though nothing
  capped the columns. They are now counted by the cells they cover.

- **Large and resizable `gridStrategy` grids lay out in milliseconds.** Each item's
  search for a free cell started over from the first cell, so 10,000 items took
  about 7s; it now starts from the first free one. Under `resizable: true`, each
  seam's reach repacked the whole grid for every candidate span, so 64 tiles took
  over a second; a grid with no row cap now skips the repack, since every span
  fits there, and a capped one repacks only the items after the one resized.

- **`stripStrategy` ignores a size it cannot render.** A NaN, infinite or
  negative `placement.size`, `minSize`, `maxSize` or measurement is treated as
  absent, with a `layout` trace naming the pane and the value. A NaN stored
  size used to render as written and spread into the next sibling's position,
  and a negative `maxSize` gave a negative width.

- **`hints.maxSize` caps a strip pane with no stored size.** It was honored
  only on a pane with a `placement.size`, so an auto pane beside stored-size
  sidebars (Obsidian's note under a 700px readable-line cap) rendered at
  whatever was left over, and a `preferredSize` above the cap rendered as
  asked.

- **`overflowMode: 'unplaced'` counts `preferredSize` when deciding what
  fits.** A row sized by `preferredSize` counted each pane at its `minSize`,
  so it placed every pane and overflowed instead of unplacing the ones that
  did not fit.

- **Strip panes that share the leftover no longer overflow a row that fits.**
  The leftover was split equally and each share floored at its pane's
  `minSize` afterward, so two panes with 400px and 380px minimums overflowed
  780px by 10. A pane whose floor or cap binds now takes it, and its siblings
  share the rest.

- **A `resizeMode: 'neighbor'` seam drag moves only the two panes beside it.**
  In a squeezed row — stored sizes that add up to more than the container —
  the drag wrote squeezed sizes for its pair while the other panes kept their
  larger stored ones, so the row rescaled: a 16px drag of Xcode's navigator
  moved the inspector from 260 to 334. And the first drag on a row sized by
  `preferredSize` moved it onto the stored-size path, where untouched panes
  shared the leftover equally. The drag now also writes the rendered size of
  any other pane that would otherwise move.

- **A strip seam drag never moves against the pointer.** Beside a pane stored
  under its `minSize` — an acme window shrunk to a 2px sliver, a minimized
  Photoshop group — a `'neighbor'` drag could flip direction and write a
  negative size, and a `'redistribute'` drag jumped the pane up to its minimum.
  A pane past one of its limits now stays put when pushed further past it, and
  the seam's `bounds` advertise the same range the drag reaches.

- **A strip's cross axis no longer goes negative.** Padding larger than the
  container, as a host hidden with `display: none` measures, now gives panes a
  cross extent of 0 rather than a negative one, as `stackStrategy` already did.

- **`shelfStrategy`, `skylineStrategy` and `columnStrategy` no longer wrap a row
  that fills the width exactly.** Six tiles of width `100 / 6` sum to
  `100.00000000000001`, so the sixth started a new row and masonry lost a column.
  Width comparisons now allow for float drift, and a sub-pixel excess no longer
  reports `overflow`.

- **`desktopStrategy` cascades a window whose `x` or `y` is `NaN` or infinite**
  instead of placing it there, the same way it treats a window with no position.
  The bad coordinate also no longer turns `overflow` into `NaN`.

- **`floatingStrategy()` with no inner strategy floats every item,** as its
  documentation says. An item without `floating` was neither placed nor
  reported in `unplaced`; it is now placed and dragged like any other.

- **A floating item anchored to a corner stays inside its container.** An item
  taller or wider than the container rested past its top or left edge, taking
  its drag band out of reach; it is now clamped the way a free item is.

- **A floating item whose size is `NaN` or infinite is withheld** into
  `unplaced`, as a zero size already was, instead of rendering a `NaN` rect.

- **A floating drag delta of `NaN` is ignored on its axis** rather than saved,
  which left the item's position `NaN` for good.

- **A floating item dragged after its container shrank moves from where it
  shows.** Its saved position may lie outside the smaller container, and the
  first drag was spent walking that position back to the edge.

- **Moving a pinned node into a container with `allowsPinning: false` drops
  its pin,** with a `node.pinnedChanged` event, as `setAllowsPinning(id, false)`
  already does for the children it has. The carried pin used to survive, and
  later inserts into that container routed around it.

- **A drop's `canAccept` check sees spans.** The drag engine handed the strategy
  `{ id }` for each child, so a grid counting cells read every tile as one cell:
  a 4×2 widget dragged onto a page full by cells was accepted, and `layout()`
  then sent it to `unplaced`. The engine now builds each child, and the dragged
  source, the way layout does, `placement` included. `acceptPolicy` sees the
  same items.

- **Hidden children no longer count against a drop.** Layout skips a hidden
  child, but the drop check counted it, so a `maxItems: 2` grid showing one
  tile and hiding another refused a second visible one. The check now sees the
  children layout lays out.

- **A container over capacity can reorder its own children.** A drag within
  one parent asked `canAccept` about the list it already held, so a grid
  holding more children than it has cells, with the rest in `unplaced`, refused
  every reorder. A drop within the source's own parent adds no child and now
  skips `canAccept`; `acceptPolicy` is still asked, and can still refuse.

## 2.0.0

### Removed

- **`store.hasFocus(id)`**, deprecated in 1.2.0. Use `canFocus(id)`, which it
  delegated to.

- **`canAccept(sourceId)` on a drop target**, deprecated in the version below.
  Use `acceptPolicy`, which also sees the prospective child list and the
  container's config. All three forms are gone: the `useDropTarget` option, its
  bare-callback third argument, and the `DropTarget` field a host driving
  `DragEngine` supplies. `DragController.registerDropTarget(id, el, options)`
  loses its third positional parameter with them.

- **`BuiltinAffordanceKind`'s `'keypress'` and `LayoutEvent`'s `kind: 'key'`**,
  neither ever emitted, dispatched, or handled — a keyboard resize reaches a
  strategy as a synthesized `'drag'`. `LayoutEvent['payload']`'s `key` field
  goes with them.

  See [Breaking changes](README.md#breaking-changes) for all three.

### Added

- **`desktopStrategy(inner?)`** lays out overlapping windows at the `x` / `y`
  their placement carries, stacked by child order: each window's `z` is its rank
  plus one, and items marked `icon` are tiled beneath at `z` 0 by `inner`. A
  `minimized` window shades in place, or becomes an icon under
  `minimize: 'icon'`. See [Desktop windows](README.md#desktop-windows).

- **`<Container>` and the presets set `z-index` from a placement's `z`** when it
  is nonzero. No shipped strategy emitted one before `desktopStrategy`; a custom
  strategy that did now gets a `z-index` too.

- **`scrollRef` and `edgeScroll` on the container presets.** `<Zone>` and
  `<Panel container={…}>` take the pair `<Container>` has: the wrapper's offset
  reaches the geometry a keyboard navigation compares, and a drag held near that
  wrapper's edge scrolls it on the same ramp. A preset dock was the one place
  neither reached.

- **The container presets preview a drop.** `<Zone>` and `<Panel container={…}>`
  now lay their children out as if the drop had happened while one is hovering:
  the row opens the gap an insert would leave, and on a split the hovered pane
  shrinks to the half it will actually get with `div.windease-split-preview`
  over the other. Both take the same `splitPreview` prop `<Container>` has —
  `'layout'` (default), `'element'`, `'none'` — and both build the preview from
  the intent their own hit-test already resolved. The pane in flight renders
  transparent, published to its own shell through `LayoutInfo.previewSourceId`,
  so the drag ghost is the only copy the user follows.

- **`shelfStrategy`, `columnStrategy` and `skylineStrategy`** pack boxes of
  varied fixed sizes: in rows, in masonry columns, and bottom-left into the
  lowest free spot. Each item keeps its own size, the container's width is the
  only bound, and height past `container.h` comes back as `overflow`. Config:
  `gap`, plus `columnWidth` on `columnStrategy`. See
  [Packing boxes of fixed sizes](README.md#packing-boxes-of-fixed-sizes).

- **`LayoutResult.channels`** carries per-placement numbers the core never
  reads — an opacity, a rotation, an LOD tier — from a strategy to its host.
  Deliberately untyped (`Map<id, Record<string, number>>`): the library commits
  to the transport, not to a vocabulary it has no predicate over, and every
  value being a `number` is what lets a host interpolate two results without
  knowing what any key means. `ContainerHost` republishes it unchanged and
  leaves the field absent when a strategy emits none.

- **`useChannelsForSelf(id)`** reads this node's channels from the enclosing
  container's last pass — the counterpart to `useLayoutForSelf`. `LayoutInfo`
  carries `channels` beside `placements`, so `<Zone>` and `<Panel>` publish them
  to their subtree.

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

- **`reconcileChildOrder` no longer throws when a child is reported twice.**
  A container preset rendered twice under `<StrictMode>` collected each child's
  report twice, and the duplicates reached `setChildOrder` as a list that was
  not a permutation. Each id now counts once, in the position of its first
  report, with the `order` of its latest.

- **A `<Zone>` with JSX children no longer throws `NodeNotFoundError` on mount
  under `<StrictMode>`.** StrictMode's simulated unmount removes the zone, and
  its panels with it; React then replays mount effects child-first, so each
  panel re-registered under a zone that was not back in the store yet. A child
  whose parent is missing now waits for it, and the parent restores its waiting
  children in their original order.

- **`store.subscribe` can now be passed detached.** It was a prototype method
  reading `this.subscribers`, so the idiomatic
  `useSyncExternalStore(store.subscribe, …)` threw
  `Cannot read properties of undefined (reading 'subscribers')` — the first
  thing a consumer wiring the store into React writes. It is an arrow property
  now; the signature is unchanged.

- **A strategy's `navigate` answer is now validated.** The id came back cast,
  so a strategy naming a node with no `focus` capability reached
  `store.focusNode` and threw `CapabilityMissingError` out of the keydown
  listener, killing the keypress. An unusable id and a `navigate` that throws
  are both traced on `workspace` and answered by the geometric search instead —
  the same contract `resolveNavigation` already held a replacement policy to.

- **A nested container preset was never placed by its parent's strategy.**
  `<Zone>` inside a `<Zone>`, and a `<Panel container={…}>` inside one, both
  published their own `LayoutScope` around themselves and so looked up their own
  rect in their children's placements instead of their parent's. Finding none,
  they rendered in flow at full size, stacking on top of each other rather than
  tiling — only the leaf `<Panel>`s were ever positioned. The scope now wraps a
  preset's content, not the preset.

  A nested container preset also keeps its placement box across the pass that
  first places it. Gaining one mid-flight remounted the subtree, and a remounted
  descendant re-registered under a fresh owner token while the store still held
  the old one — `node "x" is already mounted by another panel`.

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

- **`DropTarget.canAccept(sourceId)` is replaced by `acceptPolicy`**, which sees
  the prospective child list and the container's config, and can widen a
  strategy's answer as well as narrow it. A target registered by hand moves over
  with `useDropTarget(id, ref, { acceptPolicy })`, which forwards the new bag.
  See **Removed** above.

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
