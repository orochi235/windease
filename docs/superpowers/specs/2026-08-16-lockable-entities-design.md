# Lockable entities

Design for `node.lock`, a first-class API letting a host restrict what may be
done to any node, and for the redefinition of `placement.pinned` that it forces.
For contributors working on the store, the DnD layer, or layout strategies.

It answers: *how does a host freeze part of a layout, and what exactly does
"frozen" mean for a node that has no parent, or no children?*

## Two concepts, currently conflated

Today `membership.placement.locked` means "pinned to the front of the parent's
`childOrder`, and the React layer refuses to start a drag." That fuses two
unrelated ideas, and the fusion makes both weaker:

- **`pinned` is a positional invariant.** It answers *where does this node end
  up, given everyone else's operations?* It is enforced against third parties:
  if another node's insert or reorder would displace a pinned node, the pinned
  node holds and the other item is routed elsewhere.
- **`lock` is a permission.** It answers *who may operate on this node?* The
  user may not drag, resize, or close it. Programmatic host code still may.

They are orthogonal, and all four combinations are useful — a pinned node the
user may still drag away, a locked node sitting untouched mid-list, both, or
neither.

The current fusion has a concrete bug: `store.resortByPin` treats `locked` as
pinned, so locking a pane that sits mid-strip relocates it to the front. A flag
whose purpose is "do not move this" moves it.

Separating them also makes `lock` available to nodes that have no membership.
A zone is a container with no parent, so it has no `placement` to carry a
reserved key; under this design it can still be locked against destruction and
against accepting children.

## `node.lock`

A new optional field on `Node`, beside the capabilities. Node-intrinsic, so it
survives `moveNode` — a system panel must not become deletable by being dragged
into another zone.

```ts
type LockAxis = 'move' | 'resize' | 'destroy' | 'accept' | 'dragOut' | 'arrange';
type LockSet = Partial<Record<LockAxis, boolean>>;

store.setLock(id, true);                        // every axis the capabilities support
store.setLock(id, { move: true, destroy: true });
store.getLock(id): Readonly<LockSet>;           // resolved and capability-filtered
```

| Axis      | Requires     | Guards                                                       |
| --------- | ------------ | ------------------------------------------------------------ |
| `move`    | `membership` | `moveNode` (as source), `reorderInParent`                      |
| `resize`  | `membership` | `patchPlacement`, reserved `size` key only                     |
| `destroy` | —            | `unregisterNode`, on the id and every node under it            |
| `accept`  | `container`  | `moveNode` (as target)                                         |
| `dragOut` | `container`  | `moveNode` where the source's parent is this node              |
| `arrange` | `container`  | `setChildOrder`, `setContainerState`, `updateContainerConfig`   |

`resize` deliberately guards only the reserved `size` key. Free-form consumer
keys on `placement` stay writable under a resize lock; locking a pane's extent
should not freeze the host's own per-placement UI state.

Axes a node's capabilities do not support are dropped on write rather than
rejected, so `setLock(zone, true)` resolves to `{destroy, accept, dragOut,
arrange}` and a host can pass `true` without reasoning about node shape.

A guarded call on a locked axis throws `LockedError(id, axis, op)`, a new
`WindeaseError` subclass.

### Escape hatch

Guards reject by default. The React gesture paths never bypass them, which is
what makes "the user cannot directly do this" true. Host code that means it
bypasses explicitly:

```ts
store.moveNode(id, target, at, { force: true });
store.withLocksSuspended(() => { /* bulk */ });
```

`deserialize` and `HistoryController` use `withLocksSuspended` internally, so
restoring a snapshot and undo/redo are never fought by locks. Without this,
every host would have to unlock, mutate, and relock by hand on every restore.

### Cascade destroy

`lock.destroy` on a child does not veto an ancestor's destroy; the cascade
proceeds. The alternative strands a node whose parent is gone, breaking the tree
invariant. `lock.destroy` throws only for the node `unregisterNode` was called
on. To protect a subtree, lock the ancestor.

## `pinned`

`placement.pinned` changes from `true` to the **held index**. Enforcing "stays
right there" requires knowing where "there" is.

```ts
store.setPinned(id, at?);   // defaults to the node's current index
store.unpin(id);
```

- `setPinned` throws `PinIndexError(id, at, length)` if `at` is outside
  `childOrder`.
- Held slots are reserved. `reorderInParent(x, at)` inserts `x` at the nearest
  free slot at or after `at`, falling back to before when none is free. Pinned
  holders never yield to a third party.
- Sibling removal clamps held indices to the new bounds. Removal never throws;
  only `setPinned` does.
