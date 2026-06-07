# Resizable children

**Status:** design
**Date:** 2026-06-07
**Ships in:** `windease@0.5.0`

## Problem

Today, child sizing in non-split strategies is entirely strategy-driven:
`gridStrategy` lays out uniform cells; `stackStrategy` distributes
available extent across children evenly (modulo `hints.preferredSize`);
`stripStrategy` does the same on the axis. There is no way for a user
(or a consumer programmatically) to say "this particular widget is
200px tall and stays 200px tall." `splitStrategy` exposes interactive
gutters but persists their state as ratios in `container.state`, which
isn't a per-child property.

The first user-visible motivation: the locked control widget in the
playground's sidebar should keep an explicit height regardless of how
many other widgets share the stack. The general motivation: any
mixed-purpose UI (panels of varying importance, sidebars with multiple
docked tools, master-detail layouts) wants the ability to pin
particular children to particular sizes while leaving others
strategy-laid-out.

## Goal

Add a per-child `placement.size?: { w?: number; h?: number }` reserved
key. Each strategy decides whether and how to honor it; consumers
override via existing `store.patchPlacement(id, { size: {...} })` and
interactively via a new resize-edge affordance kind. Snapshot/hydrate
round-trip without changes.

```ts
// Programmatic — works the same as pin/lock today.
store.patchPlacement('sidebar-controls', { size: { h: 180 } });

// Interactive — user drags the bottom edge of a stack child.
//   stackStrategy emits a resize-y affordance for each non-last child.
//   the controller dispatches { kind: 'drag', payload: { dy } }.
//   the strategy translates to store.patchPlacement(id, { size: { h: newH } }).
```

## Non-goals

- No grid multi-cell spans (TODO; deferred).
- No new history/undo machinery (resizes go through `patchPlacement`,
  which already participates in transactions).
- No animation policy changes (existing settle suppression during drag
  applies as-is).
- No change to `hints.preferredSize` semantics. Hints remain
  consumer-declared preferences; `placement.size` is user intent.

## Architecture

### Reserved key: `placement.size`

`Placement` already carries reserved keys (`pinned`, `locked`). Add
`size?: { w?: number; h?: number }`. Either dimension is optional —
"only specify what you want pinned." When omitted, the strategy is in
full control. When present, the strategy must honor it according to
its per-strategy policy (below).

`hints.maxSize` is added as a clamp ceiling. `hints.minSize` already
exists; both apply during resize-drag and during the strategy's
clamping logic.

### Provenance model

`placement.size` is **always user intent** — set either programmatically
or via interactive drag-resize. The strategy is free to compute a
*smaller effective rect* when the container can't accommodate the sum
of intents, **without ever writing back to `placement.size`**. When the
container grows back, the strategy returns to user intent automatically.

This means there is no separate "user-explicit" vs "strategy-derived"
field; the persisted state is always intent, and the per-frame
`layout.placements` rect is always whatever the strategy can fit.

The only writer to `placement.size` is the resize-drag dispatch.

### Per-strategy policies

