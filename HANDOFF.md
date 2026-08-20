# Handoff — headless layout host, and what to do about `splitStrategy`

Session state for `feat/core-drag-controller`. The consumer report that used to
live in this file has been folded into `TODO.md` (see "Replace `splitStrategy`
with a split *operation*"), so nothing here is the only copy of anything.

- **Branch:** `feat/core-drag-controller`, cut from `main` after v0.9.0 shipped.
  Nothing pushed. Eight commits.
- **Spec:** `docs/superpowers/specs/2026-08-19-headless-layout-host-design.md`
- **Green:** lint, typecheck, 624 unit tests / 57 files, 11 Playwright e2e,
  `npm run build`.

## Done

Steps 1-3 of the spec, plus the e2e suite it named as a prerequisite.

| Commit | |
|---|---|
| `b35d92c` | `DragController` + `insertionIndex` into core |
| `18101e1` | Ladle: flatten tree, churn slider, Playground height |
| `134efbf` | Playwright e2e suite |
| `29a9185` | `ContainerHost` extracted from `useContainerLayout` |
| `6d6bca9` | synchronous invalidation + notification coalescing |
| `0c99ae6` | biome excludes for Playwright artifacts |
| `6951b94` | reconcile decisions into core |
| `3890209` | `fix(split)`: honor the documented `direction` option |

`useContainerLayout` went 229 lines to 72 and kept its exact signature, so
`Container.tsx` is untouched and `windease/react`'s public surface is unchanged.

## Next

**The open decision is sequencing, not design.** `TODO.md` records the call:
split becomes a store operation, layout becomes `strip` with a direction, the
node tree is the only tree. What is not decided is what the blocked consumer
gets in the meantime — patch `splitStrategy`'s tiling as throwaway work on a
structure that is going away, or give them the verb early.

Step 4 of the spec (a second binding) is still deliberately open between
`windease/vanilla` and `windease/elements`. Steps 1-3 were identical either way;
this is the point where it has to be decided. The three deciding facts are in
the spec's last section.

## Traps

- **`store.subscribe` notifies asynchronously**; the `node.*` events are
  synchronous. `ContainerHost` subscribes to both — the events to close the
  stale-read window, `subscribe` as the catch-all so anything not enumerated is
  still caught, a tick late. Do not drop either.
- **`ContainerHost.layout()` must stay identity-stable.** It is React's
  `getSnapshot`; returning a fresh object per call loops the render forever.
  Recomputing on demand was measured and rejected (0.01us cached against
  2.8-70us recomputed, and it breaks `getSnapshot` regardless).
- **Host notifications describe a transition away from a value already read.**
  A listener subscribing before the first `layout()` hears nothing until it has
  read once. React never hits this; a vanilla consumer can.
- **`ParallelZonesDnd` registers a drop target for the same zone id its
  `<Container>` already registered.** Child effects run before parent effects,
  so the story's registration wins and loses the default `getInsertionIndex` —
  every drop there appends. `Playground` documents the trap and avoids it.
- **The split story passes an explicit `viewport`**, so it never exercises the
  ResizeObserver path. Reflow coverage needs a ref-measured fixture.
- **`test-results/` is gitignored but biome reads the filesystem**, so a local
  e2e run can fail `npm run lint` until the excludes in `biome.jsonc` cover it.

## Parked

`scratchpad/split.tiling.test.ts` — five failing tests for balanced tiling and
extent clamping, written before the split-as-verb decision. Useful if
`splitStrategy` gets patched; delete if it gets replaced.
