# Subtree serialize and graft — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host serialize one node and its descendants, and graft that snapshot back under a named parent, without carrying the whole store.

**Architecture:** Both halves live in `src/snapshot.ts` beside the existing whole-store pair. `serialize` gains an optional `{ root }` and emits the same v5 shape with one extra optional field, `rootPlacement`. A new `graft` reuses the existing migration chain and node builder, validates everything before it mutates, and runs inside `store.transact` so it is one undo step. Three helpers get extracted from code that already exists (`serializeNode`, `parseSnapshot`, `validateSnapshotLinks`) so the new path shares them rather than restating them.

**Tech Stack:** TypeScript, vitest (headless — no jsdom), biome. Spec: `docs/superpowers/specs/2026-08-21-subtree-serialize-graft-design.md`.

**Read first:** `docs/concepts.md` for the `container` / `membership` distinction and the reserved placement keys. The word "root" is overloaded in this plan: a *store* root is a node with no `membership`; a *snapshot* root is whatever `rootIds` names. A subtree snapshot's root is the second kind — it has a parent in the live store but not inside the snapshot.

**Verification note:** run `npm test 2>&1 | tail -20` **never** as `npm test | tail -20`. Piping without `2>&1` hides a nonzero exit and reads as a pass — this bit the previous workstream repeatedly.

---

### Task 1: Extract `serializeNode` from the whole-store loop

Pure refactor. No behavior change, no new test — the existing `src/snapshot.test.ts` is the regression net.

**Files:**
- Modify: `src/snapshot.ts:51-90`

- [ ] **Step 1: Confirm the baseline is green**

Run: `npm test 2>&1 | tail -20`
Expected: all tests pass. Note the total count; you will compare against it.

- [ ] **Step 2: Lift the loop body into a function**

Insert above `serialize`, then replace the body of the `for` loop with a call to it.

```ts
function serializeNode(node: Node): SerializedNode {
  const out: SerializedNode = {
    id: node.id,
    lifecycle: node.lifecycle.state as 'mounted' | 'visible' | 'hidden',
  };
  if (node.kind !== undefined) out.kind = node.kind;
  if (node.meta && Object.keys(node.meta).length > 0) out.meta = { ...node.meta };
  if (node.activity && Object.keys(node.activity).length > 0) out.activity = { ...node.activity };
  if (node.hints && Object.keys(node.hints).length > 0) out.hints = { ...node.hints };
  if (node.order !== undefined) out.order = node.order;
  if (node.container) {
    const c: SerializedNode['container'] = {
      strategyId: node.container.strategyId,
      config: node.container.config,
      childOrder: [...node.container.childOrder],
      allowsPinning: node.container.allowsPinning,
    };
    if (node.container.state !== undefined) c.state = node.container.state;
    out.container = c;
  }
  if (node.membership) {
    out.membership = {
      parentId: node.membership.parentId,
      placement: { ...node.membership.placement },
    };
  }
  if (node.focus) {
    out.focus = { state: node.focus.state };
  }
  if (node.lock && Object.keys(node.lock).length > 0) out.lock = { ...node.lock };
  return out;
}
```

`serialize`'s loop becomes:

```ts
  for (const node of store.nodesTruth.values()) {
    if (node.lifecycle.state === 'destroyed') continue;
    nodes.push(serializeNode(node));
  }
```

- [ ] **Step 3: Verify nothing moved**

Run: `npm test 2>&1 | tail -20`
Expected: same pass count as Step 1.

- [ ] **Step 4: Commit**

```bash
git add src/snapshot.ts
git commit -m "extract serializeNode from the whole-store serialize loop"
```

---

### Task 2: `serialize(store, { root })` collects a subtree

