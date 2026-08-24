# Drop on a pane's edge to split it

For the person implementing this. Drag pane A over the top of pane B and
release: B's slot becomes a two-pane strip holding B and A. This specifies the
store operation that commits it, the props that turn it on, and what the drag
draws while it is deciding.

The hit-test is already built and is not re-argued here — see
[the drop-intent design](2026-08-22-drop-intent-design.md) for the five-zone
model and `resolveDropIntent`. Read [`docs/concepts.md`](../../concepts.md)
first if the four data buckets (`hints` / `container.config` / `node.meta` /
`membership.placement`) are unfamiliar.

## The gap

`resolveDropIntent` already answers `{ kind: 'split', ontoId, edge }` from the
cross-axis bands. `DragEngine.checkIntent` then rejects it unconditionally —
`split has no commit path` (`DragEngine.ts:372`) — so nothing emits one and
`<Container>` never carves the bands. Missing are the mutation, the props that
enable it, and something on screen saying which half A will take.

## `store.splitInto`

```ts
splitInto(
  sourceId: NodeId,
  ontoId: NodeId,
  opts: { id: NodeId; axis: 'x' | 'y'; edge: 'start' | 'end';
          config?: Record<string, unknown> } & MutateOptions,
): void
```

A new strip group with `{ axis, fill: true, ...config }` takes `ontoId`'s slot
— same parent, same index, inheriting its `placement` — and then `ontoId` and
`sourceId` become its children. `edge: 'start'` puts the source first.

Three things the mutation must get right, none of them visible in the shape:

- **`placement.size` is cleared on both children.** B's size was measured
  against the old parent's axis; the group inherits it, so the outer slot stays
  the width it was, but the same number left on B *inside* the group is read
  against the cross axis and is meaningless there. A carries the same staleness
  in from wherever it was dragged. `splitNode` does this already
  (`split.ts:353`); forgetting it produces a split that looks correct until you
  split a pane somebody had resized.
- **A pin transfers to the group**, mirroring `splitNode` (`split.ts:321,367`).
  The group occupies the slot now, so the group is the thing that is pinned.
- **`autoUnsplit` goes on the group**, so `coalesceParent` dissolves it when
  either child is dragged out and lifts the survivor back into the grandparent
  at the group's index. The gesture is undone by its own inverse with no new
  code.

`store.split` deliberately does *not* set `autoUnsplit`, and its docstring
calls collapsing a one-child strip "the consumer's call." The divergence is
justified: a programmatic split has a caller-supplied group id the caller may
be holding, while this group's id is minted by the engine and nobody has a
reference to it.

All validation runs **above** `transact`, which does not roll back — a callback
that throws partway leaves every mutation it already made. Checked first:
`opts.id` is not taken, both nodes have `membership`, the parent has a
`container`, `sourceId !== ontoId`, `ontoId` is not a descendant of `sourceId`,
and the locks — `move` on both nodes, `arrange` / `accept` / `dragOut` on the
parent, `dragOut` on the source's old parent. `showNode` the group. One
`transact` gives one undo step.

## The split intent carries its axis

`DropIntent` gains a field on the split variant:

```ts
| { kind: 'split'; ontoId: ItemId; edge: 'start' | 'end'; axis: 'x' | 'y' }
```

`axis` is **the strip axis of the group to create** — the cross axis of the
container that resolved the intent, not that container's own axis. Name it in
the doc comment, because the two are one flip apart and a reader will assume
the wrong one.

It has to travel on the intent because `<Container>` derives the axis at
hit-test time through a chain `splitInto` cannot reproduce: `cfg.axis`, falling
back to `axisFromRects` in flow mode, which is a *measurement*
(`Container.tsx:313`). Re-deriving it in the store would be a second
implementation that silently disagrees for flow containers. Additive — split
has never been emitted, so nothing observes the old shape.

## The engine

`checkIntent`'s split stub is replaced by the same four rejections the stack
branch already runs: onto-node is not the dragged node, no `lock.move` on the
onto-node, the onto-node is not a descendant of the dragged node, and the
parent is not order-controlled. The sets are identical, so the shared part
factors out rather than being written twice.

`drop()` gains a split branch that mints `split-N` through a `nextSplitId()`
mirroring `nextStackId()` (`DragEngine.ts:407`), calls `splitInto`, and traces
a failure rather than throwing out of a pointer handler.

`<DragProvider splitConfig>` merges into the created group's config, for the
same reason `stackConfig` exists: the drop happens in the engine, which never
sees the container. Nothing is required in it — strip's `resizable` already
defaults to `true` (`strip.ts:339`), so the new seam is draggable untouched.

## `<Container>` props

