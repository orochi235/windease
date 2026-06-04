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

See `docs/superpowers/specs/2026-06-04-windease-design.md` for design notes.

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

## Develop

```bash
npm install
npm test
npm run build
npm run lint
```
