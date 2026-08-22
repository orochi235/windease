# Handoff — consumer wishlists (2026-08-21)

**All three `[HIGH]` wishlists are done.** For whoever picks up what is left in
`TODO.md`. Assumes you have read those sections; this covers only what they
can't carry — tree state, the decisions still open, and the traps that cost
time.

The keyboard-navigation work was a separate session; it has landed on local
`main`. See "Two agents" below for what it owns.

## Tree state

All of it is merged to `main`, which is clean and **local-only — nothing in this
repo has been pushed to `origin/main` since `b5d5647`, now 58 commits back.**
914 tests / 86 files green, plus typecheck, lint, build, 78 e2e specs across
Chromium/Firefox/WebKit, and `scripts/check-doc-hashes.sh`.

`feat/palette-sizing-keys` is merged and disposable, as are `feat/subtree-graft`
and `feat/keyboard-navigation`. `.claude/worktrees/keyboard-nav/` is still on
disk.

**Two sessions were landing work in parallel here.** The focus-announcements
session split `DragEngine` out of `DragController` and added `bindAnnouncer`
while the wishlist branch was open. That merge is done — order control moved
into the engine, where it belongs — but the lesson stands: check whether `main`
moved before merging, and re-read any claim your branch wrote about a gap the
other session may have since closed.

**Nothing is released**, including the three wishlists. `package.json` and
`src/index.ts`'s `VERSION` both still read `1.1.0`, and `TODO.md`'s heading
reads `## On main, unreleased — ships as 1.2.0` precisely because the claim runs
ahead of the mint. `npm version minor` has deliberately not been run: its
`postversion` pushes the tag, which triggers the Release workflow to publish over
OIDC. That is the user's call, and it is the single biggest outstanding decision
in this repo — now covering three more wishlists than when it was first
deferred.

## What shipped

**The three `[HIGH]` wishlists**, on `feat/palette-sizing-keys` — see Next below
for what each closed and the design doc for the first.

**Subtree serialize / graft**, an earlier session. `serialize(store, { root })` emits a
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

**Only cite a commit hash once it is on the trunk.** A hash naming a commit on
an unmerged branch expires when a rebase renumbers it, and `git show` then
returns nothing — a reader cannot tell whether the commit was dropped, squashed
or renumbered. `scripts/check-doc-hashes.sh` verifies every citation in every
tracked `.md`; run it after any rebase that touched documented commits.

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

The three `[HIGH]` wishlists are closed: content-driven sizing and keyboard
gutters (docked tool palettes), controlled `childOrder`, and grid resize
gutters. `TODO.md` is rewritten in place; the design doc for the first is
[`specs/2026-08-21-docked-tool-palettes-design.md`](../specs/2026-08-21-docked-tool-palettes-design.md).
The other two are recorded in `TODO.md` and their commit messages — no separate
spec, because neither turned out to have a decision worth a document.

What remains on the labkit list:

- **In-flow render mode** still needs hard scoping before anyone starts — a
  second rendering path means every future feature works in both or explicitly
  doesn't.
- **Overflow policy** (`squeeze` / `scroll` / `unplace` as a strip config).
  Deliberately parked: `LayoutResult.overflow` already lets a consumer build any
  of them, and the policy is sugar worth waiting for a second asker.
- **Wiring resize into the live region.** `bindAnnouncer` shipped separately and
  covers structural change; gutter resize deliberately narrates nothing — see
  the trap below for why that is not a simple hook-up.

Still deliberately unanswered, unchanged: **how a canvas host learns about
`devicePixelRatio`** (klieg wishlist). It would be a second exception to the
DOM-independence tenet. Do not implement it without asking.

Note the tenet came through this work intact: content sizing delivers
measurement as a `LayoutItem` input rather than letting the core measure, so
`ContainerHost.setNaturalSize` is the real API and `observeNatural` the DOM
convenience beside it — the `setViewport` / `observe` split, reused.

## Traps this work added

**A callback ref that changes identity is torn down every render.** Content
sizing attached its ResizeObserver from an inline `ref={(el) => observe(el)}`;
React 19 treats the returned teardown as a cleanup and ran it on every pass, and
the teardown drops the measurement. Every unit test passed while the feature did
nothing on screen — the Playwright spec is what caught it. Attach in an effect.

**jsdom has no ResizeObserver, and content sizing reaches that path on every
mount** — unlike the viewport observer, which a fixed `viewport` prop skips.
`observeNatural` no-ops without one. A new observer in library code needs the
same guard.

**A quantized extent cannot accumulate incremental `dx`.** Grid spans are cell
counts, so a few pixels round to the span it already has, every time, and the
drag never moves. That is why `LayoutEvent.payload.point` exists. Any future
strategy with discrete extents wants the same treatment, and wants
`Affordance.bounds.step` so a keyboard press means one unit rather than 8px.

**`Affordance.bounds` is now read by a screen reader.** It was advisory when
only a drag consumed it, and inaccuracy was tolerable — `resizeMode: 'neighbor'`
reported the whole row's slack while the drag stopped at the neighbor's minimum.
Published as `aria-valuemax` that is a defect, and it is fixed. Any strategy
emitting `bounds` now owes the same accuracy.

**Nothing narrates a resize**, and the live region `bindAnnouncer` added does
not change that. Under `resizeMode: 'neighbor'` a step can be truncated by the
*neighbor's* limit while the focused pane is nowhere near its own, and
`atMin` / `atMax` describe the dragged child — so narrating from them would
state something false. `aria-valuenow` carries the truth. Anyone wiring resize
into the announcer has to fix the numbers first.

**Controlled order means the store is not written at all.** If either side of a
cross-parent drop is controlled, `moveNode` does not run and each controlled
parent gets its own callback; the uncontrolled counterpart is the host's to
update. Committing here *and* asking the host to commit applies one gesture
twice. Only library-mediated gestures are intercepted — a direct
`store.reorderInParent` is the host acting on itself.