| Strategy | `placement.size` handling | Resize affordance |
|----------|---------------------------|-------------------|
| `gridStrategy` | **Ignored** (cells stay uniform). Document as a future feature: multi-cell spans where `size.{w,h}` becomes `colSpan`/`rowSpan`. | None. |
| `stackStrategy` | Honors `placement.size.h` (or `.w` for horizontal stacks). Non-last children with explicit size take that extent; last child fills remaining. Multiple explicitly-sized children sum up; the last unconstrained child absorbs the remainder. If the sum overflows the container, the strategy scales constrained children proportionally down to honor `hints.minSize`. | `resize-y` (or `resize-x` for horizontal) on the trailing edge of each non-last child. |
| `stripStrategy` | Honors `placement.size` along the axis. Same proportional-scaling rule on overflow. | `resize-x` (or `resize-y` for axis='y') on the trailing edge of each non-last child. |
| `splitStrategy` | Honors `placement.size` along the split direction. Explicit size *overrides* the ratio for that pane; the other pane takes the remainder. **Dragging a gutter clears the explicit size on both panes the gutter separates** and reverts that split node to ratio-based control. Recursive: same rule at any depth. | Existing gutter affordances continue to render; new resize-edge affordances are NOT added (split's gutter IS the resize affordance). |

### Bounds and degeneracy

When honoring explicit sizes, every strategy applies the same clamp:

1. Compute the **available extent** for the strategy's main axis (container size, minus padding/gaps).
2. Sum the explicit `placement.size` values across constrained children.
3. Subtract from available; if the remainder is less than
   `max(hints.minSize)` of all unconstrained children, **scale the
   constrained children proportionally down** until the remainder
   accommodates the minimums.
4. The clamping is per-frame and doesn't mutate `placement.size`.

This produces predictable behavior when the container shrinks below
the sum of explicit sizes: every constrained child shrinks
proportionally; unconstrained children stay at their minSize.

### Split-sibling-add bounds check

When a new sibling is added to a split that already contains an
explicitly-sized child:

- The new sibling takes the **remaining space** (container extent
  minus the sum of existing explicit sizes), clamped to its own
  `hints.minSize`.
- If that would leave the new sibling below its `minSize`, the
  existing explicit sizes are scaled proportionally down (per the
  policy above) until the new sibling fits.
- `placement.size` on the existing sibling is **not** mutated; the
  scaling is per-frame.

When a sibling is removed:
- The remaining sibling keeps its `placement.size`.
- If it has no explicit size, it expands to fill the container per
  the strategy's normal behavior.

### Snapshot

`placement.size` is plain JSON. `serialize` / `deserialize` already
round-trip the whole `placement` object via passthrough; no schema
change needed. Snapshot version stays at 2.

`hints.maxSize` (new) round-trips the same way.

### Resize-edge affordance

Extend the `Affordance` type with a new kind:

```ts
type AffordanceKind = 'drag-x' | 'drag-y' | 'drag-xy' | 'resize-x' | 'resize-y' | 'resize-xy';
```

`resize-*` kinds are scoped to a specific child id (currently
gutters reference position indexes). The affordance object gains an
optional `childId?: NodeId` field — when set, the dispatch handler in
the strategy translates the `{ kind: 'drag', payload: { dx, dy } }`
event into a `store.patchPlacement(childId, { size })` call.

The React `<Container>` and `<Zone>`'s `AffordanceHandle` need no
changes — they pass `{ affordanceId, kind, payload }` to
`dispatchAffordance` per the existing contract; the strategy
interprets.

### Dispatch flow

```
User drags resize edge
  → AffordanceHandle (existing) computes (dx, dy), captures pointer
  → layout.dispatchAffordance({ affordanceId, kind: 'drag', payload: { dx, dy } })
  → strategy.dispatchAffordance({ affordance, payload, store, parentId })
  → strategy resolves which child this edge belongs to (via affordance.childId)
  → strategy computes new size honoring minSize / maxSize / available space
  → store.patchPlacement(childId, { size: { ...current, h: newH } })
  → store schedules notify
  → React re-renders, strategy recomputes layout, all panes re-place
```

## Affected files

- `src/node.ts` — extend `Placement` with `size?: { w?: number; h?: number }`; extend `NodeHints` with `maxSize?: { w?: number; h?: number }` (if not present).
- `src/store.ts` — no API changes; `patchPlacement` already accepts the new key.
- `src/layout/strip.ts` — add explicit-size honoring + resize-x/y affordance emission + dispatch.
- `src/layout/stack.ts` — same.
- `src/layout/split.ts` — honor explicit size when present; gutter-drag dispatch clears explicit sizes on the two affected panes before applying the ratio update.
- `src/layout/grid.ts` — add a TODO comment; otherwise unchanged.
- `src/layout/types.ts` (or wherever `Affordance` lives) — add resize kinds + optional `childId`.
- `src/snapshot.ts` — verify passthrough works for the new fields; no change expected.
- `src/react/Container.tsx` — already renders affordances via `AffordanceHandle`; verify resize cursors map correctly.
- `src/react/stories/Playground.stories.tsx` — give the locked control widgets an explicit size; verify the sidebar tools can be resized.

## Public API additions

- `Placement.size?: { w?: number; h?: number }` — reserved key alongside `pinned` / `locked`.
- `NodeHints.maxSize?: { w?: number; h?: number }` — clamp ceiling.
- `AffordanceKind`: gains `'resize-x'`, `'resize-y'`, `'resize-xy'`.
- `Affordance.childId?: NodeId` — present on resize affordances; absent on existing gutter affordances.

No new store methods. No new React hooks. No new components.

## Tests

`src/layout/stack.test.ts`:
- Child with `placement.size.h = 200` in a 500px-tall stack with one
  other child: explicit child is 200, other is 300.
- Two children with explicit sizes summing to less than container: each
  honored, no other children → small overflow stays unfilled.
- Two children with explicit sizes summing to MORE than container:
  proportional scaling, each shrinks; sum equals container.
- Resize affordance dispatch: simulate `{ kind: 'drag', payload: { dy: 50 } }`
  on the first child's bottom edge; assert `patchPlacement` was called
  with `size.h` incremented by 50.

`src/layout/strip.test.ts`: same shape, on the axis.

`src/layout/split.test.ts`:
- Binary split with explicit `placement.size.h` on the top pane: top
  is honored, bottom takes the rest.
- Gutter drag: assert both panes' `placement.size` are cleared and
  `container.state.ratios` is updated.
- Sibling-add bounds check: pre-set explicit size on existing pane,
  add a new pane, assert the new pane fits at its `minSize` (with
  existing pane scaled down if necessary).

`src/layout/grid.test.ts`:
- Child with `placement.size` is ignored (cell uniform).

`src/snapshot.test.ts`:
- Snapshot with `placement.size` round-trips correctly.

Total new tests: ~12-15.

## Edge cases & open questions

- **What if a child has `placement.size.w = 200` but the strategy
  only honors the main axis?** The off-axis dimension is silently
  ignored. The strategy computes its main-axis layout; the off-axis
  fills the container. Document this.
- **What if `placement.size` is set on a child of a `gridStrategy`?**
  Silently ignored. The TODO points to a future feature; for 0.5, no
  error or warning.
- **What about animation during the resize drag?** The existing
  `settleMs` suppression-during-drag mechanism (via
  `draggingAffordanceId`) applies automatically.
- **Can a child be both `locked` and have `placement.size`?** Yes —
  the strategy honors the size, the React layer disables drag. They
  combine, just like `pinned` + `locked` today.
- **What happens to `placement.size` on `moveNode`?** It travels with
  the child (placement is part of the slot). If the destination
  strategy doesn't honor it, no-op. If it does, applied immediately.

## Versioning

Ship as `windease@0.5.0`. Additive — no breaking changes to existing
APIs. Snapshot format unchanged.

## Process

Recommend `superpowers:writing-plans` next.
