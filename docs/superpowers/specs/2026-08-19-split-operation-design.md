# Split as a store operation — design

`splitStrategy` keeps a `SplitNode` tree in `container.state` that describes the
same structure the node tree already describes. Every known split bug is a
synchronization failure between the two. This spec is for whoever implements the
replacement. It defines a `split` store operation, its inverse, the transaction
primitive a composite operation needs to be one undo step, and the preset cleanup
that falls out of it.

It removes `splitStrategy`, `stackStrategy`, and `createGroup`, so it ships as
1.0.0.

## Problem

`splitStrategy` holds a second tree, and the store never tells it anything. A
consumer report against 0.8.0, reproduced at 0.9.0 (a sixteen-panel workbench in
`blitsklieg`, `packages/core/dev/tube-lab`):

- A child registered after the tree exists is dropped silently, with `unplaced`
  empty, so the consumer gets no signal.
- A removed child's space is never reclaimed.
- Dragging a panel does not move it — DnD rewrites `childOrder`, which
  `splitStrategy` never reads.
- `buildTree` cannot tile. It builds a right-leaning spine at ratio 0.5, so
  panel *k* gets `W / 2^k`; sixteen panels in 1200×800 leaves nine at zero or
  negative extent and seven outside the container.
- `walk` never clamps a pane to zero, so once a pane is narrower than the gutter
  the recursion marches its children past the container edge.

`stripStrategy` handles add, remove, and reorder correctly today because it is a
pure function of `items` and holds no second structure. So the fix is not to
patch the tiling — it is to stop keeping a second tree. Split becomes a verb that
rearranges nodes, and layout becomes `strip`.

## `Store.split(id, options)`

**One rule: `split` puts the target's content in child 0 of a strip or grid
container.** Which of three modes that means is forced by the target's position
in the tree, not by its `kind`.

| Mode | When | Effect |
|---|---|---|
| **wrap** | target has `membership` | Interpose a new group between the target and its parent, at the target's exact index. Target becomes child 0. |
| **flatten** | target's parent is a `strip` whose `axis` equals the requested direction (`'x'`/`'y'` only) | Insert the new panels as siblings immediately after the target. No group is created. |
| **reconfigure** | target has no `membership` | Nothing exists above a root to interpose, so the target *becomes* the container, gaining `container` if it lacks one. Existing children keep their order and precede the new panels. |

Modes are tested in that order, with flatten shadowing wrap.

The bag is named `SplitInput`, matching `CreateZoneInput` / `CreatePanelInput`.
It could not be `SplitOptions` — that name belonged to `splitStrategy`'s config
type, which this release deletes but which was still live while `split` was being
built.

```ts
export type SplitInput =
  | { direction: 'x' | 'y'
      into?: number                      // default 2, must be >= 2
      groupId?: NodeId                   // required in wrap mode only
      newIds: readonly NodeId[]          // length into - 1
      config?: unknown                   // merged over every container config
                                         // this call writes
      force?: boolean }
  | { direction: 'both'
      into: readonly [number, number]    // [cols, rows], product must be >= 2
      groupIds: readonly NodeId[]        // outer, then one per column
      newIds: readonly NodeId[]          // length cols * rows - 1
      config?: unknown
      force?: boolean }
  | { direction: 'grid'
      into: number                       // must be >= 2
      cols?: number                      // passed through; grid's own
                                         // default applies when omitted
      groupId?: NodeId                   // required in wrap mode only
      newIds: readonly NodeId[]          // length into - 1
      config?: unknown
      force?: boolean }
```

Every id is caller-supplied. The store has no id generator and gains none, so
the same call against the same tree produces the same result and replay,
hydration, and undo are unaffected.

`'x'` and `'y'` map 1:1 onto `stripStrategy`'s `axis` config, and `split` also
writes `fill: true`. Strip's own default is `fill: false`, which sizes a child
carrying no `preferredSize` to `defaultItemSize` — itself `0`. Since `split`
mints panels with no hints, inheriting that default lays every pane out at zero
extent: a correct tree that renders nothing. A caller can still override it
through `config`.

### `direction: 'both'`

