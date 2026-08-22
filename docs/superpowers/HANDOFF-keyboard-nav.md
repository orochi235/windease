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

Push and release, both held for the user — see Version below. Nothing else on
this workstream.

## Branch `feat/focus-announcements`, cut from `main`, unmerged

Three items taken off `TODO.md` while another session works the three `[HIGH]`
wishlists — picked to avoid its files (strip/grid layout, placement sizing,
reconcile). Green: 855 unit tests / 78 files, 60 e2e across three browsers,
typecheck, lint, build.

- **`bindAnnouncer` + a live region** closes the `announce()`-with-no-call-site
  gap this handoff records under Still open. Below is now the only open a11y
  item there.
- **`DragEngine`** is the DOM-free half of `DragController`, closing the
  DOM-independence violation that was in Loose ends. `DragController` keeps its
  exact public API and delegates.
- **Firefox and WebKit** now run the e2e suite alongside Chromium. All 20 specs
  passed in all three unmodified.

`TODO.md` is edited on this branch (three sections), so it is the likely
conflict with the other session's branch. Everything else is new files or
files that workstream does not touch.

## Next work, agreed but not started

The user asked to take the three `[HIGH]` wishlists in `TODO.md` next, all
three, starting with docked tool palettes. Nothing is designed or planned
yet — those sections are consumer evaluations, not commitments, and each
needs its own brainstorm before a spec.

- **Wishlist: docked tool palettes** — content-driven sizing is the load
  bearing gap ("as tall as my contents" currently forces the consumer into a
  layout pass keyed on the output of a layout pass).
- **Wishlist: hosting an app that already has a workspace store** — controlled
  `childOrder`, where the binding and the host are two writers for order.
- **Grid resize gutters** — auto-balance lives in `gridStrategy`, draggable
  seams in `stripStrategy`, and a host wanting both must give one up.

Read those three sections before proposing anything; they already record what
a consumer hit and what is genuinely missing versus already shipped.

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

A collapsed pane must keep its accessible name and a keyboard-reachable expand
control — recorded against the collapse pattern in `TODO.md`, not pinned by a
test.

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
