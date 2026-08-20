# Split Operation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `splitStrategy`'s parallel `SplitNode` tree with a `split` store operation that rearranges real nodes, so the node tree is the only tree.

**Architecture:** `split` and `unsplit` are composite operations built entirely on existing public `Store` methods. They live in `src/split.ts` as free functions taking a `Store`; `Store.split` / `Store.unsplit` are thin delegating methods, which keeps the 1049-line `store.ts` from growing another 250. A new `Store.transact` gives any composite operation a single undo boundary. Layout is then `stripStrategy`, which already handles add, remove, reorder, and resize correctly because it is a pure function of `items`.

**Tech Stack:** TypeScript (held at 6.x), vitest, biome, Playwright for e2e. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-19-split-operation-design.md`

**Read first:** `docs/concepts.md`. This plan uses `container` / `membership` / `placement` / `pinned` in their precise windease senses, and getting `container` and `membership` backwards makes the whole thing incoherent. In short: `container` means "can have children" (holds `childOrder`), `membership` means "has a parent" (holds `parentId` + `placement`). A zone is a container with no membership. A panel is the childless one.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/store.ts` (modify) | Add `transact`, `split`, `unsplit` methods + two `StoreEvents` entries. The two split methods delegate immediately. |
| `src/split.ts` (create) | `splitNode()` / `unsplitNode()` — validation, mode resolution, tree construction. All of the real logic. |
| `src/split-types.ts` (create) | `SplitInput` union. Separate so `store.ts` and `split.ts` can both import it without a value cycle. |
| `src/constructors.ts` (modify) | One shared container-node builder; `createZone` gains `parentId?` / `placement?`; `createGroup` becomes a wrapper. |
| `src/react/presets.tsx` (modify) | `<Zone>` gains a `kind` prop; `PresetShell` accepts a free-form `kind`. |
| `src/index.ts` (modify) | Export `SplitInput`. Bump `VERSION`. |
| `src/store.transact.test.ts` (create) | Task 1 tests. |
| `src/split.test.ts` (create) | Tasks 2–5 tests. |
| `src/constructors.test.ts` (modify) | Task 6 tests. |
| `src/react/nested-zone.test.tsx` (create) | Task 6 React test. |
| `e2e/split.spec.ts` (create) | Task 8. |

`src/split.ts` imports `Store` with `import type`, so the cycle with `store.ts` is types-only and erases at build.

---

## Task 1: `Store.transact`

**Files:**
- Modify: `src/store.ts:25` (StoreEvents), and add the method after `flushNow` (`src/store.ts:974`)
- Test: `src/store.transact.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/store.transact.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { asNodeId, createPanel, createZone, Store } from './index.js';

describe('Store.transact', () => {
  it('emits one begin/end pair around the callback', () => {
    const store = new Store();
    const seen: string[] = [];
    store.events.on('transaction.begin', () => seen.push('begin'));
    store.events.on('transaction.end', () => seen.push('end'));

    store.transact(() => {
      store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: {} }));
      store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    });

    expect(seen).toEqual(['begin', 'end']);
  });

  it('emits only for the outermost frame when nested', () => {
    const store = new Store();
    const seen: string[] = [];
    store.events.on('transaction.begin', () => seen.push('begin'));
    store.events.on('transaction.end', () => seen.push('end'));

    store.transact(() => {
      store.transact(() => {
        store.transact(() => {});
      });
    });

    expect(seen).toEqual(['begin', 'end']);
  });

  it('carries the label on both events', () => {
    const store = new Store();
    const begin = vi.fn();
    const end = vi.fn();
    store.events.on('transaction.begin', begin);
    store.events.on('transaction.end', end);

    store.transact(() => {}, 'split');

    expect(begin).toHaveBeenCalledWith({ label: 'split' });
    expect(end).toHaveBeenCalledWith({ label: 'split' });
  });

  it('closes the pair and rethrows when the callback throws', () => {
    const store = new Store();
    const end = vi.fn();
    store.events.on('transaction.end', end);

    expect(() => store.transact(() => { throw new Error('boom'); })).toThrow('boom');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('does not stick the depth counter after a throw', () => {
    const store = new Store();
    const begin = vi.fn();
    store.events.on('transaction.begin', begin);

    expect(() => store.transact(() => { throw new Error('boom'); })).toThrow();
    store.transact(() => {});

    expect(begin).toHaveBeenCalledTimes(2);
  });

  it('does not roll back mutations made before a throw', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: {} }));

    expect(() =>
      store.transact(() => {
        store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
        throw new Error('boom');
      }),
    ).toThrow();

    expect(store.getNode(asNodeId('a'))).toBeDefined();
  });

  it('collapses a transact called from a begin listener', () => {
    const store = new Store();
    const seen: string[] = [];
    store.events.on('transaction.begin', () => {
      seen.push('begin');
      if (seen.length === 1) store.transact(() => {});
    });
    store.events.on('transaction.end', () => seen.push('end'));

    store.transact(() => {});

    expect(seen).toEqual(['begin', 'end']);
  });

  it('closes correctly when a nested frame throws', () => {
    const store = new Store();
    const seen: string[] = [];
    store.events.on('transaction.begin', () => seen.push('begin'));
    store.events.on('transaction.end', () => seen.push('end'));

    expect(() =>
      store.transact(() => {
        store.transact(() => {
          throw new Error('boom');
        });
      }),
    ).toThrow('boom');

    expect(seen).toEqual(['begin', 'end']);
    // Depth reset, so the next transaction still emits.
    store.transact(() => {});
    expect(seen).toEqual(['begin', 'end', 'begin', 'end']);
  });

  it('still coalesces subscriber notifications to one', async () => {
    const store = new Store();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.transact(() => {
      store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: {} }));
      store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
      store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    });
    await Promise.resolve();

    expect(notifications).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store.transact.test.ts`
Expected: FAIL — `store.transact is not a function`

- [ ] **Step 3: Add the two events**

In `src/store.ts`, inside `interface StoreEvents`, add after the `'container.stateChanged'` entry:

```ts
  /**
   * A composite operation started. Bracket history pushes on this pair to get
   * one undo step for the whole operation: the `node.*` events are synchronous
   * and per-mutation, so an unbracketed listener sees one `split` as many
   * separate changes.
   */
  'transaction.begin': { label?: string };
  /** Closes a `transaction.begin`. Fires even when the callback threw. */
  'transaction.end': { label?: string };
```

- [ ] **Step 4: Add the depth counter and the method**

In `src/store.ts`, next to `private locksSuspended = 0;` (line 103), add:

```ts
  private txnDepth = 0;
```

And after `flushNow()` (ends line 976), add:

```ts
  /**
   * Run `fn` as one logical change, emitting `transaction.begin` /
   * `transaction.end` around it. Re-entrant: only the outermost call emits.
   *
   * Does NOT roll back. If `fn` throws, the pair still closes and the throw
   * propagates, but whatever was already mutated stays mutated.
   */
  transact(fn: () => void, label?: string): void {
    // Increment BEFORE emitting: a `transaction.begin` listener that itself
    // calls `transact` must not read depth 0 and start a second transaction.
    const outermost = this.txnDepth === 0;
    this.txnDepth += 1;
    if (outermost) this.events.emit('transaction.begin', label === undefined ? {} : { label });
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
      throw e;
    } finally {
      this.txnDepth -= 1;
      if (this.txnDepth === 0) {
        this.events.emit('transaction.end', label === undefined ? {} : { label });
        trace('store', `transact: ${label ?? '(unlabeled)'}${threw ? ' (threw)' : ''}`);
      }
    }
  }
```

The begin and end payloads are separate literals on purpose: sharing one object
would let a `begin` listener mutate what `end` listeners receive.

The `end` side needs no equivalent guard — depth is already back to 0 before it
emits, so a `transact` from an `end` listener correctly starts a new transaction.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/store.transact.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass, 633 tests

- [ ] **Step 7: Commit**

```bash
git add src/store.ts src/store.transact.test.ts
git commit -m "feat(store): add transact for single-undo-step composites"
```

---

## Task 2: `SplitInput` and validation

Validation lands before any tree-building so that every later task can assume a valid input. `splitNode` throws for now after validating — the modes arrive in Tasks 3–5.