- Over capacity, pinned children win. Strategies send unpinned children to
  `LayoutResult.unplaced` first, so a pinned node is the last to fall out.

Strategies read `pinned` from **`LayoutItem.meta`**, not `LayoutItem.placement`.
`nodeToLayoutItem` projects the whole `membership.placement` bag into `meta` and
surfaces only `size` as typed `placement`; `useContainerLayout` and
`runStrategyForContainer` both feed strategies through that adapter, so
`LayoutNode` never reaches a strategy in the render path. A strategy reading
`placement.pinned` compiles, passes hand-built tests, and is dead code against
real nodes.

`resortByPin` is deleted. `container.allowsPinning` survives unchanged, now
governing index-holding only.

Nothing outside `store.ts` reads `pinned` today — no strategy, no React
component — so the prefix-to-index change is contained to the store, the
snapshot, and tests. The capacity-race rule above is the one place strategies
begin reading it.

## React

`CommonBindingProps`, shared by `<Panel>` / `<Group>` / `<Zone>`, gains two
declarative props reconciled the way `meta` and `placement` already are:

```tsx
<Panel lock />
<Panel lock={{ move: true, destroy: true }} />
<Panel pinned />
<Panel pinned={0} />
```

`acceptsDrops` and `lock.accept` are different things and must be documented
together: `acceptsDrops` registers the element as a drop target at all,
`lock.accept` rejects drops that arrive at one. A host that sets the wrong one
gets silence.

Enforcement moves to a single source:

| Site                                     | Today                             | Becomes                                     |
| ---------------------------------------- | --------------------------------- | ------------------------------------------- |
| `useDragHandle`                          | `placement.locked`, `allowsDragOut` | `lock.move`, parent `lock.dragOut`          |
| `DragController.tryBegin`                | same pair                         | same pair                                   |
| `DragController.checkAccept`             | `allowsDrop`                      | `lock.accept`                               |
| `useContainerLayout.dispatchAffordance`  | nothing                           | container `lock.arrange`, panes `lock.resize` |
| `<Container affordances>`                | renders all                       | skips suppressed                            |

Resize has no guard at any layer today: affordance drags run from
`dispatchAffordance` into `strategy.reduce` without consulting any flag, so a
"locked" pane still resizes freely. Gating dispatch alone is not enough — a
gutter the user can see and drag with no effect is worse than one that is not
drawn, so `<Container>` suppresses locked affordances at render too.

### Gutters must name their panes

`split.ts` emits gutters carrying `meta: { path, direction }` — a tree path, no
child ids — so nothing downstream can tell which panes a gutter resizes.
`Affordance.childId` exists but is documented as present only on resize
affordances, not gutters.

Gutters gain `affects: NodeId[]`. A gutter is suppressed when **any** leaf in
either adjacent subtree has `lock.resize`, since dragging it changes that pane's
rect. `split.ts` has both subtrees in hand where it pushes the affordance.

## Migration

Ships as 0.9.0 with snapshot v4. `serialize` emits v4; `deserialize` accepts v2,
v3, and v4, migrating older shapes on read.

| v3                              | v4                                            |
| ------------------------------- | --------------------------------------------- |
| `container.allowsDrop: false`   | `lock.accept: true`                           |
| `container.allowsDragOut: false` | `lock.dragOut: true`                          |
| `placement.locked: true`        | `lock: { move, resize, destroy }`, no implied pin |
| `placement.pinned: true`        | `pinned: <index in childOrder>`               |

Breaking changes for the README note:

- `setAllowsDrop` / `setAllowsDragOut` removed; use `setLock`.
- `placement.locked` and boolean `placement.pinned` are no longer read.
- Locking no longer reorders.
- `container.allowsDropChanged` / `container.allowsDragOutChanged` replaced by
  `node.lockChanged` and `node.pinnedChanged`.
- New errors: `LockedError`, `PinIndexError`.

`docs/concepts.md` still describes the snapshot as v2 and must be corrected to
v4 along with the reserved-key and policy sections.

## Testing

- Per-axis guard tests against each guarded store method, plus `force` and
  `withLocksSuspended` bypass.
- Capability filtering: unsupported axes dropped, not thrown.
- Cascade destroy proceeds through a locked child; direct destroy throws.
- Displacement routing: reorder into a held slot, insert at a held slot,
  sibling removal clamping, `setPinned` out of bounds.
- Capacity race: unpinned children reach `unplaced` before pinned ones.
- DnD: a locked node yields no drag handlers; a locked gutter is not rendered
  and its dispatch is refused.
- A v3 fixture deserializes to the v4 shape above.
- `lock.destroy` blocks `unregisterNode` — the behavior `node.ts` has documented
  since the reserved key was introduced and never implemented.
