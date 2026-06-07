# DnD UX revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cursor-following drag ghost, live reflow of drop targets that previews the prospective post-drop layout, and positional rejection feedback — all driven by an expanded `DragController` state and a `preview`-aware `LayoutStrategy` interface.

**Architecture:** Pointer events feed an rAF-throttled `updateHoverByPoint` on `DragController`, which records `{ targetId, accepted, insertIndex, cursor }`. `Container` subscribes to drag state and, when hovered + accepted, calls the strategy with a `preview` field so the strategy lays out as if the source were inserted at the cursor; the source's real chrome is suppressed during preview and instead rendered as a portal-mounted ghost by `DragProvider`. Rejection bails out of preview and reverts to the real layout while the ghost shows a `not-allowed` cue.

**Tech Stack:** React 19, TypeScript, Vitest + React Testing Library, `requestAnimationFrame` for throttling, `createPortal` for the ghost.

**Spec:** `docs/superpowers/specs/2026-06-07-dnd-ux-revamp-design.md`

---

## File map

### Create

- `src/react/dnd/defaultDragOverlay.tsx` — default cursor-following ghost component.
- `src/react/dnd/dragOverlay.test.tsx` — overlay rendering / rejection tests.
- `src/react/dnd/livePreview.test.tsx` — Container reflow + fast-path tests.
- `src/react/dnd/insertionIndex.ts` — main-axis insertion-index helpers used by `Container` when consumers don't override.

### Modify

- `src/layout-types.ts` — extend `LayoutInput`/`LayoutResult`/`LayoutStrategy` for preview.
- `src/layout-node-adapter.ts` — thread an optional `preview` through `runStrategyForContainer`.
- `src/layout/stack.ts`, `src/layout/strip.ts`, `src/layout/grid.ts`, `src/layout/split.ts` — implement preview branch in `.layout()`; grid gets an additional `getDropPreview` fast path.
- `src/layout/stack.test.ts`, `src/layout/strip.test.ts`, `src/layout/grid.test.ts`, `src/layout/split.test.ts` — preview tests per strategy.
- `src/react/dnd/DragController.ts` — extended `DragState.hover`; rAF-throttled `updateHoverByPoint`; `getInsertionIndex` registration; `drop()` passes `insertIndex`.
- `src/react/dnd/DragController.test.ts` — throttling, cursor coords, insertIndex-on-drop.
- `src/react/dnd/useDropTarget.ts` — options gain `getInsertionIndex?`; threaded to controller.
- `src/react/dnd/DragProvider.tsx` — accept `dragOverlay` prop; portal-render the ghost.
- `src/react/useContainerLayout.ts` — accept optional `preview` parameter, thread to strategy + adapter.
- `src/react/Container.tsx` — subscribe to drag state; compute preview; suppress source's real chrome during preview; default `getInsertionIndex`.
- `src/react/presets.tsx` — `<Zone>`'s layout-providing path subscribes too (via `useContainerLayout`).
- `src/index.ts` / `src/react/index.ts` — export `defaultDragOverlay`, `DragOverlayRenderer`.
- `src/react/stories/Playground.stories.tsx` / `DeclarativePlayground.stories.tsx` — opt into `dragOverlay`.
- `package.json` — bump to `0.5.0`.

---

### Task 1: Extend layout types — `preview` input + `isPreview` flag + `getDropPreview` hook

The strategy interface is the contract everything else hangs off. Land it first so subsequent tasks compile against the real shapes.

**Files:**
- Modify: `/Users/mike/src/windease/src/layout-types.ts`

- [ ] **Step 1: Add `LayoutPreview` type and extend `LayoutResult`**

Open `/Users/mike/src/windease/src/layout-types.ts`. Just above the existing `LayoutResult` interface, add:

```ts
/**
 * Optional "preview" hint passed into `LayoutStrategy.layout()` when the host
 * (e.g. `<Container>`) is showing a live drop preview. The strategy should lay
 * out as if `insertId` were inserted at the cursor (or at `insertIndex` when
 * the host knows the prospective slot). Cursor is in container-relative coords.
 *
 * Strategies that ignore this field still work — the preview just falls back
 * to the real layout.
 */
export interface LayoutPreview {
  insertId: string;
  insertIndex?: number;
  cursor: { x: number; y: number };
}
```

Then change `LayoutResult` to add the optional `isPreview` flag:

```ts
export interface LayoutResult<TId extends string = string, TMeta = unknown> {
  placements: Map<TId, Rect>;
  affordances: Affordance<TMeta>[];
  /**
   * Items the strategy chose not to place (e.g. grid overflow when capacity
   * is capped). Consumers may render these in an overflow tray or hide them.
   */
  unplaced?: TId[];
  /**
   * True when this result was produced in response to a `preview` input and
   * the strategy honored it. `<Container>` uses this to know whether to
   * suppress the source's real chrome (it's rendered as the ghost instead).
   */
  isPreview?: boolean;
}
```

- [ ] **Step 2: Extend the `LayoutStrategy.layout` input and add `getDropPreview`**

Replace the existing `LayoutStrategy` interface (currently ending with `canAccept?`) with:

```ts
export interface LayoutStrategy<
  TState = void,
  TId extends string = string,
  TMeta = unknown,
> {
  name: string;
  initialState?(items: LayoutItem[]): TState;
  layout(input: {
    items: LayoutItem[];
    container: Size;
    state: TState;
    options: Record<string, unknown>;
    /**
     * When set, the strategy should lay out as if `preview.insertId` were
     * inserted at `preview.insertIndex` (or at the cursor when index is
     * undefined). The strategy MAY ignore this and return the regular
     * layout — the host falls back gracefully. When honored, set
     * `result.isPreview = true`.
     */
    preview?: LayoutPreview;
  }): LayoutResult<TId, TMeta>;
  reduce?(
    state: TState,
    event: LayoutEvent,
    context: { container: Size; options: Record<string, unknown>; items: LayoutItem[] },
  ): TState;
  /**
   * Optional hook used by DnD to reject drops the strategy can't lay out.
   * Receives the prospective post-drop items list. Return false to reject.
   * Strategies that don't implement it are treated as accept-all.
   */
  canAccept?(items: LayoutItem[], options: Record<string, unknown>): boolean;
  /**
   * Optional fast-path preview. When defined and returns non-null, the host
   * uses this instead of calling `.layout({ preview })`. Useful when preview
   * placements are cheap to compute directly (e.g. grid cells given an index).
   * Return null to delegate to the canonical `.layout()` path.
   */
  getDropPreview?(input: {
    items: LayoutItem[];
    container: Size;
    options: Record<string, unknown>;
    insertId: TId;
    insertIndex: number | undefined;
    cursor: { x: number; y: number };
  }): { placements: Map<TId, Rect>; accepted: boolean } | null;
}
```

- [ ] **Step 3: Build to confirm the type extension is backwards-compatible**

```bash
cd /Users/mike/src/windease && npx tsc --noEmit
```

Expected: PASS. Existing strategies don't pass `preview`, don't implement `getDropPreview`, and don't set `isPreview` — all the additions are optional.

- [ ] **Step 4: Commit**

```bash
cd /Users/mike/src/windease && git add src/layout-types.ts && git commit -m "$(cat <<'EOF'
feat(layout-types): add preview hint to LayoutStrategy

Optional LayoutPreview input on `.layout()`, optional `isPreview` flag on
LayoutResult, and optional `getDropPreview` fast-path method. All
additive — existing strategies and consumers compile unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Thread `preview` through `runStrategyForContainer`

The adapter that calls strategies on behalf of `Container` needs to forward the new field.

**Files:**
- Modify: `/Users/mike/src/windease/src/layout-node-adapter.ts`

- [ ] **Step 1: Extend `runStrategyForContainer` signature**

In `src/layout-node-adapter.ts`, replace the existing `runStrategyForContainer` with:

```ts
export function runStrategyForContainer<TState>(
  store: Store,
  parentId: NodeId,
  viewport: Size,
  strategy: LayoutStrategy<TState, string, unknown>,
  state: TState,
  preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } },
): LayoutResult<NodeId, unknown> {
  const parent = store.getNode(parentId);
  const config = (parent?.container?.config ?? {}) as Record<string, unknown>;
  const children = store.getChildren(parentId);
  const items: LayoutItem[] = [];
  for (const child of children) {
    if (child.lifecycle.state === 'hidden' || child.lifecycle.state === 'destroyed') continue;
    items.push(nodeToLayoutItem(child));
  }
  // When previewing an insert, splice the source in at the requested index
  // (or append) so strategies that don't read `preview` still get the right
  // item count. We pass `preview` through so strategies that DO read it can
  // use the cursor for sub-index positioning.
  if (preview) {
    const alreadyPresent = items.some((it) => it.id === preview.insertId);
    if (!alreadyPresent) {
      const ghostItem: LayoutItem = { id: preview.insertId };
      if (preview.insertIndex !== undefined && preview.insertIndex >= 0 && preview.insertIndex <= items.length) {
        items.splice(preview.insertIndex, 0, ghostItem);
      } else {
        items.push(ghostItem);
      }
    } else if (preview.insertIndex !== undefined) {
      // Same-parent reorder: move the existing entry to the preview index.
      const from = items.findIndex((it) => it.id === preview.insertId);
      const [picked] = items.splice(from, 1);
      const to = Math.max(0, Math.min(items.length, preview.insertIndex));
      items.splice(to, 0, picked!);
    }
  }
  const input: {
    items: LayoutItem[];
    container: Size;
    state: TState;
    options: Record<string, unknown>;
    preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } };
  } = { items, container: viewport, state, options: config };
  if (preview) input.preview = preview;
  const result = strategy.layout(input);
  return result as LayoutResult<NodeId, unknown>;
}
```

- [ ] **Step 2: Add a focused test for the adapter**

Create `/Users/mike/src/windease/src/layout-node-adapter.preview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Store } from './store.js';
import { createPanel, createZone } from './node-factories.js';
import { runStrategyForContainer } from './layout-node-adapter.js';
import { stackStrategy } from './layout/stack.js';