```ts
splitOnDrop?: boolean                  // default false
splitPreview?: 'none' | 'element'      // default 'element'
dropIntent?: (ctx: {
  rects: readonly { id: NodeId; rect: Rect }[];   // dragged node already removed
  point: Point;
  axis: 'x' | 'y';                                // this container's own axis
  sourceId: NodeId;
}) => DropIntent | undefined
```

`dropIntent` replaces the built-in resolver; the default remains
`resolveDropIntent(rects, point, axis, { stack: stackOnDrop, split: splitOnDrop })`.
`<Container>` keeps the measuring and the axis inference — the expensive parts,
and the easy ones to get wrong — and hands them over.

This is why no `band` prop ships. Band thickness is a fraction of the hovered
pane (`0.25`, clamped to `0.49`), which is a poor default at both extremes: 25%
of a 1200px pane is a 300px "edge", 25% of a 60px pane is 15px. A consumer who
cares writes one line, since `resolveDropIntent` is a public export:

```tsx
<Container dropIntent={({ rects, point, axis }) =>
  resolveDropIntent(rects, point, axis, { split: true, band: 0.4 })} />
```

Quadrant hit-tests, corner zones and refusing splits on small panes follow from
the same prop.

`splitPreview` is an enum rather than a boolean so `'layout'` can join it later
without a breaking change.

## The preview element

On an accepted split hover with `splitPreview: 'element'`, `<Container>`
renders a positioned `div.windease-split-preview` covering the half the source
would take, and `styles.css` gives it a default appearance beside
`.windease-insertion-line`. Consumers restyle by class; `'none'` suppresses it
for anyone drawing their own through `<DragProvider dragOverlay>`, whose
context already carries the intent.

Geometry comes from the onto-child's **placement**, not a DOM measurement —
that is the coordinate space `<Container>` is already rendering its children
in, and it avoids a second `getBoundingClientRect` per pointermove.

A split gets a drawn element where an insertion gets a live layout preview
(`Container.tsx:209`, `useContainerLayout.ts:84`) because `LayoutPreview` models
one extra item in a container's child list, and a split preview is a nested
group that does not exist yet. Filed in `TODO.md` as `[MED]`.

## Tests

Headless, except where the gesture is the point.

- `splitInto`: the wrap shape, index / placement / pin inheritance, both edge
  orderings, `size` cleared on both children, `autoUnsplit` set, one
  `transaction.begin` / `end` pair, and a rejected call leaving the tree
  byte-identical — the pre-transaction validation asserted as a fact rather
  than assumed.
- `resolveDropIntent`: `axis` on split intents is the container's cross axis,
  both cross bands resolve, and the existing equivalence sweep against
  `insertionIndexByMidpoint` still passes.
- `DragEngine`: split dispatch, each of the four rejections, and a controlled
  parent refusing a split.
- `<Container>`: a `dropIntent` prop overriding the default resolver,
  `splitPreview: 'none'` rendering no element, and preview geometry for both
  edges.
- One Ladle story, operable, driven in all three engines: a drop on a pane's
  top edge splits it, the new seam drags, dragging the pane back out dissolves
  the group, and a main-axis band still plain-inserts.

**Mutation-check every negative assertion.** Break the behaviour on purpose and
watch the test fail. Four passed vacuously in the drop-intent work.

## Not in this change

- **`splitPreview: 'layout'`** — the live layout preview insertion gets.
  Requires `LayoutPreview` to model a group that does not exist yet. `[MED]` in
  `TODO.md`.
- **Splitting under `<Zone>` / `<Panel>`.** `PresetShell` registers a drop
  target with no hit-test at all, which is why a preset drop has always
  appended. Fixing it fixes stacking and plain insertion too, so it is its own
  change with its own story; the `TODO.md` entry names both dependents.
- **Replacing the other hardcoded policies** — `chooseSuccessor`,
  `resolveNavigation`, a container's `canAccept`, edge-scroll tuning. `[MED]`
  in `TODO.md`; `dropIntent` is the third instance of a shape `overlay` and
  `affordances` already established.

## Decided here, and not visible in the diff

- **`splitInto` over `store.split` + `moveNode`.** `splitNode` mints a
  `kind: 'panel'` placeholder for every new half (`split.ts:358`), so the
  reuse path would create an empty pane and immediately destroy it to make room
  for A. `stackNodes` is the shape to copy instead.
- **The centre of a pane inserts when `splitOnDrop` is on and `stackOnDrop` is
  off**, because the centre band is only carved for stacking
  (`dropIntent.ts:82`). That is the model a consumer without tabs wants —
  edges split, everything else inserts — so the resolver is unchanged. Say it
  in the prop's doc comment; it is otherwise a surprise.
- **`<Container>` will carry two prop shapes for one idea.** `affordances`
  packs enable-and-replace into `boolean | fn`; split needs `stackOnDrop` and
  `splitOnDrop` as independent flags, so its replace-hook is a third prop
  rather than a union. Accepted, not overlooked.
