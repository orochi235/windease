# windease — concepts and terminology

Canonical reference for the vocabulary windease uses. Skim top-to-bottom for
the mental model; jump to a section when you hit a term you don't recognize.

## Mental model

windease is a **store of windows partitioned into zones, arranged into a
workspace.** Three primitives:

- **Window** — a renderable unit. The library knows its identity, lifecycle,
  size hints, and zone membership; the consumer renders its contents.
- **Zone** — an ordered container of windows. A zone has a **layout
  strategy** that decides where each member window is placed inside the
  zone's viewport.
- **Workspace** — an arrangement of zones in screen space. Built-in
  workspace strategies (`binarySplit`, `recursiveSplit`) give resizable
  panes; consumers can also lay zones out with plain CSS.

Each visible window lives in exactly one zone, or is unowned (`zoneId: null`).

## Identity

`WindowId` and `ZoneId` are **branded string types**: `string & { __brand }`.
Use `asWindowId(s)` / `asZoneId(s)` to mint them. The branding is structural
guard-rail — there's no separate id generator.

## State machines on a window

Every `WindowRecord` carries three small typed FSMs:

| Machine     | States                                         | Drives                              |
| ----------- | ---------------------------------------------- | ----------------------------------- |
| `lifecycle` | `mounted` → `visible` ↔ `hidden` → `destroyed` | Whether the window renders at all   |
| `transit`   | `idle` ↔ `claiming` / `releasing`              | Zone-ownership transitions (atomic) |
| `focus`     | `focused` ↔ `blurred`                          | Single-focus invariant across store |

FSM events are dispatched by the store (e.g. `show` / `hide` / `claim`). The
`window.transitioned` event fires whenever any machine moves; consumers
subscribe via `store.events.on('window.transitioned', …)`.

## The four data buckets

windease lets you attach state at four distinct places. Pick the one whose
**scope** matches the lifetime of the data:

| Bucket                   | Scope                                          | Use for                                                 |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------- |
| `WindowHints`            | Window, layout-only                            | `minSize`, `preferredSize`, `order` — soft layout prefs |
| `WindowRecord.meta`      | Window, free-form, survives `moveWindow`       | Window-intrinsic consumer data (e.g. URL, title)        |
| `ZoneRecord.config`      | Zone, strategy-typed                           | Strategy options (`cols`, `rows`, `gap`, `padding`)     |
| `ZoneItemMeta` / itemMeta | Per-membership, cleared on `release`, not carried by `moveWindow` | State that exists *because of this placement* — pin flags, slot-specific UI state |

`ZoneItemMeta` is the joint between a window and the zone it's currently in.
Access via `store.getItemMeta(zoneId, id)` / `setItemMeta` / `patchItemMeta`
(patch with `undefined` deletes a key). The bag is exposed to strategies as
`LayoutItem.meta` so layout code can read flags like `pinned`.

**Reserved itemMeta keys:**

- `pinned: true` — promotes the window to the **pinned-prefix** of
  `zone.windowIds`. Strategies render it earlier; reorder operations that try
  to put it past an unpinned window are silently snapped back. Other windows
  can still drop adjacent to it.
- `locked: true` — implies pinned at the layout layer, **and** the React
  layer additionally refuses to start a drag from a locked window. Consumers
  typically also suppress destroy/move/unpin UI for locked items. Use this
  for windows that are part of the chrome (e.g. a controls widget that owns
  its slot for the duration of the session).

## Layout strategies

A strategy is a pure function of `{ items, container, state, options }` that
returns a `LayoutResult { placements, affordances, unplaced? }`. Strategies
must be JSON-safe in their state and options so snapshot/hydrate works.

Built-ins:

- **`gridStrategy`** — `cols`, `rows`, `orientation` (`'wide' | 'tall'`),
  `maxCols`, `maxRows`, `maxItems`, `gap`, `padding`. `maxItems` is mutually
  exclusive with `maxCols`/`maxRows` (throws if both are set).
- **`stackStrategy`** / **`stripStrategy`** — main-axis stacks with `fill`,
  `defaultItemSize`, `axis` (strip only), `gap`, `padding`.
- **`binarySplit`** / **`recursiveSplit`** — workspace-level splits with
  draggable gutters.

Optional hooks:

- `canAccept(items, options)` — DnD calls this on the *prospective* post-drop
  items list. Return `false` to reject the drop. `gridStrategy` rejects when
  the count would exceed capacity (`cols * rows` or `maxItems`).
  `binarySplit` rejects when `items.length !== 2`.
- `reduce(state, event, ctx)` / `initialState(items)` — gesture-driven
  strategies (workspace splits) use these to evolve their state across drag
  events.

`LayoutItem` carries `id`, optional `hints`, and optional `meta` (the
zone's `itemMeta` for that item). A pin-aware grid strategy is roughly
`if (item.meta?.pinned) { /* anchor this cell */ }`.

## Drag-and-drop

The React layer ships pointer-driven DnD. Key behaviors:

- **Axis inference.** The insertion line orients along the target zone's
  primary axis. Zone DnD infers axis from sibling geometry (adjacent-pair
  separation) and falls back to the zone's aspect ratio when there are 0–1
  children. The line is sized to the nearest child's cross-axis extent, so
  in a 2×2 grid you see a one-cell-tall bar, not a zone-tall one.
- **Rejection.** Zones whose strategy returns `false` from `canAccept` get a
  `data-drop-rejected="true"` attribute (style off it); no state mutation
  occurs.
- **Locked source.** A window with `itemMeta.locked` doesn't start a drag at
  all.
- **History integration.** When a `<WindeaseProvider history={…}>` is in
  context, each drag wraps in a single transaction — undo restores the full
  pre-drag state in one step.

## CSS surface

`@windease/react/styles.css` ships the structural rules the library depends
on:

- `.windease-zone` — relative + clipping + fills parent
- `.windease-window` — placement from `--w-x/y/w/h` custom props the library
  sets, plus `container-type: size` + `container-name: windease-window` so
  widgets can adapt with `@container windease-window (…)` queries
- `.windease-insertion-line` — `background: currentColor` default

Cosmetics (colors, transitions, drop-state styling) stay with the consumer.
Style off `[data-drop-target]`, `[data-drop-rejected]`,
`[data-zone-drop-target]`, `[data-window-locked]`, etc.

## Snapshot / hydrate

`store.snapshot()` returns a JSON-safe `SerializedStore`. `store.hydrate(snap,
{ strategies })` rebuilds the store from one. Everything round-trips:
windowIds, itemMeta (under `SerializedZone.itemMeta`), hints, window meta,
and machine states (driven to their persisted state via legal transitions on
hydrate).

## History

`HistoryController<T>` is a snapshot stack with transactions. The Provider
accepts `{ controller, capture, restore }`. Drag gestures auto-begin /
auto-commit a transaction; undo restores via the consumer-provided
`restore`.

## Tracing

Diagnostic-only categorized logs. Free to add liberally — `trace(category,
message, data?)` is a Set lookup when disabled. Categories: `dnd`,
`history`, `layout`, `store`, `workspace`, `zone`. Enable in tests with
`WINDEASE_TRACE=…`, in the browser with `localStorage.setItem('windease.trace', '*')`,
or at runtime via `configureTrace(...)`.

## Errors

`WindeaseError` carries a structured `code` (`DUPLICATE_WINDOW`,
`UNKNOWN_STRATEGY`, `ILLEGAL_TRANSITION`, etc.). Catch on `.code`, not
message text.
