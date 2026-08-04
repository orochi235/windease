# Throttle Introspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let consumers ask the store *why a node hasn't published yet* — via a point read (`store.getPending(id)`) and a stream (`throttle.pending` / `throttle.published` events) — instead of reconstructing it by diffing two independently-recorded logs.

**Architecture:** `Publisher` already tracks everything needed in its private `DirtyEntry` map. This adds one field (`coalesced`), one derived value (`eligibleAt`, factored out of three places that already compute it), a read-only projection type (`PendingPublish`), and two optional emit callbacks on `PublisherDeps` that `Store` wires to its existing `TypedEmitter`. Passthrough stays inert: `getPending` returns `null` and neither event fires, because an unthrottled `Publisher` tracks nothing.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, React 19, Biome, Ladle.

**Spec:** `docs/superpowers/specs/2026-08-04-throttle-introspection-design.md`

**Read before starting:** `CLAUDE.md` (tracing tenet — trace liberally, never `console.log` in library code) and `docs/concepts.md` (the "Truth vs. published" section).

---

## Background the engineer needs

**`Publisher` has two modes and the split is load-bearing.** With no `throttle` policy it is in *passthrough*: `publishedNodes` and `dirty` are both `null`, `nodes` returns the truth map **by object identity**, and nothing is tracked. This is a hard contract, not an optimization — `src/throttle.ts:140-147` and a test at `src/store.throttle.test.ts` (`'is passthrough when no throttle policy is given'`) both assert it. Every field this plan adds must be reachable only behind a `!this.passthrough` guard.

**The non-null assertions are deliberate.** `this.dirty` and `this.publishedNodes` are typed `| null` and read via `as Map<...>` casts. The class comment at `src/throttle.ts:161-165` explains why this is safe. Follow the existing style; do not "fix" it with optional chaining.

**`DirtyEntry` is mutated in place.** `markDirty` updates the existing object rather than replacing it (`src/throttle.ts:225-229`). The new `coalesced` counter follows the same pattern.

**Entries are deleted on publish.** `flush()` does `dirty.delete(id)` for every node in the wave (`src/throttle.ts:344`). So a republished node that goes dirty again gets a **fresh** entry with `coalesced: 0` — the counter is per-pending-episode, not cumulative. That is intended.

**`FakeClock` starts at 0** (`src/test-utils/fake-clock.ts`) and `advance(ms)` fires due timers in order, running each with `now()` set to that timer's **due time**, not the end of the advance window. Every timing test in `src/throttle.test.ts` uses it. Never use real timers in these tests.

**A policy without `notifyMs` does not schedule its first flush on the clock.** `schedule()` reads `this.policy?.notifyMs`; when it is undefined the first flush goes through `queueMicrotask`, not `clock.setTimeout`. The `FakeClock` timer only gets armed by the `scheduleRecheck` that runs *after* that microtask. So a synchronous test that does `showNode(...)` then `clock.advance(500)` on a `{ dwell: {...} }`-only policy advances past **nothing** — the entry is still pending and the assertion fails misleadingly. Make such tests `async` and `await tick()` before advancing. This does not affect `src/throttle.test.ts`'s `throttledHarness`, whose policies all set `notifyMs`.

**Two harnesses already exist in `src/throttle.test.ts`:** `harness()` (line 33, passthrough only) and `throttledHarness(policy)` (line 112). Task 4 extends `throttledHarness` with an event recorder; do not create a third harness.

**Run the whole suite, not one file.** `npx vitest run <path>` for a single file is fine while iterating, but every task's final check is `npm test`.

---

## Task 1: Factor out `eligibleAt`

Three places compute `min(touched + dwellMs, since + maxWaitMs)`: `isEligible`, `scheduleRecheck`, and (about to) the public descriptor. Consolidate before adding the fourth reader.

This is a pure refactor with no behavior change. The existing suite is the test net — that is the correct discipline here, so the first and last steps are both "run it."

**Files:**
- Modify: `src/throttle.ts:362-426`

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `npm test`
Expected: all files pass. If anything is already failing, stop and report it — do not refactor on top of a red suite.

- [ ] **Step 2: Add the `eligibleAt` helper**

In `src/throttle.ts`, insert this method immediately **above** the existing `isEligible` method (which is the last method in the class, at line 418):

```ts
  /**
   * The earliest moment `entry`'s gate opens: its dwell debounce or the
   * `maxWaitMs` starvation cap, whichever lands first. An entry that is
   * not dwell-gated (`bypass`, or `dwellMs === 0`) opened its gate the
   * moment it went dirty, so it reports `since`.
   *
   * A pure function of the entry — it never reads the clock, so two
   * callers in the same tick always agree. Single source of truth for
   * `isEligible`, `scheduleRecheck`, and the public `getPending`
   * descriptor; do not re-inline this expression at a call site.
   */
  private eligibleAt(entry: DirtyEntry): number {
    if (entry.bypass || entry.dwellMs === 0) return entry.since;
    const byDwell = entry.touched + entry.dwellMs;
    const byMaxWait =
      this.maxWaitMs > 0 ? entry.since + this.maxWaitMs : Number.POSITIVE_INFINITY;
    return Math.min(byDwell, byMaxWait);
  }
```

- [ ] **Step 3: Rewrite `isEligible` in terms of the helper**

Replace the entire existing `isEligible` method body (`src/throttle.ts:418-426`) with:

```ts
  private isEligible(entry: DirtyEntry, now: number): boolean {
    if (entry.bypass || entry.dwellMs === 0) return true;
    if (now < this.eligibleAt(entry)) return false;
    // The gate opened. If the dwell debounce isn't what opened it, the
    // starvation cap did — that's the interesting case to log.
    if (now - entry.touched < entry.dwellMs) {
      trace('throttle', `maxWait forced publish after ${now - entry.since}ms`);
    }
    return true;
  }
```

Leave the existing doc comment above it (`src/throttle.ts:413-417`) exactly as it is.

Why this is equivalent: `now - touched >= dwellMs` is `now >= touched + dwellMs`, and `now - since >= maxWaitMs` is `now >= since + maxWaitMs`. "Either bound has passed" is "`now` is at or past the smaller of the two", which is `eligibleAt`. The trace fires on exactly the old condition — maxWait elapsed while dwell had not.

- [ ] **Step 4: Rewrite `scheduleRecheck`'s loop in terms of the helper**

Replace the loop in `scheduleRecheck` (`src/throttle.ts:395-405`) — everything from `let earliest` through the closing brace of the `for` — with:

```ts
    let earliest = Number.POSITIVE_INFINITY;
    for (const entry of dirty.values()) {
      earliest = Math.min(earliest, this.eligibleAt(entry));
    }
```

Leave the lines after it (`if (earliest === Number.POSITIVE_INFINITY) return;` onward) untouched.

