# Lockable Entities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `node.lock`, a node-intrinsic permission set letting a host restrict what may be done to any node, and redefine `placement.pinned` as a held index enforced against third-party displacement.

**Architecture:** A new `src/lock.ts` owns the axis vocabulary and capability filtering as pure functions. `Store` gains `setLock`/`getLock` plus a private `assertUnlocked` guard called from each mutation, bypassable via `{ force: true }` or `withLocksSuspended`. A new `src/pinning.ts` owns index-holding placement as a pure function so displacement routing is testable without a store. The React layer reads `node.lock` at four existing sites plus one that has no guard today (affordance dispatch).

**Tech Stack:** TypeScript 6 (strict, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Vitest 4, React 19, Biome 2.

**Spec:** `docs/superpowers/specs/2026-08-16-lockable-entities-design.md`

**Conventions:** Tests are colocated `src/*.test.ts`. Import with `.js` extensions. Run a single file with `npx vitest run src/<file>.test.ts`, a single test with `-t "<name>"`. Lint with `npm run lint`. Type-check with `npm run typecheck`.

---

## Phase A — the lock primitive (additive, nothing breaks)

### Task 1: Lock vocabulary and capability filtering

**Files:**
- Create: `src/lock.ts`
- Create: `src/lock.test.ts`
- Modify: `src/errors.ts` (append after `StrategyRejectionError`, around line 96)

- [ ] **Step 1: Write the failing test**

Create `src/lock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createGroup, createPanel, createZone } from './constructors.js';
import { resolveLock, supportedAxes } from './lock.js';
import { asNodeId } from './node.js';

const id = (s: string) => asNodeId(s);

describe('supportedAxes', () => {
  it('gives a panel the membership axes plus destroy', () => {
    const panel = createPanel({ id: id('p'), parentId: id('z') });
    expect([...supportedAxes(panel)].sort()).toEqual(['destroy', 'move', 'resize']);
  });

  it('gives a zone the container axes plus destroy, and no membership axes', () => {
    const zone = createZone({ id: id('z'), strategyId: 'grid', config: {} });
    expect([...supportedAxes(zone)].sort()).toEqual([
      'accept',
      'arrange',
      'destroy',
      'dragOut',
    ]);
  });

  it('gives a group every axis', () => {
    const group = createGroup({
      id: id('g'),
      parentId: id('z'),
      strategyId: 'grid',
      config: {},
    });
    expect([...supportedAxes(group)].sort()).toEqual([
      'accept',
      'arrange',
      'destroy',
      'dragOut',
      'move',
      'resize',
    ]);
  });
});

describe('resolveLock', () => {
  it('expands true to every supported axis', () => {
    const zone = createZone({ id: id('z'), strategyId: 'grid', config: {} });
    expect(resolveLock(zone, true)).toEqual({
      accept: true,
      arrange: true,
      destroy: true,
      dragOut: true,
    });
  });

  it('drops unsupported axes instead of throwing', () => {
    const zone = createZone({ id: id('z'), strategyId: 'grid', config: {} });
    expect(resolveLock(zone, { move: true, destroy: true })).toEqual({ destroy: true });
  });

  it('omits axes explicitly set false', () => {
    const panel = createPanel({ id: id('p'), parentId: id('z') });
    expect(resolveLock(panel, { move: true, resize: false })).toEqual({ move: true });
  });

  it('resolves false to an empty set', () => {
    const panel = createPanel({ id: id('p'), parentId: id('z') });
    expect(resolveLock(panel, false)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lock.test.ts`
Expected: FAIL — `Failed to resolve import "./lock.js"`.

- [ ] **Step 3: Create `src/lock.ts`**

```ts
import type { Node } from './node.js';

export type LockAxis = 'move' | 'resize' | 'destroy' | 'accept' | 'dragOut' | 'arrange';

export type LockSet = Partial<Record<LockAxis, boolean>>;

const MEMBERSHIP_AXES = ['move', 'resize'] as const;
const CONTAINER_AXES = ['accept', 'dragOut', 'arrange'] as const;

/** Axes meaningful for this node, decided by which capabilities it carries. */
export function supportedAxes(node: Node): ReadonlySet<LockAxis> {
  const axes = new Set<LockAxis>(['destroy']);
  if (node.membership) for (const a of MEMBERSHIP_AXES) axes.add(a);
  if (node.container) for (const a of CONTAINER_AXES) axes.add(a);
  return axes;
}

/**
 * Unsupported axes are dropped rather than rejected, so a host can pass `true`
 * without branching on node shape.
 */
export function resolveLock(node: Node, input: boolean | LockSet): LockSet {
  const supported = supportedAxes(node);
  const out: LockSet = {};
  if (input === true) {
    for (const axis of supported) out[axis] = true;
    return out;
  }
  if (input === false) return out;
  for (const [key, value] of Object.entries(input)) {
    const axis = key as LockAxis;
    if (value === true && supported.has(axis)) out[axis] = true;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lock.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add `LockedError` and `PinIndexError`**

In `src/errors.ts`, add both codes to the `WindeaseErrorCode` union next to `'strategy-rejected'`:

```ts
  | 'locked'
  | 'pin-index-out-of-range'
```

Then append after `StrategyRejectionError`:

```ts
/** @group Errors */
export class LockedError extends WindeaseError {
  readonly id: NodeId;
  readonly axis: string;
  readonly operation: string;
  constructor(id: NodeId, axis: string, operation: string) {
    super('locked', `Operation ${operation} on ${id} is blocked by lock.${axis}`);
    this.name = 'LockedError';
    this.id = id;
    this.axis = axis;
    this.operation = operation;
  }
}

/** @group Errors */
export class PinIndexError extends WindeaseError {
  readonly id: NodeId;
  readonly requested: number;
  readonly length: number;
  constructor(id: NodeId, requested: number, length: number) {
    super(
      'pin-index-out-of-range',
      `Cannot pin ${id} to index ${requested}: parent has ${length} children`,
    );
    this.name = 'PinIndexError';
    this.id = id;
    this.requested = requested;
    this.length = length;
  }
}
```

- [ ] **Step 6: Add `lock` to the Node shape**

In `src/node.ts`, add the import at the top:

```ts
import type { LockSet } from './lock.js';
```

and the field to `interface Node`, after `focus?: FocusCap;`:

```ts
  /** Permissions restricting what may be done to this node. Node-intrinsic:
   *  survives `moveNode`, unlike `membership.placement`. */
  lock?: LockSet;
```

- [ ] **Step 7: Verify the tree still builds**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean, all existing tests pass (459 at time of writing).

- [ ] **Step 8: Commit**

```bash
git add src/lock.ts src/lock.test.ts src/errors.ts src/node.ts
git commit -m "feat: add lock axis vocabulary and node.lock field"
```

---

### Task 2: `setLock` / `getLock` and the bypass mechanism

**Files:**
- Modify: `src/store.ts`
- Create: `src/store.lock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store.lock.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

const id = (s: string) => asNodeId(s);

function seeded(): { s: Store; z: NodeId; p: NodeId } {
  const s = new Store();
  s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
  s.registerNode(createPanel({ id: id('p'), parentId: id('z') }));
  return { s, z: id('z'), p: id('p') };
}

describe('Store — setLock / getLock', () => {
  it('expands true to the supported axes', () => {
    const { s, p } = seeded();
    s.setLock(p, true);
    expect(s.getLock(p)).toEqual({ move: true, resize: true, destroy: true });
  });

  it('returns an empty set for an unlocked node', () => {
    const { s, p } = seeded();
    expect(s.getLock(p)).toEqual({});
  });

  it('replaces rather than merges', () => {
    const { s, p } = seeded();
    s.setLock(p, { move: true, destroy: true });
    s.setLock(p, { move: true });
    expect(s.getLock(p)).toEqual({ move: true });
  });

  it('emits node.lockChanged with from and to', () => {
    const { s, p } = seeded();
    const spy = vi.fn();
    s.events.on('node.lockChanged', spy);
    s.setLock(p, { move: true });
    expect(spy).toHaveBeenCalledWith({ id: 'p', from: {}, to: { move: true } });
  });

  it('does not emit when the resolved set is unchanged', () => {
    const { s, p } = seeded();
    s.setLock(p, { move: true });
    const spy = vi.fn();
    s.events.on('node.lockChanged', spy);
    s.setLock(p, { move: true, accept: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports lock state per axis via isLocked', () => {
    const { s, p } = seeded();
    s.setLock(p, { move: true });
    expect(s.isLocked(p, 'move')).toBe(true);
    expect(s.isLocked(p, 'destroy')).toBe(false);
  });

  it('reports every axis unlocked while locks are suspended', () => {
    const { s, p } = seeded();
    s.setLock(p, true);
    s.withLocksSuspended(() => {
      expect(s.isLocked(p, 'move')).toBe(false);
    });
    expect(s.isLocked(p, 'move')).toBe(true);
  });

  it('restores suspension state when the callback throws', () => {
    const { s, p } = seeded();
    s.setLock(p, true);
    expect(() =>
      s.withLocksSuspended(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(s.isLocked(p, 'move')).toBe(true);
  });

  it('returns the callback result', () => {
    const { s } = seeded();
    expect(s.withLocksSuspended(() => 42)).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store.lock.test.ts`
Expected: FAIL — `s.setLock is not a function`.

- [ ] **Step 3: Implement in `src/store.ts`**

Add imports at the top of the file:

```ts
import { LockedError } from './errors.js';
import { type LockAxis, type LockSet, resolveLock } from './lock.js';
```

(`LockedError` joins the existing `./errors.js` import; merge rather than duplicating the statement.)

Add to the `StoreEvents` interface, next to `'node.metaChanged'`:

```ts
  'node.lockChanged': { id: NodeId; from: LockSet; to: LockSet };
```

Add a private field next to the other private state:

```ts
  private locksSuspended = 0;
```

Add the public API. Put it immediately before `setAllowsPinning`:

```ts
  setLock(id: NodeId, input: boolean | LockSet): void {
    const node = this.requireNode(id);
    const from = node.lock ?? {};
    const to = resolveLock(node, input);
    if (sameLock(from, to)) return;
    this.replaceNode(id, (n) => (Object.keys(to).length === 0 ? omitLock(n) : { ...n, lock: to }));
    this.events.emit('node.lockChanged', { id, from, to });
    trace('store', `setLock: ${id} → {${Object.keys(to).join(',')}}`);
    this.scheduleNotify();
  }

  getLock(id: NodeId): Readonly<LockSet> {
    return this.requireNode(id).lock ?? {};
  }

  isLocked(id: NodeId, axis: LockAxis): boolean {
    if (this.locksSuspended > 0) return false;
    return this.nodesMap.get(id)?.lock?.[axis] === true;
  }

  /** Run `fn` with every lock ignored. Used internally by `deserialize` and
   *  `HistoryController` so a restore is never fought by locks. */
  withLocksSuspended<T>(fn: () => T): T {
    this.locksSuspended += 1;
    try {
      return fn();
    } finally {
      this.locksSuspended -= 1;
    }
  }

  private assertUnlocked(
    id: NodeId,
    axis: LockAxis,
    operation: string,
    opts?: MutateOptions,
  ): void {
    if (opts?.force === true) return;
    if (!this.isLocked(id, axis)) return;
    throw new LockedError(id, axis, operation);
  }
```

Add the options type and the two helpers at module scope, next to the existing `clampIndex` helper:

```ts
export interface MutateOptions {
  /** Bypass lock guards for this call. */
  force?: boolean;
}

function sameLock(a: LockSet, b: LockSet): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k as LockAxis] === b[k as LockAxis]);
}

function omitLock(n: Node): Node {
  const { lock: _lock, ...rest } = n;
  return rest as Node;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store.lock.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Export the new surface**

In `src/index.ts`, add to the `./errors.js` export block: `LockedError`, `PinIndexError`. Add a new block after the `./layout-types.js` exports:

```ts
export { type LockAxis, type LockSet, resolveLock, supportedAxes } from './lock.js';
```

Add `type MutateOptions` to the existing `./store.js` export block.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: all clean.

```bash
git add src/store.ts src/store.lock.test.ts src/index.ts
git commit -m "feat: add setLock, getLock, and withLocksSuspended to Store"
```

---

### Task 3: Guard `destroy` — the documented-but-missing behavior

This is the bug named in `src/node.ts`: the reserved key has always claimed the React layer refuses destroy, and nothing ever enforced it.

**Files:**
- Modify: `src/store.ts` (`unregisterNode`, around line 259)
- Modify: `src/store.lock.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/store.lock.test.ts`:

```ts
describe('Store — destroy lock', () => {
  it('blocks unregisterNode on a locked node', () => {
    const { s, p } = seeded();
    s.setLock(p, { destroy: true });
    expect(() => s.unregisterNode(p)).toThrow(LockedError);
    expect(s.getNode(p)).toBeDefined();
  });

  it('allows unregisterNode with force', () => {
    const { s, p } = seeded();
    s.setLock(p, { destroy: true });
    s.unregisterNode(p, { force: true });
    expect(s.getNode(p)).toBeUndefined();
  });

  it('allows unregisterNode inside withLocksSuspended', () => {
    const { s, p } = seeded();
    s.setLock(p, { destroy: true });
    s.withLocksSuspended(() => s.unregisterNode(p));
    expect(s.getNode(p)).toBeUndefined();
  });

  it('cascades through a locked child when an ancestor is destroyed', () => {
    const { s, z, p } = seeded();
    s.setLock(p, { destroy: true });
    s.unregisterNode(z);
    expect(s.getNode(p)).toBeUndefined();
    expect(s.getNode(z)).toBeUndefined();
  });

  it('blocks destroying the ancestor when the ancestor itself is locked', () => {
    const { s, z } = seeded();
    s.setLock(z, { destroy: true });
    expect(() => s.unregisterNode(z)).toThrow(LockedError);
  });
});
```

Add `LockedError` to the `./errors.js` import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store.lock.test.ts -t "destroy lock"`
Expected: FAIL — the first test does not throw.

- [ ] **Step 3: Add the guard**

Change the `unregisterNode` signature and add the guard as its first statement after the node lookup:

```ts
  unregisterNode(id: NodeId, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'destroy', 'unregisterNode', opts);
```

The cascade must not re-check: it recurses through a private path. Confirm the descendant walk inside `unregisterNode` does not call the public method again — if it does, extract the body into a private `destroySubtree(id)` and have the public method guard, then delegate. Only the node named in the call is guarded; descendants are not.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store.lock.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Fix the stale doc comment**

In `src/node.ts`, the `MembershipCap.placement` JSDoc currently reads:

```
 *  - `locked: boolean` — pinned, AND the React layer refuses drag/destroy.
```

Delete that line — the reserved key is replaced by `node.lock` in Task 8, and destroy enforcement now lives in the store.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts src/store.lock.test.ts src/node.ts
git commit -m "feat: block unregisterNode on a destroy-locked node"
```

---

### Task 4: Guard `move`, `accept`, `dragOut`

**Files:**
- Modify: `src/store.ts` (`moveNode` ~line 318, `reorderInParent` ~line 412)
- Modify: `src/store.lock.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/store.lock.test.ts`:

```ts
function twoZones(): { s: Store; a: NodeId; b: NodeId; p: NodeId } {
  const s = new Store();
  s.registerNode(createZone({ id: id('a'), strategyId: 'grid', config: {} }));
  s.registerNode(createZone({ id: id('b'), strategyId: 'grid', config: {} }));
  s.registerNode(createPanel({ id: id('p'), parentId: id('a') }));
  return { s, a: id('a'), b: id('b'), p: id('p') };
}

describe('Store — move / accept / dragOut locks', () => {
  it('blocks moveNode when the source is move-locked', () => {
    const { s, b, p } = twoZones();
    s.setLock(p, { move: true });
    expect(() => s.moveNode(p, b)).toThrow(LockedError);
  });

  it('blocks moveNode when the target is accept-locked', () => {
    const { s, b, p } = twoZones();
    s.setLock(b, { accept: true });
    expect(() => s.moveNode(p, b)).toThrow(LockedError);
  });

  it('blocks moveNode when the source parent is dragOut-locked', () => {
    const { s, a, b, p } = twoZones();
    s.setLock(a, { dragOut: true });
    expect(() => s.moveNode(p, b)).toThrow(LockedError);
  });

  it('allows a move that violates none of the three', () => {
    const { s, b, p } = twoZones();
    s.moveNode(p, b);
    expect(s.getNode(p)?.membership?.parentId).toBe('b');
  });

  it('allows a blocked move with force', () => {
    const { s, b, p } = twoZones();
    s.setLock(p, { move: true });
    s.moveNode(p, b, undefined, { force: true });
    expect(s.getNode(p)?.membership?.parentId).toBe('b');
  });

  it('keeps the lock after a move, since lock is node-intrinsic', () => {
    const { s, b, p } = twoZones();
    s.setLock(p, { destroy: true });
    s.moveNode(p, b);
    expect(s.getLock(p)).toEqual({ destroy: true });
  });

  it('blocks reorderInParent when the node is move-locked', () => {
    const { s, a } = twoZones();
    s.registerNode(createPanel({ id: id('q'), parentId: a }));
    s.setLock(id('q'), { move: true });
    expect(() => s.reorderInParent(id('q'), 0)).toThrow(LockedError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store.lock.test.ts -t "move / accept / dragOut"`
Expected: FAIL — no throw.

- [ ] **Step 3: Add the guards**

`moveNode` gains an options parameter and three checks before any mutation:

```ts
  moveNode(id: NodeId, newParentId: NodeId, at?: number, opts?: MutateOptions): void {
    const node = this.requireNode(id);
    this.assertUnlocked(id, 'move', 'moveNode', opts);
    this.assertUnlocked(newParentId, 'accept', 'moveNode', opts);
    if (node.membership) {
      this.assertUnlocked(node.membership.parentId, 'dragOut', 'moveNode', opts);
    }
```

`reorderInParent` gains one:

```ts
  reorderInParent(id: NodeId, at: number, opts?: MutateOptions): void {
    const node = this.requireNode(id);
    this.assertUnlocked(id, 'move', 'reorderInParent', opts);
```

The `move` lock survives relocation for free: `lock` lives on the node, and `moveNode` only rewrites `membership`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store.lock.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/store.lock.test.ts
git commit -m "feat: guard moveNode and reorderInParent with move, accept, and dragOut locks"
```

---

### Task 5: Guard `arrange` and `resize`

`resize` guards only the reserved `size` key. Free-form consumer keys on `placement` stay writable under a resize lock — locking a pane's extent must not freeze the host's own per-placement UI state.

**Files:**
- Modify: `src/store.ts` (`setChildOrder` ~450, `patchPlacement` ~540, `updateContainerConfig` ~659, `setContainerState` ~699)
- Modify: `src/store.lock.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/store.lock.test.ts`:

```ts
describe('Store — arrange and resize locks', () => {
  it('blocks setChildOrder on an arrange-locked container', () => {
    const { s, z, p } = seeded();
    s.registerNode(createPanel({ id: id('q'), parentId: z }));
    s.setLock(z, { arrange: true });
    expect(() => s.setChildOrder(z, [id('q'), p])).toThrow(LockedError);
  });

  it('blocks updateContainerConfig on an arrange-locked container', () => {
    const { s, z } = seeded();
    s.setLock(z, { arrange: true });
    expect(() => s.updateContainerConfig(z, { cols: 3 })).toThrow(LockedError);
  });

  it('blocks setContainerState on an arrange-locked container', () => {
    const { s, z } = seeded();
    s.setLock(z, { arrange: true });
    expect(() => s.setContainerState(z, { ratio: 0.5 })).toThrow(LockedError);
  });

  it('blocks writing placement.size on a resize-locked node', () => {
    const { s, p } = seeded();
    s.setLock(p, { resize: true });
    expect(() => s.patchPlacement(p, { size: { w: 100 } })).toThrow(LockedError);
  });

  it('blocks clearing placement.size on a resize-locked node', () => {
    const { s, p } = seeded();
    s.patchPlacement(p, { size: { w: 100 } });
    s.setLock(p, { resize: true });
    expect(() => s.patchPlacement(p, { size: undefined })).toThrow(LockedError);
  });

  it('allows free-form placement keys on a resize-locked node', () => {
    const { s, p } = seeded();
    s.setLock(p, { resize: true });
    s.patchPlacement(p, { collapsed: true });
    expect(s.getPlacement(p).collapsed).toBe(true);
  });

  it('allows a size write with force', () => {
    const { s, p } = seeded();
    s.setLock(p, { resize: true });
    s.patchPlacement(p, { size: { w: 100 } }, { force: true });
    expect(s.getPlacement(p).size).toEqual({ w: 100 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store.lock.test.ts -t "arrange and resize"`
Expected: FAIL — no throw.

- [ ] **Step 3: Add the guards**

```ts
  setChildOrder(parentId: NodeId, orderedIds: readonly NodeId[], opts?: MutateOptions): void {
    this.assertUnlocked(parentId, 'arrange', 'setChildOrder', opts);

  updateContainerConfig(id: NodeId, patch: unknown, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'arrange', 'updateContainerConfig', opts);

  setContainerState(id: NodeId, state: unknown, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'arrange', 'setContainerState', opts);

  patchPlacement(id: NodeId, patch: Record<string, unknown>, opts?: MutateOptions): void {
    if ('size' in patch) this.assertUnlocked(id, 'resize', 'patchPlacement', opts);
```

`setPlacement` delegates to `patchPlacement`, so widen it to forward the options:

```ts
  setPlacement(id: NodeId, key: string, value: unknown, opts?: MutateOptions): void {
    this.patchPlacement(id, { [key]: value }, opts);
  }
```

`'size' in patch` rather than a truthiness check, so clearing the key (`size: undefined`) is guarded too — a gutter drag clears `size` on split panes, and that is exactly a resize.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store.lock.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 5: Full suite and commit**

Run: `npm run typecheck && npx vitest run && npm run lint`

```bash
git add src/store.ts src/store.lock.test.ts
git commit -m "feat: guard container arrangement and pane resize with locks"
```

---

## Phase B — retire the ad-hoc flags (breaking)

### Task 6: Replace `allowsDrop` / `allowsDragOut` with lock axes

**Files:**
- Modify: `src/node.ts` (`ContainerCap`, lines 49-54)
- Modify: `src/constructors.ts` (all three input types and builders)
- Modify: `src/store.ts` (delete `setAllowsDrop`, `setAllowsDragOut`, and their two events)
- Modify: `src/snapshot.ts` (lines 25-29, 70-73, 290-292)
- Modify: `src/react/dnd/DragController.ts` (~117, ~185), `src/react/dnd/useDragHandle.ts` (~84)
- Modify: `src/react/stories/Playground.stories.tsx` (~86, 319-374)
- Modify: `src/store.test.ts`, `src/constructors.test.ts`, `src/snapshot.test.ts` — existing assertions on these fields

- [ ] **Step 1: Write the failing test**

Append to `src/store.lock.test.ts`:

```ts
describe('Store — allows* flags are gone', () => {
  it('no longer exposes setAllowsDrop or setAllowsDragOut', () => {
    const { s } = seeded();
    expect((s as unknown as Record<string, unknown>).setAllowsDrop).toBeUndefined();
    expect((s as unknown as Record<string, unknown>).setAllowsDragOut).toBeUndefined();
  });

  it('accepts lock at construction via createZone', () => {
    const s = new Store();
    s.registerNode(
      createZone({
        id: id('z'),
        strategyId: 'grid',
        config: {},
        lock: { accept: true },
      }),
    );
    expect(s.getLock(id('z'))).toEqual({ accept: true });
  });

  it('keeps allowsPinning, which governs a different concept', () => {
    const { s, z } = seeded();
    s.setAllowsPinning(z, false);
    expect(s.getContainerView(z)?.allowsPinning).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store.lock.test.ts -t "allows\* flags are gone"`
Expected: FAIL — `setAllowsDrop` is still a function; `createZone` rejects `lock`.

- [ ] **Step 3: Remove the fields**

In `src/node.ts`, delete `allowsDrop` and `allowsDragOut` from `ContainerCap`, keeping `allowsPinning`:

```ts
export interface ContainerCap {
  strategyId: string;
  config: unknown;
  childOrder: NodeId[];
  allowsPinning: boolean;
  state?: unknown;
}
```

In `src/constructors.ts`, delete `allowsDrop` / `allowsDragOut` from `CreateZoneInput`, `CreateGroupInput`, and `CreatePanelInput['container']`, delete the three `?? true` defaults in each builder, and add to each input type:

```ts
  lock?: boolean | LockSet;
```

Each builder resolves it after the node is otherwise built, since `resolveLock` needs the finished capability shape:

```ts
  if (input.lock !== undefined) {
    const resolved = resolveLock(node, input.lock);
    if (Object.keys(resolved).length > 0) node.lock = resolved;
  }
```

Import `resolveLock` and `type LockSet` from `./lock.js` in `src/constructors.ts`.

In `src/store.ts`, delete `setAllowsDrop` and `setAllowsDragOut` entirely, plus the `'container.allowsDropChanged'` and `'container.allowsDragOutChanged'` entries in `StoreEvents`.

- [ ] **Step 4: Update the React reads**

`src/react/dnd/DragController.ts` — replace the `allowsDragOut` check:

```ts
    if (store.isLocked(node.membership.parentId, 'dragOut')) {
      trace('dnd', `tryBegin ${sourceId}: REJECTED (parent lock.dragOut)`);
      return false;
    }
```

and the `allowsDrop` check:

```ts
    if (store.isLocked(targetId, 'accept')) {
      trace('dnd', `checkAccept ${targetId}: REJECT (lock.accept)`);
      return false;
    }
```

`src/react/dnd/useDragHandle.ts` — replace the parent check:

```ts
  if (node?.membership && store.isLocked(node.membership.parentId, 'dragOut')) {
    return NOOP_HANDLERS;
  }
```

(The `placement.locked` check in both files is replaced in Task 8; leave it for now so the tree stays green.)

- [ ] **Step 5: Update snapshot and stories**

In `src/snapshot.ts`, delete `allowsDrop` / `allowsDragOut` from the serialized container type and from both the serialize and deserialize paths. The v3-compatibility migration lands in Task 12; for now, ignore the fields when reading.

In `src/react/stories/Playground.stories.tsx`, replace the two toggle checkboxes and the two event subscriptions with `setLock` / `getLock` equivalents reading `lock.accept` and `lock.dragOut`.

- [ ] **Step 6: Update existing tests**

Run `npx vitest run` and fix every failure that asserts on `allowsDrop` / `allowsDragOut` in `src/store.test.ts`, `src/constructors.test.ts`, and `src/snapshot.test.ts`. Each becomes a `getLock` assertion — e.g. `expect(view.allowsDrop).toBe(false)` becomes `expect(s.getLock(z).accept).toBe(true)`.

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: all clean.

```bash
git add -A src
git commit -m "refactor!: replace allowsDrop and allowsDragOut with lock axes"
```

---

## Phase C — pinned as a held index (breaking)

### Task 7: Pure placement algorithm

**Files:**
- Create: `src/pinning.ts`
- Create: `src/pinning.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/pinning.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asNodeId, type NodeId } from './node.js';
import { placeRespectingPins } from './pinning.js';

const ids = (...s: string[]) => s.map(asNodeId);
const pins = (m: Record<string, number>) => (id: NodeId) => m[id] ?? null;

describe('placeRespectingPins', () => {
  it('moves a node normally when nothing is pinned', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c', 'd'), asNodeId('d'), 1, pins({}));
    expect(out).toEqual(['a', 'd', 'b', 'c']);
  });

  it('routes a third party past a held slot', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c', 'd'), asNodeId('d'), 2, pins({ c: 2 }));
    expect(out).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back before the desired slot when nothing after it is free', () => {
    const out = placeRespectingPins(
      ids('a', 'b', 'c'),
      asNodeId('a'),
      2,
      pins({ b: 1, c: 2 }),
    );
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('moves a pinned node when it is the one being reordered', () => {
    const out = placeRespectingPins(ids('a', 'b', 'c'), asNodeId('c'), 0, pins({ c: 2 }));
    expect(out).toEqual(['c', 'a', 'b']);
  });

  it('clamps a held index beyond the end of the list', () => {
    const out = placeRespectingPins(ids('a', 'b'), asNodeId('a'), 1, pins({ b: 9 }));
    expect(out).toEqual(['a', 'b']);
  });

  it('treats the loser of a held-index collision as unpinned', () => {
    const out = placeRespectingPins(
      ids('a', 'b', 'c'),
      asNodeId('a'),
      2,
      pins({ b: 1, c: 1 }),
    );
    expect(out).toHaveLength(3);
    expect(new Set(out)).toEqual(new Set(['a', 'b', 'c']));
    expect(out[1]).toBe('b');
  });

  it('preserves the relative order of unpinned nodes', () => {
    const out = placeRespectingPins(
      ids('a', 'b', 'c', 'd', 'e'),
      asNodeId('e'),
      0,
      pins({ c: 2 }),
    );
    expect(out).toEqual(['e', 'a', 'c', 'b', 'd']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pinning.test.ts`
Expected: FAIL — cannot resolve `./pinning.js`.

- [ ] **Step 3: Create `src/pinning.ts`**

```ts
import type { NodeId } from './node.js';

export type PinnedIndexOf = (id: NodeId) => number | null;

/**
 * Rebuild `order` with `movingId` placed at (or as near as possible after)
 * `desired`, honoring the held indices of every *other* pinned child. A pinned
 * node holds its slot against third parties but yields when it is itself the
 * node being reordered.
 */
export function placeRespectingPins(
  order: readonly NodeId[],
  movingId: NodeId,
  desired: number,
  pinnedIndexOf: PinnedIndexOf,
): NodeId[] {
  const n = order.length;
  if (n === 0) return [];

  const held = new Map<number, NodeId>();
  for (const cid of order) {
    if (cid === movingId) continue;
    const pin = pinnedIndexOf(cid);
    if (pin === null) continue;
    const slot = Math.min(Math.max(pin, 0), n - 1);
    if (!held.has(slot)) held.set(slot, cid);
  }

  const heldIds = new Set(held.values());
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!held.has(i)) free.push(i);

  const target = Math.min(Math.max(desired, 0), n - 1);
  const slot = free.find((i) => i >= target) ?? free[free.length - 1];

  const rest = order.filter((c) => c !== movingId && !heldIds.has(c));
  const result = new Array<NodeId | undefined>(n);
  for (const [i, cid] of held) result[i] = cid;
  if (slot !== undefined) result[slot] = movingId;

  let r = 0;
  for (let i = 0; i < n; i++) {
    if (result[i] === undefined) result[i] = rest[r++];
  }
  return result as NodeId[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pinning.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/pinning.ts src/pinning.test.ts
git commit -m "feat: add pin-aware child placement algorithm"
```

---

### Task 8: `setPinned` / `unpin`, and delete `resortByPin`

**Files:**
- Modify: `src/store.ts` (delete `resortByPin` ~502-523; add pin API; rewrite `reorderInParent`)
- Create: `src/store.pinned.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store.pinned.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { PinIndexError } from './errors.js';
import { asNodeId, type NodeId } from './node.js';
import { Store } from './store.js';

const id = (s: string) => asNodeId(s);

function strip(count: number): { s: Store; z: NodeId } {
  const s = new Store();
  s.registerNode(createZone({ id: id('z'), strategyId: 'strip', config: {} }));
  for (let i = 0; i < count; i++) {
    s.registerNode(createPanel({ id: id(`p${i}`), parentId: id('z') }));
  }
  return { s, z: id('z') };
}

const order = (s: Store, z: NodeId) => s.getContainerView(z)?.childOrder;

describe('Store — setPinned', () => {
  it('pins to the current index by default and does not move the node', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p2'));
    expect(order(s, z)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(s.getPinnedIndex(id('p2'))).toBe(2);
  });

  it('pins to an explicit index, moving the node there', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p3'), 0);
    expect(order(s, z)).toEqual(['p3', 'p0', 'p1', 'p2']);
    expect(s.getPinnedIndex(id('p3'))).toBe(0);
  });

  it('throws PinIndexError for an index past the end', () => {
    const { s } = strip(4);
    expect(() => s.setPinned(id('p0'), 7)).toThrow(PinIndexError);
  });

  it('throws PinIndexError for a negative index', () => {
    const { s } = strip(4);
    expect(() => s.setPinned(id('p0'), -1)).toThrow(PinIndexError);
  });

  it('emits node.pinnedChanged', () => {
    const { s } = strip(4);
    const spy = vi.fn();
    s.events.on('node.pinnedChanged', spy);
    s.setPinned(id('p1'));
    expect(spy).toHaveBeenCalledWith({ id: 'p1', from: null, to: 1 });
  });

  it('unpins', () => {
    const { s } = strip(4);
    s.setPinned(id('p1'));
    s.unpin(id('p1'));
    expect(s.getPinnedIndex(id('p1'))).toBeNull();
  });

  it('does not promote a pinned node to the front', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p2'));
    s.setPinned(id('p3'));
    expect(order(s, z)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });
});

describe('Store — pinned displacement', () => {
  it('routes a third-party reorder around a held slot', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p2'));
    s.reorderInParent(id('p3'), 2);
    expect(order(s, z)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(s.getPinnedIndex(id('p2'))).toBe(2);
  });

  it('clamps held indices when a sibling is removed', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p3'), 3);
    s.unregisterNode(id('p0'));
    expect(order(s, z)).toEqual(['p1', 'p2', 'p3']);
    expect(s.getPinnedIndex(id('p3'))).toBe(2);
  });

  it('does not throw when a removal invalidates a held index', () => {
    const { s } = strip(2);
    s.setPinned(id('p1'), 1);
    expect(() => s.unregisterNode(id('p0'))).not.toThrow();
  });

  it('lets an explicit reorder of the pinned node itself move it', () => {
    const { s, z } = strip(4);
    s.setPinned(id('p2'));
    s.reorderInParent(id('p2'), 0);
    expect(order(s, z)).toEqual(['p2', 'p0', 'p1', 'p3']);
    expect(s.getPinnedIndex(id('p2'))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store.pinned.test.ts`
Expected: FAIL — `s.setPinned is not a function`.

- [ ] **Step 3: Implement**

Delete the private `resortByPin` method and both of its call sites (in `reorderInParent` around line 443 and in `setAllowsPinning` around line 735).

Add to `StoreEvents`:

```ts
  'node.pinnedChanged': { id: NodeId; from: number | null; to: number | null };
```

Add the public API next to `setLock`:

```ts
  setPinned(id: NodeId, at?: number): void {
    const node = this.requireNode(id);
    if (!node.membership) {
      throw new InvariantViolationError('pin-unparented', `node ${id} not parented`, { id });
    }
    const parentId = node.membership.parentId;
    const parent = this.requireNode(parentId);
    if (!parent.container) {
      throw new InvariantViolationError('parent-not-container', `parent ${parentId}`, { parentId });
    }
    const length = parent.container.childOrder.length;
    const current = parent.container.childOrder.indexOf(id);
    const target = at ?? current;
    if (target < 0 || target >= length) throw new PinIndexError(id, target, length);

    const from = this.getPinnedIndex(id);
    if (target !== current) this.reorderInParent(id, target, { force: true });
    this.writePin(id, target);
    this.events.emit('node.pinnedChanged', { id, from, to: target });
    trace('store', `setPinned: ${id} @ ${target}`);
    this.scheduleNotify();
  }

  unpin(id: NodeId): void {
    const from = this.getPinnedIndex(id);
    if (from === null) return;
    this.writePin(id, null);
    this.events.emit('node.pinnedChanged', { id, from, to: null });
    this.scheduleNotify();
  }

  getPinnedIndex(id: NodeId): number | null {
    const raw = this.nodesMap.get(id)?.membership?.placement?.pinned;
    return typeof raw === 'number' ? raw : null;
  }

  private writePin(id: NodeId, at: number | null): void {
    this.replaceMembership(id, (m) => {
      const placement = { ...m.placement };
      if (at === null) delete placement.pinned;
      else placement.pinned = at;
      return { ...m, placement };
    });
  }

  private pinnedIndexOf = (id: NodeId): number | null => this.getPinnedIndex(id);
```

Rewrite the mutation body of `reorderInParent` to route through the algorithm, replacing the `splice` pair and the `resortByPin` call:

```ts
    const targetIndex = clampIndex(at, parent.container.childOrder.length - 1);
    if (targetIndex === fromIndex && this.getPinnedIndex(id) === null) return;
    this.replaceContainer(parentId, (c) => ({
      ...c,
      childOrder: placeRespectingPins(c.childOrder, id, targetIndex, this.pinnedIndexOf),
    }));
    this.publisher.markDirty(parentId, { bypass: true });
    const finalIndex =
      this.nodesMap.get(parentId)?.container?.childOrder.indexOf(id) ?? targetIndex;
    if (this.getPinnedIndex(id) !== null && finalIndex !== this.getPinnedIndex(id)) {
      this.writePin(id, finalIndex);
    }
    this.events.emit('node.reordered', { parentId, id, fromIndex, toIndex: finalIndex });
```

Add clamping after any child removal. In `unregisterNode`, after the parent's `childOrder` has been rewritten, call:

```ts
  private clampPins(parentId: NodeId): void {
    const parent = this.nodesMap.get(parentId);
    if (!parent?.container) return;
    const max = parent.container.childOrder.length - 1;
    for (const cid of parent.container.childOrder) {
      const pin = this.getPinnedIndex(cid);
      if (pin === null) continue;
      const actual = parent.container.childOrder.indexOf(cid);
      if (pin > max || pin !== actual) this.writePin(cid, actual);
    }
  }
```

Import `placeRespectingPins` from `./pinning.js` and `PinIndexError` from `./errors.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store.pinned.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Repair existing pinned tests**

Run: `npx vitest run`. Every existing assertion expecting prefix-promotion now fails — these live in `src/store.test.ts`, `src/headline.test.ts`, `src/store.throttle.test.ts`, `src/layout-node-adapter.test.ts`, `src/constructors.test.ts`, and `src/layout/split.test.ts`. Each `placement: { pinned: true }` becomes an explicit `s.setPinned(nodeId, index)` call, and each "moved to front" expectation becomes "stayed put."

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat!: redefine pinned as a held index rather than prefix promotion"
```

---

### Task 9: Pinned children win the capacity race

**Files:**
- Modify: `src/layout/grid.ts` (~174-203)
- Modify: `src/layout/grid.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/layout/grid.test.ts` (match the existing describe/import style in that file):

```ts
describe('gridStrategy — pinned capacity', () => {
  it('overflows unpinned children before pinned ones', () => {
    const items = [
      { id: 'a', placement: {} },
      { id: 'b', placement: {} },
      { id: 'c', placement: { pinned: 2 } },
      { id: 'd', placement: {} },
    ];
    const result = gridStrategy.layout({
      items,
      container: { w: 300, h: 300 },
      state: undefined,
      options: { maxItems: 3 },
    });
    expect(result.unplaced).toEqual(['d']);
    expect([...result.placements.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves ordering untouched when everything fits', () => {
    const items = [
      { id: 'a', placement: {} },
      { id: 'b', placement: { pinned: 1 } },
    ];
    const result = gridStrategy.layout({
      items,
      container: { w: 300, h: 300 },
      state: undefined,
      options: {},
    });
    expect(result.unplaced).toBeUndefined();
  });
});
```

Adjust the `items` shape to match `LayoutNode` as the existing tests in this file construct it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/layout/grid.test.ts -t "pinned capacity"`
Expected: FAIL — `unplaced` is `['d']` only by luck of ordering, or is `['c']`. Confirm the actual failure before proceeding.

- [ ] **Step 3: Implement**

In `grid.ts`, where the capacity cut is made (around line 197), select survivors by pin status before truncating:

```ts
    const capacity =
      cfg.maxItems !== undefined ? Math.max(1, cfg.maxItems) : Number.POSITIVE_INFINITY;
    const isPinned = (it: LayoutNode) => typeof it.placement?.pinned === 'number';
    const keep = new Set<string>();
    for (const it of items) if (isPinned(it) && keep.size < capacity) keep.add(it.id);
    for (const it of items) if (!keep.has(it.id) && keep.size < capacity) keep.add(it.id);

    const unplaced: string[] = [];
    for (const it of items) if (!keep.has(it.id)) unplaced.push(it.id);
```

Then place only items in `keep`, preserving their original order.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/layout/grid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout/grid.ts src/layout/grid.test.ts
git commit -m "feat: give pinned children priority when a container is over capacity"
```

---

## Phase D — React enforcement

### Task 10: Gutters name the panes they resize

**Files:**
- Modify: `src/layout-types.ts` (`Affordance`)
- Modify: `src/layout/split.ts` (~178, ~207)
- Modify: `src/layout/split.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/layout/split.test.ts`:

```ts
describe('splitStrategy — gutter affects', () => {
  it('names the leaves on both sides of a gutter', () => {
    const result = splitStrategy.layout({
      items: [
        { id: 'a', placement: {} },
        { id: 'b', placement: {} },
      ],
      container: { w: 400, h: 200 },
      state: undefined,
      options: {},
    });
    const gutter = result.affordances.find((a) => a.kind === 'drag-x');
    expect(gutter?.affects?.sort()).toEqual(['a', 'b']);
  });

  it('includes every leaf of a nested subtree', () => {
    const result = splitStrategy.layout({
      items: [
        { id: 'a', placement: {} },
        { id: 'b', placement: {} },
        { id: 'c', placement: {} },
      ],
      container: { w: 400, h: 200 },
      state: undefined,
      options: {},
    });
    const outer = result.affordances[0];
    expect(outer?.affects?.length).toBeGreaterThanOrEqual(2);
    for (const affected of outer?.affects ?? []) {
      expect(['a', 'b', 'c']).toContain(affected);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/layout/split.test.ts -t "gutter affects"`
Expected: FAIL — `affects` is undefined.

- [ ] **Step 3: Implement**

In `src/layout-types.ts`, add to `Affordance`:

```ts
  /**
   * Ids whose rect changes when this affordance is dragged. Present on gutters
   * so the React layer can suppress one whose panes are resize-locked.
   */
  affects?: (NodeId | string)[];
```

In `src/layout/split.ts`, add a leaf collector at module scope:

```ts
function leafIds(node: SplitNode, out: string[] = []): string[] {
  if (node.kind === 'leaf') {
    if (node.id) out.push(node.id);
    return out;
  }
  leafIds(node.a, out);
  leafIds(node.b, out);
  return out;
}
```

and add `affects` to both affordance pushes:

```ts
    affordances.push({
      id: `split-${path.join('.')}`,
      kind: 'drag-x',
      rect: { x: rect.x + aSize, y: rect.y, w: gutter, h: rect.h },
      cursor: 'col-resize',
      meta: { path, direction: 'horizontal' },
      affects: [...leafIds(node.a), ...leafIds(node.b)],
    });
```

Do the same for the `drag-y` push, with `direction: 'vertical'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/layout/split.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/layout-types.ts src/layout/split.ts src/layout/split.test.ts
git commit -m "feat: have split gutters name the panes they resize"
```

---

### Task 11: Suppress locked drags and affordances

**Files:**
- Modify: `src/react/dnd/DragController.ts` (~112), `src/react/dnd/useDragHandle.ts` (~79)
- Modify: `src/react/useContainerLayout.ts` (~71-110, ~130-190)
- Modify: `src/react/Container.tsx` (affordance render)
- Create: `src/react/lock.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/react/lock.test.tsx`, following the render/store setup used by the existing React tests in `src/react/`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from '../constructors.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';

const id = (s: string) => asNodeId(s);

describe('React — lock suppression', () => {
  it('renders no gutter when an adjacent pane is resize-locked', () => {
    const s = new Store();
    s.registerNode(createZone({ id: id('z'), strategyId: 'split', config: {} }));
    s.registerNode(createPanel({ id: id('a'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('z') }));
    s.setLock(id('a'), { resize: true });

    render(<TestZone store={s} zoneId={id('z')} affordances />);
    expect(screen.queryByTestId('affordance-split-')).toBeNull();
  });

  it('renders the gutter when neither pane is locked', () => {
    const s = new Store();
    s.registerNode(createZone({ id: id('z'), strategyId: 'split', config: {} }));
    s.registerNode(createPanel({ id: id('a'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('z') }));

    render(<TestZone store={s} zoneId={id('z')} affordances />);
    expect(screen.queryByTestId('affordance-split-')).not.toBeNull();
  });

  it('refuses affordance dispatch on an arrange-locked container', () => {
    const s = new Store();
    s.registerNode(createZone({ id: id('z'), strategyId: 'split', config: {} }));
    s.registerNode(createPanel({ id: id('a'), parentId: id('z') }));
    s.registerNode(createPanel({ id: id('b'), parentId: id('z') }));
    s.setLock(id('z'), { arrange: true });
    const before = s.getContainerState(id('z'));

    // dispatchAffordance is reached through the hook; drive it via the
    // rendered gutter's pointer handlers, or call the hook directly with
    // renderHook if that is the pattern the sibling tests use.
    expect(s.getContainerState(id('z'))).toEqual(before);
  });
});
```

Define `TestZone` in the file as the minimal `<Container>` wrapper the sibling React tests use, and give affordance elements a `data-testid` of `affordance-${affordance.id}` in `Container.tsx` if they do not already carry one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/react/lock.test.tsx`
Expected: FAIL — the gutter renders despite the lock.

- [ ] **Step 3: Guard dispatch**

In `src/react/useContainerLayout.ts`, at the top of the `dispatchAffordance` callback body:

```ts
      if (store.isLocked(parentId, 'arrange')) {
        trace('layout', `dispatchAffordance ${parentId}: REJECTED (lock.arrange)`);
        return;
      }
      const aff = lastLayout.affordances.find((a) => a.id === event.affordanceId);
      const blocked = aff?.affects?.some((cid) => store.isLocked(cid as NodeId, 'resize'));
      if (blocked === true) {
        trace('layout', `dispatchAffordance ${event.affordanceId}: REJECTED (pane lock.resize)`);
        return;
      }
```

- [ ] **Step 4: Suppress rendering**

Compute a suppressed set in the layout memo of `useContainerLayout.ts` and filter it out of the returned `affordances`, so `<Container>` never sees an affordance it must not draw:

```ts
      const visible = result.affordances.filter((a) => {
        if (store.isLocked(parentId, 'arrange')) return false;
        return !a.affects?.some((cid) => store.isLocked(cid as NodeId, 'resize'));
      });
```

Return `visible` in place of `result.affordances`. Filtering at the source means `<Container>` needs no change beyond the `data-testid` from Step 1.

- [ ] **Step 5: Replace the remaining `placement.locked` reads**

`src/react/dnd/DragController.ts` (~112):

```ts
    if (store.isLocked(sourceId, 'move')) {
      trace('dnd', `tryBegin ${sourceId}: REJECTED (lock.move)`);
      return false;
    }
```

`src/react/dnd/useDragHandle.ts` (~79):

```ts
  if (store.isLocked(id, 'move')) {
    return NOOP_HANDLERS;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/react/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/react
git commit -m "feat: suppress drags and affordances the lock forbids"
```

---

### Task 12: Declarative `lock` and `pinned` props

**Files:**
- Modify: `src/react/presets.tsx` (`CommonBindingProps` ~28-39, and the three components)
- Modify: `src/react/useNodeBinding.ts` (reconcile path)
- Modify: `src/react/lock.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/react/lock.test.tsx`:

```tsx
describe('React — declarative lock and pinned props', () => {
  it('applies lock from a Panel prop', () => {
    const s = new Store();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    render(
      <TestZone store={s} zoneId={id('z')}>
        <Panel id={id('p')} lock />
      </TestZone>,
    );
    expect(s.getLock(id('p'))).toEqual({ move: true, resize: true, destroy: true });
  });

  it('applies a partial lock set', () => {
    const s = new Store();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    render(
      <TestZone store={s} zoneId={id('z')}>
        <Panel id={id('p')} lock={{ destroy: true }} />
      </TestZone>,
    );
    expect(s.getLock(id('p'))).toEqual({ destroy: true });
  });

  it('pins to an explicit index from a prop', () => {
    const s = new Store();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    render(
      <TestZone store={s} zoneId={id('z')}>
        <Panel id={id('a')} />
        <Panel id={id('b')} pinned={0} />
      </TestZone>,
    );
    expect(s.getPinnedIndex(id('b'))).toBe(0);
  });

  it('updates the lock when the prop changes', () => {
    const s = new Store();
    s.registerNode(createZone({ id: id('z'), strategyId: 'grid', config: {} }));
    const { rerender } = render(
      <TestZone store={s} zoneId={id('z')}>
        <Panel id={id('p')} lock={{ destroy: true }} />
      </TestZone>,
    );
    rerender(
      <TestZone store={s} zoneId={id('z')}>
        <Panel id={id('p')} lock={false} />
      </TestZone>,
    );
    expect(s.getLock(id('p'))).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/react/lock.test.tsx -t "declarative lock"`
Expected: FAIL — TypeScript rejects the `lock` prop.

- [ ] **Step 3: Add the props**

In `src/react/presets.tsx`, extend `CommonBindingProps`:

```ts
  /** Permissions restricting what the user may do to this node. `true` locks
   *  every axis the node's capabilities support. */
  lock?: boolean | LockSet;
  /** Hold a slot in the parent's childOrder. `true` holds the current index. */
  pinned?: boolean | number;
```

Import `type LockSet` from `../lock.js`.

Each of `Panel`, `Group`, and `Zone` already forwards `meta` and `placement` into the binding; forward `lock` and `pinned` the same way. In the reconcile path of `src/react/useNodeBinding.ts`, apply them after registration:

```ts
      if (lock !== undefined) store.setLock(id, lock);
      if (pinned !== undefined) {
        if (pinned === false) store.unpin(id);
        else store.setPinned(id, pinned === true ? undefined : pinned);
      }
```

`setLock` and `setPinned` are both no-ops when the resolved value is unchanged, so this is safe to run on every reconcile.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/react/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/react
git commit -m "feat: add lock and pinned props to Panel, Group, and Zone"
```

---

## Phase E — persistence and docs

### Task 13: Snapshot v4 with v3 migration

**Files:**
- Modify: `src/snapshot.ts`
- Modify: `src/snapshot.test.ts`
- Modify: `src/history.ts` (wrap restore in `withLocksSuspended`)

- [ ] **Step 1: Write the failing test**

Append to `src/snapshot.test.ts`:

```ts
describe('snapshot v4', () => {
  it('serializes lock and numeric pinned', () => {
    const s = new Store();
    s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    s.setLock(asNodeId('p'), { destroy: true });
    s.setPinned(asNodeId('p'), 0);

    const snap = serialize(s);
    expect(snap.version).toBe(4);
    const p = snap.nodes.find((n) => n.id === 'p');
    expect(p?.lock).toEqual({ destroy: true });
    expect(p?.membership?.placement?.pinned).toBe(0);
  });

  it('round-trips lock and pinned', () => {
    const s = new Store();
    s.registerNode(createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} }));
    s.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
    s.setLock(asNodeId('p'), true);
    s.setPinned(asNodeId('p'), 0);

    const restored = deserialize(serialize(s));
    expect(restored.getLock(asNodeId('p'))).toEqual({
      move: true,
      resize: true,
      destroy: true,
    });
    expect(restored.getPinnedIndex(asNodeId('p'))).toBe(0);
  });

  it('migrates a v3 snapshot: allowsDrop false becomes lock.accept', () => {
    const v3 = {
      version: 3,
      rootIds: ['z'],
      focusedId: null,
      nodes: [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'visible',
          container: {
            strategyId: 'grid',
            config: {},
            childOrder: ['p'],
            allowsPinning: true,
            allowsDrop: false,
            allowsDragOut: false,
          },
        },
        {
          id: 'p',
          kind: 'panel',
          lifecycle: 'visible',
          membership: { parentId: 'z', placement: { locked: true, pinned: true } },
        },
      ],
    };
    const s = deserialize(v3 as never);
    expect(s.getLock(asNodeId('z'))).toEqual({ accept: true, dragOut: true });
    expect(s.getLock(asNodeId('p'))).toEqual({
      move: true,
      resize: true,
      destroy: true,
    });
  });

  it('migrates v3 boolean pinned to the node index and does not promote it', () => {
    const v3 = {
      version: 3,
      rootIds: ['z'],
      focusedId: null,
      nodes: [
        {
          id: 'z',
          kind: 'zone',
          lifecycle: 'visible',
          container: {
            strategyId: 'grid',
            config: {},
            childOrder: ['a', 'b'],
            allowsPinning: true,
          },
        },
        { id: 'a', kind: 'panel', lifecycle: 'visible', membership: { parentId: 'z', placement: {} } },
        {
          id: 'b',
          kind: 'panel',
          lifecycle: 'visible',
          membership: { parentId: 'z', placement: { pinned: true } },
        },
      ],
    };
    const s = deserialize(v3 as never);
    expect(s.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'b']);
    expect(s.getPinnedIndex(asNodeId('b'))).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/snapshot.test.ts -t "snapshot v4"`
Expected: FAIL — version is 3, `lock` is not serialized.

- [ ] **Step 3: Implement**

In `src/snapshot.ts`:

- Bump the `version` literal type and both emit sites from `3` to `4`.
- Add `lock?: LockSet` to `SerializedNode`; emit it when `node.lock` has keys.
- Widen the accepted versions to `2 | 3 | 4`.
- Add the migration, applied when the incoming version is below 4:

```ts
function migrateToV4(node: SerializedNode & Record<string, unknown>): SerializedNode {
  const lock: LockSet = { ...(node.lock ?? {}) };
  const container = node.container as Record<string, unknown> | undefined;
  if (container?.allowsDrop === false) lock.accept = true;
  if (container?.allowsDragOut === false) lock.dragOut = true;
  if (container) {
    delete container.allowsDrop;
    delete container.allowsDragOut;
  }
  const placement = node.membership?.placement as Record<string, unknown> | undefined;
  if (placement?.locked === true) {
    lock.move = true;
    lock.resize = true;
    lock.destroy = true;
    delete placement.locked;
  }
  return Object.keys(lock).length > 0 ? { ...node, lock } : node;
}
```

Boolean `pinned` needs the child's index, which is only known once the parent's `childOrder` is in hand, so resolve it in a second pass after all nodes are constructed: for each container, for each child whose `placement.pinned === true`, write `placement.pinned = childOrder.indexOf(childId)`.

Wrap the node-building loop of `deserialize` in `store.withLocksSuspended(...)` so a restored lock never blocks the restore that is installing it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Suspend locks in history**

In `src/history.ts`, wrap the apply/restore path in `store.withLocksSuspended(() => ...)` and add a test asserting that undo can move a `move`-locked node back:

```ts
it('undoes a move even when the node is move-locked', () => {
  // build store + HistoryController, move a panel, lock it, undo,
  // assert the panel returned to its original parent
});
```

Write that test body out against the existing `HistoryController` setup in `src/history.test.ts` before implementing.

- [ ] **Step 6: Commit**

```bash
git add src/snapshot.ts src/snapshot.test.ts src/history.ts src/history.test.ts
git commit -m "feat!: snapshot v4 with lock and held-index pinned, migrating v3"
```

---

### Task 14: Documentation and version bump

**Files:**
- Modify: `docs/concepts.md`
- Modify: `README.md`
- Modify: `src/index.ts` (`VERSION`)
- Modify: `package.json` (`version`)

- [ ] **Step 1: Fix the version drift**

`src/index.ts` ends with `VERSION = '0.7.0'` while `package.json` says `0.8.0` — they have already drifted. Set both to `0.9.0`.

- [ ] **Step 2: Update `docs/concepts.md`**

- The "Reserved keys on `membership.placement`" section: `locked` is gone, `pinned` is now a number meaning a held index. Add a `node.lock` subsection under Capabilities with the axis table from the spec.
- The Store API list: add `setLock` / `getLock` / `isLocked` / `withLocksSuspended` / `setPinned` / `unpin` / `getPinnedIndex`; remove `setAllowsDrop` / `setAllowsDragOut`.
- The Events block: add `node.lockChanged` and `node.pinnedChanged`; remove `container.allowsDropChanged` and `container.allowsDragOutChanged`.
- The DnD paragraph: the controller now honors `lock.accept`, `lock.dragOut`, `lock.move`, and the destination strategy's `canAccept`.
- **The Snapshot section says "v2" and is already wrong** — it must read v4, accepting v2 and v3.
- Add a sentence distinguishing `acceptsDrops` (registers a drop target) from `lock.accept` (rejects arriving drops).

- [ ] **Step 3: Add the breaking-change note to `README.md`**

Under a `## 0.9.0` heading:

```markdown
### Breaking

- `setAllowsDrop` / `setAllowsDragOut` are removed. Use `store.setLock(id, { accept: true })`
  and `{ dragOut: true }`.
- `membership.placement.locked` is no longer read. Use `store.setLock(id, ...)`, which is
  node-intrinsic and survives `moveNode`.
- `membership.placement.pinned` is a number (the held index), not a boolean. Use
  `store.setPinned(id, at?)`.
- Locking no longer reorders. Previously `locked` implied promotion to the front of the
  parent's `childOrder`; a locked node now stays exactly where it is.
- `container.allowsDropChanged` / `container.allowsDragOutChanged` are replaced by
  `node.lockChanged` and `node.pinnedChanged`.
- Snapshots are v4. `deserialize` still accepts v2 and v3 and migrates on read.
```

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npx vitest run && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add docs/concepts.md README.md src/index.ts package.json
git commit -m "docs: document the lock API and bump to 0.9.0"
```

---

## Self-review notes

**Spec coverage:** every spec section maps to a task — axes and filtering (1), store API and bypass (2), the six guards (3-5), `allows*` absorption (6), pinning algorithm and store API (7-8), capacity race (9), gutter `affects` (10), React suppression (11), preset props (12), snapshot v4 (13), docs including the stale-v2 correction (14).

**Known soft spots for the implementer:**

- Task 3 Step 3 depends on how `unregisterNode` recurses. Read it before editing; if the cascade re-enters the public method, extract a private `destroySubtree` first or locked descendants will wrongly block an ancestor's destroy.
- Task 9 Step 2 asks you to confirm the real failure before implementing — grid's capacity path may already produce the expected array by ordering accident, which would make the test pass for the wrong reason.
- Task 11's third test is a sketch: `dispatchAffordance` is reached through the hook, so write it against whatever pattern the sibling React tests already use (`renderHook` or driving pointer events on the rendered gutter). Do not leave it asserting a tautology.
- Task 8 Step 5 is the largest blast radius in the plan — six test files assert prefix-promotion. Expect that step to take longer than the rest of the task.
