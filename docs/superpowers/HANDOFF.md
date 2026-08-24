# Handoff: presets drop hit-test next

For whoever picks up windease next. Repo state, what the next task is, and the
traps that cost time and are recorded nowhere else. The durable documents are
[`TODO.md`](../../TODO.md), [`CHANGELOG.md`](../../CHANGELOG.md), the README and
the per-feature designs in [`specs/`](specs) — this points at them rather than
repeating them.

## Repo state

On **`main`**, clean, no other branches and no worktrees: drop-intent,
seam-join, floating-strategy, drop-on-edge and content-size-rearm are all
merged and deleted. `main` is **unpushed**, 116 commits ahead of `origin/main` —
pre-existing, and `package.json` still says 1.2.1.

Green: 1327 unit tests, 252 e2e specs across Chromium/Firefox/WebKit, lint,
typecheck, build. `scripts/check-changelog.sh` exits 1, as it does on every
unreleased `main` — it is the release gate, and a populated `## Unreleased` is
exactly the pre-release state.

## What is next

**Give the declarative presets a drop hit-test.** `PresetShell` calls
`useDropTarget(id, wrapperRef, { enabled })` (`src/react/presets.tsx:584`) with
no `getInsertionIndex` and no `getDropIntent`, so every `<Zone>` / `<Panel>` drop
appends. Two shipped features ride on the intent that never gets resolved there:
tab-stacking and drop-on-edge both work only under `<Container>`, and a preset
that appends where the same gesture splits reads as a bug. Nothing about
`resolveDropIntent` is imperative-only, and the hit-test that fixes stacking and
splitting is the same one that fixes plain insertion.

`TODO.md` has no `[HIGH]` left otherwise. The next candidates behind this one are
the small correctness debts (`<Zone config>` is silently initial-only,
`unregisterNode`'s cascade skips descendant locks, an over-squeezed seam reports
`aria-valuemin === aria-valuemax`) and the ~1% keyboard-spec flake under parallel
load, which has no diagnosis.

## Traps that cost time, so you do not pay twice

- **The store notifies on a microtask**, so the synchronous form of `act()`
  returns before React has re-rendered. Use `await act(async () => …)`.
- **Any node the store creates needs `showNode`.** `split` calls it seven times
  for a reason; a stack that renders as nothing is this bug.
- **`<Zone config>` is read once, at creation.** `makeReconciler` reconciles
  `meta` / `hints` / `placement` / `lock` / `pinned` and `<Zone>` adds `state`,
  but nothing reconciles `config`. Re-rendering with a changed `config` does
  nothing. Filed in `TODO.md`.
- **A stack's body is a full-box `<Container>` overlapping the `headerSize`
  band**, so a tab strip drawn before it in DOM order swallows its own clicks.
  The story fixes it with one `z-index`.
- **Ladle serves port 61000 per checkout.** A second checkout running its own
  dev server means `npm run test:e2e` can drive the other one and lie about what
  is in the tree.

## Practices this repo earned, not just prefers

- **Mutation-check every negative assertion** — break it on purpose and watch it
  fail. The last sweep found four tests that passed vacuously, three of them
  written straight from a plan.
- **A story has to be operable, not a demo.** Two defects in tab-stacking
  survived a green headless suite and were visible on first render; the same
  round trip caught a content-sized pane that never re-measured.
