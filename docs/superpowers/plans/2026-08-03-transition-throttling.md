# Transition Throttling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in rate limiting for node transitions to windease, so consumers driving the store from a live event stream don't see windows bounce through the layout.

**Architecture:** `Store` gains a truth/published split. Its existing `nodesMap` stays the immediate, exact truth that snapshot and history read; a new `Publisher` owns a `publishedMap` that subscribers read. Mutations write truth synchronously and mark the node dirty; a scheduler-driven flush graduates dirty nodes into published and notifies once. Three mechanisms are stages of that one flush: `notifyMs` (when flush runs), `dwell` (which dirty nodes are eligible), `stagger` (how many publish per wave). Omitting the `throttle` option makes `publishedMap` identity-equal to `nodesMap` and flush the existing `queueMicrotask` — the feature is free when unused.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, React 19 (`useSyncExternalStore`), Biome.

**Spec:** `docs/superpowers/specs/2026-08-03-transition-throttling-design.md`

**Read before starting:** `CLAUDE.md` (tracing tenet — trace liberally, never `console.log` in library code) and `docs/concepts.md`.

---

## Background the engineer needs

**`Node.lifecycle` is a live class instance, not a plain object.** `src/node.ts:84` types it as `Machine<LifecycleState, LifecycleEvent>` — it owns mutable `state` alongside `send` / `can` / `subscribe` and a subscriber `Set`. Never spread it (`{...node.lifecycle}` loses the methods) and never clone it (the clone forks `state` away from truth). Published and truth records **share one Machine instance**. This is why dwell holds a whole node record rather than a single field.

**Every React read funnels through two `Store` methods.** `src/react/hooks.ts` calls only `store.getNode(id)` and `store.subscribe(cb)` (plus `store.rootIds` and `store.focusedId`). That single chokepoint is why no React source file changes in this plan.

**`useSyncExternalStore` loops if `getSnapshot` is unstable.** `src/react/hooks.ts:31` documents this. Published records must be referentially stable between flushes — never rebuild a node object on read.

**Import specifiers carry `.js`** even for `.ts` sources (ESM + `"type": "module"`). Follow the existing style.

---

## File Structure

| File | Status | Responsibility |
| ---- | ------ | -------------- |
| `src/throttle.ts` | create | `Clock`, `ThrottlePolicy`, `StoreOptions`, `systemClock`, and the `Publisher` class. All throttling logic lives here. |
| `src/throttle.test.ts` | create | `Publisher` unit tests, driven by `FakeClock`. |
| `src/test-utils/fake-clock.ts` | create | Deterministic `Clock` for tests. |
| `src/store.ts` | modify | Constructor + `StoreOptions`; dirty-marking at mutation chokepoints; published read projections; `flushNow()`. |
| `src/store.throttle.test.ts` | create | Store-level integration: coalescing, dwell, stagger, snapshot/history interaction. |
| `src/trace.ts` | modify | Add `'throttle'` category. |
| `src/index.ts` | modify | Export the new public types. |
| `src/history.ts` | modify | Force an immediate publish after undo/redo. |
| `src/react/throttle.test.tsx` | create | `getSnapshot` referential stability under flushes. |
| `README.md` | modify | Document the opt-in `throttle` option. |

`Publisher` is deliberately a separate file from `Store` — `src/store.ts` is already 800+ lines, and the throttling state machine (dirty set, timers, dwell math, stagger waves) is a self-contained responsibility with its own tests.

---

# Phase 1 — Publish projection + `notifyMs`

Delivers mechanism #1. After this phase the truth/published split exists and time-window coalescing works; `dwell` and `stagger` are accepted but inert.

## Task 1: Add the `throttle` trace category

**Files:**
- Modify: `src/trace.ts:14-22`

- [ ] **Step 1: Add the category**

In `src/trace.ts`, change the `TRACE_CATEGORIES` tuple to:

```ts
export const TRACE_CATEGORIES = [
  'dnd',
  'history',
  'layout',
  'store',
  'throttle',
  'workspace',
  'zone', // deprecated alias for 'container'; remove in v0.3
  'container',
] as const;
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/trace.ts
git commit -m "feat(trace): add throttle category"
```

---

## Task 2: Throttle types and the system clock

**Files:**
- Create: `src/throttle.ts`
- Test: `src/throttle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/throttle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { systemClock } from './throttle.js';

describe('systemClock', () => {
  it('reports a monotonic-ish now()', () => {
    const a = systemClock.now();
    expect(typeof a).toBe('number');
    expect(systemClock.now()).toBeGreaterThanOrEqual(a);
  });

  it('schedules and cancels timers', async () => {
    let fired = false;
    const h = systemClock.setTimeout(() => {
      fired = true;
    }, 0);
    systemClock.clearTimeout(h);
    await new Promise((r) => setTimeout(r, 5));
    expect(fired).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/throttle.test.ts`
Expected: FAIL — `Failed to resolve import "./throttle.js"`.

- [ ] **Step 3: Create the module**

Create `src/throttle.ts`:

```ts
/**
 * Opt-in transition throttling. See
 * `docs/superpowers/specs/2026-08-03-transition-throttling-design.md`.
 *
 * Nothing here runs unless the consumer passes a `throttle` policy to the
 * `Store` constructor; the un-throttled path stays identity-equal to truth.
 */

/** The FSM machines a node can carry; dwell is configured per machine. */
export type MachineName = 'lifecycle' | 'transit' | 'focus';

/** Opaque to windease; the clock implementation owns its meaning. */
export type TimerHandle = unknown;

/**
 * Injectable time source. Tests supply a `FakeClock` so dwell and stagger
 * assertions are deterministic — windease has snapshot round-trip and
 * history tests that real timers would make flaky.
 */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface ThrottlePolicy {
  /** Flush window in ms. Omit for microtask scheduling (the default). */
  notifyMs?: number;
  /** Per-machine minimum dwell in ms. Machines omitted are not gated. */
  dwell?: Partial<Record<MachineName, number>>;
  /** Starvation cap. Defaults to 4x the largest configured dwell. */
  maxWaitMs?: number;
  /** Publish at most `batch` newly-eligible nodes every `ms`. */
  stagger?: { batch: number; ms: number };
}

export interface StoreOptions {
  throttle?: ThrottlePolicy;
  clock?: Clock;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/throttle.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/throttle.ts src/throttle.test.ts
git commit -m "feat(throttle): Clock, ThrottlePolicy, StoreOptions types"
```

---

## Task 3: `FakeClock` test helper

**Files:**
- Create: `src/test-utils/fake-clock.ts`
- Test: `src/test-utils/fake-clock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test-utils/fake-clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FakeClock } from './fake-clock.js';

describe('FakeClock', () => {
  it('starts at 0 and advances', () => {
    const c = new FakeClock();
    expect(c.now()).toBe(0);
    c.advance(100);
    expect(c.now()).toBe(100);
  });

  it('fires timers due within the advance window', () => {
    const c = new FakeClock();
    const fired: string[] = [];
    c.setTimeout(() => fired.push('a'), 50);
    c.setTimeout(() => fired.push('b'), 150);
    c.advance(100);
    expect(fired).toEqual(['a']);
    c.advance(100);
    expect(fired).toEqual(['a', 'b']);
  });

  it('fires timers in due order, ties broken by creation order', () => {
    const c = new FakeClock();
    const fired: string[] = [];
    c.setTimeout(() => fired.push('second'), 10);
    c.setTimeout(() => fired.push('first'), 5);
    c.setTimeout(() => fired.push('tie'), 10);
    c.advance(20);
    expect(fired).toEqual(['first', 'second', 'tie']);
  });

  it('observes now() as the timer due time inside the callback', () => {
    const c = new FakeClock();
    let observed = -1;
    c.setTimeout(() => {
      observed = c.now();
    }, 30);
    c.advance(100);
    expect(observed).toBe(30);
  });

  it('does not fire cleared timers', () => {
    const c = new FakeClock();
    let fired = false;
    const h = c.setTimeout(() => {
      fired = true;
    }, 10);
    c.clearTimeout(h);
    c.advance(100);
    expect(fired).toBe(false);
  });

  it('fires timers scheduled from within a timer callback', () => {
    const c = new FakeClock();
    const fired: string[] = [];
    c.setTimeout(() => {
      fired.push('outer');
      c.setTimeout(() => fired.push('inner'), 10);
    }, 10);
    c.advance(100);
    expect(fired).toEqual(['outer', 'inner']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/test-utils/fake-clock.test.ts`
