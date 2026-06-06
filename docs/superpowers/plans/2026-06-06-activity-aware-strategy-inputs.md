# Activity-aware strategy inputs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `activity` bag to v0.2 `Node` so consumers can push sparse, user-domain activity signals (e.g. "this panel is busy", "this panel last spoke at T") through the store → strategy pipeline.

**Architecture:** Purely additive on the v0.2 surface. `Node.activity?: Record<string, unknown>` is a new intrinsic field (lifetime mirrors `meta`). Three new store mutations (`setActivity`/`patchActivity`/`getActivity`) wrap record replacement and emit a new batched `node.activityChanged` event. `nodeToLayoutNode` adds `activity: { ... }` to `LayoutNode`. Snapshot v2 gains an optional `activity` field round-tripped iff non-empty. React adds `useActivity(id)`.

**Tech Stack:** TypeScript, Vitest, React 18 (`useSyncExternalStore`). Monorepo: `packages/core` (store, snapshot, layout types/adapter), `packages/react` (hooks).

**Source spec:** `docs/superpowers/specs/2026-06-06-activity-aware-strategy-inputs-design.md`

---

## File Structure

**Create:**
- (none — all additions land in existing files)

**Modify:**
- `packages/core/src/node.ts` — add optional `activity` field to `Node`
- `packages/core/src/store-v2.ts` — add `setActivity`/`patchActivity`/`getActivity`, `node.activityChanged` event
- `packages/core/src/store-v2.test.ts` — coverage for the above
- `packages/core/src/layout-types.ts` — add `activity: Record<string, unknown>` to `LayoutNode`
- `packages/core/src/layout-node-adapter.ts` — populate `activity` in `nodeToLayoutNode`
- `packages/core/src/layout-node-adapter.test.ts` — coverage for activity passthrough
- `packages/core/src/snapshot-v2.ts` — add optional `activity` to `SerializedNodeV2`; serialize when non-empty; hydrate verbatim
- `packages/core/src/snapshot-v2.test.ts` — round-trip + omit-when-empty + v1 migration leaves it absent
- `packages/react/src/v2/hooks.ts` — add `useActivity(id)`
- `packages/react/src/v2/hooks.test.tsx` (if missing, see Task 7) — coverage for `useActivity`
- `packages/react/src/v2/index.ts` — export `useActivity`

---

## Task 1: Add `activity` field to the Node type

**Files:**
- Modify: `packages/core/src/node.ts:36-46`

- [ ] **Step 1: Add the optional field**

Open `packages/core/src/node.ts` and add `activity?: Record<string, unknown>;` to the `Node` interface, placed after `meta?` to mirror its scope:

```ts
export interface Node {
  id: NodeId;
  kind: NodeKind;
  meta?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  hints?: NodeHints;
  lifecycle: LifecycleCap;

  container?: ContainerCap;
  slot?: SlotCap;
  focus?: FocusCap;
}
```

- [ ] **Step 2: Build core**