describe('runStrategyForContainer — preview', () => {
  it('splices the insertId at insertIndex when previewing', () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createPanel({ id: 'a', parentId: 'z' }));
    store.registerNode(createPanel({ id: 'b', parentId: 'z' }));
    const result = runStrategyForContainer(store, 'z', { w: 100, h: 300 }, stackStrategy, undefined, {
      insertId: 'ghost',
      insertIndex: 1,
      cursor: { x: 50, y: 100 },
    });
    // 3 placements: a, ghost, b (in that order)
    expect(Array.from(result.placements.keys())).toEqual(['a', 'ghost', 'b']);
  });

  it('appends the insertId when insertIndex is undefined', () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createPanel({ id: 'a', parentId: 'z' }));
    const result = runStrategyForContainer(store, 'z', { w: 100, h: 200 }, stackStrategy, undefined, {
      insertId: 'ghost',
      cursor: { x: 50, y: 50 },
    });
    expect(Array.from(result.placements.keys())).toEqual(['a', 'ghost']);
  });

  it('reorders existing source for same-parent preview', () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createPanel({ id: 'a', parentId: 'z' }));
    store.registerNode(createPanel({ id: 'b', parentId: 'z' }));
    store.registerNode(createPanel({ id: 'c', parentId: 'z' }));
    const result = runStrategyForContainer(store, 'z', { w: 100, h: 300 }, stackStrategy, undefined, {
      insertId: 'a',
      insertIndex: 2,
      cursor: { x: 50, y: 200 },
    });
    expect(Array.from(result.placements.keys())).toEqual(['b', 'c', 'a']);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/layout-node-adapter.preview.test.ts
```

Expected: 3 PASS.

- [ ] **Step 4: Run full suite to confirm no regressions**

```bash
cd /Users/mike/src/windease && npm test
```

Expected: 234 + 3 = 237 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/windease && git add src/layout-node-adapter.ts src/layout-node-adapter.preview.test.ts && git commit -m "$(cat <<'EOF'
feat(layout-adapter): thread preview through runStrategyForContainer

Splices the preview insertId into the items list at the requested index
(or appends) so even strategies that don't read `preview` see the right
item count. Same-parent previews reorder the existing entry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: rAF-throttle `updateHoverByPoint` + extend `DragState.hover`

The controller is the source of truth for drag state. Coalesce pointer events to one update per frame, and grow `hover` to carry `insertIndex` + `cursor`.

**Files:**
- Modify: `/Users/mike/src/windease/src/react/dnd/DragController.ts`
- Modify: `/Users/mike/src/windease/src/react/dnd/DragController.test.ts`

- [ ] **Step 1: Write the failing tests first**

Append to `/Users/mike/src/windease/src/react/dnd/DragController.test.ts`:

```ts
describe('DragController — rAF throttle + cursor', () => {
  it('coalesces multiple updateHoverByPoint calls within one frame', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createPanel({ id: 'src', parentId: 'z' }));
    store.registerNode(createPanel({ id: 'tgt', parentId: 'z' }));
    const controller = new DragController(store);

    const el = makeRectEl({ left: 0, top: 0, right: 100, bottom: 100 });
    controller.registerDropTarget('tgt', el);
    controller.tryBegin('src');

    const listener = vi.fn();
    controller.subscribe(listener);
    listener.mockClear();

    controller.updateHoverByPoint(10, 10);
    controller.updateHoverByPoint(20, 20);
    controller.updateHoverByPoint(30, 30);

    // Drain the rAF queue.
    await new Promise((r) => setTimeout(r, 20));

    // Only one hover update emitted (the latest), not three.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.state()?.hover?.cursor).toEqual({ x: 30, y: 30 });
  });

  it('cancels pending rAF on drop()', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createPanel({ id: 'src', parentId: 'z' }));
    store.registerNode(createPanel({ id: 'tgt', parentId: 'z' }));
    const controller = new DragController(store);
    controller.registerDropTarget('tgt', makeRectEl({ left: 0, top: 0, right: 100, bottom: 100 }));
    controller.tryBegin('src');

    controller.updateHoverByPoint(10, 10);
    controller.drop();
    await new Promise((r) => setTimeout(r, 20));
    // After drop, controller.active is null; no late hover update should
    // reintroduce state.
    expect(controller.state()).toBeNull();
  });

  it('drop() passes hover.insertIndex to moveNode', () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'src-parent' }));
    store.registerNode(createZone({ id: 'tgt' }));
    store.registerNode(createPanel({ id: 'src', parentId: 'src-parent' }));
    store.registerNode(createPanel({ id: 'a', parentId: 'tgt' }));
    store.registerNode(createPanel({ id: 'b', parentId: 'tgt' }));
    const moveSpy = vi.spyOn(store, 'moveNode');
    const controller = new DragController(store);
    controller.registerDropTarget('tgt', makeRectEl({ left: 0, top: 0, right: 100, bottom: 100 }), undefined, {
      getInsertionIndex: () => 1,
    });
    controller.tryBegin('src');
    controller.updateHoverByPoint(50, 50);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        controller.drop();
        expect(moveSpy).toHaveBeenCalledWith('src', 'tgt', 1);
        resolve();
      }, 20);
    });
  });
});

function makeRectEl(rect: { left: number; top: number; right: number; bottom: number }): Element {
  return {
    getBoundingClientRect: () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top, toJSON() {} }),
    setAttribute() {},
    removeAttribute() {},
    parentElement: null,
  } as unknown as Element;
}
```

At the top of the file ensure these imports exist (add the ones missing):

```ts
import { describe, expect, it, vi } from 'vitest';
import { Store } from '../../store.js';
import { createPanel, createZone } from '../../node-factories.js';
import { DragController } from './DragController.js';
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/DragController.test.ts
```

Expected: the three new cases FAIL (no `cursor` on hover; `registerDropTarget` doesn't accept a 4th arg; drop doesn't pass index).

- [ ] **Step 3: Update `DragController.ts`**

Open `/Users/mike/src/windease/src/react/dnd/DragController.ts`. Make these edits:

a) Replace the `DragState` interface:

```ts
export interface DragState {
  draggingId: NodeId;
  hover: {
    targetId: NodeId;
    accepted: boolean;
    /** 0-based prospective insertion index. Undefined when the strategy
     *  gives no positional answer (e.g. splits) or when the target didn't
     *  register a `getInsertionIndex`. */
    insertIndex?: number;
    /** Cursor in viewport coords. Used by `<DragProvider>` to position the
     *  ghost overlay. */
    cursor: { x: number; y: number };
  } | null;
}
```

b) Add `getInsertionIndex` to drop-target registration:

```ts
export interface DropTargetOptions {
  /** Map cursor (viewport coords) → prospective insertion index (0-based).
   *  Return undefined to leave `insertIndex` unset. */
  getInsertionIndex?: (point: { x: number; y: number }) => number | undefined;
}
```

Update the `dropTargets` map type and `registerDropTarget` signature:

```ts
private readonly dropTargets = new Map<
  NodeId,
  {
    el: Element;
    canAccept?: (sourceId: NodeId) => boolean;
    getInsertionIndex?: (point: { x: number; y: number }) => number | undefined;
  }
>();

registerDropTarget(
  id: NodeId,
  el: Element,
  canAccept?: (sourceId: NodeId) => boolean,
  options?: DropTargetOptions,
): () => void {
  const value: {
    el: Element;
    canAccept?: (sourceId: NodeId) => boolean;
    getInsertionIndex?: (point: { x: number; y: number }) => number | undefined;
  } = { el };
  if (canAccept) value.canAccept = canAccept;
  if (options?.getInsertionIndex) value.getInsertionIndex = options.getInsertionIndex;
  this.dropTargets.set(id, value);
  return () => {
    this.dropTargets.delete(id);
  };
}
```

c) Add rAF throttling to `updateHoverByPoint`. Add two private fields near `escapeBound`:

```ts
private pendingPoint: { x: number; y: number } | null = null;
private rafId: number | null = null;
```

Replace the existing `updateHoverByPoint` body and add a private `actuallyUpdateHover`:

```ts
updateHoverByPoint(x: number, y: number): void {
  if (!this.active) return;
  this.pendingPoint = { x, y };
  if (this.rafId !== null) return;
  const raf = typeof requestAnimationFrame !== 'undefined'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  this.rafId = raf(() => {
    this.rafId = null;
    if (!this.pendingPoint || !this.active) return;
    const p = this.pendingPoint;
    this.pendingPoint = null;
    this.actuallyUpdateHover(p.x, p.y);
  });
}

private actuallyUpdateHover(x: number, y: number): void {
  if (!this.active) return;
  let best: { id: NodeId; depth: number } | null = null;
  for (const [id, { el }] of this.dropTargets) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const depth = ancestorDepth(el);
    if (!best || depth > best.depth) best = { id, depth };
  }
  if (!best) {
    this.setHover(null, { x, y });
    return;
  }
  const reg = this.dropTargets.get(best.id);
  const insertIndex = reg?.getInsertionIndex?.({ x, y });
  const accepted = this.checkAccept(best.id, insertIndex);
  this.setHover({ targetId: best.id, accepted, insertIndex, cursor: { x, y } }, { x, y });
}
```

d) Update `checkAccept` to accept an optional `insertIndex` (currently it doesn't use it but the signature accepts it for future strategy hooks):

```ts
private checkAccept(targetId: NodeId, _insertIndex: number | undefined): boolean {
  if (!this.active) return false;
  const draggingId = this.active.draggingId;
  if (targetId === draggingId) return false;
  // ...existing body unchanged...
}
```

e) Replace `setHover` to absorb the new shape and always carry `cursor`:

```ts
private setHover(
  hover: Omit<NonNullable<DragState['hover']>, 'cursor'> & { cursor?: { x: number; y: number } } | null,
  cursor: { x: number; y: number },
): void {
  if (!this.active) return;
  const next: DragState['hover'] = hover
    ? {
        targetId: hover.targetId,
        accepted: hover.accepted,
        cursor: hover.cursor ?? cursor,
        ...(hover.insertIndex !== undefined ? { insertIndex: hover.insertIndex } : {}),
      }
    : null;
  if (sameHover(this.active.hover, next)) return;
  const previous = this.active.hover;
  this.active = { ...this.active, hover: next };
  this.reflectHoverToDom(previous, next);
  if (next) {
    trace('dnd', `hover: target=${next.targetId} accepted=${next.accepted} insertIndex=${next.insertIndex ?? '-'}`);
  }
  this.emit();
}
```

f) Update `sameHover`:

```ts
function sameHover(a: DragState['hover'], b: DragState['hover']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.targetId === b.targetId &&
    a.accepted === b.accepted &&
    a.insertIndex === b.insertIndex &&
    a.cursor.x === b.cursor.x &&
    a.cursor.y === b.cursor.y
  );
}
```

g) Update `drop()` to pass `insertIndex` and to cancel any pending rAF first:

```ts
drop(): void {
  if (!this.active) return;
  this.cancelPendingRaf();
  const { draggingId, hover } = this.active;
  if (!hover || !hover.accepted) {
    this.cancel(hover ? 'rejected' : 'outside');
    return;
  }
  try {
    this.store.moveNode(draggingId, hover.targetId, hover.insertIndex);
    trace('dnd', `drop: ${draggingId} → ${hover.targetId}@${hover.insertIndex ?? 'append'}`);
  } catch (err) {
    trace('dnd', `drop failed: ${(err as Error).message}`);
  }
  this.clear();
}
```

h) Update `cancel()` and `clear()` to drain pending rAF:

```ts
cancel(reason: DragCancelReason = 'outside'): void {
  if (!this.active) return;
  this.cancelPendingRaf();
  trace('dnd', `cancel: ${this.active.draggingId} reason=${reason}`);
  this.clear();
}

