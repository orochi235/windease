# Moving several nodes at once — `store.moveNodes`

For whoever implements this. Assumes windease fluency (`docs/concepts.md`) and
the two tenets in `CLAUDE.md`.

One primitive: move a set of nodes into one parent as a single operation. No
selection model, no multi-drag — those are separate questions, and the last
section says why this one does not settle them.

## Why a loop is not enough

`store.moveNode` in a `store.transact` loop is what a host writes today. It is
correct for panes with no pins, no locks, and an `autoUnsplit`-free source. Four
things break it otherwise, and all four are invisible until they bite.

**The source container can dissolve mid-loop.** Every `moveNode` ends with
`coalesceParent(fromParentId)` (`src/store.ts:538`), which unsplits an
`autoUnsplit` container the removal has just left holding one child. Moving
three of four children out one at a time dissolves the group on the third
removal and lifts the survivor into the grandparent — so the fourth move, or a
cached `fromParentId`, addresses a node that no longer exists. Which iteration
triggers it depends on the order the caller happened to choose.

**The index asked for is not the index used.** `moveNode` clamps `at` to the
target's current length and then runs `placeRespectingPins`
(`src/store.ts:486`), so a pinned sibling relocates the insert. Passing one `at`
for three nodes inserts each ahead of the last and reverses them; incrementing
`at` by hand is wrong the moment the target holds a pin.

**A partial move stands.** `transact` brackets events and nothing else
(`src/store.ts:1282`) — it does not roll back, by design. `moveNode` asserts
`move` on the node, `accept` on the destination and `dragOut` on the source
(`src/store.ts:423`), so one locked node halfway down the list throws with the
earlier nodes already moved. Getting this right outside the library means
re-implementing the lock checks to pre-validate.

**Per-node event volume.** Each move drives the transit machine through
`releasing → claiming → idle` (three `node.transitioned` emits), fires
`node.moved`, re-runs focus bookkeeping and calls `clampPins` on both parents.
A host listening for structural change sees the batch as *n* unrelated moves.

## The batching that already exists

Three layers already coalesce, and none of them is the one this primitive adds.
An implementer should not rebuild any of them.

**Publishes.** `markDirty` merges repeat marks on one node into a single pending
publish and counts them (`src/throttle.ts:398`). Five moves touching five nodes
are five dirty entries in one publish; five touching one node are one entry with
`coalesced: 5`. The field's own doc comment draws exactly the line this section
is about: it counts internal dirty-marks, *not* store operations
(`src/throttle.ts:259`).

**Undo.** `HistoryController` defers every `push` while a transaction is open and
commits one snapshot when the outermost closes (`src/history.ts:29`,
`src/history.ts:73`), so a bracketed run of moves undoes as one step. It is
host-wired rather than automatic — `store.events.on('transaction.begin', () =>
history.beginTransaction())` — which is why `moveNodes` has to emit the pair to
inherit the behavior.

**Events.** `transact` brackets a run with `transaction.begin` / `transaction.end`
and is re-entrant, so nesting is safe.

What none of them does is coalesce the **operations**. Five `moveNode` calls stay
five moves: five transit cycles, five `coalesceParent` passes, five pin clamps,
five chances for the source container to dissolve underneath the next call. The
traps in the previous section are all at that layer, which is why bracketing a
loop in `transact` does not fix them and a primitive is needed.

## API

```ts
moveNodes(
  ids: readonly NodeId[],
  toParentId: NodeId,
  at?: number,
  opts?: MutateOptions,
): void
```

Sits beside `moveNode`, which keeps its current behavior and can delegate.

## Semantics

**Validate everything, then mutate.** Walk the whole set first: each node exists
and has membership, no cycle against `toParentId`, `toParentId` is a container,
and every `move` / `accept` / `dragOut` lock permits it. Throw before the first
mutation. This is the substitute for rollback, which `transact` does not offer —
and it is the reason the primitive belongs in the library rather than in a host.

**Duplicates and ancestors collapse.** Repeated ids are deduplicated. If the set
holds both a node and one of its descendants, the descendant is dropped: moving
the ancestor takes it along, and moving it separately afterwards would tear it
out of the subtree that just moved.

**Source order is preserved.** The moved nodes arrive in the relative order they
had, read across all their source parents in the destination's own terms: for
nodes from one parent, that parent's `childOrder`; for nodes from several, the
order of `ids` as given. Say this in the doc comment — a caller passing a `Set`
gets iteration order and should not be surprised by it.

**One insertion point, resolved once.** Clamp `at` against the destination's
length as it stands *before* the batch, splice the whole run in at that point,
then apply `placeRespectingPins` to the result. A run inserted next to a pin
moves as a run.

