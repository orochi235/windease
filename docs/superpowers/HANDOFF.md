# Handoff: seam-join → tab-stacking

For whoever picks up windease next. It says where the repo is, what the two
queued features are, and the decisions made in conversation that the code does
not record. Everything else lives in [`TODO.md`](../../TODO.md),
[`CHANGELOG.md`](../../CHANGELOG.md) and the README — this points at them rather
than repeating them.

## Repo state

`main`, clean, **unpushed** — 45 commits ahead of `origin/main`. Nothing is on a
feature branch. 1134 unit tests, 165 e2e specs across three engines,
lint/typecheck/build green.

Not released. `## Unreleased` in the changelog is the next version's notes;
`scripts/check-changelog.sh` fails until that heading and the README's
`### Unreleased —` breaking-change headings are retitled. That guard failing on
`main` is expected, not a problem.

## What the last run did

Inter-zone tiling, which used to head this list, turned out to be mostly a false
premise. Zones nested under one root container already tile with draggable
gutters — the Playground has built `main` / `sidebar` / `dock` that way through
`store.split` for some time, and `TODO.md` claimed otherwise. What was genuinely
broken was narrower: sibling *roots* shared origin `(0, 0)` because only a parent
`<Container>` ever wrote a geometry entry, so two top-level zones overlapped and
a directional key between them picked an arbitrary target.

That is fixed. A root measures its own element into document coordinates and
publishes it; `resolveNavigation` and `resolveMove` needed no change, since
neither was ever root-scoped. Design in
[`specs/2026-08-22-root-origin-geometry-design.md`](specs/2026-08-22-root-origin-geometry-design.md).

Two follow-on changes shipped with it: the measure was hardened (sub-pixel
epsilon, rAF-coalesced scroll, a per-instance guard so duplicate writers
converge instead of hanging), and the publication was extracted to
`usePublishGeometry` and wired into `<Zone>` / `<Panel>` — which had never
reported geometry at all, so keyboard navigation in a declarative tree did
nothing, silently.

**A `<Workspace>` primitive is still an open question**, and still `[HIGH]`. What
is left for it is owning the arrangement — collapsible sidebars, gutters
*between* roots, full-screen takeover — not the geometry.

## The two, in the order asked for

**1. Seam-join** — `TODO.md`, "Merging adjacent nodes". Drag a seam past a
neighbour's floor and the neighbour is destroyed. The gesture is small; the
affordance is not. Two hard parts, both named there: it has to answer to
`lock.destroy` on a pane the gesture never targeted, and the point of no return
has to be visible *before* the pointer is released.

**2. Tab-stacking** — same section, and the largest by a wide margin. Gated on
drop *intent*: `insertionIndexByMidpoint` answers "which seam" and deliberately
never "seam versus onto B itself". Needs a stack container preset and a tab strip
on top of that. It is also the only entry left under "Still uncovered" in the
e2e section — a library gap, not a test gap.

## Conventions to follow, not rediscover

`CLAUDE.md` has them all. The one most often broken: **every feature ships with a
Ladle story in the same change**, operable rather than illustrative, because the
Playwright suite drives Ladle.

Worth knowing about testing this area specifically: a geometry test that asserts
an inequality (`toBeGreaterThanOrEqual`) passes for the wrong reason — composing
y against the x origin survives it. Assert exact rects. Every test added in the
last run was mutation-checked, and three of them were vacuous on the first
attempt.

## Decided in conversation, not visible in the diff

- **The measured origin is not held in React state**, though an earlier draft of
  the spec said it would be. Review rejected it as a second source of truth: the
  guard compared the registry while the consumer read the state copy, so a
  divergence could strand children at `(0, 0)` with no recovery. The registry is
  the only store; the state is a bare tick that schedules the render which reads
  the fresh entry back.
- **The epsilon is 0.5px** because that is the whole error bound for
  round-to-nearest on one of the two terms, and half of `MIN_NAVIGABLE_PX`, which
  is the smallest extent navigation already treats as real.
- **A childless focusable root is navigable, deliberately.** It gained a rect and
  so joined the candidate set; an empty dock you can arrow onto and drop into is
  useful. Pinned by a test rather than left as an accident.
- **Duplicate `<Container>`s for one id are still unsupported**, but now degrade
  to wrong rects and a trace rather than to a hang.
- **The preset tab stop reaches trees that did not ask for it.** A pane declaring
  `focus` in a store with a `focusedId` becomes a stop with no `<FocusProvider>`
  mounted. Judged acceptable — it is the same single stop `<Container>` has
  always had — but it is the one part of that change with blast radius.
