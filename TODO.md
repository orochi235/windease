# TODO

Future work, sectioned by item. Append new ideas here rather than scattering
them. Tag major items with `[HIGH]`.

## Pinning items within a zone

Baseline shipped: `itemMeta.pinned: true` promotes a window to the
pinned-prefix of `zone.windowIds` via `resortByPin`. Strategies see the
flag through `LayoutItem.meta.pinned` if they want extra behavior. Snapshot
round-trips, undo works (history captures full store state).

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
  `registerZone`/`unregisterZone` work; what's missing is a UX for it.

## Drag-and-drop support [HIGH]

Spec calls drag "designed for, not shipped." The transit FSM, ownership
transitions, and `moveWindow(id, zoneId, at?)` API already exist; what's
missing is the pointer-driven UX layer.

Scope:

- Pointer/touch drag handles on window headers (consumer opts in).
- Drop-target indicators on zones (highlight on hover, insertion-point
  preview).
- Reorder-within-zone via drag (already supported programmatically via
  `reorderInZone`).
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

## Declarative JSX tree binding [HIGH]

Today's React layer is store-driven: consumers build the tree
imperatively via `store.registerNode(...)` and `<Container>` renders the
store's children via `chrome` handlers. JSX like
`<Container><Panel /></Container>` is silently dropped — Container
ignores its `children` prop.

A declarative mode would let consumers express the tree directly:

```tsx
<Provider store={new Store()}>
  <Zone strategyId="grid" config={{ cols: 2 }}>
    <Panel meta={{ title: 'A' }} />
    <Panel meta={{ title: 'B' }}>
      <Panel meta={{ title: 'nested' }} />
    </Panel>
  </Zone>
</Provider>
```

Sketch:
- Each preset (`<Panel>`/`<Group>`/`<Zone>`) emits a node-registration
  effect in declarative mode, keyed by id (auto-generated if omitted).
- Children walk happens on mount; on unmount the node is `unregisterNode`'d.
- Conflicts: existing chrome dispatch needs a switch — either Container
  rendered "from store" (current behavior) or "from JSX" (new).
- Useful for small static layouts; less useful for big dynamic apps.

Open questions: does the declarative mode coexist with `chrome` or
replace it? How are runtime mutations (add/remove from outside JSX)
reconciled? Probably ship as a separate `<DeclarativeContainer>` so
the two stay distinct.

## Playwright e2e suite

The vitest suite + jsdom covers store logic and React component output,
but DnD and resize gestures are only exercised through synthetic pointer
events. A real-browser pass via Playwright (or @web/test-runner) would
catch:

- pointer capture / setPointerCapture behavior across browsers
- ResizeObserver-driven layout under actual reflow
- CSS stacking interactions between affordance hit areas and chrome
- focus management across drag-induced re-renders
- snapshot/hydrate cycle with persisted container state (resize ratios)

Ladle's playground stories already represent the canonical fixtures —
e2e specs would drive them with `@playwright/test`, screenshot key
flows, and assert DOM/store state afterward. Medium priority; not a
publish blocker but a desirable hardening pass.

## Loose ends

- Layout strategies cast `container.config as XConfig` unchecked. Typos at
  registration time become silent runtime quirks.
- Strip strategy returns zero width/height when a panel has no
  `preferredSize` — intentional for fixed-size toolbars but worth a doc
  comment.
- npm install warns of moderate/critical vulnerabilities in dev deps. Audit
  pass before publishing.