private cancelPendingRaf(): void {
  if (this.rafId !== null) {
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
  this.pendingPoint = null;
}
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/DragController.test.ts
```

Expected: all cases PASS (existing + 3 new).

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/mike/src/windease && npm test
```

Expected: green. Existing call sites of `registerDropTarget(id, el, canAccept)` still work because the 4th arg is optional.

- [ ] **Step 6: Commit**

```bash
cd /Users/mike/src/windease && git add src/react/dnd/DragController.ts src/react/dnd/DragController.test.ts && git commit -m "$(cat <<'EOF'
feat(dnd): rAF throttle + insertIndex + cursor on DragState

updateHoverByPoint coalesces multiple calls per frame (last-point wins);
DragState.hover now carries insertIndex and cursor; registerDropTarget
accepts a getInsertionIndex callback; drop() passes insertIndex through
to store.moveNode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `useDropTarget` — accept `getInsertionIndex` option

**Files:**
- Modify: `/Users/mike/src/windease/src/react/dnd/useDropTarget.ts`

- [ ] **Step 1: Extend the options interface**

In `src/react/dnd/useDropTarget.ts`, edit `UseDropTargetOptions`:

```ts
export interface UseDropTargetOptions {
  /** Predicate to reject specific sources (e.g. forbid drops from outside a
   *  particular sub-tree). */
  canAccept?: (sourceId: NodeId) => boolean;
  /** When false, skip registration. Useful for opt-in props on declarative
   *  presets where the hook must be called unconditionally to preserve hook
   *  order, but registration should depend on a runtime flag. Defaults to
   *  true. */
  enabled?: boolean;
  /** Map a cursor point (viewport coords) to a prospective insertion index in
   *  the target's childOrder. Returning undefined leaves `insertIndex` unset
   *  on the drag state (the strategy then falls back to "append"). */
  getInsertionIndex?: (point: { x: number; y: number }) => number | undefined;
}
```

- [ ] **Step 2: Thread the option through to the controller**

Update the destructure and the effect:

```ts
const { canAccept, enabled, getInsertionIndex } = opts;
// ... existing controller resolution ...
useEffect(() => {
  if (enabled === false) return;
  if (!controller) return;
  const el = ref.current;
  if (!el) return;
  return controller.registerDropTarget(
    nodeId,
    el,
    canAccept,
    getInsertionIndex ? { getInsertionIndex } : undefined,
  );
}, [controller, nodeId, ref, enabled, canAccept, getInsertionIndex]);
```

- [ ] **Step 3: Add a quick test**

Create `/Users/mike/src/windease/src/react/dnd/useDropTarget.insertionIndex.test.tsx`:

```tsx
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { Provider } from '../Provider.js';
import { Store } from '../../store.js';
import { createPanel, createZone } from '../../node-factories.js';
import { DragProvider, useDragController } from './DragProvider.js';
import { useDropTarget } from './useDropTarget.js';

afterEach(cleanup);

function Target({ nodeId, onIndex }: { nodeId: string; onIndex: (p: { x: number; y: number }) => number | undefined }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDropTarget(nodeId, ref, { getInsertionIndex: onIndex });
  return <div ref={ref} data-testid={nodeId} style={{ width: 100, height: 100 }} />;
}

function ControllerCapture({ onReady }: { onReady: (c: ReturnType<typeof useDragController>) => void }) {
  const c = useDragController();
  onReady(c);
  return null;
}

describe('useDropTarget — getInsertionIndex', () => {
  it('passes the insertion index callback through to DragController', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createPanel({ id: 'src', parentId: 'z' }));
    store.registerNode(createPanel({ id: 'tgt', parentId: 'z' }));
    const spy = vi.fn(() => 7);
    let controller: ReturnType<typeof useDragController> | null = null;
    render(
      <Provider store={store}>
        <DragProvider>
          <ControllerCapture onReady={(c) => (controller = c)} />
          <Target nodeId="tgt" onIndex={spy} />
        </DragProvider>
      </Provider>,
    );
    expect(controller).not.toBeNull();
    controller!.tryBegin('src');
    controller!.updateHoverByPoint(10, 10);
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalled();
    expect(controller!.state()?.hover?.insertIndex).toBe(7);
  });
});
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/useDropTarget.insertionIndex.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/windease && git add src/react/dnd/useDropTarget.ts src/react/dnd/useDropTarget.insertionIndex.test.tsx && git commit -m "$(cat <<'EOF'
feat(dnd): useDropTarget accepts getInsertionIndex option

Threads the cursor→index callback through to DragController so hover
state carries insertIndex.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Stack strategy preview

**Files:**
- Modify: `/Users/mike/src/windease/src/layout/stack.ts`
- Modify: `/Users/mike/src/windease/src/layout/stack.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/Users/mike/src/windease/src/layout/stack.test.ts`:

```ts
describe('stackStrategy — preview', () => {
  it('marks isPreview=true when preview is set', () => {
    const result = stackStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 100, h: 300 },
      state: undefined,
      options: {},
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 50, y: 100 } },
    });
    expect(result.isPreview).toBe(true);
    expect(result.placements.has('ghost')).toBe(true);
  });

  it('places the ghost between siblings (insertIndex=1 of 3)', () => {
    const result = stackStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 100, h: 300 },
      state: undefined,
      options: {},
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 50, y: 100 } },
    });
    const a = result.placements.get('a')!;
    const ghost = result.placements.get('ghost')!;
    const b = result.placements.get('b')!;
    expect(a.y).toBeLessThan(ghost.y);
    expect(ghost.y).toBeLessThan(b.y);
  });

  it('produces no isPreview flag when preview is absent', () => {
    const result = stackStrategy.layout({
      items: [{ id: 'a' }],
      container: { w: 100, h: 100 },
      state: undefined,
      options: {},
    });
    expect(result.isPreview).toBeUndefined();
  });
});
```

- [ ] **Step 2: Confirm it fails**

```bash
cd /Users/mike/src/windease && npx vitest run src/layout/stack.test.ts
```

Expected: the two preview cases FAIL (`isPreview` is undefined).

- [ ] **Step 3: Implement preview in `stack.ts`**

In `src/layout/stack.ts`, update the strategy signature and the return:

```ts
export const stackStrategy: LayoutStrategy<void, string> = {
  name: 'stack',
  layout({
    items,
    container,
    options,
    preview,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
    preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } };
  }): LayoutResult<string> {
    const cfg = options as StackConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) {
      const empty: LayoutResult<string> = { placements, affordances: [] };
      if (preview) empty.isPreview = true;
      return empty;
    }

    const colX = padding;
    const colW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding - gap * (items.length - 1);

    const fill = cfg.fill ?? true;
    const defaultItemSize = cfg.defaultItemSize ?? 0;
    const preferredH = items.map((item) => item.hints?.preferredSize?.h ?? 0);
    const totalPreferred = preferredH.reduce((sum, h) => sum + h, 0);
    const flexCount = preferredH.filter((h) => h === 0).length;
    const flexH = fill && flexCount > 0 ? Math.max(0, (usableH - totalPreferred) / flexCount) : 0;
    const fallbackH = fill ? flexH : defaultItemSize;

    let y = padding;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const h = preferredH[i]! > 0 ? preferredH[i]! : fallbackH;
      placements.set(item.id, { x: colX, y, w: colW, h });
      y += h + gap;
    }
    const result: LayoutResult<string> = { placements, affordances: [] };
    if (preview) result.isPreview = true;
    return result;
  },
};
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/layout/stack.test.ts
```

Expected: all stack tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/windease && git add src/layout/stack.ts src/layout/stack.test.ts && git commit -m "$(cat <<'EOF'
feat(stack): mark isPreview when preview input is present

The host pre-splices the source via runStrategyForContainer; stack just
needs to stamp the result so Container knows to suppress the source's
real chrome.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Strip strategy preview

**Files:**
- Modify: `/Users/mike/src/windease/src/layout/strip.ts`
- Modify: `/Users/mike/src/windease/src/layout/strip.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/Users/mike/src/windease/src/layout/strip.test.ts`:

```ts
describe('stripStrategy — preview', () => {
  it('places the ghost between siblings on the x axis (insertIndex=1 of 3)', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 300, h: 100 },
      state: undefined,
      options: { fill: true },
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 150, y: 50 } },
    });
    expect(result.isPreview).toBe(true);
    const a = result.placements.get('a')!;
    const ghost = result.placements.get('ghost')!;
    const b = result.placements.get('b')!;
    expect(a.x).toBeLessThan(ghost.x);
    expect(ghost.x).toBeLessThan(b.x);
  });

  it('places the ghost between siblings on the y axis when axis=y', () => {
    const result = stripStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }],
      container: { w: 100, h: 200 },
      state: undefined,
      options: { axis: 'y', fill: true },
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 50, y: 150 } },
    });
    const a = result.placements.get('a')!;
    const ghost = result.placements.get('ghost')!;
    expect(ghost.y).toBeGreaterThan(a.y);
    expect(result.isPreview).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm it fails**

```bash
cd /Users/mike/src/windease && npx vitest run src/layout/strip.test.ts
```

Expected: the two preview cases FAIL.

- [ ] **Step 3: Implement preview in `strip.ts`**

In `src/layout/strip.ts`, update the strategy to read `preview` and stamp `isPreview`:

```ts
export const stripStrategy: LayoutStrategy<void, string> = {
  name: 'strip',
  layout({
    items,
    container,
    options,
    preview,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
    preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } };
  }): LayoutResult<string> {
    const cfg = options as StripConfig;
    const axis = cfg.axis ?? 'x';
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;
    const fill = cfg.fill ?? false;
    const defaultItemSize = cfg.defaultItemSize ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) {
      const empty: LayoutResult<string> = { placements, affordances: [] };
      if (preview) empty.isPreview = true;
      return empty;
    }

    const main = axis === 'x' ? container.w : container.h;
    const preferred = items.map((item) =>
      axis === 'x' ? (item.hints?.preferredSize?.w ?? 0) : (item.hints?.preferredSize?.h ?? 0),
    );
    const totalPreferred = preferred.reduce((sum, v) => sum + v, 0);
    const flexCount = preferred.filter((v) => v === 0).length;
    const usableMain = main - 2 * padding - gap * (items.length - 1);
    const flexMain = fill && flexCount > 0 ? Math.max(0, (usableMain - totalPreferred) / flexCount) : 0;
    const fallbackMain = fill ? flexMain : defaultItemSize;

    if (axis === 'x') {
      const y = padding;
      const h = container.h - 2 * padding;
      let x = padding;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const w = preferred[i]! > 0 ? preferred[i]! : fallbackMain;
        placements.set(item.id, { x, y, w, h });
        x += w + gap;
      }
    } else {
      const x = padding;
      const w = container.w - 2 * padding;
      let y = padding;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const h = preferred[i]! > 0 ? preferred[i]! : fallbackMain;
        placements.set(item.id, { x, y, w, h });
        y += h + gap;
      }
    }
    const result: LayoutResult<string> = { placements, affordances: [] };
    if (preview) result.isPreview = true;
    return result;
  },
};
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/layout/strip.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/windease && git add src/layout/strip.ts src/layout/strip.test.ts && git commit -m "$(cat <<'EOF'
feat(strip): mark isPreview when preview input is present

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Grid strategy preview + `getDropPreview` fast path

