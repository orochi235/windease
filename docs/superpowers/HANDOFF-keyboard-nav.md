# Handoff — keyboard navigation, implemented and merged to main

Pointer, not a copy. The design is
`docs/superpowers/specs/2026-08-21-keyboard-navigation-design.md` and the
thirteen tasks are `docs/superpowers/plans/2026-08-21-keyboard-navigation.md`.
This file carries only what they can't.

- **State:** merged. All thirteen tasks are on `main`, along with the subtree
  serialize/graft workstream. `feat/keyboard-navigation` is disposable; the
  worktree at `.claude/worktrees/keyboard-nav` is still on disk.
- **Green at `0a1334b`:** 828 tests / 75 files, 20 e2e, typecheck, lint, build.
- **Unreleased:** 41 commits ahead of `origin/main`, `package.json` at 1.1.0,
  no tag.

## What is left

Push and release, both held for the user — see Version below. Nothing else.

## Three defects the browser found that jsdom could not

All three are fixed in `d4aca66`; they are recorded because each is easy to
reintroduce.

- **Zero tab stops when nothing is focused.** Roving tabindex gives `0` to the
  focused wrapper — so before any click, every wrapper was `-1` and the layout
  could not be entered by keyboard at all. `FocusProvider` now publishes an
  `entryId`, which the focused node supersedes.
- **Geometry changes without a store notification.** Placements arrive from a
  ResizeObserver via `ContainerHost`, not from the store, so anything that
  recomputes on `store.subscribe` alone samples an empty rect registry once
  and never looks again. The registry publishes its own changes now
  (`GeometryRegistry.commit` / `.subscribe`).
- **The focus root broke height chains.** `FocusProvider` wraps children in a
  div; as a plain block it collapsed any `height: 100%` beneath it. It carries
  `display: contents` from `@windease/react/styles.css` — a consumer who does
  not import that stylesheet gets the broken layout back.

## Two places the plan was wrong, and what was done instead

- **The plan's test helpers never `showNode` the zone.** Task 3's original
  rule required every ancestor to be `visible`, which no real tree satisfies:
  `<Container>` never checks its parent's lifecycle, so a root nobody showed
  is on screen. `navigableLeaves` now excludes a subtree only for an
  explicitly `hidden` (or destroyed) container.
- **Task 1's "clears when the remembered child is removed" contradicts Task
  2.** Once a successor is named, the container immediately remembers the
  replacement rather than emptying. The assertion was rewritten and the
  genuinely-empty case pinned separately.

## Still open

`announce()` ships on `FocusAdapter` with no call site — moving real DOM focus
announces the pane name for free, so what is uncovered is a change with no
focus movement (a successor after a destroy, a pane relocated). Needs a live
region, which the design deliberately did not specify. Recorded in `TODO.md`
under "On main, unreleased".

## Version

1.2.0 when it is minted, shared with the subtree serialize/graft work. Not
minted: `package.json` and `src/index.ts`'s `VERSION` both still read 1.1.0.
Deliberate — `npm version minor`'s `postversion` pushes the tag, which
triggers the Release workflow to publish via OIDC. That is the user's call and
they have said not yet.

## Decisions from conversation the spec does not explain

- **Collapse was withdrawn as a library feature.** There is no
  `placement.collapsed`; collapse is a userland pattern in the README, pinned
  by `src/collapse-pattern.test.ts`. Nothing in navigation may assume it.
- **`graft` must not claim focus** (agreed with `windease-05`): an attachment
  the user did not initiate stealing focus is a defect, and arrival is not the
  inverse of departure.
- **`store.hasFocus` became `canFocus` in 1.2.0**, sooner than the 2.0.0 the
  TODO entry proposed, because two workstreams misread it as a state check in
  one evening. `hasFocus` survives as a deprecated alias to 2.0.0, pinned by a
  test so the delegation can't rot. The other session's handoff is
  `docs/superpowers/plans/2026-08-21-consumer-wishlists-handoff.md`.

## Traps

- **A worktree under `.claude/worktrees/` is inside the repo root**, and
  neither vitest nor biome reads `.gitignore`. If lint reports "Checked 0
  files", that is the unanchored `**/.claude` pattern, not a clean tree.
- **Never read tool output through `| tail -2`.** Check exit codes.
- **An `expect` inside a `store.events` handler cannot fail a test** —
  `TypedEmitter.emit` swallows listener throws. Use `recordEvents`.

## Verify

```
npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e
```
