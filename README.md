# windease

Browser-based window manager. Framework-agnostic core (`@windease/core`) plus
a React binding (`@windease/react`).

> **Playground:** every strategy and DnD path lives in the Ladle playground
> at <https://orochi235.github.io/windease/>.
>
> The unified `Node` model with three named primitives (`Panel`, `Group`,
> `Zone`) is the primary surface. The legacy v0.1 surface
> (`WindeaseStore`, `WindowRecord`, `ZoneRecord`, `Zone`, `Workspace`,
> `useWindow`, …) remains exported as `@deprecated`; new code targets the
> v0.2 API documented below. See [`docs/concepts.md`](docs/concepts.md) for
> the canonical vocabulary.

- **Three named primitives** — `createZone`, `createGroup`, `createPanel`
  — produce typed nodes with the right capability shape for their role.
- **Recursive zones** — a `Panel` can host a `container`, making "tray
  inside a window" a one-call composition.
- **Universal lifecycle.** Every node carries an FSM
  (`mounted → visible ↔ hidden → destroyed`); panels additionally carry
  `transit` (atomic moves) and `focus` (single-focus invariant).
- **Record replacement.** Every store mutation produces a fresh `Node`
  reference; React's `useSyncExternalStore` invalidates correctly by
  default.
- **Snapshot v2** with one-way migration from the v0.1 format.
- **Layout strategies** are pure functions. Built-ins: `grid`, `stack`,
  `strip`, `binarySplit`, `recursiveSplit`. Strategies work unchanged on
  recursive trees via the `LayoutNode` adapter.

## Usage (v0.2 / current)

```tsx
import {
  asNodeId,
  createZone,
  createPanel,
  gridStrategy,
  stackStrategy,
  WindeaseNodeStore,
} from '@windease/core';
import {
  NodeContainer,
  StrategyRegistryProvider,
  WindeaseNodeProvider,
} from '@windease/react';

const store = new WindeaseNodeStore();
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
}));
store.showNode(asNodeId('tray'));
store.showNode(asNodeId('leaf'));

const chrome = {
  zone: ({ children }) => <div className="my-zone">{children}</div>,
  group: ({ node, children }) => <div className="my-group">{children}</div>,
  panel: ({ node, children }) =>
    node.container
      ? <div className="my-tray">
          <h4>{String(node.meta?.title)}</h4>
          <NodeContainer parentId={node.id} chrome={chrome} />
        </div>
      : <div className="my-leaf">{String(node.meta?.title ?? node.id)}</div>,
};

<WindeaseNodeProvider store={store}>
  <StrategyRegistryProvider strategies={{ grid: gridStrategy, stack: stackStrategy }}>
    <NodeContainer parentId={asNodeId('z')} chrome={chrome} viewport={{ w: 720, h: 480 }} />
  </StrategyRegistryProvider>
</WindeaseNodeProvider>
```

See the **Recursive Zones** Ladle story for a working example you can
manipulate live.

Import the baseline stylesheet once at the top of your app:

```ts
import '@windease/react/styles.css';
```

It supplies the structural rules `.windease-zone`, `.windease-window`, and
the insertion-line affordance default. All visual styling is yours.

## Drag and drop

DnD is opt-in. Wrap your panel chrome in `<NodeDragHandle>`, register each
container as a drop target with `useNodeDropTarget(zoneId, ref)`, and put
the tree under `<NodeDragProvider>`. The drag controller honors:

- `slot.placement.locked` — per-child drag suppression.
- `container.allowsDragOut` — zone-level drag suppression.
- `container.allowsDrop` — zone-level drop refusal.
- The destination strategy's `canAccept(prospective-items, options)` — e.g.
  `binarySplit` refuses anything that wouldn't leave exactly two children.
- An optional consumer-supplied `canAccept(sourceId)` on the drop target.

See the **Parallel zones / Drag between** story for the canonical setup.

## Resize

Pass `affordances` to `<NodeContainer>` to render the strategy's interactive
gutters. `binarySplit` and `recursiveSplit` ship draggable gutters out of
the box; their state persists on `node.container.state` and survives
snapshot/hydrate. Per-child `hints.minSize` is honored as a pixel floor so
manual gutter drags can't push a panel below its declared minimum. The
default 4px gutter ships with an 8px-wide hit area (`affordanceHitPad`).

## Migrating from v0.1

The v0.1 API (`WindeaseStore`, `WindowRecord`, `ZoneRecord`, `Zone`,
`Workspace`, `useWindow`, etc.) remains exported under `@deprecated` and
works unchanged. The v0.2 mapping:

| v0.1                          | v0.2                                            |
| ----------------------------- | ----------------------------------------------- |
| `WindeaseStore`               | `WindeaseNodeStore`                             |
| `WindowRecord` / `WindowId`   | `Node` (kind `'panel'`) / `NodeId`              |
| `ZoneRecord` / `ZoneId`       | `Node` (kind `'zone'`) / `NodeId`               |
| `WindowRecord.meta`           | `node.meta` (intrinsic, survives `moveNode`)    |
| `ZoneItemMeta`                | `node.slot.placement` (per-membership)          |
| `registerZone(input)`         | `registerNode(createZone(args))`                |
| `createWindow` + `claim`      | `registerNode(createPanel(args))`               |
| `moveWindow(id, zoneId, at?)` | `moveNode(id, parentId, at?)`                   |
| `reorderInZone(id, order)`    | `reorderInParent(id, at)`                       |
| `setItemMeta` / `patchItemMeta` | `setPlacement` / `patchPlacement`             |
| `updateZoneConfig`            | `updateContainerConfig`                         |
| `setZoneAllowsPinning`        | `setAllowsPinning`                              |
| `useWindow(id)`               | `useNode(id)` (fixes FSM re-render bug)         |
| `useZone(id)`                 | `useNode(id)`                                   |
| `useItemMeta(z, w)`           | `useNodeSelector(id, n => n.slot?.placement)`   |
| `useWindowsByZone(zoneId)`    | `useChildren(parentId)`                         |
| `Workspace` / `Zone`          | `NodeContainer` + chrome map                    |

Snapshots round-trip: `deserializeToNodeStore(snap)` accepts both v1 and
v2 shapes. Unowned v1 windows are dropped on migration with a
`console.warn`.

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