**Files:**
- Modify: `/Users/mike/src/windease/src/layout/grid.ts`
- Modify: `/Users/mike/src/windease/src/layout/grid.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/Users/mike/src/windease/src/layout/grid.test.ts`:

```ts
describe('gridStrategy — preview', () => {
  it('marks isPreview=true when preview is set on layout()', () => {
    const result = gridStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }, { id: 'b' }],
      container: { w: 300, h: 200 },
      state: undefined,
      options: { cols: 3 },
      preview: { insertId: 'ghost', insertIndex: 1, cursor: { x: 150, y: 100 } },
    });
    expect(result.isPreview).toBe(true);
    expect(result.placements.get('ghost')).toBeDefined();
  });

  it('getDropPreview returns placements that include the insertId', () => {
    const out = gridStrategy.getDropPreview!({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 200 },
      options: { cols: 2 },
      insertId: 'ghost',
      insertIndex: 1,
      cursor: { x: 100, y: 50 },
    });
    expect(out).not.toBeNull();
    expect(out!.accepted).toBe(true);
    expect(out!.placements.has('ghost')).toBe(true);
  });

  it('getDropPreview returns accepted=false when it would overflow maxItems', () => {
    const out = gridStrategy.getDropPreview!({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 200 },
      options: { maxItems: 2 },
      insertId: 'ghost',
      insertIndex: 2,
      cursor: { x: 100, y: 50 },
    });
    expect(out).not.toBeNull();
    expect(out!.accepted).toBe(false);
  });
});
```

- [ ] **Step 2: Confirm it fails**

```bash
cd /Users/mike/src/windease && npx vitest run src/layout/grid.test.ts
```

Expected: 3 new cases FAIL (`getDropPreview` undefined; `isPreview` undefined).

- [ ] **Step 3: Implement preview + fast path in `grid.ts`**

In `src/layout/grid.ts`, change the strategy signature to read `preview`, stamp `isPreview`, and add a `getDropPreview` method. Replace the `gridStrategy` export with:

```ts
export const gridStrategy: LayoutStrategy<void, string> = {
  name: 'grid',
  canAccept(items, options): boolean {
    const cap = gridCapacity(options as GridConfig, items.length);
    return items.length <= cap;
  },
  getDropPreview({ items, container, options, insertId, insertIndex, cursor: _cursor }) {
    const cfg = options as GridConfig;
    // Splice ghost in if not already present.
    const ghostAt = items.findIndex((it) => it.id === insertId);
    const projected: LayoutItem[] =
      ghostAt >= 0
        ? items
        : insertIndex !== undefined && insertIndex >= 0 && insertIndex <= items.length
          ? [...items.slice(0, insertIndex), { id: insertId }, ...items.slice(insertIndex)]
          : [...items, { id: insertId }];
    const cap = gridCapacity(cfg, projected.length);
    if (projected.length > cap) {
      // Still produce placements (using normal layout) so the host can show
      // the rejection overlay against the current grid.
      const fallback = gridStrategy.layout({
        items,
        container,
        state: undefined,
        options,
      });
      return { placements: fallback.placements, accepted: false };
    }
    const lay = gridStrategy.layout({
      items: projected,
      container,
      state: undefined,
      options,
    });
    return { placements: lay.placements, accepted: true };
  },
  layout({
    items,
    container,
    options,
    preview,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
    preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } };
  }): LayoutResult<string> {
    const cfg = options as GridConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) {
      const empty: LayoutResult<string> = { placements, affordances: [] };
      if (preview) empty.isPreview = true;
      return empty;
    }

    const hasGridCap = cfg.maxCols !== undefined || cfg.maxRows !== undefined;
    if (cfg.maxItems !== undefined && hasGridCap) {
      throw new Error(
        'gridStrategy: maxItems is mutually exclusive with maxCols/maxRows',
      );
    }
    const maxCols = cfg.maxCols !== undefined ? Math.max(1, cfg.maxCols) : undefined;
    const maxRows = cfg.maxRows !== undefined ? Math.max(1, cfg.maxRows) : undefined;
    const fill = cfg.fill ?? true;

    let cols: number;
    let rowCap: number | undefined;
    if (cfg.cols !== undefined) {
      cols = Math.max(1, cfg.cols);
      rowCap = maxRows;
    } else if (cfg.rows !== undefined) {
      const fixedRows = Math.max(1, cfg.rows);
      if (fill) {
        const needed = Math.ceil(items.length / fixedRows);
        cols = maxCols !== undefined ? Math.min(maxCols, needed) : needed;
      } else {
        cols = maxCols ?? Math.max(1, Math.ceil(items.length / fixedRows));
      }
      cols = Math.max(1, cols);
      rowCap = fixedRows;
    } else if (!fill && maxCols !== undefined) {
      cols = maxCols;
      rowCap = maxRows;
    } else {
      const root = Math.sqrt(items.length);
      const ideal =
        (cfg.orientation ?? 'wide') === 'tall' ? Math.floor(root) || 1 : Math.ceil(root);
      cols = maxCols !== undefined ? Math.min(maxCols, ideal) : ideal;
      cols = Math.max(1, cols);
      rowCap = maxRows;
    }

    const gridCap = rowCap !== undefined ? cols * rowCap : Number.POSITIVE_INFINITY;
    const itemCap = cfg.maxItems !== undefined ? Math.max(1, cfg.maxItems) : Number.POSITIVE_INFINITY;
    const capacity = Math.min(gridCap, itemCap);
    const placedCount = Math.min(items.length, capacity);
    const rows =
      !fill && rowCap !== undefined
        ? rowCap
        : Math.max(1, Math.ceil(placedCount / cols));

    const usableW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding;
    const cellW = (usableW - gap * (cols - 1)) / cols;
    const cellH = (usableH - gap * (rows - 1)) / rows;

    for (let i = 0; i < placedCount; i++) {
      const item = items[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      placements.set(item.id, {
        x: padding + col * (cellW + gap),
        y: padding + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }

    const unplaced: string[] = [];
    for (let i = placedCount; i < items.length; i++) {
      unplaced.push(items[i]!.id);
    }

    const result: LayoutResult<string> = { placements, affordances: [] };
    if (unplaced.length > 0) result.unplaced = unplaced;
    if (preview) result.isPreview = true;
    return result;
  },
};
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/layout/grid.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/windease && git add src/layout/grid.ts src/layout/grid.test.ts && git commit -m "$(cat <<'EOF'
feat(grid): preview + getDropPreview fast path

layout({preview}) marks isPreview; new getDropPreview returns cheap
cell-based placements and `accepted: false` when the insert would
overflow the configured capacity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Split strategy preview

The split strategy is recursive; preview here means "bisect the pane the cursor is over with the ghost as the new sibling." For 0.5 we keep it simple: when preview is set, ensure the ghost item is in the items list (the adapter already splices it) and pass through; the split's tree manipulation handles the new pane.

**Files:**
- Modify: `/Users/mike/src/windease/src/layout/split.ts`
- Modify: `/Users/mike/src/windease/src/layout/split.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `/Users/mike/src/windease/src/layout/split.test.ts`:

```ts
describe('splitStrategy — preview', () => {
  it('marks isPreview=true on the result when preview is set', () => {
    // Two existing items + ghost = 3 (splitStrategy.canAccept rejects > 2,
    // but layout() should still run and stamp isPreview; the host uses
    // canAccept on its own to gate.)
    const result = splitStrategy.layout({
      items: [{ id: 'a' }, { id: 'ghost' }],
      container: { w: 200, h: 200 },
      state: splitStrategy.initialState!([{ id: 'a' }, { id: 'ghost' }]),
      options: { axis: 'x' },
      preview: { insertId: 'ghost', cursor: { x: 100, y: 100 } },
    });
    expect(result.isPreview).toBe(true);
    expect(result.placements.has('ghost')).toBe(true);
  });
});
```

- [ ] **Step 2: Confirm it fails**

```bash
cd /Users/mike/src/windease && npx vitest run src/layout/split.test.ts
```

Expected: the preview case FAILs (no `isPreview` flag).

- [ ] **Step 3: Implement preview in `split.ts`**

Locate the `layout` method on `splitStrategy` (around line 189). Update its destructure to accept `preview` and stamp the result.

Add `preview?` to the parameter type:

```ts
layout({ items, container, state, options, preview }: {
  items: LayoutItem[];
  container: Size;
  state: SplitNode;
  options: Record<string, unknown>;
  preview?: { insertId: string; insertIndex?: number; cursor: { x: number; y: number } };
}): LayoutResult<string, SplitMeta> {
```

Then, immediately before the existing `return` statement at the end of `layout`, stamp the flag. Find the line that returns the result and change it from:

```ts
return { placements, affordances };
```

to:

```ts
const result: LayoutResult<string, SplitMeta> = { placements, affordances };
if (preview) result.isPreview = true;
return result;
```

If the function has multiple return points, stamp each.

- [ ] **Step 4: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/layout/split.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/windease && git add src/layout/split.ts src/layout/split.test.ts && git commit -m "$(cat <<'EOF'
feat(split): mark isPreview when preview input is present

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `useContainerLayout` — accept optional `preview`

