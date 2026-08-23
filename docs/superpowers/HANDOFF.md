# Handoff: seam-join done, tab-stacking next

For whoever picks up windease next. Branch state, and the decisions made in
conversation that the code does not record. The durable documents are
[the design](specs/2026-08-22-seam-join-design.md), [`TODO.md`](../../TODO.md),
[`CHANGELOG.md`](../../CHANGELOG.md) and the README — this points at them rather
than repeating them.

## Repo state

On branch **`seam-join`**, cut from `main`, **not merged**. `main` is still
unpushed, ~50 commits ahead of `origin/main`.

Seam-join is complete: 1187 unit tests, 186 e2e specs across three engines,
lint/typecheck/build green. It shipped with a Ladle story
(`seam-join--join-on-overshoot`), browser specs, README and `CHANGELOG.md`.

It was built from [the plan](plans/2026-08-22-seam-join.md), one task per
subagent, with spec-compliance and code-quality review after each. **The plan's
checkboxes were never ticked** — read the git log on this branch for what landed.

Nothing is left of it. The next feature is **tab-stacking**, and unlike seam-join
it has a concrete gap behind it: it is the only entry left under "Still
uncovered" in `TODO.md`'s Playwright section, and a library gap rather than a
test gap.

## What the reviews caught, and why it matters to the next run

Every task got two review passes. They earned their cost three times over, and
all three were the same shape — **a test that passed for the wrong reason**:

- The reducer armed on any fast drag. Overshoot was specified as "travel asked
  for, minus extent absorbed", but the absorbed value lags a frame
  *permanently*, so a steady 60px-per-move drag showed a 60px overshoot with the
  seam mid-range. It only looked correct because the first tests drove 10px
  steps. It now accumulates only while `bounds.atMin`/`atMax` says the seam is
  pinned.
- After that fix, the unwind branch still *grew* overshoot on unpinned travel —
  it guarded against crossing zero, not against growing. Back off, push again,
  and it armed on a pane five pixels above its floor. No test distinguished the
  two behaviours until one was written.
- Two "asserts something does not happen" tests passed vacuously, one of them
  written by hand into the plan.

**So: mutation-check every negative assertion.** Break the thing on purpose and
watch the test fail. Three defects here survived ordinary review and died to that.

## Decided in conversation, not visible in the diff

- **Seam-join had no consumer behind it.** Self-filed in `TODO.md` the same day
  work began; neither closed consumer evaluation asked for it. Built because it
  was small and unblocked.
- **`candidateId`, not `victimId`.** The field is populated whenever the gesture
  has a direction, including while `armed` is false, so a name that reads as a
  verdict invited acting on it alone. Destroy is irreversible.
- **A join's ids are `NodeId | string`**, matching `childId` and `affects` beside
  them, so a strategy working in `ItemId` needs no cast. The host casts once.
- **`destroyBlockedBy` is deliberately stricter than the store.**
  `unregisterNode` checks the lock on the id it is handed, then cascades with no
  further checks, so a destroy-locked descendant dies silently today. Seam-join
  declines to exploit that rather than fixing it; the store gap is filed in
  `TODO.md` and fixing it there is a behaviour change.
- **A seam already pinned at rest arms from its first move.** The move that
  *reaches* a clamp still reads unpinned, so accumulation normally starts one
  move later — but a pane already on its floor has nowhere to go, so all travel
  really is overshoot. Requiring a wiggle first would be worse.
- **The presets show the point of no return but name no victim**, until the
  context added in `presets.tsx` is exercised more widely. The join is *not*
  suppressed there: one config key meaning different things depending on which
  React entry point mounted the tree is a worse contract than a weaker
  affordance.
- **The armed state ships a default appearance**, which is a deliberate exception
  to `styles.css`'s "cosmetics are the consumer's" rule. A destroy with no
  confirmation step cannot wait on consumer CSS. It is `currentColor`-only, so a
  consumer that sets no color sees nothing — the story demonstrates the trap.
- **The gesture destroys; it does not redistribute.** Where the freed extent goes
  is ordinary strip layout, and panes with an explicit `placement.size` under
  `fill: false` leave it empty. Three documents claimed otherwise before it was
  checked against the code.

## Traps that cost time, so you do not pay twice

- `createNode` takes `parentId` and `placement` as **top-level** fields — there
  is no `membership:` input — and `container` needs `{ strategyId, config }`.
- `exactOptionalPropertyTypes` is on: `{ join: maybeUndefined }` does not compile
  against `join?: T`. Spread conditionally.
- **There is no `store.undo()`.** `HistoryController` is generic over a snapshot
  type and wired by the consumer, so "one undo step" is asserted as one
  `transaction.begin`/`end` pair.
- Strip does **not** divide a container evenly when panes carry no size — it
  sizes each to its `minSize`, so a naive fixture starts every pane already
  pinned.
- An affordance handle's position comes from inline styles, so a stylesheet
  cannot override it without `!important`. Style a pseudo-element instead.

## Three things filed, none decided

All in `TODO.md`, written so nothing reads as chosen:

- **Drop-on-edge to split [HIGH]** — the one standard drop semantic this library
  has no answer for. `store.split` already does the mutation; the hit-test and
  preview are missing. Shares its hard part with tab-stacking, so doing them
  together is probably cheaper than either alone.
- **Two gesture pipelines are converging.** `DragController` owns
  arm/cancel/commit/lock/undo/announce for pane drags; `AffordanceHandle` now has
  its own copy for seams. One duplicate is not an abstraction — extract when a
  third appears.
- **Whether input binding should come from `@weasel-js/gestures`.** It answers
  "which input happened and what is bound to it", which windease has no
  vocabulary for; it does not answer the in-flight, geometry-resolved half. The
  trigger would be a consumer asking to rebind, not the catalog growing.
