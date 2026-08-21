# Handoff — keyboard navigation, ready to implement

Pointer, not a copy. The design is
`docs/superpowers/specs/2026-08-21-keyboard-navigation-design.md` and the
thirteen tasks are `docs/superpowers/plans/2026-08-21-keyboard-navigation.md`.
Read both; this file carries only what they can't.

- **Worktree:** `/Users/mike/src/windease/.claude/worktrees/keyboard-nav`
- **Branch:** `feat/keyboard-navigation`, rebased onto `main` at `3e82953`
- **Green:** 737 tests / 60 files, typecheck, lint, build
- **Written:** spec and plan only. **No implementation has started.**
- **Method chosen:** subagent-driven, one fresh subagent per task, review between.

## Start here

Task 1 of the plan. Tell the peer session before opening `store.ts` (see below).

## The other session

`windease-05` works the docked-palettes wishlist in the **main checkout** on
`main`. It is a different working tree now, so we no longer clobber each other
mid-edit — the risk moved to merge time.

- **Ours:** `src/focus/**`, `src/react/focus/**`, `ContainerCap.lastFocusedId`,
  the focus block at `store.ts:954-1006`, `AffordanceHandle`.
- **Theirs:** `strip.ts`, `resize.ts`, `patchPlacement` lock-gating,
  `Affordance`'s new `orientation` / `valueNow` / `valueMin` / `valueMax` /
  `atMin` / `atMax` / `label` fields.
- **Shared, announce before editing:** `store.ts`, `layout-types.ts`.

Rebase on `main` before merging; they commit there continuously.

## Decisions made in conversation that the spec doesn't explain

- **Collapse was withdrawn as a library feature** after the spec was written.
  There is no `placement.collapsed` and there won't be; collapse is a userland
  pattern documented in the README and pinned by `src/collapse-pattern.test.ts`.
  Nothing in navigation or the successor policy may assume a collapsed state.
- **Keyboard resize is a synthesized drag**, decided jointly with the peer so
  that stepping inherits the strip clamp order rather than adding a second
  clamp. Both dead hooks (`'keypress'`, `LayoutEvent.kind: 'key'`) are
  deprecated, removed at 2.0.0.
- **`main` was 12 commits unpushed** when this branch was cut, so the worktree
  was based on local `HEAD`, not `origin/main`. Still unpushed as of writing.

## Traps

- **A worktree under `.claude/worktrees/` is inside the repo root**, and neither
  vitest nor biome reads `.gitignore`. Both now exclude it (`d7e1f96`,
  `b9e67bd`), and `f2fca7b` on this branch re-anchors biome's pattern, which in
  its `**/.claude` form excluded *every* file when run from inside the worktree.
  If lint ever reports "Checked 0 files", that is this bug, not a clean tree.
- **Never read tool output through `| tail -2`.** It hid the biome failure above
  for several commits in the other session. Check exit codes.
- **An `expect` inside a `store.events` handler cannot fail a test** —
  `TypedEmitter.emit` swallows listener throws. Use `recordEvents` and assert
  after the mutation returns.
- **Two known gaps in the plan, recorded in its self-review, not oversights:**
  `announce()` ships with no call site (no live region is designed), and
  `accessibleName`'s kind-plus-index fallback changes when a sibling is added.

## Verify before claiming done

```
npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e
```