The hook is the single place `Container`, `Zone`, and any custom layout-driven view consult the strategy. Thread the optional argument through.

**Files:**
- Modify: `/Users/mike/src/windease/src/react/useContainerLayout.ts`

- [ ] **Step 1: Extend signature and call site**

Open `src/react/useContainerLayout.ts`. Replace the `useContainerLayout` function with:

```ts
export function useContainerLayout(
  parentId: NodeId,
  viewportRef: RefObject<Element | null> | null,
  fixedViewport?: { w: number; h: number },
  preview?: { insertId: NodeId; insertIndex?: number; cursor: { x: number; y: number } },
): ContainerLayout {
  const store = useStore();
  const node = useNode(parentId);
  const registry = useStrategyRegistry();
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    fixedViewport ?? null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on whether fixedViewport is provided, not its identity.
  useEffect(() => {
    if (fixedViewport) {
      setMeasured(fixedViewport);
      return;
    }
    if (!viewportRef?.current) return;
    const el = viewportRef.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setMeasured({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedViewport === undefined, viewportRef]);

  const viewport = fixedViewport ?? measured;

  const [stateTick, setStateTick] = useState(0);
  useEffect(() => {
    return store.events.on('container.stateChanged', (e) => {
      if (e.id === parentId) setStateTick((t) => t + 1);
    });
  }, [store, parentId]);

  const dispatchAffordance = useCallback<ContainerLayout['dispatchAffordance']>(
    (event) => {
      const container = node?.container;
      if (!container || !viewport) return;
      const strategy = registry.get(container.strategyId);
      if (!strategy?.reduce) return;
      const visibleChildren = store
        .getChildren(parentId)
        .filter((c) => c.lifecycle.state === 'visible')
        .map((c) => {
          const item: { id: string; hints?: { minSize?: { w: number; h: number } } } = { id: c.id };
          if (c.hints?.minSize) item.hints = { minSize: c.hints.minSize };
          return item;
        });
      const current =
        store.getContainerState(parentId) ??
        (strategy.initialState ? strategy.initialState(visibleChildren) : undefined);
      const next = strategy.reduce(current as never, event, {
        container: viewport,
        options: (container.config ?? {}) as Record<string, unknown>,
        items: visibleChildren,
      });
      if (next === current) return;
      store.setContainerState(parentId, next);
    },
    [store, parentId, node?.container, viewport, registry],
  );

  // Stabilize preview reference for the memo: identity changes only when its
  // fields change.
  const previewKey = preview
    ? `${preview.insertId}|${preview.insertIndex ?? '-'}|${preview.cursor.x}|${preview.cursor.y}`
    : '';

  const layout = useMemo<Omit<ContainerLayout, 'dispatchAffordance'>>(() => {
    if (!node?.container || !viewport) {
      return { placements: new Map(), affordances: [], unplaced: [], viewport };
    }
    const strategy = registry.get(node.container.strategyId);
    if (!strategy) {
      return { placements: new Map(), affordances: [], unplaced: [], viewport };
    }
    const persisted = store.getContainerState(parentId);
    const state =
      persisted ??
      (strategy.initialState
        ? strategy.initialState(
            store
              .getChildren(parentId)
              .filter((c) => c.lifecycle.state === 'visible')
              .map((c) => ({ id: c.id })),
          )
        : undefined);
    const result: LayoutResult<NodeId, unknown> = runStrategyForContainer(
      store,
      parentId,
      viewport,
      strategy,
      state as never,
      preview,
    );
    return {
      placements: result.placements,
      affordances: result.affordances,
      unplaced: result.unplaced ?? [],
      viewport,
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: stateTick is a re-run gate; previewKey is a stable identity for `preview`.
  }, [store, node?.container, viewport, registry, parentId, stateTick, previewKey]);

  return { ...layout, dispatchAffordance };
}
```

- [ ] **Step 2: Build + run existing tests to confirm no regressions**

```bash
cd /Users/mike/src/windease && npx tsc --noEmit && npm test
```

Expected: green; no test changes yet because no caller passes preview yet.

- [ ] **Step 3: Commit**

```bash
cd /Users/mike/src/windease && git add src/react/useContainerLayout.ts && git commit -m "$(cat <<'EOF'
feat(react): useContainerLayout accepts optional preview

Threads the preview hint into runStrategyForContainer. previewKey
serializes the preview fields so the layout memo invalidates only on
meaningful changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Insertion-index helpers — main-axis defaults

A small helper file so `Container` (and consumers writing their own preset zones) can compute insertion indices without rewriting the same midpoint math.

**Files:**
- Create: `/Users/mike/src/windease/src/react/dnd/insertionIndex.ts`
- Create: `/Users/mike/src/windease/src/react/dnd/insertionIndex.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/react/dnd/insertionIndex.test.ts
import { describe, expect, it } from 'vitest';
import { insertionIndexByMidpoint } from './insertionIndex.js';

describe('insertionIndexByMidpoint', () => {
  it('returns 0 when cursor is before the first child', () => {
    const rects = [
      { top: 100, bottom: 200 },
      { top: 200, bottom: 300 },
    ];
    expect(insertionIndexByMidpoint(rects, 50, 'y')).toBe(0);
  });

  it('returns N when cursor is after the last child', () => {
    const rects = [
      { top: 0, bottom: 100 },
      { top: 100, bottom: 200 },
    ];
    expect(insertionIndexByMidpoint(rects, 999, 'y')).toBe(2);
  });

  it('returns 1 when cursor is past the first child midpoint', () => {
    const rects = [
      { top: 0, bottom: 100 }, // midpoint y=50
      { top: 100, bottom: 200 }, // midpoint y=150
    ];
    expect(insertionIndexByMidpoint(rects, 51, 'y')).toBe(1);
    expect(insertionIndexByMidpoint(rects, 49, 'y')).toBe(0);
  });

  it('uses left/right when axis is x', () => {
    const rects = [
      { left: 0, right: 100 },
      { left: 100, right: 200 },
    ];
    expect(insertionIndexByMidpoint(rects, 51, 'x')).toBe(1);
  });

  it('returns 0 for an empty list', () => {
    expect(insertionIndexByMidpoint([], 100, 'y')).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/insertionIndex.test.ts
```

Expected: module-not-found FAIL.

- [ ] **Step 3: Write the helper**

```ts
// src/react/dnd/insertionIndex.ts

export interface RectYBounds {
  top: number;
  bottom: number;
}
export interface RectXBounds {
  left: number;
  right: number;
}

/**
 * Compute a 0-based insertion index based on which child midpoint the cursor
 * has passed along the main axis. The returned value is in [0, rects.length].
 *
 * Use with `axis: 'y'` for vertical stacks; `axis: 'x'` for horizontal strips.
 */
export function insertionIndexByMidpoint(
  rects: ReadonlyArray<RectYBounds | RectXBounds>,
  cursorMain: number,
  axis: 'x' | 'y',
): number {
  if (rects.length === 0) return 0;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    const mid =
      axis === 'y'
        ? ((r as RectYBounds).top + (r as RectYBounds).bottom) / 2
        : ((r as RectXBounds).left + (r as RectXBounds).right) / 2;
    if (cursorMain < mid) return i;
  }
  return rects.length;
}

/**
 * Given a container element, return DOMRects (in viewport coords) for each
 * direct child carrying a `data-node` attribute, in DOM order. Used by the
 * default `getInsertionIndex` wiring in `<Container>`.
 */
export function childRectsForContainer(container: Element): { id: string; rect: DOMRect }[] {
  const out: { id: string; rect: DOMRect }[] = [];
  const kids = container.querySelectorAll('[data-node]');
  for (const k of Array.from(kids)) {
    // Skip nested data-node nodes that aren't direct chrome children.
    if (k.parentElement?.getAttribute('data-node-container') !== container.getAttribute('data-node-container')) {
      continue;
    }
    const id = k.getAttribute('data-node');
    if (!id) continue;
    out.push({ id, rect: k.getBoundingClientRect() });
  }
  return out;
}
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/insertionIndex.test.ts
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/mike/src/windease && git add src/react/dnd/insertionIndex.ts src/react/dnd/insertionIndex.test.ts && git commit -m "$(cat <<'EOF'
feat(dnd): main-axis insertion index helpers

insertionIndexByMidpoint and childRectsForContainer used by Container's
default getInsertionIndex wiring (and available to consumers writing
their own drop targets).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `defaultDragOverlay` component

The default ghost the consumer gets when they don't pass `dragOverlay`. Small, swap-able.

**Files:**
- Create: `/Users/mike/src/windease/src/react/dnd/defaultDragOverlay.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/react/dnd/defaultDragOverlay.tsx
import type { CSSProperties, ReactNode } from 'react';
import type { Node, NodeId } from '../../index.js';

export interface DragOverlayContext {
  draggingId: NodeId;
  cursor: { x: number; y: number };
  node: Node | undefined;
  hover: {
    targetId: NodeId;
    accepted: boolean;
    insertIndex?: number;
    cursor: { x: number; y: number };
  } | null;
  rejected: boolean;
}

export type DragOverlayRenderer = (ctx: DragOverlayContext) => ReactNode;

const BASE_STYLE: CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 9999,
  transform: 'translate(-50%, -50%)',
  padding: '6px 10px',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'system-ui, sans-serif',
  whiteSpace: 'nowrap',
  userSelect: 'none',
};

const ACCEPTED_STYLE: CSSProperties = {
  background: 'rgba(40, 90, 180, 0.85)',
  color: 'white',
  border: '1px solid rgba(255, 255, 255, 0.6)',
  cursor: 'grabbing',
};

const REJECTED_STYLE: CSSProperties = {
  background: 'rgba(180, 40, 40, 0.85)',
  color: 'white',
  border: '1px solid rgba(255, 220, 220, 0.8)',
  cursor: 'not-allowed',
};

/**
 * Default cursor-following ghost. Shipped as a named export so consumers can
 * compose / wrap / override. Renders a small chip with the node's `meta.title`
 * (falling back to its id), switching to a red `not-allowed` style when the
 * drag would be rejected at the current hover.
 *
 * @group Components
 */
export const defaultDragOverlay: DragOverlayRenderer = ({ draggingId, cursor, node, rejected }) => {
  const label = ((node?.meta as Record<string, unknown> | undefined)?.title as string | undefined) ?? draggingId;
  const style: CSSProperties = {
    ...BASE_STYLE,
    ...(rejected ? REJECTED_STYLE : ACCEPTED_STYLE),
    left: cursor.x,
    top: cursor.y,
  };
  return (
    <div data-testid="windease-drag-overlay" data-rejected={rejected ? 'true' : 'false'} style={style}>
      {label}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/mike/src/windease && git add src/react/dnd/defaultDragOverlay.tsx && git commit -m "$(cat <<'EOF'
feat(dnd): defaultDragOverlay component

Small chip labelled with the dragged node's title (or id); flips to a
red not-allowed style when rejected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `DragProvider` renders the ghost via portal

**Files:**
- Modify: `/Users/mike/src/windease/src/react/dnd/DragProvider.tsx`
- Create: `/Users/mike/src/windease/src/react/dnd/dragOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/react/dnd/dragOverlay.test.tsx
import { render, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useRef } from 'react';
import { Provider } from '../Provider.js';
import { Store } from '../../store.js';
import { createPanel, createZone } from '../../node-factories.js';
import { DragProvider, useDragController } from './DragProvider.js';
import { useDropTarget } from './useDropTarget.js';

afterEach(cleanup);

function TgtBox({ nodeId, canAccept }: { nodeId: string; canAccept?: (s: string) => boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDropTarget(nodeId, ref, canAccept);
  return <div ref={ref} data-testid={nodeId} style={{ width: 100, height: 100 }} />;
}

function ControllerHandle({ onReady }: { onReady: (c: ReturnType<typeof useDragController>) => void }) {
  const c = useDragController();
  onReady(c);
  return null;
}

describe('DragProvider overlay', () => {
  it('renders the default overlay during drag with the node title', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createPanel({ id: 'src', parentId: 'z', meta: { title: 'My Panel' } }));
    store.registerNode(createPanel({ id: 'tgt', parentId: 'z' }));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { queryByTestId, findByTestId } = render(
      <Provider store={store}>
        <DragProvider>
          <ControllerHandle onReady={(c) => (controller = c)} />
          <TgtBox nodeId="tgt" />
        </DragProvider>
      </Provider>,
    );
    expect(queryByTestId('windease-drag-overlay')).toBeNull();
    await act(async () => {
      controller!.tryBegin('src');
      controller!.updateHoverByPoint(10, 10);
      await new Promise((r) => setTimeout(r, 20));
    });
    const overlay = await findByTestId('windease-drag-overlay');
    expect(overlay.textContent).toBe('My Panel');
    expect(overlay.getAttribute('data-rejected')).toBe('false');
  });

  it('passes rejected=true when the hover is rejected', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createPanel({ id: 'src', parentId: 'z', meta: { title: 'S' } }));
    store.registerNode(createPanel({ id: 'tgt', parentId: 'z' }));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { findByTestId } = render(
      <Provider store={store}>
        <DragProvider>
          <ControllerHandle onReady={(c) => (controller = c)} />
          <TgtBox nodeId="tgt" canAccept={() => false} />
        </DragProvider>
      </Provider>,
    );
    await act(async () => {
      controller!.tryBegin('src');
      controller!.updateHoverByPoint(10, 10);
      await new Promise((r) => setTimeout(r, 20));
    });
    const overlay = await findByTestId('windease-drag-overlay');
    expect(overlay.getAttribute('data-rejected')).toBe('true');
  });

  it('accepts a custom dragOverlay renderer', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createPanel({ id: 'src', parentId: 'z', meta: { title: 'Custom' } }));
    store.registerNode(createPanel({ id: 'tgt', parentId: 'z' }));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { findByTestId } = render(
      <Provider store={store}>
        <DragProvider dragOverlay={(ctx) => <div data-testid="my-overlay">drag:{ctx.draggingId}</div>}>
          <ControllerHandle onReady={(c) => (controller = c)} />
          <TgtBox nodeId="tgt" />
        </DragProvider>
      </Provider>,
    );
    await act(async () => {
      controller!.tryBegin('src');
      controller!.updateHoverByPoint(10, 10);
      await new Promise((r) => setTimeout(r, 20));
    });
    const el = await findByTestId('my-overlay');
    expect(el.textContent).toBe('drag:src');
  });
});
```

- [ ] **Step 2: Confirm it fails**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/dragOverlay.test.tsx
```

