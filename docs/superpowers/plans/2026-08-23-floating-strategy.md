# floatingStrategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `floatingStrategy`, a decorator that places marked items free over a container while delegating everything else to an inner tiling strategy.

**Architecture:** Every shipped strategy (`grid`, `strip`, `stack`) partitions its container. `floatingStrategy(inner?)` wraps one of them: `layout()` splits `items` on `meta.floating`, hands the rest to `inner` against the **full** container so tiling is unchanged, places the floating ones from its own state, and merges both into one `placements` map. Per-item state is `{ x, y, anchor }` — a continuous position plus a sticky corner cache — so dragging accumulates smoothly while a snapped panel survives a resize exactly.

**Tech Stack:** TypeScript, vitest. No new dependencies.

---

## Background the implementer needs

Read `docs/concepts.md` for the four data buckets before starting. Three facts this plan depends on:

- **`LayoutItem.meta` is the `membership.placement` bag**, projected by `nodeToLayoutItem`. Strategies read flags like `pinned` from there. That is where `floating` and `snapCorners` live — per-membership, cleared on detach, which is the right lifetime (a panel floats *in this parent*).
- **`checkStrategyConfig` reports unknown config keys.** Any key a consumer may pass must appear in `configSpec`, and `ConfigFieldSpec` is `'number' | 'boolean' | 'string' | readonly string[]` where the array form is an enum of allowed *scalars*. A list-valued config key is therefore not expressible — which is why eligible corners are per-item `meta.snapCorners`, not config.
- **`CLAUDE.md`'s trace import path is stale.** It says `import { trace } from '@windease/core'`; the actual code uses `import { trace } from '../trace.js'` (see `src/layout/stack.ts`). Follow the code.

### Why state is `{ x, y, anchor }` and not `{ anchor } | { x, y }`

`LayoutEvent` has no drag-end kind, so snapping is live during the drag. If state held only the anchor while snapped, `layout()` would resolve it to the corner origin every frame, and each incoming delta would be measured from that same origin — a slow drag out of a corner would re-snap forever and never escape. So `x, y` always accumulate, and `anchor` is a sticky cache derived from them.

The visible consequence, which is correct sticky-snap behavior: un-snapping jumps the panel up to `snapThreshold` pixels at once.

### Why motion comes from `dx`/`dy`, not `payload.point`

The `LayoutEvent` doc reserves `point` for a strategy whose extents are *quantized* — grid cells, where a few pixels round to no change and a delta-accumulating drag never moves. A floating position is continuous pixels, so deltas accumulate exactly.

Resolving against `point` instead would need the pointer from the previous event held in state, and there is no drag-end event to clear it: the first move of the *next* gesture would measure against where the last one ended and teleport the panel by up to its own width. It would also persist that pointer into the container state, which snapshots. Nothing in state is per-gesture.

### Why the drag handle is a band, not the whole panel

`AffordanceLayer` renders each affordance as an interactive `div` at its rect plus `hitPad` (4px), `z-index: 1`, pointer events on (`src/react/affordances.tsx:33`). A handle covering the whole panel therefore makes the panel's own content unclickable. `handleSize` confines it to a band at the top; a host that wants "drag anywhere except the buttons" turns the built-in handle off (`affordances={false}`) and calls `dispatchAffordance` itself, which is what labkit's `FloatingPanel` does.

---

## File Structure

- Create: `src/layout/floating.ts` — the strategy factory, its state, and the corner math.
- Create: `src/layout/floating.test.ts` — layout, delegation, and config tests.
- Create: `src/layout/floating.reduce.test.ts` — drag and snap tests, kept separate because `reduce` has its own setup.
- Create: `src/layout/floating.entry.test.ts` — the export reaches a consumer.
- Create: `src/react/stories/Floating.stories.tsx` — the operable story the browser spec drives.
- Create: `e2e/floating.spec.ts` — the drag-and-snap gesture in a real browser.
- Modify: `src/index.ts` — export the factory and its types.
- Modify: `README.md`, `CHANGELOG.md` — document it under `## Unreleased`.
- Modify: `TODO.md` — remove the "Floating chrome over a tiled zone" section's proposal body, leaving only the deferred z-order and keyboard-move notes.

---

### Task 1: Corner math

