# Transition throttling and debouncing

**Status:** design
**Date:** 2026-08-03
**Ships in:** `windease@0.7.0`

## Problem

Consumers driving windease from a live event stream can push the layout
through many transitions in rapid succession. Each one re-slots and
re-animates windows, so a node that flips `visible → hidden → visible`
inside a few hundred milliseconds visibly bounces through the grid, and a
cold-start flood animates every node at once.

The motivating consumer is brainhouse (`~/src/brainhouse/TODO.md`,
"Window-management throttling/debouncing"), whose panels churn on status
flips, supersede dims, cold-start floods, and delta bursts. Its own
conclusion — which this design adopts — is that the **mechanism belongs in
windease and the policy belongs in the consumer**. Rate-limiting node
transitions is windowing bookkeeping that benefits any consumer;
brainhouse should configure dwell durations rather than pre-filter its own
event stream.

What exists today:

- `Store.scheduleNotify()` already coalesces subscriber notifications to a
  **microtask**, so several mutations in one tick produce one render. That
  is the floor, not the feature — it cannot span ticks.
- `Machine.send()` is synchronous and unconditional. The FSM has no notion
  of time, dwell, or deferral.
- Every React read funnels through exactly two `Store` methods,
  `getNode(id)` and `subscribe(cb)` (`src/react/hooks.ts`). This single
  chokepoint is what makes the design cheap.

## Goal

Three opt-in, independently configurable mechanisms, implemented as stages
of one flush pipeline:

| # | Mechanism | Fixes |
| - | --------- | ----- |
| 1 | Time-window notify coalescing | delta floods, cold-start storms |
| 2 | Min dwell per FSM state | the `visible → hidden → visible` bounce |
| 3 | Staggered mass transitions | thundering-herd animation |

```ts
const store = new Store({
  throttle: {
    notifyMs: 32,                     // #1 flush window
    dwell: { lifecycle: 150 },        // #2 per-machine min dwell
    stagger: { batch: 8, ms: 40 },    // #3 mass-transition waves
  },
});
```

Omitting `throttle` preserves today's behavior exactly.

## Non-goals

- Throttling the `store.events` `TypedEmitter` channel. It stays
  synchronous and truthful (see "Truth vs. published").
- Animation easing, FLIP transitions, or any presentation concern beyond
  *when* a node becomes visible to the layout.
- Per-node policy. Policy is per-`Store`, keyed by machine. Per-node dwell
  would have to be serialized, which makes app config a document concern.
- Deferring or reordering the FSM's own transitions. Truth is always
  immediate (see below).

## Truth vs. published

The central decision: **dwell gates observation, never truth.**

`Store` keeps its existing `nodesMap` as truth plus a `publishedMap` of
what subscribers see. Mutations write truth synchronously and mark the
node dirty; a scheduler-driven flush graduates dirty nodes into published
and notifies subscribers once.

```
t=0    send('hide')   → node.lifecycle.state = 'hidden'    (truth: immediate)
t=80   send('show')   → node.lifecycle.state = 'visible'   (truth: immediate)
t=230  dwell expires  → published = 'visible'              (layout sees ONE value)

serialize() at any t  → always the true state
history undo/redo     → unaffected
```

The alternative — deferring the transition inside `Machine.send()` — was
rejected. A snapshot taken mid-dwell would serialize a stale state, and a
queued event could apply against a store that has since changed.

Consequence to document: an imperative `getNode()` call mid-dwell returns
the lagged value. That is the point of the feature, and `getNodeTruth()`
is one call away.

## The flush pipeline

```
mutation ──► truth updated ──► node marked dirty ──► schedule flush
                                                          │
                             ┌────────────────────────────┘
                             ▼
    #1 notifyMs   when does flush run?      (window; default = today's microtask)
    #2 dwell      which dirty nodes are     (per-machine eligibility)
                  eligible this flush?
    #3 stagger    how many eligible nodes   (batch N, reschedule rest)
                  publish per wave?
                             │
                             ▼
                 publishedMap swapped ──► subscribers notified once
```

### Opt-out is by identity, not by branch

With `throttle` omitted, `publishedMap` **is** `nodesMap` (same object
reference), `getNodeTruth` aliases `getNode`, and flush is the existing
`queueMicrotask`. No second map is allocated and no per-mutation
bookkeeping runs. This is a hard requirement, not an optimization: the
feature must be free when unused.

### #2 dwell is a debounce, not a throttle

