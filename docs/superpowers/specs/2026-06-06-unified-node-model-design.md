# Unified node model & recursive zones — design

## Context

windease v0.1 ships two structural primitives: `WindowRecord` (leaf renderable
with lifecycle/transit/focus FSMs) and `ZoneRecord` (ordered container with a
layout strategy). The split was clean for the original problem but is showing
strain:

- Recursive zones — Brainhouse's "child trays inside windows" — has no
  natural home. A window can't host children today.
- The `WindowRecord.meta` vs `ZoneItemMeta` distinction is documented as a
  naming trap in CLAUDE.md. The two share a name but have different
  lifetimes; the primitives don't carve at the joints they appear to.
- Future axes (resize, activity, groups) all face the same "should this be on
  the window or the zone?" question awkwardly.

This spec replaces the two-primitive split with a single `Node` type carrying
optional capability records, exposed to consumers through three named
constructors. Recursive zones fall out of the model without special-casing.

The decision to take on this refactor (vs. the lighter "window optionally
hosts a zone" composition path) was made explicitly with eyes-open about
migration cost — see "Rejected alternatives" at the end.

## Goals

1. One node type, capability records compose to express role.
2. Three named primitives — `Panel`, `Group`, `Zone` — that consumers
   construct via dedicated constructors. Closed `kind` enum.
3. Recursive containment works at any depth without per-level API.
4. Universal lifecycle FSM on every node; transit folded into slot; focus
   remains optional.
5. Snapshot v2 with one-way migration from v1.
6. Resolves the v0.1 followups around FSM-state re-renders, snapshot
   transit ignoring, hydrate version validation, and the
   `WindowRecord.meta` / `ZoneItemMeta` naming trap.

## Non-goals (v0.2)

- Groups with focus capability (deferred; flag-enabled later if needed).
- Per-node resize (separate capability, separate release).
- Activity-aware strategy inputs (roadmap item B, separate design).
- Workspace-level partitioning primitives.
- Keyboard-driven DnD equivalents (v0.3).
- DnD settle animations (consumer-side until further notice).
- Default chrome shipped with `@windease/react`.

## Data model

### One node type

```ts
type NodeId = string & { readonly __nodeId: unique symbol };

interface Node {
  id: NodeId;
  kind: 'panel' | 'group' | 'zone';
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  lifecycle: { state: 'mounted' | 'visible' | 'hidden' | 'destroyed' };

  container?: ContainerCap;
  slot?: SlotCap;
  focus?: FocusCap;
}

interface ContainerCap {
  strategyId: string;
  config: unknown;
  childIds: NodeId[];
  allowsPinning: boolean;
  state?: unknown;          // strategy reduce state, JSON-safe
}

interface SlotCap {
  parentId: NodeId;
  placement: Record<string, unknown>;   // per-membership; pinned/locked reserved
  transit: { state: 'idle' | 'claiming' | 'releasing' };
}

interface FocusCap {
  state: 'focused' | 'blurred';
}
```

### Identity collapse

`WindowId` and `ZoneId` become deprecated type aliases for `NodeId` in v0.2,
re-exported with `@deprecated` JSDoc. Removed in v0.3. Consumers get one
branded id type going forward.

### Capability rules

| Capability | Required on | Optional on | Absent on |
|---|---|---|---|
| `lifecycle` | every node (intrinsic) | — | — |
| `container` | `'zone'` | `'panel'`, `'group'` | — |
| `slot` | `'panel'`, `'group'` | — | `'zone'` |
| `focus` | — | `'panel'` (default present), future opt-in | `'group'`, `'zone'` (default) |

Validation: `registerNode` and `hydrate` both check that a node's `kind` is
consistent with its capability shape. Mismatch throws `KindShapeError`.

### Reserved keys on `slot.placement`

- `pinned: true` — promotes to pinned-prefix when parent's
  `allowsPinning` is true. No-op otherwise.
- `locked: true` — implies pinned at layout, AND React layer refuses to
  start a drag.

Library-owned. Consumers cannot redefine. Carried forward unchanged from
v0.1.

### Naming-trap resolution

Today's confused pair becomes:

- `node.meta` — intrinsic to the node, survives `moveNode`. Was
  `WindowRecord.meta`.
- `node.slot.placement` — per-membership, cleared on detach, not carried
  by `moveNode`. Was `ZoneItemMeta` / `itemMeta`.

Different paths, different words. The type system makes them
non-interchangeable.

## Named primitives

The three constructors below are the *only* supported way to create nodes
in v0.2. The store rejects hand-rolled `Node` literals whose shape doesn't
match their `kind`.

### `createZone`

```ts
function createZone(args: {
  id: NodeId;
  strategyId: string;
  config: unknown;
  allowsPinning?: boolean;   // default true
  meta?: Record<string, unknown>;
  hints?: NodeHints;
}): Node;
```

Produces a `'zone'` node: `container` populated, no `slot`, no `focus`,
`lifecycle.state = 'mounted'`. Workspace-level container. Top of the tree.

### `createGroup`

```ts
function createGroup(args: {
  id: NodeId;
  parentId: NodeId;
  strategyId: string;
  config: unknown;
  allowsPinning?: boolean;   // default true
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
}): Node;
```

Produces a `'group'` node: `container` + `slot` populated, no `focus`,
`lifecycle.state = 'mounted'`. Widget-shaped container — occupies one slot
in a parent, renders children inside. Draggable by virtue of having `slot`
(suppressed by `placement.locked`).

### `createPanel`

```ts
function createPanel(args: {
  id: NodeId;
  parentId: NodeId;
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  container?: {                  // optional → recursive panel
    strategyId: string;
    config: unknown;
    allowsPinning?: boolean;
  };
}): Node;
```

Produces a `'panel'` node: `slot` + `focus` populated,
`lifecycle.state = 'mounted'`, `focus.state = 'blurred'`. `container`
populated iff the consumer passed it (recursive panel hosting children).
This is today's `WindowRecord` plus optional recursion.

### Why closed constructors only

A single `createNode({ capabilities... })` form would force every consumer
to know the legal capability combinations. The three constructors *are*
the legal combinations, given names. Adding a fourth primitive later is an
additive change: new constructor, new `kind` enum value, store validator
updated. No low-level escape hatch in v0.2.

### Brainhouse's "tray inside window" call site

```ts
const trayHost = createPanel({
  id: trayHostId,
  parentId: workspaceZoneId,
  container: { strategyId: 'stack', config: { axis: 'vertical' } },
});
store.registerNode(trayHost);
store.registerNode(createPanel({ id: childA, parentId: trayHostId }));
store.registerNode(createPanel({ id: childB, parentId: trayHostId }));
```

Recursion to any depth works without a per-level API.

## Store API

### Storage

```ts
interface Store {
  nodes: Map<NodeId, Node>;
  rootIds: NodeId[];
  focusedId: NodeId | null;
  events: EventBus;
}
```

One map replaces `windows` + `zones`. `rootIds` is the ordered set of
top-level zones.

### Mutations

```ts
registerNode(node: Node): void;
unregisterNode(id: NodeId): void;

moveNode(id: NodeId, newParentId: NodeId, at?: number): void;
reorderInParent(id: NodeId, at: number): void;

setPlacement(id: NodeId, key: string, value: unknown): void;
patchPlacement(id: NodeId, patch: Record<string, unknown>): void;
setMeta(id: NodeId, patch: Record<string, unknown>): void;

updateContainerConfig(id: NodeId, patch: unknown): void;
setAllowsPinning(id: NodeId, allows: boolean): void;

showNode(id: NodeId): void;          // hidden → visible
hideNode(id: NodeId): void;          // visible → hidden

focusNode(id: NodeId): void;
blurAll(): void;
```

All node mutations are verbs on `Node`. No `Window`/`Zone` in method
names anywhere.

### Selectors

```ts
getNode(id: NodeId): Node | undefined;
getChildren(parentId: NodeId): readonly Node[];
getParent(id: NodeId): Node | undefined;
getAncestors(id: NodeId): readonly Node[];
isContainer(id: NodeId): boolean;
isSlotted(id: NodeId): boolean;
hasFocus(id: NodeId): boolean;
getContainerView(id: NodeId): ContainerView | null;
```

### Invariants enforced atomically

1. **Bidirectional parent ↔ child link.** `node.slot.parentId === P`
   iff `nodes[P].container.childIds` contains `node.id`.
2. **Pinned-prefix invariant.** For containers with `allowsPinning`,
   `childIds` is partitioned so pinned children precede unpinned.
   `reorderInParent` and `moveNode` clamp violating positions.
3. **Single-focus invariant.** At most one node has
   `focus.state === 'focused'`.
4. **Kind ↔ capability shape.** Validated at register and at hydrate.
5. **No cycles.** `moveNode` rejects new parents that are descendants
   of the moving node. Throws `CycleError`.
6. **Transit atomicity.** `moveNode` walks
   `idle → releasing → claiming → idle` within one mutation. External
   observers (beyond event subscribers) see only the final state.
7. **Panels must always be slotted.** Unowned panels are not allowed.
   `createPanel` requires `parentId`; `moveNode` cannot leave a panel
   parentless. Destroy cascades remove descendants rather than producing
   unowned panels.

### Destroy cascade

`unregisterNode(parentId)` on a non-empty container destroys all
descendants depth-first, leaves first. `node.unregistered` events fire
bottom-up. A `node.cascadeDestroyed` summary event fires after, then the
parent's own `node.unregistered`. Trace logs the descendant count.

Consumers who want to preserve a parent's children must move them out
first.

## FSMs

### Lifecycle (universal)

```
register → mounted → show → visible ↔ hidden → (unregister | cascade) → destroyed
                              hide
```

- `register` → `mounted`. Initial state.
- `showNode` / `hideNode` toggle visible ↔ hidden.
- Hidden children are excluded from layout. Strategies don't see them.
- `→ destroyed` is terminal. Destroyed nodes are removed from `nodes`
  after their event fires.

Applies to every node, regardless of kind. Zones and groups can be hidden
(collapsed sidebar, hidden tab strip) just like panels.

### Transit (folded into slot)

```
idle → releasing → claiming → idle
```

Walked atomically by `moveNode`. Reorders within a parent do not transit
— position changes only, ownership unchanged.

### Focus (optional)

```
blurred ↔ focused
```

- `focusNode(id)` on a node without focus capability throws
  `CapabilityMissingError`.
- Single-focus invariant: blur previous before focus new; both events in
  deterministic order.
- `unregisterNode` on the focused node implicitly blurs first.

### Unified transition event

```ts
{ type: 'node.transitioned';
  id: NodeId;
  machine: 'lifecycle' | 'transit' | 'focus';
  from: string;
  to: string;
}
```

Replaces v0.1's `window.transitioned`. Subscribers filter on `machine`.

### React re-render correctness

Record-replacement: every mutation that touches a node constructs a new
`Node` object (shallow spread, updated capability record), replacing the
entry in `nodes`. `useNode(id)` uses `useSyncExternalStore` with referential
equality; reference change → re-render.

```ts
function useNode(id: NodeId): Node | undefined {
  return useSyncExternalStore(store.subscribe, () => store.nodes.get(id));
}
function useNodeSelector<T>(id: NodeId, select: (n: Node) => T): T | undefined {
  return useSyncExternalStore(store.subscribe, () =>
    store.nodes.has(id) ? select(store.nodes.get(id)!) : undefined,
  );
}
```

Container `childIds` arrays replaced on insert/remove/reorder, not mutated
in place. Lint rule prevents in-place mutation in the store.

This fixes the v0.1 `useWindow(id)` no-re-render-on-FSM-state bug
structurally.

## Layout strategies

### Signature

Strategies remain pure functions:

```ts
type Strategy<Config, State> = {
  id: string;
  layout(args: {
    items: readonly LayoutNode[];
    container: ViewportRect;
    state: State;
    options: Config;
  }): LayoutResult;
  canAccept?(items: readonly LayoutNode[], options: Config): boolean;
  initialState?(items: readonly LayoutNode[]): State;
  reduce?(state: State, event: StrategyEvent, ctx: StrategyCtx<Config>): State;
  insertionIndex?(args: InsertionIndexArgs<Config>): number;
  parseConfig?(raw: unknown): Config;
  parseState?(raw: unknown): State;
};
```

### `LayoutItem` → `LayoutNode`

```ts
interface LayoutNode {
  id: NodeId;
  kind: 'panel' | 'group' | 'zone';
  hints: NodeHints;
  meta: Record<string, unknown>;
  placement: Record<string, unknown>;
  isContainer: boolean;
}
```

`placement` replaces what strategies saw as `LayoutItem.meta`. `meta` is
new but rarely needed. `isContainer` is the only recursion hint; most
strategies ignore it.

### Recursion is mount-time, not strategy-time

A strategy lays out the children it's handed. It does not recurse into
container-children. When a child is itself a container (`isContainer:
true`), the strategy treats it like any other slotted item — places it at
a rect with respect to its `hints`. The React `NodeRenderer` then mounts
the child's own strategy inside that rect, recursing as deep as the tree
goes.

Existing built-in strategies (grid, stack, strip, binarySplit,
recursiveSplit) work unchanged on recursive trees.

### `canAccept` and recursion

`canAccept(items, config)` runs on the prospective post-drop child list
of the target container. Recursion changes nothing — a drop into a
hosted container goes through the same validation as a drop into a
workspace container. Same `canAccept` hook; same capacity rules.

### Strategy config / state parsing

`parseConfig` and `parseState` are optional. Built-in strategies ship
them and gain hydrate-time validation against config typos. Consumer
strategies may omit them; the v0.1 cast-unchecked behavior is preserved
where parsers are absent. Required-on-built-ins, optional-on-consumer is
the explicit migration policy.

## React glue

### Components

```tsx
<Root store={store} chrome={{ panel, group, zone }} />
<NodeRenderer id={nodeId} />
```

`<Root>` renders `rootIds`, dispatching to chrome by kind.
`<NodeRenderer>` is the internal recursion primitive — looks up the node,
dispatches to registered chrome, renders container children if present.

### Chrome registration

Top-level map on `<Root>`. Each kind has one handler for the whole
tree. Consumers extend the map; library doesn't ship default chromes.

```tsx
const PanelChrome: ChromeHandler<'panel'> = ({ node, children }) => (
  <div className="panel">
    <Header node={node} />
    <Body>{node.meta?.body}</Body>
    {children && <Tray>{children}</Tray>}
  </div>
);
```

`children` is the already-rendered subtree (a fragment of `<NodeRenderer>`
calls placed at strategy-computed rects). `null` if the node has no
container capability. Same handler serves leaf panels and recursive
panels.

### Drag handle

Two surfaces, both no-op on `placement.locked === true`:

```ts
useDragHandle(nodeId: NodeId): GestureProps;        // hook form
<NodeDragHandle nodeId={id}>{children}</NodeDragHandle>   // component form
```

### Hooks

```ts
useNode(id): Node | undefined;
useNodeSelector(id, select): T | undefined;
useChildren(parentId): readonly Node[];
useFocusedNode(): Node | undefined;
useRootNodes(): readonly Node[];
useDragState(): DragState | null;
useDragHandle(nodeId): GestureProps;
```

### Layout invalidation

Strategies recompute when:

- `container.childIds` changes
- any child's `hints` change
- the container's `config` or viewport rect change
- a child's `lifecycle.state` flips visible ↔ hidden
- a child's `placement.pinned` changes

`NodeRenderer` derives a memo key from the inputs and re-invokes the
strategy when the key changes.

## Drag and drop

### Drag lifecycle

1. `pointerdown` on handle → capture begins, source `slot.transit`
   transitions `idle → releasing`, `dnd.dragStart` emitted.
2. `pointermove` → recursive hit-test (innermost wins), resolve
   insertion index in the deepest matching container, invoke
   `canAccept`, emit `dnd.hover`.
3. `pointerup` over accepted target → `moveNode(sourceId, targetId,
   insertionIndex)`, transit completes `releasing → claiming → idle`,
   `dnd.drop` emitted.
4. `pointerup` over rejected target / outside / escape → no store
   mutation, transit reverts `releasing → idle`, `dnd.cancel` emitted
   with reason `'rejected'` | `'outside'` | `'escape'`.
5. `unregisterNode` on the dragging node mid-drag → implicit cancel,
   reason `'unregistered'`.

### Hit-testing

Innermost-wins. A pointer over a hosted panel's tray hits the tray, not
the workspace zone behind it. No fall-through; if the deepest container
rejects, the drag is in a rejecting hover state. Consumer can visualize
the reject via `useDragState`.

### Cross-level moves

`moveNode` doesn't care about levels. Dragging out of a hosted tray into
a workspace zone is the same call as dragging within a workspace zone.
Transit FSM handles claim/release atomically. One `node.moved` event
fires with `fromParentId` ≠ `toParentId`.

### Pin-prefix interaction

While mid-drag the destination's prospective child list excludes the
dragging node. `canAccept` sees the post-insert list with pinned-prefix
applied. Positions that would violate the prefix snap silently to the
first valid index. (Affordance hint is consumer-side; TODO in v0.1
already.)

### Locked nodes

`useDragHandle` / `<NodeDragHandle>` no-op when `placement.locked ===
true`. No transit, no events. Matches today's locked semantics.

### Out of scope

- Multi-select / multi-drag.
- Keyboard equivalents (v0.3).
- Settle animations (consumer-side).
- Drop-to-form-group affordance (consumer recipe).

## Snapshot v2

### Shape

```ts
interface SnapshotV2 {
  version: 2;
  nodes: NodeRecord[];
  rootIds: NodeId[];
  focusedId: NodeId | null;
}

interface NodeRecord {
  id: NodeId;
  kind: 'panel' | 'group' | 'zone';
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  lifecycle: { state: 'mounted' | 'visible' | 'hidden' };  // 'destroyed' never serialized
  container?: {
    strategyId: string;
    config: unknown;
    childIds: NodeId[];
    allowsPinning: boolean;
    state?: unknown;
  };
  slot?: {
    parentId: NodeId;
    placement: Record<string, unknown>;
    // transit deliberately not serialized
  };
  focus?: { state: 'focused' | 'blurred' };
}
```

### Things deliberately not round-tripped

- `transit` state. Hydrate always initializes to `'idle'`. Resolves the
  v0.1 footnote "snapshot serializes transit but hydrate ignores it" by
  not serializing.
- `lifecycle: 'destroyed'`. Destroyed nodes are removed from `nodes`
  before serialization.
- Drag state. Not in the snapshot.

### Hydrate validation

1. Version validation. v1 → migrateV1ToV2. v2 → hydrateV2. Anything else
   throws `WindeaseError('unsupported-snapshot-version', ...)`.
2. Kind ↔ capability shape check.
3. Bidirectional parent ↔ child link check.
4. Cycle detection.
5. Pinned-prefix invariant — silently re-sorted from `placement.pinned`,
   trace fired (auto-repair, since order is recoverable).
6. Single-focus invariant — throws on multi-focus.
7. Strategy registration check — throws on unknown strategy id.
8. `parseConfig` / `parseState` invoked where present.

### v1 → v2 migration

- v1 zones become `'zone'` nodes.
- v1 windows become `'panel'` nodes parented to the zone whose
  `windowIds` contains them.
- v1 `itemMeta[windowId]` moves onto the child's `slot.placement`.
- **Unowned v1 windows are dropped with a `console.warn`.** v2 doesn't
  allow unowned panels. Inventing an orphan zone would silently mutate
  consumer intent.
- v1 `focusedWindowId` becomes `focusedId` only if the corresponding
  panel survived migration; otherwise null.
- Migration runs at hydrate. No separate migration step.

### Canonical direction

`store.snapshot()` always emits v2. No "snapshot as v1" mode. One-way
upgrade.

## Errors

Class hierarchy in `@windease/core`:

```ts
abstract class WindeaseError extends Error {
  abstract readonly code: string;
}

class NodeNotFoundError extends WindeaseError {
  readonly code = 'unknown-node';
  constructor(readonly id: NodeId) { super(`Unknown node: ${id}`); }
}

class DuplicateNodeError extends WindeaseError {
  readonly code = 'duplicate-id';
  constructor(readonly id: NodeId) { super(`Duplicate node id: ${id}`); }
}

class KindShapeError extends WindeaseError {
  readonly code = 'kind-shape-mismatch';
  constructor(
    readonly id: NodeId,
    readonly kind: Node['kind'],
    readonly violation: string,
  ) { super(`Node ${id} (kind=${kind}): ${violation}`); }
}

class CapabilityMissingError extends WindeaseError {
  readonly code = 'capability-missing';
  constructor(
    readonly id: NodeId,
    readonly capability: 'container' | 'slot' | 'focus',
    readonly operation: string,
  ) { super(`Operation ${operation} requires ${capability} capability on ${id}`); }
}

class CycleError extends WindeaseError {
  readonly code = 'cycle-detected';
  constructor(readonly nodeId: NodeId, readonly attemptedParentId: NodeId) {
    super(`Cannot move ${nodeId} under ${attemptedParentId}: cycle`);
  }
}

class StrategyRejectionError extends WindeaseError {
  readonly code = 'strategy-rejected';
  constructor(readonly parentId: NodeId, readonly reason?: string) {
    super(`Container ${parentId} rejected: ${reason ?? 'no reason given'}`);
  }
}

class InvariantViolationError extends WindeaseError {
  readonly code: string;
  constructor(code: string, message: string, readonly context: Record<string, unknown>) {
    super(message);
    this.code = code;
  }
}
```

Discipline:

- Never throw bare `Error` from `@windease/core`. Lint rule enforces.
- Never throw the abstract `WindeaseError` directly. Always a concrete
  subclass.
- Error messages are human-facing; `code` and typed fields are the API
  contract.
- `WindeaseError` itself is exported so consumers can write one top-level
  catch.

## Events

One unified bus per store: `store.events`. Subscribe by `type` or via
`'*'` catch-all.

```ts
type Event =
  | { type: 'node.registered'; id: NodeId }
  | { type: 'node.unregistered'; id: NodeId }
  | { type: 'node.transitioned'; id: NodeId; machine: 'lifecycle' | 'transit' | 'focus'; from: string; to: string }
  | { type: 'node.moved'; id: NodeId; fromParentId: NodeId | null; toParentId: NodeId; fromIndex: number; toIndex: number }
  | { type: 'node.reordered'; parentId: NodeId; id: NodeId; fromIndex: number; toIndex: number }
  | { type: 'node.placementChanged'; id: NodeId; changes: Record<string, { from: unknown; to: unknown }> }
  | { type: 'node.metaChanged'; id: NodeId; changes: Record<string, { from: unknown; to: unknown }> }
  | { type: 'node.cascadeDestroyed'; parentId: NodeId; descendantIds: readonly NodeId[] }
  | { type: 'container.configChanged'; id: NodeId; from: unknown; to: unknown }
  | { type: 'container.allowsPinningChanged'; id: NodeId; from: boolean; to: boolean }
  | { type: 'dnd.dragStart'; sourceId: NodeId; fromParentId: NodeId }
  | { type: 'dnd.hover'; sourceId: NodeId; targetId: NodeId | null; insertionIndex: number; accepted: boolean }
  | { type: 'dnd.drop'; sourceId: NodeId; toParentId: NodeId; toIndex: number }
  | { type: 'dnd.cancel'; sourceId: NodeId; reason: 'rejected' | 'escape' | 'outside' | 'unregistered' };
```

Ordering:

- Within a single mutation: events fire in causal order. For
  `moveNode(A, B, 2)` the sequence is the four `node.transitioned`
  (transit) events interleaved with one `node.moved`.
- Between mutations: synchronous. No batching across microtasks.

`node.placementChanged` and `node.metaChanged` are batched per mutation —
one event per call, multiple keys in `changes`.

For the destroy cascade, descendant `node.unregistered` events fire
bottom-up *first*, then `node.cascadeDestroyed` summarizes, then the
parent's `node.unregistered` fires last.

## Tracing

Categories defined in `packages/core/src/trace.ts`. v0.2 changes:

- **`zone` → `container` rename.** "Zone" no longer matches a structural
  role; container is the universal term. `'zone'` continues working as a
  deprecated alias for one minor version, then removed.
- New `store` lines for `registerNode`/`unregisterNode`, destroy cascade
  depth, kind-shape validation results, cross-level moves.
- New `layout` lines for container-child recursion: `"layout recursed
  into ${id} (${childCount} children)"`.
- All `dnd` lines from Section 7 (drag start, hover with accept flag,
  drop, cancel with reason).

No new "warnings" channel. Cascade destroy, hydrate auto-repair, and v1
migration drops all go through traces.

## Testing plan

### Store

- Constructor validation produces correctly-shaped nodes; bad inputs
  throw the right subclass.
- `registerNode` kind ↔ capability shape check rejects bad hand-rolled
  nodes.
- `moveNode` atomicity: transit transitions fire in order; intermediate
  state never externally observable.
- `moveNode` cycle detection throws `CycleError`.
- `unregisterNode` cascade: depth-first leaves-first ordering;
  bottom-up `node.unregistered` events; `node.cascadeDestroyed` summary;
  parent unregistered last.
- Pinned-prefix invariant under every mutation.
- Single-focus invariant.
- All-event-shapes test: trigger every mutation, assert event sequence
  exactly.

### FSMs

- Lifecycle: `register → mounted`, show/hide, cascade reaches destroyed.
- Transit: `moveNode` walks the full state sequence with events.
- Focus: capability-missing throws; unregister of focused blurs first.

### Strategies (parametrized)

Each built-in strategy runs against:

- Workspace-level container
- Hosted container inside a recursive panel
- ≥2-level recursion

Plus `canAccept` semantics and `insertionIndex` math.

### React layer

- `useNode(id)` re-renders on every node mutation (regression for v0.1
  bug).
- `useNodeSelector` re-renders only on slice change.
- Chrome dispatch routes by kind.
- Recursive panel renders `children` only when it has a container.
- `useDragHandle` no-ops on `locked: true`.

### DnD

- Full drag lifecycle end-to-end through transit.
- Innermost-wins hit-test across nested containers.
- Cross-level move emits one `node.moved` with differing parents.
- All cancel paths revert transit and clear state.

### Snapshot / hydrate

- v2 round-trip equality.
- v1 → v2 migration: every policy decision covered (unowned-window drop
  with warn, itemMeta relocation, lifecycle normalization, focused-id
  mapping).
- Hydrate validation: bad version throws, bad link throws, cycle throws,
  multi-focus throws, missing strategy throws.
- Hydrate auto-repair: pinned-prefix corruption silently fixed, trace
  fires.
- `parseConfig` runs at hydrate where present.

### Traces

A "trace catalog" test triggers each mutation and asserts the expected
trace lines exist by category and message format.

## Migration plan

### Order of work

1. **Land `Node` type and constructors.** Internal-only, parallel to
   `WindowRecord`/`ZoneRecord`. No public API change yet.
2. **Port store to unified `nodes` map.** Existing `windows`/`zones`
   maps become derived views. Tests keep passing throughout.
3. **Port strategies to `LayoutNode`.** Adapter wraps existing
   `LayoutItem` consumers during transition.
4. **Port React hooks/components to `useNode` family.** Old hooks become
   deprecated wrappers.
5. **Land DnD recursion changes.** Hit-test, transit, cross-level moves.
6. **Land snapshot v2 + migration.** Hydrate handles both v1 and v2 in
   parallel.
7. **Delete deprecated surfaces.** `WindowRecord`/`ZoneRecord` types,
   `useWindow`/`useZone` hooks, `registerWindow`/`registerZone`,
   `moveWindow`/`reorderInZone`. v0.3 boundary.

### Public-API breaking changes

- Type names: `WindowRecord` → `Node`, `ZoneRecord` → `Node`,
  `WindowId`/`ZoneId` → `NodeId` (deprecated aliases for v0.2).
- Method names: `registerWindow`/`registerZone` →
  `registerNode(createPanel(...))`/`registerNode(createZone(...))`,
  `moveWindow` → `moveNode`, `reorderInZone` → `reorderInParent`,
  `setItemMeta` → `setPlacement`, `setZoneAllowsPinning` →
  `setAllowsPinning`, `updateZoneConfig` → `updateContainerConfig`.
- Event names: `window.transitioned` → `node.transitioned`.
- Snapshot format: v1 hydrates via migration; new snapshots are v2.
- Strategy item type: `LayoutItem` → `LayoutNode` (rename + `meta`
  field added).
- Unowned windows no longer supported. Snapshot migration drops them
  with a warning.

### What does NOT break

- Strategy semantics for built-ins. Same layout math, same `canAccept`
  rules.
- Snapshot/hydrate consumer code, except v1 snapshots emit a one-time
  warning if they contained unowned windows.
- Pinned/locked reserved-key semantics on `placement`.
- Trace categories continue working (`zone` aliased to `container`).

## Rejected alternatives

### A. Composition path (window optionally hosts a zone)

Lighter refactor. `WindowRecord` gains `hostedZoneId?`, `ZoneRecord`
gains `host`. Brainhouse's tray semantics work; ~150 LOC of store
changes; no snapshot break.

**Why rejected:** Captures only the recursion symptom without addressing
the underlying primitive split that's already producing the
`WindowRecord.meta` / `ZoneItemMeta` confusion documented in CLAUDE.md.
Every future axis (resize, activity, groups) faces the same "window or
zone?" decision. The composition path's render-prop slot API for the
hosted-zone viewport reads as a code smell — symptom of primitives that
don't carve at the right joints. Doing the full refactor at v0.2 is the
cheapest moment in the library's life to take on this cost.

### C. ECS-style archetype registration

Maximum flexibility: consumers register their own node classes with
chosen capability bundles. No closed enum.

**Why rejected:** Ceremony out of proportion to current need. The three
named primitives cover Brainhouse's stated needs and the visible-roadmap
needs. Adding a fourth primitive later (a new constructor + enum value)
is additive; opening up to consumer-defined archetypes can be revisited
if multiple consumers demand it.

### Single low-level `registerNode({ kind, ... })` form alongside constructors

Considered exposing the raw-literal form for consumer flexibility.

**Why rejected for v0.2:** Less surface to support; constructors validate
shape at the type level. We can add the low-level form later if a real
need surfaces. Starting closed is the recoverable choice.

### Selector-only React subscription

Considered keeping in-place mutation and forcing all consumers to write
selectors.

**Why rejected:** Footgun. `useNode(id)` without a selector silently
fails to re-render — the exact v0.1 bug we're fixing. Record replacement
makes correct behavior the default; selectors remain available as an
opt-in optimization.

## Open questions

None at the time of writing. This spec is the source of truth for
implementation planning; if questions arise during implementation,
update this doc rather than leaving them unresolved.
