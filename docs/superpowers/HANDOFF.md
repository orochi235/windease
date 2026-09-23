# Handoff: 2.1.0 is committed but not tagged

For whoever picks up windease next. Repo state, what the next task is, and the
traps that cost time and are recorded nowhere else. The durable documents are
[`TODO.md`](../../TODO.md), [`CHANGELOG.md`](../../CHANGELOG.md), the README and
the per-feature designs in [`specs/`](specs) — this points at them rather than
repeating them.

## Repo state

On **`main`**, clean, no other branches and no worktrees.

The release cut is committed: `package.json` and `package-lock.json` at 2.1.0,
and the `## Unreleased` section that held 2.1.0's entries retitled to `## 2.1.0`.
Nothing is tagged, so nothing has published.

**`v2.1.0` is not this commit's to carry.** The turn, deformation and board work
landed on top of the cut, so tagging `HEAD` would publish those features as
2.1.0. `scripts/check-changelog.sh` says so directly — it fails while a
populated `## Unreleased` sits above the version section, which is the state
`main` is in. Either tag the commit the bump was made against, or roll the whole
of `## Unreleased` into 2.2.0 and cut that instead.

Green on 2026-09-20, run on `studio` through `onto test`: 5224 unit tests across
202 files, then 1024 Playwright specs across Chromium, Firefox and WebKit. Five
webkit specs needed their retry, all of them `openStory` timing out under load.

The suite runs on the fleet now: `.onto/tests` runs `npm run test:all` — vitest
over the library and the pack lab, then Playwright over Ladle — as one job.

## What is next

**Decide what 2.1.0 means, then tag it** — see the repo state above.
Everything else is behind it.

Then `TODO.md`, which is `[MED]` items and questions waiting on a second
consumer. The three specified well enough to start cold:

- **Grid `sticky`** — the one unbuilt phase-2 preset key, and what Excel's
  preset needs to scroll with frozen headers. Strip already has it.
- **No preset declares `reorder`** though it is built and shipped; Firefox,
  Chrome and Win 10 are the three named as wanting it.
- **A wrap drop is asked about the wrong child list.**
  `DragEngine.checkAccept` (`src/dnd/DragEngine.ts:349`) falls through to the
  acceptance block for a `stack` or `split` intent, which does not change the
  parent's child count, so a full `strip` refuses a stack that would have left
  it as it was.

Plus the e2e suite's behavior under machine load, which still has no diagnosis:
failures wander between runs once the load average passes roughly twice the core
count. `scripts/flake-census.mjs` measures it rather than reasoning about it.
The five webkit retries above are the story-load mode it describes.

## Traps that cost time, so you do not pay twice

- **`npm version` pushes.** The `postversion` script is `git push
  --follow-tags`, and npm runs it even under `--no-git-tag-version`. A bump
  meant to stay local sent three commits to `origin/main`.
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
  is in the tree. `.onto/tests` sets `CI=1` for exactly this reason.
- **`onto test` refuses a sync that would delete files the node holds**, and it
  counts files that are tracked at `HEAD` and byte-identical. It named 19 on
  `studio`. `--force` is the answer; check what actually differs with
  `onto fetch studio:windease/<path>` before reaching for it.
- **Read `onto test`'s exit code from a file, never from the harness summary.**
  A run that reported success had failed: `EXIT=1` was in the redirected output.

## Practices this repo earned, not just prefers

- **Mutation-check every negative assertion** — break it on purpose and watch it
  fail. The last sweep found four tests that passed vacuously, three of them
  written straight from a plan.
- **A story has to be operable, not a demo.** Two defects in tab-stacking
  survived a green headless suite and were visible on first render; the same
  round trip caught a content-sized pane that never re-measured.
- **A story that demonstrates a workaround outlives the defect.** The Floating
  top-layer story registered its legend last so DOM order would keep it visible;
  when `z` finally did that job, the story's premise and its spec were both
  asserting the bug.