**Files:**
- Create: `src/split-types.ts`
- Create: `src/split.ts`
- Modify: `src/store.ts` (add `split` method), `src/index.ts`
- Test: `src/split.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/split.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asNodeId, createPanel, createZone, Store } from './index.js';

function seeded(): Store {
  const store = new Store();
  store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }));
  store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
  return store;
}

describe('Store.split validation', () => {
  it('throws unknown-node for an absent target', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('nope'), { direction: 'x', groupId: asNodeId('g'), newIds: [asNodeId('p2')] }),
    ).toThrow(/nope/);
  });

  it('throws split-arity when newIds disagrees with into', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'x',
        into: 3,
        groupId: asNodeId('g'),
        newIds: [asNodeId('p2')],
      }),
    ).toThrow(/split-arity|newIds/);
  });

  it('throws split-arity when into is below 2', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'x', into: 1, groupId: asNodeId('g'), newIds: [] }),
    ).toThrow(/split-arity|into/);
  });

  it('throws duplicate-id when a newId is already registered', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'x', groupId: asNodeId('g'), newIds: [asNodeId('p1')] }),
    ).toThrow(/p1/);
  });

  it('throws duplicate-id when the call repeats an id internally', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'x',
        into: 3,
        groupId: asNodeId('g'),
        newIds: [asNodeId('p2'), asNodeId('p2')],
      }),
    ).toThrow(/p2/);
  });

  it('throws split-missing-group-id when wrap mode has no groupId', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'y', newIds: [asNodeId('p2')] }),
    ).toThrow(/split-missing-group-id|groupId/);
  });

  it('leaves the store untouched when validation throws', () => {
    const store = seeded();
    const before = store.getContainerView(asNodeId('z'))?.childOrder;
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'y', newIds: [asNodeId('p2')] }),
    ).toThrow();
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(before);
    expect(store.getNode(asNodeId('p2'))).toBeUndefined();
  });

  it('throws duplicate-id when groupId collides in wrap mode', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'y', groupId: asNodeId('z'), newIds: [asNodeId('p2')] }),
    ).toThrow(/z/);
  });

  it('throws duplicate-id when groupId repeats a newId', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'y', groupId: asNodeId('p2'), newIds: [asNodeId('p2')] }),
    ).toThrow(/p2/);
  });

  it('ignores a colliding groupId when flattening, since it is never registered', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'x', groupId: asNodeId('z'), newIds: [asNodeId('p2')] }),
    ).toThrow(/split-unimplemented/);
  });
});
```

The last one asserts `split-unimplemented` because it has to get *past* validation
and reach the placeholder — an unused `groupId` colliding must not be rejected.
Once Task 3 lands, change that assertion to `not.toThrow()`.

Note: `direction: 'y'` in the last two tests resolves to wrap mode, because the seeded zone's strip axis is `'x'`. That is what makes `groupId` required there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/split.test.ts`
Expected: FAIL — `store.split is not a function`

- [ ] **Step 3: Create the input types**

Create `src/split-types.ts`:

```ts
import type { NodeId } from './node.js';

/**
 * Input bag for `Store.split`. Discriminated on `direction`, so each mode
 * requires exactly the ids it needs.
 *
 * Named `SplitInput` to match `CreateZoneInput` / `CreatePanelInput`, and
 * because `SplitOptions` is already taken by the deprecated `splitStrategy`.
 */
export type SplitInput =
  | {
      direction: 'x' | 'y';
      /** Total children after the split. Default 2, must be >= 2. */
      into?: number;
      /** Required in wrap mode; unused when flattening or reconfiguring. */
      groupId?: NodeId;
      /** Length must be `into - 1`. */
      newIds: readonly NodeId[];
      /** Merged over every container config this call writes. */
      config?: Record<string, unknown>;
      force?: boolean;
    }
  | {
      direction: 'both';
      /** `[cols, rows]`. Both >= 1, product >= 2. */
      into: readonly [number, number];
      /** Outer group, then one per column, left to right. */
      groupIds: readonly NodeId[];
      /** Length must be `cols * rows - 1`. Fills column-major. */
      newIds: readonly NodeId[];
      config?: Record<string, unknown>;
      force?: boolean;
    }
  | {
      /**
       * One `gridStrategy` container, no nesting.
       *
       * NOTE: `gridStrategy` ignores `placement.size`, so a tiling built this
       * way has **no draggable gutters**. Use `'both'` if the panes must be
       * resizable.
       */
      direction: 'grid';
      into: number;
      /** Passed through to the grid config; grid's default applies if omitted. */
      cols?: number;
      groupId?: NodeId;
      newIds: readonly NodeId[];
      config?: Record<string, unknown>;
      force?: boolean;
    };
```

- [ ] **Step 4: Create `src/split.ts` with validation only**

```ts
import { DuplicateNodeError, InvariantViolationError, NodeNotFoundError } from './errors.js';
import type { NodeId } from './node.js';
import type { SplitInput } from './split-types.js';
import type { Store } from './store.js';

export type SplitMode = 'wrap' | 'flatten' | 'reconfigure';

/** Total children the split produces, including the target. */
function totalChildren(input: SplitInput): number {
  if (input.direction === 'both') return input.into[0] * input.into[1];
  if (input.direction === 'grid') return input.into;
  return input.into ?? 2;
}

/** Ids this call will actually register, which depends on the mode: a
 *  `groupId` is unused when flattening or reconfiguring. */
function mintedIds(input: SplitInput, mode: SplitMode): NodeId[] {
  if (input.direction === 'both') {
    const groups = mode === 'reconfigure' ? input.groupIds.slice(1) : [...input.groupIds];
    return [...groups, ...input.newIds];
  }
  const group = mode === 'wrap' && input.groupId ? [input.groupId] : [];
  return [...group, ...input.newIds];
}

export function resolveMode(store: Store, id: NodeId, input: SplitInput): SplitMode {
  const node = store.getNodeTruth(id);
  if (!node?.membership) return 'reconfigure';
  if (input.direction === 'x' || input.direction === 'y') {
    const parent = store.getNodeTruth(node.membership.parentId);
    const cfg = parent?.container?.config as { axis?: string } | undefined;
    if (parent?.container?.strategyId === 'strip' && (cfg?.axis ?? 'x') === input.direction) {
      return 'flatten';
    }
  }
  return 'wrap';
}

export function validateSplit(store: Store, id: NodeId, input: SplitInput): SplitMode {
  if (!store.getNodeTruth(id)) {
    throw new NodeNotFoundError(id);
  }

  // Resolved before the arity checks because the duplicate scan below needs to
  // know which ids this mode will actually register.
  const mode = resolveMode(store, id, input);

  const total = totalChildren(input);
  if (input.direction === 'both') {
    const [cols, rows] = input.into;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      throw new InvariantViolationError(
        'split-arity',
        `into must be two positive integers, got [${cols}, ${rows}]`,
        { into: input.into },
      );
    }
  }
  if (total < 2 || !Number.isInteger(total)) {
    throw new InvariantViolationError(
      'split-arity',
      `into must produce at least 2 children, got ${total}`,
      { into: input.into },
    );
  }
  if (input.newIds.length !== total - 1) {
    throw new InvariantViolationError(
      'split-arity',
      `newIds must have ${total - 1} entries for a split into ${total}, got ${input.newIds.length}`,
      { expected: total - 1, actual: input.newIds.length },
    );
  }

  const seen = new Set<NodeId>();
  for (const mid of mintedIds(input, mode)) {
    if (seen.has(mid)) {
      throw new DuplicateNodeError(mid);
    }
    seen.add(mid);
    if (store.getNodeTruth(mid)) throw new DuplicateNodeError(mid);
  }

  // Counted in every mode: at a root the outer entry is unused, but the column
  // groups are still built, so the required length is the same either way.
  if (input.direction === 'both') {
    const needed = 1 + input.into[0];
    if (input.groupIds.length !== needed) {
      throw new InvariantViolationError(
        'split-missing-group-id',
        `direction 'both' into [${input.into[0]}, ${input.into[1]}] needs ${needed} groupIds, got ${input.groupIds.length}`,
        { expected: needed, actual: input.groupIds.length },
      );
    }
  } else if (mode === 'wrap' && !input.groupId) {
    throw new InvariantViolationError(
      'split-missing-group-id',
      `split of ${id} wraps it in a new group and needs a groupId`,
      { id },
    );
  }
  return mode;
}

export function splitNode(store: Store, id: NodeId, input: SplitInput): void {
  validateSplit(store, id, input);
  throw new InvariantViolationError('split-unimplemented', 'split modes land in tasks 3-5', { id });
}
```

- [ ] **Step 5: Delegate from `Store`**

In `src/store.ts`, add to the imports:

```ts
import { splitNode } from './split.js';
import type { SplitInput } from './split-types.js';
```

And add the method after `transact`:

```ts
  /**
   * Put this node's content in child 0 of a strip or grid container.
   *
   * Which of three things that means is forced by the node's position:
   * a node with a parent is **wrapped** in a new group; a node whose parent is
   * already a strip on the requested axis gets its new siblings **flattened**
   * in beside it; a root has nothing above it to interpose, so it **becomes**
   * the container.
   *
   * All ids are caller-supplied — the store has no id generator. Validation
   * runs before any mutation, so a rejected split leaves the store untouched.
   *
   * Runs inside `transact`, so a history integration bracketed on
   * `transaction.begin` / `transaction.end` records one undo step.
   */
  split(id: NodeId, input: SplitInput): void {
    splitNode(this, id, input);
  }
```

- [ ] **Step 6: Export the type**

In `src/index.ts`, after the `./snapshot.js` export block, add:

```ts
export type { SplitInput } from './split-types.js';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/split.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 8: Run the full suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add src/split-types.ts src/split.ts src/store.ts src/index.ts src/split.test.ts
git commit -m "feat(split): validate split input and resolve the mode"
```

---

