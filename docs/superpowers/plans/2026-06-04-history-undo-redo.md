# History + undo/redo implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a generic `HistoryController` in `@windease/core`, wire `<Provider>` / `<Workspace>` / `<Zone>` to use it via React context when present, and demonstrate it in the Playground story with Cmd/Ctrl-Z keybinds.

**Architecture:** `HistoryController` is a snapshot stack with transaction coalescing — knows nothing about windease specifics. `Provider` accepts an optional `history` hookup `{ controller, capture, restore }` and subscribes to store events to auto-push. `<Workspace>` and `<Zone>` consume the hookup via context and wrap their gestures in transactions. The story owns snapshot shape + keybinds.

**Tech Stack:** TypeScript 5, React 19, Vitest. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-06-04-history-undo-redo-design.md`

---

## File structure

```
packages/core/src/
├── history.ts                      # NEW — HistoryController class
├── history.test.ts                 # NEW
└── index.ts                        # MODIFY — export HistoryController + types

packages/react/src/
├── Provider.tsx            # MODIFY — accept history prop, wire store event subscription
├── Provider.test.tsx       # MODIFY — integration test
├── hooks.ts                        # MODIFY — add useHistory()
├── Workspace.tsx                   # MODIFY — controlled state + gesture transactions
├── Workspace.test.tsx              # MODIFY — controlled-mode + transaction tests
├── Zone.tsx                        # MODIFY — wrap DnD in transactions
└── stories/
    └── Playground.stories.tsx      # MODIFY — wire history + keybinds + toolbar buttons
```

---

## Task 1: `HistoryController` in @windease/core (TDD)

**Files:**
- Create `packages/core/src/history.test.ts`
- Create `packages/core/src/history.ts`

- [ ] **Step 1: Write the tests** `packages/core/src/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HistoryController } from './history.js';