**Files:**
- Modify: `src/snapshot.ts`
- Create: `src/snapshot.subtree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { NodeNotFoundError } from './errors.js';
import { asNodeId } from './node.js';
import { serialize } from './snapshot.js';
import { Store } from './store.js';

/** root `z` → `a` (container, holds `a1`, `a2`) and `b`. */
function buildTree(): Store {
  const s = new Store();
  s.registerNode(
    createNode({ id: asNodeId('z'), kind: 'zone', container: { strategyId: 'strip', config: { axis: 'x' } } }),
  );
  s.registerNode(
    createNode({
      id: asNodeId('a'),
      kind: 'group',
      parentId: asNodeId('z'),
      placement: { size: { w: 300 } },
      container: { strategyId: 'strip', config: { axis: 'y' } },
    }),
  );
  s.registerNode(createNode({ id: asNodeId('a1'), kind: 'panel', parentId: asNodeId('a'), meta: { title: 'one' } }));
  s.registerNode(createNode({ id: asNodeId('a2'), kind: 'panel', parentId: asNodeId('a') }));
  s.registerNode(createNode({ id: asNodeId('b'), kind: 'panel', parentId: asNodeId('z') }));
  return s;
}

describe('serialize with { root }', () => {
  it('includes only the named node and its descendants', () => {
    const snap = serialize(buildTree(), { root: asNodeId('a') });
    expect(snap.nodes.map((n) => n.id).sort()).toEqual(['a', 'a1', 'a2']);
    expect(snap.rootIds).toEqual(['a']);
    expect(snap.version).toBe(5);
  });

  it('drops the root membership and records its placement separately', () => {
    const snap = serialize(buildTree(), { root: asNodeId('a') });
    const root = snap.nodes.find((n) => n.id === 'a');
    expect(root?.membership).toBeUndefined();
    expect(snap.rootPlacement).toEqual({ size: { w: 300 } });
  });

  it('keeps descendant membership intact', () => {
    const snap = serialize(buildTree(), { root: asNodeId('a') });
    expect(snap.nodes.find((n) => n.id === 'a1')?.membership?.parentId).toBe('a');
  });

  it('throws when the named root does not exist', () => {
    expect(() => serialize(buildTree(), { root: asNodeId('nope') })).toThrow(NodeNotFoundError);
  });

  it('is unchanged when no root is given', () => {
    const s = buildTree();
    expect(serialize(s)).toEqual(serialize(s, {}));
    expect(serialize(s).nodes).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: FAIL — `serialize` takes one argument, and `rootPlacement` is not on `SerializedStore`.

- [ ] **Step 3: Add the field, the options type, and the subtree walk**

Add `NodeNotFoundError` to the existing import from `./errors.js`, and `NodeId` to the import from `./node.js`.

Add to `SerializedStore`:

```ts
  /**
   * Present only on a subtree snapshot: the placement the root held in the
   * parent it was serialized out of. `graft` restores it; `deserialize`
   * ignores it, since a store root has no parent to be placed in.
   */
  rootPlacement?: Record<string, unknown>;
```

Add the options type and rewrite `serialize`:

```ts
export interface SerializeOptions {
  /** Serialize only this node and its descendants. */
  root?: NodeId;
}

export function serialize(store: Store, opts?: SerializeOptions): SerializedStore {
  if (opts?.root !== undefined) return serializeSubtree(store, opts.root);
  const nodes: SerializedNode[] = [];
  for (const node of store.nodesTruth.values()) {
    if (node.lifecycle.state === 'destroyed') continue;
    nodes.push(serializeNode(node));
  }
  return {
    version: 5,
    nodes,
    rootIds: [...store.rootIdsTruth],
    focusedId: store.focusedIdTruth,
  };
}