Run: `npm run -w @windease/core build` (or the repo's equivalent — fall back to `npm run -w @windease/core typecheck` if no build script).
Expected: PASS, no type errors. `Node` consumers downstream (validators, constructors, adapters) ignore the new optional field, so nothing should break.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/node.ts
git commit -m "feat(core): add optional Node.activity field for consumer-pushed activity signals"
```

---

## Task 2: Add `node.activityChanged` event and store mutations

**Files:**
- Modify: `packages/core/src/store-v2.ts:13-49` (NodeStoreEvents)
- Modify: `packages/core/src/store-v2.ts:386-449` (insert activity block near meta block)
- Test: `packages/core/src/store-v2.test.ts:279-308` (add new describe near meta tests)

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block at the end of `packages/core/src/store-v2.test.ts`. The existing test helpers (`fresh`, `id`, `createZone`, `createPanel`) are already imported at the top of the file — re-use them.

```ts
describe('WindeaseNodeStore — activity', () => {
  it('getActivity returns {} when unset', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    expect(s.getActivity(id('z'))).toEqual({});
  });

  it('setActivity replaces the entire bag and emits a single event', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.patchActivity(id('z'), { busy: true, count: 1 });
    const cb = vi.fn();
    s.events.on('node.activityChanged', cb);
    s.setActivity(id('z'), { lastAt: 1000 });
    expect(s.getActivity(id('z'))).toEqual({ lastAt: 1000 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toEqual({
      id: id('z'),
      changes: {
        busy: { from: true, to: undefined },
        count: { from: 1, to: undefined },
        lastAt: { from: undefined, to: 1000 },
      },
    });
  });

  it('setActivity({}) clears the bag', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.patchActivity(id('z'), { busy: true });
    s.setActivity(id('z'), {});
    expect(s.getActivity(id('z'))).toEqual({});
    expect(s.getNode(id('z'))?.activity).toBeUndefined();
  });

  it('patchActivity merges; undefined keys delete', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    const cb = vi.fn();
    s.events.on('node.activityChanged', cb);
    s.patchActivity(id('z'), { busy: true, count: 1 });
    expect(s.getActivity(id('z'))).toEqual({ busy: true, count: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0].changes).toEqual({
      busy: { from: undefined, to: true },
      count: { from: undefined, to: 1 },
    });
    s.patchActivity(id('z'), { busy: undefined });
    expect(s.getActivity(id('z'))).toEqual({ count: 1 });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]?.[0].changes).toEqual({
      busy: { from: true, to: undefined },
    });
  });

  it('no-op patches do not emit', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.patchActivity(id('z'), { busy: true });
    const cb = vi.fn();
    s.events.on('node.activityChanged', cb);
    s.patchActivity(id('z'), { busy: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('no-op setActivity (same keys + values) does not emit', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    s.setActivity(id('z'), { busy: true });
    const cb = vi.fn();
    s.events.on('node.activityChanged', cb);
    s.setActivity(id('z'), { busy: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('produces a fresh Node reference on change', () => {
    const s = fresh();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    const before = s.getNode(id('z'));
    s.patchActivity(id('z'), { busy: true });
    const after = s.getNode(id('z'));
    expect(after).not.toBe(before);
  });

  it('throws NodeNotFoundError when node is missing', () => {
    const s = fresh();
    expect(() => s.setActivity(id('missing'), { x: 1 })).toThrow(NodeNotFoundError);
    expect(() => s.patchActivity(id('missing'), { x: 1 })).toThrow(NodeNotFoundError);
  });

  it('getActivity on a missing node returns {}', () => {
    const s = fresh();
    expect(s.getActivity(id('missing'))).toEqual({});
  });
});
```

`NodeNotFoundError` is already imported at the top of `store-v2.test.ts` for other tests. If not, add it to the existing import block from `./errors.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/store-v2.test.ts -t activity`
Expected: FAIL — `s.getActivity is not a function`, etc.

- [ ] **Step 3: Extend NodeStoreEvents**

In `packages/core/src/store-v2.ts`, add the new event in the `NodeStoreEvents` interface, placed alongside `node.metaChanged`:

```ts
'node.activityChanged': {
  id: NodeId;
  changes: Record<string, { from: unknown; to: unknown }>;
};
```

- [ ] **Step 4: Implement the three mutations**

Insert this block in `packages/core/src/store-v2.ts` immediately after the `getMeta` method (i.e. after the existing `// ===== Placement / meta =====` section, before `// ===== Container config =====`). Add a new section header `// ===== Activity =====`:

```ts
// ===== Activity =====

setActivity(id: NodeId, value: Record<string, unknown>): void {
  const node = this.requireNode(id);
  const prev = node.activity ?? {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  // Removed keys (in prev, not in value)
  for (const k of Object.keys(prev)) {
    if (!(k in value)) changes[k] = { from: prev[k], to: undefined };
  }
  // Added/modified keys
  for (const [k, v] of Object.entries(value)) {
    if (prev[k] !== v) changes[k] = { from: prev[k], to: v };
  }
  if (Object.keys(changes).length === 0) return;
  const nextActivity = Object.keys(value).length === 0 ? undefined : { ...value };
  this.replaceNode(id, (n) => {
    const next = { ...n };
    if (nextActivity === undefined) delete next.activity;
    else next.activity = nextActivity;
    return next;
  });
  this.events.emit('node.activityChanged', { id, changes });
  trace('store', `activity: ${id} changed: ${Object.keys(changes).join(',')}`);
  this.scheduleNotify();
}

patchActivity(id: NodeId, patch: Record<string, unknown>): void {
  const node = this.requireNode(id);
  const prev = node.activity ?? {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const next: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    const from = prev[k];
    if (v === undefined) {
      if (k in next) {
        delete next[k];
        changes[k] = { from, to: undefined };
      }
    } else if (from !== v) {
      next[k] = v;
      changes[k] = { from, to: v };
    }
  }
  if (Object.keys(changes).length === 0) return;
  const nextActivity = Object.keys(next).length === 0 ? undefined : next;
  this.replaceNode(id, (n) => {
    const out = { ...n };
    if (nextActivity === undefined) delete out.activity;
    else out.activity = nextActivity;
    return out;
  });
  this.events.emit('node.activityChanged', { id, changes });
  trace('store', `activity: ${id} changed: ${Object.keys(changes).join(',')}`);
  this.scheduleNotify();
}

getActivity(id: NodeId): Record<string, unknown> {
  return this.nodesMap.get(id)?.activity ?? {};
}
```

Note: `setActivity` and `patchActivity` must throw `NodeNotFoundError` for an unknown id (handled by `this.requireNode`). `getActivity` is read-only and intentionally returns `{}` for a missing id rather than throwing — this mirrors `getMeta` / `getPlacement` semantics already in this file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/store-v2.test.ts -t activity`
Expected: PASS — all 9 activity tests green.

Also run the full store-v2 test file to confirm nothing else broke:

Run: `npx vitest run packages/core/src/store-v2.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store-v2.ts packages/core/src/store-v2.test.ts
git commit -m "feat(core): add setActivity/patchActivity/getActivity + node.activityChanged event"
```

---

## Task 3: Surface `activity` on `LayoutNode`

**Files:**
- Modify: `packages/core/src/layout-types.ts:24-35`
- Modify: `packages/core/src/layout-node-adapter.ts:28-37`
- Test: `packages/core/src/layout-node-adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append the following to `packages/core/src/layout-node-adapter.test.ts`. The test file already imports `createZone`, `createPanel`, `WindeaseNodeStore`, `nodeToLayoutNode`, `runStrategyForContainer`, `asNodeId`, etc. — re-use them.

```ts
describe('layout-node-adapter — activity passthrough', () => {
  it('nodeToLayoutNode populates activity (defaults to {})', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    const before = nodeToLayoutNode(store.getNode(asNodeId('p'))!);
    expect(before.activity).toEqual({});

    store.patchActivity(asNodeId('p'), { busy: true, lastAt: 42 });
    const after = nodeToLayoutNode(store.getNode(asNodeId('p'))!);
    expect(after.activity).toEqual({ busy: true, lastAt: 42 });
  });

  it('runStrategyForContainer exposes activity to LayoutNodes (via getLayoutNodes)', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('p2'), parentId: asNodeId('z') }));
    store.showNode(asNodeId('p1'));
    store.showNode(asNodeId('p2'));
    store.patchActivity(asNodeId('p2'), { lastAt: 100 });
    const nodes = getLayoutNodes(store, asNodeId('z'));
    expect(nodes.map((n) => n.activity)).toEqual([{}, { lastAt: 100 }]);
  });
});
```

If `getLayoutNodes` isn't already imported in this test file, add it to the import line:

```ts
import { getLayoutNodes, nodeToLayoutItem, nodeToLayoutNode, runStrategyForContainer } from './layout-node-adapter.js';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/layout-node-adapter.test.ts -t "activity passthrough"`
Expected: FAIL — `LayoutNode.activity` undefined / not in result.

- [ ] **Step 3: Extend `LayoutNode`**

In `packages/core/src/layout-types.ts`, add the new property to `LayoutNode`:

```ts
export interface LayoutNode {
  id: string;
  kind: 'panel' | 'group' | 'zone';
  hints: {
    minSize?: Size;
    preferredSize?: Size;
    order?: number;
  };
  meta: Record<string, unknown>;
  placement: Record<string, unknown>;
  isContainer: boolean;
  activity: Record<string, unknown>;
}
```

- [ ] **Step 4: Populate it in `nodeToLayoutNode`**

In `packages/core/src/layout-node-adapter.ts`, update `nodeToLayoutNode` to spread `node.activity`:

```ts
export function nodeToLayoutNode(node: Node): LayoutNode {
  return {
    id: node.id,
    kind: node.kind,
    hints: { ...(node.hints ?? {}) },
    meta: { ...(node.meta ?? {}) },
    placement: { ...(node.slot?.placement ?? {}) },
    isContainer: !!node.container,
    activity: { ...(node.activity ?? {}) },
  };
}
```

`getLayoutNodes` delegates to `nodeToLayoutNode` so it picks up the field automatically.

`runStrategyForContainer` uses the legacy `LayoutItem` shape and does NOT pass activity — that's deliberate: activity is a v0.2 concept and only flows through `LayoutNode`. Strategies that want it must consume `LayoutNode`s via `getLayoutNodes` directly. No change needed to `runStrategyForContainer`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/layout-node-adapter.test.ts`
Expected: PASS — including the new "activity passthrough" tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/layout-types.ts packages/core/src/layout-node-adapter.ts packages/core/src/layout-node-adapter.test.ts
git commit -m "feat(core): surface Node.activity on LayoutNode"
```

---

## Task 4: Round-trip `activity` through snapshot v2

**Files:**
- Modify: `packages/core/src/snapshot-v2.ts:11-33` (SerializedNodeV2)
- Modify: `packages/core/src/snapshot-v2.ts:46-84` (serializeNodes) — write activity when non-empty
- Modify: `packages/core/src/snapshot-v2.ts:201-240` (buildNodeFromSerialized) — restore activity
- Test: `packages/core/src/snapshot-v2.test.ts`

- [ ] **Step 1: Write the failing tests**

Append the following at the end of `packages/core/src/snapshot-v2.test.ts`. The file already imports `WindeaseNodeStore`, `createZone`, `createPanel`, `serializeNodes`, `deserializeToNodeStore`, `migrateV1ToV2`, `asNodeId` — re-use them.

```ts
describe('snapshot v2 — activity', () => {
  it('round-trips activity verbatim', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.patchActivity(asNodeId('p'), { busy: true, lastAt: 1234 });
    const snap = serializeNodes(store);
    const pSerialized = snap.nodes.find((n) => n.id === 'p')!;
    expect(pSerialized.activity).toEqual({ busy: true, lastAt: 1234 });

    const hydrated = deserializeToNodeStore(snap);
    expect(hydrated.getActivity(asNodeId('p'))).toEqual({ busy: true, lastAt: 1234 });
  });

  it('omits activity from snapshot when empty', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    const snap = serializeNodes(store);
    expect(snap.nodes.find((n) => n.id === 'p')!.activity).toBeUndefined();
  });

  it('omits activity after setActivity({}) clears it', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    store.patchActivity(asNodeId('p'), { busy: true });
    store.setActivity(asNodeId('p'), {});
    const snap = serializeNodes(store);
    expect(snap.nodes.find((n) => n.id === 'p')!.activity).toBeUndefined();
  });

  it('v1 → v2 migration leaves activity absent', () => {
    const v1: SerializedStore = {
      version: 1,
      zones: [
        {
          id: 'z',
          strategyName: 'grid',
          config: {},
          windowIds: ['p'],
          allowsPinning: true,
          itemMeta: {},
        },
      ],
      windows: [
        {
          id: 'p',
          zoneId: 'z',
          lifecycle: 'visible',
          focus: 'blurred',
        } as SerializedWindow,
      ],
    };
    const migrated = migrateV1ToV2(v1);
    const p = migrated.nodes.find((n) => n.id === 'p')!;
    expect(p.activity).toBeUndefined();
  });
});
```

If `SerializedStore` and `SerializedWindow` aren't already imported, add them to the existing import line from `@windease/core` (or relative path) at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/snapshot-v2.test.ts -t activity`
Expected: FAIL — `pSerialized.activity` undefined after `patchActivity`.

- [ ] **Step 3: Extend `SerializedNodeV2`**

In `packages/core/src/snapshot-v2.ts`, add `activity?: Record<string, unknown>;` to the `SerializedNodeV2` interface, parallel to `meta?`:

```ts
export interface SerializedNodeV2 {
  id: string;
  kind: NodeKind;
  meta?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  hints?: {
    minSize?: { w: number; h: number };
    preferredSize?: { w: number; h: number };
    order?: number;
  };
  lifecycle: 'mounted' | 'visible' | 'hidden';
  container?: { /* unchanged */ };
  slot?: { /* unchanged */ };
  focus?: { state: 'focused' | 'blurred' };
}
```

(Keep the existing `container`/`slot`/`focus` field bodies as they are — the diff only adds the `activity?` line.)

- [ ] **Step 4: Write activity in `serializeNodes`**

In `packages/core/src/snapshot-v2.ts`, inside the per-node loop in `serializeNodes` (right after the existing `if (node.meta && …) out.meta = …` line, before the `if (node.hints …)` line), add:

```ts
if (node.activity && Object.keys(node.activity).length > 0) out.activity = { ...node.activity };
```

- [ ] **Step 5: Restore activity in `buildNodeFromSerialized`**

In `packages/core/src/snapshot-v2.ts`, in `buildNodeFromSerialized`, immediately after the existing `if (sn.meta) node.meta = { ...sn.meta };` line, add:

```ts
if (sn.activity) node.activity = { ...sn.activity };
```

`migrateV1ToV2` requires no change — v1 has no activity concept, so the field correctly stays absent.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/snapshot-v2.test.ts`
Expected: PASS — all four new activity tests plus existing snapshot tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/snapshot-v2.ts packages/core/src/snapshot-v2.test.ts
git commit -m "feat(core): round-trip Node.activity through snapshot v2"
```

---

## Task 5: Add `useActivity` React hook

**Files:**
- Modify: `packages/react/src/v2/hooks.ts`
- Modify: `packages/react/src/v2/index.ts` (export `useActivity`)
- Test: `packages/react/src/v2/hooks.test.tsx` (create if absent — see Step 1)

- [ ] **Step 1: Locate or create the v2 hooks test file**

First, check if `packages/react/src/v2/hooks.test.tsx` exists:

Run: `ls packages/react/src/v2/hooks.test.tsx 2>/dev/null && echo EXISTS || echo MISSING`

If `MISSING`, create it with this header so the tests below have a place to live:

```tsx
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createPanel, createZone, WindeaseNodeStore } from '@windease/core';
import { WindeaseNodeProvider } from './NodeProvider.js';
import { useActivity } from './hooks.js';

function withStore(store: WindeaseNodeStore, ui: React.ReactNode) {
  return <WindeaseNodeProvider store={store}>{ui}</WindeaseNodeProvider>;
}
```

(If the file exists, you'll see existing imports — re-use them and only add the `useActivity` import.)

- [ ] **Step 2: Write the failing tests**

Append to `packages/react/src/v2/hooks.test.tsx`:

```tsx
describe('useActivity', () => {
  it('returns undefined when no activity is set', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    let observed: Record<string, unknown> | undefined = { sentinel: true };
    function Probe() {
      observed = useActivity(asNodeId('p'));
      return null;
    }
    render(withStore(store, <Probe />));
    expect(observed).toBeUndefined();
  });

  it('returns the activity bag and re-renders on change', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    const seen: Array<Record<string, unknown> | undefined> = [];
    function Probe() {
      seen.push(useActivity(asNodeId('p')));
      return null;
    }
    render(withStore(store, <Probe />));
    act(() => {
      store.patchActivity(asNodeId('p'), { busy: true });
    });
    expect(seen[seen.length - 1]).toEqual({ busy: true });
    act(() => {
      store.patchActivity(asNodeId('p'), { busy: undefined });
    });
    expect(seen[seen.length - 1]).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/react/src/v2/hooks.test.tsx -t useActivity`
Expected: FAIL — `useActivity is not a function` or missing export.

- [ ] **Step 4: Implement the hook**

In `packages/react/src/v2/hooks.ts`, append:

```ts
export function useActivity(id: NodeId): Record<string, unknown> | undefined {
  const store = useNodeStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(id)?.activity,
  );
}
```

The existing top-of-file imports (`Node`, `NodeId`, `useSyncExternalStore`, `useNodeStore`) already cover everything we need.

- [ ] **Step 5: Export from the v2 barrel**

In `packages/react/src/v2/index.ts`, add `useActivity` to the named export from `./hooks.js`:

```ts
export {
  useNode,
  useNodeSelector,
  useChildren,
  useFocusedNode,
  useRootNodes,
  useActivity,
} from './hooks.js';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/react/src/v2/hooks.test.tsx`
Expected: PASS — including the two new useActivity tests.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/v2/hooks.ts packages/react/src/v2/hooks.test.tsx packages/react/src/v2/index.ts
git commit -m "feat(react): add useActivity hook for v0.2 node activity bag"
```

---

## Task 6: Integration smoke — a consumer strategy sorts by activity

**Files:**
- Test: `packages/core/src/v02.integration.test.ts` (append to existing file)

This task locks in the spec's "Test plan → Integration" item: a consumer strategy that reads `LayoutNode.activity` produces expected placements after activity mutations. Lightweight — no new public surface.

- [ ] **Step 1: Write the failing test**

Append at the end of `packages/core/src/v02.integration.test.ts`. The file already imports `WindeaseNodeStore`, the constructors, `asNodeId`, and `getLayoutNodes` (verify and add if missing).

```ts
describe('integration: activity-aware consumer strategy', () => {
  it('sorts children by activity.lastAt descending', () => {
    const store = new WindeaseNodeStore();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('c'), parentId: asNodeId('z') }));
    store.showNode(asNodeId('a'));
    store.showNode(asNodeId('b'));
    store.showNode(asNodeId('c'));

    store.patchActivity(asNodeId('a'), { lastAt: 10 });
    store.patchActivity(asNodeId('b'), { lastAt: 30 });
    store.patchActivity(asNodeId('c'), { lastAt: 20 });

    const layoutNodes = getLayoutNodes(store, asNodeId('z'));
    const sorted = [...layoutNodes].sort((x, y) => {
      const xt = (x.activity.lastAt as number) ?? 0;
      const yt = (y.activity.lastAt as number) ?? 0;
      return yt - xt;
    });
    expect(sorted.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run packages/core/src/v02.integration.test.ts -t "activity-aware"`
Expected: PASS (Task 3 already made this code path work; this test is the explicit integration-level guard).

- [ ] **Step 3: Run all tests to confirm no regressions**

Run: `npm test` (or repo equivalent: `npx vitest run`)
Expected: PASS across `@windease/core` and `@windease/react`.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/v02.integration.test.ts
git commit -m "test(core): integration coverage for activity-aware consumer strategy"
```

---

## Task 7: Build and final sanity check

- [ ] **Step 1: Build both packages**

Run: `npm run build` (or `npx tsc -b` at repo root if there's no aggregate build script)
Expected: PASS, no type errors.

- [ ] **Step 2: Confirm public surface**

Verify exports from `@windease/core` (existing `packages/core/src/index.ts` already re-exports `WindeaseNodeStore` and `LayoutNode` — both gain the new field/methods automatically) and `@windease/react/v2` (now exports `useActivity`).

Run: `node -e "const c = require('./packages/core/dist/index.js'); const s = new c.WindeaseNodeStore(); console.log(typeof s.setActivity, typeof s.patchActivity, typeof s.getActivity)"`
Expected: `function function function`

- [ ] **Step 3: Final commit if anything bookkeeping changed**

If no further file changes resulted from build, skip. Otherwise:

```bash
git add -A
git commit -m "chore: rebuild after activity feature"
```

---

## Self-review pass

Cross-check each spec section vs. tasks:

- **Data model (`Node.activity`)** → Task 1. ✓
- **Store API (`setActivity`/`patchActivity`/`getActivity`)** → Task 2. ✓
- **Events (`node.activityChanged`, batched per mutation, no event on no-op)** → Task 2 tests cover both. ✓
- **Replace produces fresh Node ref** → Task 2 ("produces a fresh Node reference on change"). ✓
- **NodeNotFoundError on missing id** → Task 2. ✓
- **`getActivity` defaults to `{}`** → Task 2. ✓
- **`LayoutNode.activity` always present, defaults to `{}`** → Task 3 ("activity passthrough"). ✓
- **`nodeToLayoutNode`/`getLayoutNodes` populate activity** → Task 3. ✓
- **`SerializedNodeV2.activity` optional; serialized iff non-empty; round-trips** → Task 4. ✓
- **v1 → v2 migration leaves activity absent** → Task 4. ✓
- **`useActivity(id)` hook returning bag-or-undefined; re-renders on event** → Task 5. ✓
- **Trace under `'store'` category, format `activity: ${id} changed: …`** → Task 2 (`trace('store', …)` calls in both mutations). ✓
- **No new error path (`CapabilityMissingError` not needed)** → confirmed in Task 2 implementation. ✓
- **Integration: consumer strategy sorts by `activity.lastAt`** → Task 6. ✓
- **Non-goals** (no library decay, no auto-set on focus/move, no parent aggregation, no rate-limiting, no FSM) — none of these are introduced; verified by absence of touchpoints in `focusNode`/`moveNode`. ✓
