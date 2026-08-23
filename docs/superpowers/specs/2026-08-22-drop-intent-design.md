# Drop intent, and tab-stacking as its first consumer

For the person implementing this. It specifies a drop hit-test that answers
*what kind of drop* the cursor is asking for, and the tabbed-stack container
that is the first thing to need the answer. Drop-on-edge is the second, and is
deliberately not built here.

Read [`docs/concepts.md`](../../concepts.md) first if the four data buckets
(`hints` / `container.config` / `node.meta` / `membership.placement`) are not
already familiar — this design puts state in three of them.

## The gap

`DropTarget.getInsertionIndex(point) → number | undefined` is the entire drop
vocabulary. It answers "which seam", and `DragEngine.drop()` unconditionally
turns the answer into `store.moveNode(source, target, index)`. There is no way
to say "onto that pane" — which is what tab-stacking and drop-on-edge both need,
and why doing the hit-test once, first, is cheaper than doing it twice.

## The resolver

`src/dnd/dropIntent.ts`, pure, no DOM:

```ts
export type DropIntent =
  | { kind: 'insert'; index: number }
  | { kind: 'stack';  ontoId: ItemId }
  | { kind: 'split';  ontoId: ItemId; edge: 'start' | 'end' };

export function resolveDropIntent(
  rects: readonly { id: ItemId; rect: Rect }[],
  cursor: Point,
  axis: 'x' | 'y',
  options?: { stack?: boolean; split?: boolean; band?: number },
): DropIntent;
```

Within the hovered child's rect: bands along the **main** axis resolve to
`insert` at the neighbouring seam, bands along the **cross** axis to `split`,
and the centre to `stack`. Corners resolve to `insert`. `edge` is which end of
the **cross** axis the band sits at, so in a horizontal strip `'start'` is the
top of the pane. `band` is a fraction of the rect (default `0.25`), clamped so
opposing bands cannot meet on a narrow pane.

Bands are carved only for intents the options enable. With `stack` and `split`
both off the function returns exactly what `insertionIndexByMidpoint` returns
for the same cursor — that equivalence is a test, and it is what makes this
additive rather than a behaviour change.

`childRectsForContainer` remains the DOM harvester feeding it. Nothing in this
file measures.

## Wiring it through the engine

`DropTarget` gains `getDropIntent?(point): DropIntent | undefined`, beside the
existing `getInsertionIndex`, which is kept and still honoured when no intent
function is registered. `DragState.hover` gains `intent` and the resolved
onto-child rect; `drop()` switches on the intent kind instead of always calling
`moveNode`.

Acceptance for a `stack` intent is not the check that exists. The onto-child is
being *reparented*, so it needs `lock.move` clear and its parent `lock.arrange`
clear, and the intent is rejected when the onto-child is the dragged node or a
descendant of it. Today's target-level `checkAccept` can see none of that,
because until now the target *was* the destination.

A parent whose child order is controlled (`registerOrderControl`) rejects every
non-`insert` intent. A wrap cannot be expressed as a child-order array — it
creates a node the host never asked for — so the alternative is writing to the
store behind a host that believes it owns the order.

## The stack

`store.stackNodes(sourceId, ontoId, { id, config })`. When the onto-child's
parent is already a stack this is `moveNode` into it. Otherwise it wraps: a new
stack container takes the onto-child's slot — same parent, same index,
inheriting its `placement` — and the onto-child then the source become its
children.

All validation runs before the transaction opens. `store.transact` does not roll
back, so a callback that throws partway leaves every mutation it already made.

`stackNodes` sets `container.autoUnsplit` on the container it creates.
`coalesceParent` already collapses any container a removal leaves holding one
child, lifting the survivor into the grandparent; it is not split-specific.
Dragging the last tab out therefore dissolves the stack with no new code.

## The strategy

`stackStrategy`, config `{ activeId?, headerSize, padding }`. The active child
gets the container rect less `headerSize` off the top and `padding`; every other
child comes back in `hidden`. An `activeId` naming a child that has left falls
back to the first in `childOrder`.

`headerSize` is what reserves room for the consumer's tab strip. The core does
not measure the strip — measurement is an input, and the config is the input.

`LayoutResult` gains `hidden?: TId[]`, distinct from `unplaced`: *placed
nowhere and must not render*, versus *not placed, and the host may render it in
an overflow tray*. `PresetShell` renders `null` for a hidden id.

The distinction is load-bearing, not fussiness. `PresetShell` ends with
`if (!selfRect) return shell` — a child with no rect renders in normal flow,
unpositioned. Grid overflow depends on that. Reusing `unplaced` to mean "do not
render" would silently change what a capped grid does with its overflow. A
hidden child renders no element, so it also leaves focus traversal and drop-
target registration without either needing to know about stacks.

## Activation

`activeId` lives in `container.config`, defaults to the first child when unset,
and is set to the source on a drop. `useStack(containerId)` returns
`{ tabs, activeId, activate }` and writes through `updateContainerConfig`.

That call is gated by `lock.arrange`, so a stack locked against rearrangement
also cannot switch tabs. This is the wrong axis for activation. It is recorded
rather than fixed: a second lock axis costs more than the wart.

## Chrome

The consumer draws the tab strip through `ChromeMap`, as it already draws every
panel. The library ships the model, not the strip.

No default drop preview ships either. There is none for insertion today —
`defaultDragOverlay` is a cursor-following chip and `insertIndex` sits in
`DragOverlayContext` undrawn — so `intent` and the onto-child rect join it there
and drawing stays the consumer's. Seam-join ships an appearance because it
destroys a pane with no confirmation step; a stack is one undo away, so that
exception does not extend to it.

## Tests

Headless, except where the gesture is the point.

- `resolveDropIntent`: the compatibility sweep (stack and split off, agreeing
  with `insertionIndexByMidpoint` at every cursor position across the row), band
  clamping on a pane narrower than two bands, corner resolution, empty list.
- `stackStrategy`: active child's rect, the rest `hidden`, departed `activeId`.
- `stackNodes`: wrap, already-a-stack, placement and index inheritance, and a
  rejected call leaving the tree byte-identical — the pre-transaction validation
  asserted as a fact rather than assumed. One undo step is one `transaction.begin`
  / `end` pair; there is no `store.undo()`.
- `DragEngine`: dispatch per intent kind, the lock and ancestry rejections, and
  a controlled parent refusing a stack.
- One Ladle story with an operable tab strip, driven in all three engines: a
  drop in a centre band forms the stack, tabs switch, the last tab dragged out
  dissolves it, and a drop in a main-axis band still plain-inserts.

**Mutation-check every negative assertion.** Break the behaviour on purpose and
watch the test fail. Three defects in seam-join survived ordinary review and died
to this, two of them after passing two review passes each.

## Not in this change

- **The split commit.** The resolver carries the `'split'` case and its option,
  but no band is carved for it and nothing emits it. Drop-on-edge then adds a
  commit path, not a second hit-test — which is the whole reason for building
  the resolver first.
- **Creating a stack from the keyboard.** Activation from the keyboard belongs
  to the consumer's tab strip.
- **A shared gesture lifecycle.** Intent rides `DragController`, which already
  owns arm / cancel / commit / lock / undo / announce, so this adds no third
  copy and the "wait for a third" call in `TODO.md` stands.

## Correction to make in passing

`layout-types.ts` documents `maxSize` as honoured by "the strip / stack / split
strategies". Only `stripStrategy` and `gridStrategy` exist. The comment is
corrected when the stack strategy makes half of it true.