function serializeSubtree(store: Store, rootId: NodeId): SerializedStore {
  const root = store.getNodeTruth(rootId);
  if (!root) throw new NodeNotFoundError(rootId);

  const nodes: SerializedNode[] = [];
  const ids = new Set<string>();
  const visit = (id: NodeId): void => {
    const node = store.getNodeTruth(id);
    if (!node || node.lifecycle.state === 'destroyed') return;
    ids.add(node.id);
    nodes.push(serializeNode(node));
    if (node.container) {
      for (const cid of node.container.childOrder) visit(cid);
    }
  };
  visit(rootId);

  // Within this snapshot the subtree root IS a root: its parent is not here.
  const rootEntry = nodes[0] as SerializedNode;
  const rootPlacement = rootEntry.membership?.placement;
  delete rootEntry.membership;

  const focusedId = store.focusedIdTruth;
  const out: SerializedStore = {
    version: 5,
    nodes,
    rootIds: [rootId],
    focusedId: focusedId !== null && ids.has(focusedId) ? focusedId : null,
  };
  if (rootPlacement && Object.keys(rootPlacement).length > 0) out.rootPlacement = rootPlacement;
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: PASS, 5 tests.

Then the full suite: `npm test 2>&1 | tail -20` — expected same count as Task 1 plus 5.

- [ ] **Step 5: Commit**

```bash
git add src/snapshot.ts src/snapshot.subtree.test.ts
git commit -m "serialize a single subtree via serialize(store, { root })"
```

---

### Task 3: Scope `focusedId` to the subtree

**Files:**
- Modify: `src/snapshot.subtree.test.ts`

The behavior already shipped in Task 2's `serializeSubtree`. This task pins it, because it is the half of the focus contract that lives on the serialize side and nothing else asserts it.

- [ ] **Step 1: Write the tests**

Append inside the existing `describe`:

```ts
  it('carries focusedId when the focused node is inside the subtree', () => {
    const s = buildTree();
    s.registerNode(createNode({ id: asNodeId('f'), kind: 'panel', parentId: asNodeId('a'), focus: true }));
    s.focusNode(asNodeId('f'));
    expect(serialize(s, { root: asNodeId('a') }).focusedId).toBe('f');
  });

  it('drops focusedId when the focused node is outside the subtree', () => {
    const s = buildTree();
    s.registerNode(createNode({ id: asNodeId('g'), kind: 'panel', parentId: asNodeId('z'), focus: true }));
    s.focusNode(asNodeId('g'));
    expect(serialize(s, { root: asNodeId('a') }).focusedId).toBeNull();
  });

  it('opens as a standalone store via deserialize', () => {
    const snap = serialize(buildTree(), { root: asNodeId('a') });
    const standalone = deserialize(snap);
    expect(standalone.getChildren(asNodeId('a')).map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(standalone.getParent(asNodeId('a'))).toBeUndefined();
  });
```

Widen the snapshot import at the top of the file to `import { deserialize, serialize } from './snapshot.js';`.

- [ ] **Step 2: Run them**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: PASS, 8 tests.

- [ ] **Step 3: Commit**

```bash
git add src/snapshot.subtree.test.ts
git commit -m "pin focusedId scoping on a subtree snapshot"
```

---

### Task 4: Extract `parseSnapshot` and `validateSnapshotLinks`

Pure refactor so `graft` shares the version dispatch, the clone, the migration chain, and the link validation instead of restating them. Existing tests are the net.

**Files:**
- Modify: `src/snapshot.ts` (`deserialize`, `hydrate`)

- [ ] **Step 1: Add the two helpers**

```ts
/** Version-check, clone, and migrate to v5. The clone matters: the caller
 *  may reuse the snapshot object they passed in. */
function parseSnapshot(snap: unknown): SerializedStore {
  const versioned = snap as { version?: number };
  if (!versioned || typeof versioned !== 'object' || typeof versioned.version !== 'number') {
    throw new WindeaseError(
      'unsupported-snapshot-version',
      'snapshot is missing a numeric version field',
    );
  }
  const version = versioned.version;
  if (version !== 2 && version !== 3 && version !== 4 && version !== 5) {
    throw new WindeaseError(
      'unsupported-snapshot-version',
      `unknown snapshot version: ${version}`,
    );
  }
  const src = snap as SerializedStore;
  const nodes = src.nodes.map((sn) => structuredClone(sn));
  normalizeLegacyChildOrder(nodes);
  normalizeLegacyMembership(nodes);
  if (version < 4) migrateToV4(nodes);
  if (version < 5) migrateToV5(nodes);
  const out: SerializedStore = {
    version: 5,
    nodes,
    rootIds: [...src.rootIds],
    focusedId: src.focusedId ?? null,
  };
  if (src.rootPlacement !== undefined) out.rootPlacement = structuredClone(src.rootPlacement);
  return out;
}

/** Bidirectional parent/child links, and at most one focused node. */
function validateSnapshotLinks(nodes: SerializedNode[]): void {
  const byId = new Map<string, SerializedNode>();
  for (const sn of nodes) byId.set(sn.id, sn);

  for (const sn of nodes) {
    if (!sn.membership) continue;
    const parent = byId.get(sn.membership.parentId);
    if (!parent) {
      throw new InvariantViolationError(
        'orphan-child',
        `node ${sn.id} has parentId ${sn.membership.parentId} but no such node`,
        { id: sn.id, parentId: sn.membership.parentId },
      );
    }
    if (!parent.container) {
      throw new InvariantViolationError(
        'parent-not-container',
        `node ${sn.id}'s parent ${parent.id} has no container`,
        { id: sn.id, parentId: parent.id },
      );
    }
    if (!parent.container.childOrder.includes(sn.id)) {
      throw new InvariantViolationError(
        'broken-bidi-link',
        `node ${sn.id} claims parent ${parent.id} but parent doesn't list it`,
        { id: sn.id, parentId: parent.id },
      );
    }
  }

  let focusedSeen: string | null = null;
  for (const sn of nodes) {
    if (sn.focus?.state === 'focused') {
      if (focusedSeen) {
        throw new InvariantViolationError(
          'multi-focus',
          `multiple focused nodes in snapshot: ${focusedSeen}, ${sn.id}`,
          { ids: [focusedSeen, sn.id] },
        );
      }
      focusedSeen = sn.id;
    }
  }
}
```

- [ ] **Step 2: Rewrite `deserialize` to use `parseSnapshot`**

Replace the whole body after the overload signatures:

```ts
export function deserialize(a: unknown, b?: unknown): Store | void {
  const target = a instanceof Store ? a : undefined;
  const parsed = parseSnapshot(target ? b : a);
  const hydrated = hydrate(parsed, target);
  return target ? undefined : hydrated;
}
```

- [ ] **Step 3: Rewrite `hydrate`'s prologue**

`hydrate` now receives already-parsed, already-migrated input. Change its signature to `function hydrate(snap: SerializedStore, target?: Store): Store` and replace everything from the `const nodes = snap.nodes.map(...)` line through the end of the multi-focus check with:

```ts
  const nodes = snap.nodes;
  validateSnapshotLinks(nodes);
  const byId = new Map<string, SerializedNode>();
  for (const sn of nodes) byId.set(sn.id, sn);
