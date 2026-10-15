# Declarative presets

For whoever extends windease's layout vocabulary, and for anyone turning the Exotic presets into
canned presets a consumer can load.
**Status, 2026-10-15, read from the code: every key in the phase table is built except grid
`sticky`. Also unbuilt: `placement.share` taking an axis, dropping a child onto a chosen grid cell,
and inner config nested under `inner`. `allowsPinning` and `autoUnsplit` on a preset node are
built; Emacs's main split and Golden Layout's rows and columns set `autoUnsplit`. No
preset sets `zoom`, `drop`, pages, stack `tabs: 'stacked'` or floating `snap: 'fill'` yet. The
Firefox and Win 10 presets set `reorder`; every other grid preset, and the Exotic tree and desktop
stories, still wrap their tiles, panes and palette tabs in `DragHandle`.** The phase table at the end is the record of what exists.

An Exotic preset (`src/nuts/`) reproduces a real product's layout: Blender, Grafana,
Launchpad, Mac OS 9, i3, 75 in all. Today a preset states the layout as data and the story around
it wires the behavior by hand: dragging a window, raising it on click, tearing a tab out,
refusing a drop. The goal is that a preset states both, and a story draws chrome and nothing
else. Progress is measured in callback code deleted from `src/react/stories/Exotic*.stories.tsx`;
the work is done when no story wires a behavior a product in the corpus has.

## Where presets ship

Public, but not front and center: `windease/nuts` (Novel UI Torture Suite), a secondary entry point
beside the core, the way D3DX sat beside Direct3D. Consumers who want a product's layout import it
from there; the README and the core exports lead with the primitives, not the presets. Built
2026-09-19: the corpus moved from `src/test-utils/exotic/` to `src/nuts/`, and the entry point ships
the presets, the flat scenarios, the pathology corpora and the invariant checkers — running the
corpus against a strategy of your own is the point of it. The known-failure lists stayed behind in
the tests that own them.

## A preset is mechanics plus data

```ts
interface Preset {
  id: string; source: string; stress: string; description: string;
  viewport: Size;
  mechanics: PresetNode;   // the layout engine's decisions
  data?: PresetData;       // the content's decisions
}

interface PresetData {
  /** Per node: what the content contributes. */
  nodes?: Record<string, { meta?: Record<string, unknown>; hints?: { preferredSize?: Size };
                           className?: string }>;
  /** Children the content supplies to a container the mechanics declare. */
  children?: Record<string, PresetNode[]>;
  /** Styles scoped under the preset's root class, to look like the product. */
  css?: string;
}
```

**Which half a value belongs to.** Mechanics is what the product's layout engine decides, whatever
the user's content: strategy and config, floors and caps (`minSize`, `maxSize`), pins, spans,
cells, locks, strategy state, policies. Data is what the content decides: titles, an image's size,
how many apps are on a page, colors. Blender's 26px header floor is mechanics; the word
"Outliner" is data. Pinterest's `column` strategy and gap are mechanics; each pin's height is data.
Generated corpora (200 windows, 10,000 thumbnails) are data built by a function.

