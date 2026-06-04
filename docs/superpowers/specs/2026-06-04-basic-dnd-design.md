# Basic drag-and-drop design

**Goal:** Ship pointer-driven DnD for `@windease/react` covering: reorder within a zone, move between zones, recursive-split zone swap, drop indicators, and a `canAccept` strategy hook to reject illegal drops.

**Non-goals (v1):** keyboard equivalents, FLIP animations, touch beyond pointer-events, group formation, tree restructure in the Workspace layer (only leaf-id swap), store-level enforcement of `canAccept`.

---

## Two layers of drag

DnD lives at two layers, disambiguated by **where the user presses**.

### Layer 1: Window drag (the common case)

- **Source:** `.windease-window` (the wrapper Zone renders around each window).
- **Drop targets:** any `.windease-zone` in the document.
- **Activation:** pointermove of ≥5 px from pointerdown converts the gesture to a drag. Under threshold, the click bubbles to the consumer (so existing select-on-click keeps working).
- **Effect on drop:**
  - Same zone → `store.reorderInZone(zoneId, windowId, index)`.
  - Different zone → `store.moveWindow(windowId, targetZoneId, index)`.
- **Indicator:** hovered target zone gets `data-drop-target="true"`. An insertion-line div renders at the computed insertion point between sibling `.windease-window`s.
- **Rejection:** if target `strategy.canAccept(prospective) === false`, suppress the `data-drop-target` attribute, set cursor to `not-allowed`, and ignore the drop.

### Layer 2: Zone drag inside a Workspace

- **Source:** `.windease-zone` itself (event target === the zone element, not a descendant — so pressing on a `.windease-window` never triggers this).
- **Drop targets:** other `.windease-zone` elements rendered by the same Workspace.
- **Activation:** same ≥5 px threshold.
- **Effect on drop:** Workspace swaps the leaf ids at source and target paths in its `SplitNode` state. No tree restructure.
- **Indicator:** hovered target zone gets `data-zone-drop-target="true"`.
- **Rejection:** N/A — swap is always valid.

The two layers cannot be active simultaneously: a module-level `currentDrag` ref enforces mutual exclusion.

---

## API additions

### `LayoutStrategy.canAccept` (optional)

```ts
canAccept?(items: LayoutItem[]): boolean;
```

Strategies without an implementation are treated as accept-all. Built-in implementations:

| Strategy        | Implementation                              |
| --------------- | ------------------------------------------- |
| `grid`          | not implemented (accept-all)                |
| `stack`         | not implemented (accept-all)                |
| `strip`         | not implemented (accept-all)                |
| `binarySplit`   | `items.length === 2`                        |
| `recursiveSplit`| not implemented (accept-all; orphans handled at layout time) |

Store APIs (`moveWindow`, `claim`, etc.) do NOT enforce `canAccept` — only the DnD layer does. Programmatic callers can still violate constraints if they want (matching existing "casts are unchecked" philosophy).

---

## Components

### `packages/react/src/dnd/usePointerDrag.ts`

Shared low-level hook used by both layers.

```ts
interface UsePointerDragOptions {
  threshold?: number;               // default 5
  onDragStart(e: PointerEvent): void;
  onDragMove(e: PointerEvent, delta: { dx: number; dy: number }): void;
  onDragEnd(e: PointerEvent, didDrag: boolean): void;
}

function usePointerDrag(opts: UsePointerDragOptions): {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: (e: ReactPointerEvent) => void;
};
```

Manages: pointer capture, threshold-to-drag transition, ensuring `onDragEnd` always fires.

### `packages/react/src/dnd/dragCoordinator.ts`

Tiny module-level singleton:

```ts
let currentDrag: 'window' | 'zone' | null = null;

export function tryBegin(kind: 'window' | 'zone'): boolean;
export function end(): void;
```

`tryBegin` returns false if a drag of any kind is already active, preventing the two layers from interleaving.

### Changes to `Zone.tsx`