## Task 3: Wrap and flatten modes for `'x'` / `'y'`

**Files:**
- Modify: `src/split.ts`
- Test: `src/split.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/split.test.ts`:

```ts
describe('Store.split — wrap mode', () => {
  it('interposes a group at the target index and puts the target at 0', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'g', 'b']);
    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2']);
    expect(store.getNode(asNodeId('p1'))?.membership?.parentId).toBe('g');
  });

  it('gives the group a strip container on the requested axis', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    const g = store.getNode(asNodeId('g'));
    expect(g?.container?.strategyId).toBe('strip');
    expect(g?.container?.config).toMatchObject({ axis: 'y' });
  });

  it('merges config over the strip config', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
      config: { gap: 8 },
    });

    expect(store.getNode(asNodeId('g'))?.container?.config).toMatchObject({ axis: 'y', gap: 8 });
  });

  it('honors into for more than two children', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      into: 4,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('transfers the target placement to the group and clears the target', () => {
    const store = seeded();
    store.patchPlacement(asNodeId('p1'), { size: { w: 300 } });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getPlacement(asNodeId('g'))).toMatchObject({ size: { w: 300 } });
    expect(store.getPlacement(asNodeId('p1')).size).toBeUndefined();
  });

  it('transfers a pinned index to the group', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.setPinned(asNodeId('p1'), 0);

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getPinnedIndex(asNodeId('g'))).toBe(0);
    expect(store.getPinnedIndex(asNodeId('p1'))).toBeNull();
  });

  it('wraps a group target the same way it wraps a panel', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }));
    // createGroup, not createZone({parentId}) — that arrives in Task 8.
    store.registerNode(createGroup({ id: asNodeId('inner'), parentId: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('inner'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['inner', 'p2']);
  });
});

describe('Store.split — flatten mode', () => {
  it('inserts siblings after the target when the parent axis matches', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'x',
      groupId: asNodeId('unused'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2', 'b']);
    expect(store.getNode(asNodeId('unused'))).toBeUndefined();
  });

  it('needs no groupId when flattening', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'x', newIds: [asNodeId('p2')] }),
    ).not.toThrow();
  });

  it('treats a strip with no explicit axis as x', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), { direction: 'x', newIds: [asNodeId('p2')] });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2']);
  });

  it('wraps rather than flattens when the axis differs', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['g']);
  });

  it('wraps rather than flattens when the parent is not a strip', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'x',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['g']);
  });
});

describe('Store.split — atomicity', () => {
  it('emits one transaction pair per split', () => {
    const store = seeded();
    let pairs = 0;
    store.events.on('transaction.end', () => { pairs += 1; });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(pairs).toBe(1);
  });

  it('notifies subscribers once', async () => {
    const store = seeded();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });
    await Promise.resolve();

    expect(notifications).toBe(1);
  });
});
```

Also update the import at the top of the file to add `createGroup`, and flip the
Task 2 test that asserted the placeholder — flatten works now:

```ts
  it('ignores a colliding groupId when flattening, since it is never registered', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), { direction: 'x', groupId: asNodeId('z'), newIds: [asNodeId('p2')] }),
    ).not.toThrow();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/split.test.ts`
Expected: FAIL — `split-unimplemented`

- [ ] **Step 3: Implement wrap and flatten**

In `src/split.ts`, add these imports at the top:

```ts
import { createGroup, createPanel } from './constructors.js';
import { trace } from './trace.js';
```

Add these helpers above `splitNode`:

```ts
/** Strip config for an axis, with the caller's config merged over it. */
function stripConfig(axis: 'x' | 'y', extra?: Record<string, unknown>): Record<string, unknown> {
  return { axis, ...extra };
}

/** Lock axes `split` enforces itself. Internal calls then run suspended, so a
 *  guard on a public method cannot fire partway and leave a half-built tree. */
function assertSplitUnlocked(store: Store, id: NodeId, mode: SplitMode, force: boolean): void {
  if (force) return;
  const node = store.getNodeTruth(id);
  const check = (target: NodeId, axis: 'move' | 'arrange' | 'dragOut') => {
    if (store.isLocked(target, axis)) {
      throw new LockedError(target, axis, 'split');
    }
  };
  if (mode === 'reconfigure') {
    check(id, 'arrange');
    return;
  }
  const parentId = node?.membership?.parentId;
  if (!parentId) return;
  if (mode === 'flatten') {
    check(parentId, 'arrange');
    return;
  }
  check(id, 'move');
  check(parentId, 'dragOut');
  check(parentId, 'arrange');
}
```

Add `LockedError` to the `./errors.js` import.

Replace the body of `splitNode` with:

```ts
export function splitNode(store: Store, id: NodeId, input: SplitInput): void {
  const mode = validateSplit(store, id, input);
  assertSplitUnlocked(store, id, mode, input.force === true);

  store.transact(() => {
    store.withLocksSuspended(() => {
      if (mode === 'flatten') {
        applyFlatten(store, id, input);
      } else if (mode === 'wrap') {
        applyWrap(store, id, input);
      } else {
        applyReconfigure(store, id, input);
      }
    });
  }, 'split');
}
```

Add `applyFlatten` and `applyWrap`. `applyReconfigure` and the `'both'` / `'grid'` branches arrive in Tasks 4 and 5 — until then they throw, which the existing `split-unimplemented` test path covers.

```ts
function applyFlatten(store: Store, id: NodeId, input: SplitInput): void {
  const node = store.getNodeTruth(id);
  const parentId = node?.membership?.parentId;
  if (!parentId) return;
  const order = store.getContainerView(parentId)?.childOrder ?? [];
  let at = order.indexOf(id);
  for (const newId of input.newIds) {
    at += 1;
    store.registerNode(createPanel({ id: newId, parentId }));
    store.reorderInParent(newId, at);
  }
  trace('store', `split: flatten ${id} → ${parentId}@${order.indexOf(id)} (+${input.newIds.length})`);
}

function applyWrap(store: Store, id: NodeId, input: SplitInput): void {
  if (input.direction === 'both' || input.direction === 'grid') {
    throw new InvariantViolationError('split-unimplemented', 'both/grid land in tasks 4-5', { id });
  }
  const node = store.getNodeTruth(id);
  const parentId = node?.membership?.parentId;
  const groupId = input.groupId;
  if (!parentId || !groupId) return;

  const order = store.getContainerView(parentId)?.childOrder ?? [];
  const at = order.indexOf(id);
  const placement = { ...(node?.membership?.placement ?? {}) };
  const pinned = store.getPinnedIndex(id);
  delete placement.pinned;

  store.registerNode(
    createGroup({
      id: groupId,
      parentId,
      strategyId: 'strip',
      config: stripConfig(input.direction, input.config),
      placement,
    }),
  );
  store.reorderInParent(groupId, at);
  store.moveNode(id, groupId, 0);
  store.patchPlacement(id, { size: undefined });
  store.unpin(id);
  for (const newId of input.newIds) {
    store.registerNode(createPanel({ id: newId, parentId: groupId }));
  }
  if (pinned !== null) store.setPinned(groupId, pinned);

  trace('store', `split: wrap ${id} → ${groupId}@${at} (strip ${input.direction}, ${input.newIds.length + 1} children)`);
}
```

Two traps in that function, both of which produce a silently wrong tree rather
than an error:

- **`patchPlacement` refuses to write `pinned` at all**, even as `undefined`
  (`src/store.ts:566-573`) — a direct write skips the bounds check and
  displacement routing and desyncs from `childOrder`. Clear it with `unpin`.
- **The group must be reordered to the target's index before `moveNode` pulls
  the target out.** `registerNode` appends, so the group starts at the end.

`splitNode`'s `else` branch names `applyReconfigure`, so a stub that throws the
placeholder has to exist in this task; its body is Task 4.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/split.test.ts`
Expected: PASS — the wrap, flatten and atomicity blocks

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/split.ts src/split.test.ts
git commit -m "feat(split): wrap and flatten modes for the x and y directions"
```

---

## Task 4: Reconfigure mode

**Files:**
- Modify: `src/split.ts`
- Test: `src/split.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/split.test.ts`:

```ts
describe('Store.split — reconfigure mode', () => {
  it('makes an empty root the container and registers the new panels', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('z'), {
      direction: 'x',
      into: 3,
      newIds: [asNodeId('p1'), asNodeId('p2')],
    });

    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('strip');
    expect(store.getNode(asNodeId('z'))?.container?.config).toMatchObject({ axis: 'x' });
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1', 'p2']);
  });

  it('takes into - 1 newIds even at a root, so an empty root gains into - 1 children', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('z'), { direction: 'x', into: 3, newIds: [asNodeId('a'), asNodeId('b')] });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'b']);
  });

  it('keeps existing children ahead of the new ones', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('old'), parentId: asNodeId('z') }));

    store.split(asNodeId('z'), { direction: 'y', newIds: [asNodeId('new')] });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['old', 'new']);
  });

  it('ignores groupId at a root', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('z'), {
      direction: 'x',
      groupId: asNodeId('unused'),
      newIds: [asNodeId('p1')],
    });

    expect(store.getNode(asNodeId('unused'))).toBeUndefined();
  });

  it('gives a container-less root a container', () => {
    const store = new Store();
    const orphan = createZone({ id: asNodeId('o'), strategyId: 'stack', config: {} });
    delete (orphan as { container?: unknown }).container;
    store.registerNode(orphan);

    store.split(asNodeId('o'), { direction: 'x', newIds: [asNodeId('p1')] });

    expect(store.getNode(asNodeId('o'))?.container?.strategyId).toBe('strip');
    expect(store.getContainerView(asNodeId('o'))?.childOrder).toEqual(['p1']);
  });
});
```

