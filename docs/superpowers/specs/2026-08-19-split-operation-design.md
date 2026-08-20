# Split as a store operation — design

`splitStrategy` keeps a `SplitNode` tree in `container.state` that describes the
same structure the node tree already describes. Every known split bug is a
synchronization failure between the two. This spec is for whoever implements the
replacement. It defines a `split` store operation, its inverse, and the preset
cleanup that falls out of it.

It does not remove `splitStrategy`. That is a 1.0 concern; this ships as 0.10.0
and is additive.

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
`SplitOptions` is already exported as `splitStrategy`'s config type and stays
until 1.0.

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

`'x'` and `'y'` map 1:1 onto `stripStrategy`'s `axis` config.

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

- **wrap** — `move` on the target, `arrange` on its parent
- **flatten** — `arrange` on the parent
- **reconfigure** — `arrange` on the target
- **unsplit** — `destroy` on the group, `move` on each child, `arrange` on the
  grandparent

## Atomicity

The Store does not own a `HistoryController`; consumers wire one by pushing
`serialize(store)`. So `split` cannot open a history transaction, and does not
try to.

It does not need to. `split` mutates synchronously, and the default `Publisher`
schedules through `queueMicrotask` behind a `scheduled` flag, so any number of
synchronous mutations produce exactly **one** subscriber notification and
therefore one history push.

This holds for subscriber-driven history only. The `node.*` events are
synchronous and fire once per underlying mutation; an event-driven history
integration sees the whole burst and must bracket it with the
`beginTransaction` / `endTransaction` pair `HistoryController` already exposes.
Say this in the `split` JSDoc — it is the difference between one undo step and
eleven.

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

`createGroup` and `<Group>` are marked `@deprecated`, pointing at
`createZone({ parentId })`. Two presets remain, and they name two real
capabilities:

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

0.10.0, additive.

- `splitStrategy`, `SplitNode`, `SplitOptions`, and `SplitMeta` stay exported and
  working, marked `@deprecated` and pointing at `split`. Removal is 1.0.
- Snapshot stays at v4. `split` produces ordinary nodes with ordinary
  `placement`, so there is no schema change and no migration.
- `e2e/resize.spec.ts` drives `splitStrategy` gutter ids and keeps passing
  untouched. A new e2e covers gutter drag on a strip tree built by `split`.
- README gets one migration note covering both deprecations.

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
- **Locks** — each axis refuses, and `force` overrides.
- **Atomicity** — one `subscribe` notification per `split`, and undo through a
  subscriber-driven `HistoryController` restores the pre-split tree in one step.
- **Round-trip** — `serialize`/`deserialize` of a split-built tree at v4.
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
- Step 4 of the headless-layout-host spec, the second binding. Deferred by
  decision; core is public after steps 1–3, so a vanilla consumer can build a
  host by hand today.