Expected: FAIL — `Failed to resolve import "./fake-clock.js"`.

- [ ] **Step 3: Implement `FakeClock`**

Create `src/test-utils/fake-clock.ts`:

```ts
import type { Clock, TimerHandle } from '../throttle.js';

interface Entry {
  at: number;
  seq: number;
  fn: () => void;
}

/**
 * Deterministic `Clock` for tests. `advance(ms)` fires every timer due in
 * the window, in due order (ties broken by creation order), setting `now()`
 * to each timer's due time before invoking it — so code that reads the
 * clock inside a callback sees the time it was scheduled for, not the end
 * of the advance window.
 *
 * Timers scheduled from within a callback are picked up by the same
 * `advance` call if they come due inside the window.
 */
export class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private readonly timers = new Map<number, Entry>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle = ++this.seq;
    this.timers.set(handle, { at: this.t + ms, seq: handle, fn });
    return handle;
  }

  clearTimeout(h: TimerHandle): void {
    this.timers.delete(h as number);
  }

  /** Number of timers still pending. Useful for leak assertions. */
  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let nextHandle = -1;
      let next: Entry | undefined;
      for (const [handle, entry] of this.timers) {
        if (entry.at > target) continue;
        if (!next || entry.at < next.at || (entry.at === next.at && entry.seq < next.seq)) {
          next = entry;
          nextHandle = handle;
        }
      }
      if (!next) break;
      this.timers.delete(nextHandle);
      this.t = next.at;
      next.fn();
    }
    this.t = target;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test-utils/fake-clock.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/test-utils/fake-clock.ts src/test-utils/fake-clock.test.ts
git commit -m "test: deterministic FakeClock helper"
```

---

## Task 4: `Publisher` — passthrough mode

Passthrough is the no-policy path: published **is** truth by identity, and flush is `queueMicrotask`. This must be exactly today's `Store.scheduleNotify` behavior.

**Files:**
- Modify: `src/throttle.ts`
- Test: `src/throttle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/throttle.test.ts`:

```ts
import { Publisher } from './throttle.js';
import type { Node, NodeId } from './node.js';
import { createLifecycleMachine } from './machines/lifecycle.js';

const nid = (s: string) => s as NodeId;
const tick = () => new Promise<void>((r) => queueMicrotask(() => r()));

function makeNode(id: string): Node {
  return { id: nid(id), lifecycle: createLifecycleMachine() };
}

function harness(policy?: undefined) {
  const truth = new Map<NodeId, Node>();
  let rootIds: NodeId[] = [];
  let focusedId: NodeId | null = null;
  let notifies = 0;
  const pub = new Publisher({
    truth,
    policy,
    clock: new FakeClock(),
    readGlobals: () => ({ rootIds, focusedId }),
    notify: () => {
      notifies++;
    },
  });
  return {
    pub,
    truth,
    notifies: () => notifies,
    setRootIds: (ids: NodeId[]) => {
      rootIds = ids;
    },
    setFocused: (id: NodeId | null) => {
      focusedId = id;
    },
  };
}

describe('Publisher — passthrough', () => {
  it('reports passthrough when no policy is given', () => {
    const { pub } = harness();
    expect(pub.passthrough).toBe(true);
  });

  it('exposes truth by identity', () => {
    const { pub, truth } = harness();
    expect(pub.nodes).toBe(truth);
  });

  it('coalesces many marks into one microtask notify', async () => {
    const h = harness();
    h.truth.set(nid('a'), makeNode('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('a'));
    h.pub.markDirty(nid('b'));
    h.pub.markDirty(nid('a'));
    expect(h.notifies()).toBe(0);
    await tick();
    expect(h.notifies()).toBe(1);
  });

  it('reflects a mutation immediately, before any flush', () => {
    const h = harness();
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
  });
});
```

Also add `import { FakeClock } from './test-utils/fake-clock.js';` to the top of the file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/throttle.test.ts`
Expected: FAIL — `Publisher is not exported`.

- [ ] **Step 3: Implement passthrough `Publisher`**

Append to `src/throttle.ts`:

```ts
import type { Node, NodeId } from './node.js';
import { trace } from './trace.js';

export interface PublisherDeps {
  /** Live reference to the Store's truth map. Never copied wholesale. */
  truth: ReadonlyMap<NodeId, Node>;
  policy: ThrottlePolicy | undefined;
  clock: Clock;
  readGlobals: () => { rootIds: readonly NodeId[]; focusedId: NodeId | null };
  notify: () => void;
}

/**
 * Owns the published projection of the store.
 *
 * With no policy the Publisher is in **passthrough**: `nodes` returns the
 * truth map by identity, dirty marking is a no-op, and scheduling is the
 * plain `queueMicrotask` the Store has always used. Nothing is allocated
 * and nothing is tracked, so an un-throttled Store pays no cost.
 */
export class Publisher {
  readonly passthrough: boolean;

  private readonly truth: ReadonlyMap<NodeId, Node>;
  private readonly policy: ThrottlePolicy | undefined;
  private readonly clock: Clock;
  private readonly readGlobals: PublisherDeps['readGlobals'];
  private readonly notify: () => void;

  private readonly publishedNodes: Map<NodeId, Node> | null;
  private publishedRootIds: readonly NodeId[] = [];
  private publishedFocusedId: NodeId | null = null;

  private readonly dirty = new Set<NodeId>();
  private globalsDirty = false;
  private scheduled = false;
  private timer: TimerHandle | null = null;

  constructor(deps: PublisherDeps) {
    this.truth = deps.truth;
    this.policy = deps.policy;
    this.clock = deps.clock;
    this.readGlobals = deps.readGlobals;
    this.notify = deps.notify;
    this.passthrough = deps.policy === undefined;
    this.publishedNodes = this.passthrough ? null : new Map();
  }

  // ===== Published reads =====

  get nodes(): ReadonlyMap<NodeId, Node> {
    return this.passthrough ? this.truth : (this.publishedNodes as Map<NodeId, Node>);
  }

  get rootIds(): readonly NodeId[] {
    return this.passthrough ? this.readGlobals().rootIds : this.publishedRootIds;
  }

  get focusedId(): NodeId | null {
    return this.passthrough ? this.readGlobals().focusedId : this.publishedFocusedId;
  }

  // ===== Dirty marking =====

  markDirty(id: NodeId): void {
    if (!this.passthrough) this.dirty.add(id);
    this.schedule();
  }

  markGlobalsDirty(): void {
    if (!this.passthrough) this.globalsDirty = true;
    this.schedule();
  }

