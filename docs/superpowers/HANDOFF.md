# Handoff: drop-on-edge next

For whoever picks up windease next. Branch state, and the decisions made in
conversation that the code does not record. The durable documents are
[the design](specs/2026-08-22-drop-intent-design.md), [`TODO.md`](../../TODO.md),
[`CHANGELOG.md`](../../CHANGELOG.md) and the README — this points at them rather
than repeating them.

## Repo state

On **`main`**, clean. Drop intent and tab-stacking merged; the `drop-intent`
branch is merged and can be deleted. `main` is still **unpushed**, now ~90
commits ahead of `origin/main` — pre-existing, not something this work created.

Green: 1243 unit tests, 201 e2e specs across Chromium/Firefox/WebKit, lint,
typecheck, build. `scripts/check-changelog.sh` fails, as it does on `main` — it
is the release gate and `## Unreleased` is exactly the pre-release state.

It shipped with a Ladle story (`tab-stack--stack-on-drop`), browser specs,
README and `CHANGELOG.md`. It was built from
[the plan](plans/2026-08-22-drop-intent.md), one task at a time, TDD, with every
negative assertion mutation-checked.

The next feature is **drop-on-edge**, still the only [HIGH] in `TODO.md`. It is
now much smaller than it was: `resolveDropIntent` already resolves a `split`
intent with its edge, so what is left is a commit path (`store.split`, then move
the source into the new half) and a preview. Nothing else is open.

## What mutation-checking caught, and why to keep doing it

Every negative assertion got broken on purpose to watch it fail. **Four tests
passed vacuously and were rewritten**, three of them mine, written from the plan:

- The band-clamp test passed `band: 0.49`, which never exercises the clamp.
  Fixing it to `0.9` also exposed that `Math.max(band, 0)` was unobservable — a
  negative band carves no band, identically to zero — so the code shrank too.
- The "refuses to stack onto a descendant" store test reached the
  already-a-stack branch, where `moveNode` throws for its own reasons. It never
  touched the guard it was named after.
- The same test in `DragEngine` registered the dragged node as its own drop
  target, so `targetId === draggingId` rejected it before the descendant rule
  ran.
- One preset test asserted a `<Panel>` with no container renders. A `<Panel>`
  cannot mount without a parent at all, so the case does not exist; the
  registry-less `<Zone>` is the real no-layout path.

**And two defects only the browser could see**, after every headless test was
green: `stackNodes` registered the stack but never called `showNode`, so it
rendered as nothing; and the drop left the pane you dropped *onto* showing,
rather than the one you moved. Both are one line. Neither is reachable without a
render — which is the argument for the story being operable rather than a demo.

## Decided in conversation, not visible in the diff

- **The five-zone hit-test was chosen over two alternatives.** Main-axis bands
  insert, cross-axis bands split, the centre stacks, corners go to the main
  axis. The point is that split then costs a commit path rather than a second
  hit-test. A centre-vs-rest model is the degenerate case of this one, not a
  rival — it is what you get with `split` disabled.
- **`LayoutResult.hidden` was designed, then cut.** The first spec added a field
  to distinguish "withheld" from "unplaced". `<Container>` turned out to already
  drop rect-less children (`Container.tsx:403`), so the gap was only in the
  declarative presets — and `unplaced` already distinguishes it, because flow
  mode and an unregistered strategy both report it empty. No new strategy
  surface.
- **`stackOnDrop` is a host prop, not strategy config.** The hit-test is the DOM
  adapter's and no strategy reads the flag; putting it in `container.config`
  would mean adding a key to every `configSpec` that none of them consume.
- **`stackConfig` lives on `<DragProvider>`** because the drop happens in the
  engine, which otherwise has no way to know how tall a strip it never sees is.
- **The drop activates what you moved**, in `stackNodes` rather than in the
  engine, so the mutation is self-consistent however it is called.
- **A split intent is refused at the hover, not thrown at the drop.** Throwing
  inside a pointer handler to catch a wiring mistake is worse than a rejected
  hover, which is already visible.
- **No default preview ships.** There is none for insertion either —
  `defaultDragOverlay` is a chip and `insertIndex` sits in `DragOverlayContext`
  undrawn. Seam-join's appearance exception was earned by an unconfirmed
  destroy; a stack is one undo away.

## Traps that cost time, so you do not pay twice

- **`<Zone config>` is read once, at creation.** `makeReconciler` reconciles
  `meta`/`hints`/`placement`/`lock`/`pinned` and `<Zone>` adds `state`, but
  nothing reconciles `config`. Re-rendering with a changed `config` prop does
  nothing. Filed in `TODO.md`.
- **The store notifies on a microtask**, so the synchronous form of `act()`
  returns before React has re-rendered. Use `await act(async () => …)`.
- **A stack's body is a full-box `<Container>` overlapping the `headerSize`
  band**, so a tab strip drawn before it in DOM order swallows its own clicks.
  The story fixes it with one `z-index`; filed as an ergonomics question.
- **Any node the store creates needs `showNode`.** `split` calls it seven times
  for a reason.
- Strip is the only strategy that reads `maxSize` or `placement.size`. Three
  doc comments claimed stack and split did too; they are corrected.

## Filed, none decided

All in `TODO.md`:

- **Drop-on-edge [HIGH]** — the commit path, described above.
- **Only `<Container>` can stack on drop.** The presets' drop target passes no
  hit-test at all, so a `<Zone>` drop has always appended.
- **`lock.arrange` gates switching tabs**, because activation writes through
  `updateContainerConfig`. Wrong axis; a second one costs more than the wart.
- **`<Zone config>` is initial-only** — reconcile it, or document it as initial.
- **A stack body swallowing its strip's clicks** — fix the structure, or make
  the README warning the whole answer.
- **Two gesture pipelines are still converging.** Tab-stacking added no third
  copy: drop intent rides `DragController`, which already owns all six pieces.
  The extraction trigger is unchanged.