Expected: FAIL (no overlay rendered).

- [ ] **Step 3: Rewrite `DragProvider.tsx`**

```tsx
// src/react/dnd/DragProvider.tsx
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../Provider.js';
import { useOptionalStrategyRegistry } from '../strategies.js';
import { DragController, type DragState } from './DragController.js';
import { defaultDragOverlay, type DragOverlayRenderer } from './defaultDragOverlay.js';

export const DragContext = createContext<DragController | null>(null);

export interface DragProviderProps {
  children: ReactNode;
  /**
   * Render the drag ghost. Receives the current cursor, dragging node, and
   * hover state. Defaults to `defaultDragOverlay`. Pass `null` to disable
   * the overlay entirely (e.g. if you render your own).
   */
  dragOverlay?: DragOverlayRenderer | null;
}

/** @group Components */
export function DragProvider({ children, dragOverlay = defaultDragOverlay }: DragProviderProps) {
  const store = useStore();
  const registry = useOptionalStrategyRegistry();
  const controller = useMemo(
    () => new DragController(store, registry ? (sid) => registry.get(sid) : undefined),
    [store, registry],
  );

  const [state, setState] = useState<DragState | null>(null);
  useEffect(() => controller.subscribe(setState), [controller]);

  return (
    <DragContext.Provider value={controller}>
      {children}
      {dragOverlay && state ? <DragOverlayPortal state={state} render={dragOverlay} /> : null}
    </DragContext.Provider>
  );
}

function DragOverlayPortal({ state, render }: { state: DragState; render: DragOverlayRenderer }) {
  const store = useStore();
  const node = store.getNode(state.draggingId);
  const cursor = state.hover?.cursor ?? { x: 0, y: 0 };
  const rejected = state.hover?.accepted === false;
  if (typeof document === 'undefined') {
    return <>{render({ draggingId: state.draggingId, cursor, node, hover: state.hover, rejected })}</>;
  }
  return createPortal(
    <>{render({ draggingId: state.draggingId, cursor, node, hover: state.hover, rejected })}</>,
    document.body,
  );
}

/** @group Hooks */
export function useDragController(): DragController {
  const ctrl = useContext(DragContext);
  if (!ctrl) {
    throw new Error('useDragController must be used inside <DragProvider>');
  }
  return ctrl;
}
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/dragOverlay.test.tsx
```

Expected: 3 PASS.

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/mike/src/windease && npm test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
cd /Users/mike/src/windease && git add src/react/dnd/DragProvider.tsx src/react/dnd/dragOverlay.test.tsx && git commit -m "$(cat <<'EOF'
feat(dnd): DragProvider portal-renders a drag ghost

Subscribes to the controller and renders the dragOverlay callback (or
defaultDragOverlay) at the cursor position via createPortal. Custom
overlays receive {draggingId, cursor, node, hover, rejected}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `Container` — subscribe to drag state, render preview, suppress source

This is the big visible payoff. Container subscribes to `useDragState`, builds the `preview` argument when hovered + accepted, passes it to `useContainerLayout`, and skips rendering the source's real chrome during preview (the source becomes the ghost).

**Files:**
- Modify: `/Users/mike/src/windease/src/react/Container.tsx`
- Modify: `/Users/mike/src/windease/src/react/useContainerLayout.ts` (return `isPreview`)
- Create: `/Users/mike/src/windease/src/react/dnd/livePreview.test.tsx`

- [ ] **Step 1: Expose `isPreview` from `useContainerLayout`**

Open `src/react/useContainerLayout.ts`. Add `isPreview` to the result and surface it:

In `ContainerLayout`:

```ts
export interface ContainerLayout {
  placements: Map<NodeId, Rect>;
  affordances: Affordance[];
  unplaced: NodeId[];
  viewport: { w: number; h: number } | null;
  /** True when the current placements were produced from a `preview` input.
   *  Container uses this to suppress the source's real chrome during preview. */
  isPreview: boolean;
  dispatchAffordance: (event: LayoutEvent) => void;
}
```

In the `layout` memo, surface `result.isPreview`:

```ts
return {
  placements: result.placements,
  affordances: result.affordances,
  unplaced: result.unplaced ?? [],
  viewport,
  isPreview: result.isPreview ?? false,
};
```

And in the early-return guards, set `isPreview: false`:

```ts
if (!node?.container || !viewport) {
  return { placements: new Map(), affordances: [], unplaced: [], viewport, isPreview: false };
}
// ...
if (!strategy) {
  return { placements: new Map(), affordances: [], unplaced: [], viewport, isPreview: false };
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// src/react/dnd/livePreview.test.tsx
import { render, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { Provider } from '../Provider.js';
import { Store } from '../../store.js';
import { createPanel, createZone } from '../../node-factories.js';
import { Container } from '../Container.js';
import { DragProvider, useDragController } from './DragProvider.js';
import { StrategyRegistryProvider } from '../strategies.js';
import { stackStrategy } from '../../layout/stack.js';
import { gridStrategy } from '../../layout/grid.js';

afterEach(cleanup);

function Handle({ onReady }: { onReady: (c: ReturnType<typeof useDragController>) => void }) {
  const c = useDragController();
  onReady(c);
  return null;
}

describe('Container — live drop preview', () => {
  it('passes preview to strategy when hovered + accepted and stamps data-preview', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'src-parent' }));
    store.registerNode(createZone({ id: 'tgt', strategyId: 'stack' }));
    store.registerNode(createPanel({ id: 'src', parentId: 'src-parent', meta: { title: 'S' } }));
    store.registerNode(createPanel({ id: 'a', parentId: 'tgt' }));
    store.registerNode(createPanel({ id: 'b', parentId: 'tgt' }));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ stack: stackStrategy }}>
          <DragProvider>
            <Handle onReady={(c) => (controller = c)} />
            <Container
              parentId="tgt"
              viewport={{ w: 200, h: 600 }}
              chrome={() => <div data-testid="chrome" />}
            />
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    await act(async () => {
      controller!.tryBegin('src');
      controller!.updateHoverByPoint(50, 300);
      await new Promise((r) => setTimeout(r, 20));
    });
    // The container should mark itself as previewing.
    const containerEl = container.querySelector('[data-node-container="tgt"]')!;
    expect(containerEl.getAttribute('data-preview')).toBe('true');
  });

  it('reverts to real layout on rejection (canAccept=false)', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createZone({ id: 'tgt', parentId: 'z', strategyId: 'grid', config: { maxItems: 1 } }));
    store.registerNode(createPanel({ id: 'src', parentId: 'z' }));
    store.registerNode(createPanel({ id: 'occupant', parentId: 'tgt' }));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
          <DragProvider>
            <Handle onReady={(c) => (controller = c)} />
            <Container
              parentId="tgt"
              viewport={{ w: 200, h: 200 }}
              chrome={(args) => <div data-testid={`chrome-${args.id}`} />}
            />
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    await act(async () => {
      controller!.tryBegin('src');
      controller!.updateHoverByPoint(50, 50);
      await new Promise((r) => setTimeout(r, 20));
    });
    const tgtEl = container.querySelector('[data-node-container="tgt"]')!;
    expect(tgtEl.getAttribute('data-drop-rejected')).toBe('true');
    expect(tgtEl.getAttribute('data-preview')).not.toBe('true');
  });

  it('suppresses the source\'s chrome during preview (rendered as ghost only)', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createZone({ id: 'tgt', parentId: 'z', strategyId: 'stack' }));
    // Source is already a child of tgt — same-parent preview.
    store.registerNode(createPanel({ id: 'src', parentId: 'tgt', meta: { title: 'S' } }));
    store.registerNode(createPanel({ id: 'a', parentId: 'tgt' }));
    let controller: ReturnType<typeof useDragController> | null = null;
    const { queryByTestId } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ stack: stackStrategy }}>
          <DragProvider>
            <Handle onReady={(c) => (controller = c)} />
            <Container
              parentId="tgt"
              viewport={{ w: 200, h: 600 }}
              chrome={(args) => <div data-testid={`chrome-${args.id}`} />}
            />
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    await act(async () => {
      controller!.tryBegin('src');
      controller!.updateHoverByPoint(50, 500);
      await new Promise((r) => setTimeout(r, 20));
    });
    // The real chrome for the source should not be visible during preview.
    expect(queryByTestId('chrome-src')).toBeNull();
    // Other chrome still rendered.
    expect(queryByTestId('chrome-a')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Confirm tests fail**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/livePreview.test.tsx
```

