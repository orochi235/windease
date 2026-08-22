# Seam-join design

For whoever implements it. Assumes the vocabulary in
[`docs/concepts.md`](../../concepts.md) and the resize path in
[`src/layout/strip.ts`](../../../src/layout/strip.ts). It answers: what does a
resize gesture that ends in a destroy have to look like, and where does each
piece of it live.

## The gesture

Dragging the A|B seam shrinks B until B hits its `minSize`, and then the seam
stops. Seam-join says: keep pushing past that floor and you are asking to be rid
of B. Release, and B is destroyed; A takes the space.

```
┌────────┬──────┬────────┐          ┌────────────────┬────────┐
│   A    │  B   │   C    │   ──►    │       A        │   C    │
└────────┴──────┴────────┘          └────────────────┴────────┘
         drag right, past B's floor
```

Both directions work: pushing the seam left breaks A's own floor and destroys A.

Opt-in per container, off by default. It deletes a pane with no confirmation
step, so no existing consumer acquires it by upgrading.

## Core

Two config keys on `StripConfig`, both declared in `configSpec`:

| key | type | default |
| --- | --- | --- |
| `joinOnOvershoot` | boolean | `false` |
| `joinThreshold` | number | `24` (px past the floor) |

Two keys rather than `joinOnOvershoot: boolean | number` because `configSpec`
validates against `'boolean' | 'number' | string[]` and cannot express the union.
Both are ignored unless `resizeMode: 'neighbor'` — a redistribute seam spreads
its delta across every sibling and so has no single pane to name as the victim.

`Affordance` gains one optional field:

```ts
join?: { atMin?: NodeId | string; atMax?: NodeId | string; threshold: number }
```

The strategy names who dies at each end of the affordance's range: strip fills
`atMax` with the following pane and `atMin` with its own. The ids are as loose
as `childId` and `affects` beside them, so a strategy working in `ItemId` needs
no cast; the host casts once where it reaches the store. Absent means the seam
clamps as it does today, so every other strategy is unchanged and can opt in
later without a second mechanism.

### `trackJoin` — `src/layout/seam-join.ts`

The seam stops moving but the pointer does not, and nothing in the system
records how far past the stop the user has pushed. `trackJoin` derives it:

```ts
trackJoin({ join, requested, consumed, canDestroy }) -> { armed, candidateId, overshoot }
```

`requested` is cumulative pointer travel since the gesture began; `consumed` is
the extent the layout actually absorbed (`bounds.valueNow` now, less its value
at gesture start). They track each other while the seam moves; once it clamps,
only `requested` grows, and the gap is the overshoot. Its sign selects `atMax`
or `atMin`. Arming requires both `|overshoot| > threshold` and
`canDestroy(candidateId)`. `candidateId` names who is being pushed against, not
who dies — it is populated while `armed` is still false, so the two are read
together.

Pure, like `insertionIndexByMidpoint`: no store, no pointer, no retained state.
The accumulation of `requested` lives in a ref in the React handle.

### `destroyBlockedBy` — `src/lock.ts`

```ts
destroyBlockedBy(store, id): NodeId | null
```

The first node in `id`'s subtree, `id` included, carrying `lock.destroy` — the
blocker itself, so a refusal can name which descendant refused. It supplies the
`canDestroy` predicate above.

This is deliberately stricter than the store it guards. `unregisterNode` checks
`lock.destroy` on the id it is handed and then cascades through
`detachAndRemove` with no further checks, so a destroy-locked node nested inside
a destroyed subtree dies silently. Seam-join does not fix that — it declines to
exploit it. The store's own gap is filed separately in `TODO.md`.

Commit is `store.unregisterNode(victimId)`, already transactional, so the join
is one undo step and history restores the pane with its size.

## React

`AffordanceHandle` gains two refs, both reset on pointerdown: cumulative travel,
and `bounds.valueNow` at gesture start. Each pointermove dispatches the drag as
before, then calls `trackJoin`. `consumed` is re-read from the affordance prop
rather than predicted, so it reflects what the strategy actually wrote — the
same self-correcting read the `point` payload already relies on.

The victim pane is rendered by `<Container>`, not by the handle, so arming
travels up the way active state already does: `AffordanceLayer` gains
`onJoinArmChange(victimId | null)` beside `onActiveChange`, and `<Container>`
marks that child. Both the victim and the handle carry `data-join-armed`;
`styles.css` hatches the one and thickens the other. The attribute is the
contract a consumer restyles against, not the gradient.

**Escape cancels**, matching drag-and-drop. `pointercancel` must take that same
cancel path rather than the commit path — today both land in one handler, which
is where this will go wrong if it is written carelessly.

**Keyboard.** Arrow keys already dispatch synthesized drags, so at the floor
they accumulate into the same ref and share the arithmetic. `Enter` commits;
`Escape` and the opposite arrow disarm; `End` keeps meaning "go to `valueMax`"
and never destroys. The armed state is spoken through a visually-hidden
`aria-live="polite"` span the handle renders whenever `join` is present —
self-contained, so it works with no `<FocusProvider>` mounted.

## Rules that are not visible in the code

- **The armed state needs two signals, not one.** The victim is at its floor by
  the time the gesture can arm, so a treatment that only tints the victim can be
  a sliver at the edge of the container. The thickened seam is the signal that
  survives; the hatch is what names the victim.
- **A locked victim removes the join, not the drag.** The seam still resizes
  normally up to the floor. Arming a gesture that release would refuse is the
  failure this feature exists to avoid.
- **Overshoot is per-gesture.** Accumulating it across gestures makes a second
  nudge inherit the first one's push.

## Tests

Headless: `trackJoin` (sign, threshold, locked victim, zero overshoot),
`destroyBlockedBy` over a nested subtree, and strip emitting `join` only under
`resizeMode: 'neighbor'` with `joinOnOvershoot`. React: arming paints, Escape
cancels, release destroys, a locked victim never arms. Two behaviors already
owned elsewhere get pinned here because this gesture is the first thing to reach
them by accident — joining a 2-child strip trips `coalesceParent` when the
parent is `autoUnsplit`, and destroying the focused victim runs `succeedFocus`
and announces.

E2E drives the real pointer gesture and the keyboard path against an operable
Ladle story, shipped in the same change.

Assert exact rects: a geometry assertion written as an inequality passes for the
wrong reason, since composing y against the x origin survives
`toBeGreaterThanOrEqual`.
