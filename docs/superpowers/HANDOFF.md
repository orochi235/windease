# Handoff: seam-join in flight, tab-stacking next

For whoever picks up windease next. Branch state, what is left, and the decisions
made in conversation that the code does not record. The durable documents are
[the design](specs/2026-08-22-seam-join-design.md), [the plan](plans/2026-08-22-seam-join.md),
[`TODO.md`](../../TODO.md) and [`CHANGELOG.md`](../../CHANGELOG.md) — this points at
them rather than repeating them.

## Repo state

On branch **`seam-join`**, cut from `main`. `main` itself is still unpushed, now
~50 commits ahead of `origin/main`. Nothing is merged.

Seam-join is built. It was built from the plan, task by task, by subagents with a spec
review and a code-quality review after each. Tasks 1–6 are committed and green;
7–11 are not started. The plan's checkboxes are NOT ticked as work lands — read
the git log on this branch for what is actually done.

Done: `trackJoin` and its tests, `destroyBlockedBy`, the strip strategy declaring
`Affordance.join`, the public exports, the React gesture, and `<Container>`
marking the armed pane.

Left: keyboard arming (task 7), the default armed CSS (8), an operable Ladle
story (9), the Playwright specs (10), and README/CHANGELOG (11). **There is no
`CHANGELOG.md` entry yet** — task 11 owns it, and `CLAUDE.md` requires one.

## Three plan defects already found and fixed in the plan

The plan was written before any of it ran, and three of its assumptions were
wrong. All three are corrected in the plan file itself, but if you write new
tasks against this codebase, know them:

- `createNode` takes `parentId` and `placement` as top-level fields — there is no
  `membership:` input — and `container` needs `{ strategyId, config }`.
- `exactOptionalPropertyTypes` is on, so `{ join: maybeUndefined }` does not
  compile against `join?: T`. Spread conditionally instead.
- There is no `store.undo()`. `HistoryController` is generic over a snapshot type
  and wired by the consumer, so "one undo step" is asserted as one
  `transaction.begin`/`end` pair.

## The bug that changed the design

`trackJoin` was specified as `overshoot = requested - consumed` — pointer travel
minus the extent the layout absorbed. That is broken, and it took an
implementer's own test-granularity note to surface it: the absorbed extent lags a
frame *permanently*, so a steady 60px-per-move drag reads as a 60px overshoot
with the seam mid-range, and releasing destroys a pane that never reached its
floor. It only looked fine because the first tests drove 10px steps.

It is now a reducer that accumulates per-move deltas only while `bounds.atMin` /
`atMax` reports the seam pinned. Pinned by a test that drives one large move from
rest and asserts it does not arm.

**If you touch this, do not reintroduce a derived overshoot.** The clamp flags
exist so that "are we pinned" is never answered by comparing floats, and their
docstring says so.

## Decided in conversation, not visible in the diff

- **Seam-join has no consumer behind it.** It was self-filed in `TODO.md` the same
  day work began; neither closed consumer evaluation asked for it. It is being
  built because it is small and unblocked. Tab-stacking, next, does have a
  concrete gap behind it — it is the only entry left under "Still uncovered" in
  the e2e section, and a library gap rather than a test gap.
- **`candidateId`, not `victimId`.** The field is populated whenever the gesture
  has a direction, including while `armed` is false. "Victim" read as a verdict a
  caller might act on alone, and destroy is irreversible.
- **A join's ids are `NodeId | string`**, matching `childId` and `affects` beside
  them, so a strategy working in `ItemId` needs no cast. The host casts once.
- **`destroyBlockedBy` is deliberately stricter than the store.**
  `unregisterNode` checks the lock on the id it is handed, then cascades with no
  further checks, so a destroy-locked descendant dies silently today. Seam-join
  declines to exploit that rather than fixing it; the store gap is filed in
  `TODO.md`.
- **A seam already pinned at rest arms from its first move.** The move that
  *reaches* a clamp still reads unpinned, so accumulation normally starts one move
  later — but a pane already sitting on its floor has nowhere to go, so all travel
  really is overshoot. Requiring a wiggle first would be worse.
- **`<Zone>` / `<Panel>` get the destroy with no armed visual.**
  `onJoinArmChange` is optional because the presets' declarative children have no
  per-pane wrapper to mark. Whether that ships or the presets should suppress the
  join until they can show it is an open question under review, not a decision.

## Two questions filed but not decided

Both are in `TODO.md` under Drag and drop, written to make clear nothing was
chosen: whether a shared gesture lifecycle should be extracted once a third
copy of arm/cancel/commit appears, and whether input *binding* should come from
`@weasel-js/gestures`. Also filed there: **drop-on-edge to split**, which is the
one standard drop semantic this library has no answer for, and which shares its
hard part (drop intent from a hit-test) with tab-stacking.

## Conventions worth not rediscovering

`CLAUDE.md` has them all. The two that bite here: **every feature ships with an
operable Ladle story in the same change**, because the Playwright suite drives
Ladle; and **assert exact rects**, because a geometry assertion written as an
inequality passes for the wrong reason.

One more, learned this run: **mutation-check every test that asserts something
does *not* happen.** Two such tests in this work passed vacuously on the first
attempt — including one written into the plan by hand — and only failed honestly
after the assertion was rewritten.
