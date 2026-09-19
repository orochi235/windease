# The pocket: a leftover rectangle for items too small to place

For whoever implements this in the packing strategies, and for anyone later reading why a small
item landed somewhere other than the flow. **Status, 2026-09-19: designed, unbuilt.**

A packing strategy places each item where it falls in the flow, whatever its size. A wall of
photos with six thumbnails among them gets six holes in it; a dashboard of tiles with a handful of
tiny badges spreads the badges through the grid. The ask: divert the small ones into one region —
the **pocket** — which is the biggest rectangle the main pack left empty, and pack them in there
together.

## What it is

`pocket: { w, h }` on a packing strategy's config. An item whose width **and** height are both
under those numbers is diverted. A long thin item is not small — it is long — so it stays in the
flow. Without the key nothing changes, and the default is absent.

The four strategies that take it: `shelfStrategy`, `columnStrategy`, `skylineStrategy`,
`justifiedStrategy`.

## How it works

1. **Main pass.** The strategy packs the items that are not diverted, exactly as it does today.
2. **Find the pocket.** `largestEmptyRect(placed, container, gap)` returns the biggest
   axis-aligned rectangle inside the container that no placed rect covers, each placed rect grown
   by `gap` first so the pocket never touches its neighbors. Equal areas break toward the greatest
   `y`, then the greatest `x` — the direction the packers flow — so the pocket sits after the
   content rather than above it.
3. **Pack the pocket.** The strategy calls itself on the diverted items with the pocket's size as
   the container and the same `gap`, `sort` and `rotate`, and with `pocket` removed so the inner
   pass cannot divert again. Each returned rect is offset to the pocket's origin.
4. **Merge.** Pocketed placements join the main ones. Every item still gets a real rect; no node
   is invented and nothing new is drawn.

Whatever will not fit in the pocket follows the container's own `overflowMode`: `'unplaced'` bins
the leftovers, `'scroll'` lets the pocket's inner pass run past the pocket's box and reports the
excess as `overflow`.

Each pocketed placement carries a `pocket: 1` channel, so a host that wants to tint or outline the
region can find it; nothing in the core reads it.

### Finding the largest empty rectangle

A new pure module, `src/layout/empty-rect.ts`, exporting one function. The algorithm is the
standard sweep: every obstacle's right edge (and the container's left edge) is a candidate left
edge for the answer; from each, sweep the obstacles to the right in `x` order, narrowing a top and
bottom bound as each one is passed, and record the widest rectangle each bound pair allows. O(n²)
in the number of placed rects, arithmetic only, no DOM.

This is deliberately a standalone helper rather than a free-rect list maintained during packing:
`shelfStrategy` tracks rows, `skylineStrategy` tracks a horizon and `justifiedStrategy` tracks
rows of a fixed height, so none of them holds a free list to read. A separate pass is also what
lets `gridStrategy` reuse it later, over its empty cells.

## Edges

| Case | Behavior |
|---|---|
| Nothing diverted | Identical to today; the pocket is never computed. |
| Everything diverted | The pocket is the whole container, and the smalls pack normally in it. |
| No empty rectangle left | Every diverted item follows `overflowMode` directly, with no pocket. |
| Pocket smaller than any diverted item | Same: the items follow `overflowMode`. |
| Item with no usable size | Goes to `unplaced`, as it does now, diverted or not. |
| `pocket` with a non-positive or non-finite `w`/`h` | Read as absent, like `gap`'s handling. |

## Testing

Unit tests per strategy, plus a test file for `empty-rect.ts` of its own:

- The helper against hand-computed cases: one obstacle in each corner, an obstacle splitting the
  container, a full container, an empty container, and the tie-break toward the bottom-right.
- Diverted items land inside the pocket rect, and nothing placed overlaps anything else — the
  corpus checkers (`overlaps`, `outOfBounds`) already assert this shape.
- A long thin item under one threshold but not both stays in the flow.
- `overflowMode: 'unplaced'` bins what the pocket cannot hold; `'scroll'` reports it as overflow.
- A pocket pass cannot recurse: the inner call's options carry no `pocket`.

## Story

One Ladle story, operable rather than static: a wall of boxes with a `pocket` toggle, a size
threshold, and the strategy selectable across the four, so the pocket can be watched moving as
boxes are added and removed.
