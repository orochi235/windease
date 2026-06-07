# windease

Browser-based window manager. One package, two entry points: a
framework-agnostic core (`windease`) and React bindings (`windease/react`).

```sh
npm install windease
```

React bindings peer-depend on `react@^19` (declared optional — install only
if you import from `windease/react`).

> **Playground:** every strategy and DnD path lives in the Ladle playground
> at <https://orochi235.github.io/windease/>.
>
> **API reference:** TypeDoc-generated reference at
> <https://orochi235.github.io/windease/api/>.

See [`docs/concepts.md`](docs/concepts.md) for the canonical vocabulary
(what's a window vs. zone vs. workspace, which of the four state buckets
owns what, and how reserved keys like `pinned` / `locked` interact with
layout and DnD).

- **Node + capabilities, not classes.** Every node optionally carries
  `container` / `slot` / `focus` / `lifecycle`. The core enforces only
  structural invariants (no cycles, single focus, bidirectional links).
  `Panel` / `Group` / `Zone` are convention names with shipped presets,
  not built-in types.
- **Recursive containers** — any node with a `container` capability hosts
  children, and a child may itself be a container. "Tray inside a window"
  is just a panel whose `container` is set.
- **Universal lifecycle.** Every node carries an FSM
  (`mounted → visible ↔ hidden → destroyed`); panels additionally carry
  `transit` (atomic moves) and `focus` (single-focus invariant).
- **Record replacement.** Every store mutation produces a fresh `Node`
  reference; React's `useSyncExternalStore` invalidates correctly by
  default.
- **JSON-safe snapshots** via `serialize(store)` / `deserialize(snap)`.
- **Layout strategies** are pure functions. Built-ins: `gridStrategy`,
  `stackStrategy`, `stripStrategy`, `splitStrategy` (binary by default,
  recursive when `recursive: true` in config). Strategies work unchanged
  on recursive trees via the `LayoutNode` adapter.

## Usage

```tsx
import {
  asNodeId,
  createPanel,
  createZone,
  gridStrategy,
  stackStrategy,
  Store,
} from 'windease';
import {
  Container,
  Panel,
  StrategyRegistryProvider,
  Provider,
  Zone,
} from 'windease/react';

const store = new Store();
store.registerNode(createZone({
  id: asNodeId('z'),
  strategyId: 'grid',
  config: { cols: 2, gap: 12 },
}));
store.registerNode(createPanel({
  id: asNodeId('tray'),
  parentId: asNodeId('z'),
  meta: { title: 'Tray' },
  container: { strategyId: 'stack', config: { axis: 'vertical' } },
}));
store.registerNode(createPanel({
  id: asNodeId('leaf'),
  parentId: asNodeId('tray'),
  meta: { title: 'Leaf' },
}));
store.showNode(asNodeId('tray'));
store.showNode(asNodeId('leaf'));

// Chrome dispatches on node.kind (set by the createPanel/createZone presets).
// `panel` handlers can opt into recursion by mounting Container themselves.
const chrome = {
  zone: ({ children }) => <Zone>{children}</Zone>,
  panel: ({ node }) => {
    const title = String(node.meta?.title ?? node.id);
    if (node.container) {
      return (
        <Panel title={title}>
          <Container parentId={node.id} chrome={chrome} />
        </Panel>
      );
    }
    return <Panel title={title} />;
  },
};

<Provider store={store}>
  <StrategyRegistryProvider strategies={{ grid: gridStrategy, stack: stackStrategy }}>
    <Container parentId={asNodeId('z')} chrome={chrome} viewport={{ w: 720, h: 480 }} />
  </StrategyRegistryProvider>
</Provider>
```

`<Panel>`, `<Group>`, `<Zone>` are minimal styled wrappers — pass
`className`/`style` to override, or write your own chrome handlers
directly. Chrome can be either a `Record<string, ChromeHandler>` keyed
on `node.kind` (as above) or a single `(args) => ReactNode` function.

See the **Recursive Zones** Ladle story for a working example you can
manipulate live.

Import the baseline stylesheet once at the top of your app:

```ts
import 'windease/styles.css';
```

It supplies the structural rules `.windease-zone`, `.windease-window`, and
the insertion-line affordance default. All visual styling is yours.

## Drag and drop

DnD is opt-in. Wrap your panel chrome in `<DragHandle>`, register each
container as a drop target with `useDropTarget(zoneId, ref)`, and put
the tree under `<DragProvider>`. The drag controller honors:

- `slot.placement.locked` — per-child drag suppression.
- `container.allowsDragOut` — zone-level drag suppression.
- `container.allowsDrop` — zone-level drop refusal.
- The destination strategy's `canAccept(prospective-items, options)` — e.g.
  `splitStrategy` with `recursive: false` refuses anything that wouldn't
  leave exactly two children.
- An optional consumer-supplied `canAccept(sourceId)` on the drop target.

See the **Parallel zones / Drag between** story for the canonical setup.

## Resize

Pass `affordances` to `<Container>` to render the strategy's interactive
gutters. `splitStrategy` ships draggable gutters out of the box (binary
by default; pass `recursive: true` for arbitrary trees). State persists
on `node.container.state` and survives snapshot/hydrate. Per-child
`hints.minSize` is honored as a pixel floor so manual gutter drags can't
push a panel below its declared minimum. The default 4px gutter ships
with an 8px-wide hit area (`affordanceHitPad`).

## Develop

```bash
npm install
npm test
npm run build
npm run lint
npm run ladle    # opens the playground at http://localhost:61000/
```

Design / planning docs live under `docs/superpowers/`. Canonical reference:
[`docs/concepts.md`](docs/concepts.md).
