# Exploration: outsourcing zone layout to CSS

**Status:** considered, declined for now. Captured here so we don't redo the thinking from scratch.
**Date:** 2026-06-04

## The idea

Replace the three "passive" zone layout strategies (`grid`, `stack`, `strip`) with a passive Zone mode where the consumer styles the Zone with plain CSS (flexbox / CSS grid). The kit stops shipping layout math for these cases.

```tsx
// Today
<Zone id={MAIN} strategy={gridStrategy} config={{ cols: 2, gap: 8 }}>
  {(w) => <Panel window={w} />}
</Zone>

// Proposed
<Zone id={MAIN} className="main-grid">
  {(w) => <Panel window={w} />}
</Zone>
```

```css
.main-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
  padding: 8px;
}
```

The Zone, in passive mode, renders windows as in-flow children of itself. No `--w-x/y/w/h` CSS vars, no `LayoutResult.placements`, no strategy required.

## What disappears from the kit

- `packages/core/src/layout/grid.ts`, `stack.ts`, `strip.ts` (and their tests)
- `gap`, `padding`, `fill`, `defaultItemSize`, `maxCols`, `maxRows`, `orientation`, `cols`, `rows`, `axis` props (all become CSS)
- The `--w-x` / `--w-y` / `--w-w` / `--w-h` CSS-variable hack in Zone
- About 150 LOC of layout arithmetic plus three strategy files and their tests

## What stays

- `LayoutStrategy` interface — but only for *stateful* strategies (`binarySplit`, `recursiveSplit`) that own ratios + emit drag-gutter affordances. Flexbox can't express interactive splits.
- `Workspace` — unchanged.
- Zone keeps an optional `strategy` prop for stateful uses.
- DnD insertion-index hit-testing — already reads sibling `getBoundingClientRect`s; doesn't care how children got positioned.
- History/undo/redo — unchanged.

## API migrations

- `canAccept` moves from `LayoutStrategy` method to a `Zone` prop: `<Zone canAccept={items => items.length < 5}>`.
- Store stops caring about layout: `registerZone({ id, strategy? })`. No `config` for passive zones.

## What's lost

1. **Programmatic placements.** Today consumers receive `(window, placement: Rect) => ReactNode`; that second arg lets them do FLIP animation, analytics, etc. without measuring the DOM. In passive mode the placement is meaningless — consumers measure via `getBoundingClientRect`.
2. **`unplaced` overflow.** No CSS equivalent of "give me capacity 9, anything else goes to `unplaced`." Consumers slice items before render, or use `overflow: hidden` and let content fall off.
3. **Auto-balance grid (`cols = ceil(sqrt(n))`).** No clean CSS equivalent. `repeat(auto-fit, minmax(W, 1fr))` is close but fills based on container width, not item count. Consumers who want true auto-balance keep using a strategy.
4. **Batteries-included defaults.** Consumers maintain a CSS file instead of importing a one-line strategy.

## Why we're not doing it now

- The kit currently provides immediate value out of the box; passive mode shifts upfront cost onto the consumer.
- The recently-shipped `fill` / `defaultItemSize` / `unplaced` / `canAccept` / `maxCols` / `maxRows` props would all be deletions or migrations — meaningful churn for a single-app project with no external consumers yet, but real churn if there are ever external consumers.
- `LayoutResult.placements` is load-bearing for the DnD hit-test path's confidence — it currently uses DOM measurement too, but the data path through the kit is consistent and easy to reason about. Passive mode would bifurcate that.
- The simplification is real (~150 LOC, three files) but doesn't unlock any new capability. The stateful strategies — which are the unique value — are unaffected either way.

## If we ever revisit

Roll it out in this order:
1. Add passive Zone mode behind a feature flag; keep strategy-based zones working unchanged.
2. Migrate Playground stories to passive + CSS to validate ergonomics.
3. Delete `grid.ts`, `stack.ts`, `strip.ts` and their tests; remove `--w-*` positioning from Zone.
4. Move `canAccept` from strategy method to Zone prop.
5. Update README; bump minor version.
