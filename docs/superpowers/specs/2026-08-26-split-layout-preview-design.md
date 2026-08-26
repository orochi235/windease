# `splitPreview: 'layout'` — a live layout preview for a split drop

For anyone implementing or reviewing this in windease. It assumes the
vocabulary in [`docs/concepts.md`](../../concepts.md) and the drop-on-edge
work in
[`2026-08-23-drop-on-edge-design.md`](2026-08-23-drop-on-edge-design.md).

Hovering an insertion already lays the destination out as if the drop had
happened. Hovering a *split* does not: the onto-pane keeps its full size and a
translucent `div.windease-split-preview` is drawn over the half the dragged
node would take. This makes the split preview honest — the onto-pane shrinks to
the half it will actually get, and the dragged node's rect fills the other.

## The premise the `TODO.md` entry got wrong

That entry said a split preview needs the parent to "place a group in the
hovered pane's slot," and that this is why it was deferred. It doesn't.
`store.splitInto` gives the new group the onto-child's exact placement and
index, so **the parent's layout is unchanged by a split**. Only the interior of
one slot changes, and that interior is always a `strip` with
`{ axis, fill: true, ...splitConfig }` over two children whose `size` was
cleared. So the preview is one extra `strip.layout()` over two synthetic items
against the onto-child's rect, offset by its origin.

## `LayoutPreview` grows a split shape

```ts
export interface LayoutPreview {
  insertId: string;
  insertIndex?: number;
  cursor: { x: number; y: number };
  /**
   * Present when the drop splits `ontoId`'s slot instead of inserting a
   * sibling. `insertIndex` means nothing then — the parent's child list keeps
   * its length.
   */
  split?: {
    ontoId: string;
    edge: 'start' | 'end';
    axis: 'x' | 'y';
    config?: Record<string, unknown>;
  };
}
```

`config` is the prospective group's strategy config, which the host cannot
derive: `<DragProvider splitConfig>` holds it and `DragEngine` commits with it.
Passing it through is what makes the preview pixel-exact rather than
approximately half — a `gap` or `padding` in that config shifts both halves.

## The source leaves the parent, it does not join it

`runStrategyForContainer` splices the dragged node into `items` when `preview`
is set, so a strategy that ignores `preview` still gets the right child count.
A split inverts that rule, and getting it backwards is the trap in this change:

- **Cross-parent split.** The source is not a child. Nothing to do — but the
  existing code would splice it in, giving the parent one slot too many.
- **Same-parent split.** The source *is* a child, and post-drop it is not: it
  moves into the group. The existing code leaves it in place, giving the parent
  one slot too many again, so the onto-child's slot is measurably narrower than
  what the drop produces.

So on a split preview the adapter **removes** the source from `items` if
present, where an insert preview splices it in.

## `ContainerHost` overlays the interior

`#compute` runs the parent strategy as usual, then — when `preview.split` is
set — replaces two entries in `placements`:

1. Look up `SPLIT_STRATEGY_ID` (`'strip'`, the id `store.splitInto` hardcodes,
   now a shared export so the two cannot drift) in the registry.
2. Read the onto-child's rect out of the parent's `placements`.
3. Run that strategy over `[first, second]` — ordered by `edge` — against the
   slot's size with `{ axis, fill: true, ...config }`.
4. Offset both results by the slot origin and write them back.

`isPreview` is true only when this succeeds. A registry with no `strip`, or an
onto-child the parent did not place, traces and leaves the placements alone;
the drawn element still appears, so the preview degrades to today's behavior
rather than vanishing.

The affordances the interior run emits are discarded — the seam is not
draggable until the group exists, and drawing one that refuses the gesture is
worse than drawing none.

`strategy.getDropPreview`, the fast path in `#compute`, is skipped for a split
preview: it models one extra item in a child list, which is not what this is.

`setPreview`'s value-equality dedupe and `useContainerLayout`'s `previewKey`
both gain the split fields. Without that the host never invalidates when the
cursor crosses from one band to the other and the preview sticks.

The computation lives in `src/layout/split-preview.ts` as a pure function of
`(slot, sourceId, split, strategy)`. Nothing in `src/layout/` imports the
store, and this keeps it that way: `ContainerHost` does the registry lookup and
passes the strategy in.

## `<Container>`

`splitPreview` becomes `'none' | 'element' | 'layout'`, default `'layout'`.

Under `'layout'` the component builds the `split` bag from
`dragState.hover.intent` and hands it to `useContainerLayout`. It needs no new
render code: `renderEntries` already synthesizes an entry for a dragged node
that is not yet a child, and reads its rect from `layout.placements` — which
now holds the interior half.

The drawn element survives under `'layout'`, so the two modes differ only in
whether the onto-pane shrinks. A consumer who restyled
`.windease-split-preview` keeps that styling across the default change, which
is what makes flipping the default cheap. **Its geometry differs by mode**, and
this is the second trap:

- `'element'`: half of `placements.get(ontoId)`, which is the full slot.
- `'layout'`: `placements.get(insertId)` directly — the interior rect. Halving
  the onto-child's rect here would halve an already-halved pane.

`DragController` exposes the `splitConfig` it was constructed with as a public
readonly field, so `<Container>` reads the same object the engine will commit
with.

## Tests

Headless except where the gesture is the point.

- `splitPreviewPlacements`: both edges, both axes, `gap` honored, origin
  offset, affordances dropped, and a slot too small to halve.
- The adapter: a split preview removes a same-parent source from `items` and
  leaves a cross-parent one out; an insert preview still splices.
- `ContainerHost`: placements overlaid, `isPreview` true; a missing `strip` and
  an unplaced onto-child each leave placements untouched with `isPreview`
  false; `setPreview` dedupes on split fields and invalidates when the edge
  flips.
- `<Container>`: `'layout'` shrinks the onto-pane and places the source in the
  other half; `'element'` leaves the onto-pane full-size; `'none'` draws
  nothing; the element's rect is the interior one under `'layout'`.
- Ladle + Playwright in all three engines: hovering a pane's top edge halves
  that pane's rendered box and puts the source's placeholder above it,
  releasing produces exactly the previewed geometry, and Escape restores the
  original.

**Mutation-check every negative assertion** — break the behavior on purpose and
watch the test fail. Four passed vacuously in the drop-intent work.

## Not in this change

- **A preset split preview.** `<Zone>` / `<Panel>` still have no hit-test, so
  there is no intent to preview. Its own `TODO.md` entry.
- **A stack preview.** A stack drop leaves the onto-pane's box the same size
  and adds a tab strip the consumer draws, so a layout preview is nearly a
  no-op.
- **Per-container `splitConfig`.** The provider's is the one the engine
  commits with; forking them would need the engine to read a container's, which
  nobody has asked for.
