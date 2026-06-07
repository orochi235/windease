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

## Declarative JSX tree binding [HIGH — blocks credible 1.0]

It's hard to call this a "React implementation" while consumers must
call `store.registerNode(...)` imperatively to populate the tree.
`<Container><Panel /></Container>` should Just Work. This is the next
big chunk before any 1.0 push.

Target shape:

```tsx
<Provider>
  <Zone strategyId="grid" config={{ cols: 2 }}>
    <Panel meta={{ title: 'A' }} />
    <Panel meta={{ title: 'B' }}>
      <Panel meta={{ title: 'nested' }} />
    </Panel>
  </Zone>
</Provider>
```

This becomes the *primary* React API; the imperative store-building path
stays available for dynamic/server-loaded trees, but the declarative
form is the one we lead with in docs.

Mechanics to work out:
- Each preset (`<Panel>`/`<Group>`/`<Zone>`) emits a registration
  effect: register on mount, unregister on unmount, keyed by an
  explicit `id` prop (or a stable auto-generated id).
- Children walk happens implicitly via React's tree — `<Zone>` knows
  its parent is the closest `<Container>`/`<Zone>` ancestor through
  context, so each preset just registers itself.
- Reordering: React's child-order in JSX maps to the store's
  `childIds`. Re-rendering with a different key order calls
  `reorderInParent`.
- Container's `chrome` prop becomes optional; with no chrome, JSX
  children render directly.
- Dynamic vs. JSX: if both exist, JSX is the source of truth for what
  it owns; store ops outside JSX (e.g. DnD moves) still work and JSX
  reconciles next render.

Open questions:
- Strategy-state init: today done via `setContainerState`; declarative
  could read a `state={...}` prop on `<Zone>`.
- Hooks/refs: do we still need `useChildren`, `useNode` in the
  declarative world? Mostly yes — for read-side consumers.
- Effect ordering: register parents before children. React's effect
  order (children-first by default) needs care; might need a
  layoutEffect with a two-pass commit.

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