**Files:**
- Create: `src/layout/floating.ts`
- Test: `src/layout/floating.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { cornerOrigin, FLOATING_CORNERS, snapCorner } from './floating.js';

const container = { w: 400, h: 300 };
const size = { w: 100, h: 80 };

describe('cornerOrigin', () => {
  it('insets from the named corner', () => {
    expect(cornerOrigin('top-left', size, container, 12)).toEqual({ x: 12, y: 12 });
    expect(cornerOrigin('top-right', size, container, 12)).toEqual({ x: 288, y: 12 });
    expect(cornerOrigin('bottom-left', size, container, 12)).toEqual({ x: 12, y: 208 });
    expect(cornerOrigin('bottom-right', size, container, 12)).toEqual({ x: 288, y: 208 });
  });
});

describe('snapCorner', () => {
  const eligible = FLOATING_CORNERS;

  it('captures a position resting exactly on the corner origin', () => {
    expect(snapCorner({ x: 12, y: 12 }, size, container, 12, 12, eligible)).toBe('top-left');
  });

  it('captures the shoved-into-the-corner case that a radius metric rejects', () => {
    // (0,0) is 12 on each axis from the (12,12) origin, but 16.97 away by radius.
    expect(snapCorner({ x: 0, y: 0 }, size, container, 12, 12, eligible)).toBe('top-left');
  });

  it('rejects a position past the threshold on one axis only', () => {
    expect(snapCorner({ x: 12, y: 25 }, size, container, 12, 12, eligible)).toBeNull();
  });

  it('never captures a corner outside the eligible set', () => {
    expect(snapCorner({ x: 0, y: 0 }, size, container, 12, 12, ['bottom-right'])).toBeNull();
  });

  it('picks the closer corner when two are in range', () => {
    const tiny = { w: 10, h: 10 };
    const narrow = { w: 40, h: 300 };
    // origins are x=12 (left) and x=18 (right); a position at x=17 is nearer the right.
    expect(snapCorner({ x: 17, y: 12 }, tiny, narrow, 12, 12, ['top-left', 'top-right'])).toBe(
      'top-right',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/layout/floating.test.ts`
Expected: FAIL — `Failed to resolve import "./floating.js"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/layout/floating.ts
import type { Size } from '../layout-types.js';

export const FLOATING_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export type Corner = (typeof FLOATING_CORNERS)[number];

export interface Point {
  x: number;
  y: number;
}

/** Where an item of `size` rests when anchored to `corner`, `inset` px in on both axes. */
export function cornerOrigin(corner: Corner, size: Size, container: Size, inset: number): Point {
  const left = corner === 'top-left' || corner === 'bottom-left';
  const top = corner === 'top-left' || corner === 'top-right';
  return {
    x: left ? inset : container.w - size.w - inset,
    y: top ? inset : container.h - size.h - inset,
  };
}

/**
 * Nearest eligible corner whose resting origin is within `threshold` of `at` on
 * BOTH axes, or null. Per-axis rather than by radius: with inset and threshold
 * both 12, a panel shoved into the corner sits at (0,0), which is 12 away on each
 * axis but 16.97 away by radius — the gesture that most clearly means "snap here".
 */
export function snapCorner(
  at: Point,
  size: Size,
  container: Size,
  inset: number,
  threshold: number,
  eligible: readonly Corner[],
): Corner | null {
  let best: Corner | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const corner of eligible) {
    const origin = cornerOrigin(corner, size, container, inset);
    const dx = Math.abs(origin.x - at.x);
    const dy = Math.abs(origin.y - at.y);
    if (dx > threshold || dy > threshold) continue;
    const distance = Math.max(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = corner;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/layout/floating.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/layout/floating.ts src/layout/floating.test.ts
git commit -m "resolve a floating item's corner by per-axis distance"
```

---

### Task 2: Item predicates and placement resolution

**Files:**
- Modify: `src/layout/floating.ts`
- Test: `src/layout/floating.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/layout/floating.test.ts`:

```ts
import { eligibleCorners, isFloating, rectOf } from './floating.js';
import type { LayoutItem } from '../layout-types.js';

describe('isFloating', () => {
  it('is true only for an item whose placement bag sets floating', () => {
    expect(isFloating({ id: 'a', meta: { floating: true } })).toBe(true);
    expect(isFloating({ id: 'a', meta: { floating: false } })).toBe(false);
    expect(isFloating({ id: 'a' })).toBe(false);
  });
});

describe('eligibleCorners', () => {
  it('defaults to every corner', () => {
    expect(eligibleCorners({ id: 'a' })).toEqual(FLOATING_CORNERS);
  });

  it('honors a valid subset', () => {
    expect(eligibleCorners({ id: 'a', meta: { snapCorners: ['top-right'] } })).toEqual([
      'top-right',
    ]);
  });

  it('falls back to every corner when the subset names nothing real', () => {
    expect(eligibleCorners({ id: 'a', meta: { snapCorners: ['middle'] } })).toEqual(
      FLOATING_CORNERS,
    );
  });
});

describe('rectOf', () => {
  const item: LayoutItem = { id: 'a', meta: { floating: true }, natural: { w: 100, h: 80 } };

  it('resolves an anchored item against the corner, ignoring stored coordinates', () => {
    const rect = rectOf(item, { x: 999, y: 999, anchor: 'bottom-right' }, container, 12);
    expect(rect).toEqual({ x: 288, y: 208, w: 100, h: 80 });
  });

  it('clamps a free item inside the container', () => {
    expect(rectOf(item, { x: -50, y: 999, anchor: null }, container, 12)).toEqual({
      x: 0,
      y: 220,
      w: 100,
      h: 80,
    });
  });

  it('falls back to preferredSize when nothing has measured the item yet', () => {
    const unmeasured: LayoutItem = {
      id: 'a',
      meta: { floating: true },
      hints: { preferredSize: { w: 40, h: 20 } },
    };
    expect(rectOf(unmeasured, { x: 0, y: 0, anchor: null }, container, 12).w).toBe(40);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/layout/floating.test.ts`