  // ===== Scheduling =====

  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const windowMs = this.policy?.notifyMs;
    if (windowMs === undefined) {
      queueMicrotask(() => this.runFlush());
    } else {
      this.timer = this.clock.setTimeout(() => this.runFlush(), windowMs);
    }
  }

  /** Publish everything pending right now, bypassing every gate. */
  flushNow(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    // A queued microtask can't be cancelled; clearing `scheduled` makes it
    // a no-op when it lands.
    this.scheduled = false;
    this.flush();
  }

  /** Drop all pending state. Used by `deserialize`. */
  reset(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduled = false;
    this.dirty.clear();
    this.globalsDirty = false;
    if (this.publishedNodes) {
      this.publishedNodes.clear();
      for (const [id, node] of this.truth) this.publishedNodes.set(id, node);
      const g = this.readGlobals();
      this.publishedRootIds = [...g.rootIds];
      this.publishedFocusedId = g.focusedId;
    }
  }

  private runFlush(): void {
    // flushNow() may have already drained us.
    if (!this.scheduled) return;
    this.scheduled = false;
    this.timer = null;
    this.flush();
  }

  private flush(): void {
    if (this.passthrough) {
      this.notify();
      return;
    }
    const published = this.publishedNodes as Map<NodeId, Node>;
    let count = 0;
    for (const id of this.dirty) {
      const node = this.truth.get(id);
      if (node === undefined) published.delete(id);
      else published.set(id, node);
      count++;
    }
    this.dirty.clear();
    if (this.globalsDirty) {
      const g = this.readGlobals();
      this.publishedRootIds = [...g.rootIds];
      this.publishedFocusedId = g.focusedId;
      this.globalsDirty = false;
    }
    trace('throttle', `flush: published ${count} node(s)`);
    this.notify();
  }
}
```

Move the `import type { Node, NodeId }` and `import { trace }` lines to the top of the file alongside the existing imports — Biome will flag imports below other statements.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/throttle.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/throttle.ts src/throttle.test.ts
git commit -m "feat(throttle): Publisher with identity-equal passthrough"
```

---

## Task 5: `Publisher` — throttled mode with `notifyMs`

**Files:**
- Test: `src/throttle.test.ts`

No implementation changes — Task 4's `Publisher` already handles this. This task proves the throttled path works and locks the behavior in.

- [ ] **Step 1: Write the failing test**

Append to `src/throttle.test.ts`:

```ts
function throttledHarness(policy: ThrottlePolicy) {
  const truth = new Map<NodeId, Node>();
  let rootIds: NodeId[] = [];
  let focusedId: NodeId | null = null;
  let notifies = 0;
  const clock = new FakeClock();
  const pub = new Publisher({
    truth,
    policy,
    clock,
    readGlobals: () => ({ rootIds, focusedId }),
    notify: () => {
      notifies++;
    },
  });
  return {
    pub,
    truth,
    clock,
    notifies: () => notifies,
    setRootIds: (ids: NodeId[]) => {
      rootIds = ids;
    },
  };
}

describe('Publisher — notifyMs window', () => {
  it('is not passthrough and allocates its own map', () => {
    const h = throttledHarness({ notifyMs: 32 });
    expect(h.pub.passthrough).toBe(false);
    expect(h.pub.nodes).not.toBe(h.truth);
  });

  it('withholds a mutation until the window elapses', () => {
    const h = throttledHarness({ notifyMs: 32 });
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    h.pub.markDirty(nid('a'));

    expect(h.pub.nodes.get(nid('a'))).toBeUndefined();
    expect(h.notifies()).toBe(0);

    h.clock.advance(31);
    expect(h.pub.nodes.get(nid('a'))).toBeUndefined();

    h.clock.advance(1);
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
    expect(h.notifies()).toBe(1);
  });

  it('coalesces a burst across the window into one notify', () => {
    const h = throttledHarness({ notifyMs: 32 });
    for (const id of ['a', 'b', 'c']) {
      h.truth.set(nid(id), makeNode(id));
      h.pub.markDirty(nid(id));
      h.clock.advance(5);
    }
    expect(h.notifies()).toBe(0);
    h.clock.advance(32);
    expect(h.notifies()).toBe(1);
    expect(h.pub.nodes.size).toBe(3);
  });

  it('publishes the latest truth, not the value at mark time', () => {
    const h = throttledHarness({ notifyMs: 32 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    const latest = makeNode('a');
    h.truth.set(nid('a'), latest);
    h.clock.advance(32);
    expect(h.pub.nodes.get(nid('a'))).toBe(latest);
  });

  it('drops a node deleted from truth before the flush', () => {
    const h = throttledHarness({ notifyMs: 32 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    h.clock.advance(32);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);

    h.truth.delete(nid('a'));
    h.pub.markDirty(nid('a'));
    h.clock.advance(32);
    expect(h.pub.nodes.has(nid('a'))).toBe(false);
  });

  it('flushNow() publishes immediately and cancels the pending timer', () => {
    const h = throttledHarness({ notifyMs: 32 });
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    h.pub.markDirty(nid('a'));

    h.pub.flushNow();
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
    expect(h.notifies()).toBe(1);
    expect(h.clock.pending).toBe(0);

    h.clock.advance(100);
    expect(h.notifies()).toBe(1);
  });

  it('projects rootIds only on flush', () => {
    const h = throttledHarness({ notifyMs: 32 });
    h.setRootIds([nid('a')]);
    h.pub.markGlobalsDirty();
    expect(h.pub.rootIds).toEqual([]);
    h.clock.advance(32);
    expect(h.pub.rootIds).toEqual([nid('a')]);
  });

  it('reset() snaps published to truth and cancels timers', () => {
    const h = throttledHarness({ notifyMs: 32 });
    const n = makeNode('a');
    h.truth.set(nid('a'), n);
    h.pub.markDirty(nid('a'));

    h.pub.reset();
    expect(h.pub.nodes.get(nid('a'))).toBe(n);
    expect(h.clock.pending).toBe(0);
  });
});
```

Add `ThrottlePolicy` to the type import from `./throttle.js`.

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/throttle.test.ts`
Expected: PASS, 14 tests. If `flushNow` or `reset` fail, the bug is in Task 4's implementation — fix it there.

- [ ] **Step 3: Commit**

```bash
git add src/throttle.test.ts
git commit -m "test(throttle): notifyMs window, flushNow, reset"
```

---

## Task 6: Give `Store` a constructor and a `Publisher`

**Files:**
- Modify: `src/store.ts:73-80` (field block), `src/store.ts:782-789` (`scheduleNotify`)
- Test: `src/store.throttle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store.throttle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from './constructors.js';
import { asNodeId } from './node.js';
import { Store } from './store.js';
import { FakeClock } from './test-utils/fake-clock.js';

const tick = () => new Promise<void>((r) => queueMicrotask(() => r()));

// `NodeId` is a branded string and `createZone` requires `config`, so every
// test in this file builds nodes through these three helpers.
const nid = (s: string) => asNodeId(s);
const zone = (id: string) => createZone({ id: nid(id), strategyId: 'grid', config: {} });
const panel = (id: string, parentId: string) =>
  createPanel({ id: nid(id), parentId: nid(parentId) });

