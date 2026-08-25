# A drop hit-test for the declarative presets

**What this is:** the design for making a drop on `<Zone>` / `<Panel>` resolve
where the cursor actually is, instead of appending.

**Who it's for:** whoever implements it.

**The question it answers:** `<Container>` resolves a cursor into an insertion
index, a stack, or a split. The presets resolve nothing — `PresetShell` registers
a drop target with no hit-test at all — so a preset drop has always appended, and
the two features built on drop intent do not exist under the declarative API.

## What already exists

`resolveDropIntent(rects, point, axis, options)` turns child rects and a cursor
into `insert` / `stack` / `split`. `<Container>` calls it from one effect
(`src/react/Container.tsx:337-380`) that harvests child rects with
`childRectsForContainer`, drops the dragged source from the list, and infers the
axis from `container.config`, from `axisFromRects` in flow mode, or from the
strategy id.

The commit path is already target-agnostic: `DragEngine.drop()` reads
`hover.intent` and calls `store.stackNodes` or `store.split`
(`src/dnd/DragEngine.ts:485`, `:496`). Nothing downstream of the hit-test knows
which component registered the target.

`PresetShell` calls `useDropTarget(id, wrapperRef, { enabled: acceptsDrops })`
(`src/react/presets.tsx:584`) and passes no `getInsertionIndex` and no
`getDropIntent`. That is the whole gap.

## What ships

**A shared hook.** `useDropIntentTarget(parentId, ref, opts)` in
`src/react/dnd/`, holding what `<Container>`'s effect holds today: harvest,
filter the source, infer the axis, then call the consumer's `dropIntent`
resolver or `resolveDropIntent` with `{ stack, split }`. Options are
`{ enabled, axis, strategyId, isFlow, stackOnDrop, splitOnDrop, dropIntent,
scrollEl, canAccept }`. `enabled: false` keeps `PresetShell`'s unconditional
call, which exists to hold hook order stable. `<Container>` calls the hook where
its effect is now; `useDropTarget` stays as the public consumer hook, unchanged.

**Two DOM attributes.** `childRectsForContainer` decides "direct chrome child"
by comparing the child's `parentElement`'s `data-node-container` against the
container's own. Presets set neither, so the comparison is `null === null` and
the harvest collects every nested `[data-node]` at any depth — a zone inside a
zone would hit-test against its grandchildren. So `PresetShell`'s wrapper carries
`data-node-container={id}` on the path that hosts a layout (`ZoneWithLayout` /
`PanelWithLayout` — a container capability with its strategy in scope), and `AbsoluteWrapper` carries
`data-node-container={parentId}` so a placed child's box names its owner.
Flow-mode children already sit directly inside the wrapper and match.

**Three preset props.** `<Zone>` and `<Panel container={…}>` grow `stackOnDrop`,
`splitOnDrop` and `dropIntent`, named as on `<Container>`. `acceptsDrops` stays
the gate: no preset becomes a drop target that was not one before.

No new resolver, no second hit-test, and no change to what a drop commits.

## Testing

- **Unit (jsdom):** a preset counterpart to `container.dropIntent.test.tsx` —
  stubbed child rects, asserting a seam resolves to an index, a centre to
  `stack`, an edge to `split`, and that a nested preset's grandchildren are not
  harvested.
- **Story:** `Declarative / DropIntent`, two `<Zone acceptsDrops stackOnDrop
  splitOnDrop>` with draggable panels — operable, not a render.
- **Browser:** `e2e/declarative-drop.spec.ts` across three engines: a drop into a
  seam lands at that index rather than appending, a centre drop stacks, an edge
  drop splits.
- **Regression:** the extraction is covered by the existing `<Container>` drop
  specs — `drop-on-edge`, `tab-stack`, `insertion`, `drag`.

## Traps

A consumer calling `useDropTarget` on a preset id now clobbers a real hit-test
rather than nothing, because child effects run before parent effects. This is the
hazard `Playground` and `ParallelZonesDnd` already document for `<Container>`;
what changes is the cost of hitting it.
