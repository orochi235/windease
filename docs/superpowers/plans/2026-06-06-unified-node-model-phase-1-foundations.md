# Unified Node Model — Phase 1: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `Node` type, capability records, three named constructors (`createZone`, `createGroup`, `createPanel`), kind-shape validator, and new error subclasses — all purely additive alongside existing `WindowRecord`/`ZoneRecord`. Phase 2 will port the store to use them.

**Architecture:** Brand-new module files (`node.ts`, `constructors.ts`, `validators.ts`). Errors extended in place. Trace categories extended in place. No changes to `store.ts`, `snapshot.ts`, `window.ts`, `zone.ts`, or any strategy. Phase 1 ships zero behavior change; downstream phases consume the new types.

**Tech Stack:** TypeScript, Vitest, biome.

**Spec:** `docs/superpowers/specs/2026-06-06-unified-node-model-design.md`

---

## File Structure

| File | Responsibility | New / Modified |
|---|---|---|
| `packages/core/src/node.ts` | `Node` interface, `NodeId` branded type, capability sub-types (`ContainerCap`, `SlotCap`, `FocusCap`), `NodeHints`, `NodeKind` enum, `asNodeId` mint helper | New |
| `packages/core/src/constructors.ts` | `createZone`, `createGroup`, `createPanel`, plus their input types | New |
| `packages/core/src/validators.ts` | `validateKindShape(node)` — runtime check that capability shape matches `kind` | New |
| `packages/core/src/errors.ts` | Add new error code values + concrete subclasses (`NodeNotFoundError`, `DuplicateNodeError`, `KindShapeError`, `CapabilityMissingError`, `CycleError`, `StrategyRejectionError`, `InvariantViolationError`) | Modify |
| `packages/core/src/trace.ts` | Add `'container'` category to `TRACE_CATEGORIES`; `'zone'` stays as deprecated alias for one minor version | Modify |
| `packages/core/src/index.ts` | Export new types/functions/errors | Modify |
| `packages/core/src/node.test.ts` | Test `asNodeId`, capability-shape predicates | New |
| `packages/core/src/constructors.test.ts` | Test each constructor produces a correctly-shaped node | New |
| `packages/core/src/validators.test.ts` | Test `validateKindShape` accepts valid shapes, throws on invalid | New |
| `packages/core/src/errors.test.ts` | Extend with tests for new subclasses (existing file) | Modify |

**Note on FSMs:** Spec shows lifecycle/transit/focus as plain `{ state }` objects. Implementation uses the existing `Machine<S, E>` class — `Machine` has a public `.state` field so `node.lifecycle.state` reads identically. Snapshot serialization will project Machine → `{ state }` in Phase 6. This deviation from spec is documented inline; the consumer-facing read API matches exactly.

---

## Task 1: Add `Node` type, `NodeId`, capability sub-types

**Files:**
- Create: `packages/core/src/node.ts`
- Create: `packages/core/src/node.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/core/src/node.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asNodeId, type Node, type NodeId } from './node.js';

describe('node identity', () => {
  it('asNodeId mints a branded NodeId from a string', () => {
    const id: NodeId = asNodeId('n1');
    expect(id).toBe('n1');
  });

  it('Node shape compiles with all capabilities present', () => {
    // Type-level test: this should compile.
    const node: Node = {
      id: asNodeId('p1'),
      kind: 'panel',
      lifecycle: { state: 'mounted' },
      slot: {
        parentId: asNodeId('z1'),
        placement: {},
        transit: { state: 'idle' },
      },
      focus: { state: 'blurred' },
      container: {
        strategyId: 'stack',
        config: {},
        childIds: [],
        allowsPinning: true,
      },
    };
    expect(node.kind).toBe('panel');
  });

  it('Node shape compiles with only required fields (zone)', () => {
    const node: Node = {
      id: asNodeId('z1'),
      kind: 'zone',
      lifecycle: { state: 'mounted' },
      container: {
        strategyId: 'grid',
        config: {},
        childIds: [],
        allowsPinning: true,
      },
    };
    expect(node.kind).toBe('zone');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/node.test.ts`
Expected: FAIL — module './node.js' does not exist.

- [ ] **Step 3: Implement `node.ts`**

Write `packages/core/src/node.ts`:

