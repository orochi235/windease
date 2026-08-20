# Handoff — what a consumer needs from `splitStrategy`

**What:** four gaps found by the first real consumer of recursive `splitStrategy`, with a repro.
**For:** whoever picks up windease next. **Answers:** what to fix, and which one matters most.

Found against the published **0.8.0** while building a sixteen-panel workbench in another repo
(`blitsklieg`, `packages/core/dev/tube-lab` — a dev-only tool that tiles one letter per panel over a
single WebGL canvas). That work is **blocked** on items 1 and 3. Nothing here is a windease design
disagreement; all four are places where the recursive path has no answer yet.

**This tree reproduces all of it too** — the numbers below come from `dist/` built at 0.9.0, so
none of it is already fixed here.

## Repro

From this repo, after `npm run build`:

```sh
node --input-type=module -e "
import { splitStrategy } from './dist/index.js';
const mk = n => Array.from({length: n}, (_, i) => ({ id: 'p' + i }));
const C = { w: 1200, h: 800 }, O = { recursive: true, gutterSize: 6 };

const s16 = splitStrategy.initialState(mk(16));
const q = [...splitStrategy.layout({ items: mk(16), container: C, state: s16, options: O }).placements.values()];
console.log('1+2:', q.filter(x => x.w <= 0).length, 'panes at w<=0,', q.filter(x => x.x + x.w > C.w + 1e-6).length, 'outside');

const s4 = splitStrategy.initialState(mk(4));
const grew = splitStrategy.layout({ items: mk(5), container: C, state: s4, options: O });
console.log('3a:', grew.placements.size, 'placed of 5, unplaced', JSON.stringify(grew.unplaced ?? []));

const shrunk = splitStrategy.layout({ items: [{id:'p0'},{id:'p1'},{id:'p3'}], container: C, state: s4, options: O });
console.log('3b: widths', [...shrunk.placements.values()].map(r => Math.round(r.w)).join(' '), 'in a 1200 container');
"
```

Prints `9 panes at w<=0, 7 outside`, `4 placed of 5, unplaced []`, and `597 296 145`.

## 1. `buildTree` cannot tile — `src/layout/split.ts:251`

It builds a right-leaning spine: every split at ratio 0.5, `_direction` passed down unchanged and
never alternated. Panel *k* gets `W / 2^k`, so the result is always vertical stripes of halving
width and never a grid. At sixteen panels in 1200×800, p0 is 597px and p6 is 3px.

The rest of `layout` is fine. Feeding it a hand-built balanced tree with the direction alternating
by depth tiles sixteen panels cleanly — a 4×4 of 295×195 panes, 15 affordances, no bad rects. The
fix is confined to this one function.

## 2. `walk` never clamps a pane to zero

Side B's extent is `rect.x + rect.w - bx` where `bx = rect.x + aSize + gutter`. Once a pane is
narrower than the gutter that goes negative, and the recursion keeps adding `gutter` to `x`, so
children march past the container's right edge. In the repro, p15 lands at `x: 1244.6, w: -44.6`
against a 1200px container.

Independent of item 1 — any container small enough for its pane count hits it.

## 3. A tree has no story for children arriving or leaving — the blocking one

`useContainerLayout` calls `initialState` only when there is no persisted state
(`src/react/useContainerLayout.ts`), so once a tree exists it is never re-derived. Nothing grafts a
new leaf in or collapses a removed leaf's parent:

- **A child registered after the tree exists is silently dropped.** Five items against a
  four-leaf tree place four, and `unplaced` is **empty** — so a consumer gets no signal at all, not
  even the one the field exists to give.
- **A removed child's space is not reclaimed.** The remaining panes keep their old widths, leaving
  a hole. This case at least warns (`splitStrategy: leaf "p2" not in items; dropping`).

Any consumer with a dynamic panel set hits this immediately. The workbench adds and removes panels
from a text field, so it is dead in the water without it.

## 4. Dragging a panel does not move it

DnD reorders the node in the parent's `childOrder`, but `splitStrategy` places by leaf position in
the tree and never reads `childOrder`, so the gesture completes and nothing moves. Confirmed in the
browser: DOM order changes, placement does not. Gutter resize works correctly.

Arguably intended — position in a split tree is not an ordering — but then there is no way to
rearrange a split layout by dragging at all, which is what a consumer reaches for after
`<DragHandle>` is wired up. Either the strategy honors `childOrder`, or it needs an explicit
"these two leaves trade places".

## The shape of the real gap

**Items 3 and 4 are one missing capability.** Add a leaf, remove a leaf, swap two leaves — all
structural edits to a live tree, and none exists. `SplitNode` is only ever produced whole by
`initialState` and then mutated at the ratios by `reduce`. Give the strategy those three operations
(or a documented way for a consumer to perform them on the state it owns) and item 3 is fixed and
item 4 becomes a two-line call at the drop site.

That is the piece worth designing rather than patching.

## Two smaller things, noticed in passing

- **0.8.0 shipped a stale `VERSION`.** The published tarball's `dist/index.js` exports
  `VERSION = '0.7.0'`. This tree builds `0.9.0` correctly, so it is not a live bug — but the 0.8.0
  release went out with the constant a version behind, which is worth a glance at whatever is
  meant to keep it in step before the next one.
- **`initialState` is optional but `layout`'s `state` is required** (`src/layout-types.ts:129`), so
  the pure-function path cannot be called type-safely: `splitStrategy.initialState?.(items)` is
  `SplitNode | undefined` and `tsc` rejects passing it straight to `layout`. Every consumer testing
  a strategy without a store has to narrow it by hand. Typing `splitStrategy` so its own
  `initialState` stays required would remove the papercut.

## What would unblock the consumer

Item 1 and item 3, in that order. Item 2 is latent for it (a balanced 4×4 leaves 295px panes, well
clear of the gutter) but should land with item 1 since it is three lines. Item 4 can wait — the
workbench can ship with resize-only rearranging.

If these are not being fixed soon, fold them into `TODO.md` under its `[HIGH]` convention so they
are not stranded in a file nothing else links to, and the consumer will seed and maintain its own
`SplitNode` through `setContainerState` in the meantime.