Builds an outer x-axis strip of `cols` column groups, each an inner y-axis strip
of `rows` panels. Gutters work at both levels because strip already emits
trailing-edge resize affordances on every non-last child.

`groupIds` is the outer group followed by one per column, left to right.
`newIds` fills **column-major** — each column top to bottom before moving right —
with the target occupying the first slot.

```
split(p1, { direction: 'both', into: [2, 2],
            groupIds: ['g', 'g-c0', 'g-c1'],
            newIds: ['p2', 'p3', 'p4'] })

g  strip axis=x
 ├ g-c0  strip axis=y ─ p1, p2
 └ g-c1  strip axis=y ─ p3, p4
```

### `direction: 'grid'`

Builds a single `gridStrategy` container with `cols` set. One group id, no
nesting. **`gridStrategy` ignores `placement.size` today**, so a grid built this
way has no draggable gutters — the JSDoc must say so, since it is a capability
regression against what `splitStrategy` offered and nothing else signals it.

### Placement transfer in wrap mode

The interposed group takes the target's former `membership.placement`; the
target's own placement resets to `{}` inside the group. The group now occupies
the position the target held, so `size` and `pinned` describe the group.

Getting this backwards yields a layout that is wrong but not obviously wrong, so
it earns a test. Apply a transferred `pinned` through `store.setPinned` rather
than by copying the key, so the parent's ordering invariants run.

Flatten mode inserts siblings into an existing `childOrder`, which shifts every
index after the target — including any `pinned` a later sibling holds. Route the
insertion through the existing ordering path rather than splicing `childOrder`
directly, so pins re-resolve.

## `Store.unsplit(groupId, opts?)`

Dissolves a group into its parent: children move up to the group's index in
order, then the group is unregistered. Requires both `container` and
`membership`; throws `CapabilityMissingError` otherwise.

Nothing auto-collapses. `unregisterNode` on the second-to-last child leaves a
one-child strip, which renders full-bleed and is harmless. Making removal
silently destroy an unnamed group and reparent another node would put a hidden
step in every undo entry.

**A sole surviving child inherits the group's placement.** `split` moved the
target's `size` and `pinned` onto the group, because the group took the slot the
target held; dissolving a one-child group hands them back. With several children
they are dropped — one slot's size cannot describe N new siblings, and choosing
one of them would be arbitrary. That asymmetry is the difference between
split→unsplit round-tripping and silently losing a pane's size, so it belongs in
the JSDoc.

## Errors and locks

All validation runs before any mutation, so a rejected `split` leaves the store
untouched:

| Condition | Error |
|---|---|
| target absent | `NodeNotFoundError` |
| `newIds` length disagrees with `into` | `InvariantViolationError` (`split-arity`) |
| any supplied id already registered, or repeated within the call | `DuplicateNodeError` |
| wrap mode with no `groupId` / too few `groupIds` | `InvariantViolationError` (`split-missing-group-id`) |
| `into` below 2, or a non-positive `cols`/`rows` | `InvariantViolationError` (`split-arity`) |

`WindeaseErrorCode` carries a free-form `(string & {})` arm for
`InvariantViolationError`, so no code is added to the enum.

Lock axes, all bypassable with `force`:

- **wrap** — `move` on the target, `dragOut` and `arrange` on its parent
- **flatten** — `arrange` on the parent
- **reconfigure** — `arrange` on the target
- **unsplit** — `destroy` and `dragOut` on the group, `arrange` on the
  grandparent

`split` checks these itself, up front, and then runs every mutation inside
`store.withLocksSuspended`. Without that, the guards on the public methods it
calls — `moveNode` alone asserts `move`, `accept`, and `dragOut` — could fire
partway through and leave a half-built tree, since nothing rolls back. The
up-front list is therefore the contract; the internal calls must not re-check.

## Atomicity, and `Store.transact`

`split` is the store's first composite operation, and neither way of wiring
history today can express "this is one thing the user did":

- **Subscriber-driven under-counts.** The default `Publisher` schedules through
  `queueMicrotask` behind a `scheduled` flag, so undo granularity is whatever
  happened in one tick. A handler calling `split()` and then `moveNode()`
  collapses two user-meaningful actions into one undo step, and the boundary
  moves when the consumer restructures a callback.