```ts
import type { Machine } from './fsm.js';
import type { FocusEvent, FocusState } from './machines/focus.js';
import type { LifecycleEvent, LifecycleState } from './machines/lifecycle.js';
import type { TransitEvent, TransitState } from './machines/transit.js';

/**
 * Branded node identity. Mint via `asNodeId`.
 */
export type NodeId = string & { readonly __brand: 'NodeId' };

export const asNodeId = (s: string): NodeId => s as NodeId;

/**
 * Closed enum of structural roles. The library validates that a node's
 * capability shape matches its kind at registration time.
 */
export type NodeKind = 'panel' | 'group' | 'zone';

/**
 * Soft layout preferences read by strategies. Replaces v0.1 WindowHints.
 */
export interface NodeHints {
  minSize?: { w: number; h: number };
  preferredSize?: { w: number; h: number };
  order?: number;
}

/**
 * Lifecycle capability — present on every node. The runtime object is a
 * Machine instance; consumers read `node.lifecycle.state`.
 */
export type LifecycleCap = Machine<LifecycleState, LifecycleEvent>;

/**
 * Transit capability — folded into SlotCap. The runtime object is a
 * Machine instance; consumers read `node.slot.transit.state`.
 */
export type TransitCap = Machine<TransitState, TransitEvent>;

/**
 * Focus capability — present only on nodes that opt in (panels by default).
 */
export type FocusCap = Machine<FocusState, FocusEvent>;

/**
 * Container capability — present on nodes that host children.
 */
export interface ContainerCap {
  strategyId: string;
  config: unknown;
  childIds: NodeId[];
  allowsPinning: boolean;
  state?: unknown;
}

/**
 * Slot capability — present on nodes that live at a position inside a
 * parent container. Carries the per-membership `placement` bag (reserved
 * keys `pinned`, `locked`) and the transit FSM.
 */
export interface SlotCap {
  parentId: NodeId;
  placement: Record<string, unknown>;
  transit: TransitCap;
}

/**
 * The unified node type. Capability records compose to express role.
 *
 * Invariants enforced by `validateKindShape`:
 *   kind='zone'  → container present; slot/focus absent.
 *   kind='group' → container + slot present; focus absent.
 *   kind='panel' → slot + focus present; container optional.
 *
 * In all three, lifecycle is intrinsic (always present).
 */
export interface Node {
  id: NodeId;
  kind: NodeKind;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  lifecycle: LifecycleCap;

  container?: ContainerCap;
  slot?: SlotCap;
  focus?: FocusCap;
}
```

Wait — the test above uses `{ state: 'mounted' }` as a literal. With `LifecycleCap = Machine<...>`, the test would not compile. Adjust: the test constructs Machines via the factory. Update test in Step 1 (rewrite both before running again) OR have node.ts expose plain-object shapes with a Machine adapter. Cleanest: the test should use the actual factories.

Rewrite `packages/core/src/node.test.ts` to use factories:

```ts
import { describe, expect, it } from 'vitest';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import { asNodeId, type Node, type NodeId } from './node.js';

describe('node identity', () => {
  it('asNodeId mints a branded NodeId from a string', () => {
    const id: NodeId = asNodeId('n1');
    expect(id).toBe('n1');
  });

  it('Node shape compiles with all capabilities present', () => {
    const node: Node = {
      id: asNodeId('p1'),
      kind: 'panel',
      lifecycle: createLifecycleMachine(),
      slot: {
        parentId: asNodeId('z1'),
        placement: {},
        transit: createTransitMachine(),
      },
      focus: createFocusMachine(),
      container: {
        strategyId: 'stack',
        config: {},
        childIds: [],
        allowsPinning: true,
      },
    };
    expect(node.kind).toBe('panel');
    expect(node.lifecycle.state).toBe('mounted');
    expect(node.slot?.transit.state).toBe('idle');
    expect(node.focus?.state).toBe('blurred');
  });

  it('Node shape compiles with zone-minimal capabilities', () => {
    const node: Node = {
      id: asNodeId('z1'),
      kind: 'zone',
      lifecycle: createLifecycleMachine(),
      container: {
        strategyId: 'grid',
        config: {},
        childIds: [],
        allowsPinning: true,
      },
    };
    expect(node.kind).toBe('zone');
    expect(node.slot).toBeUndefined();
    expect(node.focus).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/node.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/node.ts packages/core/src/node.test.ts
git commit -m "feat(core): Node type with capability records and NodeId"
```