describe('Store construction', () => {
  it('still constructs with no arguments', () => {
    const store = new Store();
    expect(store.nodes.size).toBe(0);
  });

  it('is passthrough when no throttle policy is given', () => {
    const store = new Store();
    expect(store.nodes).toBe(store.nodesTruth);
  });

  it('allocates a separate projection when throttled', () => {
    const store = new Store({ throttle: { notifyMs: 32 }, clock: new FakeClock() });
    expect(store.nodes).not.toBe(store.nodesTruth);
  });

  it('notifies subscribers on a microtask when un-throttled', async () => {
    const store = new Store();
    let calls = 0;
    store.subscribe(() => {
      calls++;
    });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    expect(calls).toBe(0);
    await tick();
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/store.throttle.test.ts`
Expected: FAIL — `store.nodesTruth is not a function` / property does not exist.

- [ ] **Step 3: Add the constructor**

In `src/store.ts`, add to the import block at the top:

```ts
import { Publisher, type StoreOptions, systemClock } from './throttle.js';
```

Replace the field block at `src/store.ts:73-80`:

```ts
export class Store {
  readonly events = new TypedEmitter<StoreEvents>();
  private readonly nodesMap = new Map<NodeId, Node>();
  private readonly rootIdsArr: NodeId[] = [];
  private focusedIdValue: NodeId | null = null;
  private readonly subscribers = new Set<() => void>();
  private readonly publisher: Publisher;

  constructor(options: StoreOptions = {}) {
    this.publisher = new Publisher({
      truth: this.nodesMap,
      policy: options.throttle,
      clock: options.clock ?? systemClock,
      readGlobals: () => ({ rootIds: this.rootIdsArr, focusedId: this.focusedIdValue }),
      notify: () => {
        for (const fn of this.subscribers) fn();
      },
    });
  }
```

Note the `notifyScheduled` field is gone — the `Publisher` owns scheduling now.

Replace `scheduleNotify` at `src/store.ts:782-789`:

```ts
  private scheduleNotify(): void {
    this.publisher.schedule();
  }

  /**
   * Publish every pending change synchronously, bypassing `notifyMs`,
   * dwell, and stagger alike. Subscribers are notified before this returns.
   *
   * Use at a synchronization point where pending latency is unwanted — an
   * explicit user gesture that must feel immediate, or a test assertion.
   */
  flushNow(): void {
    this.publisher.flushNow();
  }
```

Add the two truth accessors next to the existing getters (near `src/store.ts:83`):

```ts
  /** Truth: unlagged, exactly what the last mutation wrote. */
  get nodesTruth(): ReadonlyMap<NodeId, Node> {
    return this.nodesMap;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store.throttle.test.ts`
Expected: FAIL on the third case — `store.nodes` still returns truth. That is expected; Task 8 wires the projection. Confirm the other 3 pass.

- [ ] **Step 5: Run the full suite for regressions**

Run: `npx vitest run`
Expected: all pre-existing tests still pass (the microtask path is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/store.ts src/store.throttle.test.ts
git commit -m "feat(store): constructor with StoreOptions, delegate scheduling to Publisher"
```

---

## Task 7: Mark nodes dirty at every mutation chokepoint

**Files:**
- Modify: `src/store.ts` — `replaceNode`, `replaceContainer`, `replaceSlot`, `registerNode`, `unregisterNode`, `detachAndRemove`, `focusNode`, `blurAll`

- [ ] **Step 1: Route the three record-replacement helpers through the Publisher**

Every node mutation funnels through one of these three. Replace them at `src/store.ts:799-820`:

```ts
  /** Replace the node entry with a fresh object so referential subscribers
   *  re-render. Optionally transforms the node. */
  private replaceNode(id: NodeId, fn?: (n: Node) => Node): void {
    const prev = this.nodesMap.get(id);
    if (!prev) return;
    const next = fn ? fn(prev) : { ...prev };
    this.nodesMap.set(id, next);
    this.publisher.markDirty(id);
  }

  private replaceContainer(id: NodeId, fn: (c: ContainerCap) => ContainerCap): void {
    const prev = this.nodesMap.get(id);
    if (!prev?.container) return;
    const nextContainer = fn(prev.container);
    this.nodesMap.set(id, { ...prev, container: nextContainer });
    this.publisher.markDirty(id);
  }

  private replaceSlot(id: NodeId, fn: (s: SlotCap) => SlotCap): void {
    const prev = this.nodesMap.get(id);
    if (!prev?.slot) return;
    const nextSlot = fn(prev.slot);
    this.nodesMap.set(id, { ...prev, slot: nextSlot });
    this.publisher.markDirty(id);
  }
```

- [ ] **Step 2: Mark register/unregister**

In `registerNode` (`src/store.ts:152-179`), the two direct `this.nodesMap.set(node.id, node)` calls bypass the helpers. Add a mark and a globals mark. Replace the body's set/push section:

```ts
    if (node.slot) {
      const parent = this.nodesMap.get(node.slot.parentId);
      if (!parent) throw new NodeNotFoundError(node.slot.parentId);
      if (!parent.container) {
        throw new InvariantViolationError(
          'parent-not-container',
          `parent ${node.slot.parentId} has no container capability`,
          { parentId: node.slot.parentId, childId: node.id },
        );
      }
      this.nodesMap.set(node.id, node);
      this.publisher.markDirty(node.id);
      this.replaceContainer(parent.id, (c) => ({
        ...c,
        childOrder: [...c.childOrder, node.id],
      }));
      this.resortByPin(parent.id);
    } else {
      this.nodesMap.set(node.id, node);
      this.publisher.markDirty(node.id);
      this.rootIdsArr.push(node.id);
      this.publisher.markGlobalsDirty();
    }
```

- [ ] **Step 3: Mark removal and focus**

Find `detachAndRemove` and add `this.publisher.markDirty(id)` plus `this.publisher.markGlobalsDirty()` immediately after the `this.nodesMap.delete(id)` call (the id is no longer in truth, so the flush will delete it from published).

In `focusNode` and `blurAll`, add `this.publisher.markGlobalsDirty();` next to each `this.focusedIdValue = ...` assignment.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass. Dirty marking is inert in passthrough mode, so nothing observable changes yet.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts
git commit -m "feat(store): mark nodes dirty at mutation chokepoints"
```

---

## Task 8: Project published reads through `Store`

**Files:**
- Modify: `src/store.ts` — `nodes`, `rootIds`, `focusedId`, `getNode`; add `getNodeTruth`, `focusedIdTruth`, `rootIdsTruth`
- Test: `src/store.throttle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/store.throttle.test.ts`:

```ts
describe('Store published projection', () => {
  it('withholds a registration until the notify window elapses', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 32 }, clock });
    store.registerNode(zone('z'));

    expect(store.getNodeTruth(nid('z'))).toBeDefined();
    expect(store.getNode(nid('z'))).toBeUndefined();

    clock.advance(32);
    expect(store.getNode(nid('z'))).toBeDefined();
  });

  it('shares one Machine instance between truth and published', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 32 }, clock });
    store.registerNode(zone('z'));
    clock.advance(32);

    const published = store.getNode(nid('z'));
    const truth = store.getNodeTruth(nid('z'));
    expect(published).toBe(truth);
    expect(published?.lifecycle).toBe(truth?.lifecycle);
    expect(typeof published?.lifecycle.send).toBe('function');
  });

  it('projects rootIds on flush', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 32 }, clock });
    store.registerNode(zone('z'));
    expect(store.rootIds).toEqual([]);
    expect(store.rootIdsTruth).toEqual([nid('z')]);
    clock.advance(32);
    expect(store.rootIds).toEqual([nid('z')]);
  });

  it('flushNow() collapses pending latency', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 5000 }, clock });
    store.registerNode(zone('z'));
    expect(store.getNode(nid('z'))).toBeUndefined();
    store.flushNow();
    expect(store.getNode(nid('z'))).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/store.throttle.test.ts`
Expected: FAIL — `getNodeTruth` / `rootIdsTruth` are not functions.

- [ ] **Step 3: Wire the projections**

Replace the read getters at `src/store.ts:83-98`:

```ts
  // ===== Read =====
  //
  // `nodes` / `rootIds` / `focusedId` / `getNode` return the PUBLISHED view:
  // what subscribers and the React layer see, which may lag truth when a
  // throttle policy is configured. The `*Truth` variants return the exact
  // current state and are what snapshot and history read.
  //
  // With no throttle policy the two are identity-equal.

  get nodes(): ReadonlyMap<NodeId, Node> {
    return this.publisher.nodes;
  }

  /** Truth: unlagged, exactly what the last mutation wrote. */
  get nodesTruth(): ReadonlyMap<NodeId, Node> {
    return this.nodesMap;
  }

  get rootIds(): readonly NodeId[] {
    return this.publisher.rootIds;
  }

  /** Truth: unlagged root id list. */
  get rootIdsTruth(): readonly NodeId[] {
    return this.rootIdsArr;
  }

  get focusedId(): NodeId | null {
    return this.publisher.focusedId;
  }

  /** Truth: unlagged focused id. */
  get focusedIdTruth(): NodeId | null {
    return this.focusedIdValue;
  }

  getNode(id: NodeId): Node | undefined {
    return this.publisher.nodes.get(id);
  }

  /** Truth: unlagged node record. */
  getNodeTruth(id: NodeId): Node | undefined {
    return this.nodesMap.get(id);
  }
