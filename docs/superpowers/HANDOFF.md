# Handoff: 1.3.0 is ready to cut

For whoever picks up windease next. Repo state, what the next task is, and the
traps that cost time and are recorded nowhere else. The durable documents are
[`TODO.md`](../../TODO.md), [`CHANGELOG.md`](../../CHANGELOG.md), the README and
the per-feature designs in [`specs/`](specs) — this points at them rather than
repeating them.

## Repo state

On **`main`**, clean, no other branches and no worktrees. `main` is **unpushed**,
well ahead of `origin/main` — pre-existing — and `package.json` still says 1.2.1.

Green: 1347 unit tests, 261 e2e specs across Chromium/Firefox/WebKit, lint,
typecheck, build. `scripts/check-changelog.sh` exits 1, as it does on every
unreleased `main` — it is the release gate, and a populated `## Unreleased` is
exactly the pre-release state.

## What is next

**Cut 1.3.0.** `## Unreleased` is full and nothing in `TODO.md` is `[HIGH]`. The
bump is a minor: the section is additive except three documented behavior
changes, one of which — a destroy-locked descendant now refusing the whole
cascade — has its own note under the README's **Breaking changes**. Retitle
`## Unreleased` to `## 1.3.0`, bump `package.json`, and let
`scripts/check-changelog.sh` gate it.

Behind the release, `TODO.md` is `[MED]` features and questions waiting on a
second consumer — plus the ~1% keyboard-spec flake under parallel load, which
still has no diagnosis and is the one thing worth chasing that nobody has.

## Traps that cost time, so you do not pay twice

- **The store notifies on a microtask**, so the synchronous form of `act()`
  returns before React has re-rendered. Use `await act(async () => …)`.
- **Any node the store creates needs `showNode`.** `split` calls it seven times
  for a reason; a stack that renders as nothing is this bug.
- **A declared `config` is diffed against what the last render declared, never
  against the store.** The store's copy also holds keys a gesture wrote — a
  stack's `activeId` — and re-asserting the declared config would snap the tab
  back on the next render.
- **A stack's body is a full-box `<Container>` overlapping the `headerSize`
  band**, so a tab strip drawn before it in DOM order swallows its own clicks.
  The story fixes it with one `z-index`; the README says so now.
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
