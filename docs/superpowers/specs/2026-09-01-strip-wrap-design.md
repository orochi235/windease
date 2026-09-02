# Wrapping strips, and rows as virtual strips

For whoever implements this. Assumes windease fluency (`docs/concepts.md`) and
the two tenets in `CLAUDE.md`.

Two pieces that need each other:

- **`overflowMode: 'wrap'`** — a strip that runs out of main-axis room starts a
  new row instead of squeezing, scrolling, or dropping panes.
- **`rowsOf()`** — a pure view that hands back any container's rows as virtual
  strips: same rects-in-order, same seam affordances, same insertion arithmetic
  a host already writes for a plain strip. Wrap needs it, grid gets it for
  free, and it is the answer to "can a grid row be treated as a strip" that
  does not require storing a grid as strips.

## Wrap

### Why a mode and not a flag

`overflowMode` already answers exactly one question — what to do when the panes
ask for more main-axis extent than the container has (`src/layout/strip.ts:65`).
Squeeze scales them down, scroll lays them out oversized and reports the excess,
unplaced drops the remainder. Wrap is a fourth answer to the same question, and
like the other three it is inert until something actually overflows: a wrapped
strip that fits places its panes exactly where a squeezed one does.

Add `'wrap'` to the `overflowMode` union and to `configSpec`
(`src/layout/strip.ts:325`). No `configConflicts` entry is needed — no existing
key goes dead under wrap; several change scope, which the sections below state.

### It needs items that state an extent

Breaking rows uses each item's *requested* main extent, the same ladder
`requestedAxis` already walks (`src/layout/strip.ts:106`): explicit
`placement.size`, then a measured `natural` when the item asked for
`sizing: 'content'`, then `hints.preferredSize`, then `defaultItemSize` under
`fill: false`.

Under `fill: true` with nothing stated anywhere, every item requests nothing,
the row never fills, and wrap does nothing at all. That is correct — a fill row
divides whatever it is given and cannot overflow — but it will read as a broken
feature to whoever tries it first. Say it in the `overflowMode` doc comment, and
trace it: one `layout` line when wrap is configured and every item is
extent-less.

### Breaking rows

Greedy first fit along the main axis. Accumulate requested extents plus `gap`
until the next item would exceed the available main extent (container minus
`2 * padding`); start a new row. An item whose own request exceeds the available
extent takes a row to itself at its requested size — it cannot wrap — and
contributes to main-axis overflow the way `'scroll'` does.

`fill: true` is applied **within a row, after breaking**: leftover main extent is
shared among that row's extent-less items. Deciding the break first and filling
second is what stops the chicken-and-egg of "how much is left over" before rows
exist.

`maxItems` still caps by count and still sends the remainder to `unplaced`
through `selectByCapacity` (`src/layout/capacity.ts:23`) — capacity is resolved
before breaking, so a capped strip wraps only what it kept.

### Row cross extent

Same shape of ladder as the main axis, read on the cross axis: a row is as tall
as the largest cross request among its items — explicit `placement.size`, then
`natural` for a `sizing: 'content'` item, then `hints.preferredSize` — and a row
where nothing states one takes an equal share of whatever cross extent the other
rows leave. The stated case is a wrapping toolbar; the fallback is what keeps
two rows of unsized panes from collapsing to nothing.

### What it reports

Rows stack along the cross axis, so wrap is the first mode that can overflow the
axis it is not laying out on. Sum the row extents plus gaps plus padding: if
that exceeds the container's cross extent, report it as `overflow` on the cross
axis, and let the host scroll (`scrollExtentStyle` already sizes an inner box
from `overflow`, so `<Container>` needs no change). Main-axis overflow is
reported only for the single-item-too-wide case above, as the largest per-row
excess.

### Seams

Within a row, unchanged: `resize-x-<childId>` on every non-last item **of that
row**. The trap is `bounds`: `boundsFor` takes `usableMain` and `placedItems`
(`src/layout/strip.ts:133`) and, with no pair, derives the ceiling as
`usableMain` minus the summed minimums of *every other placed item*. Both
arguments have to become the row's — a seam whose reach was computed against the
whole container advertises travel the drag then refuses, which a DOM adapter
publishes as an `aria-valuemax` that lies.

