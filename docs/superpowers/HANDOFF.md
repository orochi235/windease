# Handoff: inter-zone tiling → seam-join → tab-stacking

For whoever picks up windease next. It says where the repo is, what the three
queued features are, and the handful of things decided in conversation that
the code does not record. Everything else lives in
[`TODO.md`](../../TODO.md), [`CHANGELOG.md`](../../CHANGELOG.md) and the
README — this points at them rather than repeating them.

## Repo state

`main`, clean, **unpushed** — and further behind than it looks: 30 commits
ahead of `origin/main`, of which 9 are the run described here (`272c243`
onward) and the rest predate it. Nothing is on a feature branch.

This run added a changelog mechanism, keyboard move, in-flow render mode, an
arrange-lock fix, the scroll seam, grid `overflowMode`, drag auto-scroll, and
Ladle stories for all of it. 1112 unit tests, 48 e2e specs on three engines,
lint/typecheck/build green.

Not released. `## Unreleased` in the changelog is the next version's notes;
`scripts/check-changelog.sh` fails the release until that heading is retitled
and the README's `### Unreleased —` breaking-change headings are too. That
guard failing on `main` is expected, not a problem.

## The three, in the order asked for

**1. Inter-zone tiling / `<Workspace>`** — `TODO.md`, "Strategy for
partitioning workspace". Zones are composed in consumer CSS today and the
library has no opinion about how they relate. Inter-zone resize is blocked
behind it.

Read the note in that section about sibling roots sharing origin `(0,0)`
before designing anything: it is the concrete reason directional navigation
stops at a top-level zone boundary, and it means "who owns multi-zone layout"
and "who reports zone origins into the geometry registry" are the same
question. The `scrollRef` → `setScroll` pair is the shape to copy — a DOM
value the consumer reports, arithmetic in the core.

**2. Seam-join** — `TODO.md`, "Merging adjacent nodes". Drag a seam past a
neighbour's floor and the neighbour is destroyed. The gesture is small; the
affordance is not. Two hard parts, both named there: it has to answer to
`lock.destroy` on a pane the gesture never targeted, and the point of no
return has to be visible *before* the pointer is released.

**3. Tab-stacking** — same section, and the largest by a wide margin. Gated on
drop *intent*: `insertionIndexByMidpoint` answers "which seam" and
deliberately never "seam versus onto B itself". Needs a stack container preset
and a tab strip on top of that. It is also the only entry left under "Still
uncovered" in the e2e section — a library gap, not a test gap.

## Conventions to follow, not rediscover

`CLAUDE.md` has them all. The two that were being broken in this run and are
now written down:

- **Every feature ships with a Ladle story in the same change** — a new one or
  real integration into an existing one, and operable rather than
  illustrative. The Playwright suite drives Ladle, so a capability with no
  story has no browser coverage.
- **A DOM convenience is not automatically a layout input.** Added to the
  DOM-independence tenet after `observePixelRatio` was nearly put on
  `ContainerHost` for symmetry alone.

## Decided in conversation, not visible in the diff

- **`Shift`+arrow is the move gesture** because it is the one modifier that
  dodges browser history nav (Alt) and macOS space-switching (Ctrl/Cmd). The
  cost, accepted knowingly: `Shift`+arrow is the universal extend-selection
  idiom, so if windease ever grows multi-select — plausible alongside Groups —
  that binding is already spent.
- **Flow mode opts in through `hints.render` on the node**, not a React prop,
  so it serializes and a headless consumer can see it.
- **Grid got `overflowMode` over an argument that it should not** — the case
  against was that a scrolling grid is a CSS grid, which is what flow mode is
  for. Overruled deliberately; worth knowing the trade was considered.
- **Grid `unplace` drops rows only.** A container too narrow for the floors
  reports width `overflow` instead, because dropping rows cannot widen a cell.
- **Auto-scroll's re-entrancy guard is unresolved design.** A cursor held at
  the edge has to keep scrolling, so `DragEngine` re-requests a frame after
  each step and a flag stops that recursing under the inline scheduler. It
  works and is tested both ways, but it reads as clever; having the engine
  expose the delta and letting `DragController` own the repeat is the cleaner
  split if anyone wants it.

## Loose threads

- `~/src/swair` has two uncommitted edits from this run: a withdrawn specimen
  pulled out of `corpus/specimens.jsonl`, and a parked "don't state the
  obvious" rule in its `TODO.md`. Unrelated to windease.
- `lock.arrange` now gates `reorderInParent`. If something downstream starts
  throwing `LockedError` where it did not, that is the cause and
  `{ force: true }` is the escape hatch — see the README's breaking changes.
