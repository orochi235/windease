# Activity-aware strategy inputs — design

## Context

Roadmap item B from the windease v0.2 follow-on list. Brainhouse (and likely
other consumers) need a way to surface "this node is currently active" /
"this node just changed" signals to strategies — so layout can prioritize,
highlight, or surface based on user-domain activity.

The brainstorm narrowed to **consumer-pushed activity**: the library is a
bus; consumers decide what counts as activity. Update cadence is sparse
(discrete events — debounced to ≤1/sec; not per-frame signals like audio
levels). If a dense-signal use case ever arrives, we add a side-channel
capability without breaking this surface.

## Scope

- Add `activity` as an optional intrinsic field on `Node` — semantics mirror
  `meta` (survives `moveNode`).
- Add three store mutations: `setActivity`, `patchActivity`, `getActivity`.
- Emit `node.activityChanged` (batched per mutation; same shape as
  `node.metaChanged` / `node.placementChanged`).
- Surface `activity` to strategies via `LayoutNode.activity`.
- Round-trip activity through snapshot v2.
- React: `useActivity(id)` hook.

## Non-goals

- Library-side activity decay (consumer responsibility).
- Auto-setting activity on `focusNode` / `moveNode` / lifecycle transitions
  (different feature; would be "library-tracked recency," which we
  explicitly rejected in favor of consumer-defined semantics).
- Aggregating activity from children to parent (consumer's policy).
- Throttling / rate-limiting at the library layer.
- Activity capability records, FSMs, or transitions — it's just data.
- Dense / sub-second signals (would warrant a side-channel; not in scope).

## Data model

```ts
interface Node {
  id: NodeId;
  kind: NodeKind;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  lifecycle: LifecycleCap;
  container?: ContainerCap;
  slot?: SlotCap;
  focus?: FocusCap;
  activity?: Record<string, unknown>;   // NEW
}
```

Why a field, not a capability:

- No FSM, no structural relationship — there's nothing to wrap.
- Adding a capability would imply transitions / `transitioned` events the
  library would have to define semantics for. We don't want to.
- Field mirrors `meta`'s shape, so consumers already understand the
  pattern: free-form bag, intrinsic to the node, survives moves.

Why `Record<string, unknown>` not `unknown`:

- `unknown` is more flexible but consumers will end up wrapping objects
  anyway. Forcing the bag shape gives uniform merge-patch semantics and
  matches `meta` / `placement`.

## Store API

```ts
class WindeaseNodeStore {
  // ...

  setActivity(id: NodeId, value: Record<string, unknown>): void;
  patchActivity(id: NodeId, patch: Record<string, unknown>): void;
  getActivity(id: NodeId): Record<string, unknown>;
}
```

Semantics:

- `setActivity` replaces the entire bag. Passing `{}` is the canonical way
  to clear; the field is then omitted from snapshots.
- `patchActivity` merges; keys with `undefined` are deleted. Mirrors
  `patchPlacement` and `setMeta`.
- `getActivity` returns the current bag, or `{}` if unset.
- Record replacement: every mutation produces a fresh `Node` reference
  (same contract as every other mutation on the v0.2 store).
- Throws `NodeNotFoundError` if `id` is unknown.

## Events

```ts
type NodeStoreEvents = {
  // ...existing
  'node.activityChanged': {
    id: NodeId;
    changes: Record<string, { from: unknown; to: unknown }>;
  };
};
```

- Batched per mutation: one event per `setActivity` / `patchActivity` call,
  multiple keys collected into `changes`.
- A `setActivity` that wholesale replaces fires one event with every
  changed key (added, removed, modified).
- No event if the patch yields zero changes.

Subscribers filter on `'node.activityChanged'` like any other store event.

## Strategies — `LayoutNode`

```ts
interface LayoutNode {
  id: string;
  kind: 'panel' | 'group' | 'zone';
  hints: { /* ... */ };
  meta: Record<string, unknown>;
  placement: Record<string, unknown>;
  isContainer: boolean;
  activity: Record<string, unknown>;   // NEW — always present (defaults to {})
}
```

`nodeToLayoutNode(node)` and the v0.1-style `runStrategyForContainer`
adapter both populate `activity` from `node.activity ?? {}`. Strategies
read it as opaque data:

```ts
// Example consumer strategy using activity
function activityPromotingGrid({ items, /* ... */ }) {
  const sorted = [...items].sort((a, b) => {
    const aTime = (a.activity.lastAt as number) ?? 0;
    const bTime = (b.activity.lastAt as number) ?? 0;
    return bTime - aTime;
  });
  // ... lay out `sorted`
}
```

Built-in strategies don't read `activity` — it's there for consumer
strategies to layer their own semantics.

## Snapshot

`SerializedNodeV2` gains an optional `activity` field, parallel to `meta`:

```ts
interface SerializedNodeV2 {
  // ...existing
  activity?: Record<string, unknown>;
}
```

`serializeNodes` includes it iff non-empty. `hydrateFromV2` restores it
verbatim. v1 → v2 migration leaves it absent (v1 has no analogue).

## React

```ts
function useActivity(id: NodeId): Record<string, unknown> | undefined;
```

Returns `node.activity` or `undefined` if the node has no activity bag.
Uses `useSyncExternalStore`; re-renders when `node.activityChanged` fires
for `id`.

`useNodeSelector(id, n => n.activity?.busy)` remains available for narrow
subscriptions.

## Trace

Mutations log under the existing `'store'` category — no new trace
category needed. Format:

```
[windease:store] activity: ${id} changed: ${Object.keys(changes).join(',')}
```

## Error handling

- `setActivity` / `patchActivity` on a missing node → `NodeNotFoundError`.
- No `CapabilityMissingError` paths — activity is universal (every node
  can have it, even zones).

## Migration

Purely additive on the v0.2 surface:

- Existing `Node` instances without `activity` keep working unchanged
  (field is optional).
- Existing snapshots round-trip unchanged.
- Existing strategies that only read `meta` / `placement` keep working.
- New strategies opt in by reading `LayoutNode.activity`.

No v0.1 changes. v0.1 store has no activity concept.

## Test plan

- Store: `setActivity` replaces, `patchActivity` merges + deletes,
  `getActivity` default `{}`, `node.activityChanged` event batched per
  mutation, no-op patches don't emit, record replacement happens.
- LayoutNode: `nodeToLayoutNode` populates `activity`; `runStrategyForContainer`
  passes it through.
- Snapshot: round-trip including activity; omit when empty; v1→v2 migration
  yields no activity field.
- React: `useActivity` returns current bag and re-renders on change.
- Integration: a consumer strategy that sorts by `activity.lastAt` produces
  expected placements after activity mutations.

## Open questions

None. Spec is implementation-ready.