Note the arity rule is uniform: `newIds.length === into - 1` in every mode. At a root that means an empty zone split `into: 2` ends up with one child, not two — the target itself is counted as the first, exactly as when wrapping. The second test pins that down so nobody "fixes" it later.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/split.test.ts -t reconfigure`
Expected: FAIL — `split-unimplemented`

- [ ] **Step 3: Add the two missing Store primitives**

`Store` has no public way to change `strategyId`, and no way to give an existing
node a `container` — reconfigure needs both. In `src/store.ts`, after
`setContainerState`:

```ts
  /**
   * Swap the layout strategy for `id`'s container. The persisted `state` is
   * dropped — it belongs to the outgoing strategy — but the config is NOT
   * migrated; pass a matching one through `updateContainerConfig`.
   */
  setStrategy(id: NodeId, strategyId: string, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'arrange', 'setStrategy', opts);
    const node = this.requireNode(id);
    if (!node.container) throw new CapabilityMissingError(id, 'container', 'setStrategy');
    const from = node.container.strategyId;
    if (from === strategyId) return;
    const priorState = node.container.state;
    this.replaceContainer(id, (c) => ({ ...c, strategyId, state: undefined }));
    this.events.emit('container.strategyChanged', { id, from, to: strategyId });
    if (priorState !== undefined) {
      this.events.emit('container.stateChanged', { id, from: priorState, to: undefined });
    }
    trace('store', `strategy: ${id} ${from} → ${strategyId} (state cleared)`);
    this.scheduleNotify();
  }

  /**
   * Give `id` a container capability if it has none. No-op when it already
   * has one — the existing `childOrder` and config are left alone.
   */
  ensureContainer(id: NodeId, strategyId: string, config: unknown, opts?: MutateOptions): void {
    this.assertUnlocked(id, 'arrange', 'ensureContainer', opts);
    const node = this.requireNode(id);
    if (node.container) return;
    this.nodesMap.set(id, {
      ...node,
      container: { strategyId, config, childOrder: [], allowsPinning: true },
    });
    this.publisher.markDirty(id, { bypass: true });
    trace('store', `ensureContainer: ${id} (${strategyId})`);
    this.scheduleNotify();
  }
```

Add the event to `StoreEvents`:

```ts
  'container.strategyChanged': { id: NodeId; from: string; to: string };
```

- [ ] **Step 4: Implement reconfigure**

Add to `src/split.ts`:

```ts
function applyReconfigure(store: Store, id: NodeId, input: SplitInput): void {
  if (input.direction === 'both' || input.direction === 'grid') {
    throw new InvariantViolationError('split-unimplemented', 'both/grid land in task 5', { id });
  }
  const hadContainer = store.getNodeTruth(id)?.container !== undefined;
  const config = stripConfig(input.direction, input.config);
  store.ensureContainer(id, 'strip', config);
  if (hadContainer) {
    store.setStrategy(id, 'strip');
    store.updateContainerConfig(id, config);
  }
  for (const newId of input.newIds) {
    store.registerNode(createPanel({ id: newId, parentId: id }));
  }
  trace('store', `split: reconfigure ${id} (strip ${input.direction}, +${input.newIds.length})`);
}
```

The `hadContainer` gate is not an optimization. `ensureContainer` already writes
the final config when it creates one, and `updateContainerConfig`'s no-op guard
is reference equality — so calling it again would emit `container.configChanged`
for a change that did not semantically happen.

Task 5 needs this same sequence twice more. Extract it there as a
`becomeContainer(store, id, strategyId, config)` helper rather than repeating it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/split.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add src/split.ts src/store.ts src/split.test.ts
git commit -m "feat(split): reconfigure a root in place, with setStrategy and ensureContainer"
```

---

## Task 5: `'both'` and `'grid'` directions

**Files:**
- Modify: `src/split.ts`
- Test: `src/split.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/split.test.ts`:

```ts
describe("Store.split — direction 'both'", () => {
  it('builds an outer x strip of inner y strips, filling column-major', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'both',
      into: [2, 2],
      groupIds: [asNodeId('g'), asNodeId('c0'), asNodeId('c1')],
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    expect(store.getNode(asNodeId('g'))?.container?.config).toMatchObject({ axis: 'x' });
    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['c0', 'c1']);
    expect(store.getNode(asNodeId('c0'))?.container?.config).toMatchObject({ axis: 'y' });
    expect(store.getContainerView(asNodeId('c0'))?.childOrder).toEqual(['p1', 'p2']);
    expect(store.getContainerView(asNodeId('c1'))?.childOrder).toEqual(['p3', 'p4']);
  });

  it('handles a non-square grid', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'both',
      into: [3, 2],
      groupIds: [asNodeId('g'), asNodeId('c0'), asNodeId('c1'), asNodeId('c2')],
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4'), asNodeId('p5'), asNodeId('p6')],
    });

    expect(store.getContainerView(asNodeId('c0'))?.childOrder).toEqual(['p1', 'p2']);
    expect(store.getContainerView(asNodeId('c1'))?.childOrder).toEqual(['p3', 'p4']);
    expect(store.getContainerView(asNodeId('c2'))?.childOrder).toEqual(['p5', 'p6']);
  });

  it('throws when groupIds is not 1 + cols', () => {
    const store = seeded();
    expect(() =>
      store.split(asNodeId('p1'), {
        direction: 'both',
        into: [2, 2],
        groupIds: [asNodeId('g'), asNodeId('c0')],
        newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
      }),
    ).toThrow(/groupIds/);
  });

  it('replaces the target at its old index in the parent', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));

    store.split(asNodeId('p1'), {
      direction: 'both',
      into: [2, 2],
      groupIds: [asNodeId('g'), asNodeId('c0'), asNodeId('c1')],
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'g']);
  });
});

describe("Store.split — direction 'grid'", () => {
  it('builds one grid container with all children flat', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'grid',
      into: 4,
      cols: 2,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    expect(store.getNode(asNodeId('g'))?.container?.strategyId).toBe('grid');
    expect(store.getNode(asNodeId('g'))?.container?.config).toMatchObject({ cols: 2 });
    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('omits cols from the config when not given', () => {
    const store = seeded();

    store.split(asNodeId('p1'), {
      direction: 'grid',
      into: 2,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
    });

    expect(store.getNode(asNodeId('g'))?.container?.config).not.toHaveProperty('cols');
  });

  it('reconfigures a root into a grid', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));

    store.split(asNodeId('z'), {
      direction: 'grid',
      into: 3,
      cols: 3,
      newIds: [asNodeId('a'), asNodeId('b')],
    });

    expect(store.getNode(asNodeId('z'))?.container?.strategyId).toBe('grid');
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/split.test.ts -t "both'"`
Expected: FAIL — `split-unimplemented`

- [ ] **Step 3: Implement both and grid**

In `src/split.ts`, add:

```ts
function gridConfig(cols: number | undefined, extra?: Record<string, unknown>): Record<string, unknown> {
  return cols === undefined ? { ...extra } : { cols, ...extra };
}

/** Make `id` a container running `strategyId`. Extracted from Task 4's inline
 *  gate, which must survive: re-writing the config `ensureContainer` just
 *  created would emit a `configChanged` for a change that did not happen. */
function becomeContainer(
  store: Store,
  id: NodeId,
  strategyId: string,
  config: Record<string, unknown>,
): void {
  const had = store.getNodeTruth(id)?.container !== undefined;
  store.ensureContainer(id, strategyId, config);
  if (had) {
    store.setStrategy(id, strategyId);
    store.updateContainerConfig(id, config);
  }
}

/** Build the nested column groups for `direction: 'both'` under `outerId`,
 *  with `id` already sitting at column 0 row 0. */
function buildColumns(
  store: Store,
  id: NodeId,
  outerId: NodeId,
  columnIds: readonly NodeId[],
  newIds: readonly NodeId[],
  rows: number,
  extra: Record<string, unknown> | undefined,
): void {
  let cursor = 0;
  columnIds.forEach((columnId, col) => {
    store.registerNode(
      createGroup({
        id: columnId,
        parentId: outerId,
        strategyId: 'strip',
        config: stripConfig('y', extra),
      }),
    );
    for (let row = 0; row < rows; row += 1) {
      if (col === 0 && row === 0) {
        store.moveNode(id, columnId, 0);
        store.patchPlacement(id, { size: undefined });
        store.unpin(id);
        continue;
      }
      const newId = newIds[cursor];
      cursor += 1;
      if (newId === undefined) return;
      store.registerNode(createPanel({ id: newId, parentId: columnId }));
    }
  });
}
```

