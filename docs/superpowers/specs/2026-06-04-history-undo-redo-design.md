# History + undo/redo design

**Goal:** Add a generic, library-level history controller with undo/redo support for store mutations and Workspace state. The story wires keybinds; all stack/transaction logic lives in the kit.

**Non-goals (v1):** persistence across reloads, selective undo, history-UI components, undo of provider/strategy registration.

---

## API additions

### `@windease/core`: `HistoryController<TSnapshot>`

Generic stack — knows nothing about windease specifics.

```ts
export interface HistoryControllerOptions {
  /** Max snapshots to retain. Oldest are evicted past the cap. Default: 100. */
  capacity?: number;
}

export class HistoryController<TSnapshot> {
  constructor(opts?: HistoryControllerOptions);

  /** Push a snapshot now. Drops any future entries past the cursor. */
  push(snapshot: TSnapshot): void;

  /** Move cursor back one step; returns the snapshot to apply (or undefined). */
  undo(): TSnapshot | undefined;

  /** Move cursor forward one step; returns the snapshot to apply (or undefined). */
  redo(): TSnapshot | undefined;

  canUndo(): boolean;
  canRedo(): boolean;

  /** Re-entrant. Pushes are deferred until the outermost endTransaction. */
  beginTransaction(): void;

  /** Ends one transaction frame. When the outermost frame ends, pushes one snapshot. */
  endTransaction(snapshot: TSnapshot): void;

  /** Snapshot at the current cursor position. */
  current(): TSnapshot | undefined;

  /** Drops all entries. */
  clear(): void;
}
```

Pure data structure: no event subscriptions, no DOM, no side effects.

### `@windease/react`: Provider context

`<Provider>` gains an optional `history` slot:

```ts
interface ProviderProps {
  store: Store;
  children: ReactNode;
  history?: HistoryHookup<unknown>;
}

interface HistoryHookup<T> {
  controller: HistoryController<T>;
  capture: () => T;
  restore: (snap: T) => void;
}
```

When `history` is provided, the Provider:

1. Subscribes to all store mutation events (`window.created`, `window.destroyed`, `window.transitioned`, `zone.claimed`, `zone.released`, `zone.reordered`) and calls `controller.push(capture())` unless a transaction is active.
2. Pushes an initial snapshot on mount.

`useHistory()` hook returns the `HistoryHookup` for descendant components to access.

### `<Workspace>` controlled mode

Add optional `state` prop. When present, Workspace uses it instead of internal state. `onStateChange` continues to fire when the strategy reduce produces a new state. Existing `initialState` semantics unchanged (used only in uncontrolled mode).

Also gain two optional callbacks:

```ts
onGestureStart?(): void;
onGestureEnd?(): void;
```

Workspace fires these around its built-in resize-gutter affordance drag and around its zone-swap drag.

**Auto-wiring:** when `useHistory()` returns a hookup, Workspace automatically calls `controller.beginTransaction()` on its gesture start and `controller.endTransaction(capture())` on gesture end — without the consumer wiring `onGestureStart/End`. Consumers can still pass them as an escape hatch for custom gestures.

### `<Zone>` auto-wiring

When `useHistory()` is available, Zone's window-drag is wrapped in begin/endTransaction so a drop counts as one history entry even though the underlying `moveWindow` or `reorderInZone` event would also try to push.

---

## Snapshot shape (story-defined)

Library doesn't bake in a shape. The Playground story will use:

```ts
interface PlaygroundSnapshot {
  store: SerializedStore;
  workspace: SplitNode;
}
```

`capture` reads from `store.snapshot()` and the story's local workspace `useState`. `restore` calls `store.hydrate(snap.store, { strategies })` and the workspace state setter.

---

## Story-level wiring

Playground story:

1. `useMemo` to construct `HistoryController`.
2. `useState` for the Workspace tree (controlled).
3. `capture` and `restore` closures defined inline.
4. Provider: `<Provider store={store} history={{ controller, capture, restore }}>`.
5. `useEffect` for keybinds:
   - `Cmd/Ctrl-Z` → `const snap = controller.undo(); if (snap) restore(snap);`
   - `Cmd/Ctrl-Shift-Z` (or `Cmd/Ctrl-Y`) → same with `redo`.
6. Optional toolbar buttons with `disabled={!controller.canUndo()}`.

---

## Coalescing rules

- Single store mutation outside transaction → one push.
- N events during a transaction → one push at `endTransaction`.
- Workspace state change during a transaction → one push at `endTransaction`.
- `restore()` is the inverse of `push()`; it does not push itself.

---

## Capacity

Default capacity 100. Snapshots are JSON-safe so memory is bounded by the size of the SerializedStore + tree (~kilobytes per snapshot). Ring-buffer eviction of oldest entries.

---

## Testing

- `HistoryController` unit tests: push/undo/redo round-trip; canUndo/canRedo correctness; cursor truncation on push after undo; capacity eviction; transaction coalescing (re-entrant begin/end); clear.
- Provider integration test: with a hookup, a `store.createWindow` causes a push; undo restores the prior state.
- Workspace integration test: a gesture (zone-swap) produces exactly one history entry.

---

## Risks

- Auto-wiring via context can surprise users who didn't expect Workspace/Zone to begin transactions. Mitigation: only triggers when `history` is in the Provider.
- Snapshot capture is full-state every push. Fine for our scale; flagged if hot.
- `restore` requires the consumer to supply the strategies map (via the closure) since `hydrate` needs it.