- Each `.windease-window` wrapper gets pointer handlers via `usePointerDrag`.
- On drag move, run hit-test via `document.elementsFromPoint`, find first `[data-zone-id]`, look up the target zone's strategy from the store, call `canAccept` with the prospective item list, toggle indicators.
- On drag end (if `didDrag`), dispatch the right store action.

### Changes to `Workspace.tsx`

- Workspace attaches a single `onPointerDown` to its root element (event delegation). On pointerdown it inspects the target:
  - If `event.target.closest('.windease-window')` matches, ignore — the window-drag layer will handle.
  - Otherwise, walk up for the nearest `[data-zone-id]` that is a descendant of this Workspace. If found, begin a zone-drag with that zone id as the source.
- The source/target zone ids map directly to leaf ids in the `SplitNode` tree (recursiveSplit's invariant). On drop: find the paths to source and target leaves, swap their ids in the tree, call `setState`.
- Indicator: hovered target zone gets `data-zone-drop-target="true"`.
- Only `recursiveSplit` supports zone-swap in v1. For other workspace strategies, zone-drag is a no-op (no indicator, no effect).

---

## Data flow

```
pointerdown (window wrapper)
  → usePointerDrag captures pointer
  → first pointermove past threshold:
      → dragCoordinator.tryBegin('window')
      → onDragStart fires
  → each pointermove:
      → elementsFromPoint → find target zone
      → compute insertion index (nearest sibling .windease-window)
      → build prospective item list
      → call target strategy.canAccept(prospective)
      → update data-drop-target and insertion-line position
  → pointerup:
      → if didDrag and target accepts:
          same zone  → store.reorderInZone(...)
          diff zone  → store.moveWindow(...)
      → dragCoordinator.end()
```

Same flow for zone-drag, just with simpler effects (state swap).

---

## Insertion index computation

Inside the target zone, find all `.windease-window` direct children. Compute each child's center; pick the index of the child whose center is closest to the pointer, then choose the side (before or after) based on which half of that child the pointer is on.

For an empty target zone, index = 0.

---

## Testing

- **`usePointerDrag` unit tests:** threshold not crossed → `didDrag=false` and click passes through; threshold crossed → `didDrag=true`; pointer cancel always fires `onDragEnd`.
- **`dragCoordinator` unit tests:** second `tryBegin` returns false while a drag is active; `end` resets.
- **`binarySplit.canAccept` tests:** true for length 2, false otherwise.
- **Zone DnD integration test:** seed a store with two zones and a window in zone A; simulate pointer down/move/up onto zone B; assert `store.moveWindow` was called with the right zone id and index.
- **Workspace zone-swap integration test:** simulate pointer down/move/up on one zone, drop on another; assert `onStateChange` fires with a tree whose leaves are swapped.
- **`canAccept` rejection test:** target with a strategy that returns false → `data-drop-target` not set, store action not called.

All pointer tests use the `firePointer` helper already established in `Workspace.test.tsx` (jsdom's `PointerEvent` drops `clientX`/`clientY`).

---

## CSS additions

Add to `windease.css` (story sheet) so the demo shows indicators:

```css
.windease-zone[data-drop-target='true'] {
  outline: 2px solid #2563eb;
  outline-offset: -2px;
}
.windease-zone[data-zone-drop-target='true'] {
  outline: 2px dashed #16a34a;
  outline-offset: -2px;
}
.windease-insertion-line {
  position: absolute;
  background: #2563eb;
  pointer-events: none;
}
```

(Production consumers style themselves; we only ship the data attributes.)

---

## Versioning

This is additive to public API (`canAccept` optional, new exports for DnD components). Slated for `0.3.0` alongside the grid params + `unplaced` changes from earlier this branch. Bump occurs when the user calls "done."

---

## Risks

- jsdom's `PointerEvent` strips `clientX`/`clientY` — same shim/helper as Workspace tests.
- Zone-swap is only discoverable by pressing the zone background, not a panel. We accept this for v1.
- `elementsFromPoint` allocates per move; throttle/raf if hot-path becomes an issue (not for v1).