---

## Task 2: Add new error subclasses

**Files:**
- Modify: `packages/core/src/errors.ts`
- Modify: `packages/core/src/errors.test.ts`

- [ ] **Step 1: Read existing `errors.ts` to confirm current shape.**

Existing file exports `WindeaseError` (concrete class, `code` + `message`) and `WindeaseErrorCode` (string union of v0.1 codes). We extend both: add new codes to the union, add concrete subclasses that extend `WindeaseError`. We do not make `WindeaseError` abstract — existing call sites still construct it directly. Phase 7 will revisit.

- [ ] **Step 2: Write the failing tests**

Append to `packages/core/src/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CapabilityMissingError,
  CycleError,
  DuplicateNodeError,
  InvariantViolationError,
  KindShapeError,
  NodeNotFoundError,
  StrategyRejectionError,
  WindeaseError,
} from './errors.js';
import { asNodeId } from './node.js';

describe('v0.2 error subclasses', () => {
  it('NodeNotFoundError carries the id and is a WindeaseError', () => {
    const err = new NodeNotFoundError(asNodeId('n1'));
    expect(err).toBeInstanceOf(WindeaseError);
    expect(err.code).toBe('unknown-node');
    expect(err.id).toBe('n1');
    expect(err.message).toContain('n1');
  });

  it('DuplicateNodeError carries the id', () => {
    const err = new DuplicateNodeError(asNodeId('n2'));
    expect(err.code).toBe('duplicate-id');
    expect(err.id).toBe('n2');
  });

  it('KindShapeError carries id, kind, violation', () => {
    const err = new KindShapeError(asNodeId('n3'), 'panel', 'missing slot');
    expect(err.code).toBe('kind-shape-mismatch');
    expect(err.id).toBe('n3');
    expect(err.kind).toBe('panel');
    expect(err.violation).toBe('missing slot');
  });

  it('CapabilityMissingError carries id, capability, operation', () => {
    const err = new CapabilityMissingError(asNodeId('n4'), 'focus', 'focusNode');
    expect(err.code).toBe('capability-missing');
    expect(err.capability).toBe('focus');
    expect(err.operation).toBe('focusNode');
  });

  it('CycleError carries node and attempted parent', () => {
    const err = new CycleError(asNodeId('a'), asNodeId('b'));
    expect(err.code).toBe('cycle-detected');
    expect(err.nodeId).toBe('a');
    expect(err.attemptedParentId).toBe('b');
  });

  it('StrategyRejectionError carries parent id and optional reason', () => {
    const err = new StrategyRejectionError(asNodeId('p'), 'capacity exceeded');
    expect(err.code).toBe('strategy-rejected');
    expect(err.parentId).toBe('p');
    expect(err.reason).toBe('capacity exceeded');
  });

  it('InvariantViolationError carries code and context', () => {
    const err = new InvariantViolationError('orphan-child', 'no parent', { id: 'n5' });
    expect(err.code).toBe('orphan-child');
    expect(err.context).toEqual({ id: 'n5' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/core/src/errors.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 4: Extend `errors.ts`**

Replace contents of `packages/core/src/errors.ts`:

```ts
import type { NodeId, NodeKind } from './node.js';

export type WindeaseErrorCode =
  // v0.1 codes (still used by existing store/window/zone)
  | 'UNKNOWN_WINDOW'
  | 'UNKNOWN_ZONE'
  | 'ILLEGAL_TRANSITION'
  | 'DUPLICATE_ZONE'
  | 'DUPLICATE_WINDOW'
  | 'ZONE_NOT_EMPTY'
  | 'UNKNOWN_STRATEGY'
  | 'WRONG_ITEM_COUNT'
  | 'UNKNOWN_AFFORDANCE_KIND'
  | 'NO_INITIAL_STATE'
  // v0.2 codes (unified node model)
  | 'unknown-node'
  | 'duplicate-id'
  | 'kind-shape-mismatch'
  | 'capability-missing'
  | 'cycle-detected'
  | 'strategy-rejected'
  // Free-form code surface for InvariantViolationError. Anything matching
  // /^[a-z][a-z0-9-]*$/ is acceptable.
  | string;

