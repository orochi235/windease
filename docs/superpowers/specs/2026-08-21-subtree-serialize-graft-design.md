# Subtree serialize and graft — design

`serialize(store)` is whole-store (`src/snapshot.ts:51`). A host whose own saved
states are per-item — one saved workspace, not the session — cannot round-trip a
single node without carrying, and then reconciling, a snapshot of the entire
tree.

This spec is for whoever implements the fix. It defines the subtree snapshot
shape, the graft call that attaches one, and the decisions that were open
questions. Ships as **1.2.0** — additive surface only.

## Problem

The motivating consumer is labkit (`@weasel-js/labkit`), a host that owns its
workspace list and persistence in zustand and wants windease for geometry and
gestures. Its saved unit is one workspace; windease's saved unit is the session.
Bridging those today means serializing everything, diffing out the one subtree
that matters, and reconciling the rest back — an integration cost that scales
with the parts of the tree the host doesn't care about.

The generic case is any app adopting windease into an existing store rather than
starting from one.

## `serialize(store, opts?)`

New optional second argument `{ root: NodeId }`. Emits a `SerializedStore`
holding that node and every descendant, in the existing node shape:

- `rootIds: [root]`, and the root's entry drops `membership` — within this
  snapshot it *is* a root.
- New optional top-level `rootPlacement?: Record<string, unknown>` records what
  the root's placement was in its former parent.
- `focusedId` carries the store's focused node only when it lies inside the
  subtree; otherwise `null`.
- `version` stays `5`. `rootPlacement` is an added optional field, not a shape
  change: an older reader ignores it and gets the current behavior.

Because the node shape is untouched, `deserialize(subtreeSnap)` already works and
returns a standalone store. `rootPlacement` is inert there — a root has no parent
to be placed in.

## `graft(store, snap, parentId, opts?)`

Attaches the snapshot's tree as a child of `parentId`. Returns the attached
root's `NodeId`. `opts` is `{ at?: number; force?: boolean }` — an options object
rather than positional arguments, so `force` (the existing `MutateOptions` lock
bypass) has a home and a future id policy has somewhere to land.

Validation runs to completion **before** any mutation:

- every id in `snap.nodes` is absent from the store,
- `parentId` exists and has a container,
- the snapshot has exactly one root,
- `parentId` is not `accept`-locked.

Then, inside `store.transact` so the whole graft is one undo step: migrate the
snapshot through the same v2→v5 chain `deserialize` uses, register nodes in tree
order, apply `rootPlacement`, and `reorderInParent` when `opts.at` is given.

### Graft never moves focus

`graft` does not call `focusNode` and does not write `focusedId`, whatever the
snapshot says — **including when the store has no focused node at all.** Focus is
the user's place in the interface, and an attachment they did not initiate taking
it is the same defect as a control stealing the caret mid-sentence. A consumer
that wants the arriving subtree focused calls `focusNode` itself.

There is no symmetry argument pulling the other way: the focus successor policy
fires when a focused node *departs*, and arrival is not the inverse of departure.
Whole-store `deserialize` restoring `focusedId` stays correct and is a different
thing — session restoration returns the user to their own place.

A grafted node's focus *machine* is registered blurred, as `deserialize` already
does. `ContainerCap.lastFocusedId` — session-only, deliberately unserialized — is
not on `main` yet; it arrives with `feat/keyboard-navigation`. When it lands, a
grafted container correctly has no memory of a prior focus; leave it that way.

## Decisions

Each is settled; the reasoning is here because a reader is otherwise likely to
re-propose the alternative.

**Colliding ids reject rather than remap.** The snapshot's ids are the host's own
record keys — that is what makes a per-item snapshot useful to it. Remapping
would hand back an id map the host has to thread everywhere, and any id embedded
in `node.meta` or `container.state` would silently go stale, since consumer data
can't be rewritten. A host that wants to replace a live subtree calls
`unregisterNode` first.

**Rejection must be a pre-pass, not a caught throw.** `registerNode` already
throws `DuplicateNodeError`, but mid-walk, which would leave a partial tree
grafted and a half-populated `childOrder` on the target parent.

**The root's placement survives the round-trip**, diverging from
`membership.placement` being cleared on detach (`moveNode`). A restore is not a
drop: graft is reconstructing a saved state, usually into the same logical dock,
and losing the pane's size there is the exact loss this feature exists to fix.
Descendants' placements survive either way, since their parent travels with them.

**`graft` is its own function, not a third `deserialize` overload.**
`deserialize(store, snap)` means wholesale replacement. Distinguishing "discard
everything" from "attach without touching anything else" by arity alone is a
trap, particularly since the destructive form is the shorter one.

## Errors

No new codes. `DuplicateNodeError` for a collision (naming the first one found),
`NodeNotFoundError` for a missing parent, and
`InvariantViolationError('parent-not-container')` for a parent that can't hold
children.

## Testing

Headless, in `src/snapshot.subtree.test.ts`:

- Round-trip: serialize a subtree, `unregisterNode` it, graft it back under the
  same parent — tree, placements and container state all identical.
- Graft into a *different* parent, and into a second store.
- Collision throws **and leaves the store untouched** — assert via `recordEvents`
  that nothing was emitted, which is the pre-pass requirement above.
- `at` places correctly, including against a pinned prefix.
- A v4 subtree snapshot migrates on graft.
- `deserialize(subtreeSnap)` standalone.
- An `accept`-locked parent refuses, and `{ force: true }` bypasses it.
- Undo after a graft removes the whole subtree in one step.
- **Focus is untouched**: graft a subtree whose snapshot carries a `focusedId`
  into a store that already has a focused node, and assert `store.focusedId` is
  unchanged. Repeat with `focusedId === null` beforehand and assert it stays
  null. These pin the rule above against a later well-meaning "restore focus on
  hydrate" change.

## Out of scope

Grafting a subtree that overlaps the live tree by id (see the rejection decision
above), and any cross-store id rewriting. If a duplicate-a-workspace case ever
appears, it wants an explicit `{ ids: 'remap' }` option returning a map, designed
against that consumer rather than guessed at now.
