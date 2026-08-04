# Throttle introspection

**Status:** design
**Date:** 2026-08-04
**Ships in:** `windease@0.7.0` (folds into the unreleased throttling work)

## Problem

Transition throttling shipped as a black box. A node can be withheld from
the published view for a dwell duration, a `maxWaitMs` starvation window,
or several stagger waves, and **nothing in the public API says so**. The
store answers "what is published" (`getNode`) and "what is true"
(`getNodeTruth`), but not "what is currently being withheld, and why."

Two concrete consequences:

- **The `Bounce` Ladle story reconstructs suppression by diffing two
  independently-recorded logs** — one fed by `store.events`
  (`node.transitioned`, synchronous truth), one fed by `store.subscribe`
  plus a `useRef` that remembers the last published value so unchanged
  flushes don't pad the column. The story is demonstrating an *absence*
  (the intermediate `hidden` never published), and an absence is currently
  only observable as a shape difference between two columns the reader has
  to eyeball against each other.
- **brainhouse will hit this while debugging.** "Why hasn't this panel
  moved?" has at least four answers today — dwell not yet satisfied, the
  `notifyMs` window hasn't fired, the node is behind a stagger wave, or
  nothing marked it dirty at all — and no way to tell them apart from
  consumer code.

What exists today: `Publisher` already tracks everything needed.
`DirtyEntry` (`src/throttle.ts:116-129`) carries `since`, `touched`,
`dwellMs`, and `bypass`. None of it escapes the class. `Store` exposes
only the published reads, the `*Truth` reads, and `flushNow()`.

## Goal

Make throttling introspectable from consumer code, both as a point read
and as a stream, without eroding the passthrough contract.

## Non-goals

- **Emitting throttle events in passthrough.** An unthrottled `Publisher`
  allocates nothing and tracks nothing (`src/throttle.ts:140-147`); that
  is a hard requirement of the throttling design, not an optimization.
  Introspection does not get to erode it.
- **Retaining suppressed *values*** (which intermediate lifecycle states
  were dropped). That puts domain knowledge — FSM state names — inside the
  throttle layer and grows unbounded under churn. A count is enough; the
  names are already available from `node.transitioned`.
- **A `pendingIds()` / whole-map read.** The events below let a consumer
  maintain the set incrementally. Revisit if a debug overlay proves it
  needs the direct read.
- **A React `usePending(id)` hook.** Buildable in consumer code from the
  events. Out of scope until something asks for it.

## API surface

### `PendingPublish` (`src/throttle.ts`, re-exported from `index.ts`)

```ts
export interface PendingPublish {
  /** clock.now() when the node first went dirty and has stayed dirty. */
  since: number;
  /** clock.now() of the most recent dwell-restarting change. */
  touched: number;
  /** Largest dwell gating this node; 0 means not dwell-gated. */
  dwellMs: number;
  /** The machine that set the current dwellMs; null when no dwell applies. */
  machine: MachineName | null;
  /** Structural change (register/unregister/move); skips dwell entirely. */
  bypass: boolean;
  /** Internal dirty-marks after the first: a churn indicator. */
  coalesced: number;
  /** Earliest the gate opens: min(touched + dwellMs, since + maxWaitMs). */
  eligibleAt: number;
}
```

```ts
Store.getPending(id: NodeId): PendingPublish | null
```

`null` means nothing is being withheld for that node — either it is clean,
or the store is in passthrough.

`eligibleAt` is **when the gate opens, not when the node will publish.**
`notifyMs` coalescing and stagger waves can both defer the actual flush
past it. This distinction goes in the doc comment; it is the single
easiest thing to misread about this API.

`eligibleAt` for an entry that is already eligible (`bypass`, or
`dwellMs === 0`) is `since` — the gate opened the moment the node went
dirty. Reporting `since` rather than reading the clock keeps the
descriptor a pure function of the entry, so two reads in the same tick
agree.

Two field semantics that review proved are easy to get wrong, and that
the doc comments must therefore state outright:

- **`bypass` outranks the dwell it still carries.** `bypass` is sticky and
  `dwellMs` is a running max, so a bypassing entry routinely reports a
  non-zero `dwellMs` (and a `machine`) that gate nothing. Any rule of the
  form "compare `eligibleAt` against `touched + dwellMs`" must check
  `bypass` first or it reports the wrong cause on the `moveNode` path.
- **`coalesced` counts internal dirty-marks, not store operations.** One
  `showNode` yields `1`; one `showNode` plus one `moveNode` yields `6` —
  the record swap and the FSM transition are separate `markDirty` calls.
  It is a churn indicator, and must not be presented to a user as a count
  of changes.

### Events (`StoreEvents`)

```ts
'throttle.pending': {
  id: NodeId;
  since: number;
};
'throttle.published': {
  id: NodeId;
  /** now - since: total time withheld. */
  heldMs: number;
  coalesced: number;
  /** Published without its dwell gate being satisfied. */
  forced: boolean;
};
```

Payload types are declared in `src/throttle.ts` (which owns the concepts)
and imported into the `StoreEvents` map in `src/store.ts`. `Publisher`
does not import `StoreEvents`; it receives two callbacks on
`PublisherDeps` (`onPending`, `onPublished`) alongside the existing
`notify`, and `Store` wires them to `this.events.emit`.

## Semantics

### When `pending` fires

Only when `markDirty` **creates** a new `DirtyEntry` — not on subsequent
touches of an already-pending node. This keeps the event off the
per-mutation hot path (`markDirty` runs on every store mutation; there are
15 call sites in `store.ts`).

Consequently the payload carries **only `id` and `since`**. One store
mutation marks a node several times, and the *first* mark is usually the
untagged one from `replaceNode` — `showNode` calls `replaceNode(id)` (no
machine) before `markDirty(id, { machine: 'lifecycle' })`. The entry is
therefore born with `dwellMs: 0` and raised afterwards, so a payload
advertising `dwellMs` or `eligibleAt` would report `0` / "already
eligible" for a node about to be held the full dwell. Settled values come
from `getPending(id)` or from `throttle.published`.

The event also fires **mid-mutation**: during `moveNode` it lands after
the old parent's `removeChild` but before `addChild`, so a handler that
walks the tree can observe a half-applied change. This matches how
`node.transitioned` already behaves, but it must be stated rather than
discovered.

### When `published` fires

Once per node in a flush wave, emitted inside the wave loop after
`published.set`/`published.delete` and **before** `notify()`. A listener
that reads `store.getNode(id)` inside the handler therefore already sees
the new published value, and `subscribe` callbacks still run on a fully
consistent world.

A node that was unregistered while pending still gets a `published` event
— publishing a deletion is publishing.

### `forced`

```ts
forced =
  fullFlush ||
  (entry.dwellMs > 0 && !entry.bypass && now - entry.touched < entry.dwellMs)
```

True when the node published **without going quiet first**. A node that
was never dwell-gated — `bypass`, or `dwellMs === 0` — is not "forced"; it
had no gate to escape. This covers
both escape hatches — `flushNow()` (which sets `forceFullFlush`) and the
`maxWaitMs` starvation cap — from data already in hand at the flush site.
It is the semantically interesting bit for a debugger: "this published
because it ran out of patience, not because it settled."

### The balance invariant

> Every `throttle.pending` is balanced by exactly one `throttle.published`
> for the same id.

This is the property that makes the events usable for a debug overlay: a
listener maintaining a `Set<NodeId>` of pending nodes never leaks. It
constrains `reset()`, which today clears `dirty` wholesale during
`deserialize` — `reset()` must emit `throttle.published` with
`forced: true` for every entry it drops.

### Passthrough

`getPending` returns `null` and neither event fires. Documented on both
the method and the event payloads.

## Internal consolidation

`isEligible` (`src/throttle.ts:418-426`), `scheduleRecheck`
(`src/throttle.ts:392-411`), and the new `eligibleAt` all compute
`min(touched + dwellMs, since + maxWaitMs)`. Factor one private
`eligibleAt(entry): number` helper and express the other two in terms of
it:

- `isEligible(entry, now)` → `now >= this.eligibleAt(entry)`. Equivalent
  to today: `now - touched >= dwellMs` is `now >= touched + dwellMs`, and
  `now - since >= maxWaitMs` is `now >= since + maxWaitMs`, so "either
  bound passed" is "`now` is past the min of the two."
- `scheduleRecheck` takes `Math.min` over `eligibleAt(entry)` across
  entries, with the existing early-out when any entry is already eligible.

The existing `maxWait forced publish` trace in `isEligible` is preserved
by checking which bound won.

Three copies of that expression silently drifting is a real bug source
once a fourth reader (the public descriptor) exists.

`DirtyEntry` gains `coalesced: number`, initialized to `0` and incremented
on the `existing` branch of `markDirty` — one integer, no extra
allocation.

## Tracing

Per the repo tenet, add to the existing `throttle` category:

```ts
trace('throttle', `pending: ${id} dwell ${dwellMs}ms, eligible in ${eligibleAt - now}ms`);
trace('throttle', `published: ${id} held ${heldMs}ms, ${coalesced} coalesced${forced ? ' (forced)' : ''}`);
```

The `pending` trace fires on the same condition as the event (new entry
only), so it does not spam under churn.

## The `Bounce` story

Replace the two-recorder diff. Truth rows still come from
`node.transitioned` — that is the correct source and stays. What changes
is the Published column: it is driven directly by `throttle.published`,
rendering one row that reads *"visible — held 152ms, 3 coalesced"*
instead of a column whose meaning only emerges by comparison with its
neighbor. The `lastPublished` ref and the `store.subscribe` recorder go
away.

Add a live badge reading `store.getPending(BOUNCE_PANEL)` showing the
dwell countdown while the node is held. It needs a repaint tick while
pending (rAF or a short interval), started on `throttle.pending` and
stopped on `throttle.published` — so the timer only runs while something
is actually being withheld.

**The `throttled: false` arm:** no throttle events fire in passthrough, so
that mode renders every truth row as published immediately, from the truth
log alone. The toggle keeps working; the contrast becomes explicit
("publishes immediately") rather than inferred from two matching columns.

## Testing

`src/throttle.test.ts` (`FakeClock`, as the existing suite does):

- Descriptor: shape under dwell; `null` when clean; `null` in passthrough.
- `eligibleAt`: dwell-gated; clamped by `maxWaitMs`; equals `since` for
  `bypass` and for `dwellMs === 0`.
- `coalesced`: counts subsequent marks, not the first; resets with the
  entry (a republished node starts at 0 again).
- `getPending` returns `null` immediately after the node publishes.
- Consolidation: dwell/maxWait/stagger behavior unchanged — the existing
  suite is the regression net and must pass untouched.

Events:

- `pending` fires once per entry, not per touch (mark 3x, assert 1 event).
- `published` carries correct `heldMs` and `coalesced`.
- `forced` is `true` after `flushNow()` and after a `maxWaitMs`-driven
  publish; `false` for a node that settled and published on dwell.
- Balance invariant: drive a churn, assert the pending set built from the
  two events is empty at the end.
- Ordering: a `throttle.published` listener reading `store.getNode(id)`
  sees the new value; the `subscribe` callback fires after.
- `reset()` emits `published` with `forced: true` for every dropped entry.

`src/store.throttle.test.ts`: `Store.getPending` delegation and
`StoreEvents` typing.

`src/react/stories/Throttling.smoke.test.tsx`: updated for the rewritten
Bounce story.

## Docs

- `docs/concepts.md` — extend the truth/published section with pending as
  the third observable state.
- `README.md` — the throttling section gains the introspection API.
- `TODO.md` — fold into the existing throttling entry.
- `docs-api/` regenerates from typedoc.

## Rollout

Additive. No behavior change for existing consumers; no version bump —
`0.7.0` is unreleased on `feat/transition-throttling`.