export class WindeaseError extends Error {
  readonly code: WindeaseErrorCode;
  constructor(code: WindeaseErrorCode, message: string) {
    super(message);
    this.name = 'WindeaseError';
    this.code = code;
  }
}

export class NodeNotFoundError extends WindeaseError {
  readonly id: NodeId;
  constructor(id: NodeId) {
    super('unknown-node', `Unknown node: ${id}`);
    this.name = 'NodeNotFoundError';
    this.id = id;
  }
}

export class DuplicateNodeError extends WindeaseError {
  readonly id: NodeId;
  constructor(id: NodeId) {
    super('duplicate-id', `Duplicate node id: ${id}`);
    this.name = 'DuplicateNodeError';
    this.id = id;
  }
}

export class KindShapeError extends WindeaseError {
  readonly id: NodeId;
  readonly kind: NodeKind;
  readonly violation: string;
  constructor(id: NodeId, kind: NodeKind, violation: string) {
    super('kind-shape-mismatch', `Node ${id} (kind=${kind}): ${violation}`);
    this.name = 'KindShapeError';
    this.id = id;
    this.kind = kind;
    this.violation = violation;
  }
}

export class CapabilityMissingError extends WindeaseError {
  readonly id: NodeId;
  readonly capability: 'container' | 'slot' | 'focus';
  readonly operation: string;
  constructor(id: NodeId, capability: 'container' | 'slot' | 'focus', operation: string) {
    super(
      'capability-missing',
      `Operation ${operation} requires ${capability} capability on ${id}`,
    );
    this.name = 'CapabilityMissingError';
    this.id = id;
    this.capability = capability;
    this.operation = operation;
  }
}

export class CycleError extends WindeaseError {
  readonly nodeId: NodeId;
  readonly attemptedParentId: NodeId;
  constructor(nodeId: NodeId, attemptedParentId: NodeId) {
    super('cycle-detected', `Cannot move ${nodeId} under ${attemptedParentId}: cycle`);
    this.name = 'CycleError';
    this.nodeId = nodeId;
    this.attemptedParentId = attemptedParentId;
  }
}

export class StrategyRejectionError extends WindeaseError {
  readonly parentId: NodeId;
  readonly reason?: string;
  constructor(parentId: NodeId, reason?: string) {
    super('strategy-rejected', `Container ${parentId} rejected: ${reason ?? 'no reason given'}`);
    this.name = 'StrategyRejectionError';
    this.parentId = parentId;
    this.reason = reason;
  }
}