Then replace the `both`/`grid` guards in `applyWrap` and `applyReconfigure`.

`applyWrap` becomes:

```ts
function applyWrap(store: Store, id: NodeId, input: SplitInput): void {
  const node = store.getNodeTruth(id);
  const parentId = node?.membership?.parentId;
  if (!parentId) return;
  const groupId = input.direction === 'both' ? input.groupIds[0] : input.groupId;
  if (!groupId) return;

  const order = store.getContainerView(parentId)?.childOrder ?? [];
  const at = order.indexOf(id);
  const placement = { ...(node?.membership?.placement ?? {}) };
  const pinned = store.getPinnedIndex(id);
  delete placement.pinned;

  const outerConfig =
    input.direction === 'both'
      ? stripConfig('x', input.config)
      : input.direction === 'grid'
        ? gridConfig(input.cols, input.config)
        : stripConfig(input.direction, input.config);

  store.registerNode(
    createGroup({
      id: groupId,
      parentId,
      strategyId: input.direction === 'grid' ? 'grid' : 'strip',
      config: outerConfig,
      placement,
    }),
  );
  store.reorderInParent(groupId, at);

  if (input.direction === 'both') {
    buildColumns(store, id, groupId, input.groupIds.slice(1), input.newIds, input.into[1], input.config);
  } else {
    store.moveNode(id, groupId, 0);
    store.patchPlacement(id, { size: undefined });
    store.unpin(id);
    for (const newId of input.newIds) {
      store.registerNode(createPanel({ id: newId, parentId: groupId }));
    }
  }
  if (pinned !== null) store.setPinned(groupId, pinned);

  trace('store', `split: wrap ${id} → ${groupId}@${at} (${input.direction}, ${input.newIds.length + 1} children)`);
}
```

`applyReconfigure` becomes:

```ts
function applyReconfigure(store: Store, id: NodeId, input: SplitInput): void {
  if (input.direction === 'both') {
    becomeContainer(store, id, 'strip', stripConfig('x', input.config));
    let cursor = 0;
    input.groupIds.slice(1).forEach((columnId) => {
      store.registerNode(
        createGroup({ id: columnId, parentId: id, strategyId: 'strip', config: stripConfig('y', input.config) }),
      );
      for (let row = 0; row < input.into[1]; row += 1) {
        const newId = input.newIds[cursor];
        cursor += 1;
        if (newId === undefined) return;
        store.registerNode(createPanel({ id: newId, parentId: columnId }));
      }
    });
    trace('store', `split: reconfigure ${id} (both ${input.into[0]}x${input.into[1]})`);
    return;
  }

  const strategyId = input.direction === 'grid' ? 'grid' : 'strip';
  const config =
    input.direction === 'grid'
      ? gridConfig(input.cols, input.config)
      : stripConfig(input.direction, input.config);
  becomeContainer(store, id, strategyId, config);
  for (const newId of input.newIds) {
    store.registerNode(createPanel({ id: newId, parentId: id }));
  }
  trace('store', `split: reconfigure ${id} (${strategyId} ${input.direction}, +${input.newIds.length})`);
}
```