A leading-edge throttle publishes the first change immediately, which
means `visible → hidden → visible` still shows `hidden` at t=0 and
`visible` at t=150 — the bounce survives, merely slower. Killing it
requires the first change to wait too. A node therefore publishes when it
has been **quiet for `dwellMs`**, or when `maxWaitMs` has elapsed since it
first went dirty.

```
dwell.lifecycle = 150, maxWaitMs = 600

isolated flip      t=0 hidden ····· quiet ····· t=150 publish 'hidden'   latency = dwell
bounce             t=0 hidden, t=80 visible ··· t=230 publish 'visible'  never publishes 'hidden'
continuous churn   changes every 50ms ········· t=600 forced publish     maxWait prevents starvation
```

`maxWaitMs` defaults to 4× the largest configured dwell. Without it a
permanently-noisy node would starve and never update.

The accepted cost: **every** gated transition eats `dwellMs` of latency,
including isolated ones. Consumers tune it down — 150ms reads as instant —
and machines with no configured dwell are unaffected.

### Dwell is triggered by FSM transitions, and holds the whole node

Only an FSM transition *starts* a dwell. A node whose `placement`, `meta`,
or `activity` changed — but whose machine states are stable — publishes on
the `notifyMs` window and is never dwell-gated.

Once a node **is** dwelling, however, its entire record is held:

```ts
publishedMap.set(id, truthNode);   // same object, same Machine instance
```

This is forced by the node shape. `Node.lifecycle` is a live `Machine`
class instance (`src/node.ts:84`), not a plain object — it owns mutable
`state` alongside `send` / `can` / `subscribe` and a subscriber `Set`.
Two rejected alternatives:

- *Pin just the state field* via `{ ...truth, lifecycle: { ...truth.lifecycle,
  state: pinned } }`. Spreading a class instance produces a plain object
  that has lost its methods; `node.lifecycle.send(...)` on a published
  record would throw.
- *Clone the Machine.* The clone owns its own `state`, so a `send()`
  against a published record would mutate the clone and silently diverge
  from truth.

Sharing one instance keeps `send()` always hitting truth. The accepted
cost: `activity` on a node that is *currently dwelling* lags by up to
`dwellMs`. A node mid-status-flip is rarely the one whose activity
readout matters, and at a typical 150ms dwell the lag is imperceptible.

### #3 stagger

After dwell eligibility is computed, if `stagger` is configured and the
eligible set exceeds `batch`, the first `batch` nodes publish now and the
remainder are rescheduled `ms` later. Ordering is **oldest-dirty-first,
ties broken by registration order**, so waves are deterministic and
testable.

## API surface

New module `src/throttle.ts`:

```ts
export type MachineName = 'lifecycle' | 'transit' | 'focus';

/** Opaque to windease; the clock implementation owns its meaning. */
export type TimerHandle = unknown;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
}

export interface ThrottlePolicy {
  /** Flush window in ms. Omit for today's microtask scheduling. */
  notifyMs?: number;
  /** Per-machine minimum dwell in ms. Machines omitted are not gated. */
  dwell?: Partial<Record<MachineName, number>>;
  /** Starvation cap. Defaults to 4× the largest configured dwell. */
  maxWaitMs?: number;
  /** Publish at most `batch` newly-eligible nodes every `ms`. */
  stagger?: { batch: number; ms: number };
}

export interface StoreOptions {
  throttle?: ThrottlePolicy;
  clock?: Clock;
}
```

`Store` gains `constructor(options: StoreOptions = {})`; `new Store()`
keeps working. The `clock` option exists so tests inject a `FakeClock` —
windease has snapshot round-trip and history determinism tests that real
timers would make flaky.

Added surface:

| Member | Purpose |
| ------ | ------- |
| `getNodeTruth(id)` | Unlagged node record |
| `nodesTruth` | Unlagged node map |
| `focusedIdTruth` | Unlagged focused id |
| `flushNow()` | Publish every dirty node synchronously, bypassing `notifyMs`, dwell, and stagger alike; cancels pending timers |

Unchanged signatures, now returning the published view: `getNode()`,
`nodes`, `focusedId`, `subscribe()`.

`flushNow()` serves tests and consumers who want to collapse pending
latency at a synchronization point — for example on an explicit user
gesture that should feel immediate.

## Edge cases