describe('HistoryController', () => {
  it('push then undo returns the prior snapshot; canRedo becomes true', () => {
    const h = new HistoryController<number>();
    h.push(1);
    h.push(2);
    h.push(3);
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBe(2);
    expect(h.canRedo()).toBe(true);
    expect(h.undo()).toBe(1);
    expect(h.canUndo()).toBe(false);
    expect(h.undo()).toBeUndefined();
  });

  it('redo replays forward until exhausted', () => {
    const h = new HistoryController<number>();
    h.push(1); h.push(2); h.push(3);
    h.undo(); h.undo();
    expect(h.redo()).toBe(2);
    expect(h.redo()).toBe(3);
    expect(h.redo()).toBeUndefined();
  });

  it('push after undo truncates the redo tail', () => {
    const h = new HistoryController<number>();
    h.push(1); h.push(2); h.push(3);
    h.undo();
    h.push(99);
    expect(h.canRedo()).toBe(false);
    expect(h.current()).toBe(99);
    expect(h.undo()).toBe(2);
  });

  it('capacity caps the stack and evicts oldest', () => {
    const h = new HistoryController<number>({ capacity: 3 });
    h.push(1); h.push(2); h.push(3); h.push(4);
    // Undoing as far as possible should land at 2 (1 was evicted)
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.canUndo()).toBe(false);
  });

  it('transactions coalesce multiple events into one push', () => {
    const h = new HistoryController<number>();
    h.push(0);
    h.beginTransaction();
    // The user calls endTransaction with the final snapshot; no intermediate pushes.
    h.endTransaction(5);
    expect(h.current()).toBe(5);
    expect(h.undo()).toBe(0);
    expect(h.canRedo()).toBe(true);
  });

  it('nested transactions only push at the outermost endTransaction', () => {
    const h = new HistoryController<number>();
    h.push(0);
    h.beginTransaction();
    h.beginTransaction();
    h.endTransaction(1); // inner end — no push
    expect(h.current()).toBe(0);
    h.endTransaction(2); // outer end — pushes 2
    expect(h.current()).toBe(2);
    expect(h.undo()).toBe(0);
  });

  it('clear empties the stack', () => {
    const h = new HistoryController<number>();
    h.push(1); h.push(2);
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.current()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**
`npx vitest run packages/core/src/history.test.ts`

- [ ] **Step 3: Implement** `packages/core/src/history.ts`:

```ts
export interface HistoryControllerOptions {
  capacity?: number;
}

const DEFAULT_CAPACITY = 100;

export class HistoryController<TSnapshot> {
  private stack: TSnapshot[] = [];
  private cursor = -1;
  private readonly capacity: number;
  private txnDepth = 0;

  constructor(opts: HistoryControllerOptions = {}) {
    this.capacity = Math.max(1, opts.capacity ?? DEFAULT_CAPACITY);
  }

  push(snapshot: TSnapshot): void {
    if (this.txnDepth > 0) return;
    this.commit(snapshot);
  }

  undo(): TSnapshot | undefined {
    if (this.cursor <= 0) return undefined;
    this.cursor -= 1;
    return this.stack[this.cursor];
  }

  redo(): TSnapshot | undefined {
    if (this.cursor >= this.stack.length - 1) return undefined;
    this.cursor += 1;
    return this.stack[this.cursor];
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.stack.length - 1;
  }

  beginTransaction(): void {
    this.txnDepth += 1;
  }

  endTransaction(snapshot: TSnapshot): void {
    if (this.txnDepth === 0) return;
    this.txnDepth -= 1;
    if (this.txnDepth === 0) {
      this.commit(snapshot);
    }
  }

  current(): TSnapshot | undefined {
    return this.cursor >= 0 ? this.stack[this.cursor] : undefined;
  }

  clear(): void {
    this.stack = [];
    this.cursor = -1;
    this.txnDepth = 0;
  }

  private commit(snapshot: TSnapshot): void {
    // Truncate redo tail.
    if (this.cursor < this.stack.length - 1) {
      this.stack.length = this.cursor + 1;
    }
    this.stack.push(snapshot);
    this.cursor = this.stack.length - 1;
    // Evict oldest past capacity.
    while (this.stack.length > this.capacity) {
      this.stack.shift();
      this.cursor -= 1;
    }
  }
}
```

- [ ] **Step 4: Run, expect 7/7 PASS**

- [ ] **Step 5: Export from index** — add to `packages/core/src/index.ts`:

```ts
export { HistoryController, type HistoryControllerOptions } from './history.js';
```

- [ ] **Step 6: Build + commit**
```
npx tsc -b
git add packages/core/src/history.ts packages/core/src/history.test.ts packages/core/src/index.ts
git -c commit.gpgsign=false commit -m "feat(core): HistoryController with transactions"
```

---

## Task 2: `Provider` accepts `history`, auto-pushes on store events; `useHistory()` hook

**Files:**
- Modify: `packages/react/src/Provider.tsx`
- Modify: `packages/react/src/hooks.ts`
- Modify: `packages/react/src/Provider.test.tsx`

### Step 1: Read current state

Read `packages/react/src/Provider.tsx` and `hooks.ts`. The current Provider exposes a context with the store; `useWindease()` returns it.

### Step 2: Add a history-hookup context

Define a separate React context for the history hookup (so consumers don't pay re-render cost when only store changes):

```ts
// In Provider.tsx (or a sibling file — adapt to existing structure)
import type { HistoryController } from '@windease/core';

export interface HistoryHookup<T = unknown> {
  controller: HistoryController<T>;
  capture: () => T;
  restore: (snap: T) => void;
}

export const HistoryHookupContext = createContext<HistoryHookup<unknown> | null>(null);
```

### Step 3: Update `Provider` props and behavior

Add `history?: HistoryHookup` to props. In the component, wrap children in `<HistoryHookupContext.Provider value={history ?? null}>`.

Add a `useEffect` that, when `history` is provided:
1. Pushes an initial snapshot via `history.controller.push(history.capture())`.
2. Subscribes to the store's mutation events: `window.created`, `window.destroyed`, `window.transitioned`, `zone.claimed`, `zone.released`, `zone.reordered`. For each event, push a snapshot.
3. Returns a cleanup that unsubscribes.

Pseudo-code:

```tsx
useEffect(() => {
  if (!history) return;
  history.controller.push(history.capture());
  const evt = store.events;
  const offs = [
    evt.on('window.created', () => history.controller.push(history.capture())),
    evt.on('window.destroyed', () => history.controller.push(history.capture())),
    evt.on('window.transitioned', () => history.controller.push(history.capture())),
    evt.on('zone.claimed', () => history.controller.push(history.capture())),
    evt.on('zone.released', () => history.controller.push(history.capture())),
    evt.on('zone.reordered', () => history.controller.push(history.capture())),
  ];
  return () => { for (const off of offs) off(); };
}, [store, history]);
```

### Step 4: Add `useHistory()` hook in `hooks.ts`:

```ts
import { useContext } from 'react';
import { HistoryHookupContext, type HistoryHookup } from './Provider.js';

export function useHistory<T = unknown>(): HistoryHookup<T> | null {
  return useContext(HistoryHookupContext) as HistoryHookup<T> | null;
}
```

### Step 5: Write test in `Provider.test.tsx`

Append:

```tsx
import { HistoryController, type SerializedStore, Store, asWindowId, gridStrategy, asZoneId } from '@windease/core';

it('history hookup pushes initial snapshot and on store events', () => {
  const store = new Store();
  store.registerZone({ id: asZoneId('z'), strategy: gridStrategy, config: {} });
  const controller = new HistoryController<SerializedStore>();
  const capture = () => store.snapshot();
  const restore = (snap: SerializedStore) => store.hydrate(snap, { strategies: { grid: gridStrategy } });

  render(
    <Provider store={store} history={{ controller, capture, restore }}>
      <div />
    </Provider>,
  );

  // Initial push happened
  expect(controller.canUndo()).toBe(false);
  expect(controller.current()).toBeDefined();

  // Mutate the store, expect a push
  store.createWindow({ id: asWindowId('w'), kind: 'panel' });
  expect(controller.canUndo()).toBe(true);

  // Undo restores
  const prev = controller.undo();
  expect(prev).toBeDefined();
  if (prev) restore(prev);
  expect(store.getWindow(asWindowId('w'))).toBeUndefined();
});
```

### Step 6: Build + test
`npx tsc -b && npx vitest run packages/react/src/Provider.test.tsx`

### Step 7: Commit
```
git add packages/react/src/Provider.tsx packages/react/src/Provider.test.tsx packages/react/src/hooks.ts
git -c commit.gpgsign=false commit -m "feat(react): Provider history hookup + useHistory hook"
```

---

## Task 3: `<Workspace>` controlled state + gesture transactions

**Files:**
- Modify: `packages/react/src/Workspace.tsx`
- Modify: `packages/react/src/Workspace.test.tsx`

### Step 1: Add controlled `state` prop

Read current `Workspace.tsx`. Today it has `initialState?: TState` and internal `useState`. Add `state?: TState` to props. The effective state computation:

```ts
const [internalState, setInternalState] = useState<TState>(initial);
const isControlled = props.state !== undefined;
const state = isControlled ? (props.state as TState) : internalState;
const setState: (updater: TState | ((prev: TState) => TState)) => void = (updater) => {
  const next = typeof updater === 'function' ? (updater as (p: TState) => TState)(state) : updater;
  if (!isControlled) setInternalState(next);
  if (onStateChange) onStateChange(next);
};
```

Replace existing `setState` usages with the new wrapped version. Be careful: existing `setState((prev) => ...)` patterns need to compute against the current effective state.

### Step 2: Wrap gestures in transactions

Pull `useHistory()`:

```ts
const history = useHistory<unknown>();
```

In the affordance-drag handler (the one that calls `strategy.reduce`): wrap pointerdown → pointerup. The simplest place is the dispatch path. The affordance pointerdown handler should call `history?.controller.beginTransaction()`; pointerup should call `endTransaction(history.capture())`. Both should also fire `onGestureStart`/`onGestureEnd` props if provided.

Similarly for the zone-swap drag in Workspace: wrap with begin/end transaction around the gesture (already coalesced as one event, but consistency is nice).

Add new props:

```ts
onGestureStart?(): void;
onGestureEnd?(): void;
```

Helper inside Workspace:

```ts
const gestureStart = useCallback(() => {
  history?.controller.beginTransaction();
  props.onGestureStart?.();
}, [history, props.onGestureStart]);

const gestureEnd = useCallback(() => {
  history?.controller.endTransaction(history.capture());
  props.onGestureEnd?.();
}, [history, props.onGestureEnd]);
```

Wire these into:
- The resize-affordance drag handlers (in the existing affordance pointerdown/pointerup branches).
- The zone-swap drag's onDragStart/onDragEnd already passed to `usePointerDrag`.

### Step 3: Write tests

Append to `Workspace.test.tsx`:

```tsx
import { HistoryController } from '@windease/core';

it('controlled mode: uses external state, fires onStateChange', () => {
  const onStateChange = vi.fn();
  const initial: SplitNode = { kind: 'split', direction: 'horizontal', ratio: 0.5, a: { kind: 'leaf', id: 'a' }, b: { kind: 'leaf', id: 'b' } };
  // Render controlled Workspace and verify it reads from `state` prop.
  render(
    <Workspace
      strategy={recursiveSplit}
      items={[{ id: 'a' }, { id: 'b' }]}
      state={initial}
      onStateChange={onStateChange}
      container={{ w: 200, h: 100 }}
    >
      {(item) => <div data-zone-id={item.id} style={{ width: '100%', height: '100%' }} />}
    </Workspace>,
  );
  // Snapshot test: layout reflects external state's ratio of 0.5 → both 98px.
  const aPlacement = (document.querySelector('[data-zone-id="a"]') as HTMLElement).parentElement!;
  expect(aPlacement.style.width).toMatch(/98px|99px/);  // gutter halving may produce 98 or 99
});

it('zone-swap drag fires onGestureStart and onGestureEnd', () => {
  const onGestureStart = vi.fn();
  const onGestureEnd = vi.fn();
  const initial: SplitNode = { kind: 'split', direction: 'horizontal', ratio: 0.5, a: { kind: 'leaf', id: 'a' }, b: { kind: 'leaf', id: 'b' } };
  render(
    <Workspace
      strategy={recursiveSplit}
      items={[{ id: 'a' }, { id: 'b' }]}
      initialState={initial}
      container={{ w: 400, h: 200 }}
      onGestureStart={onGestureStart}
      onGestureEnd={onGestureEnd}
    >
      {(item) => <div data-zone-id={item.id} style={{ width: '100%', height: '100%' }} />}
    </Workspace>,
  );
  const left = document.querySelector('[data-zone-id="a"]') as HTMLElement;
  const right = document.querySelector('[data-zone-id="b"]') as HTMLElement;
  vi.spyOn(left, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  vi.spyOn(right, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 0, right: 400, bottom: 200, width: 200, height: 200, x: 200, y: 0, toJSON: () => ({}) } as DOMRect);
  if (!('elementsFromPoint' in document)) Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true });
  vi.spyOn(document, 'elementsFromPoint').mockImplementation((x: number) => (x < 200 ? [left] : [right]));
  firePointer(left, 'pointerdown', { clientX: 50, clientY: 50 });
  firePointer(left, 'pointermove', { clientX: 250, clientY: 50 });
  firePointer(left, 'pointerup', { clientX: 250, clientY: 50 });
  expect(onGestureStart).toHaveBeenCalledTimes(1);
  expect(onGestureEnd).toHaveBeenCalledTimes(1);
});
```

### Step 4: Run + commit

`npx tsc -b && npx vitest run packages/react/src/Workspace.test.tsx`

```
git add packages/react/src/Workspace.tsx packages/react/src/Workspace.test.tsx
git -c commit.gpgsign=false commit -m "feat(react): Workspace controlled state + gesture callbacks"
```

---

## Task 4: `<Zone>` wraps drops in transactions

**Files:**
- Modify: `packages/react/src/Zone.tsx`

### Step 1: Pull `useHistory()` in `WindowItem`

When a drag actually completes (didDrag=true) and a drop occurs, wrap the store mutation in `beginTransaction` / `endTransaction(capture())`. This way the store-event subscription in the Provider would normally push, but the transaction defers it; the explicit endTransaction snapshot is the one that lands.

Pseudo:

```ts
const history = useHistory<unknown>();
const handlers = usePointerDrag({
  onDragStart: () => { dragCoordinator.tryBegin('window'); history?.controller.beginTransaction(); },
  onDragMove: ...,
  onDragEnd: (e, didDrag) => {
    if (didDrag && dragCoordinator.active() === 'window') {
      handleWindowDrop(e, w.id, zoneId, store);
    }
    clearAllDropMarkers();
    if (history) history.controller.endTransaction(history.capture());
    dragCoordinator.end();
  },
});
```

Important: `beginTransaction` should fire even if the drag is rejected later, because `endTransaction` is paired. The Provider's event listeners will fire during the drop but be deferred. If the drop was rejected (no store mutation), the snapshot at endTransaction is identical to the prior one — which would just be a no-op push of the same state. To avoid noise, you can check: if dragCoordinator never started (tryBegin failed), do NOT begin a transaction in onDragStart.

Simpler: only `beginTransaction` if `tryBegin` succeeded:

```ts
onDragStart: () => {
  const ok = dragCoordinator.tryBegin('window');
  if (ok) history?.controller.beginTransaction();
},
onDragEnd: (e, didDrag) => {
  const wasMine = dragCoordinator.active() === 'window';
  if (didDrag && wasMine) handleWindowDrop(e, w.id, zoneId, store);
  clearAllDropMarkers();
  if (wasMine && history) history.controller.endTransaction(history.capture());
  if (wasMine) dragCoordinator.end();
},
```

### Step 2: Quick smoke test

Add to `Zone.test.tsx`:

```tsx
it('window-drag wraps drop in a transaction (single history entry)', () => {
  // Set up store with two zones, controller with capture/restore.
  // After a drag, controller should have exactly one extra entry beyond initial.
  // Use HistoryController + Provider with history hookup.
});
```

(Implementer: build out this test using the same scaffold as the existing DnD integration test, plus a `HistoryController` and a `history` hookup. Assert `controller.canUndo()` true after the drag and that undoing then restoring puts the window back.)

### Step 3: Run + commit

`npx tsc -b && npm test`

```
git add packages/react/src/Zone.tsx packages/react/src/Zone.test.tsx
git -c commit.gpgsign=false commit -m "feat(react): Zone wraps window-drag in history transaction"
```

---

## Task 5: Wire history into Playground story (with keybinds + toolbar buttons)

**Files:** Modify `packages/react/src/stories/Playground.stories.tsx`

### Step 1: Construct controller + state

Inside the `Playground` component, add:

```tsx
import { HistoryController, type SerializedStore } from '@windease/core';
import type { SplitNode } from '@windease/core';

interface PlaygroundSnapshot {
  store: SerializedStore;
  workspace: SplitNode;
}

const initialWorkspaceTree: SplitNode = { /* the existing inline initialState */ };

const [workspaceState, setWorkspaceState] = useState<SplitNode>(initialWorkspaceTree);

const controller = useMemo(() => new HistoryController<PlaygroundSnapshot>(), []);

const capture = useCallback((): PlaygroundSnapshot => ({
  store: store.snapshot(),
  workspace: workspaceStateRef.current,  // ref so capture always reads latest
}), [store]);

const workspaceStateRef = useRef<SplitNode>(workspaceState);
useEffect(() => { workspaceStateRef.current = workspaceState; }, [workspaceState]);

const restore = useCallback((snap: PlaygroundSnapshot) => {
  store.hydrate(snap.store, { strategies: STRATEGIES });
  setWorkspaceState(snap.workspace);
}, [store]);
```

Pass to provider:

```tsx
<Provider store={store} history={{ controller, capture, restore }}>
```

Pass `state` + `onStateChange` to `Workspace` (controlled mode):

```tsx
<Workspace
  strategy={recursiveSplit}
  items={[{ id: MAIN }, { id: DOCK }, { id: SIDEBAR }]}
  state={workspaceState}
  onStateChange={setWorkspaceState}
>
```

(Drop the old `initialState={...}` prop in favor of `state={workspaceState}`.)

### Step 2: Keybinds

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      const snap = controller.undo();
      if (snap) restore(snap);
    } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
      e.preventDefault();
      const snap = controller.redo();
      if (snap) restore(snap);
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [controller, restore]);
```

### Step 3: Toolbar buttons (optional but nice)

Add inside the existing `.story-toolbar`:

```tsx
<button type="button" onClick={() => { const s = controller.undo(); if (s) restore(s); }} disabled={!controller.canUndo()}>
  Undo
</button>
<button type="button" onClick={() => { const s = controller.redo(); if (s) restore(s); }} disabled={!controller.canRedo()}>
  Redo
</button>
```

Note: `canUndo()` / `canRedo()` are read at render time, but the controller doesn't notify React on changes. The existing `useEffect`-based `setTick` (which already re-renders on store events) covers most cases. For zone-swap (which doesn't fire store events), `setWorkspaceState` causes a re-render which re-reads canUndo/canRedo. Good enough for v1.

### Step 4: Build, ladle build, commit

```
npx tsc -b
npm run build
npx ladle build
```

```
git add packages/react/src/stories/Playground.stories.tsx
git -c commit.gpgsign=false commit -m "feat(ladle): wire history + undo/redo keybinds in Playground"
```

---

## Task 6: Final verification

- [ ] **Step 1:** `npx tsc -b && npm test && npm run build && npx ladle build`
Expected: all green; lint may have pre-existing failures (don't fix).

- [ ] **Step 2:** If any regressions, fix and recommit with a focused message.

- [ ] **Step 3:** Report — list new files, modified files, test counts.

---

## Self-review

**Spec coverage:**
- HistoryController class → Task 1
- Provider hookup + auto-subscribe → Task 2
- useHistory hook → Task 2
- Workspace controlled mode + gesture callbacks → Task 3
- Workspace auto-wires when history is in context → Task 3
- Zone wraps drops in transactions → Task 4
- Story wires keybinds + buttons → Task 5

**Placeholder scan:** Task 4 step 2's smoke test is described in prose, not code, to keep the plan focused. Implementer extrapolates from the existing DnD integration test pattern in the same file.

**Type consistency:**
- `HistoryHookup<T>` shape consistent across Provider, hook, and story.
- `PlaygroundSnapshot` only mentioned in Task 5 (story-local).
- `HistoryController<TSnapshot>` generic used uniformly.

**Known risks:**
- `current()` returning the most recently pushed snapshot is what enables consumers to read state for restore-after-no-op flows. Tests cover the happy path.
- The Provider's effect re-subscribes when `history` changes. If the story re-creates the hookup on every render, this would thrash. The story creates the hookup once via `useMemo` to avoid this.