Expected: FAIL — `isFloating is not exported by ./floating.js`

- [ ] **Step 3: Write minimal implementation**

Append to `src/layout/floating.ts`:

```ts
import type { LayoutItem, Rect } from '../layout-types.js';

/** Where one floating item rests. `anchor` is a sticky cache over `x`/`y`. */
export interface FloatingPlacement {
  x: number;
  y: number;
  anchor: Corner | null;
}

export function isFloating(item: LayoutItem): boolean {
  return item.meta?.floating === true;
}

export function eligibleCorners(item: LayoutItem): readonly Corner[] {
  const raw = item.meta?.snapCorners;
  if (!Array.isArray(raw)) return FLOATING_CORNERS;
  const kept = raw.filter((c): c is Corner =>
    (FLOATING_CORNERS as readonly string[]).includes(c as string),
  );
  return kept.length > 0 ? kept : FLOATING_CORNERS;
}

export function sizeOf(item: LayoutItem): Size {
  return item.natural ?? item.hints?.preferredSize ?? { w: 0, h: 0 };
}

export function clampToContainer(at: Point, size: Size, container: Size): Point {
  return {
    x: Math.max(0, Math.min(at.x, container.w - size.w)),
    y: Math.max(0, Math.min(at.y, container.h - size.h)),
  };
}

export function rectOf(
  item: LayoutItem,
  place: FloatingPlacement,
  container: Size,
  inset: number,
): Rect {
  const size = sizeOf(item);
  const origin =
    place.anchor === null
      ? clampToContainer(place, size, container)
      : cornerOrigin(place.anchor, size, container, inset);
  return { x: origin.x, y: origin.y, w: size.w, h: size.h };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/layout/floating.test.ts`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add src/layout/floating.ts src/layout/floating.test.ts
git commit -m "read a floating item's placement off its membership bag"
```

---

### Task 3: The strategy factory and its layout pass

**Files:**
- Modify: `src/layout/floating.ts`
- Test: `src/layout/floating.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/layout/floating.test.ts`:

```ts
import { floatingStrategy } from './floating.js';
import { stackStrategy } from './stack.js';

const panel: LayoutItem = { id: 'legend', meta: { floating: true }, natural: { w: 100, h: 80 } };
const pane: LayoutItem = { id: 'main' };