Expected: 3 FAIL.

- [ ] **Step 4: Update `Container.tsx`**

Open `/Users/mike/src/windease/src/react/Container.tsx`. Add an import:

```tsx
import { useDragState } from './dnd/useDragState.js';
import { useDragController } from './dnd/DragProvider.js';
import { useEffect } from 'react';
import { childRectsForContainer, insertionIndexByMidpoint } from './dnd/insertionIndex.js';
```

Replace the body of `StoreContainer` to read drag state, compute preview, register `getInsertionIndex` against the container element, and skip the source's chrome during preview:

```tsx
function StoreContainer({
  parentId,
  chrome,
  viewport,
  className,
  style,
  overlay,
  settleMs = DEFAULT_SETTLE_MS,
  affordances = false,
  affordanceHitPad = 4,
}: ContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const parent = useNode(parentId);
  const children = useChildren(parentId);
  const dragState = useDragState();
  const dragController = useDragController();

  // Compute preview from current drag state. Only when this container is
  // the hover target AND the hover is accepted; otherwise preview is omitted.
  const preview =
    dragState?.hover?.targetId === parentId && dragState.hover.accepted
      ? {
          insertId: dragState.draggingId,
          insertIndex: dragState.hover.insertIndex,
          cursor: dragState.hover.cursor,
        }
      : undefined;

  const layout = useContainerLayout(parentId, ref, viewport, preview);

  // Register a default getInsertionIndex on the container element so the
  // controller can resolve cursor → child slot without consumer wiring.
  // Strategy axis is inferred from container.config.axis (defaults to 'y'
  // for stack, 'x' for strip — for grid we leave it undefined and let the
  // strategy's fast path handle it via list order).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cfg = (parent?.container?.config ?? {}) as { axis?: 'x' | 'y' };
    const strategyId = parent?.container?.strategyId;
    const axis: 'x' | 'y' = cfg.axis ?? (strategyId === 'strip' ? 'x' : 'y');
    return dragController.registerDropTarget(
      parentId,
      el,
      undefined,
      {
        getInsertionIndex: (point) => {
          const rects = childRectsForContainer(el);
          if (rects.length === 0) return 0;
          // Skip the source itself for same-parent previews.
          const sourceId = dragController.state()?.draggingId;
          const filtered = sourceId ? rects.filter((r) => r.id !== sourceId) : rects;
          const main = axis === 'y' ? point.y : point.x;
          return insertionIndexByMidpoint(
            filtered.map((r) => r.rect),
            main,
            axis,
          );
        },
      },
    );
  }, [dragController, parentId, parent?.container?.strategyId, parent?.container?.config]);

  const [draggingAffordanceId, setDraggingAffordanceId] = useState<string | null>(null);
  const effectiveSettleMs = draggingAffordanceId !== null ? 0 : settleMs;

  const containerStyle: CSSProperties = viewport
    ? { ...CONTAINER_BASE, width: viewport.w, height: viewport.h, ...style }
    : { ...CONTAINER_BASE, width: '100%', height: '100%', ...style };

  if (!parent?.container || !chrome) {
    return (
      <div
        ref={ref}
        className={className}
        style={containerStyle}
        data-node-container={parentId}
      />
    );
  }

  const renderedOverlay =
    typeof overlay === 'function'
      ? (overlay as OverlayRenderer)({ ...layout, draggingAffordanceId })
      : overlay;

  // During preview, the source's real chrome is suppressed (it appears as the
  // ghost). For same-parent previews, the source is in `children`; for
  // cross-parent previews, it's not — but its rect is in `layout.placements`
  // (we skip rendering chrome for it either way because the ghost handles it).
  const previewSourceId = layout.isPreview ? dragState?.draggingId : undefined;

  // Build the render list = real children ∪ ghost (if cross-parent). For
  // same-parent the ghost id is already a child; for cross-parent we synthesize
  // a placeholder entry so we render the preview rect (but with no chrome —
  // the DragProvider portal-ghost is what the user sees).
  const renderEntries = new Map<NodeId, { isReal: boolean }>();
  for (const c of children) {
    if (c.lifecycle.state !== 'visible') continue;
    renderEntries.set(c.id, { isReal: true });
  }
  if (previewSourceId && !renderEntries.has(previewSourceId)) {
    renderEntries.set(previewSourceId, { isReal: false });
  }

  return (
    <div
      ref={ref}
      className={className}
      style={containerStyle}
      data-node-container={parentId}
      data-preview={layout.isPreview ? 'true' : undefined}
    >
      {Array.from(renderEntries.entries()).map(([id, { isReal }]) => {
        const rect = layout.placements.get(id);
        if (!rect) return null;
        const childStyle: CSSProperties = {
          ...CHILD_BASE,
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
        };
        if (effectiveSettleMs > 0) {
          childStyle.transition = `left ${effectiveSettleMs}ms ease, top ${effectiveSettleMs}ms ease, width ${effectiveSettleMs}ms ease, height ${effectiveSettleMs}ms ease`;
        }
        // Source during preview: render the rect but skip chrome (the ghost
        // overlay is what the user sees). This keeps the slot reserved so
        // siblings reflow into their preview positions.
        if (id === previewSourceId) {
          return <div key={id} style={childStyle} data-node={id} data-preview-source="true" />;
        }
        if (!isReal) return null;
        return (
          <div key={id} style={childStyle} data-node={id}>
            <NodeRenderer id={id} chrome={chrome} />
          </div>
        );
      })}
      {affordances &&
        layout.affordances.map((aff) =>
          typeof affordances === 'function' ? (
            <Fragment key={aff.id}>
              {affordances({
                affordance: aff,
                dispatch: layout.dispatchAffordance,
                hitPad: affordanceHitPad,
              })}
            </Fragment>
          ) : (
            <AffordanceHandle
              key={aff.id}
              affordance={aff}
              dispatch={layout.dispatchAffordance}
              hitPad={affordanceHitPad}
              onActiveChange={(active) => setDraggingAffordanceId(active ? aff.id : null)}
            />
          ),
        )}
      {renderedOverlay}
    </div>
  );
}
```

Note: the `getInsertionIndex` registration above calls `registerDropTarget` a second time for `parentId` (the consumer may already have done so via `useDropTarget`). The map keyed by `NodeId` will overwrite the previous entry; that's intentional for now — Container's registration wins. If you want to compose registrations, that's a follow-up.

- [ ] **Step 5: Run the tests**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/livePreview.test.tsx
```

Expected: 3 PASS. If the "reverts on rejection" case fails because `data-drop-rejected` isn't set on the same element Container picks up (Container's `data-node-container` div vs. some inner element), inspect with:

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/livePreview.test.tsx --reporter=verbose
```

The fix is to ensure Container's outer `<div ref={ref}>` IS the element registered as the drop target (which it is, via the `useEffect` above). `reflectHoverToDom` stamps `data-drop-rejected` on that element directly.

- [ ] **Step 6: Run the full suite**