**Children that are content carry no mechanics.** Where a container's children are the user's
(tmux's panes, a desktop's windows, Grafana's panels), a mechanics container declares an
`item` template: the mechanics every content child gets (floors, spans, `drag`). A data child then
holds only what the content decides: its id, its title, a measured size, where the user left it.
Without the template, a data child is a whole node and its floors ride along as data.

`presetTree(preset)` merges the two into the node tree `presetToStore` and `presetScenario`
already take, so every consumer of a tree keeps working. The story tabs become
**Properties | JSX | Mechanics | Data**; the JSX listing shows the merged tree.

## Behavior is config

A policy is a named key in a container's `config` (or on a node), read by the core without a DOM.
No expressions, no conditionals: a key names one behavior, and anything a key cannot say stays a
callback. Keys are short verbs.

| Key | On | Does | Read by | Deletes story code in |
|---|---|---|---|---|
| `drag: true \| 'x' \| 'y'` | desktop child | Moves a window by its title band (`handleSize`), as floating's drag band does | desktop strategy: emits a `drag-xy` affordance, `dispatchAffordance` writes `x`/`y` | Desktop (pointer handlers) |
| `resize: true` | desktop child | Resizes a window from its edges and corner | desktop strategy affordances | — (new) |
| `raise: 'click' \| 'focus'` | container | Brings the clicked or focused child to the top of the stacking order | store, on `focusNode` | Desktop (`RaiseOnFocus`) |
| `layer: 'top'` | placement | Keeps a child above every child without it (GIMP's docks, palettes) | desktop, floating | — |
| `clamp: 'bar' \| 'all'` | container | Keeps a window's title band (or all of it) reachable | desktop | — |
| `overflow: 'clip' \| 'scroll'` | desktop config | Clips windows past the edge, or grows the scroll extent to reach them, left and top included. Default `'scroll'`, today's behavior | desktop, React extent | — (Amiga, Figma) |
| `minimize` toggle | desktop child | A stock action that flips `minimized` | desktop `dispatchAffordance` (`click` affordance) | Desktop (toggle) |
| `show: 'dropped'` | stack config | A child moved or dropped into the stack becomes the active tab | store `moveNode` | Trees (`node.moved` listener) |
| `fallback: 'next' \| 'prev' \| 'first'` | stack config | Which tab shows after the active one closes | store `unregisterNode` | — (Chrome) |
| `accepts: { kinds?, max? }` | container config | Refuses drops by kind or count, with no callback | DragEngine, before `acceptPolicy` | Grid (`refuseAtShell`) |
| `tear: 'float'` | stack config | Dragging a tab out onto a floating ancestor floats it at its tab's size; dropping it on a stack docks it | DragEngine + store | Desktop (Photoshop tear-out) |
| `zoom: id` | strip/stack config | One child fills the container; the rest keep their sizes to return to | strip, stack | — (tmux, Blender, i3) |
| `view: { x, y, scale }` | ContainerHost, not container state | Pan and zoom, with pointer deltas divided by `scale`; `fit` derives it from a designed `viewport` | ContainerHost, affordances, drop preview, focus geometry | — (Figma; lets a desktop fit the Ladle frame) |

## Strategy capabilities the corpus needs

These are config or placement keys on one strategy each.

| Capability | Key | Strategy | Presets |
|---|---|---|---|
| Explicit cell | `placement.cell: { col, row }` (built for layout; a move or reorder clears it, and nothing drops a child onto a chosen cell) | grid | Grafana, Android, periodic table, iOS 18 |
| Fixed-size cells, spaced out | `cell: { w, h }`, `justify` | grid | iOS dock, Win 8, Launchpad |
| Fractional sizes that survive a resize | `placement.share` — built as a bare number; the `{ w?, h? }` form, like `size`, is unbuilt and still wanted, since a pane moved to a split on the other axis reads its width fraction as a height | strip | i3, Golden Layout, Emacs, trading desk |
| Leftover space placement | `justify: 'start' \| 'center' \| 'end' \| 'between'` | strip, grid, column | Firefox, Pinterest, iOS dock |
| Size steps | `step` | strip | tmux, Emacs |
| Overshoot hides instead of destroying | `overshoot: 'join' \| 'hide'` | strip | VS Code |
| Sticky children while the rest scroll | `placement.sticky` | strip (built), grid (unbuilt) | Excel, Firefox pinned tabs |
| Track sizes | `tracks: { cols, rows }` (built); no `rowSize` key was built, `tracks.rows` sizes rows | grid | Grafana, Excel |
| Gravity | `compact: 'up'` | grid | Grafana |
| Pages | `pageStrategy(inner)` (built; see `2026-09-19-page-strategy-design.md`): page by `placement.page` or by `inner`'s `unplaced`. No preset uses it | wrapper over any strategy | Launchpad, Android, iOS |
| Stacked title bars; tab side | `tabs: 'stacked'`, `side`, `tabSize`; band reported as channels (built). No preset sets them; the i3 preset's stacked containers size `headerSize` instead | stack | i3, Golden Layout |
| Icon origin | `iconFrom` | desktop | Win 3.1, Mac OS 9, twm |
| Cascade wraps | `wrap: true` | desktop | cascade-200 |
| Snap fills a zone | `snap: 'corner' \| 'fill'` (built). The FancyZones preset sets `snapToPanes`, not `snap: 'fill'` | floating | FancyZones |
| Rotate, sort, height bound | `rotate`, `sort`, `overflowMode: 'unplaced'` | shelf, skyline, column | pallets, TexturePacker |
| Keep aspect; fluid columns | `hints.aspect`; column `cols` | hints, column | Unsplash, newspaper |
| Justified rows | new `justified` strategy | — | Flickr, Google Photos |
| Refuse a split below the floors | `strict: { size, minSize? }`, an option on the call, since the store holds no geometry (built) | `store.split`, `splitInto` | tmux, Emacs, Blender |
| Children reorder by drag, declared rather than wrapped in `DragHandle` | container `reorder: true \| 'handle'` (built); `'handle'` reads a `data-windease-handle` element. The Firefox and Win 10 presets set it; Chrome's does not, because its tabs are a stack's band, which the story draws, rather than children of a strip | React layer + DragEngine | Firefox tabs, Chrome tabs, Win 10 tiles |

## What the schema carries beyond today's

- `allowsPinning` and `autoUnsplit` on a container node. Built: `PresetNode` carries both, and
  `createNode` takes `autoUnsplit`. Golden Layout's translator sets both, but its collapse is not
  reachable by drag: Golden Layout removes a stack emptied by a drag, and windease has no key
  that removes an emptied container.
- Drop behavior now set by React props (`stackOnDrop`, `splitOnDrop`) moves into config as
  `drop: { stack?, split? }`, so a preset can say a group stacks on drop. The props stay and win. Built; no preset sets it.
- Per-view state (page) lives in container `state`, which snapshots already carry. Scroll and
  pan/zoom are the exception: they live on `ContainerHost`, because `state` belongs to the
  strategy (`setStrategy` drops it, `reduce` replaces it) and a fitted view is a fact about the
  screen, not the document. `zoom` is config instead, like stack's `activeId`: it names which
  child shows.
- Inner strategy config separates from the wrapper's: `desktop-shelf`'s `gap` belongs to shelf.
  Composite ids stay; their config nests under `inner`. Unbuilt: a composite still reads one flat
  config, the inner strategy's keys beside its own.

## Phases

| Phase | Contents | Status |
|---|---|---|
| 1 | Mechanics/data split and tabs; `drag`, `raise`, minimize toggle, `clamp`, `overflow` (desktop); `show`, `fallback` (stack); `accepts`; `drop` config; `placement.share`; grid `cell`, fixed cells, `justify`; child templates | built. `placement.share` is a bare number, not yet `{ w?, h? }`. Grid `cell` is read by layout only: a move or reorder clears it, and nothing drops a child onto a chosen cell. No preset sets `drop` |
| 2 | `tear`, `zoom`, `view` (pan/zoom, desktop fit), `sticky`, `step`, `overshoot`, `layer`, `resize` | built: `view`, `fit`, `tear`, `layer` (desktop, floating), `resize` (desktop), `step`, `overshoot`, `zoom` and strip `sticky`; grid `sticky` unbuilt. No preset sets `zoom` |
| 3 | Grid tracks, `compact`; `reorder`; stack `tabs`/`side`; desktop `iconFrom`, `wrap`; floating `snap`; `strict` split | built. The Firefox and Win 10 presets set `reorder`. No preset sets stack `tabs: 'stacked'` or `side`, or `snap: 'fill'` |
| 4 | Packer `rotate`/`sort`/height bound; `hints.aspect`; `justified` strategy; product-look CSS for every preset | built: packer `rotate`, `sort`, height bound (`overflowMode: 'unplaced'`), column `cols`/`justify`, `hints.aspect`, `justified`, product-look CSS for every preset |

Each key ships with its tests, a changelog entry, and the story code it replaces deleted in the
same change. A key that no preset uses yet does not ship; the keys the table marks as set by no
preset shipped ahead of that rule.