Why the dropped `break` is safe: the old code special-cased an already-eligible entry by setting `earliest = now` and breaking out. Now such an entry reports `eligibleAt === since`, which is `<= now`, so the `Math.max(0, earliest - now)` on the next line still yields a `0` delay. The `break` was a loop-exit optimization, not a behavior.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, with the same test count as Step 1. Any failure here is a real behavior change — revert and re-read Steps 3 and 4 rather than adjusting a test.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/throttle.ts
git commit -m "refactor(throttle): single eligibleAt() helper for the dwell/maxWait bound"
```

---

## Task 2: `PendingPublish` and `Publisher.getPending`

**Files:**
- Modify: `src/throttle.ts` (add `PendingPublish`, add `coalesced` to `DirtyEntry`, add `getPending`)
- Test: `src/throttle.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this block to the end of `src/throttle.test.ts`:

```ts
describe('Publisher — getPending', () => {
  it('returns null in passthrough even with a dirty node', () => {
    const h = harness();
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    expect(h.pub.getPending(nid('a'))).toBeNull();
  });

  it('returns null for a node that was never marked dirty', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    expect(h.pub.getPending(nid('nope'))).toBeNull();
  });

  it('describes a dwell-gated node', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(h.pub.getPending(nid('a'))).toEqual({
      since: 0,
      touched: 0,
      dwellMs: 150,
      bypass: false,
      coalesced: 0,
      eligibleAt: 150,
    });
  });

  it('reports eligibleAt as since for a bypassing node', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.clock.advance(40);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle', bypass: true });

    const pending = h.pub.getPending(nid('a'));
    expect(pending?.bypass).toBe(true);
    expect(pending?.eligibleAt).toBe(40);
    expect(pending?.since).toBe(40);
  });

  it('reports eligibleAt as since for a node with no dwell gate', () => {
    const h = throttledHarness({ notifyMs: 32 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));

    const pending = h.pub.getPending(nid('a'));
    expect(pending?.dwellMs).toBe(0);
    expect(pending?.eligibleAt).toBe(0);
  });

  it('clamps eligibleAt to the maxWaitMs starvation cap', () => {
    // dwell 150 restarts on every touch; maxWait 200 from `since` wins
    // once the node has been noisy for long enough.
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 }, maxWaitMs: 200 });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(100);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    const pending = h.pub.getPending(nid('a'));
    // touched=100 → byDwell=250; since=0 → byMaxWait=200. Min wins.
    expect(pending?.touched).toBe(100);
    expect(pending?.eligibleAt).toBe(200);
  });

  it('counts coalesced changes, not the first one', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    expect(h.pub.getPending(nid('a'))?.coalesced).toBe(0);

    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    expect(h.pub.getPending(nid('a'))?.coalesced).toBe(2);
  });

  it('returns null once the node publishes, and starts a fresh episode after', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 50 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    h.clock.advance(500);
    expect(h.pub.getPending(nid('a'))).toBeNull();

    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    expect(h.pub.getPending(nid('a'))?.coalesced).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/throttle.test.ts -t 'getPending'`
Expected: FAIL — TypeScript/runtime error, `pub.getPending is not a function`.

- [ ] **Step 3: Add the `PendingPublish` type**

In `src/throttle.ts`, insert immediately **above** the existing `interface DirtyEntry` (line 116):

```ts
/**
 * A read-only snapshot of what is currently being withheld for one node,
 * as returned by {@link Store.getPending}. Answers "why hasn't this
 * published yet?" — a plain value derived from internal bookkeeping, not
 * a live view of it.
 *
 * @group Store
 */
export interface PendingPublish {
  /** `clock.now()` when the node first went dirty and has stayed dirty. */
  since: number;
  /** `clock.now()` of the most recent dwell-restarting change. */
  touched: number;
  /** Largest dwell gating this node; `0` means it is not dwell-gated. */
  dwellMs: number;
  /** Structural change (register/unregister/move); skips dwell entirely. */
  bypass: boolean;
  /** Further changes that landed while this node was already pending. */
  coalesced: number;
  /**
   * Earliest the gate opens — **not** when the node will publish.
   * `notifyMs` coalescing and stagger waves can both defer the actual
   * flush past this moment.
   */
  eligibleAt: number;
}
```

- [ ] **Step 4: Add `coalesced` to `DirtyEntry`**

Add this field to the existing `interface DirtyEntry`, after `bypass`:

```ts
  /** Changes that landed while this entry was already pending. */
  coalesced: number;
```

- [ ] **Step 5: Maintain `coalesced` in `markDirty`**

In `markDirty` (`src/throttle.ts:218-240`), change the `if (existing)` / `else` block to:

```ts
      const existing = dirty.get(id);
      if (existing) {
        existing.coalesced++;
        if (restartsDebounce) existing.touched = now;
        // A node dwells for the longest gate that applies to it.
        if (dwellForMachine > existing.dwellMs) existing.dwellMs = dwellForMachine;
        if (opts?.bypass) existing.bypass = true;
      } else {
        dirty.set(id, {
          since: now,
          touched: now,
          dwellMs: dwellForMachine,
          bypass: opts?.bypass ?? false,
          coalesced: 0,
        });
      }
```

- [ ] **Step 6: Add `getPending` to `Publisher`**

Insert this method in `src/throttle.ts` immediately after the `focusedId` getter (which ends at line 204), inside the `// ===== Published reads =====` section:

```ts
  /**
   * What is currently being withheld for `id`, or `null` if nothing is —
   * either the node is clean, or this Publisher is in passthrough, which
   * tracks nothing and so can never withhold anything.
   */
  getPending(id: NodeId): PendingPublish | null {
    if (this.passthrough) return null;
    const entry = (this.dirty as Map<NodeId, DirtyEntry>).get(id);
    if (entry === undefined) return null;
    return {
      since: entry.since,
      touched: entry.touched,
      dwellMs: entry.dwellMs,
      bypass: entry.bypass,
      coalesced: entry.coalesced,
      eligibleAt: this.eligibleAt(entry),
    };
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/throttle.test.ts`
Expected: PASS, including the pre-existing describe blocks.

