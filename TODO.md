# TODO

Future work, sectioned by item. Append new ideas here rather than scattering
them. Tag major items with `[HIGH]`.

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

## Followups from v0.1

Smaller items surfaced during v0.1 review. Promote to a `[HIGH]` section if
they grow.

- `useWindow(id)` does not re-render on FSM state changes (in-place machine
  mutation keeps the WindowRecord reference stable; `useSyncExternalStore`
  bails out). Documented in `packages/react/src/hooks.test.tsx`. Fix options:
  selector-shaped hook (`useWindowSelector(id, w => w.lifecycle.state)`),
  record replacement on mutation, or an `events`-derived hook.
- `snapshot()` serializes `transit` state but `hydrate()` ignores it.
  Either drop the field or honor it.
- `hydrate()` doesn't validate `version` field — silent corruption risk when
  v2 ships.
- Layout strategies cast `zone.config as XConfig` unchecked. Typos at
  registration time become silent runtime quirks.
- Strip strategy returns zero width/height when a window has no
  `preferredSize` — intentional for fixed-size toolbars but worth a doc
  comment.
- `@windease/react` ships no CSS; consumers must size `.windease-zone`
  themselves (the Ladle Playground hit this — see commit `60eaa56`). Either
  ship a minimal stylesheet or document the requirement in the README.
- Package `package.json` metadata is thin (no `description`, `repository`,
  `license`, `keywords`). Fill before publishing to npm.
- npm install warns of moderate/critical vulnerabilities in dev deps. Audit
  pass before publishing.