- **Event-driven over-counts.** The `node.*` events are synchronous and fire
  once per underlying mutation, so one `split` is eleven undo steps.

Coalescing is not transaction semantics. So this ships the missing primitive:

```ts
transact(fn: () => void, label?: string): void
```

Re-entrant by depth counter — only the outermost call emits — matching
`HistoryController`'s own transaction semantics. Two events join `StoreEvents`:

```ts
'transaction.begin': { label?: string }
'transaction.end': { label?: string }
```

`split` and `unsplit` wrap themselves in it. An event-driven history integration
brackets on the pair and gets a correct boundary for those and for any composite
a consumer writes.

**`transact` does not roll back.** If `fn` throws, `transaction.end` still fires
from a `finally` so the depth counter cannot stick, the throw propagates, and
whatever was already mutated stays mutated. Say so in the JSDoc. `split` does not
depend on rollback: it validates everything before touching the store, so it
either does all of its work or none of it.

The React half of `2026-06-04-history-undo-redo-design.md` — the `<Provider
history>` slot, `useHistory()`, and auto-bracketing around drags — was never
built, and that doc brackets events (`window.created`, `zone.claimed`) that the
unified node model removed. Add a note at its head saying so. Rewriting it is out
of scope here.

## Preset cleanup

`CreateZoneInput` has no `parentId`, but `<Zone>` passes one
(`presets.tsx:314`) through a `defined()` spread, and a spread of `Partial<T>`
skips excess-property checking. So `<Zone>` inside `<Zone>` silently registers as
a root: no `membership`, filed under `rootIds`. This is the [HIGH] item in
TODO.md, and it exists because the constructors treat "has a parent" as a
different type rather than a different field.

- `CreateZoneInput` grows `parentId?: NodeId` and `placement?`. With a
  `parentId`, `createZone` attaches `membership` exactly as `createGroup` does.
- `createZone` and `createGroup` become thin wrappers over one shared
  implementation that differ in `kind` and in whether `parentId` is required.
- `<Zone>` gains an optional `kind` prop. `PresetShell` hardcodes one `kind` per
  preset today, which makes `concepts.md`'s "`kind` is a free-form string" false
  at the preset layer.

`kind: 'zone'` no longer implies "root" — a nested `createZone({ parentId })`
carries `kind: 'zone'` and styles as `.windease-zone`. Document it in
`concepts.md`.

### Deprecating `createGroup`

After the merge, `createZone({ parentId })` and `createGroup(...)` produce
identical capability sets. Two names for one node shape leave a consumer with no
basis to choose, and the word is already spoken for: TODO.md's unbuilt "Groups"
feature means *windows that move, drag, and resize as a unit*. The shipped
`createGroup` means "a container that has a parent," which is not a group in any
sense a user would recognize.

`createGroup` and `<Group>` are **removed**. Two presets remain, and they name
two real capabilities:

| | means | `container` | `membership` | `focus` |
|---|---|---|---|---|
| **Zone** | can hold children | default | optional | never |
| **Panel** | a leaf you render into | optional | required | default |

Migration is `<Group>` → `<Zone parentId kind="group">`. That keeps
`.windease-group`, `.windease-group__title`, and `chrome['group']` firing
untouched, so the documented CSS surface does not move.

`focus` is offered only on panels and is the last capability not reachable from
every constructor. The core's single-focus invariant is store-wide and does not
care what carries the capability, so a focusable container is structurally fine
and merely unconstructible. Nothing here needs it; note it in TODO.md.

## Release

**1.0.0.** Three exports are removed, so this is breaking by definition; there is
no deprecation cycle.

- **`splitStrategy` is deleted**, along with `SplitNode`, `SplitOptions`, and
  `SplitMeta`. Everything driving it migrates rather than being dropped:
  `e2e/resize.spec.ts` (its gutter ids come from `SplitNode` tree paths),
  `RecursiveSplit.stories.tsx`, `Playground.stories.tsx`,
  `DragController.test.tsx`, `react/lock.test.tsx`, `Container.test.tsx`, and a
  `snapshot.test.ts` case.