| Case | Rule |
| ---- | ---- |
| `registerNode` / `unregisterNode` / `node.cascadeDestroyed` | Bypass dwell, flush immediately. A dead node cannot be rendered and a new node should not wait to appear. |
| `moveNode` / `reorderInParent` / `setChildOrder` | Structural. Ride `notifyMs`, never dwelled — DnD must stay responsive. |
| Eligible by dwell but over the stagger budget | Stays dirty, publishes in the next wave. |
| `HistoryController` undo/redo | No change needed. It is a generic snapshot stack holding no `Store` reference — `undo()` returns a snapshot the consumer applies via `deserialize`, which resets the projection. An undo is a user gesture and lands without lag as a consequence. |
| `deserialize` | `published := truth`, dirty set cleared, pending timers cancelled, subscribers notified once. See "Hydrating in place" below. |
| `serialize` | Reads truth, so snapshots are never lagged. |

## Hydrating in place

`deserialize(snap)` constructs and returns a **new** `Store`. That is fine
pre-throttling, but it breaks two things once a policy exists: the new
store is built with no options, so the throttle policy is silently
discarded, and every subscriber attached to the old instance is orphaned —
which makes undo/redo unusable, since the React tree is bound to the
original store.

A second overload therefore hydrates into an existing store:

```ts
export function deserialize(snap: unknown): Store;              // unchanged
export function deserialize(store: Store, snap: unknown): void; // in place
```

The in-place form clears the target (cascading `unregisterNode` from each
root, reading truth), repopulates from the snapshot, and calls
`store.resetPublished()`. The store keeps its policy, its clock, and its
subscribers, so `deserialize(store, history.undo())` lands immediately on
the instance the consumer is already rendering.

Two consequences worth stating:

- **Hydration now emits removal events.** Clearing the target fires
  `node.unregistered` / `node.cascadeDestroyed` per node. Consumers
  listening on `store.events` see teardown traffic they did not see when
  hydration always produced a fresh store. Traces and event-driven
  consumers should expect it.
- **The single-arg form still drops the policy.** It is left unchanged for
  back-compat. A consumer who wants a throttled store from a snapshot
  should construct it themselves and hydrate in place:
  ```ts
  const store = new Store({ throttle });
  deserialize(store, snap);
  ```

## Tracing

Add a `'throttle'` entry to `TRACE_CATEGORIES` in `src/trace.ts`. Per
`CLAUDE.md` this is a genuinely distinct concern from `store`: `store`
traces mutations, `throttle` traces publish decisions.

Trace at least: flush scheduled, node held by dwell (with remaining ms),
node forced by `maxWaitMs`, stagger wave boundaries with batch size and
remaining count.

```ts
trace('throttle', `hold w1 lifecycle: 90ms remaining`);
trace('throttle', `wave 2/5: published 8, ${remaining} deferred`);
```

## Testing

A `FakeClock` helper drives every timing test, so no real timers and no
flake.

- Passthrough is identity-equal when `throttle` is omitted
  (`store.nodes === store.nodesTruth`).
- `visible → hidden → visible` inside the window publishes `visible` once
  and never publishes `hidden`.
- An isolated transition publishes after exactly `dwellMs`.
- Continuous churn forces a publish at `maxWaitMs`.
- `activity` on a node with stable machine states publishes on the notify
  window (dwell is never started by a non-FSM change).
- `activity` on a node that *is* dwelling is held with the rest of the
  record, and `published.lifecycle === truth.lifecycle` throughout — the
  Machine instance is shared, never cloned.
- `unregisterNode` mid-dwell drops the node from published immediately.
- Stagger emits deterministic batches in oldest-dirty-first order.
- `serialize()` mid-dwell returns truth, not the published lag.
- Undo forces an immediate publish.
- React: `getSnapshot` stays referentially stable across flushes.
  `src/react/hooks.ts:31` already documents that an unstable snapshot
  loops `useSyncExternalStore`.

## Rollout

Three sequential phases, each independently shippable:

1. **Publish projection + `notifyMs`** — truth/published split, flush
   pipeline, `StoreOptions`, `Clock`, `flushNow()`, trace category.
   Mechanism #1 falls out; #2 and #3 are policy-less no-ops.
2. **Dwell** — per-machine eligibility, `maxWaitMs`, pinned state field.
3. **Stagger** — batching and wave scheduling.

No breaking changes: added surface only, and behavior is identical unless
`throttle` is passed. A README note accompanies the 0.7.0 release.

## Follow-ups

- Once this lands, brainhouse deletes any interim client-side debounce at
  its `useDeltaStream → windease` boundary and configures `throttle`
  instead.
- Revisit whether `transit` and `focus` want dwell defaults at all. The
  expectation is that only `lifecycle` is configured in practice, and a
  dwelled focus machine would feel broken.