`resizeMode: 'neighbor'` and `'redistribute'` both become row-scoped —
redistributing across every sibling would push items between rows mid-drag, so a
redistribute seam spreads its delta across its own row only. `joinOnOvershoot`
is likewise row-scoped, which needs no special handling: it already names a
single victim pane, and that pane is in the row.

No seam between rows. A cross-axis seam there would have to write a row height
that no item owns, and dragging an item across the boundary is a reorder, not a
resize.

## Rows as virtual strips

### The shape

```ts
export interface StripView {
  /** The row's own main axis — the container's axis for a strip, 'x' for a
   *  grid row. */
  axis: 'x' | 'y';
  index: number;
  /** Main-axis order within the row. */
  itemIds: string[];
  rects: Map<string, Rect>;
  /** The row's own box, which is what a hit-test compares the cursor against. */
  bounds: Rect;
  /** The affordances whose gesture stays inside this row. */
  seams: Affordance[];
}

export function rowsOf(
  result: LayoutResult,
  items: LayoutItem[],
  options: Record<string, unknown>,
): StripView[];
```

Pure, DOM-free, derived from a `LayoutResult` that already ran — `src/layout/rows.ts`,
exported from `src/index.ts`. Nothing about the tree changes: one container, one
flat `childOrder`, snapshot untouched. A plain strip returns one row, which is
what makes it safe for a host to route everything through it.

Rows are recovered by grouping placements on the cross axis rather than by
asking the strategy, so a third-party strategy that tiles gets rows for free.

### What it buys

One host code path for "a row of panes", across three producers that are
otherwise unrelated: hit-test with `insertionIndexByMidpoint(row.rects, …)`
(`src/dnd/insertionIndex.ts:16`), render `row.seams`, bind arrow keys within the
row.

Wrap is the case that forces it. `insertionIndexByMidpoint` is single-axis, and
on a wrapped strip a main-axis midpoint says nothing about which row the cursor
is in — the drop resolves in two steps, row by cross axis then index by main
axis, and without a row view every host writes that itself.

### Where the analogy holds

**Resize already unifies, and nothing has to change for it to.** A grid seam is
the same `Affordance` object as a strip seam; `bounds.step` exists precisely so
a strategy whose units are not pixels can say what one press means
(`src/layout-types.ts:174`), which makes a grid seam a strip seam with a step of
one cell. Both dispatch by affordance id through `dispatchAffordance`, so a
`StripView` needs no write path of its own.

### Where it stops

**Ordering.** A grid is one flat sequence tiled into cells. "Insert at index 2
of row 1" is an index in that flat order, and it coincides with the visual
position only while every span is 1×1. `rowsOf` reports the row and the position
within it; translating that to a `childOrder` index is the caller's, and for a
spanned grid it is ambiguous by construction.

**Rows are not a partition.** An item with `span.rows > 1` covers several rows
(`src/layout/grid.ts:107`). It appears in `itemIds` for each row it covers, so
`itemIds` across the views is not a disjoint cover of the children. Document
that on the field — a host summing row lengths to count children would be wrong
only for spanned grids, which is the worst kind of wrong.

**Sizing.** This is the real difference, and it is why the unification lives in
a view rather than in the strategies: **a strip is item-driven and a grid is
container-driven.** Strip items state pixel extents and the container
distributes what is left (`src/layout/strip.ts:106`); a grid divides the
container into cells and hands items what the tiling gives them, with
`placement.span` in cell counts rather than pixels. A `StripView` over a grid row
therefore has no per-item extent to write — only a span — which costs nothing,
because the write path was never "set this width", it was always
`dispatchAffordance`.

That duality is also why "a grid is a superposition of strips" fails as a
*model*: independent strips would size each row's columns separately, and a grid
means the columns line up across rows. As a *view* over a result that has
already been laid out, the columns are wherever the strategy put them, and the
question does not arise.
