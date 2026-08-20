# Handoff — the split operation, mid-implementation

Session state for `feat/core-drag-controller`. Nothing here is the only copy of
anything: the design is in
`docs/superpowers/specs/2026-08-19-split-operation-design.md` and the task
breakdown in `docs/superpowers/plans/2026-08-19-split-operation.md`.

- **Branch:** `feat/core-drag-controller`, cut from `main` after v0.9.0. Nothing
  pushed. The earlier headless-layout-host work (steps 1–3 of its spec) is on the
  same branch; the split work grew on top of it, so the branch now covers both
  and wants slicing into two PRs at the end.
- **Green:** 688 unit tests / 59 files, lint, typecheck.

## What this is

`splitStrategy` keeps a `SplitNode` tree in `container.state` describing the same
structure the node tree already describes, and every known split bug is the two
disagreeing. It is being replaced by a `split` **store operation** that
rearranges real nodes, laid out by `stripStrategy` — which handles add, remove,
reorder and resize correctly today because it is a pure function of `items`.

Ships as **1.0.0, breaking**. `splitStrategy`, `stackStrategy`, and
`createGroup`/`<Group>` are all deleted, and the snapshot goes to v5 with a
migration that converts stored `SplitNode` trees into real strip groups.

## Done

| Task | Commits | |
|---|---|---|
| 1 | `01765e3`, `859e776` | `Store.transact` + `transaction.begin`/`end` |
| 2 | `2f4cd51`, `f07d1aa` | `SplitInput`, validation, mode resolution |
| 3 | `aab31fe` | `wrap` and `flatten` modes, `'x'`/`'y'` |
| 4 | `2d2c81c`, `a22f7e3`, `80ac759` | `reconfigure` mode, `setStrategy`, `ensureContainer` |
| 5 | `c6e01f6`, `26514e3` | `'both'` / `'grid'` directions; the `fill` fix |
| 6 | `339767f` | `unsplit` |

## Next

Task 7 (locks, round-trip and undo coverage — tests only) is in flight. Then 8
the preset merge, 8b folding `stack` into `strip`, 8c snapshot v5, 9 the
removals and the 1.0.0 bump, 10 story and e2e.

## Decisions made in conversation, not visible in the code

- **`split` is a verb over the node tree, not a strategy.** Modes are forced by
  the target's position, not its `kind`: a node with a parent is *wrapped*, a
  node whose parent is already a strip on the requested axis gets siblings
  *flattened* in beside it, and a root *becomes* the container because nothing
  exists above it to interpose.
- **All ids are caller-supplied.** The store has no id generator and gains none,
  so replay and hydration stay deterministic.
- **`createGroup` is being deprecated, not kept.** After `parentId` becomes
  optional on `createZone` (Task 8) the two produce identical nodes but for
  `kind`, and two names for one shape leave a consumer with no basis to choose.
  The word is also reserved for the unbuilt feature under TODO.md's "Groups" —
  windows that move as a unit — which is what a user means by the term. The
  shipped `createGroup` means "a container that has a parent", which is not a
  group in any sense a user would recognize.
- **The config merge on reconfigure is deliberate.** A key from the abandoned
  strategy survives; replacing wholesale would discard consumer intent like
  `gap` when flipping a strip's axis, and a stale key is inert because
  strategies read only their own keys. Pinned by a test.
- **`setStrategy` clears `container.state`** — the opposite call from config,
  because `state` is handed to `layout()` as one blob typed for whichever
  strategy is now attached, with no runtime check. Leaving it would recreate the
  two-trees bug this whole plan deletes.
- **`'grid'` ships without gutters**, warned in its JSDoc. `gridStrategy`
  ignores `placement.size`, so that one direction has no draggable dividers — a
  capability regression against `splitStrategy`, accepted knowingly.
- **`stack` was `strip` on one axis.** Two implementations of the same algorithm
  whose `fill` defaults had drifted apart, which is what sized split panes to
  zero. Strip gains stack's capacity handling and `stackStrategy` is removed.
- **Snapshot ratios do not survive the v5 migration.** Strip derives extents
  from `placement.size` and hints; a `SplitNode` ratio has no equivalent, and
  inventing a pixel size from a container width the snapshot does not carry
  would be worse. Migrated layouts come back evenly divided.

## Traps

- **`patchPlacement` refuses to write `pinned` at all**, even as `undefined`
  (`store.ts:566-573`). Clear a pin with `unpin`.
- **In `wrap`, the new group must be reordered to the target's index before
  `moveNode` pulls the target out.** `registerNode` appends, so the group starts
  at the end.
- **`split` checks its lock axes up front and then runs inside
  `withLocksSuspended`.** `moveNode` alone asserts `move`, `accept` and
  `dragOut`, so an internal guard firing partway would leave a half-built tree —
  nothing rolls back.
- **The interposed group takes the target's placement**, not the reverse. The
  group occupies the position the target held, so `size` describes the group.
  Backwards produces a layout that is wrong but not obviously wrong.
- **Arity is uniform: `newIds.length === into - 1` in every mode**, including at
  a root, where the target counts as the first child even though it is the
  container. A test pins it; do not "fix" it.
- **`toThrow(/…/)` in vitest matches `error.message`, not `error.code`.**
  `InvariantViolationError` does not put its code in the message.
- **`stripStrategy` defaults `fill: false`**, which sizes a child with no
  `preferredSize` to zero. `split` must write `fill: true` into every strip
  config it creates. This produced a correct tree that rendered nothing, and all
  675 tests passed through it because every one asserted tree shape and none
  asserted geometry.
- **An `expect` inside a `store.events` handler can never fail a test** —
  `TypedEmitter.emit` swallows listener throws. Use `recordEvents` and assert
  after the mutation returns.

## Process note

Every defect found so far has been in the plan, not in the implementations —
the reviewers are earning their keep. Keep dispatching a spec-and-quality review
per task, and keep folding each correction back into the plan file so it does
not drift from the code.