export class InvariantViolationError extends WindeaseError {
  readonly context: Record<string, unknown>;
  constructor(code: string, message: string, context: Record<string, unknown>) {
    super(code, message);
    this.name = 'InvariantViolationError';
    this.context = context;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/core/src/errors.test.ts`
Expected: PASS (all tests including the pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/errors.ts packages/core/src/errors.test.ts
git commit -m "feat(core): error subclasses for the v0.2 node model"
```

---

## Task 3: Add `validateKindShape`

**Files:**
- Create: `packages/core/src/validators.ts`
- Create: `packages/core/src/validators.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/core/src/validators.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { KindShapeError } from './errors.js';
import { createFocusMachine } from './machines/focus.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import { createTransitMachine } from './machines/transit.js';
import { asNodeId, type Node } from './node.js';
import { validateKindShape } from './validators.js';

function panel(id = 'p1', parent = 'z1'): Node {
  return {
    id: asNodeId(id),
    kind: 'panel',
    lifecycle: createLifecycleMachine(),
    slot: {
      parentId: asNodeId(parent),
      placement: {},
      transit: createTransitMachine(),
    },
    focus: createFocusMachine(),
  };
}

function group(id = 'g1', parent = 'z1'): Node {
  return {
    id: asNodeId(id),
    kind: 'group',
    lifecycle: createLifecycleMachine(),
    container: { strategyId: 'stack', config: {}, childIds: [], allowsPinning: true },
    slot: {
      parentId: asNodeId(parent),
      placement: {},
      transit: createTransitMachine(),
    },
  };
}

function zone(id = 'z1'): Node {
  return {
    id: asNodeId(id),
    kind: 'zone',
    lifecycle: createLifecycleMachine(),
    container: { strategyId: 'grid', config: {}, childIds: [], allowsPinning: true },
  };
}

describe('validateKindShape', () => {
  it('accepts a well-formed panel (with and without container)', () => {
    expect(() => validateKindShape(panel())).not.toThrow();
    const recursive = panel();
    recursive.container = { strategyId: 'stack', config: {}, childIds: [], allowsPinning: true };
    expect(() => validateKindShape(recursive)).not.toThrow();
  });

  it('accepts a well-formed group', () => {
    expect(() => validateKindShape(group())).not.toThrow();
  });

  it('accepts a well-formed zone', () => {
    expect(() => validateKindShape(zone())).not.toThrow();
  });

  it('rejects a panel missing slot', () => {
    const n = panel();
    delete (n as { slot?: unknown }).slot;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a panel missing focus', () => {
    const n = panel();
    delete (n as { focus?: unknown }).focus;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a group with focus', () => {
    const n = group();
    n.focus = createFocusMachine();
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a group missing container', () => {
    const n = group();
    delete (n as { container?: unknown }).container;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a group missing slot', () => {
    const n = group();
    delete (n as { slot?: unknown }).slot;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a zone with slot', () => {
    const n = zone();
    n.slot = {
      parentId: asNodeId('x'),
      placement: {},
      transit: createTransitMachine(),
    };
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a zone with focus', () => {
    const n = zone();
    n.focus = createFocusMachine();
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });

  it('rejects a zone missing container', () => {
    const n = zone();
    delete (n as { container?: unknown }).container;
    expect(() => validateKindShape(n)).toThrow(KindShapeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/validators.test.ts`
Expected: FAIL — module './validators.js' missing.

- [ ] **Step 3: Implement validator**

Write `packages/core/src/validators.ts`:

```ts
import { KindShapeError } from './errors.js';
import type { Node } from './node.js';

/**
 * Verify a node's capability shape matches its kind. Throws KindShapeError
 * on the first violation. Used at `registerNode` time and at `hydrate` time.
 *
 *   zone  → container present; slot absent; focus absent.
 *   group → container + slot present; focus absent.
 *   panel → slot + focus present; container optional (recursive panel).
 *
 * `lifecycle` is required on every node and is enforced by the type
 * system (non-optional field); not re-checked here.
 */
export function validateKindShape(node: Node): void {
  switch (node.kind) {
    case 'zone':
      if (!node.container) throw new KindShapeError(node.id, 'zone', 'missing container');
      if (node.slot) throw new KindShapeError(node.id, 'zone', 'zone must not have slot');
      if (node.focus) throw new KindShapeError(node.id, 'zone', 'zone must not have focus');
      return;
    case 'group':
      if (!node.container) throw new KindShapeError(node.id, 'group', 'missing container');
      if (!node.slot) throw new KindShapeError(node.id, 'group', 'missing slot');
      if (node.focus) throw new KindShapeError(node.id, 'group', 'group must not have focus');
      return;
    case 'panel':
      if (!node.slot) throw new KindShapeError(node.id, 'panel', 'missing slot');
      if (!node.focus) throw new KindShapeError(node.id, 'panel', 'missing focus');
      // container optional — recursive panels have it; leaf panels don't.
      return;
    default: {
      const exhaustive: never = node.kind;
      throw new KindShapeError(node.id, exhaustive, 'unknown kind');
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/src/validators.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/validators.ts packages/core/src/validators.test.ts
git commit -m "feat(core): validateKindShape for node capability invariants"
```

---

## Task 4: `createZone` constructor

**Files:**
- Create: `packages/core/src/constructors.ts`
- Create: `packages/core/src/constructors.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/core/src/constructors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createZone } from './constructors.js';
import { asNodeId } from './node.js';
import { validateKindShape } from './validators.js';

describe('createZone', () => {
  it('produces a zone-kind node with container only', () => {
    const node = createZone({
      id: asNodeId('z1'),
      strategyId: 'grid',
      config: { cols: 3 },
    });
    expect(node.kind).toBe('zone');
    expect(node.container).toBeDefined();
    expect(node.container?.strategyId).toBe('grid');
    expect(node.container?.config).toEqual({ cols: 3 });
    expect(node.container?.childIds).toEqual([]);
    expect(node.container?.allowsPinning).toBe(true);
    expect(node.slot).toBeUndefined();
    expect(node.focus).toBeUndefined();
    expect(node.lifecycle.state).toBe('mounted');
  });

  it('honors allowsPinning: false', () => {
    const node = createZone({
      id: asNodeId('z2'),
      strategyId: 'stack',
      config: {},
      allowsPinning: false,
    });
    expect(node.container?.allowsPinning).toBe(false);
  });

  it('carries meta and hints when provided', () => {
    const node = createZone({
      id: asNodeId('z3'),
      strategyId: 'grid',
      config: {},
      meta: { label: 'main' },
      hints: { preferredSize: { w: 800, h: 600 } },
    });
    expect(node.meta).toEqual({ label: 'main' });
    expect(node.hints?.preferredSize).toEqual({ w: 800, h: 600 });
  });

  it('passes validateKindShape', () => {
    const node = createZone({ id: asNodeId('z4'), strategyId: 'grid', config: {} });
    expect(() => validateKindShape(node)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/constructors.test.ts`
Expected: FAIL — module './constructors.js' missing.

- [ ] **Step 3: Implement constructor**

Write `packages/core/src/constructors.ts`:

```ts
import { createLifecycleMachine } from './machines/lifecycle.js';
import type { Node, NodeHints, NodeId } from './node.js';

export interface CreateZoneInput {
  id: NodeId;
  strategyId: string;
  config: unknown;
  allowsPinning?: boolean;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
}

export function createZone(input: CreateZoneInput): Node {
  return {
    id: input.id,
    kind: 'zone',
    meta: input.meta,
    hints: input.hints,
    lifecycle: createLifecycleMachine(),
    container: {
      strategyId: input.strategyId,
      config: input.config,
      childIds: [],
      allowsPinning: input.allowsPinning ?? true,
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/src/constructors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constructors.ts packages/core/src/constructors.test.ts
git commit -m "feat(core): createZone constructor"
```

---

## Task 5: `createGroup` constructor

**Files:**
- Modify: `packages/core/src/constructors.ts`
- Modify: `packages/core/src/constructors.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `packages/core/src/constructors.test.ts`:

```ts
import { createGroup } from './constructors.js';

describe('createGroup', () => {
  it('produces a group-kind node with container + slot', () => {
    const node = createGroup({
      id: asNodeId('g1'),
      parentId: asNodeId('z1'),
      strategyId: 'stack',
      config: { axis: 'vertical' },
    });
    expect(node.kind).toBe('group');
    expect(node.container).toBeDefined();
    expect(node.container?.strategyId).toBe('stack');
    expect(node.slot).toBeDefined();
    expect(node.slot?.parentId).toBe('z1');
    expect(node.slot?.placement).toEqual({});
    expect(node.slot?.transit.state).toBe('idle');
    expect(node.focus).toBeUndefined();
    expect(node.lifecycle.state).toBe('mounted');
  });

  it('honors allowsPinning and placement', () => {
    const node = createGroup({
      id: asNodeId('g2'),
      parentId: asNodeId('z1'),
      strategyId: 'strip',
      config: {},
      allowsPinning: false,
      placement: { pinned: true },
    });
    expect(node.container?.allowsPinning).toBe(false);
    expect(node.slot?.placement).toEqual({ pinned: true });
  });

  it('passes validateKindShape', () => {
    const node = createGroup({
      id: asNodeId('g3'),
      parentId: asNodeId('z1'),
      strategyId: 'stack',
      config: {},
    });
    expect(() => validateKindShape(node)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run packages/core/src/constructors.test.ts`
Expected: FAIL — `createGroup` not exported.

- [ ] **Step 3: Append to `constructors.ts`**

Append to `packages/core/src/constructors.ts`:

```ts
import { createTransitMachine } from './machines/transit.js';

export interface CreateGroupInput {
  id: NodeId;
  parentId: NodeId;
  strategyId: string;
  config: unknown;
  allowsPinning?: boolean;
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
}

export function createGroup(input: CreateGroupInput): Node {
  return {
    id: input.id,
    kind: 'group',
    meta: input.meta,
    hints: input.hints,
    lifecycle: createLifecycleMachine(),
    container: {
      strategyId: input.strategyId,
      config: input.config,
      childIds: [],
      allowsPinning: input.allowsPinning ?? true,
    },
    slot: {
      parentId: input.parentId,
      placement: input.placement ?? {},
      transit: createTransitMachine(),
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/src/constructors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constructors.ts packages/core/src/constructors.test.ts
git commit -m "feat(core): createGroup constructor"
```

---

## Task 6: `createPanel` constructor

**Files:**
- Modify: `packages/core/src/constructors.ts`
- Modify: `packages/core/src/constructors.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `packages/core/src/constructors.test.ts`:

```ts
import { createPanel } from './constructors.js';

describe('createPanel', () => {
  it('produces a leaf panel (no container)', () => {
    const node = createPanel({
      id: asNodeId('p1'),
      parentId: asNodeId('z1'),
    });
    expect(node.kind).toBe('panel');
    expect(node.slot).toBeDefined();
    expect(node.slot?.parentId).toBe('z1');
    expect(node.focus).toBeDefined();
    expect(node.focus?.state).toBe('blurred');
    expect(node.container).toBeUndefined();
    expect(node.lifecycle.state).toBe('mounted');
  });

  it('produces a recursive panel when container is provided', () => {
    const node = createPanel({
      id: asNodeId('p2'),
      parentId: asNodeId('z1'),
      container: { strategyId: 'stack', config: { axis: 'vertical' } },
    });
    expect(node.container).toBeDefined();
    expect(node.container?.strategyId).toBe('stack');
    expect(node.container?.childIds).toEqual([]);
    expect(node.container?.allowsPinning).toBe(true);
  });

  it('honors container.allowsPinning override', () => {
    const node = createPanel({
      id: asNodeId('p3'),
      parentId: asNodeId('z1'),
      container: { strategyId: 'stack', config: {}, allowsPinning: false },
    });
    expect(node.container?.allowsPinning).toBe(false);
  });

  it('carries meta, hints, placement', () => {
    const node = createPanel({
      id: asNodeId('p4'),
      parentId: asNodeId('z1'),
      meta: { title: 'Editor' },
      hints: { minSize: { w: 200, h: 100 } },
      placement: { locked: true },
    });
    expect(node.meta).toEqual({ title: 'Editor' });
    expect(node.hints?.minSize).toEqual({ w: 200, h: 100 });
    expect(node.slot?.placement).toEqual({ locked: true });
  });

  it('passes validateKindShape (both leaf and recursive)', () => {
    const leaf = createPanel({ id: asNodeId('p5'), parentId: asNodeId('z1') });
    const recursive = createPanel({
      id: asNodeId('p6'),
      parentId: asNodeId('z1'),
      container: { strategyId: 'stack', config: {} },
    });
    expect(() => validateKindShape(leaf)).not.toThrow();
    expect(() => validateKindShape(recursive)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run packages/core/src/constructors.test.ts`
Expected: FAIL — `createPanel` not exported.

- [ ] **Step 3: Append to `constructors.ts`**

Append to `packages/core/src/constructors.ts`:

```ts
import { createFocusMachine } from './machines/focus.js';

export interface CreatePanelInput {
  id: NodeId;
  parentId: NodeId;
  placement?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  hints?: NodeHints;
  container?: {
    strategyId: string;
    config: unknown;
    allowsPinning?: boolean;
  };
}

export function createPanel(input: CreatePanelInput): Node {
  const node: Node = {
    id: input.id,
    kind: 'panel',
    meta: input.meta,
    hints: input.hints,
    lifecycle: createLifecycleMachine(),
    slot: {
      parentId: input.parentId,
      placement: input.placement ?? {},
      transit: createTransitMachine(),
    },
    focus: createFocusMachine(),
  };
  if (input.container) {
    node.container = {
      strategyId: input.container.strategyId,
      config: input.container.config,
      childIds: [],
      allowsPinning: input.container.allowsPinning ?? true,
    };
  }
  return node;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/src/constructors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constructors.ts packages/core/src/constructors.test.ts
git commit -m "feat(core): createPanel constructor with optional recursion"
```

---

## Task 7: Add `'container'` trace category alongside `'zone'`

**Files:**
- Modify: `packages/core/src/trace.ts`

- [ ] **Step 1: Read current `trace.ts`** to confirm `TRACE_CATEGORIES` shape.

- [ ] **Step 2: Modify `TRACE_CATEGORIES`** in `packages/core/src/trace.ts`:

Replace:

```ts
export const TRACE_CATEGORIES = [
  'dnd',
  'history',
  'layout',
  'store',
  'workspace',
  'zone',
] as const;
```

with:

```ts
export const TRACE_CATEGORIES = [
  'dnd',
  'history',
  'layout',
  'store',
  'workspace',
  'zone',       // deprecated alias for 'container'; remove in v0.3
  'container',
] as const;
```

No behavior change for existing call sites (`'zone'` still enabled). New call sites in subsequent phases will use `'container'`.

- [ ] **Step 3: Run all tests to ensure no regressions**

Run: `npx vitest run`
Expected: PASS (all existing tests).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/trace.ts
git commit -m "feat(core): add 'container' trace category alongside deprecated 'zone'"
```

---

## Task 8: Export new types and constructors from `index.ts`

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add new exports**

Append to `packages/core/src/index.ts` (before `VERSION`):

```ts
// v0.2 unified node model — additive in Phase 1; not yet wired into store/snapshot.
export {
  asNodeId,
  type Node,
  type NodeId,
  type NodeKind,
  type NodeHints,
  type ContainerCap,
  type SlotCap,
  type FocusCap,
  type LifecycleCap,
  type TransitCap,
} from './node.js';
export {
  createZone,
  createGroup,
  createPanel,
  type CreateZoneInput,
  type CreateGroupInput,
  type CreatePanelInput,
} from './constructors.js';
export { validateKindShape } from './validators.js';
export {
  NodeNotFoundError,
  DuplicateNodeError,
  KindShapeError,
  CapabilityMissingError,
  CycleError,
  StrategyRejectionError,
  InvariantViolationError,
} from './errors.js';
```

- [ ] **Step 2: Run typecheck and tests**

Run: `npm run build && npx vitest run`
Expected: typecheck passes, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export v0.2 node model types and constructors"
```

---

## Task 9: Integration smoke test

**Files:**
- Create: `packages/core/src/v02.integration.test.ts`

- [ ] **Step 1: Write integration test**

Write `packages/core/src/v02.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  asNodeId,
  createGroup,
  createPanel,
  createZone,
  validateKindShape,
} from './index.js';

describe('v0.2 node model — integration', () => {
  it('builds a 3-level tree of zone → recursive panel → leaf panel', () => {
    const zone = createZone({ id: asNodeId('z'), strategyId: 'grid', config: { cols: 2 } });
    const trayHost = createPanel({
      id: asNodeId('tray'),
      parentId: asNodeId('z'),
      container: { strategyId: 'stack', config: { axis: 'vertical' } },
    });
    const leaf = createPanel({
      id: asNodeId('leaf'),
      parentId: asNodeId('tray'),
    });

    for (const n of [zone, trayHost, leaf]) {
      expect(() => validateKindShape(n)).not.toThrow();
    }
    expect(trayHost.container).toBeDefined();
    expect(trayHost.slot?.parentId).toBe('z');
    expect(leaf.slot?.parentId).toBe('tray');
  });

  it('builds a group inside a zone', () => {
    const zone = createZone({ id: asNodeId('z'), strategyId: 'grid', config: {} });
    const group = createGroup({
      id: asNodeId('g'),
      parentId: asNodeId('z'),
      strategyId: 'strip',
      config: { axis: 'horizontal' },
    });
    expect(() => validateKindShape(zone)).not.toThrow();
    expect(() => validateKindShape(group)).not.toThrow();
    expect(group.container?.strategyId).toBe('strip');
    expect(group.slot?.parentId).toBe('z');
    expect(group.focus).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run packages/core/src/v02.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run && npm run lint`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/v02.integration.test.ts
git commit -m "test(core): v0.2 node model integration smoke test"
```

---

## Phase 1 Done

Exit criteria:
- `Node`, `NodeId`, capability types, `NodeHints` exported.
- `createZone`, `createGroup`, `createPanel` exported and tested.
- `validateKindShape` exported and tested.
- Seven new error subclasses exported and tested.
- `'container'` trace category added alongside `'zone'` (deprecated alias).
- All existing tests still pass; no public-API regression.

Next plan: Phase 2 — port `Store` to use a unified `nodes` map, preserving v0.1 API as deprecated wrappers.