- **`stackStrategy` is deleted.** It was strip on one axis; see the strip/stack
  section.
- **`createGroup` and `<Group>` are deleted.** Migration is
  `createZone({ parentId })` and `<Zone parentId kind="group">`, which keeps
  `.windease-group`, `.windease-group__title`, and `chrome['group']` firing, so
  the documented CSS surface does not move.
- **Snapshot goes to v5 with a real migration.** A v4 snapshot can name a
  strategy that no longer exists, so hydrate walks any stored `SplitNode` tree
  and builds the equivalent nested strip groups as real nodes, clearing
  `container.state`. Saved layouts keep working and land on the new model. This
  is the same tree `split` builds, driven from a different source.
- README gets one migration section, not a deprecation list.

## `stack` is `strip` on one axis

`stackStrategy` and `stripStrategy` are one algorithm written twice, ~200 lines
each. Stack is strip with `axis: 'y'`, and the only thing it has that strip
lacks is capacity handling (`maxItems`, `canAccept`, `unplaced`).

Their `fill` defaults had drifted — strip `false`, stack `true` — and that
divergence is what sized every split-created pane to zero. Two implementations
of "lay children out in a line" disagreeing about a hintless child is the
failure mode of keeping them apart.

Strip gains capacity; `stackStrategy` is removed. Migration is `stripStrategy`
with `{ axis: 'y', fill: true }` — and the `fill` is not optional in that
migration, because strip's default is off and omitting it collapses hintless
children to zero.

## Testing

- **Modes** — wrap, flatten, and reconfigure each reached, including that
  flatten shadows wrap only when the parent axis matches and the direction is
  `'x'`/`'y'`.
- **Directions** — `'x'`, `'y'`, `'both'` at `[2,2]` and a non-square, `'grid'`.
  Assert the resulting tree, not just the rect math.
- **Placement transfer** — a target with `placement.size` and a `pinned` index
  is wrapped; the group holds both and the target's placement is empty.
- **Validation** — every row of the error table, each asserting the store is
  unchanged afterward.
- **Locks** — each axis in the list refuses, and `force` overrides. Plus one
  test that genuinely proves the suspension: lock `resize` on the target.
  `applyWrap`'s internal `patchPlacement(id, { size: undefined })` asserts
  `resize`, and `resize` is deliberately not one of the axes checked up front,
  so that call throws if the mutations are not running suspended. Locking
  `accept` on the parent does NOT prove it — `registerNode` checks no axis at
  all, and `moveNode`'s `accept` check targets the new group rather than its
  parent, so such a test passes with or without the suspension.
- **Atomicity** — one `subscribe` notification per `split`; one
  `transaction.begin`/`transaction.end` pair however deeply `transact` nests; the
  pair still closes when `fn` throws, and a second `transact` afterward still
  emits. Undo through a `HistoryController` bracketed on the pair restores the
  pre-split tree in one step.
- **Round-trip** — `serialize`/`deserialize` of a split-built tree at v5, and
  a v4 snapshot carrying a `SplitNode` tree hydrating into nested strip groups
  whose leaves keep their ids and order.
- **`unsplit`** — children land at the group's index in order; capability
  guard; round-trips with `split`.
- **Presets** — `<Zone>` inside `<Zone>` nests instead of registering as a root.
- **e2e** — gutter drag on a `split`-built strip tree.

Traces go under the `store` category, naming the mode and the resulting parent:

```
split: wrap p1 → g@2 (strip x, 2 children)
split: flatten p1 → zone@1..2 (strip x)
unsplit: g → zone@2 (3 children)
```

## Out of scope

- Removing `splitStrategy` (1.0).
- Teaching `gridStrategy` to honor `placement.size`, which is what `'grid'`
  needs before it has gutters.
- A focusable container.
- The React history hookup — `<Provider history>`, `useHistory()`, and
  auto-bracketing around DnD drops. Needs its own spec pass against current
  event names.
- Step 4 of the headless-layout-host spec, the second binding. Deferred by
  decision; core is public after steps 1–3, so a vanilla consumer can build a
  host by hand today.