```

Delete the `nodesTruth` getter added in Task 6 if it now duplicates this block.

**Critical:** every *internal* `Store` method must keep reading truth. Audit the file for `this.getNode(` and `this.nodes.` and change them to `this.nodesMap.get(` / `this.nodesMap.` — internal invariants (`requireNode`, `collectDescendants`, `resortByPin`, cycle checks, `getChildren`, `getParent`, `getAncestors`) must never see a lagged view. `requireNode` already uses `this.nodesMap` directly; verify the rest.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/store.throttle.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all pass. Any failure here means an internal method was reading the published view — fix it to read `nodesMap`.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts src/store.throttle.test.ts
git commit -m "feat(store): published read projection with *Truth escape hatches"
```

---

## Task 9: Snapshot reads truth

**Files:**
- Modify: `src/snapshot.ts` (if it reads `store.nodes`)
- Test: `src/store.throttle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/store.throttle.test.ts`:

```ts
import { deserialize, serialize } from './snapshot.js';

describe('snapshot under throttling', () => {
  it('serializes truth, not the lagged published view', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 5000 }, clock });
    store.registerNode(zone('z'));

    expect(store.getNode(nid('z'))).toBeUndefined();
    const snap = serialize(store);
    expect(snap.nodes.map((n) => n.id)).toContain('z');
  });

  it('deserialize snaps published to truth with no pending timers', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 5000 }, clock });
    store.registerNode(zone('z'));
    store.flushNow();

    const snap = serialize(store);
    const restored = new Store({ throttle: { notifyMs: 5000 }, clock: new FakeClock() });
    deserialize(restored, snap);

    // No advance() — hydration is wholesale, so published must match at once.
    expect(restored.getNode(nid('z'))).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/store.throttle.test.ts -t snapshot`
Expected: FAIL — `serialize` reads `store.nodes` (published), which is empty.

- [ ] **Step 3: Point snapshot at truth**

There are exactly five reads to change in `src/snapshot.ts`. Confirm with:

```bash
grep -n "store\.nodes\|store\.rootIds\|store\.focusedId\|\.getNode(" src/snapshot.ts
```

| Line | Current | Change to | Why |
| ---- | ------- | --------- | --- |
| 54 | `store.nodes.values()` | `store.nodesTruth.values()` | serialize must capture every node, not just published ones |
| 91 | `[...store.rootIds]` | `[...store.rootIdsTruth]` | same |
| 92 | `store.focusedId` | `store.focusedIdTruth` | same |
| 202 | `if (store.getNode(asNodeId(sn.id))) continue;` | `if (store.getNodeTruth(asNodeId(sn.id))) continue;` | **behavior-critical** — this is a dedup guard. Reading the lagged view would let an already-registered node through and throw `DuplicateNodeError`. |
| 216 | `store.getNode(asNodeId(snap.focusedId))` | `store.getNodeTruth(asNodeId(snap.focusedId))` | the node was registered moments ago and has not been published yet |

At the end of `deserialize`, after all nodes are registered, add:

```ts
  // Hydration is a wholesale replacement, not an incremental change — the
  // published view must match immediately and any in-flight timers from the
  // pre-hydrate store are meaningless.
  store.resetPublished();
```

Add the delegating method to `src/store.ts` next to `flushNow`:

```ts
  /**
   * Snap the published view to truth and cancel pending flushes. Called by
   * `deserialize`; consumers should not need this.
   *
   * @internal
   */
  resetPublished(): void {
    this.publisher.reset();
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/snapshot.test.ts src/store.throttle.test.ts`
Expected: PASS, including all pre-existing snapshot tests.

- [ ] **Step 5: Commit**

```bash
git add src/snapshot.ts src/store.ts src/store.throttle.test.ts
git commit -m "fix(snapshot): read truth, reset published projection on hydrate"
```

---

## Task 10: Prove undo/redo publishes immediately

**`src/history.ts` needs no change.** `HistoryController<TSnapshot>` is a
generic snapshot *stack* — it holds no `Store` reference and never touches
one. `undo()` merely returns a previously-pushed snapshot; the consumer
applies it via `deserialize(store, snap)`. Since Task 9 made `deserialize`
call `resetPublished()`, undo already publishes immediately.

This task locks that guarantee in with a test so a future refactor of the
restore path can't silently regress it.

**Files:**
- Test: `src/store.throttle.test.ts`

- [ ] **Step 1: Write the test**

Append to `src/store.throttle.test.ts`:

```ts
import { HistoryController } from './history.js';
import type { SerializedStore } from './snapshot.js';

describe('history under throttling', () => {
  it('publishes an undo immediately rather than waiting out the window', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 5000 }, clock });
    const history = new HistoryController<SerializedStore>();

    store.registerNode(zone('z'));
    store.flushNow();
    history.push(serialize(store));

    store.registerNode(panel('p', 'z'));
    store.flushNow();
    history.push(serialize(store));
    expect(store.getNode(nid('p'))).toBeDefined();

    const prev = history.undo();
    expect(prev).toBeDefined();
    deserialize(store, prev as SerializedStore);

    // No clock.advance() — an undo is a user gesture and must not lag.
    expect(store.getNode(nid('p'))).toBeUndefined();
    expect(store.getNode(nid('z'))).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/store.throttle.test.ts -t history`
Expected: PASS. If `p` is still present, `deserialize` is not calling
`resetPublished()` — go back and finish Task 9 Step 3.

- [ ] **Step 3: Commit**

```bash
git add src/store.throttle.test.ts
git commit -m "test(history): undo publishes immediately under throttling"
```

---

## Task 11: React snapshot stability

**Files:**
- Create: `src/react/throttle.test.tsx`

- [ ] **Step 1: Write the test**

Create `src/react/throttle.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { createPanel, createZone } from '../constructors.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { FakeClock } from '../test-utils/fake-clock.js';
import { Provider } from './Provider.js';
import { useChildren, useNode } from './hooks.js';

const nid = (s: string) => asNodeId(s);
const zone = (id: string) => createZone({ id: nid(id), strategyId: 'grid', config: {} });
const panel = (id: string, parentId: string) =>
  createPanel({ id: nid(id), parentId: nid(parentId) });

function Probe({ id }: { id: string }) {
  const node = useNode(nid(id));
  const children = useChildren(nid(id));
  return (
    <div>
      <span data-testid="present">{node ? 'yes' : 'no'}</span>
      <span data-testid="children">{children.length}</span>
    </div>
  );
}

describe('React under throttling', () => {
  it('does not loop useSyncExternalStore and reflects the flush', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { notifyMs: 32 }, clock });
    store.registerNode(zone('z'));
    store.flushNow();

    render(
      <Provider store={store}>
        <Probe id="z" />
      </Provider>,
    );
    expect(screen.getByTestId('present').textContent).toBe('yes');
    expect(screen.getByTestId('children').textContent).toBe('0');

    act(() => {
      store.registerNode(panel('p', 'z'));
    });
    // Still inside the window — the layout must not have moved yet.
    expect(screen.getByTestId('children').textContent).toBe('0');

    act(() => {
      clock.advance(32);
    });
    expect(screen.getByTestId('children').textContent).toBe('1');
  });

  it('renders an un-throttled store exactly as before', async () => {
    const store = new Store();
    store.registerNode(zone('z'));

    render(
      <Provider store={store}>
        <Probe id="z" />
      </Provider>,
    );
    expect(screen.getByTestId('present').textContent).toBe('yes');

    await act(async () => {
      store.registerNode(panel('p', 'z'));
      await Promise.resolve();
    });
    expect(screen.getByTestId('children').textContent).toBe('1');
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/react/throttle.test.tsx`
Expected: PASS, 2 tests. A "Maximum update depth exceeded" error means a published record is being rebuilt on read — `Publisher.flush` must store the truth object by reference, never a copy.

- [ ] **Step 3: Commit**

```bash
git add src/react/throttle.test.tsx
git commit -m "test(react): snapshot stability under throttled flushes"
```

---

## Task 12: Export the public surface and document it

**Files:**
- Modify: `src/index.ts`, `README.md`

- [ ] **Step 1: Add the exports**

In `src/index.ts`, add next to the `Store` export at line 77:

```ts
export {
  systemClock,
  type Clock,
  type MachineName,
  type StoreOptions,
  type ThrottlePolicy,
  type TimerHandle,
} from './throttle.js';
```

`Publisher` is **not** exported — it is an implementation detail of `Store`.

- [ ] **Step 2: Document in the README**

Add a section to `README.md` after the store/persistence material:

````markdown
### Optional transition throttling

Consumers driving the store from a live event stream can rate-limit how
fast the layout reacts. All of it is opt-in — omit `throttle` and the
store behaves exactly as it always has.

```ts
const store = new Store({
  throttle: {
    notifyMs: 32,                     // coalesce bursts into one flush
    dwell: { lifecycle: 150 },        // min quiet time before a state publishes
    stagger: { batch: 8, ms: 40 },    // publish mass transitions in waves
  },
});
```

Throttling gates **observation, never truth**. `getNode()` returns the
published view that subscribers and the React layer see; `getNodeTruth()`,
`nodesTruth`, `rootIdsTruth`, and `focusedIdTruth` return the exact current
state. Snapshot and history always read truth, so persistence and undo are
unaffected. `store.flushNow()` publishes everything pending immediately.

Set `WINDEASE_TRACE=throttle` to see publish decisions.
````

- [ ] **Step 3: Verify the build and lint**

Run: `npm run build && npm run lint && npx vitest run`
Expected: clean build, clean Biome check, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts README.md
git commit -m "feat(throttle): export public surface, document in README"
```

---

# Phase 2 — Dwell

Delivers mechanism #2: the bounce fix. Dwell is a **debounce** — a node publishes once it has been quiet for `dwellMs`, or when `maxWaitMs` has elapsed since it first went dirty.

## Task 13: Dirty entries carry dwell state

**Files:**
- Modify: `src/throttle.ts` — replace `dirty: Set` with `dirty: Map`

- [ ] **Step 1: Replace the dirty set with entries**

In `src/throttle.ts`, add above the `Publisher` class:

```ts
interface DirtyEntry {
  /** clock.now() when this node first went dirty and has stayed dirty. */
  since: number;
  /** clock.now() of the most recent change; the debounce restarts here. */
  touched: number;
  /**
   * Largest dwell among the machines that transitioned since the last
   * publish. 0 means this node is not dwell-gated — only non-FSM changes
   * have landed, so it rides the notifyMs window.
   */
  dwellMs: number;
  /** Structural change (register/unregister/move); bypasses dwell entirely. */
  bypass: boolean;
}
```

Change the field declaration:

```ts
  private readonly dirty = new Map<NodeId, DirtyEntry>();
```

Replace `markDirty` with the machine-aware version:

```ts
  markDirty(id: NodeId, opts?: { machine?: MachineName; bypass?: boolean }): void {
    if (!this.passthrough) {
      const now = this.clock.now();
      const dwellForMachine = opts?.machine
        ? (this.policy?.dwell?.[opts.machine] ?? 0)
        : 0;
      const existing = this.dirty.get(id);
      if (existing) {
        existing.touched = now;
        // A node dwells for the longest gate that applies to it.
        if (dwellForMachine > existing.dwellMs) existing.dwellMs = dwellForMachine;
        if (opts?.bypass) existing.bypass = true;
      } else {
        this.dirty.set(id, {
          since: now,
          touched: now,
          dwellMs: dwellForMachine,
          bypass: opts?.bypass ?? false,
        });
      }
    }
    this.schedule();
  }
```

Update `flush()` to iterate entries:

```ts
    for (const [id, _entry] of this.dirty) {
      const node = this.truth.get(id);
      if (node === undefined) published.delete(id);
      else published.set(id, node);
      count++;
    }
```

- [ ] **Step 2: Run the existing tests**

Run: `npx vitest run`
Expected: all pass. No behavior change yet — `dwellMs` is recorded but not consulted.

- [ ] **Step 3: Commit**

```bash
git add src/throttle.ts
git commit -m "refactor(throttle): dirty entries carry dwell bookkeeping"
```

---

## Task 14: Dwell eligibility and `maxWaitMs`

**Files:**
- Modify: `src/throttle.ts` — `flush`, plus a `maxWaitMs` resolver
- Test: `src/throttle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/throttle.test.ts`:

```ts
describe('Publisher — dwell', () => {
  const policy = { notifyMs: 10, dwell: { lifecycle: 150 }, maxWaitMs: 600 };

  it('publishes an isolated transition after dwellMs of quiet', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    h.clock.advance(149);
    expect(h.pub.nodes.has(nid('a'))).toBe(false);

    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('never publishes the intermediate state of a bounce', () => {
    const h = throttledHarness(policy);
    const first = makeNode('a');
    h.truth.set(nid('a'), first);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    h.clock.advance(80);
    const second = makeNode('a');
    h.truth.set(nid('a'), second);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    // The debounce restarted at t=80, so nothing is published at t=150.
    h.clock.advance(70);
    expect(h.pub.nodes.has(nid('a'))).toBe(false);

    h.clock.advance(80);
    expect(h.pub.nodes.get(nid('a'))).toBe(second);
  });

  it('forces a publish at maxWaitMs under continuous churn', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    for (let t = 0; t < 600; t += 50) {
      h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
      h.clock.advance(50);
    }
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('does not dwell a node whose machines are stable', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('does not dwell a machine with no configured dwell', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'focus' });
    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('bypasses dwell for structural changes', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle', bypass: true });
    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });

  it('holds a dwelling node while publishing its stable neighbor', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('a'), makeNode('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('b'));

    h.clock.advance(10);
    expect(h.pub.nodes.has(nid('b'))).toBe(true);
    expect(h.pub.nodes.has(nid('a'))).toBe(false);
  });

  it('defaults maxWaitMs to 4x the largest dwell', () => {
    const h = throttledHarness({ notifyMs: 10, dwell: { lifecycle: 100 } });
    h.truth.set(nid('a'), makeNode('a'));
    for (let t = 0; t < 400; t += 50) {
      h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
      h.clock.advance(50);
    }
    expect(h.pub.nodes.has(nid('a'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/throttle.test.ts -t dwell`
Expected: FAIL — dwell is not consulted, so the first assertion of "publishes an isolated transition after dwellMs" sees the node already published at t=149.

- [ ] **Step 3: Implement eligibility**

In `src/throttle.ts`, add a resolved max-wait to the constructor. Add the field and initializer:

```ts
  private readonly maxWaitMs: number;
```

```ts
    const dwells = Object.values(deps.policy?.dwell ?? {}).filter(
      (v): v is number => typeof v === 'number',
    );
    const largestDwell = dwells.length > 0 ? Math.max(...dwells) : 0;
    this.maxWaitMs = deps.policy?.maxWaitMs ?? largestDwell * 4;
```

Replace `flush()`:

```ts
  private flush(): void {
    if (this.passthrough) {
      this.notify();
      return;
    }
    const published = this.publishedNodes as Map<NodeId, Node>;
    const now = this.clock.now();
    let count = 0;
    let held = 0;

    for (const [id, entry] of [...this.dirty]) {
      if (!this.isEligible(entry, now)) {
        held++;
        continue;
      }
      const node = this.truth.get(id);
      if (node === undefined) published.delete(id);
      else published.set(id, node);
      this.dirty.delete(id);
      count++;
    }

    if (this.globalsDirty) {
      const g = this.readGlobals();
      this.publishedRootIds = [...g.rootIds];
      this.publishedFocusedId = g.focusedId;
      this.globalsDirty = false;
    }

    if (count > 0 || held === 0) {
      trace('throttle', `flush: published ${count}, held ${held}`);
      this.notify();
    }

    // Anything still dwelling needs another look.
    if (this.dirty.size > 0) this.schedule();
  }

  /**
   * A node publishes once it has been quiet for `dwellMs`, or when
   * `maxWaitMs` has elapsed since it first went dirty — the starvation cap
   * that stops a permanently-noisy node from never updating.
   */
  private isEligible(entry: DirtyEntry, now: number): boolean {
    if (entry.bypass || entry.dwellMs === 0) return true;
    if (now - entry.touched >= entry.dwellMs) return true;
    if (this.maxWaitMs > 0 && now - entry.since >= this.maxWaitMs) {
      trace('throttle', `maxWait forced publish after ${now - entry.since}ms`);
      return true;
    }
    return false;
  }
```

`schedule()` must be able to re-arm while a flush is in progress. Change its guard so a re-schedule from inside `flush` is honored — `runFlush` already clears `scheduled` before calling `flush`, so no change is needed, but verify by running the tests.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/throttle.test.ts`
Expected: PASS, all dwell tests plus the Phase 1 tests.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/throttle.ts src/throttle.test.ts
git commit -m "feat(throttle): dwell debounce with maxWaitMs starvation cap"
```

---

## Task 15: `Store` tags FSM transitions and structural changes

**Files:**
- Modify: `src/store.ts` — `showNode`, `hideNode`, `focusNode`, `blurAll`, `moveNode`, `reorderInParent`, `setChildOrder`, `registerNode`, `unregisterNode`
- Test: `src/store.throttle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/store.throttle.test.ts`:

```ts
describe('Store dwell', () => {
  const policy = { notifyMs: 10, dwell: { lifecycle: 150 }, maxWaitMs: 600 };

  function seeded() {
    const clock = new FakeClock();
    const store = new Store({ throttle: policy, clock });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.flushNow();
    return { store, clock };
  }

  it('never publishes the intermediate state of a show/hide/show bounce', () => {
    const { store, clock } = seeded();
    const seen: string[] = [];
    store.subscribe(() => {
      const n = store.getNode(nid('p'));
      if (n) seen.push(n.lifecycle.state);
    });

    store.showNode(nid('p'));
    clock.advance(40);
    store.hideNode(nid('p'));
    clock.advance(40);
    store.showNode(nid('p'));
    clock.advance(200);

    expect(seen).not.toContain('hidden');
    expect(store.getNode(nid('p'))?.lifecycle.state).toBe('visible');
  });

  it('keeps truth exact throughout the dwell', () => {
    const { store, clock } = seeded();
    store.showNode(nid('p'));
    store.hideNode(nid('p'));
    expect(store.getNodeTruth(nid('p'))?.lifecycle.state).toBe('hidden');
    clock.advance(200);
    expect(store.getNode(nid('p'))?.lifecycle.state).toBe('hidden');
  });

  it('publishes an unregister immediately despite dwell', () => {
    const { store, clock } = seeded();
    store.showNode(nid('p'));
    store.unregisterNode(nid('p'));
    clock.advance(10);
    expect(store.getNode(nid('p'))).toBeUndefined();
  });

  it('publishes a reorder without waiting out dwell', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: policy, clock });
    store.registerNode(zone('z'));
    store.registerNode(panel('a', 'z'));
    store.registerNode(panel('b', 'z'));
    store.flushNow();

    store.reorderInParent(nid('b'), 0);
    clock.advance(10);
    expect(store.getNode(nid('z'))?.container?.childOrder).toEqual([nid('b'), nid('a')]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/store.throttle.test.ts -t "Store dwell"`
Expected: FAIL — `seen` contains `'hidden'`, because the store never tags transitions with a machine name.

- [ ] **Step 3: Tag the FSM transition sites**

In `showNode` and `hideNode` (`src/store.ts:683-723`), add after the `replaceNode` call in each:

```ts
    this.publisher.markDirty(id, { machine: 'lifecycle' });
```

In `focusNode` and `blurAll` (`src/store.ts:725-771`), add for each node whose focus machine transitioned:

```ts
    this.publisher.markDirty(id, { machine: 'focus' });
```

In `moveNode` (`src/store.ts:238-330`), the transit machine transitions and the move is structural. Add after the transit sends:

```ts
    this.publisher.markDirty(id, { machine: 'transit', bypass: true });
```

- [ ] **Step 4: Tag the structural sites**

Structural changes must never dwell — a node that no longer exists cannot be rendered, and DnD must stay responsive. Add `{ bypass: true }` to the marks in:

- `registerNode` — both `this.publisher.markDirty(node.id)` calls become `this.publisher.markDirty(node.id, { bypass: true })`
- `detachAndRemove` — `this.publisher.markDirty(id, { bypass: true })`
- `reorderInParent` and `setChildOrder` — mark the parent: `this.publisher.markDirty(parentId, { bypass: true })`

`registerNode`'s `replaceContainer(parent.id, ...)` call marks the parent without bypass; add an explicit bypassed mark for the parent after it so a newly-added child appears without waiting on the parent's dwell:

```ts
      this.publisher.markDirty(parent.id, { bypass: true });
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/store.throttle.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and lint**

Run: `npx vitest run && npm run lint`
Expected: all pass, clean check.

- [ ] **Step 7: Commit**

```bash
git add src/store.ts src/store.throttle.test.ts
git commit -m "feat(store): tag FSM transitions for dwell, bypass structural changes"
```

---

# Phase 3 — Stagger

Delivers mechanism #3: mass transitions publish in waves instead of all at once.

## Task 16: Stagger batching

**Files:**
- Modify: `src/throttle.ts` — `flush`
- Test: `src/throttle.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/throttle.test.ts`:

```ts
describe('Publisher — stagger', () => {
  const policy = { notifyMs: 10, stagger: { batch: 2, ms: 40 } };

  function seedMany(h: ReturnType<typeof throttledHarness>, ids: string[]) {
    for (const id of ids) {
      h.truth.set(nid(id), makeNode(id));
      h.pub.markDirty(nid(id));
    }
  }

  it('publishes at most `batch` nodes per wave', () => {
    const h = throttledHarness(policy);
    seedMany(h, ['a', 'b', 'c', 'd', 'e']);

    h.clock.advance(10);
    expect(h.pub.nodes.size).toBe(2);

    h.clock.advance(40);
    expect(h.pub.nodes.size).toBe(4);

    h.clock.advance(40);
    expect(h.pub.nodes.size).toBe(5);
  });

  it('publishes in oldest-dirty-first order', () => {
    const h = throttledHarness(policy);
    h.truth.set(nid('old'), makeNode('old'));
    h.pub.markDirty(nid('old'));
    h.clock.advance(1);
    h.truth.set(nid('mid'), makeNode('mid'));
    h.pub.markDirty(nid('mid'));
    h.clock.advance(1);
    h.truth.set(nid('new'), makeNode('new'));
    h.pub.markDirty(nid('new'));

    h.clock.advance(10);
    expect([...h.pub.nodes.keys()]).toEqual([nid('old'), nid('mid')]);
  });

  it('is deterministic across identical runs', () => {
    const run = () => {
      const h = throttledHarness(policy);
      seedMany(h, ['e', 'd', 'c', 'b', 'a']);
      h.clock.advance(10);
      return [...h.pub.nodes.keys()];
    };
    expect(run()).toEqual(run());
  });

  it('does not batch when no stagger policy is configured', () => {
    const h = throttledHarness({ notifyMs: 10 });
    seedMany(h, ['a', 'b', 'c', 'd', 'e']);
    h.clock.advance(10);
    expect(h.pub.nodes.size).toBe(5);
  });

  it('flushNow() ignores the stagger budget', () => {
    const h = throttledHarness(policy);
    seedMany(h, ['a', 'b', 'c', 'd', 'e']);
    h.pub.flushNow();
    expect(h.pub.nodes.size).toBe(5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/throttle.test.ts -t stagger`
Expected: FAIL — the first wave publishes all 5 nodes.

- [ ] **Step 3: Implement the wave budget**

In `src/throttle.ts`, add a field for the forced-full-flush flag:

```ts
  private forceFullFlush = false;
```

Set it in `flushNow`, before calling `flush()`:

```ts
    this.forceFullFlush = true;
    this.flush();
```

Replace `flush()`'s node loop with a budgeted, ordered pass:

```ts
  private flush(): void {
    if (this.passthrough) {
      this.notify();
      return;
    }
    const published = this.publishedNodes as Map<NodeId, Node>;
    const now = this.clock.now();
    const full = this.forceFullFlush;
    this.forceFullFlush = false;

    // Oldest-dirty-first, ties by insertion order, so waves are
    // deterministic and reproducible across runs.
    const eligible: NodeId[] = [];
    let held = 0;
    for (const [id, entry] of this.dirty) {
      if (!full && !this.isEligible(entry, now)) {
        held++;
        continue;
      }
      eligible.push(id);
    }
    eligible.sort((x, y) => {
      const ex = this.dirty.get(x) as DirtyEntry;
      const ey = this.dirty.get(y) as DirtyEntry;
      return ex.since - ey.since;
    });

    const batch = full ? eligible.length : (this.policy?.stagger?.batch ?? eligible.length);
    const wave = eligible.slice(0, batch);
    const deferred = eligible.length - wave.length;

    for (const id of wave) {
      const node = this.truth.get(id);
      if (node === undefined) published.delete(id);
      else published.set(id, node);
      this.dirty.delete(id);
    }

    if (this.globalsDirty) {
      const g = this.readGlobals();
      this.publishedRootIds = [...g.rootIds];
      this.publishedFocusedId = g.focusedId;
      this.globalsDirty = false;
    }

    if (wave.length > 0 || (held === 0 && deferred === 0)) {
      trace(
        'throttle',
        `flush: published ${wave.length}, deferred ${deferred}, held ${held}`,
      );
      this.notify();
    }

    if (this.dirty.size > 0) this.scheduleNextWave(deferred > 0);
  }

  /**
   * Re-arm after a partial flush. A stagger-deferred remainder waits the
   * configured wave interval; a dwell-held remainder just re-checks on the
   * normal notify window.
   */
  private scheduleNextWave(staggered: boolean): void {
    if (this.scheduled) return;
    const waveMs = this.policy?.stagger?.ms;
    if (staggered && waveMs !== undefined) {
      this.scheduled = true;
      this.timer = this.clock.setTimeout(() => this.runFlush(), waveMs);
      return;
    }
    this.schedule();
  }
```

`Array.prototype.sort` is stable in every engine windease targets, so equal `since` values keep insertion order.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/throttle.test.ts`
Expected: PASS, all stagger, dwell, and Phase 1 tests.

- [ ] **Step 5: Commit**

```bash
git add src/throttle.ts src/throttle.test.ts
git commit -m "feat(throttle): staggered publish waves with deterministic ordering"
```

---

## Task 17: Store-level stagger integration

**Files:**
- Test: `src/store.throttle.test.ts`

- [ ] **Step 1: Write the test**

Append to `src/store.throttle.test.ts`:

```ts
describe('Store stagger', () => {
  it('reveals a cold-start flood in waves', () => {
    const clock = new FakeClock();
    const store = new Store({
      throttle: { notifyMs: 10, stagger: { batch: 3, ms: 40 } },
      clock,
    });
    store.registerNode(zone('z'));
    store.flushNow();

    for (let i = 0; i < 9; i++) {
      store.registerNode(panel(`p${i}`, 'z'));
    }

    const visible = () =>
      [...Array(9).keys()].filter((i) => store.getNode(nid(`p${i}`)) !== undefined).length;

    clock.advance(10);
    const first = visible();
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(9);

    clock.advance(200);
    expect(visible()).toBe(9);
  });
});
```

The first wave is asserted as a range rather than an exact count because `registerNode` also marks the parent zone, which consumes budget — the meaningful guarantee is "partial, then complete."

- [ ] **Step 2: Run it**

Run: `npx vitest run src/store.throttle.test.ts`
Expected: PASS.

- [ ] **Step 3: Run everything**

Run: `npm run build && npm run lint && npx vitest run`
Expected: clean build, clean lint, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/store.throttle.test.ts
git commit -m "test(store): cold-start flood reveals in staggered waves"
```

---

## Task 18: Version bump and TODO reconciliation

**Files:**
- Modify: `package.json`, `src/index.ts:92`, `TODO.md`

- [ ] **Step 1: Bump the version**

Set `"version": "0.7.0"` in `package.json`.

`src/index.ts:92` currently reads `export const VERSION = '0.3.0';`, which is stale relative to the published `0.6.0`. Correct it to match:

```ts
export const VERSION = '0.7.0';
```

- [ ] **Step 2: Record the feature in TODO.md**

Add to `TODO.md` above the `## Shipped in 0.5.0` section:

```markdown
## Shipped in 0.7.0

- **Optional transition throttling.** `new Store({ throttle })` opts into
  three mechanisms over one flush pipeline: `notifyMs` time-window
  coalescing, per-machine `dwell` (a debounce with a `maxWaitMs`
  starvation cap), and `stagger` waves for mass transitions. Gates
  observation only — `getNode()` returns the published view while
  `getNodeTruth()` / `nodesTruth` / `rootIdsTruth` / `focusedIdTruth`
  return truth, so snapshot and history are unaffected. Identity-equal
  passthrough when the option is omitted. `store.flushNow()` collapses
  pending latency. Traced under the `throttle` category.
```

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint && npx vitest run`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add package.json src/index.ts TODO.md
git commit -m "chore: 0.7.0 — optional transition throttling"
```

---

## Self-review notes

Checked against `docs/superpowers/specs/2026-08-03-transition-throttling-design.md`:

- Every spec section maps to a task. Truth/published split → Tasks 6, 8. Identity passthrough → Task 4. `notifyMs` → Task 5. Dwell debounce + `maxWaitMs` → Tasks 13-15. Whole-node dwell with a shared Machine → asserted in Task 8 ("shares one Machine instance") and Task 15. Stagger → Tasks 16-17. Structural bypass → Task 15. Snapshot reads truth → Task 9. Undo/redo publishes immediately → Task 10. `flushNow` bypasses all gates → Tasks 5, 16. `deserialize` resets → Task 9. Trace category → Tasks 1, 14, 16. Rollout phases → the three phase headings.
- The spec's "history forces an immediate publish" is satisfied *without* touching `src/history.ts`. `HistoryController<TSnapshot>` is a generic snapshot stack holding no `Store` reference; restores go through `deserialize`, which Task 9 makes reset the projection. Task 10 is a regression test rather than a code change.
- Type names are consistent across tasks: `Clock`, `TimerHandle`, `ThrottlePolicy`, `StoreOptions`, `MachineName`, `PublisherDeps`, `DirtyEntry`, `Publisher`. Store methods: `getNodeTruth`, `nodesTruth`, `rootIdsTruth`, `focusedIdTruth`, `flushNow`, `resetPublished`.
- Two spec details are deliberately deferred and noted in the spec's own follow-ups: whether `transit` / `focus` want dwell defaults (no task — the expectation is only `lifecycle` is configured), and brainhouse's interim-debounce deletion (a brainhouse change, out of scope here).

## Risks

**Task 8's internal-read audit is the highest-risk edit in the plan.** Changing `Store`'s public getters to return the published view silently changes what every *internal* method sees. Any internal site left reading `this.getNode(...)` or `this.nodes` will operate on a lagged view, and the bug only manifests under a throttle policy — so the existing suite won't catch it. Before considering Phase 1 done:

```bash
grep -n "this\.getNode(\|this\.nodes\.\|this\.rootIds\b\|this\.focusedId\b" src/store.ts
```

Every hit inside a private/internal method must read `this.nodesMap` / `this.rootIdsArr` / `this.focusedIdValue` instead. Known sites to check: `requireNode` (already correct), `collectDescendants`, `resortByPin`, `getChildren`, `getParent`, `getAncestors`, `isContainer`, `isSlotted`, `hasFocus`, `getContainerView`, and the cycle check in `moveNode`.

**`registerNode` marks its parent twice** (once via `replaceContainer`, once bypassed). That is intentional — `markDirty` merges into one entry and `bypass: true` is sticky — but if the merge logic in Task 13 is changed, re-check that the bypass survives.

**Two ordering assumptions** the tests depend on: `Array.prototype.sort` is stable (guaranteed in every engine windease targets), and `Map` iteration follows insertion order (guaranteed by spec). Both are relied on for deterministic stagger waves.
