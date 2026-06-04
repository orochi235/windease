# windease

Browser-based window manager. Framework-agnostic core (`@windease/core`) plus
a React binding (`@windease/react`).

- **Zones** are first-class containers. Each visible window lives in exactly
  one zone (or is unowned, `zoneId: null`).
- **Per-window FSMs.** Each window carries three small typed state machines:
  `lifecycle` (mounted/visible/hidden/destroyed), `transit` (idle/claiming/
  releasing), and `focus` (focused/blurred).
- **Layout strategies** are pure functions. Built-ins: `grid`, `stack`,
  `strip`. Custom strategies are a plain object.
- **No persistence baked in.** `snapshot()` + `hydrate()` let the consumer
  choose storage.

- **Per-membership meta.** `ZoneItemMeta` — free-form key/value bag attached
  to a window *while it's a member of a particular zone*. Reserved keys:
  `pinned` (promotes to the zone's pinned-prefix) and `locked` (pinned +
  refuses drag/destroy in the React layer).

See **[`docs/concepts.md`](docs/concepts.md)** for the canonical
terminology + mental model. Design notes:
`docs/superpowers/specs/2026-06-04-windease-design.md`.

## Usage

```tsx
import { WindeaseProvider, Zone, useWindowsByZone } from '@windease/react';
import { gridStrategy, asZoneId } from '@windease/core';

<WindeaseProvider
  zones={[{ id: asZoneId('main'), strategy: gridStrategy, config: { cols: 3 } }]}
>
  <Zone id={asZoneId('main')}>
    {(window, placement) => <YourPanel window={window} />}
  </Zone>
</WindeaseProvider>
```

## v0.2 breaking changes

- `LayoutStrategy` now returns `{ placements, affordances }` instead of just
  a placement map.
- Strategy inputs renamed: `{ zone, windows, viewport }` → `{ items, container, state, options }`.
- New `<Workspace>` component for multi-zone layout with draggable splits.
- New built-in strategies: `binarySplit`, `recursiveSplit`.

If you wrote custom strategies, migrate by following the migration of the
built-ins (see `packages/core/src/layout/grid.ts`).

## v0.3 additions (no breaking changes)

- `gridStrategy`: new `rows`, `orientation`, `maxCols`, `maxRows` options;
  auto-balance when neither `cols` nor `rows` is set.
- `stackStrategy` / `stripStrategy`: new `fill` and `defaultItemSize` options.
- `LayoutResult.unplaced?: TId[]` — strategies can signal items they couldn't
  place (e.g. grid overflow past `maxCols × maxRows`). Zone suppresses
  missing-placement warnings for unplaced items.
- `LayoutStrategy.canAccept?(items)` — optional hook the DnD layer uses to
  reject illegal drops. `binarySplit` implements it (`items.length === 2`).
- `<Workspace>` accepts a controlled `state` prop and fires `onGestureStart`
  / `onGestureEnd` around its built-in drag gestures.
- Pointer-driven drag-and-drop: window reorder within / move between zones,
  recursive-split zone-swap, drop indicators (tinted backgrounds).
- `HistoryController` for snapshot-based undo/redo with transactions. The
  Provider accepts a `history` hookup; `<Workspace>` and `<Zone>` auto-wrap
  their gestures in transactions when history is in context.

## v0.4 additions

- **Per-membership meta** — new `ZoneItemMeta` (`ZoneRecord.itemMeta:
  Map<WindowId, Record<string, unknown>>`). Set via `store.setItemMeta` /
  `patchItemMeta`; read via `getItemMeta` or the `useItemMeta` hook. Cleared
  on `release`, not carried by `moveWindow`. Round-trips through
  snapshot/hydrate.
- **Pinning.** `itemMeta.pinned: true` promotes a window to the
  pinned-prefix of `zone.windowIds` via a stable partition; reorder requests
  that interleave pinned/unpinned snap back to the invariant. Strategies see
  the flag via `LayoutItem.meta?.pinned`.
- **Locking.** `itemMeta.locked: true` implies pinned at the layout layer
  and additionally tells the React layer to skip drag handlers (locked
  windows stamp `data-window-locked="true"`).
- **`gridStrategy`: new `maxItems`** — absolute cap on accepted items.
  Mutually exclusive with `maxCols`/`maxRows` (throws).
- **`canAccept(items, options)`** — strategies now receive options too.
  `gridStrategy.canAccept` rejects prospective drops that overflow capacity
  (the configured grid cap or `maxItems`).
- **Axis-aware drop indicators** — Zone DnD infers the target zone's primary
  axis from sibling geometry; the insertion line orients along it and is
  sized to the nearest child's cross-axis extent.
- **Shipped stylesheet** — `import '@windease/react/styles.css'` for the
  structural rules + `container-type: size` on `.windease-window`
  (`container-name: windease-window`). Lets widgets adapt with `@container`
  queries.

If you wrote custom strategies and rely on `canAccept`, the signature is now
`canAccept(items, options)`. Existing impls that ignore the second arg
continue to work unchanged.

## Develop

```bash
npm install
npm test
npm run build
npm run lint
```
