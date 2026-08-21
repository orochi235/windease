# Handoff — consumer wishlists (2026-08-21)

For whoever picks up the three consumer wishlists in `TODO.md`. It assumes you
have read those sections; this covers only what they can't carry — tree state,
the one decision still open, and the traps that cost time.

The keyboard-navigation work is a **separate session** with its own spec, plan,
and worktree. Nothing here overlaps it; see "Two agents" below.

## Tree state

On `main`, clean. `origin/main` is behind local — the keyboard session pushed
through `5705f44`; everything after is local only. Nothing here has been
pushed, and pushing is gated on the user asking.

`.claude/worktrees/keyboard-nav/` is the other session's worktree, on branch
`feat/keyboard-navigation`. Leave it alone.

## What shipped

`git log debb4e0..HEAD`. Each commit body carries its own reasoning; don't
re-derive it from the diff. The wishlist entries in `TODO.md` were rewritten in
place as items landed, so that file is current, not aspirational.

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

## Two agents, one repo

File ownership is announced by message before opening a file. Separate
worktrees prevent git conflicts, not two agents editing the same path.

This workstream owns `src/layout/`, `src/react/styles.css`, and
`src/snapshot.ts`.

The keyboard session (branch `feat/keyboard-navigation`, plan at
`2026-08-21-keyboard-navigation.md`, 7 of 13 tasks done as of this writing)
owns `src/focus/**` and `src/react/focus/**` outright. Its edits to shared
files are small and already committed: `node.ts`, `store.ts`,
`layout-types.ts`, `index.ts`. Still ahead of it, so expect to meet there:
`src/react/Container.tsx`, `src/react/index.ts`,
`src/react/stories/Playground.stories.tsx`, `README.md`, `TODO.md`.

`container-host.ts` is unclaimed but its Task 8 reads `ContainerHost`
placements through a `GeometrySource`. Flag before changing what `layout()`
returns.

Reachable via `SendMessage` to `windease-10`; `ListAgents` if the name has
changed. Worth the round-trip — two real bugs in this workstream's commits came
from them, including one in a fix for a bug they had just reported.

## Next

`TODO.md` is the work list. Unblocked and self-contained: **subtree
serialize/hydrate** (labkit list — `serialize` is whole-store at
`src/snapshot.ts:51`; needs an id-collision policy on graft) and **grid resize
gutters** (build on `resizeMode: 'neighbor'` rather than reinventing the
clamping, and fold in the `patchPlacement` span lock-gate). **In-flow render
mode** needs hard scoping before anyone starts — a second rendering path means
every future feature works in both or explicitly doesn't.