- [ ] **Step 8: Run the full suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add src/throttle.ts src/throttle.test.ts
git commit -m "feat(throttle): PendingPublish descriptor and Publisher.getPending"
```

---

## Task 3: `Store.getPending` and the public export

**Files:**
- Modify: `src/store.ts` (add `getPending` to the read section)
- Modify: `src/index.ts` (export `PendingPublish`)
- Test: `src/store.throttle.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/store.throttle.test.ts`:

```ts
describe('Store.getPending', () => {
  it('returns null on an un-throttled store', () => {
    const store = new Store();
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    expect(store.getPending(nid('p'))).toBeNull();
  });

  it('returns null for an unknown node', () => {
    const store = new Store({ throttle: { dwell: { lifecycle: 150 } }, clock: new FakeClock() });
    expect(store.getPending(nid('ghost'))).toBeNull();
  });

  it('describes a node held by dwell', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { dwell: { lifecycle: 150 } }, clock });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.flushNow();

    store.showNode(nid('p'));
    const pending = store.getPending(nid('p'));
    expect(pending).not.toBeNull();
    expect(pending?.dwellMs).toBe(150);
    expect(pending?.eligibleAt).toBe(pending!.touched + 150);
  });

  it('clears once the node publishes', async () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { dwell: { lifecycle: 50 } }, clock });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.flushNow();

    store.showNode(nid('p'));
    expect(store.getPending(nid('p'))).not.toBeNull();
    // The first flush is a microtask when `notifyMs` is omitted, and the
    // FakeClock timer is only armed by the recheck that follows it — so
    // yield once before advancing or there is no timer to fire.
    await tick();
    clock.advance(500);
    expect(store.getPending(nid('p'))).toBeNull();
    expect(store.getNode(nid('p'))?.lifecycle.state).toBe('visible');
  });

  it('is cleared by flushNow', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { dwell: { lifecycle: 150 } }, clock });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.flushNow();

    store.showNode(nid('p'));
    expect(store.getPending(nid('p'))).not.toBeNull();
    store.flushNow();
    expect(store.getPending(nid('p'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store.throttle.test.ts -t 'getPending'`
Expected: FAIL — `store.getPending is not a function`.

- [ ] **Step 3: Add the delegation to `Store`**

In `src/store.ts`, add this method immediately after `getNodeTruth` (which ends at line 137):

```ts
  /**
   * What throttling is currently withholding for `id`, or `null` if
   * nothing is. Always `null` on a store with no `throttle` policy — an
   * un-throttled store tracks nothing and withholds nothing.
   *
   * `eligibleAt` on the result is when the node's gate opens, not when it
   * will publish: `notifyMs` and stagger waves can defer the flush past
   * it. Pair with the `throttle.pending` / `throttle.published` events to
   * observe the transitions rather than poll.
   */
  getPending(id: NodeId): PendingPublish | null {
    return this.publisher.getPending(id);
  }
```

Update the import at `src/store.ts:10` to pull the type in:

```ts
import {
  type PendingPublish,
  Publisher,
  type StoreOptions,
  systemClock,
} from './throttle.js';
```

- [ ] **Step 4: Export the type from the package entry point**

In `src/index.ts`, add `type PendingPublish,` to the existing `export { ... } from './throttle.js';` block so it reads:

```ts
export {
  systemClock,
  type Clock,
  type MachineName,
  type PendingPublish,
  type StoreOptions,
  type ThrottlePolicy,
  type TimerHandle,
} from './throttle.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/store.throttle.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add src/store.ts src/index.ts src/store.throttle.test.ts
git commit -m "feat(store): expose getPending for throttle introspection"
```

---

## Task 4: The `throttle.pending` event

**Files:**
- Modify: `src/throttle.ts` (payload type, `PublisherDeps.onPending`, emit in `markDirty`, trace)
- Modify: `src/store.ts` (`StoreEvents` entry, wire the callback)
- Test: `src/throttle.test.ts` (extend `throttledHarness`), `src/store.throttle.test.ts`

- [ ] **Step 1: Extend `throttledHarness` with an event recorder**

In `src/throttle.test.ts`, replace the whole `throttledHarness` function (lines 112-136) with:

`onPublished` does not exist yet — Task 5 adds it, and extends this same harness. Do not add it here or the typecheck at the end of this task will fail.

```ts
interface RecordedEvent {
  kind: 'pending';
  payload: ThrottlePendingPayload;
}

function throttledHarness(policy: ThrottlePolicy) {
  const truth = new Map<NodeId, Node>();
  let rootIds: NodeId[] = [];
  const focusedId: NodeId | null = null;
  let notifies = 0;
  const clock = new FakeClock();
  const events: RecordedEvent[] = [];
  const pub = new Publisher({
    truth,
    policy,
    clock,
    readGlobals: () => ({ rootIds, focusedId }),
    notify: () => {
      notifies++;
    },
    onPending: (payload) => {
      events.push({ kind: 'pending', payload });
    },
  });
  return {
    pub,
    truth,
    clock,
    notifies: () => notifies,
    events,
    pendingEvents: () =>
      events.filter((e) => e.kind === 'pending').map((e) => e.payload as ThrottlePendingPayload),
    setRootIds: (ids: NodeId[]) => {
      rootIds = ids;
    },
  };
}
```

Update the import at the top of the file (line 6) to:

```ts
import {
  Publisher,
  type ThrottlePendingPayload,
  type ThrottlePolicy,
  systemClock,
} from './throttle.js';
```

- [ ] **Step 2: Write the failing tests**

Append to the end of `src/throttle.test.ts`:

```ts
describe('Publisher — throttle.pending event', () => {
  it('does not fire in passthrough', () => {
    // The passthrough harness supplies no callbacks at all; this asserts
    // the Publisher tolerates that and never tries to call them.
    const h = harness();
    h.truth.set(nid('a'), makeNode('a'));
    expect(() => h.pub.markDirty(nid('a'), { machine: 'lifecycle' })).not.toThrow();
  });

  it('fires once when a node first goes dirty', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(h.pendingEvents()).toEqual([{ id: nid('a'), since: 0 }]);
  });

  it('fires once for a mutation that marks the node twice', () => {
    // This is the real `showNode` shape: an untagged mark from
    // `replaceNode` creates the entry, then a machine-tagged mark raises
    // the dwell. Only the first fires the event — which is exactly why
    // the payload carries no `dwellMs`: it isn't settled yet.
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(h.pendingEvents()).toEqual([{ id: nid('a'), since: 0 }]);
    expect(h.pub.getPending(nid('a'))?.dwellMs).toBe(150);
  });

  it('does not re-fire on subsequent touches of the same entry', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('a'));

    expect(h.pendingEvents()).toHaveLength(1);
  });

  it('fires again for a new pending episode after the node publishes', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 50 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(500);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });

    expect(h.pendingEvents()).toHaveLength(2);
  });

  it('reports one event per node', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('b'), { machine: 'lifecycle' });

    expect(h.pendingEvents().map((e) => e.id)).toEqual([nid('a'), nid('b')]);
  });
});
```

And append to the end of `src/store.throttle.test.ts`:

```ts
describe('Store throttle.pending event', () => {
  it('is emitted on store.events when a node is withheld', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { dwell: { lifecycle: 150 } }, clock });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.flushNow();

    const seen: string[] = [];
    store.events.on('throttle.pending', (p) => {
      seen.push(p.id);
    });

    store.showNode(nid('p'));
    // One event, even though showNode marks the node twice.
    expect(seen).toEqual([nid('p')]);
    // The settled gate comes from the point read, not from the event.
    expect(store.getPending(nid('p'))?.dwellMs).toBe(150);
  });

  it('is never emitted by an un-throttled store', () => {
    const store = new Store();
    let calls = 0;
    store.events.on('throttle.pending', () => {
      calls++;
    });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.showNode(nid('p'));
    expect(calls).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/throttle.test.ts src/store.throttle.test.ts -t 'pending'`
Expected: FAIL — `ThrottlePendingPayload` does not exist, and `onPending` is not a valid `PublisherDeps` key.

- [ ] **Step 4: Add the payload type**

In `src/throttle.ts`, insert immediately **above** `export interface PublisherDeps` (line 131):

```ts
/**
 * Emitted as `throttle.pending` on `store.events` when a node first goes
 * dirty and starts being withheld. Fires once per pending episode, not
 * once per change — see `throttle.published` for the other end.
 *
 * Never emitted by an un-throttled store.
 *
 * @group Store
 */
export interface ThrottlePendingPayload {
  id: NodeId;
  /** `clock.now()` when the node went dirty. */
  since: number;
}
```

**Why the payload carries no `dwellMs` or `eligibleAt`:** the event fires
when the `DirtyEntry` is created, and at that moment the gate is not yet
known. A single store mutation marks a node more than once —
`showNode` calls `replaceNode(id)` → `markDirty(id)` *untagged*
(`src/store.ts:756`) before `markDirty(id, { machine: 'lifecycle' })`
(`src/store.ts:757`). The entry is therefore created by the untagged
mark, with `dwellMs: 0`, and only raised to `150` afterwards. Publishing
that initial `0` in the payload would misreport the most common case in
the library. The settled values are available from `getPending(id)` and
from `throttle.published`.

- [ ] **Step 5: Add the optional callback to `PublisherDeps`**

Add to `interface PublisherDeps`, after `notify`:

```ts
  /**
   * Called when a node starts being withheld. Optional so test harnesses
   * and any future embedder can omit it; `Store` always supplies it.
   */
  onPending?: (payload: ThrottlePendingPayload) => void;
```

Store it on the class alongside the other deps. Add the field declaration next to `private readonly notify: () => void;` (line 155):

```ts
  private readonly onPending: PublisherDeps['onPending'];
```

and assign it in the constructor next to `this.notify = deps.notify;` (line 180):

```ts
    this.onPending = deps.onPending;
```

- [ ] **Step 6: Emit from `markDirty`**

In `markDirty`, the `else` branch that creates a new entry becomes:

```ts
      } else {
        const entry: DirtyEntry = {
          since: now,
          touched: now,
          dwellMs: dwellForMachine,
          bypass: opts?.bypass ?? false,
          coalesced: 0,
        };
        dirty.set(id, entry);
        // No dwell in the message: this fires on entry creation, and the
        // gate is raised by a later mark in the same mutation.
        trace('throttle', `pending: ${id} withheld from ${now}`);
        this.onPending?.({ id, since: now });
      }
```

The trace and the emit are on the same condition as each other — new entry only — so neither spams under churn.

- [ ] **Step 7: Declare the event on `StoreEvents` and wire the callback**

In `src/store.ts`, add to the `StoreEvents` interface, after the `'container.stateChanged'` entry (line 61):

```ts
  /**
   * A node started being withheld by throttling. Only ever emitted by a
   * store constructed with a `throttle` policy.
   */
  'throttle.pending': ThrottlePendingPayload;
```

Extend the import at line 10:

```ts
import {
  type PendingPublish,
  Publisher,
  type StoreOptions,
  type ThrottlePendingPayload,
  systemClock,
} from './throttle.js';
```

And in the constructor, add to the `new Publisher({...})` options after `notify`:

```ts
      onPending: (payload) => this.events.emit('throttle.pending', payload),
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/throttle.test.ts src/store.throttle.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the full suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add src/throttle.ts src/store.ts src/throttle.test.ts src/store.throttle.test.ts
git commit -m "feat(throttle): emit throttle.pending when a node starts being withheld"
```

---

## Task 5: The `throttle.published` event

**Files:**
- Modify: `src/throttle.ts` (payload type, `PublisherDeps.onPublished`, emit in `flush`, trace)
- Modify: `src/store.ts` (`StoreEvents` entry, wire the callback)
- Test: `src/throttle.test.ts`, `src/store.throttle.test.ts`

- [ ] **Step 1: Extend the harness, then write the failing tests**

First widen the recorder Task 4 added to `src/throttle.test.ts`. Change the `RecordedEvent` interface to a union and add the second callback plus its accessor:

```ts
type RecordedEvent =
  | { kind: 'pending'; payload: ThrottlePendingPayload }
  | { kind: 'published'; payload: ThrottlePublishedPayload };
```

Inside `throttledHarness`, add to the `new Publisher({...})` options after `onPending`:

```ts
    onPublished: (payload) => {
      events.push({ kind: 'published', payload });
    },
```

and add to its returned object, after `pendingEvents`:

```ts
    publishedEvents: () =>
      events
        .filter((e) => e.kind === 'published')
        .map((e) => e.payload as ThrottlePublishedPayload),
```

Add `type ThrottlePublishedPayload,` to the `./throttle.js` import at the top of the file.

Both accessors must filter with a **type predicate**, not a bare comparison — `.filter((e) => e.kind === 'published')` does not narrow, and a plain `as` cast would happily force pending payloads through as published once the union has two members:

```ts
    publishedEvents: () =>
      events
        .filter((e): e is Extract<RecordedEvent, { kind: 'published' }> => e.kind === 'published')
        .map((e) => e.payload),
```

Then append the tests:

```ts
describe('Publisher — throttle.published event', () => {
  it('reports heldMs and coalesced for a node that settled', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 100 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(20);
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.clock.advance(500);

    // `FakeClock` runs a timer with `now()` at its *due* time, not at the
    // end of the advance window. The node went dirty at 0, was touched at
    // 20, and its 100ms dwell opened the gate at 120 — so it was held for
    // 120ms, not 520.
    expect(h.publishedEvents()).toEqual([
      { id: nid('a'), heldMs: 120, coalesced: 1, forced: false },
    ]);
  });

  it('marks forced when flushNow bypasses an unsatisfied dwell', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.flushNow();

    const [event] = h.publishedEvents();
    expect(event.forced).toBe(true);
    expect(event.heldMs).toBe(0);
  });

  it('marks forced when the maxWaitMs cap wins over a restarting dwell', () => {
    const h = throttledHarness({ notifyMs: 10, dwell: { lifecycle: 100 }, maxWaitMs: 150 });
    h.truth.set(nid('a'), makeNode('a'));
    // Keep touching it so the dwell debounce never settles; maxWait must
    // eventually force the publish.
    for (let i = 0; i < 5; i++) {
      h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
      h.clock.advance(40);
    }
    h.clock.advance(200);

    const events = h.publishedEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].forced).toBe(true);
    expect(events[0].id).toBe(nid('a'));
  });

  it('does not mark forced for a bypassing node that was never gated', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { bypass: true });
    h.clock.advance(500);

    expect(h.publishedEvents()[0].forced).toBe(false);
  });

  it('fires for a node that was unregistered while pending', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 100 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.truth.delete(nid('a'));
    h.clock.advance(500);

    expect(h.publishedEvents().map((e) => e.id)).toEqual([nid('a')]);
    expect(h.pub.nodes.get(nid('a'))).toBeUndefined();
  });

  it('emits before notify, with the published view already updated', () => {
    // The shared harness records events for later inspection, which can't
    // observe ordering. This one samples state *inside* the callback.
    // Referencing `pub` from the callback is safe: the callback only ever
    // runs during a flush, long after the const is initialized.
    const truth = new Map<NodeId, Node>();
    const clock = new FakeClock();
    let notifies = 0;
    let notifiesAtEmit = -1;
    let publishedAtEmit = false;
    const pub: Publisher = new Publisher({
      truth,
      policy: { notifyMs: 32, dwell: { lifecycle: 50 } },
      clock,
      readGlobals: () => ({ rootIds: [], focusedId: null }),
      notify: () => {
        notifies++;
      },
      onPublished: () => {
        notifiesAtEmit = notifies;
        publishedAtEmit = pub.nodes.has(nid('a'));
      },
    });

    truth.set(nid('a'), makeNode('a'));
    pub.markDirty(nid('a'), { machine: 'lifecycle' });
    clock.advance(500);

    expect(publishedAtEmit).toBe(true);
    expect(notifiesAtEmit).toBe(0);
    expect(notifies).toBe(1);
  });

  it('pairs one published event with each pending event under churn', () => {
    const h = throttledHarness({ notifyMs: 10, dwell: { lifecycle: 40 }, maxWaitMs: 120 });
    for (let i = 0; i < 6; i++) h.truth.set(nid(`n${i}`), makeNode(`n${i}`));

    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 6; i++) h.pub.markDirty(nid(`n${i}`), { machine: 'lifecycle' });
      h.clock.advance(25);
    }
    h.clock.advance(2000);

    const open = new Set<NodeId>();
    let unbalanced = 0;
    for (const e of h.events) {
      if (e.kind === 'pending') {
        if (open.has(e.payload.id)) unbalanced++;
        open.add(e.payload.id);
      } else {
        if (!open.delete(e.payload.id)) unbalanced++;
      }
    }
    expect(unbalanced).toBe(0);
    expect([...open]).toEqual([]);
  });
});
```

Append to the end of `src/store.throttle.test.ts`:

```ts
describe('Store throttle.published event', () => {
  it('fires with the published view already updated, before subscribers', async () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { dwell: { lifecycle: 50 } }, clock });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.flushNow();

    const order: string[] = [];
    let stateSeenByEvent: string | undefined;
    store.events.on('throttle.published', (p) => {
      if (p.id !== nid('p')) return;
      order.push('event');
      stateSeenByEvent = store.getNode(nid('p'))?.lifecycle.state;
    });
    store.subscribe(() => {
      order.push('subscriber');
    });

    store.showNode(nid('p'));
    // See the note in the Background section: with `notifyMs` omitted the
    // first flush is a microtask, and the FakeClock timer is only armed by
    // the recheck after it. Yield or `advance` has nothing to fire.
    await tick();
    clock.advance(500);

    expect(stateSeenByEvent).toBe('visible');
    expect(order[0]).toBe('event');
    expect(order).toContain('subscriber');
  });

  it('is never emitted by an un-throttled store', async () => {
    const store = new Store();
    let calls = 0;
    store.events.on('throttle.published', () => {
      calls++;
    });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.showNode(nid('p'));
    await tick();
    expect(calls).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/throttle.test.ts src/store.throttle.test.ts -t 'published event'`
Expected: FAIL — `ThrottlePublishedPayload` does not exist.

- [ ] **Step 3: Add the payload type**

In `src/throttle.ts`, insert immediately below `ThrottlePendingPayload`:

```ts
/**
 * Emitted as `throttle.published` on `store.events` when a withheld node
 * reaches the published view. Exactly one of these follows every
 * `throttle.pending` for the same id — including when the node was
 * unregistered while pending (publishing a deletion is publishing) and
 * when `deserialize` drops the pending state wholesale. That pairing is
 * what lets a consumer maintain a live set of withheld nodes without
 * leaking.
 *
 * Never emitted by an un-throttled store.
 *
 * @group Store
 */
export interface ThrottlePublishedPayload {
  id: NodeId;
  /** Total time withheld: `now - since`. */
  heldMs: number;
  /** Changes that were coalesced into this single publish. */
  coalesced: number;
  /**
   * Published without its dwell gate being satisfied — it ran out of
   * patience rather than settling. True for `flushNow()`, for the
   * `maxWaitMs` starvation cap, and for a `reset()` drain.
   */
  forced: boolean;
}
```

- [ ] **Step 4: Add the optional callback to `PublisherDeps`**

Add to `interface PublisherDeps`, after `onPending`:

```ts
  /** Called when a withheld node reaches the published view. */
  onPublished?: (payload: ThrottlePublishedPayload) => void;
```

Add the field declaration next to `onPending`:

```ts
  private readonly onPublished: PublisherDeps['onPublished'];
```

and assign it in the constructor next to `this.onPending = deps.onPending;`:

```ts
    this.onPublished = deps.onPublished;
```

- [ ] **Step 5: Emit from the flush wave**

In `flush()`, replace the wave loop (`src/throttle.ts:340-345`) with:

```ts
    for (const id of wave) {
      const entry = dirty.get(id) as DirtyEntry;
      const node = this.truth.get(id);
      if (node === undefined) published.delete(id);
      else published.set(id, node);
      dirty.delete(id);
      // Emitted after the published view is updated and before notify(),
      // so a listener that reads getNode(id) here already sees the new
      // value and subscribers still run on a settled world.
      this.emitPublished(entry, id, now, full);
    }
```

Add this private method immediately below `flush()`:

```ts
  /**
   * `forced` means the node published without going quiet first — either
   * `flushNow()` bypassed every gate, or the `maxWaitMs` cap fired while
   * the dwell debounce was still being restarted. A node that was never
   * dwell-gated in the first place is not "forced"; it had no gate to
   * escape.
   */
  private emitPublished(entry: DirtyEntry, id: NodeId, now: number, full: boolean): void {
    const heldMs = now - entry.since;
    const forced = full || (entry.dwellMs > 0 && !entry.bypass && now - entry.touched < entry.dwellMs);
    trace(
      'throttle',
      `published: ${id} held ${heldMs}ms, ${entry.coalesced} coalesced${forced ? ' (forced)' : ''}`,
    );
    this.onPublished?.({ id, heldMs, coalesced: entry.coalesced, forced });
  }
```

- [ ] **Step 6: Declare the event on `StoreEvents` and wire the callback**

In `src/store.ts`, add to `StoreEvents` immediately after `'throttle.pending'`:

```ts
  /**
   * A withheld node reached the published view. Exactly one of these
   * follows every `throttle.pending` for the same id.
   */
  'throttle.published': ThrottlePublishedPayload;
```

Extend the import at line 10 to add `type ThrottlePublishedPayload,`, and add to the `new Publisher({...})` options after `onPending`:

```ts
      onPublished: (payload) => this.events.emit('throttle.published', payload),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/throttle.test.ts src/store.throttle.test.ts`
Expected: PASS.

If the `pairs one published event with each pending event under churn` test fails with a leftover in `open`, the cause is almost certainly `reset()` — but `reset()` is not exercised by that test, so investigate the flush path instead. Task 6 covers `reset()`.

- [ ] **Step 8: Run the full suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add src/throttle.ts src/store.ts src/throttle.test.ts src/store.throttle.test.ts
git commit -m "feat(throttle): emit throttle.published when a withheld node lands"
```

---

## Task 6: `reset()` drains pending, preserving the balance invariant

`reset()` (called by `deserialize`) clears the dirty map wholesale. Without this task, every node pending at hydration time leaks from a consumer's pending set forever.

Ordering that makes the store-level test below sound: `deserialize` re-registers every node *first* (`src/snapshot.ts:214`) and calls `store.resetPublished()` **last** (`src/snapshot.ts:247`). So the pending entries that hydration itself creates are drained by the same reset, and the set is empty when the call returns.

**Files:**
- Modify: `src/throttle.ts:281-298` (`reset`)
- Test: `src/throttle.test.ts`, `src/store.throttle.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/throttle.test.ts`:

```ts
describe('Publisher — reset drains pending', () => {
  it('emits a forced published event for every dropped entry', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.truth.set(nid('b'), makeNode('b'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.markDirty(nid('b'), { machine: 'lifecycle' });
    h.clock.advance(30);

    h.pub.reset();

    const published = h.publishedEvents();
    expect(published.map((e) => e.id)).toEqual([nid('a'), nid('b')]);
    expect(published.every((e) => e.forced)).toBe(true);
    expect(published.every((e) => e.heldMs === 30)).toBe(true);
    expect(h.pub.getPending(nid('a'))).toBeNull();
  });

  it('emits nothing when there was nothing pending', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.pub.reset();
    expect(h.publishedEvents()).toEqual([]);
  });

  it('leaves the pending set balanced across a reset', () => {
    const h = throttledHarness({ notifyMs: 32, dwell: { lifecycle: 150 } });
    h.truth.set(nid('a'), makeNode('a'));
    h.pub.markDirty(nid('a'), { machine: 'lifecycle' });
    h.pub.reset();

    const open = new Set<NodeId>();
    for (const e of h.events) {
      if (e.kind === 'pending') open.add(e.payload.id);
      else open.delete(e.payload.id);
    }
    expect([...open]).toEqual([]);
  });
});
```

Append to the end of `src/store.throttle.test.ts`:

```ts
describe('Store pending set survives deserialize', () => {
  it('balances pending/published across an in-place hydrate', () => {
    const clock = new FakeClock();
    const store = new Store({ throttle: { dwell: { lifecycle: 150 } }, clock });
    store.registerNode(zone('z'));
    store.registerNode(panel('p', 'z'));
    store.flushNow();
    const snap: SerializedStore = serialize(store);

    const open = new Set<string>();
    store.events.on('throttle.pending', (p) => {
      open.add(p.id);
    });
    store.events.on('throttle.published', (p) => {
      open.delete(p.id);
    });

    store.showNode(nid('p'));
    expect(open.size).toBeGreaterThan(0);

    deserialize(store, snap);
    expect([...open]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/throttle.test.ts src/store.throttle.test.ts -t 'reset\|deserialize'`
Expected: FAIL — no published events emitted by `reset()`.

- [ ] **Step 3: Drain the dirty map in `reset`**

In `src/throttle.ts`, replace the line `this.dirty?.clear();` inside `reset()` (line 287) with:

```ts
    if (this.dirty) {
      // Drain rather than clear: every `throttle.pending` must be
      // balanced by exactly one `throttle.published`, or a consumer
      // tracking withheld nodes leaks across a hydrate. These are forced
      // by definition — hydration doesn't wait for anything to settle.
      const now = this.clock.now();
      for (const [id, entry] of this.dirty) {
        this.emitPublished(entry, id, now, true);
      }
      this.dirty.clear();
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/throttle.test.ts src/store.throttle.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean. Pay attention to `src/snapshot.test.ts` — it exercises `deserialize` heavily.

- [ ] **Step 6: Commit**

```bash
git add src/throttle.ts src/throttle.test.ts src/store.throttle.test.ts
git commit -m "fix(throttle): drain pending on reset so pending/published stay balanced"
```

---

## Task 7: Rewrite the `Bounce` story on the new API

Kill the two-recorder diff. Truth rows still come from `node.transitioned` (the correct source); the published side is driven by `throttle.published` instead of a `useRef` that compares each flush against the last value it saw.

**Files:**
- Modify: `src/react/stories/Throttling.stories.tsx:38-237` (the Bounce section only)
- Modify: `src/react/stories/throttling.css` (new classes)

- [ ] **Step 1: Replace the Bounce section comment and `BounceDemo`**

In `src/react/stories/Throttling.stories.tsx`, replace everything from the `// ===== Bounce — demonstrates dwell =====` comment block through the end of `function BounceDemo` (i.e. lines 38-212, stopping just before `export const Bounce`) with:

```tsx
// ===== Bounce — demonstrates dwell =====
//
// A single panel starts unshown. Clicking "Bounce" fires show → hide →
// show roughly 40ms apart (~80ms total). The point of dwell is an
// *absence* — a suppressed transition that never reaches the published
// view — so this demo logs every truth transition (from `store.events`,
// which is synchronous and never throttled) and then resolves each row
// against the `throttle.published` event: the last unresolved row is the
// state that actually landed, and every row before it was suppressed.
// With dwell on, three truth rows collapse into one publish; with dwellMs
// at 0 every row publishes on its own.

interface BounceArgs {
  throttled: boolean;
  dwellMs: number;
}

type RowStatus = 'pending' | 'published' | 'suppressed';

interface BounceRow {
  truth: string;
  status: RowStatus;
  detail: string;
}

const BOUNCE_ZONE = asNodeId('bounce-zone');
const BOUNCE_PANEL = asNodeId('bounce-panel');

function buildBounceStore(throttled: boolean, dwellMs: number): Store {
  const store = new Store(throttled ? { throttle: { dwell: { lifecycle: dwellMs } } } : {});
  store.registerNode(
    createZone({ id: BOUNCE_ZONE, strategyId: 'stack', config: { gap: 8, padding: 8 } }),
  );
  store.registerNode(
    createPanel({
      id: BOUNCE_PANEL,
      parentId: BOUNCE_ZONE,
      meta: { title: 'Bounced panel' },
      hints: { preferredSize: { w: 0, h: 120 } },
    }),
  );
  store.flushNow();
  return store;
}

/**
 * A publish reveals the node's *current* truth state, so the newest
 * unresolved row is the one that landed and every earlier unresolved row
 * was suppressed. `findLastIndex` is deliberately hand-rolled — the story
 * builds against the same lib target as the library.
 */
function resolveRows(
  rows: readonly BounceRow[],
  event: { heldMs: number; coalesced: number; forced: boolean },
): BounceRow[] {
  let landed = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].status === 'pending') {
      landed = i;
      break;
    }
  }
  if (landed === -1) return rows as BounceRow[];

  // Deliberately NOT `event.coalesced` — that counts internal dirty-marks
  // (one `showNode` alone yields 1), so showing it here would misreport
  // the demo. The suppressed count below is derived from the truth log,
  // which is the number this story is actually about.
  const suppressed = rows.filter((r, i) => r.status === 'pending' && i !== landed).length;
  const parts = [`held ${event.heldMs}ms`];
  if (suppressed > 0) parts.push(`${suppressed} suppressed`);
  if (event.forced) parts.push('forced');
  const detail = parts.join(', ');

  return rows.map((row, i) => {
    if (row.status !== 'pending') return row;
    if (i === landed) return { ...row, status: 'published', detail };
    return { ...row, status: 'suppressed', detail: 'never reached the published view' };
  });
}

function BounceDemo({ store, throttled }: { store: Store; throttled: boolean }) {
  const renders = useRef(0);
  renders.current += 1;

  const node = useNode(BOUNCE_PANEL);
  const state = node?.lifecycle.state ?? 'mounted';

  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [rows, setRows] = useState<BounceRow[]>([]);
  const [withheld, setWithheld] = useState(false);
  const [opensIn, setOpensIn] = useState(0);

  // Truth transitions and publish events, both off `store.events` — which
  // is synchronous and never throttled. An un-throttled store emits no
  // throttle events at all, so that arm marks each row published on
  // arrival instead of waiting for a resolution that will never come.
  useEffect(() => {
    const offTruth = store.events.on('node.transitioned', (payload) => {
      if (payload.id !== BOUNCE_PANEL || payload.machine !== 'lifecycle') return;
      setRows((prev) => [
        ...prev,
        throttled
          ? { truth: payload.to, status: 'pending', detail: '' }
          : { truth: payload.to, status: 'published', detail: 'published immediately' },
      ]);
    });
    const offPending = store.events.on('throttle.pending', (payload) => {
      if (payload.id !== BOUNCE_PANEL) return;
      setWithheld(true);
    });
    const offPublished = store.events.on('throttle.published', (payload) => {
      if (payload.id !== BOUNCE_PANEL) return;
      setWithheld(false);
      setRows((prev) => resolveRows(prev, payload));
    });
    return () => {
      offTruth();
      offPending();
      offPublished();
    };
  }, [store, throttled]);

  // The countdown ticker only runs while something is actually withheld —
  // `getPending` is a point read, so the story supplies the repaint.
  useEffect(() => {
    if (!withheld) {
      setOpensIn(0);
      return;
    }
    const handle = setInterval(() => {
      const pending = store.getPending(BOUNCE_PANEL);
      if (!pending) return;
      setOpensIn(Math.max(0, Math.round(pending.eligibleAt - Date.now())));
    }, 16);
    return () => clearInterval(handle);
  }, [withheld, store]);

  // Unmount-only cleanup. This component fully remounts (a fresh `store`)
  // whenever the story's `<Provider key=...>` changes, so there is no
  // "same component, new store" case to guard here — only "component goes
  // away with a bounce still in flight."
  useEffect(() => {
    return () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, []);

  const bounce = useCallback(() => {
    if (running) return;
    setRunning(true);
    store.showNode(BOUNCE_PANEL);
    timers.current.push(
      setTimeout(() => {
        store.hideNode(BOUNCE_PANEL);
        timers.current.push(
          setTimeout(() => {
            store.showNode(BOUNCE_PANEL);
            setRunning(false);
          }, 40),
        );
      }, 40),
    );
  }, [store, running]);

  const clearLog = useCallback(() => {
    setRows([]);
  }, []);

  return (
    <div className="throttling-demo">
      <p className="throttling-caption">
        Click <strong>Bounce</strong>: the panel is shown, hidden, and shown again within ~80ms.
        With dwell at 150ms the intermediate <code>hidden</code> never reaches the published view —
        its row below is marked <em>suppressed</em>, and the row that did land reports how long it
        was held and how many changes collapsed into it. Set <strong>dwellMs</strong> to 0 and click{' '}
        <strong>Bounce</strong> again: now every truth transition publishes on its own.
      </p>
      <div className="throttling-toolbar">
        <button type="button" onClick={bounce} disabled={running}>
          Bounce (show → hide → show, ~40ms apart)
        </button>
        <button type="button" onClick={clearLog} disabled={running}>
          Clear log
        </button>
        <span className="throttling-render-count">renders: {renders.current}</span>
      </div>
      <p className={`throttling-state throttling-state--${state}`}>
        Published lifecycle: <strong>{state}</strong>
      </p>
      {withheld ? (
        <p className="throttling-pending">
          Withheld — gate opens in <strong>{opensIn}ms</strong>{' '}
          <span className="throttling-render-count">(store.getPending)</span>
        </p>
      ) : null}
      <table className="throttling-table">
        <thead>
          <tr>
            <th>Truth</th>
            <th>Published</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="throttling-log-empty">
                No transitions recorded yet — click Bounce.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are an append-only log, index is a stable identity for this render's position
              <tr key={i} className={`is-${row.status}`}>
                <td>{row.truth}</td>
                <td>{row.status === 'published' ? row.truth : '—'}</td>
                <td>{row.detail}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="throttling-bounce-viewport" style={{ width: 260, height: 160 }}>
        <Container
          parentId={BOUNCE_ZONE}
          chrome={PANEL_CHROME}
          viewport={{ w: 260, h: 160 }}
          className="windease-zone"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Pass `throttled` down from the story**

In the same file, change the `<BounceDemo store={store} />` line inside `export const Bounce` to:

```tsx
        <BounceDemo store={store} throttled={throttled} />
```

- [ ] **Step 3: Confirm no import became unused**

The rewritten `BounceDemo` drops nothing that the other two demos still need — `useSyncExternalStore` remains in use by `TvpDemo`, and `useMemo` by all three story wrappers — so the import block at the top of the file stays exactly as it is. Biome will flag an unused import in Step 6 if that turns out to be wrong.

- [ ] **Step 4: Add the new CSS classes**

Append to `src/react/stories/throttling.css`:

```css
.throttling-pending {
  margin: 0;
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid #f59e0b;
  background: #fef3c7;
  color: #92400e;
  font-size: 13px;
}

.throttling-table tr.is-pending td {
  color: #64748b;
  font-style: italic;
}

.throttling-table tr.is-suppressed td {
  background: #fee2e2;
  color: #991b1b;
  text-decoration: line-through;
}

.throttling-table tr.is-published td {
  background: #dcfce7;
  color: #166534;
}
```

- [ ] **Step 5: Run the story smoke tests**

Run: `npx vitest run src/react/stories/Throttling.smoke.test.tsx`
Expected: PASS. The existing Bounce cases drive the same two buttons (`/Bounce \(show/` and `Clear log`), both of which still exist with the same labels. If a case fails, read the error before touching the story — the smoke tests are the contract that the story mounts and tears down cleanly.

- [ ] **Step 6: Run the full suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all clean.

- [ ] **Step 7: Verify the story visually**

Run: `npm run ladle` and open the `Throttling / Bounce` story. With the default args (`throttled: true`, `dwellMs: 150`), click **Bounce** and confirm:
- the amber "Withheld — gate opens in Nms" line appears while the node is held and disappears when it publishes,
- the log shows three truth rows, the middle `hidden` struck through as suppressed, and the final row green with a `held …ms, N coalesced` detail.

Then set `dwellMs` to 0 and click **Bounce** again: every row should be green.

Stop the Ladle server when done.

- [ ] **Step 8: Commit**

```bash
git add src/react/stories/Throttling.stories.tsx src/react/stories/throttling.css
git commit -m "docs(ladle): drive the Bounce story off throttle.published instead of log diffing"
```

---

## Task 8: Documentation

**Files:**
- Modify: `docs/concepts.md` (the "Truth vs. published" section)
- Modify: `README.md` (the "Optional transition throttling" section)
- Modify: `TODO.md` (the 0.7.0 throttling entry)

- [ ] **Step 1: Extend the concepts vocabulary**

In `docs/concepts.md`, add these rows to the existing `| Read | Sees |` table, immediately after the `focusedIdTruth` row:

```markdown
| `getPending(id)`                   | pending    |
```

Then insert this paragraph immediately **before** the closing "Full mechanism …" paragraph of that section:

```markdown
**Pending** is the third observable state: a node whose truth has moved but
whose published record hasn't caught up. `store.getPending(id)` returns a
`PendingPublish` describing why — `dwellMs`, `coalesced` (how many changes
collapsed so far), and `eligibleAt` (when the gate opens; `notifyMs` and
stagger can still defer the actual flush past it) — or `null` when nothing
is withheld. The `throttle.pending` and `throttle.published` events on
`store.events` are the same information as a stream, and are exactly
paired: one `published` for every `pending`, including for a node
unregistered while pending or dropped by `deserialize`. An un-throttled
store returns `null` and emits neither event, because it withholds nothing.
```

- [ ] **Step 2: Document the API in the README**

In `README.md`, insert this subsection immediately **before** the line `Set \`WINDEASE_TRACE=throttle\` to see publish decisions.` (line 223):

````markdown
### Introspecting what's withheld

Throttling is observable, so "why hasn't this panel moved?" has an answer
in consumer code:

```ts
const pending = store.getPending(panelId);
if (pending) {
  console.log(
    `withheld ${Date.now() - pending.since}ms, ` +
      `${pending.coalesced} changes coalesced, ` +
      `gate opens at ${pending.eligibleAt}`,
  );
}
```

`getPending` returns `null` when nothing is withheld — including on any
store with no `throttle` policy, which tracks nothing.

The same information is available as a stream:

```ts
store.events.on('throttle.pending', ({ id, dwellMs, eligibleAt }) => { /* … */ });
store.events.on('throttle.published', ({ id, heldMs, coalesced, forced }) => { /* … */ });
```

Exactly one `throttle.published` follows every `throttle.pending` for the
same id, so a `Set` of withheld nodes built from the pair never leaks.
`forced` means the node published without settling — `flushNow()`, the
`maxWaitMs` cap, or a `deserialize`.

`eligibleAt` is when the node's **gate opens**, not when it will publish:
`notifyMs` coalescing and stagger waves can both defer the flush past it.
````

- [ ] **Step 2b: Verify the anchor line**

Run: `grep -n 'WINDEASE_TRACE=throttle' README.md`
Expected: one hit, now below the block you inserted. If the line number drifted from 223, that's fine — the anchor is the text, not the number.

- [ ] **Step 3: Update the TODO entry**

In `TODO.md`, append these two sentences to the end of the **Optional transition throttling** bullet under `## Shipped in 0.7.0`, immediately after "Demoed by the `Throttling` Ladle stories.":

```markdown
  Introspectable via `store.getPending(id)` (a `PendingPublish` describing
  dwell, coalesced count, and when the gate opens) and the paired
  `throttle.pending` / `throttle.published` events on `store.events`.
```

- [ ] **Step 4: Regenerate the API docs**

Run: `npm run docs:api`
Expected: completes without error. Review `git status` — regenerated files under `docs-api/` are expected.

- [ ] **Step 5: Commit**

```bash
git add docs/concepts.md README.md TODO.md docs-api
git commit -m "docs: document getPending and the throttle pending/published events"
```

---

## Task 9: Final verification

**Files:** none — this task only runs commands.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS, no skipped files.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean. If Biome reports formatting diffs, run `npm run lint:fix` and commit the result.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean. Then confirm the new type reached the published surface:

Run: `grep -n 'PendingPublish\|ThrottlePendingPayload\|ThrottlePublishedPayload' dist/throttle.d.ts dist/index.d.ts`
Expected: hits in both files. A miss in `dist/index.d.ts` means Task 3 Step 4 was skipped.

- [ ] **Step 5: Trace check**

Run: `WINDEASE_TRACE=throttle npx vitest run src/store.throttle.test.ts 2>&1 | grep -c 'pending:'`
Expected: a non-zero count — the new `pending:` traces fire under the `throttle` category.

- [ ] **Step 6: Commit anything outstanding**

Run: `git status`
Expected: clean tree. If `npm run lint:fix` or the build produced changes, commit them:

```bash
git add -A
git commit -m "chore: formatting and build artifacts for throttle introspection"
```