describe('floatingStrategy.layout', () => {
  it('places a floating item at its default anchor with no inner strategy', () => {
    const s = floatingStrategy();
    const state = s.initialState([panel], {});
    const r = s.layout({ items: [panel], container, state, options: {} });
    expect(r.placements.get('legend')).toEqual({ x: 12, y: 208, w: 100, h: 80 });
  });

  it('honors defaultAnchor when seeding state', () => {
    const s = floatingStrategy();
    const state = s.initialState([panel], { defaultAnchor: 'top-right' });
    const r = s.layout({ items: [panel], container, state, options: { defaultAnchor: 'top-right' } });
    expect(r.placements.get('legend')).toEqual({ x: 288, y: 12, w: 100, h: 80 });
  });

  it('gives the inner strategy the full container, unreduced by the panel', () => {
    const s = floatingStrategy(stackStrategy);
    const state = s.initialState([panel, pane], {});
    const r = s.layout({ items: [panel, pane], container, state, options: { activeId: 'main' } });
    expect(r.placements.get('main')).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('never shows a floating item to the inner strategy', () => {
    const seen: string[][] = [];
    const spy = {
      name: 'spy',
      layout: ({ items }: { items: LayoutItem[] }) => {
        seen.push(items.map((i) => i.id));
        return { placements: new Map(), affordances: [] };
      },
    };
    const s = floatingStrategy(spy);
    s.layout({ items: [panel, pane], container, state: s.initialState([panel, pane], {}), options: {} });
    expect(seen).toEqual([['main']]);
  });

  it('emits one namespaced drag-xy affordance per floating item', () => {
    const s = floatingStrategy();
    const r = s.layout({ items: [panel], container, state: s.initialState([panel], {}), options: {} });
    expect(r.affordances).toHaveLength(1);
    expect(r.affordances[0]).toMatchObject({
      id: 'floating:drag:legend',
      kind: 'drag-xy',
      childId: 'legend',
      cursor: 'grab',
      rect: { x: 12, y: 208, w: 100, h: 80 },
    });
  });

  it('confines the handle to a band at the top of the item when handleSize is set', () => {
    const s = floatingStrategy();
    const r = s.layout({
      items: [panel],
      container,
      state: s.initialState([panel], {}),
      options: { handleSize: 20 },
    });
    expect(r.affordances[0]?.rect).toEqual({ x: 12, y: 208, w: 100, h: 20 });
  });

  it('withholds an item nothing has sized yet rather than placing it at 0x0', () => {
    const s = floatingStrategy();
    const unsized: LayoutItem = { id: 'ghost', meta: { floating: true } };
    const r = s.layout({
      items: [unsized],
      container,
      state: s.initialState([unsized], {}),
      options: {},
    });
    expect(r.placements.has('ghost')).toBe(false);
    expect(r.unplaced).toEqual(['ghost']);
    expect(r.affordances).toEqual([]);
  });

  it('never writes into the map the inner strategy returned', () => {
    const innerMap = new Map<string, Rect>();
    const spy = { name: 'spy', layout: () => ({ placements: innerMap, affordances: [] }) };
    const s = floatingStrategy(spy);
    const r = s.layout({ items: [panel], container, state: s.initialState([panel], {}), options: {} });
    expect(innerMap.size).toBe(0);
    expect(r.placements.has('legend')).toBe(true);
  });

  it('carries the inner strategy affordances and unplaced through', () => {
    const s = floatingStrategy(stackStrategy);
    const items = [panel, pane, { id: 'other' }];
    const r = s.layout({
      items,
      container,
      state: s.initialState(items, {}),
      options: { activeId: 'main' },
    });
    expect(r.unplaced).toEqual(['other']);
  });

  it('places a floating item that state has never seen, at the default anchor', () => {
    const s = floatingStrategy();
    const r = s.layout({ items: [panel], container, state: { at: {}, inner: undefined }, options: {} });
    expect(r.placements.get('legend')).toEqual({ x: 12, y: 208, w: 100, h: 80 });
  });

  it('declares every config key it reads', () => {
    expect(Object.keys(floatingStrategy().configSpec ?? {}).sort()).toEqual([
      'defaultAnchor',
      'handleSize',
      'inset',
      'snapThreshold',
    ]);
  });

  it('unions the inner strategy config keys into its own', () => {
    const keys = Object.keys(floatingStrategy(stackStrategy).configSpec ?? {});
    expect(keys).toContain('activeId');
    expect(keys).toContain('inset');
  });

  it('names itself after the strategy it wraps', () => {
    expect(floatingStrategy(stackStrategy).name).toBe('floating(stack)');
    expect(floatingStrategy().name).toBe('floating');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/layout/floating.test.ts`
Expected: FAIL — `floatingStrategy is not exported by ./floating.js`

- [ ] **Step 3: Write minimal implementation**

Append to `src/layout/floating.ts`:

```ts
import type {
  Affordance,
  LayoutResult,
  LayoutStrategy,
  StatefulLayoutStrategy,
} from '../layout-types.js';
import { trace } from '../trace.js';

export interface FloatingState<TInner = unknown> {
  /** Where each floating item rests, by item id. */
  at: Record<string, FloatingPlacement>;
  /** The wrapped strategy's own state, or undefined when nothing is wrapped. */
  inner: TInner;
}

export interface FloatingConfig {
  inset?: number;
  snapThreshold?: number;
  defaultAnchor?: Corner;
  /** Height of the drag band at the top of a floating item; 0 makes the whole
   *  item the handle, which covers its content. */
  handleSize?: number;
}

export const DEFAULT_INSET = 12;
export const DEFAULT_SNAP_THRESHOLD = 12;
export const DEFAULT_ANCHOR: Corner = 'bottom-left';

/** Affordance id prefix, so `reduce` can route without knowing the inner strategy. */
export const FLOATING_DRAG_PREFIX = 'floating:drag:';

function seed(options: Record<string, unknown> | undefined): FloatingPlacement {
  const anchor = (options as FloatingConfig | undefined)?.defaultAnchor ?? DEFAULT_ANCHOR;
  return { x: 0, y: 0, anchor };
}

export function floatingStrategy<TInner>(
  inner?: LayoutStrategy<TInner, string, unknown>,
): StatefulLayoutStrategy<FloatingState<TInner | undefined>, string> {
  return {
    name: inner ? `floating(${inner.name})` : 'floating',

    configSpec: {
      ...(inner?.configSpec ?? {}),
      inset: 'number',
      snapThreshold: 'number',
      handleSize: 'number',
      defaultAnchor: FLOATING_CORNERS,
    },

    initialState(items, options) {
      const at: Record<string, FloatingPlacement> = {};
      for (const item of items) if (isFloating(item)) at[item.id] = seed(options);
      const tiled = items.filter((i) => !isFloating(i));
      return { at, inner: inner?.initialState?.(tiled, options) };
    },

    layout({ items, container, state, options, preview }) {
      const cfg = options as FloatingConfig;
      const inset = cfg.inset ?? DEFAULT_INSET;
      const handleSize = cfg.handleSize ?? 0;
      const floating = items.filter(isFloating);
      const tiled = items.filter((i) => !isFloating(i));

      const result: LayoutResult<string> = inner
        ? inner.layout({
            items: tiled,
            container,
            state: state.inner as TInner,
            options,
            preview,
          })
        : { placements: new Map(), affordances: [] };

      const placements = new Map(result.placements);
      const affordances: Affordance[] = [...result.affordances];
      const unplaced = [...(result.unplaced ?? [])];
      for (const item of floating) {
        const size = sizeOf(item);
        // A 0x0 rect renders as a panel that vanished. Withhold it instead:
        // `natural` arrives only after a measurement, so this is the first pass.
        if (size.w <= 0 || size.h <= 0) {
          trace('layout', `floating: ${item.id} has no size yet, withheld`);
          unplaced.push(item.id);
          continue;
        }
        const rect = rectOf(item, state.at[item.id] ?? seed(options), container, inset);
        placements.set(item.id, rect);
        affordances.push({
          id: `${FLOATING_DRAG_PREFIX}${item.id}`,
          kind: 'drag-xy',
          rect: handleSize > 0 ? { ...rect, h: Math.min(handleSize, rect.h) } : rect,
          cursor: 'grab',
          childId: item.id,
          affects: [item.id],
        });
      }

      trace('layout', `floating: ${floating.length} over ${inner?.name ?? 'nothing'}`);
      const out: LayoutResult<string> = { ...result, placements, affordances };
      if (unplaced.length > 0) out.unplaced = unplaced;
      return out;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/layout/floating.test.ts`
Expected: PASS, 27 tests

- [ ] **Step 5: Commit**

```bash
git add src/layout/floating.ts src/layout/floating.test.ts
git commit -m "place floating items over an inner strategy's full container"
```

---

### Task 4: Dragging and live snapping

**Files:**
- Modify: `src/layout/floating.ts`
- Test: `src/layout/floating.reduce.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/layout/floating.reduce.test.ts
import { describe, expect, it } from 'vitest';
import type { LayoutEvent, LayoutItem } from '../layout-types.js';
import { floatingStrategy, type FloatingState } from './floating.js';

const container = { w: 400, h: 300 };
const panel: LayoutItem = { id: 'legend', meta: { floating: true }, natural: { w: 100, h: 80 } };
const context = { container, options: {}, items: [panel] };

const drag = (dx: number, dy: number): LayoutEvent => ({
  affordanceId: 'floating:drag:legend',
  kind: 'drag',
  payload: { dx, dy },
});

/** State with the panel free at (x, y). */
const at = (x: number, y: number): FloatingState<undefined> => ({
  at: { legend: { x, y, anchor: null } },
  inner: undefined,
});

describe('floatingStrategy.reduce', () => {
  const s = floatingStrategy();

  it('moves the panel by the drag delta', () => {
    expect(s.reduce!(at(200, 100), drag(10, 20), context).at.legend).toEqual({
      x: 210,
      y: 120,
      anchor: null,
    });
  });

  it('accumulates across events', () => {
    const first = s.reduce!(at(200, 100), drag(10, 20), context);
    expect(s.reduce!(first, drag(-4, 0), context).at.legend).toMatchObject({ x: 206, y: 120 });
  });

  it('snaps when the accumulated position lands within threshold of a corner', () => {
    // 30 - 18 = 12 on each axis: exactly the top-left resting origin.
    expect(s.reduce!(at(30, 30), drag(-18, -18), context).at.legend.anchor).toBe('top-left');
  });

  it('keeps accumulating past the corner while snapped, so a slow drag can escape', () => {
    let st = s.reduce!(at(16, 12), drag(-4, 0), context);
    expect(st.at.legend.anchor).toBe('top-left');
    for (let i = 0; i < 5; i++) st = s.reduce!(st, drag(4, 0), context);
    // 20px of travel is past the 12px threshold, so the anchor has let go.
    expect(st.at.legend.x).toBe(32);
    expect(st.at.legend.anchor).toBeNull();
  });

  it('clamps the position inside the container', () => {
    expect(s.reduce!(at(0, 0), drag(-50, -50), context).at.legend).toMatchObject({ x: 0, y: 0 });
  });

  it('never snaps to a corner the item excludes', () => {
    const only = [{ ...panel, meta: { floating: true, snapCorners: ['bottom-right'] } }];
    const next = s.reduce!(at(30, 30), drag(-18, -18), { ...context, items: only });
    expect(next.at.legend.anchor).toBeNull();
  });

  it('holds nothing per-gesture, so state survives a snapshot round trip', () => {
    const next = s.reduce!(at(200, 100), drag(10, 20), context);
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
    expect(Object.keys(next.at.legend!).sort()).toEqual(['anchor', 'x', 'y']);
  });

  it('ignores an event that moves nothing', () => {
    const before = at(200, 100);
    expect(s.reduce!(before, drag(0, 0), context)).toBe(before);
  });

  it('leaves state alone for an affordance it does not own', () => {
    const before = at(200, 100);
    expect(s.reduce!(before, { ...drag(1, 1), affordanceId: 'other' }, context)).toBe(before);
  });

  it('delegates an unowned affordance to the inner strategy', () => {
    const calls: string[] = [];
    const spy = {
      name: 'spy',
      layout: () => ({ placements: new Map(), affordances: [] }),
      reduce: (inner: number) => {
        calls.push('reduced');
        return inner + 1;
      },
    };
    const wrapped = floatingStrategy(spy);
    const next = wrapped.reduce!(
      { at: {}, inner: 1 },
      { affordanceId: 'spy:seam', kind: 'drag', payload: { dx: 5 } },
      context,
    );
    expect(calls).toEqual(['reduced']);
    expect(next.inner).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/layout/floating.reduce.test.ts`
Expected: FAIL — `s.reduce is not a function`

- [ ] **Step 3: Write minimal implementation**

Add `reduce` to the object returned by `floatingStrategy`, after `layout`:

```ts
    reduce(state, event, context) {
      if (!event.affordanceId.startsWith(FLOATING_DRAG_PREFIX)) {
        if (!inner?.reduce) return state;
        return { ...state, inner: inner.reduce(state.inner as TInner, event, context) };
      }

      const id = event.affordanceId.slice(FLOATING_DRAG_PREFIX.length);
      const item = context.items.find((i) => i.id === id);
      const dx = event.payload.dx ?? 0;
      const dy = event.payload.dy ?? 0;
      if (!item || (dx === 0 && dy === 0)) return state;

      const cfg = context.options as FloatingConfig;
      const inset = cfg.inset ?? DEFAULT_INSET;
      const threshold = cfg.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
      const place = state.at[id] ?? seed(context.options);
      const size = sizeOf(item);

      const next = clampToContainer(
        { x: place.x + dx, y: place.y + dy },
        size,
        context.container,
      );
      const anchor = snapCorner(
        next,
        size,
        context.container,
        inset,
        threshold,
        eligibleCorners(item),
      );

      trace('layout', `floating: ${id} -> ${anchor ?? `${next.x},${next.y}`}`);
      return { ...state, at: { ...state.at, [id]: { ...next, anchor } } };
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/layout/floating.reduce.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/layout/floating.ts src/layout/floating.reduce.test.ts
git commit -m "drag a floating item by accumulated deltas and snap live"
```

---

### Task 5: Delegate the optional hooks

**Files:**
- Modify: `src/layout/floating.ts`
- Test: `src/layout/floating.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/layout/floating.test.ts`:

```ts
describe('floatingStrategy delegation', () => {
  const inner = {
    name: 'picky',
    layout: () => ({ placements: new Map(), affordances: [] }),
    canAccept: (items: LayoutItem[]) => items.length < 3,
    navigate: () => 'from-inner' as const,
  };

  it('asks the inner strategy about a drop, without counting floating items', () => {
    const s = floatingStrategy(inner);
    // Two items, one of them floating: the inner strategy sees one, so it accepts.
    expect(s.canAccept?.([panel, pane], {})).toBe(true);
    expect(s.canAccept?.([pane, { id: 'third' }], {})).toBe(true);
    expect(s.canAccept?.([pane, { id: 'third' }, { id: 'fourth' }], {})).toBe(false);
  });

  it('accepts everything when nothing is wrapped', () => {
    expect(floatingStrategy().canAccept?.([panel, pane], {})).toBe(true);
  });

  it('lets the inner strategy answer navigation', () => {
    const s = floatingStrategy(inner);
    expect(s.navigate?.({ items: [pane], from: 'main', direction: 'left', options: {} })).toBe(
      'from-inner',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/layout/floating.test.ts`
Expected: FAIL — `s.canAccept is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to the object returned by `floatingStrategy`, after `reduce`:

```ts
    canAccept(items, options) {
      if (!inner?.canAccept) return true;
      return inner.canAccept(items.filter((i) => !isFloating(i)), options);
    },

    navigate(input) {
      if (!inner?.navigate) return undefined;
      return inner.navigate({ ...input, items: input.items.filter((i) => !isFloating(i)) });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/layout/floating.test.ts`
Expected: PASS, 30 tests

- [ ] **Step 5: Commit**

```bash
git add src/layout/floating.ts src/layout/floating.test.ts
git commit -m "hand drop and navigation questions to the wrapped strategy"
```

---

### Task 6: Export it and close the TODO

**Files:**
- Modify: `src/index.ts`
- Modify: `TODO.md`
- Test: `src/layout/floating.entry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/layout/floating.entry.test.ts
import { describe, expect, it } from 'vitest';
import { FLOATING_CORNERS, floatingStrategy, stackStrategy } from '../index.js';

describe('floating public entry', () => {
  it('reaches a consumer from the package entry point alone', () => {
    const s = floatingStrategy(stackStrategy);
    const panel = { id: 'legend', meta: { floating: true }, natural: { w: 10, h: 10 } };
    const state = s.initialState([panel], {});
    const r = s.layout({ items: [panel], container: { w: 100, h: 100 }, state, options: {} });
    expect(r.placements.get('legend')).toEqual({ x: 12, y: 78, w: 10, h: 10 });
  });

  it('exports the corner vocabulary a consumer needs to configure it', () => {
    expect(FLOATING_CORNERS).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/layout/floating.entry.test.ts`
Expected: FAIL — `"floatingStrategy" is not exported by src/index.ts`

- [ ] **Step 3: Add the export**

In `src/index.ts`, immediately after the `export { gridStrategy } from './layout/grid.js';` line:

```ts
export {
  type Corner,
  DEFAULT_ANCHOR,
  DEFAULT_INSET,
  DEFAULT_SNAP_THRESHOLD,
  FLOATING_CORNERS,
  FLOATING_DRAG_PREFIX,
  type FloatingConfig,
  type FloatingPlacement,
  type FloatingState,
  floatingStrategy,
} from './layout/floating.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/layout/floating.entry.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Trim the TODO entry**

In `TODO.md`, replace the whole "## Floating chrome over a tiled zone [HIGH]" section with:

```markdown
## Floating chrome: z-order [MED]

`floatingStrategy` shipped, but `LayoutResult` still carries no stacking order,
so nothing in the contract says a floating item renders above a tiled one —
today that falls to the host's render order. The options were an optional `z` on
`LayoutResult`, or a separate `floating?: Map<ItemId, Rect>` key alongside
`placements`. Both widen a type every strategy and every host shares, to serve a
need only this strategy has so far, so it waits for a second caller.

## Floating chrome: no keyboard move [MED]

`AffordanceLayer` binds its key handler only to an affordance carrying `bounds`,
which models a one-axis range — a seam's extent — and a free position is two
axes with no meaningful min or max. So a floating panel is pointer-only, and a
keyboard user cannot move it. Either `bounds` grows a two-axis form or the
affordance layer takes a second keyboard contract; neither is worth designing
before something wants it.
```

- [ ] **Step 6: Run the full suite and lint**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/layout/floating.entry.test.ts TODO.md
git commit -m "export floatingStrategy from the package entry"
```

---

### Task 7: A story and a browser spec

Every feature ships with an operable Ladle story, and the Playwright suite drives
Ladle — so this is where the gesture gets its only real coverage. A unit test
cannot catch a handle that swallows its own panel's clicks.

**Files:**
- Create: `src/react/stories/Floating.stories.tsx`
- Create: `e2e/floating.spec.ts`

- [ ] **Step 1: Write the story**

`<Container>` on `floatingStrategy(gridStrategy)`, three tiled panes, one floating
panel. Copy the setup from `Grid.stories.tsx`; the panel is a child whose placement
bag carries `floating: true` and `snapCorners`.

Two things the story must make operable, because they are the two decisions a
consumer makes:

- **`handleSize`** as a control. The panel's content holds a `<button>` that counts
  its own clicks: at `handleSize={0}` the handle covers the panel and the button is
  dead; at `handleSize={24}` the top band drags and the button works.
- **Corner snapping.** The panel drags freely and sticks at 12px from any corner in
  `snapCorners`, with `top-left` excluded so the excluded-corner rule is visible.

Give the panel `hints.sizing: { w: 'content', h: 'content' }` and wire
`observeNatural`, or set `hints.preferredSize` — with neither the strategy withholds
it and the story renders nothing.

Render the floating child last, since `LayoutResult` carries no z-order.

- [ ] **Step 2: Write the browser spec**

`e2e/floating.spec.ts`, following `e2e/resize.spec.ts` for the drag helper:

- dragging the handle to within a few px of the bottom-right corner leaves the panel
  resting at exactly 12px from both edges — the snap;
- dragging 40px back off that corner leaves it free, at neither corner — the escape;
- a drag toward `top-left` (excluded) leaves the panel unsnapped;
- with `handleSize={24}`, clicking the panel's button increments its count, and the
  same click at `handleSize={0}` does not.

- [ ] **Step 3: Run it**

Run: `npx playwright test e2e/floating.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/react/stories/Floating.stories.tsx e2e/floating.spec.ts
git commit -m "drive floating drag and corner snap from a story"
```

---

### Task 8: Document it

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a README section**

Find the section documenting `stackStrategy` and add after it:

````markdown
### `floatingStrategy(inner?)`

Places items marked `floating` free over the container, and delegates everything
else to the strategy it wraps. The inner strategy receives the **full** container
— a floating panel reserves no space.

```ts
import { floatingStrategy, gridStrategy } from 'windease';

const strategy = floatingStrategy(gridStrategy);
```

Mark an item floating through its placement bag, alongside the corners it may
snap to:

```ts
store.patchPlacement(panelId, { floating: true, snapCorners: ['bottom-left', 'bottom-right'] });
```

| Config | Default | Meaning |
| --- | --- | --- |
| `inset` | `12` | px from the corner a snapped item rests at |
| `snapThreshold` | `12` | per-axis px within which a corner captures |
| `defaultAnchor` | `'bottom-left'` | corner a newly floated item seeds at |
| `handleSize` | `0` | height of the drag band; `0` makes the whole item the handle |

**The handle covers what it sits on.** The built-in affordance is an interactive
element at its own rect, so at the default `handleSize` of `0` a floating panel's
own buttons and links cannot be clicked. Either set `handleSize` to a title-bar
band, or turn the built-in handles off (`<Container affordances={false}>`) and
dispatch the drag yourself:

```ts
layout.dispatchAffordance({
  affordanceId: `floating:drag:${panelId}`,
  kind: 'drag',
  payload: { dx, dy },
});
```

An item with neither `natural` nor `hints.preferredSize` is withheld rather than
placed at zero size — it appears in `unplaced` until something measures it.

Snapping is live during the drag — `LayoutEvent` has no drag-end kind — so an
item follows the pointer, sticks when it reaches a corner, and lets go once the
pointer travels `snapThreshold` past it.

Stacking order is not part of `LayoutResult`; render floating items above tiled
ones in the host.
````

- [ ] **Step 2: Add the changelog entry**

Under the existing `## Unreleased` heading in `CHANGELOG.md` — the release itself is
a separate decision, and `Unreleased` already holds this branch's other work:

```markdown
- **`floatingStrategy(inner?)`.** Places items marked `floating` in their placement
  bag free over the container, snapping to corners by per-axis distance, and
  delegates every other item to the wrapped strategy against the full container.
  `handleSize` confines the drag handle to a band so the panel's own content stays
  clickable; a host that wants a different grab rule turns the built-in handle off
  and dispatches `floating:drag:<id>` itself.
```

- [ ] **Step 3: Verify the whole build**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: all green

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "document floatingStrategy"
```

---

## Downstream

`@weasel-js/labkit` consumes this through a `FloatingPanel` component, and klieg's
corner lab composes that with a `Legend`. Those are separate plans, and both need a
published `windease` — or `npm link` — before they can build. Publishing is not part
of this plan: `## Unreleased` already carries drop-intent work that is still in
flight, so the version this ships in is decided when that branch lands.

Design: `~/src/blitsklieg/docs/superpowers/specs/2026-08-23-legend-palette-design.md`
(on klieg's `legend-palette` branch). Two claims there are superseded by this plan:
`reduce` takes `dx`/`dy` rather than absolute points, and a pointerdown anywhere on
the panel is the host's rule to implement, not the strategy's.