At a root with `direction: 'both'` the target has no content to preserve, so all `cols * rows - 1` new panels are distributed and the first slot is simply left to the first `newId`. Column groups are still `1 + cols` because the outer container is the target itself — validation counts `groupIds` the same way in both modes, so pass `1 + cols` ids and the first is ignored at a root, exactly as `groupId` is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/split.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/split.ts src/split.test.ts
git commit -m "feat(split): add the both and grid directions"
```

---

## Task 6: `unsplit`

**Files:**
- Modify: `src/split.ts`, `src/store.ts`
- Test: `src/split.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/split.test.ts`:

```ts
describe('Store.unsplit', () => {
  it('moves children up to the group index in order, then removes the group', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'strip', config: { axis: 'x' } }));
    store.registerNode(createPanel({ id: asNodeId('a'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('p1'), parentId: asNodeId('z') }));
    store.registerNode(createPanel({ id: asNodeId('b'), parentId: asNodeId('z') }));
    store.split(asNodeId('p1'), {
      direction: 'y',
      into: 3,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3')],
    });

    store.unsplit(asNodeId('g'));

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['a', 'p1', 'p2', 'p3', 'b']);
    expect(store.getNode(asNodeId('g'))).toBeUndefined();
  });

  it('round-trips with split', () => {
    const store = seeded();
    const before = store.getContainerView(asNodeId('z'))?.childOrder;

    store.split(asNodeId('p1'), { direction: 'y', groupId: asNodeId('g'), newIds: [asNodeId('p2')] });
    store.unregisterNode(asNodeId('p2'));
    store.unsplit(asNodeId('g'));

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(before);
  });

  it('throws when the target has no container', () => {
    const store = seeded();
    expect(() => store.unsplit(asNodeId('p1'))).toThrow(/container/);
  });

  it('throws when the target has no parent', () => {
    const store = seeded();
    expect(() => store.unsplit(asNodeId('z'))).toThrow(/membership|parent/);
  });

  it('emits one transaction pair', () => {
    const store = seeded();
    store.split(asNodeId('p1'), { direction: 'y', groupId: asNodeId('g'), newIds: [asNodeId('p2')] });
    let pairs = 0;
    store.events.on('transaction.end', () => { pairs += 1; });

    store.unsplit(asNodeId('g'));

    expect(pairs).toBe(1);
  });

  it('refuses when the group is locked against destroy', () => {
    const store = seeded();
    store.split(asNodeId('p1'), { direction: 'y', groupId: asNodeId('g'), newIds: [asNodeId('p2')] });
    store.setLock(asNodeId('g'), { destroy: true });

    expect(() => store.unsplit(asNodeId('g'))).toThrow();
    expect(store.getNode(asNodeId('g'))).toBeDefined();
  });

  it('force overrides the lock', () => {
    const store = seeded();
    store.split(asNodeId('p1'), { direction: 'y', groupId: asNodeId('g'), newIds: [asNodeId('p2')] });
    store.setLock(asNodeId('g'), { destroy: true });

    store.unsplit(asNodeId('g'), { force: true });

    expect(store.getNode(asNodeId('g'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/split.test.ts -t unsplit`
Expected: FAIL — `store.unsplit is not a function`

- [ ] **Step 3: Implement `unsplitNode`**

Add to `src/split.ts`:

```ts
import { CapabilityMissingError } from './errors.js';
import type { MutateOptions } from './store.js';

export function unsplitNode(store: Store, groupId: NodeId, opts?: MutateOptions): void {
  const group = store.getNodeTruth(groupId);
  if (!group) {
    throw new NodeNotFoundError(groupId);
  }
  if (!group.container) throw new CapabilityMissingError(groupId, 'container', 'unsplit');
  if (!group.membership) throw new CapabilityMissingError(groupId, 'membership', 'unsplit');

  const parentId = group.membership.parentId;
  if (opts?.force !== true) {
    for (const axis of ['destroy', 'dragOut'] as const) {
      if (store.isLocked(groupId, axis)) throw new LockedError(groupId, axis, 'unsplit');
    }
    if (store.isLocked(parentId, 'arrange')) throw new LockedError(parentId, 'arrange', 'unsplit');
  }

  const children = [...group.container.childOrder];
  const at = store.getContainerView(parentId)?.childOrder.indexOf(groupId) ?? 0;

  store.transact(() => {
    store.withLocksSuspended(() => {
      children.forEach((childId, i) => {
        store.moveNode(childId, parentId, at + i);
      });
      store.unregisterNode(groupId);
    });
  }, 'unsplit');

  trace('store', `unsplit: ${groupId} → ${parentId}@${at} (${children.length} children)`);
}
```

- [ ] **Step 4: Delegate from `Store`**

In `src/store.ts`, add `unsplitNode` to the `./split.js` import and add after `split`:

```ts
  /**
   * Dissolve a group into its parent: its children move up to the group's
   * index in order, then the group is unregistered.
   *
   * Nothing calls this automatically. Removing the second-to-last child of a
   * split group leaves a one-child strip, which renders full-bleed and is
   * harmless; collapsing it is the consumer's call.
   */
  unsplit(groupId: NodeId, opts?: MutateOptions): void {
    unsplitNode(this, groupId, opts);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/split.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add src/split.ts src/store.ts src/split.test.ts
git commit -m "feat(split): add unsplit to dissolve a group into its parent"
```

---

## Task 7: Locks, snapshot round-trip, and undo

Covers the spec's remaining test rows. No new production code is expected; if a test fails, fix the implementation.

**Files:**
- Test: `src/split.test.ts`

- [ ] **Step 1: Write the tests**

Append to `src/split.test.ts`:

```ts
import { deserialize, HistoryController, serialize } from './index.js';
import type { SerializedStore } from './index.js';

describe('Store.split — locks', () => {
  it('refuses when the target is locked against move', () => {
    const store = seeded();
    store.setLock(asNodeId('p1'), { move: true });

    expect(() =>
      store.split(asNodeId('p1'), { direction: 'y', groupId: asNodeId('g'), newIds: [asNodeId('p2')] }),
    ).toThrow();
    expect(store.getNode(asNodeId('g'))).toBeUndefined();
  });

  it('refuses when the parent is locked against arrange', () => {
    const store = seeded();
    store.setLock(asNodeId('z'), { arrange: true });

    expect(() =>
      store.split(asNodeId('p1'), { direction: 'y', groupId: asNodeId('g'), newIds: [asNodeId('p2')] }),
    ).toThrow();
  });

  it('refuses a flatten when the parent is locked against arrange', () => {
    const store = seeded();
    store.setLock(asNodeId('z'), { arrange: true });

    expect(() => store.split(asNodeId('p1'), { direction: 'x', newIds: [asNodeId('p2')] })).toThrow();
  });

  it('force overrides every axis', () => {
    const store = seeded();
    store.setLock(asNodeId('p1'), { move: true });
    store.setLock(asNodeId('z'), { arrange: true, dragOut: true });

    store.split(asNodeId('p1'), {
      direction: 'y',
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2')],
      force: true,
    });

    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2']);
  });

  it('runs internal calls suspended, so an axis outside the contract does not refuse', () => {
    const store = seeded();
    store.setLock(asNodeId('z'), { accept: true });

    store.split(asNodeId('p1'), { direction: 'y', groupId: asNodeId('g'), newIds: [asNodeId('p2')] });

    expect(store.getContainerView(asNodeId('g'))?.childOrder).toEqual(['p1', 'p2']);
  });
});

describe('Store.split — persistence and undo', () => {
  it('round-trips a split tree through serialize/deserialize at v4', () => {
    const store = seeded();
    store.split(asNodeId('p1'), {
      direction: 'both',
      into: [2, 2],
      groupIds: [asNodeId('g'), asNodeId('c0'), asNodeId('c1')],
      newIds: [asNodeId('p2'), asNodeId('p3'), asNodeId('p4')],
    });

    const snap = serialize(store);
    expect(snap.version).toBe(4);
    const revived = deserialize(snap);

    expect(revived.getContainerView(asNodeId('c0'))?.childOrder).toEqual(['p1', 'p2']);
    expect(revived.getContainerView(asNodeId('c1'))?.childOrder).toEqual(['p3', 'p4']);
  });

  it('undoes a split in one step when history brackets the transaction pair', () => {
    const store = seeded();
    const history = new HistoryController<SerializedStore>();
    history.push(serialize(store));
    store.events.on('transaction.begin', () => history.beginTransaction());
    store.events.on('transaction.end', () => history.endTransaction(serialize(store)));

    store.split(asNodeId('p1'), {
      direction: 'y',
      into: 3,
      groupId: asNodeId('g'),
      newIds: [asNodeId('p2'), asNodeId('p3')],
    });

    const previous = history.undo();
    expect(previous).toBeDefined();
    if (previous) store.withLocksSuspended(() => deserialize(store, previous));

    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual(['p1']);
    expect(store.getNode(asNodeId('g'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/split.test.ts`
Expected: PASS. If the undo test fails because `endTransaction` fires before the last mutation is visible, check that `splitNode` closes `transact` *after* `withLocksSuspended` returns, not inside it.

- [ ] **Step 3: Run the full suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/split.test.ts
git commit -m "test(split): cover locks, snapshot round-trip, and single-step undo"
```

---

## Task 8: Preset merge — `parentId` on `createZone`

**Files:**
- Modify: `src/constructors.ts`
- Modify: `src/react/presets.tsx`
- Test: `src/constructors.test.ts`, `src/react/nested-zone.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Append to `src/constructors.test.ts`:

```ts
describe('createZone with a parentId', () => {
  it('attaches membership when given a parentId', () => {
    const node = createZone({
      id: asNodeId('inner'),
      parentId: asNodeId('outer'),
      strategyId: 'strip',
      config: {},
    });

    expect(node.membership?.parentId).toBe('outer');
    expect(node.membership?.placement).toEqual({});
    expect(node.container?.strategyId).toBe('strip');
  });

  it('omits membership when given none', () => {
    const node = createZone({ id: asNodeId('root'), strategyId: 'strip', config: {} });
    expect(node.membership).toBeUndefined();
  });

  it('takes a placement alongside a parentId', () => {
    const node = createZone({
      id: asNodeId('inner'),
      parentId: asNodeId('outer'),
      strategyId: 'strip',
      config: {},
      placement: { size: { w: 100 } },
    });

    expect(node.membership?.placement).toEqual({ size: { w: 100 } });
  });

  it('keeps kind zone, unlike createGroup', () => {
    const zone = createZone({ id: asNodeId('a'), parentId: asNodeId('p'), strategyId: 'strip', config: {} });
    const group = createGroup({ id: asNodeId('b'), parentId: asNodeId('p'), strategyId: 'strip', config: {} });

    expect(zone.kind).toBe('zone');
    expect(group.kind).toBe('group');
  });

  it('produces the same capability set as createGroup', () => {
    const zone = createZone({ id: asNodeId('a'), parentId: asNodeId('p'), strategyId: 'strip', config: {} });
    const group = createGroup({ id: asNodeId('b'), parentId: asNodeId('p'), strategyId: 'strip', config: {} });

    const caps = (n: typeof zone) => ({
      container: !!n.container,
      membership: !!n.membership,
      focus: !!n.focus,
    });
    expect(caps(zone)).toEqual(caps(group));
  });

  it('registers under the parent rather than as a root', () => {
    const store = new Store();
    store.registerNode(createZone({ id: asNodeId('outer'), strategyId: 'strip', config: {} }));
    store.registerNode(
      createZone({ id: asNodeId('inner'), parentId: asNodeId('outer'), strategyId: 'stack', config: {} }),
    );

    expect(store.rootIds).toEqual(['outer']);
    expect(store.getContainerView(asNodeId('outer'))?.childOrder).toEqual(['inner']);
  });
});
```

Add `createGroup` and `Store` to that file's imports if absent.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/constructors.test.ts`
Expected: FAIL — excess property `parentId`, and `membership` undefined

- [ ] **Step 3: Collapse the two constructors onto one implementation**

Replace the `CreateZoneInput` / `createZone` / `CreateGroupInput` / `createGroup` block in `src/constructors.ts` with:

```ts
export interface CreateZoneInput {
  id: NodeId;
  strategyId: string;
  config: unknown;
  /**
   * Omit for a root. With a parent, the node gains `membership` and is
   * structurally what `createGroup` produces — the presets differ only in
   * `kind` and in whether this field is required.
   */
  parentId?: NodeId;
  placement?: Record<string, unknown>;
  allowsPinning?: boolean;
  lock?: boolean | LockSet;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  /** See `Node.order`. */
  order?: number;
}

export interface CreateGroupInput extends CreateZoneInput {
  parentId: NodeId;
}

function createContainerNode(input: CreateZoneInput, kind: string): Node {
  const node: Node = {
    id: input.id,
    kind,
    lifecycle: createLifecycleMachine(),
    container: {
      strategyId: input.strategyId,
      config: input.config,
      childOrder: [],
      allowsPinning: input.allowsPinning ?? true,
    },
  };
  if (input.parentId !== undefined) {
    node.membership = {
      parentId: input.parentId,
      placement: input.placement ?? {},
      transit: createTransitMachine(),
    };
  }
  if (input.meta !== undefined) node.meta = input.meta;
  if (input.hints !== undefined) node.hints = input.hints;
  if (input.order !== undefined) node.order = input.order;
  if (input.lock !== undefined) {
    const resolved = resolveLock(node, input.lock);
    if (Object.keys(resolved).length > 0) node.lock = resolved;
  }
  return node;
}

/** @group Constructors */
export function createZone(input: CreateZoneInput): Node {
  return createContainerNode(input, 'zone');
}

/**
 * @group Constructors
 * @deprecated Use `createZone({ parentId })`. After `parentId` became optional
 * on `createZone`, this produces an identical node but for `kind`. The word is
 * reserved for the unbuilt feature that means windows moving as a unit.
 */
export function createGroup(input: CreateGroupInput): Node {
  return createContainerNode(input, 'group');
}
```

`resolveLock` must run after `membership` is attached, or `move` / `resize` are dropped as unsupported axes on a parented zone — that is why the lock block is last.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/constructors.test.ts`
Expected: PASS

- [ ] **Step 5: Add the React nesting test**

Create `src/react/nested-zone.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, Store } from '../index.js';
import { Provider, Zone } from './index.js';

describe('<Zone> inside <Zone>', () => {
  it('registers the inner zone under the outer one, not as a root', () => {
    const store = new Store();

    render(
      <Provider store={store}>
        <Zone id="outer" strategyId="stack" config={{}}>
          <Zone id="inner" strategyId="stack" config={{}} />
        </Zone>
      </Provider>,
    );

    expect(store.rootIds).toEqual(['outer']);
    expect(store.getContainerView(asNodeId('outer'))?.childOrder).toEqual(['inner']);
    expect(store.getNode(asNodeId('inner'))?.membership?.parentId).toBe('outer');
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run src/react/nested-zone.test.tsx`
Expected: PASS. It passes without further changes because `presets.tsx:314` already forwards `parentId` — `createZone` was simply discarding it.

- [ ] **Step 7: Add the `kind` prop to `<Zone>`**

In `src/react/presets.tsx`, add to `ZoneProps`:

```tsx
  /**
   * Overrides the `kind` label, which drives the wrapper class and
   * `ChromeMap` dispatch. Migration path for `<Group>`: `kind="group"`.
   */
  kind?: string;
```

Change `PresetShell`'s prop type from `kind: 'panel' | 'group' | 'zone'` to `kind: string`, and pass `kind={props.kind ?? 'zone'}` at both `<PresetShell kind="zone">` call sites (`presets.tsx:343` and `presets.tsx:417`). Also pass it through to `createZone`'s node so the store agrees with the DOM:

```tsx
      return createZone({
        id,
        strategyId: props.strategyId,
        config: props.config,
        ...defined({ parentId: parentId ?? undefined, meta: props.meta, order: props.order }),
      });
```

becomes

```tsx
      const node = createZone({
        id,
        strategyId: props.strategyId,
        config: props.config,
        ...defined({ parentId: parentId ?? undefined, meta: props.meta, order: props.order }),
      });
      if (props.kind !== undefined) node.kind = props.kind;
      return node;
```

- [ ] **Step 8: Add a test for the kind override**

Append to `src/react/nested-zone.test.tsx`:

```tsx
  it('honors a kind override on both the node and the wrapper class', () => {
    const store = new Store();

    const { container } = render(
      <Provider store={store}>
        <Zone id="outer" strategyId="stack" config={{}}>
          <Zone id="inner" strategyId="stack" config={{}} kind="group" />
        </Zone>
      </Provider>,
    );

    expect(store.getNode(asNodeId('inner'))?.kind).toBe('group');
    expect(container.querySelector('[data-node="inner"]')?.className).toContain('windease-group');
  });
```

- [ ] **Step 9: Run the full suite**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass

- [ ] **Step 10: Commit**

```bash
git add src/constructors.ts src/constructors.test.ts src/react/presets.tsx src/react/nested-zone.test.tsx
git commit -m "feat(presets): make parentId optional on createZone and add a kind override"
```

---

## Task 9: Deprecations, docs, and the version bump

**Files:**
- Modify: `src/layout/split.ts`, `src/react/presets.tsx`, `src/index.ts`, `package.json`
- Modify: `README.md`, `TODO.md`, `docs/concepts.md`, `docs/superpowers/specs/2026-06-04-history-undo-redo-design.md`

- [ ] **Step 1: Deprecate `splitStrategy`**

In `src/layout/split.ts`, extend the JSDoc above `export const splitStrategy`:

```ts
/**
 * ...existing text...
 *
 * @deprecated Use `store.split(id, { direction })` and lay the result out with
 * `stripStrategy`. This strategy keeps a `SplitNode` tree in `container.state`
 * describing structure the node tree already describes; every known split bug
 * is the two disagreeing. Removed at 1.0.
 * @group Strategies
 */
```

Add the same `@deprecated` line to the `SplitNode`, `SplitMeta`, and `SplitOptions` declarations in that file.

- [ ] **Step 2: Deprecate `<Group>`**

In `src/react/presets.tsx`, above `export function Group`:

```tsx
/**
 * @group Components
 * @deprecated Use `<Zone parentId kind="group">`. After `parentId` became
 * optional on `createZone`, a group is a zone with a parent. `kind="group"`
 * keeps `.windease-group`, `.windease-group__title` and `chrome['group']`
 * firing unchanged. Removed at 1.0.
 */
```

- [ ] **Step 3: Bump the version**

In `package.json`, set `"version": "0.10.0"`. In `src/index.ts`, set:

```ts
export const VERSION = '0.10.0';
```

- [ ] **Step 4: Check for a VERSION test**

Run: `grep -rn "0\.9\.0" src e2e --include="*.ts" --include="*.tsx"`
Update any test asserting the old version.

- [ ] **Step 5: Note the stale history spec**

At the top of `docs/superpowers/specs/2026-06-04-history-undo-redo-design.md`, immediately under the H1:

```markdown
> **Status (2026-08-19): the React half was never built.** `HistoryController`
> shipped; `<Provider history>`, `useHistory()`, and the auto-bracketing around
> drags did not. The events this doc brackets (`window.created`, `zone.claimed`)
> were removed by the unified node model. `Store.transact` and the
> `transaction.begin` / `transaction.end` pair now give a composite operation a
> correct undo boundary — see
> `2026-08-19-split-operation-design.md`. Rewriting the React hookup against
> current event names is still open.
```

- [ ] **Step 6: Update `TODO.md`**

Replace the body of "## Replace `splitStrategy` with a split *operation* [HIGH]" with a shipped note:

```markdown
## Shipped in 0.10.0

- **`split` / `unsplit` store operations.** Split is a verb over the node tree,
  not a strategy: `store.split(id, { direction })` wraps a node in a strip
  group, flattens into a matching-axis parent, or reconfigures a root in place.
  Directions are `'x'`, `'y'`, `'both'` (nested strips, `into: [cols, rows]`)
  and `'grid'`. All ids are caller-supplied. `store.unsplit(groupId)` dissolves
  a group into its parent; nothing auto-collapses. `splitStrategy` is
  deprecated and removed at 1.0.
- **`Store.transact(fn, label?)`** with `transaction.begin` /
  `transaction.end`, so a composite operation is one undo step. Also
  `setStrategy` and `ensureContainer`.
- **`createZone` takes an optional `parentId`**, which fixes `<Zone>` inside
  `<Zone>` silently registering as a root. `createGroup` / `<Group>` are
  deprecated — a group is a zone with a parent, and the word is reserved for
  the feature under "## Groups". `<Zone>` gained a `kind` prop.
```

Delete the now-fixed `<Zone>` bullet from "Surfaced by turning the type-checker on over the test tree". Then append to "## Loose ends":

```markdown
- `gridStrategy` ignores `placement.size`, so `split(id, { direction: 'grid' })`
  produces a tiling with no draggable gutters. Honoring explicit sizes there
  would close the last capability gap against the deprecated `splitStrategy`.
- `focus` is offered only by `createPanel`. The store's single-focus invariant
  is store-wide and does not care which node carries the capability, so a
  focusable container is structurally fine and merely unconstructible.
- **A node cannot be locked against gaining a container.** `resolveLock` drops
  axes the node's current capabilities don't support, and `arrange` requires an
  existing `container` — so `setLock(panel, { arrange: true })` silently stores
  nothing and `ensureContainer` proceeds. The guard works only once a container
  is already present, which is the case it is least needed for.
- **`ensureContainer` emits no event**, unlike every other structural mutation
  (`registerNode` → `node.registered`, `setStrategy` → `container.strategyChanged`).
  An event-driven consumer sees a node silently acquire children. A
  `container.added` event would close it; it is new public surface, so it is
  recorded rather than assumed.
- `applyReconfigure` merge-patches the container config, so a key from the
  abandoned strategy survives (a `grid` root's `cols` outlives the switch to
  `strip`). Deliberate — replacing wholesale would discard consumer intent like
  `gap` — and pinned by a test. Revisit only if a strategy ever rejects unknown
  keys.
```

- [ ] **Step 7: Update `docs/concepts.md`**

In the "Mental model" section, after the sentence ending "that is the whole distinction between the two presets", add:

```markdown
As of 0.10.0 that distinction is only a label: `createZone` takes an optional
`parentId`, and with one it produces exactly what `createGroup` produces but for
`kind`. `createGroup` is deprecated. So `kind: 'zone'` no longer implies "root" —
a nested zone carries `kind: 'zone'` and styles as `.windease-zone` unless you
pass a `kind` override.
```

- [ ] **Step 8: Update `README.md`**

Add a migration note under the changelog or API section:

```markdown
### 0.10.0

- `store.split(id, input)` / `store.unsplit(groupId)` replace `splitStrategy`,
  which is deprecated and removed at 1.0. Split rearranges real nodes and lays
  them out with `stripStrategy`, so registering a child, removing one, and
  dragging one all behave — they are ordinary store mutations now.
- `store.transact(fn, label?)` emits `transaction.begin` / `transaction.end`.
  Bracket history pushes on that pair to get one undo step per composite
  operation.
- `createZone` accepts an optional `parentId`. `createGroup` and `<Group>` are
  deprecated: migrate to `createZone({ parentId })` and
  `<Zone parentId kind="group">`, which keeps `.windease-group` and
  `chrome['group']` working.
- Snapshots are unchanged at v4.
```

- [ ] **Step 9: Run everything**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: 0.10.0 — deprecate splitStrategy and createGroup"
```

---

## Task 10: Ladle story and e2e coverage

**Files:**
- Create: `src/react/stories/SplitOperation.stories.tsx`
- Create: `e2e/split.spec.ts`
- Modify: `src/react/stories/windease.css`

- [ ] **Step 1: Read the existing story and spec for their shape**

Run: `sed -n '1,60p' src/react/stories/RecursiveSplit.stories.tsx && sed -n '1,40p' e2e/resize.spec.ts`

Match their registry wiring, `data-testid` conventions, and Playwright selectors. `e2e/resize.spec.ts` targets `splitStrategy` gutter ids and must keep passing untouched — the strategy is deprecated, not removed.

- [ ] **Step 2: Add the story stylesheet rule**

Append to `src/react/stories/windease.css`:

```css
.story-split-host {
  width: 720px;
  height: 440px;
}

.story-split-controls {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
```

The host is sized in CSS rather than passed as a `viewport` prop on purpose.
Every existing split story hands `<Container>` an explicit `viewport`, so none
of them exercises the ResizeObserver path at all — this is the ref-measured
fixture `TODO.md` asks for.

- [ ] **Step 3: Write the story**

Create `src/react/stories/SplitOperation.stories.tsx`:

```tsx
export default { title: 'Split operation' };

import type { Story } from '@ladle/react';
import { useMemo, useRef, useState } from 'react';
import {
  asNodeId,
  createPanel,
  createZone,
  gridStrategy,
  type NodeId,
  Store,
  stripStrategy,
} from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './windease.css';

const STRATEGIES = {
  strip: stripStrategy as never,
  grid: gridStrategy as never,
};

const ROOT = asNodeId('root');

export const SplitAndUnsplit: Story = () => {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(createZone({ id: ROOT, strategyId: 'strip', config: { axis: 'x', gap: 6 } }));
    s.registerNode(createPanel({ id: asNodeId('p1'), parentId: ROOT, meta: { title: 'p1' } }));
    s.showNode(asNodeId('p1'));
    return s;
  }, []);

  // The store has no id generator, so a consumer mints its own. A counter is
  // all it takes; the ids just have to be unique and stable.
  const counter = useRef(1);
  const [lastGroup, setLastGroup] = useState<NodeId | null>(null);
  const mintPanel = (): NodeId => {
    counter.current += 1;
    return asNodeId(`p${counter.current}`);
  };
  const mintGroup = (): NodeId => asNodeId(`g${counter.current}`);

  /** Split the last panel in the tree, so repeated clicks nest. */
  const target = (): NodeId => {
    const ids = [...store.nodes.values()]
      .filter((n) => !n.container)
      .map((n) => n.id);
    return ids[ids.length - 1] ?? asNodeId('p1');
  };

  const splitX = () => {
    store.split(target(), { direction: 'x', groupId: mintGroup(), newIds: [mintPanel()] });
  };
  const splitY = () => {
    const g = mintGroup();
    store.split(target(), { direction: 'y', groupId: g, newIds: [mintPanel()] });
    setLastGroup(g);
  };
  const splitBoth = () => {
    const g = mintGroup();
    const cols = [asNodeId(`${g}-c0`), asNodeId(`${g}-c1`)];
    store.split(target(), {
      direction: 'both',
      into: [2, 2],
      groupIds: [g, ...cols],
      newIds: [mintPanel(), mintPanel(), mintPanel()],
    });
    setLastGroup(g);
  };
  const splitGrid = () => {
    const g = mintGroup();
    store.split(target(), {
      direction: 'grid',
      into: 4,
      cols: 2,
      groupId: g,
      newIds: [mintPanel(), mintPanel(), mintPanel()],
    });
    setLastGroup(g);
  };
  const unsplit = () => {
    if (lastGroup && store.getNode(lastGroup)) store.unsplit(lastGroup);
    setLastGroup(null);
  };

  const chrome: ChromeMap = useMemo(
    () => ({
      zone: ({ children }) => <>{children}</>,
      group: ({ children }) => <>{children}</>,
      panel: ({ node }) => (
        <div className="windease-panel">
          <header className="windease-panel__title">{String(node.meta?.title ?? node.id)}</header>
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="story-split-controls">
          <button type="button" data-testid="split-x" onClick={splitX}>
            split x
          </button>
          <button type="button" data-testid="split-y" onClick={splitY}>
            split y
          </button>
          <button type="button" data-testid="split-both" onClick={splitBoth}>
            split both
          </button>
          <button type="button" data-testid="split-grid" onClick={splitGrid}>
            split grid
          </button>
          <button type="button" data-testid="unsplit" onClick={unsplit}>
            unsplit
          </button>
        </div>
        <div className="story-split-host">
          <Container parentId={ROOT} chrome={chrome} className="windease-zone" affordances />
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};
```

- [ ] **Step 4: Confirm the story's Ladle id**

Run: `npm run ladle:build && grep -o '"split-operation[^"]*"' build/ladle/meta.json | head`
Expected: `"split-operation--split-and-unsplit"`. If the id differs, use what this
prints as `STORY` in the next step rather than the value written below.

- [ ] **Step 5: Write the e2e spec**

Create `e2e/split.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { boxOf, centerOf, dragMouse, openStory } from './fixtures.js';

const STORY = 'split-operation--split-and-unsplit';

/** Every panel's box, left to right. Panels are the leaves — groups render
 *  nothing of their own, so `[data-node]` on a panel is the visible rect. */
async function panelBoxes(page: import('@playwright/test').Page) {
  const locators = await page.locator('[data-node^="p"]').all();
  return Promise.all(locators.map((l) => boxOf(l)));
}

test.describe('split operation', () => {
  test('repeated x splits tile without collapsing a pane', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('split-x').click();
    await page.getByTestId('split-x').click();

    const boxes = (await panelBoxes(page)).sort((a, b) => a.x - b.x);
    expect(boxes).toHaveLength(3);
    // splitStrategy's buildTree gave panel k a width of W / 2^k, so the third
    // pane collapsed. Every pane must have real width now.
    for (const b of boxes) expect(b.w).toBeGreaterThan(20);
    // And they must not overlap.
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.w - 1);
    }
  });

  test("direction 'both' produces a 2x2", async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('split-both').click();

    const boxes = await panelBoxes(page);
    expect(boxes).toHaveLength(4);
    const xs = new Set(boxes.map((b) => Math.round(b.x)));
    const ys = new Set(boxes.map((b) => Math.round(b.y)));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
    for (const b of boxes) {
      expect(b.w).toBeGreaterThan(20);
      expect(b.h).toBeGreaterThan(20);
    }
  });

  test('dragging a gutter moves space between panes and conserves the total', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('split-x').click();

    const before = (await panelBoxes(page)).sort((a, b) => a.x - b.x);
    const totalBefore = before.reduce((sum, b) => sum + b.w, 0);
    // strip emits a trailing-edge affordance on every non-last child.
    const gutter = await boxOf(page.locator('[data-affordance-hit^="resize-x-"]').first());
    const start = centerOf(gutter);

    await dragMouse(page, start, { x: start.x + 100, y: start.y });

    const after = (await panelBoxes(page)).sort((a, b) => a.x - b.x);
    expect(after[0]!.w).toBeGreaterThan(before[0]!.w + 60);
    expect(after.reduce((sum, b) => sum + b.w, 0)).toBeCloseTo(totalBefore, 0);
  });

  test('unsplit returns the tree to its previous shape', async ({ page }) => {
    await openStory(page, STORY);
    const before = await panelBoxes(page);
    expect(before).toHaveLength(1);

    await page.getByTestId('split-y').click();
    expect(await panelBoxes(page)).toHaveLength(2);

    await page.getByTestId('unsplit').click();

    const after = await panelBoxes(page);
    expect(after).toHaveLength(2);
    // unsplit dissolves the group, it does not destroy children — both panels
    // come back up to the root strip, now side by side on its x axis.
    expect(Math.round(after[0]!.y)).toBe(Math.round(after[1]!.y));
  });
});
```

- [ ] **Step 6: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS, 15 tests (11 existing + 4 new)

- [ ] **Step 7: Verify lint still passes after an e2e run**

Run: `npm run lint`
Expected: PASS. `test-results/` is gitignored but biome reads the filesystem, so a local e2e run can fail lint until `biome.jsonc`'s excludes cover it. They were added in `0c99ae6`; if this fails, that exclude list is the place to look.

- [ ] **Step 8: Commit**

```bash
git add src/react/stories/SplitOperation.stories.tsx src/react/stories/windease.css e2e/split.spec.ts
git commit -m "test(split): add a split/unsplit story and e2e coverage"
```

---

## Verification

Before calling this done, run all four and paste the output:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Expected: lint clean, typecheck clean, ~700 unit tests passing across ~61 files, 15 e2e passing, build emits `dist/`.

Then confirm by hand:

- [ ] `grep -rn "SplitNode" src/ --include="*.ts" | grep -v "layout/split"` returns nothing outside the deprecated strategy and its tests.
- [ ] `npx tsc --noEmit -p tsconfig.test.json` is clean, so the stories typecheck too.
- [ ] `WINDEASE_TRACE=store npx vitest run src/split.test.ts 2>&1 | grep "split:"` shows one trace line per split, naming the mode.