```

Leave the rest of `hydrate` — the `target` teardown, the `visit` walk, the unreachable-node check, the focus restore, `resetPublished` — exactly as it is.

- [ ] **Step 4: Verify the refactor moved nothing**

Run: `npm test 2>&1 | tail -20`
Expected: same pass count as the end of Task 3.

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/snapshot.ts
git commit -m "extract parseSnapshot and validateSnapshotLinks from hydrate"
```

---

### Task 5: `graft` validation pre-pass

The pre-pass is the whole point of the reject policy: `registerNode` already throws on a duplicate id, but mid-walk, which would leave a partial tree grafted. Validation therefore runs to completion before any mutation.

**Files:**
- Modify: `src/snapshot.ts`
- Modify: `src/snapshot.subtree.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of the test file:

```ts
import { DuplicateNodeError, InvariantViolationError, LockedError, NodeNotFoundError } from './errors.js';
import { graft, serialize } from './snapshot.js';
import { recordEvents } from './test-utils/record-events.js';
```

Then a new `describe`:

```ts
describe('graft validation', () => {
  it('rejects a colliding id and leaves the store completely untouched', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    const rec = recordEvents(s, 'node.registered', 'node.unregistered', 'node.reordered');

    expect(() => graft(s, snap, asNodeId('z'))).toThrow(DuplicateNodeError);

    expect(rec.log).toHaveLength(0);
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['a', 'b']);
    rec.stop();
  });

  it('throws when the target parent does not exist', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    expect(() => graft(s, snap, asNodeId('nope'))).toThrow(NodeNotFoundError);
  });

  it('throws when the target parent has no container', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    expect(() => graft(s, snap, asNodeId('b'))).toThrow(InvariantViolationError);
  });

  it('throws when the snapshot has more than one root', () => {
    const s = buildTree();
    const two = new Store();
    two.registerNode(
      createNode({ id: asNodeId('r1'), container: { strategyId: 'strip', config: {} } }),
    );
    two.registerNode(createNode({ id: asNodeId('r2') }));
    const snap = serialize(two);
    expect(snap.rootIds).toEqual(['r1', 'r2']);

    expect(() => graft(s, snap, asNodeId('z'))).toThrow(InvariantViolationError);
  });

  it('refuses an accept-locked parent, and force overrides', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    s.setLock(asNodeId('z'), { accept: true });

    expect(() => graft(s, snap, asNodeId('z'))).toThrow(LockedError);
    expect(graft(s, snap, asNodeId('z'), { force: true })).toBe('a');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: FAIL — `graft` is not exported from `./snapshot.js`.

- [ ] **Step 3: Add `graft` with validation only**

Add `DuplicateNodeError` and `LockedError` to the `./errors.js` import. Then:

```ts
export interface GraftOptions {
  /** Index within the target parent's `childOrder`. Appends when omitted. */
  at?: number;
  /** Bypass the target parent's `accept` lock. */
  force?: boolean;
}

/**
 * Attach a subtree snapshot as a child of `parentId`, returning the attached
 * root's id. Every id in the snapshot must be absent from the store — a
 * collision throws rather than remapping, because a snapshot's ids are the
 * host's own record keys.
 *
 * Deliberately does not move focus, even when the snapshot names a focused
 * node. See the design spec.
 *
 * @group Snapshots
 */
export function graft(
  store: Store,
  snap: unknown,
  parentId: NodeId,
  opts?: GraftOptions,
): NodeId {
  const parsed = parseSnapshot(snap);
  if (parsed.rootIds.length !== 1) {
    throw new InvariantViolationError(
      'graft-multi-root',
      `graft needs a snapshot with exactly one root, got ${parsed.rootIds.length}`,
      { rootIds: parsed.rootIds },
    );
  }
  const rootId = asNodeId(parsed.rootIds[0] as string);

  const parent = store.getNodeTruth(parentId);
  if (!parent) throw new NodeNotFoundError(parentId);
  if (!parent.container) {
    throw new InvariantViolationError(
      'parent-not-container',
      `graft target ${parentId} has no container capability`,
      { parentId },
    );
  }
  if (opts?.force !== true && store.isLocked(parentId, 'accept')) {
    throw new LockedError(parentId, 'accept', 'graft');
  }
  for (const sn of parsed.nodes) {
    if (store.getNodeTruth(asNodeId(sn.id))) {
      throw new DuplicateNodeError(asNodeId(sn.id));
    }
  }
  validateSnapshotLinks(parsed.nodes);

  trace('store', `graft: ${rootId} (${parsed.nodes.length} nodes) → ${parentId}@${opts?.at ?? 'end'}`);
  return rootId;
}
```

Note the last two lines are a stub: validation is complete, attachment lands in Task 6. The `force: true` case in the final test asserts only the return value, which is why it passes now.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/snapshot.ts src/snapshot.subtree.test.ts
git commit -m "validate a graft fully before it mutates the store"
```

---

### Task 6: `graft` attaches the subtree

**Files:**
- Modify: `src/snapshot.ts`
- Modify: `src/snapshot.subtree.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('graft attaches', () => {
  it('round-trips a subtree back under the same parent', () => {
    const s = buildTree();
    const before = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b']);

    const id = graft(s, before, asNodeId('z'));

    expect(id).toBe('a');
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b', 'a']);
    expect(s.getChildren(asNodeId('a')).map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(s.getMeta(asNodeId('a1'))).toEqual({ title: 'one' });
    expect(serialize(s, { root: asNodeId('a') })).toEqual(before);
  });

  it('restores the root placement it was serialized with', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    graft(s, snap, asNodeId('z'));
    expect(s.getPlacement(asNodeId('a'))).toEqual({ size: { w: 300 } });
  });

  it('grafts into a different parent, and into a second store', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));

    const fresh = new Store();
    fresh.registerNode(
      createNode({ id: asNodeId('host'), container: { strategyId: 'grid', config: {} } }),
    );
    expect(graft(fresh, snap, asNodeId('host'))).toBe('a');
    expect(fresh.getChildren(asNodeId('host')).map((n) => n.id)).toEqual(['a']);
    expect(fresh.getChildren(asNodeId('a')).map((n) => n.id)).toEqual(['a1', 'a2']);
  });

  it('is a single transaction', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    const rec = recordEvents(s, 'transaction.begin', 'transaction.end', 'node.registered');

    graft(s, snap, asNodeId('z'));

    expect(rec.of('transaction.begin')).toHaveLength(1);
    expect(rec.of('transaction.end')).toHaveLength(1);
    expect(rec.of('node.registered')).toHaveLength(3);
    expect(rec.log[0]?.name).toBe('transaction.begin');
    expect(rec.log.at(-1)?.name).toBe('transaction.end');
    rec.stop();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: FAIL — nothing is attached; `getChildren('z')` is still `['b']`.

- [ ] **Step 3: Replace the stub with the attachment walk**

In `graft`, replace the `trace(...)` and `return rootId;` lines with:

```ts
  const byId = new Map(parsed.nodes.map((sn) => [sn.id, sn] as const));

  // Within the snapshot the root has no membership. Give it one pointing at
  // the graft target, so the same walk hydrate uses works unchanged.
  const rootEntry = byId.get(rootId) as SerializedNode;
  rootEntry.membership = {
    parentId: parentId as string,
    placement: parsed.rootPlacement ?? {},
  };

  trace('store', `graft: ${rootId} (${parsed.nodes.length} nodes) → ${parentId}@${opts?.at ?? 'end'}`);

  store.transact(() => {
    const visit = (id: string): void => {
      const sn = byId.get(id);
      if (!sn) return;
      store.registerNode(buildNodeFromSerialized(sn, { emptyChildOrder: true }));
      if (sn.container) {
        for (const cid of sn.container.childOrder) visit(cid);
      }
    };
    visit(rootId);
    if (opts?.at !== undefined) {
      store.reorderInParent(rootId, opts.at, { force: opts.force ?? false });
    }
  }, 'graft');

  return rootId;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: PASS, 17 tests.

Run: `npm test 2>&1 | tail -20`
Expected: full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/snapshot.ts src/snapshot.subtree.test.ts
git commit -m "attach a grafted subtree in one transaction"
```

---

### Task 7: `graft` honors `at`, including a pinned prefix

**Files:**
- Modify: `src/snapshot.subtree.test.ts`

The `reorderInParent` call shipped in Task 6. This pins its interaction with pinning, which is the case most likely to regress: `reorderInParent` clamps against the pinned prefix, so `at: 0` against a pinned head lands at index 1, not 0.

- [ ] **Step 1: Write the tests**

```ts
describe('graft at an index', () => {
  it('inserts at the requested index', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    s.registerNode(createNode({ id: asNodeId('c'), kind: 'panel', parentId: asNodeId('z') }));
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b', 'c']);

    graft(s, snap, asNodeId('z'), { at: 1 });

    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('lands after a pinned head when asked for index 0', () => {
    const s = buildTree();
    const snap = serialize(s, { root: asNodeId('a') });
    s.unregisterNode(asNodeId('a'));
    s.setPinned(asNodeId('b'), 0);

    graft(s, snap, asNodeId('z'), { at: 0 });

    const order = s.getChildren(asNodeId('z')).map((n) => n.id);
    expect(order[0]).toBe('b');
    expect(order).toContain('a');
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: PASS, 19 tests.

If the pinned case fails, do **not** special-case it in `graft` — read `store.reorderInParent` and `clampPins` and fix the expectation to match the store's actual documented clamping. The store owns pin semantics; graft must not grow a second copy of them.

- [ ] **Step 3: Commit**

```bash
git add src/snapshot.subtree.test.ts
git commit -m "pin graft insertion against a pinned prefix"
```

---

### Task 8: Graft never moves focus

**Files:**
- Modify: `src/snapshot.subtree.test.ts`

Agreed with the keyboard-navigation workstream. These tests exist to stop a later well-meaning "restore focus on hydrate" change from leaking onto the graft path.

- [ ] **Step 1: Write the tests**

```ts
describe('graft and focus', () => {
  it('does not steal focus from the node that has it', () => {
    const s = buildTree();
    s.registerNode(createNode({ id: asNodeId('f'), kind: 'panel', parentId: asNodeId('a'), focus: true }));
    s.focusNode(asNodeId('f'));
    const snap = serialize(s, { root: asNodeId('a') });
    expect(snap.focusedId).toBe('f');

    s.unregisterNode(asNodeId('a'));
    s.registerNode(createNode({ id: asNodeId('keeper'), kind: 'panel', parentId: asNodeId('z'), focus: true }));
    s.focusNode(asNodeId('keeper'));

    graft(s, snap, asNodeId('z'));

    expect(s.focusedId).toBe('keeper');
    expect(s.hasFocus(asNodeId('f'))).toBe(false);
  });

  it('does not claim focus even when the store has none', () => {
    const s = buildTree();
    s.registerNode(createNode({ id: asNodeId('f'), kind: 'panel', parentId: asNodeId('a'), focus: true }));
    s.focusNode(asNodeId('f'));
    const snap = serialize(s, { root: asNodeId('a') });

    s.unregisterNode(asNodeId('a'));
    s.blurAll();
    expect(s.focusedId).toBeNull();

    graft(s, snap, asNodeId('z'));

    expect(s.focusedId).toBeNull();
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: PASS, 21 tests. `graft` never calls `focusNode`, so this should pass without implementation change — if it does not, the bug is real and lives in `buildNodeFromSerialized` or `registerNode`.

- [ ] **Step 3: Commit**

```bash
git add src/snapshot.subtree.test.ts
git commit -m "pin that graft never moves focus"
```

---

### Task 9: A legacy subtree snapshot migrates on graft

**Files:**
- Modify: `src/snapshot.subtree.test.ts`

`graft` routes through `parseSnapshot`, so the v2→v5 chain applies. This proves it rather than assuming it.

- [ ] **Step 1: Write the test**

```ts
describe('graft migrates legacy snapshots', () => {
  it('accepts a v3 subtree snapshot and folds its lock fields', () => {
    const legacy = {
      version: 3,
      rootIds: ['old'],
      focusedId: null,
      nodes: [
        {
          id: 'old',
          kind: 'group',
          lifecycle: 'visible',
          container: {
            strategyId: 'strip',
            config: { axis: 'y' },
            childOrder: ['old1'],
            allowsPinning: true,
            allowsDrop: false,
          },
        },
        {
          id: 'old1',
          kind: 'panel',
          lifecycle: 'visible',
          membership: { parentId: 'old', placement: { locked: true } },
        },
      ],
    };

    const s = buildTree();
    const id = graft(s, legacy, asNodeId('z'));

    expect(id).toBe('old');
    expect(s.getChildren(asNodeId('z')).map((n) => n.id)).toEqual(['a', 'b', 'old']);
    expect(s.isLocked(asNodeId('old'), 'accept')).toBe(true);
    expect(s.isLocked(asNodeId('old1'), 'move')).toBe(true);
    expect(s.getPlacement(asNodeId('old1')).locked).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: PASS, 22 tests.

- [ ] **Step 3: Commit**

```bash
git add src/snapshot.subtree.test.ts
git commit -m "cover grafting a v3 subtree snapshot"
```

---

### Task 10: Export, document, and update the wishlist

**Files:**
- Modify: `src/index.ts:94-97`
- Modify: `README.md`
- Modify: `TODO.md`

`src/index.ts` is shared with the keyboard-navigation session, which confirmed it is clear. If `git status` shows a conflict there, stop and message `windease-10` rather than resolving blind.

- [ ] **Step 1: Add the exports**

In the existing `./snapshot.js` export block, add `graft`, `type GraftOptions`, and `type SerializeOptions`, keeping the block alphabetized:

```ts
export {
  deserialize,
  graft,
  type GraftOptions,
  type SerializedNode,
  type SerializedStore,
  serialize,
  type SerializeOptions,
} from './snapshot.js';
```

- [ ] **Step 2: Verify the public surface builds**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no errors.

Run: `npm run build 2>&1 | tail -20`
Expected: no errors.

- [ ] **Step 3: Document it in the README**

Add to the snapshot section. Keep the example short, and **verify every API it names actually exists** — a README example calling a method that does not exist is a trap this repo has already hit once.

```markdown
### Saving one subtree

`serialize(store, { root })` captures a node and its descendants; `graft`
attaches that snapshot under a parent. Useful when your app's saved unit is
one workspace rather than the whole session.

​```ts
const saved = serialize(store, { root: workspaceId });
store.unregisterNode(workspaceId);

// …later, possibly in a different store
graft(store, saved, dockId, { at: 0 });
​```

Every id in the snapshot must be absent from the target store; a collision
throws `DuplicateNodeError` before anything is mutated. The subtree root's
placement travels with it. Focus does not move — call `focusNode` yourself if
the arriving subtree should take it.
```

- [ ] **Step 4: Prove the README example runs**

Add to `src/snapshot.subtree.test.ts` — this is the `patchMeta()` lesson from the previous workstream, where documented prose named an API that did not exist:

```ts
describe('README subtree example', () => {
  it('runs as documented', () => {
    const store = buildTree();
    const workspaceId = asNodeId('a');
    const dockId = asNodeId('z');

    const saved = serialize(store, { root: workspaceId });
    store.unregisterNode(workspaceId);
    graft(store, saved, dockId, { at: 0 });

    expect(store.getChildren(dockId).map((n) => n.id)).toContain('a');
  });
});
```

Run: `npx vitest run src/snapshot.subtree.test.ts 2>&1 | tail -20`
Expected: PASS, 23 tests.

- [ ] **Step 5: Update the wishlist entry**

In `TODO.md`, under "Wishlist: hosting an app that already has a workspace store", rewrite the **Subtree serialize / hydrate** bullet in place — the file records what has landed, not what is hoped for:

```markdown
- **Shipped: subtree serialize / graft.** `serialize(store, { root })` emits a
  v5 snapshot of one node and its descendants, with the root's own placement in
  a top-level `rootPlacement`; `graft(store, snap, parentId, { at, force })`
  attaches one under a named parent and returns its id. Colliding ids reject
  rather than remap — the snapshot's ids are the host's record keys — and the
  check is a pre-pass, so a rejected graft mutates nothing. One transaction, so
  one undo step. Graft never moves focus. A subtree snapshot is an ordinary v5
  snapshot, so `deserialize` still opens one as a standalone store.
```

- [ ] **Step 6: Full verification**

Run: `npm test 2>&1 | tail -20`
Expected: green.

Run: `npm run lint 2>&1 | tail -20`
Expected: green. Read the `Checked N files` line — biome can exit nonzero while printing "No fixes applied", which reads like a pass.

Run: `npm run typecheck 2>&1 | tail -20`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/snapshot.subtree.test.ts README.md TODO.md
git commit -m "export graft and document the subtree snapshot pattern"
```

---

## Out of scope

- Id remapping (`{ ids: 'remap' }`) — see the spec's Out of scope section.
- Grid resize gutters, the other unblocked wishlist item.
- The `devicePixelRatio` question, which is the user's call and explicitly not to be implemented without asking.
