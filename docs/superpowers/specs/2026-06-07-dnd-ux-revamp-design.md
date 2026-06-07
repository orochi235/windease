# DnD UX revamp — drag ghosts + live drop reflow

**Status:** design
**Date:** 2026-06-07
**Ships in:** `windease@0.5.0` (alongside resizable-children, or as a separate point release)

## Problem

The current DnD experience is "blind":

- **No visual indication of what's being dragged.** Source stays in place during the drag; nothing follows the cursor.
- **No visual indication of where a drop would land.** Drop targets glow (the `data-drop-target` highlight) but there's no per-position cue. A user dragging into a stack with 5 children can't tell which slot they'd land in until they release.
- **Drop-rejection feedback is binary** (red tint or nothing); no positional context for "you can drop here, just not at THAT slot."

The store-driven `moveNode(source, target)` already accepts `at?: number` (see `src/store.ts:237`), but the React layer doesn't compute or pass an index — it appends. Even if the user could see where they'd land, they couldn't control it.

## Goal

Three coordinated additions:

1. **Drag ghost** — a fixed-position overlay that follows the cursor, rendered by a consumer-provided callback (with a sensible default).
2. **Live drop reflow** — as the user hovers over a target, the target's children reflow into their prospective post-drop positions in real time. The source ghost fills the prospective slot. Uses the existing settle transition for animation.
3. **Rejection feedback** — when the prospective drop would be rejected (strategy's `canAccept` says no), reflow stops and the container shows the existing `data-drop-rejected` red overlay; the ghost continues to track the cursor with a `not-allowed` cursor.

All three are driven by an expanded `DragController` state. Strategies participate via an extended `.layout()` signature (preview is canonical) plus an optional `getDropPreview()` fast path.

## Architecture

### Expanded DragController state

```ts
export interface DragState {
  draggingId: NodeId;
  hover: {
    targetId: NodeId;
    accepted: boolean;
    /** 0-based prospective insertion index in the target's childOrder.
     *  Undefined when the strategy gives no positional answer (e.g. splits). */
    insertIndex?: number;
    /** Cursor position in viewport coords. Used to position the ghost. */
    cursor: { x: number; y: number };
  } | null;
}
```

`updateHoverByPoint(x, y)` now:
1. Hit-tests drop targets (existing behavior).
2. If a target matches, calls the target's registered `getInsertionIndex(point)` callback (registered when consumer called `useDropTarget`).
3. Calls `checkAccept(targetId, draggingId, insertIndex)` — extended to pass the prospective insertion to the strategy's `canAccept`.
4. Updates `hover` with `targetId`, `accepted`, `insertIndex`, `cursor`.
5. Stamps `data-drop-target` / `data-drop-rejected` attrs on the target element (existing behavior).

### Throttling

Pointer events fire at ~120Hz on modern hardware and arbitrary rates elsewhere. We throttle `updateHoverByPoint` to **one invocation per animation frame** using `requestAnimationFrame`. Conservative — keeps the strategy at ~60Hz max, which is plenty smooth, and avoids dropping events (rAF coalesces; the latest `(x, y)` wins).

```ts
// Inside DragController:
private pendingPoint: { x: number; y: number } | null = null;
private rafId: number | null = null;

updateHoverByPoint(x: number, y: number): void {
  this.pendingPoint = { x, y };
  if (this.rafId !== null) return;
  this.rafId = requestAnimationFrame(() => {
    this.rafId = null;
    if (this.pendingPoint) {
      const p = this.pendingPoint;
      this.pendingPoint = null;
      this.actuallyUpdateHover(p.x, p.y);
    }
  });
}
```

Easy to tighten later if a use case needs sub-frame latency. Cancel any pending rAF on `drop()` / `cancel()` so the trailing-edge event doesn't fire after the drag ends.

### Strategy API — preview is canonical, fast-path is opt-in

**Canonical path:** extend `LayoutStrategy.layout()` to accept an optional `preview` field:

```ts
interface LayoutInput<TItem, TConfig> {
  items: TItem[];
  container: { w: number; h: number };
  options: TConfig;
  /** When present, the strategy should lay out as if the item with
   *  `insertId` were inserted at the cursor position (or replacing it, for
   *  strategies that don't insert). The cursor is in container-relative
   *  coords. The strategy MAY return null to signal "no meaningful preview
   *  for this position" (Container then falls back to non-preview layout). */
  preview?: {
    insertId: NodeId;
    insertIndex?: number;
    cursor: { x: number; y: number };
  } | undefined;
}

interface LayoutResult<...> {
  placements: Map<NodeId, Rect>;
  affordances: Affordance[];
  /** True if this layout call honored a preview. Container uses this to know
   *  whether to render the source ghost at preview position vs. at its
   *  current real position. */
  isPreview?: boolean;
}
```

When `preview` is set, the strategy's existing layout logic includes the insert ID in its items list (or at the specified index) and returns placements covering it. The source's "real" rect (its current pre-drop position) is dropped from the result — the only rect for the source is its prospective one.

**Opt-in fast path:** strategies that have a cheap preview can implement:

```ts
interface LayoutStrategy<...> {
  // existing fields...
  getDropPreview?(input: {
    items: TItem[];
    container: { w: number; h: number };
    options: TConfig;
    insertId: NodeId;
    insertIndex: number | undefined;
    cursor: { x: number; y: number };
  }): { placements: Map<NodeId, Rect>; accepted: boolean } | null;
}
```

`Container` checks `getDropPreview` first; if defined and returns non-null, uses it. Otherwise falls back to `.layout({ items, container, options, preview: {...} })`.

`gridStrategy` likely implements the fast path (cell positions are deterministic given index). `splitStrategy` doesn't bother — its preview goes through `.layout()` because the split-tree manipulation is the layout.

### Container subscribes to drag state

`Container` (store-driven) and the layout-providing path inside `<Zone>` now both subscribe via `useDragState()`. When `hover?.targetId === parentId && hover.accepted`, Container builds a `preview` argument and calls the strategy. The returned placements include the source. Container renders all children at preview rects, with the source rendered as the **ghost** (overlay), not its real chrome.

When `hover.accepted === false` or `hover.targetId !== parentId`, Container renders the real layout. The container element gets `data-drop-rejected="true"` from the controller's existing attribute stamp.

### Drag ghost rendering

The ghost is consumer-rendered via an opt-in callback on `<DragProvider>`:

```ts
export type DragOverlayRenderer = (ctx: {
  draggingId: NodeId;
  cursor: { x: number; y: number };
  node: Node;
  hover: DragState['hover'];
  /** True when the drag would be rejected at the current hover. The default
   *  overlay uses this to add a not-allowed cursor and reduced opacity. */
  rejected: boolean;
}) => ReactNode;
```

When `dragOverlay` is omitted, `DragProvider` falls back to `defaultDragOverlay`, which renders a translucent rectangle sized to the source's last-known bounding rect, showing the source's `meta.title`. About 30 lines; ships as `defaultDragOverlay` so consumers can compose / override.

The ghost is rendered via `createPortal(<div style={{...}}>{overlay}</div>, document.body)` so it can escape any `overflow: hidden` containers. Style:

```ts
{ position: 'fixed', left: cursor.x, top: cursor.y, pointerEvents: 'none', zIndex: 9999, transform: 'translate(-50%, -50%)' }
```

### Rejection feedback

When `hover.accepted === false`:
1. Container does NOT call the strategy with preview — renders real layout.
2. The target element gets `data-drop-rejected="true"` (existing CSS handles the red overlay).
3. The ghost's `rejected` flag is true; `defaultDragOverlay` switches to a red border + `not-allowed` cursor.

### Drop dispatch

`controller.drop()` now passes `insertIndex` to `moveNode`:

```ts
this.store.moveNode(draggingId, hover.targetId, hover.insertIndex);
```

`moveNode` already supports `at?: number`.

## Public API additions

- `DragState.hover.insertIndex?: number`
- `DragState.hover.cursor: { x: number; y: number }`
- `DragProvider`'s new `dragOverlay?: DragOverlayRenderer` prop
- `defaultDragOverlay` exported from `windease/react`
- `useDropTarget` options gain `getInsertionIndex?: (point) => number | undefined`
- `LayoutStrategy.layout()`: extended input shape with optional `preview` field; result with optional `isPreview` flag
- `LayoutStrategy.getDropPreview?` — optional fast-path method
- `Container` and `<Zone>` automatically subscribe to drag state; no new consumer-facing prop needed

## Affected files

- `src/react/dnd/DragController.ts` — extended hover state; rAF-throttled `updateHoverByPoint`; `drop()` passes `insertIndex`
- `src/react/dnd/useDropTarget.ts` — options gain `getInsertionIndex?`; passed to controller registration
- `src/react/dnd/DragProvider.tsx` — accepts `dragOverlay` prop; renders ghost via portal during drag
- `src/react/dnd/defaultDragOverlay.tsx` — new file
- `src/react/Container.tsx` — subscribes to drag state; passes `preview` to strategy when hovered; renders ghost vs. real rect
- `src/react/presets.tsx` — `<Zone>`'s layout-providing path same as Container
- `src/react/useContainerLayout.ts` — accepts optional preview parameter, threads to strategy
- `src/layout/types.ts` — extends `LayoutStrategy`, `LayoutInput`, `LayoutResult` types
- `src/layout/stack.ts` / `strip.ts` / `grid.ts` / `split.ts` — implement preview in `.layout()`; grid additionally implements `getDropPreview` fast path
- `src/react/styles.css` — refine `.windease-insertion-line` and `.windease-insertion-outline` rules (still useful for strategies that want positional cues *during* reflow, e.g. a thin line marking the actual insertion point)
- `src/react/stories/Playground.stories.tsx` and `DeclarativePlayground.stories.tsx` — opt into `dragOverlay`; verify reflow works visually

## Tests

`src/react/dnd/DragController.test.ts`:
- `updateHoverByPoint` is rAF-throttled (multiple calls within one frame coalesce to one).
- `drop()` passes `insertIndex` to `moveNode`.
- Cursor coords on hover state update with each call.

`src/react/dnd/dragOverlay.test.tsx`:
- DragProvider with `dragOverlay` renders the callback's result at cursor.
- `defaultDragOverlay` renders title + outline.
- Rejected drag passes `rejected: true` to the callback.

`src/react/dnd/livePreview.test.tsx`:
- Container with active drag hovering an accepted target calls strategy with `preview` and renders source at preview position.
- Hover moves trigger re-layout (placements differ between hover positions).
- Rejection (canAccept false) reverts to real layout + data-drop-rejected.
- `getDropPreview` fast path is used when implemented; falls back to `.layout({preview})` otherwise.

`src/layout/stack.test.ts` etc.: preview-aware `.layout()` returns expected placements for inserts at index 0, middle, end.

Total new tests: ~15-20.

## Edge cases & open questions

- **Drag onto a splitStrategy zone**: `insertIndex` is undefined (splits don't insert at indices). The strategy's `.layout({ preview })` returns placements that include the source as a new pane (probably bisecting the hovered pane). No marker line needed — the reflow IS the preview.
- **Drag onto an empty drop target**: `insertIndex` is 0; preview placements include only the source.
- **Drag onto self's current container**: same-parent reorder. `canAccept` should return true; strategy lays out with source at preview position; on drop, `moveNode` reorders.
- **Strategy state during preview**: strategies with state (split's ratios) compute preview against current state. Ratios don't change until drop. Acceptable for 0.5 — revisit if a use case demands "what would the new ratio be?"
- **Touch events**: pointer events normalize. Verify ghost positions correctly on touchstart (no pre-touch hover state).
- **Multi-cursor / multi-touch drags**: not supported.
- **rAF callback timing during drag end**: if `drop()` fires while a rAF callback is pending, we cancel it (no trailing-edge update after drag end).

## Versioning

Ship as 0.5.0 alongside resizable-children, OR as standalone 0.4.1. Additive — the new strategy-input field is optional; existing strategies ignore it; existing consumers get the new visuals automatically (ghost via default + reflow via Container subscribing).

The only **breaking change** is the `LayoutStrategy` interface gaining an optional method (`getDropPreview?`) and `.layout()` accepting an optional input field. Existing strategy implementations need no change. Third-party strategy authors who type their strategy strictly against the interface will see the new optional field at compile time but no runtime change.

## Process

Recommend `superpowers:writing-plans` next.
