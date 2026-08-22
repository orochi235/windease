# Handoff — consumer wishlists (2026-08-21)

For whoever picks up the three consumer wishlists in `TODO.md`. It assumes you
have read those sections; this covers only what they can't carry — tree state,
the decisions still open, and the traps that cost time.

The keyboard-navigation work was a separate session; it has landed on local
`main`. See "Two agents" below for what it owns.

## Tree state

On `main`, clean, **local-only — 40 commits ahead of `origin/main`, which is
still at `b5d5647`.** Nothing in this repo has been pushed since. 828 tests / 75
files green, plus typecheck, lint, build, and 20 e2e specs.

Both workstreams are merged: subtree serialize/graft and keyboard navigation.
`feat/subtree-graft` and `feat/keyboard-navigation` are merged and disposable.
`.claude/worktrees/keyboard-nav/` is still on disk.

**Nothing is released.** `package.json` and `src/index.ts`'s `VERSION` are both
still `1.1.0`. Both workstreams ship as 1.2.0 by the user's decision, and
`TODO.md`'s heading reads `## On main, unreleased — ships as 1.2.0` precisely
because the claim runs ahead of the mint. `npm version minor` has deliberately
not been run: its `postversion` pushes the tag, which triggers the Release
workflow to publish over OIDC. That is the user's call, and it is the single
biggest outstanding decision in this repo.

## What shipped

**Subtree serialize / graft**, this session. `serialize(store, { root })` emits a
v5 snapshot of one node and its descendants; `graft(store, snap, parentId, opts)`
attaches one under a named parent. Design and rationale:
[`specs/2026-08-21-subtree-serialize-graft-design.md`](../specs/2026-08-21-subtree-serialize-graft-design.md).
Task breakdown: [`plans/2026-08-21-subtree-serialize-graft.md`](2026-08-21-subtree-serialize-graft.md).
Don't re-derive either from the diff.

Earlier wishlist items: `git log debb4e0..HEAD`. The wishlist entries in
`TODO.md` are rewritten in place as items land, so that file is current.

## The one open decision

**How a canvas host learns about `devicePixelRatio`** (klieg wishlist, third
list in `TODO.md`). The tenet in `CLAUDE.md` says DOM concerns live in an
adapter, which would put DPR entirely host-side. But the ask is "deliver it
alongside placements," which means `ContainerHost` surfaces it — and
`ContainerHost` already carries the one sanctioned concession, `observe(el)`
sitting beside the headless `setViewport`. Following that precedent gives a
`setPixelRatio` / `observePixelRatio` pair.

That is a defensible reading, but it would be the **second** exception to a
tenet written the same day. It was deliberately left for the user rather than
established quietly. Do not implement it without asking.

## Traps

**A worktree inside the repo root breaks tooling that doesn't read
`.gitignore`.** vitest collected both checkouts and ran two versions of the
suite green side by side; biome found the nested config and refused to run at
all. Both are excluded now (`d7e1f96`, `b9e67bd`, `6184644`). The exclusions
must be **root-anchored** — `"!**/.claude"` matches the `.claude` segment of an
absolute path and excludes everything when run from inside the worktree, which
is how the fix reintroduced the bug it fixed. `ladle`, `playwright` and
`typedoc` were audited and are not exposed.

**`cmd | tail -N` hides failures above the cut.** Biome exited nonzero and
formatted nothing for several commits while the pipeline printed "No fixes
applied", which reads as a pass. Grep for `Checked|Found|error`, or read the
exit code.

**Prose that names an API drifts.** The README collapse example was written
first and called a `patchMeta()` that does not exist;
`src/collapse-pattern.test.ts` runs the documented pattern against a real store
and caught it. Any doc example calling library APIs wants the same treatment.

**`clampExplicitSizes` has one caller and `split.ts` has no geometry.** Several
plans have been scoped against a `splitStrategy` that was deleted in 1.0.0.
Check before assuming a change is wide.

**`store.transact` does not roll back on exception.** A composite operation that
throws partway leaves every mutation it already made. This is why `graft`
validates everything — ids, parent, locks, links — before opening the
transaction, rather than leaning on `registerNode`'s own duplicate check, which
throws mid-walk and would strand a half-grafted tree. Pinned by
`src/snapshot.subtree.test.ts` ("rejects a deep colliding id"). Any future
multi-step store operation inherits this trap.

**`canFocus(id)` is a capability check, not a focus check.** It answers "does
this node have a focus machine," sibling to `isContainer` / `isMember`. It was
called `hasFocus`, which sat one method from `focusedId` and read as state —
both workstreams misread it, which is why it was renamed in 1.2.0. `hasFocus`
survives as a `@deprecated` alias until 2.0.0. For actual focus state read
`getNode(id)?.focus?.state` or compare `store.focusedId`.

**A regression test written alongside its fix may be vacuous.** The original
graft collision test passed for free because nothing mutated yet, and it could
not have failed regardless of where the check sat. The only reliable check is to
break the thing deliberately and watch the test go red before committing it.

## Two agents, one repo

File ownership is announced by message before opening a file. Separate
worktrees prevent git conflicts, not two agents editing the same path.

This workstream owns `src/layout/`, `src/react/styles.css`, and
`src/snapshot.ts`.

The keyboard session is **finished and merged to local `main`** — focus model,
roving tabindex, arrow/Home/End/F6 navigation, a `GeometrySource`, and
reduced-motion. Spec at `2026-08-21-keyboard-navigation-design.md`. It owns
`src/focus/**` and `src/react/focus/**`; its edits to `node.ts`, `store.ts`,
`layout-types.ts`, `index.ts`, `Container.tsx`, `README.md` and `TODO.md` are
all in. Take `main` before touching any of those.

`container-host.ts` is unclaimed but its Task 8 reads `ContainerHost`
placements through a `GeometrySource`. Flag before changing what `layout()`
returns.

Reachable via `SendMessage` to `windease-10`; `ListAgents` if the name has
changed. Worth the round-trip — two real bugs in this workstream's commits came
from them, including one in a fix for a bug they had just reported.

## Next

`TODO.md` is the work list. The two subtree wishlist items are done; what's left
from the labkit list:

- **Grid resize gutters** — unblocked and self-contained. Build on
  `resizeMode: 'neighbor'` rather than reinventing the clamping, and fold in the
  `patchPlacement` span lock-gate at the same time.
- **Controlled `childOrder`, the second half.** `preserveStoreOrder` shipped the
  uncontrolled half; an `onChildOrderChange` intent for a host that wants to
  approve or transform a reorder is still open.
- **In-flow render mode** needs hard scoping before anyone starts — a second
  rendering path means every future feature works in both or explicitly doesn't.

Still deliberately unanswered, unchanged from the last handoff: **how a canvas
host learns about `devicePixelRatio`** (klieg wishlist). It would be the second
exception to the DOM-independence tenet, and was left for the user rather than
established quietly. Do not implement it without asking.