**Settling is suspended until the end.** Every per-node repair `moveNode` runs
inline — coalesce the source, clamp pins on both parents, repair focus memory —
is deferred to one pass after the last node lands. See **The settle pass** below.
It is the substance of this primitive: without it a batch is a loop.

**Same-parent members are a reorder, not a move.** A node already under
`toParentId` keeps its membership: no transit cycle, no `node.moved`. It is
repositioned into the run. Emitting a move for a node that did not move would
make a host's undo entry claim a reparent that never happened.

**Events.** Each moved node still emits its own `node.moved` and transit
transitions — those are per-node facts and a host filtering by id needs them.
Wrap the batch in a `transaction.begin` / `transaction.end` pair with a default
label of `moveNodes`, so a host recording history per transaction gets one undo
step (the convention `unsplit` and `stackNodes` already follow). Notify once.

**Tracing.** One `store` trace naming the batch —
`moveNodes: 3 → dock@2 (from main, sidebar)` — rather than *n* move lines.

## The settle pass

Four repairs have to run after a structural change, and today each operation
hand-rolls its own order inline: `moveNode` coalesces the source, clamps pins on
both parents and repairs focus memory (`src/store.ts:511-521`); `unregisterNode`
succeeds focus and clamps the old parent's pins; `unsplit` and `stackNodes` each
do their own subset. Run per node, in a batch, they interfere — the source
dissolving on node three invalidates the parent node four was going to be
removed from.

Factor them into one ordered pass the store runs **once**, at the end of any
structural operation, over the set of parents that operation touched:

1. **Coalesce.** For each distinct touched parent, dissolve it if it is an
   `autoUnsplit` container now holding exactly one child. Judged on the state
   after the whole batch, which is the only judgment that does not depend on
   iteration order. The existing `coalescing` re-entrancy guard
   (`src/store.ts:540`) is the single-operation version of this idea.
2. **Clamp pins.** For each touched parent that survived step 1, reconcile every
   `placement.pinned` against the index the child actually holds.
3. **Repair focus memory.** Drop a stale `container.lastFocusedId` from every
   ancestor that no longer contains the node it names, and re-remember the
   focused node up its new chain.
Then one notify, for the whole pass.

No fourth step for focus succession: nothing a move can do loses focus without
`unregisterNode` already succeeding it, so `succeedFocus`'s `'moved'` reason
(`src/store.ts`) still has no caller. Leave it uncalled rather than inventing
one.

`moveNodes` is the first caller. `unregisterNode`, `unsplit`, `stackNodes` and a
future batch destroy are the others already writing their own version, and each
should be moved onto it rather than keeping a private copy.

**Not a strategy.** "Strategy" in this codebase means a pure function of
`{ items, container, state, options }` returning a `LayoutResult`. Settling is
structural — tree shape, pins, focus — and runs on the store with no container
or geometry in hand. It belongs beside the mutation methods, not in
`src/layout/`.

**Built in, not replaceable.** No consumer has asked for a different settle, and
the precedent for `chooseSuccessor`, `resolveNavigation` and `acceptPolicy` is
that a built-in shipped first and became replaceable when one did.

**Placement is carried, not cleared.** `moveNode` replaces `parentId` on the
membership and touches nothing else (`src/store.ts`), so `size`, `pinned`,
`span` and any host key arrive intact at the new parent. Three places used to
say the opposite — the `MembershipCap` docstring, `docs/concepts.md` and
`CLAUDE.md` — and all three were describing a contract the code never had; they
now say what happens. `moveNodes` matches `moveNode`.

Clearing on reparent was considered and dropped. Every reserved key is
parent-relative, so clearing is defensible on the merits, but `moveNode` has
seven internal callers — `unsplit` lifting children into the grandparent,
`stackNodes` building a stack around two panes, the drag engine's drop — and
under clearing every auto-unsplit would silently wipe the sizes off the
surviving panes. Doing it properly means splitting "someone moved this pane"
from "the library re-plumbed the tree around it", which is a breaking change
and its own piece of work. Not this one.

## What this deliberately does not do

**No rollback.** Validate-first covers the failure modes the library can see. A
callback that throws inside a wider `transact` around this call still leaves the
batch applied; that is the documented store behavior and this API does not
change it.

**No selection.** `ids` is an argument, not state. A host holding a selection in
a `Set` calls this with it; nothing in the store knows what a selection is. If
selection ever lands, it belongs beside focus as store-level `selectedIds` with
its own change event, not as a per-node flag — a flag would be snapshotted and
would go stale the moment one tree has two views.

**No multi-drag.** The drag engine tracks a single `draggingId`
(`src/dnd/DragEngine.ts:253`) and nothing here changes that. Multi-drag needs a
set at drag start, a ghost for the set, and `canAccept` evaluated against the
set; `moveNodes` is the commit step it would eventually call, which is the
argument for landing it first and alone.