```bash
cd /Users/mike/src/windease && npm test
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
cd /Users/mike/src/windease && git add src/react/Container.tsx src/react/useContainerLayout.ts src/react/dnd/livePreview.test.tsx && git commit -m "$(cat <<'EOF'
feat(react): Container live drop preview + ghost-source suppression

Container subscribes to drag state, computes a preview when it's the
accepted hover target, passes it to useContainerLayout, and renders
sibling chrome at the prospective post-drop placements. The source's
real chrome is suppressed during preview (a transparent slot reserves
its rect; DragProvider's portal ghost is what the user sees). Container
auto-registers a default getInsertionIndex on its outer element using
the new midpoint helpers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Wire `getDropPreview` fast path

`Container` currently calls `runStrategyForContainer` which routes through `.layout()`. Add a fast path: when the strategy has `getDropPreview` and returns non-null, use its placements instead.

**Files:**
- Modify: `/Users/mike/src/windease/src/react/useContainerLayout.ts`
- Modify: `/Users/mike/src/windease/src/react/dnd/livePreview.test.tsx`

- [ ] **Step 1: Add a test for the fast path**

Append to `src/react/dnd/livePreview.test.tsx`:

```tsx
describe('Container — getDropPreview fast path', () => {
  it('uses strategy.getDropPreview when defined', async () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    store.registerNode(createZone({ id: 'tgt', parentId: 'z', strategyId: 'grid', config: { cols: 2 } }));
    store.registerNode(createPanel({ id: 'src', parentId: 'z', meta: { title: 'S' } }));
    store.registerNode(createPanel({ id: 'a', parentId: 'tgt' }));

    const spy = vi.spyOn(gridStrategy, 'getDropPreview' as never);
    let controller: ReturnType<typeof useDragController> | null = null;
    render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
          <DragProvider>
            <Handle onReady={(c) => (controller = c)} />
            <Container
              parentId="tgt"
              viewport={{ w: 200, h: 200 }}
              chrome={(args) => <div data-testid={`chrome-${args.id}`} />}
            />
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    await act(async () => {
      controller!.tryBegin('src');
      controller!.updateHoverByPoint(50, 50);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Confirm it fails**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/livePreview.test.tsx -t "getDropPreview fast path"
```

Expected: FAIL (spy not called).

- [ ] **Step 3: Implement the fast path in `useContainerLayout`**

Open `src/react/useContainerLayout.ts`. In the `layout` memo, before the `runStrategyForContainer` call, try the fast path when a preview is requested:

```ts
const layout = useMemo<Omit<ContainerLayout, 'dispatchAffordance'>>(() => {
  if (!node?.container || !viewport) {
    return { placements: new Map(), affordances: [], unplaced: [], viewport, isPreview: false };
  }
  const strategy = registry.get(node.container.strategyId);
  if (!strategy) {
    return { placements: new Map(), affordances: [], unplaced: [], viewport, isPreview: false };
  }

  // Fast path: when previewing and the strategy implements getDropPreview,
  // ask it directly; fall back to runStrategyForContainer on null.
  if (preview && strategy.getDropPreview) {
    const items = store
      .getChildren(parentId)
      .filter((c) => c.lifecycle.state === 'visible')
      .map((c) => ({ id: c.id }));
    const config = (node.container.config ?? {}) as Record<string, unknown>;
    const fast = strategy.getDropPreview({
      items,
      container: viewport,
      options: config,
      insertId: preview.insertId,
      insertIndex: preview.insertIndex,
      cursor: preview.cursor,
    });
    if (fast) {
      return {
        placements: fast.placements as Map<NodeId, Rect>,
        affordances: [],
        unplaced: [],
        viewport,
        isPreview: fast.accepted,
      };
    }
  }

  const persisted = store.getContainerState(parentId);
  const state =
    persisted ??
    (strategy.initialState
      ? strategy.initialState(
          store
            .getChildren(parentId)
            .filter((c) => c.lifecycle.state === 'visible')
            .map((c) => ({ id: c.id })),
        )
      : undefined);
  const result: LayoutResult<NodeId, unknown> = runStrategyForContainer(
    store,
    parentId,
    viewport,
    strategy,
    state as never,
    preview,
  );
  return {
    placements: result.placements,
    affordances: result.affordances,
    unplaced: result.unplaced ?? [],
    viewport,
    isPreview: result.isPreview ?? false,
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: stateTick is a re-run gate; previewKey is a stable identity for `preview`.
}, [store, node?.container, viewport, registry, parentId, stateTick, previewKey]);
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/mike/src/windease && npx vitest run src/react/dnd/livePreview.test.tsx
```

Expected: all 4 PASS.

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/mike/src/windease && npm test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
cd /Users/mike/src/windease && git add src/react/useContainerLayout.ts src/react/dnd/livePreview.test.tsx && git commit -m "$(cat <<'EOF'
feat(react): use strategy.getDropPreview fast path when available

When a preview is requested and the strategy implements getDropPreview,
call it directly and skip the runStrategyForContainer detour. Falls back
gracefully on null return.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Public exports, playground stories, version bump

**Files:**
- Modify: `/Users/mike/src/windease/src/react/index.ts`
- Modify: `/Users/mike/src/windease/src/index.ts` (only if `DragOverlayRenderer` should ship from the core entry — keep it scoped to `/react`)
- Modify: `/Users/mike/src/windease/src/react/stories/Playground.stories.tsx`
- Modify: `/Users/mike/src/windease/src/react/stories/DeclarativePlayground.stories.tsx`
- Modify: `/Users/mike/src/windease/package.json`

- [ ] **Step 1: Export the new public surface**

In `src/react/index.ts`, add:

```ts
export { defaultDragOverlay, type DragOverlayRenderer, type DragOverlayContext } from './dnd/defaultDragOverlay.js';
export type { DropTargetOptions } from './dnd/DragController.js';
export { insertionIndexByMidpoint, childRectsForContainer } from './dnd/insertionIndex.js';
```

- [ ] **Step 2: Build**

```bash
cd /Users/mike/src/windease && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Update Playground story to opt into the overlay**

Open `src/react/stories/Playground.stories.tsx`. Find the existing `<DragProvider>` wrapping and confirm it now gets the default overlay automatically (no prop needed — `defaultDragOverlay` is the default). If you want to demonstrate the API explicitly, edit one story to pass `dragOverlay={defaultDragOverlay}`:

```bash
grep -n "DragProvider" /Users/mike/src/windease/src/react/stories/Playground.stories.tsx | head -5
```

Add an import:

```tsx
import { defaultDragOverlay } from '../dnd/defaultDragOverlay.js';
```

And edit one `<DragProvider>` usage to:

```tsx
<DragProvider dragOverlay={defaultDragOverlay}>
```

No behavior change (default is the same), but the story now serves as a worked example.

- [ ] **Step 4: Same for `DeclarativePlayground.stories.tsx`**

```bash
grep -n "DragProvider" /Users/mike/src/windease/src/react/stories/DeclarativePlayground.stories.tsx | head -5
```

If `DragProvider` is wrapped there, repeat the explicit `dragOverlay={defaultDragOverlay}` opt-in for documentation purposes.

- [ ] **Step 5: Visually verify reflow**

```bash
cd /Users/mike/src/windease && npm run ladle &
LADLE_PID=$!
sleep 5
# Visit http://localhost:61000/ and:
#   - Open the main Playground story
#   - Drag a panel; confirm a chip follows the cursor
#   - Hover over a stack zone; confirm siblings reflow with the ghost slotted in
#   - Hover over a maxed-out grid; confirm the chip turns red + zone gets the rejected overlay
#   - Drop; confirm the panel lands at the previewed slot
kill $LADLE_PID 2>/dev/null
```

If anything visual is broken (settle transitions stuttering, ghost positioned wrong), fix and re-verify. Likely culprits: cursor coords are viewport-relative but Container's placements are container-relative — that's expected; the ghost is in viewport coords (it's a `position: fixed` portal), siblings are absolute inside their container. Don't unify them.

- [ ] **Step 6: Bump version to 0.5.0**

In `/Users/mike/src/windease/package.json`, change `"version": "0.4.0"` to `"version": "0.5.0"`.

- [ ] **Step 7: Run final verification**

```bash
cd /Users/mike/src/windease && npm test && npx tsc --noEmit && npm run build
```

Expected: all tests pass, types clean, build succeeds. Total test count should be 234 + ~18 = ~252.

- [ ] **Step 8: Commit**

```bash
cd /Users/mike/src/windease && git add src/react/index.ts src/react/stories/Playground.stories.tsx src/react/stories/DeclarativePlayground.stories.tsx package.json && git commit -m "$(cat <<'EOF'
feat: export drag-overlay API + bump to 0.5.0

defaultDragOverlay, DragOverlayRenderer, DragOverlayContext,
DropTargetOptions, and the insertion-index helpers ship from
windease/react. Playground stories opt into dragOverlay explicitly as
worked examples.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

- **Spec coverage:**
  - Section "Expanded DragController state" → Task 3 (DragState extension, rAF throttle, drop dispatch).
  - Section "Strategy API — preview is canonical, fast-path is opt-in" → Tasks 1 (types), 5–8 (per-strategy preview), 7 (grid fast path), 14 (Container fast path).
  - Section "Container subscribes to drag state" → Task 13.
  - Section "Drag ghost rendering" → Tasks 11 (`defaultDragOverlay`), 12 (`DragProvider` portal).
  - Section "Rejection feedback" → Tasks 3 (controller stamps `data-drop-rejected`), 13 (Container reverts to real layout on `accepted=false`).
  - Section "Drop dispatch" → Task 3 (drop passes `insertIndex`).
  - Section "Throttling" → Task 3.
  - Section "Tests" → Tasks 3, 7, 12, 13, 14 cover every bullet in the spec's Tests list.
  - Section "Public API additions" → Task 15 exports.
  - Section "Versioning" → Task 15 bump to 0.5.0.

- **Spec ambiguities resolved:**
  - **Where to register the default `getInsertionIndex`.** Spec says "the consumer-provided callback (with a sensible default)" but doesn't say WHO registers the default. Task 13 puts it on `Container` — Container has the element ref and the strategy id, and Container is the canonical host. Consumer-overridden callbacks via `useDropTarget` win (overwrite under the same node id).
  - **Same-parent preview rendering.** Spec doesn't spell out whether the source's `<div data-node>` stays in the DOM tree during preview. Task 13 keeps a transparent slot at the prospective rect (no chrome) so other siblings reflow around it deterministically.
  - **Strategy-level acceptance during preview.** Spec mentions extending `checkAccept` to pass `insertIndex` — Task 3 plumbs the parameter through but doesn't yet feed it into any strategy's `canAccept` (current `canAccept` signature is `(items, options)`). Leaving the signature unchanged and the parameter unused-but-typed keeps the patch surface tight; can revisit when a strategy actually needs the index.
  - **`getDropPreview` for split.** Spec explicitly opts out for split (the split-tree manipulation IS the layout). Task 8 only stamps `isPreview` and lets the canonical path handle the rest.

- **Placeholder scan:** every code block is concrete. No "fill in similar to Task N" or `// TBD`. The only intentional ellipses are `// ...existing body unchanged...` inside `checkAccept` where the surrounding code is shown earlier in the same task.

- **Type consistency:** `LayoutPreview`, `DragOverlayContext`, `DragOverlayRenderer`, `DropTargetOptions` are defined once and re-used by reference. `preview` is shaped identically (`{ insertId, insertIndex?, cursor }`) everywhere: layout types, runStrategyForContainer signature, useContainerLayout signature, Container's local computation.

- **Sequencing:** Tasks 1 → 2 (types before adapter) → 3 (controller) → 4 (hook surface). Tasks 5–8 are strategy work; can be parallelized but stack-first matches the spec order. Tasks 9 → 13 → 14 are the React glue: hook accepts preview, Container uses it, Container takes the fast path. Tasks 10–12 (helpers, default overlay, provider portal) are independent of 13 but 13's tests need 11 + 12 to exist for the overlay assertions to mean anything.

- **Test count:** stack +3, strip +2, grid +3, split +1, adapter +3, controller +3, useDropTarget +1, insertionIndex +5, dragOverlay +3, livePreview +3 (+1 fast-path) ≈ 28 new tests — a bit above the spec's "~15–20" but the spec's count was per-section and undercounts cross-cutting tests; expected total still lands in the right ballpark.
