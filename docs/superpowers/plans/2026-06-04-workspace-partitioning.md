# Workspace Partitioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `@windease/core@0.2.0` + `@windease/react@0.2.0` — a unified `LayoutStrategy` interface that handles both zone-internal and workspace-level layout, plus a `<Workspace>` React component with two built-in workspace strategies (`binarySplit`, `recursiveSplit`) and migration of the existing three zone strategies (`grid`, `stack`, `strip`) to the new interface.

**Architecture:** Strategies are pure functions emitting `{ placements, affordances }` plus an optional `reduce(state, event)`. Stateless zone strategies emit no affordances. Workspace strategies carry split state (ratios, trees) and emit drag affordances. `<Workspace>` owns React state, runs the strategy each render, wires built-in affordance kinds (drag/click/keypress) to pointer/keyboard events, and dispatches typed `LayoutEvent`s back to `strategy.reduce`.

**Tech Stack:** TypeScript 5.x, React 19, Vitest, Biome, Ladle, npm workspaces. No new runtime deps. Breaking change to `@windease/core`'s strategy interface; no external consumers yet.

**Spec:** `docs/superpowers/specs/2026-06-04-workspace-partitioning-design.md`

---

## File Structure

```
packages/core/src/
├── layout-types.ts          # NEW — unified LayoutItem, Rect, Size, Affordance, LayoutResult, LayoutEvent, LayoutStrategy
├── errors.ts                # MODIFY — extend WindeaseErrorCode union
├── zone.ts                  # MODIFY — drop Placement / LayoutStrategy / LayoutInput (move to layout-types); keep ZoneRecord
├── layout/
│   ├── grid.ts              # MIGRATE
│   ├── stack.ts             # MIGRATE
│   ├── strip.ts             # MIGRATE
│   ├── binarySplit.ts       # NEW
│   └── recursiveSplit.ts    # NEW
└── index.ts                 # MODIFY — update exports

packages/react/src/
├── Workspace.tsx            # NEW
├── Zone.tsx                 # MODIFY — call new strategy shape
├── index.ts                 # MODIFY — export Workspace
└── stories/
    ├── Workspace.stories.tsx     # NEW
    └── Playground.stories.tsx    # MODIFY — use Workspace instead of CSS grid
```

Versions: both packages → `0.2.0`. `@windease/react` dep on `@windease/core` bumps to `0.2.0`.

---

## Task 1: New layout types module

**Files:**
- Create: `packages/core/src/layout-types.ts`

- [ ] **Step 1: Write `packages/core/src/layout-types.ts`**

```ts
export type ItemId = string;
export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

export interface LayoutItem {
  id: ItemId;
  hints?: {
    minSize?: Size;
    preferredSize?: Size;
  };
}

export type BuiltinAffordanceKind = 'drag-x' | 'drag-y' | 'drag-xy' | 'click' | 'keypress';

export interface Affordance<TMeta = unknown> {
  id: string;
  kind: BuiltinAffordanceKind | string;
  rect: Rect;
  cursor?: string;
  meta?: TMeta;
}

export interface LayoutResult<TId extends string = string, TMeta = unknown> {
  placements: Map<TId, Rect>;
  affordances: Affordance<TMeta>[];
}

export interface LayoutEvent {
  affordanceId: string;
  kind: 'drag' | 'click' | 'key';
  payload: { dx?: number; dy?: number; key?: string };
}

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
  }): LayoutResult<TId, TMeta>;
  reduce?(state: TState, event: LayoutEvent): TState;
}
```

- [ ] **Step 2: Type-check builds**

Run: `npx tsc -b packages/core/tsconfig.json`
Expected: succeeds (the file has no consumers yet).

- [ ] **Step 3: Commit**

```
git add packages/core/src/layout-types.ts
git -c commit.gpgsign=false commit -m "feat(core): add unified layout-types module"
```

---

## Task 2: Extend WindeaseError code union

**Files:**
- Modify: `packages/core/src/errors.ts`
- Test: append to `packages/core/src/errors.test.ts`

- [ ] **Step 1: Modify `packages/core/src/errors.ts`** — add three codes:

```ts
export type WindeaseErrorCode =
  | 'UNKNOWN_WINDOW'
  | 'UNKNOWN_ZONE'
  | 'ILLEGAL_TRANSITION'
  | 'DUPLICATE_ZONE'
  | 'DUPLICATE_WINDOW'
  | 'ZONE_NOT_EMPTY'
  | 'UNKNOWN_STRATEGY'
  | 'WRONG_ITEM_COUNT'
  | 'UNKNOWN_AFFORDANCE_KIND'
  | 'NO_INITIAL_STATE';

export class WindeaseError extends Error {
  readonly code: WindeaseErrorCode;
  constructor(code: WindeaseErrorCode, message: string) {
    super(message);
    this.name = 'WindeaseError';
    this.code = code;
  }
}
```

- [ ] **Step 2: Append to `packages/core/src/errors.test.ts`** — verify all three new codes round-trip:

```ts
import { describe as describe2, it as it2, expect as expect2 } from 'vitest';

describe2('WindeaseError - workspace codes', () => {
  for (const code of ['WRONG_ITEM_COUNT', 'UNKNOWN_AFFORDANCE_KIND', 'NO_INITIAL_STATE'] as const) {
    it2(`carries ${code}`, () => {
      const e = new WindeaseError(code, `test ${code}`);
      expect2(e.code).toBe(code);
      expect2(e.message).toBe(`test ${code}`);
    });
  }
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/core/src/errors.test.ts`
Expected: PASS (1 original + 3 new = 4 tests).

- [ ] **Step 4: Commit**

```
git add packages/core/src/errors.ts packages/core/src/errors.test.ts
git -c commit.gpgsign=false commit -m "feat(core): add workspace error codes"
```

---

## Task 3: Migrate `zone.ts` to use layout-types

**Files:**
- Modify: `packages/core/src/zone.ts`

The current `zone.ts` defines `Placement`, `LayoutStrategy`, `LayoutInput`. These move to `layout-types.ts` (Task 1 added them). Update `zone.ts` to import and re-export, keeping only zone-specific types.

- [ ] **Step 1: Rewrite `packages/core/src/zone.ts`**:

```ts
import type { Rect, LayoutStrategy } from './layout-types.js';
import type { WindowId, ZoneId } from './window.js';

// Re-export Rect as Placement for v0.1 source compatibility within core.
export type Placement = Rect;
export type { LayoutStrategy };

export interface ZoneRecord {
  id: ZoneId;
  strategy: LayoutStrategy<unknown, WindowId, unknown>;
  windowIds: WindowId[];
  config: Record<string, unknown>;
}

export interface CreateZoneInput {
  id: ZoneId;
  strategy: LayoutStrategy<unknown, WindowId, unknown>;
  config?: Record<string, unknown>;
}

export function createZoneRecord(input: CreateZoneInput): ZoneRecord {
  return {
    id: input.id,
    strategy: input.strategy,
    windowIds: [],
    config: input.config ?? {},
  };
}
```

Note: the old `LayoutInput` interface is removed — strategies now receive `{ items, container, state, options }` instead of `{ zone, windows, viewport }`. Callers (Zone component, tests) update in later tasks.

- [ ] **Step 2: Type-check**

Run: `npx tsc -b packages/core/tsconfig.json`
Expected: compile errors in zone strategies (grid/stack/strip) and store.ts — they still use the old `LayoutInput`. That's expected; later tasks fix them.

If errors appear anywhere OTHER than `packages/core/src/layout/*.ts` and `packages/core/src/store.ts`, report it. Otherwise proceed; we'll fix migrations next.

- [ ] **Step 3: Commit (intentionally broken build — fixed in next tasks)**

```
git add packages/core/src/zone.ts
git -c commit.gpgsign=false commit -m "refactor(core): move strategy types to layout-types module"
```

---

## Task 4: Migrate `gridStrategy` to unified interface

**Files:**
- Modify: `packages/core/src/layout/grid.ts`
- Modify: `packages/core/src/layout/grid.test.ts`

- [ ] **Step 1: Rewrite `packages/core/src/layout/grid.ts`**:

```ts
import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import type { WindowId } from '../window.js';

interface GridConfig {
  cols?: number;
  gap?: number;
  padding?: number;
}

export const gridStrategy: LayoutStrategy<void, WindowId> = {
  name: 'grid',
  layout({
    items,
    container,
    options,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
  }): LayoutResult<WindowId> {
    const cfg = options as GridConfig;
    const cols = Math.max(1, cfg.cols ?? 1);
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<WindowId, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const rows = Math.ceil(items.length / cols);
    const usableW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding;
    const cellW = (usableW - gap * (cols - 1)) / cols;
    const cellH = (usableH - gap * (rows - 1)) / rows;

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      placements.set(item.id as WindowId, {
        x: padding + col * (cellW + gap),
        y: padding + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
    return { placements, affordances: [] };
  },
};
```

- [ ] **Step 2: Rewrite `packages/core/src/layout/grid.test.ts`** — drive via new `items` input:

```ts
import { describe, it, expect } from 'vitest';
import { gridStrategy } from './grid.js';
import { asWindowId } from '../window.js';

const mkItem = (id: string) => ({ id: asWindowId(id) });

describe('gridStrategy', () => {
  it('lays out items in a grid with cols, gap, padding', () => {
    const result = gridStrategy.layout({
      items: [mkItem('a'), mkItem('b'), mkItem('c'), mkItem('d')],
      container: { w: 410, h: 410 },
      state: undefined as void,
      options: { cols: 2, gap: 10, padding: 20 },
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 20, y: 20, w: 180, h: 180 });
    expect(result.placements.get(asWindowId('b'))).toEqual({ x: 210, y: 20, w: 180, h: 180 });
    expect(result.placements.get(asWindowId('c'))).toEqual({ x: 20, y: 210, w: 180, h: 180 });
    expect(result.placements.get(asWindowId('d'))).toEqual({ x: 210, y: 210, w: 180, h: 180 });
    expect(result.affordances).toEqual([]);
  });

  it('defaults cols=1, gap=0, padding=0', () => {
    const result = gridStrategy.layout({
      items: [mkItem('a')],
      container: { w: 100, h: 80 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it('returns empty for empty items', () => {
    const result = gridStrategy.layout({
      items: [],
      container: { w: 100, h: 100 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.size).toBe(0);
    expect(result.affordances).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/core/src/layout/grid.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 4: Commit**

```
git add packages/core/src/layout/grid.ts packages/core/src/layout/grid.test.ts
git -c commit.gpgsign=false commit -m "refactor(core): migrate gridStrategy to unified interface"
```

---

## Task 5: Migrate `stackStrategy` to unified interface

**Files:**
- Modify: `packages/core/src/layout/stack.ts`
- Modify: `packages/core/src/layout/stack.test.ts`

- [ ] **Step 1: Rewrite `packages/core/src/layout/stack.ts`**:

```ts
import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import type { WindowId } from '../window.js';

interface StackConfig {
  gap?: number;
  padding?: number;
}

export const stackStrategy: LayoutStrategy<void, WindowId> = {
  name: 'stack',
  layout({
    items,
    container,
    options,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
  }): LayoutResult<WindowId> {
    const cfg = options as StackConfig;
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<WindowId, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const colX = padding;
    const colW = container.w - 2 * padding;
    const usableH = container.h - 2 * padding - gap * (items.length - 1);

    const totalPreferred = items.reduce(
      (sum, item) => sum + (item.hints?.preferredSize?.h ?? 0),
      0,
    );
    const hasPreferred = totalPreferred > 0;
    const fallbackH = usableH / items.length;

    let y = padding;
    for (const item of items) {
      const h = hasPreferred ? (item.hints?.preferredSize?.h ?? 0) : fallbackH;
      placements.set(item.id as WindowId, { x: colX, y, w: colW, h });
      y += h + gap;
    }
    return { placements, affordances: [] };
  },
};
```

- [ ] **Step 2: Rewrite `packages/core/src/layout/stack.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { stackStrategy } from './stack.js';
import { asWindowId } from '../window.js';
import type { LayoutItem } from '../layout-types.js';

const mkItem = (id: string, preferredH?: number): LayoutItem => ({
  id: asWindowId(id),
  ...(preferredH ? { hints: { preferredSize: { w: 0, h: preferredH } } } : {}),
});

describe('stackStrategy', () => {
  it('stacks items vertically using preferredSize.h, gap, padding', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a', 50), mkItem('b', 30)],
      container: { w: 200, h: 200 },
      state: undefined as void,
      options: { gap: 5, padding: 10 },
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 10, y: 10, w: 180, h: 50 });
    expect(result.placements.get(asWindowId('b'))).toEqual({ x: 10, y: 65, w: 180, h: 30 });
  });

  it('falls back to equal heights when no preferredSize', () => {
    const result = stackStrategy.layout({
      items: [mkItem('a'), mkItem('b')],
      container: { w: 100, h: 100 },
      state: undefined as void,
      options: {},
    });
    expect(result.placements.get(asWindowId('a'))?.h).toBe(50);
    expect(result.placements.get(asWindowId('b'))?.h).toBe(50);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/core/src/layout/stack.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 4: Commit**

```
git add packages/core/src/layout/stack.ts packages/core/src/layout/stack.test.ts
git -c commit.gpgsign=false commit -m "refactor(core): migrate stackStrategy to unified interface"
```

---

## Task 6: Migrate `stripStrategy` to unified interface

**Files:**
- Modify: `packages/core/src/layout/strip.ts`
- Modify: `packages/core/src/layout/strip.test.ts`

- [ ] **Step 1: Rewrite `packages/core/src/layout/strip.ts`**:

```ts
import type {
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';
import type { WindowId } from '../window.js';

interface StripConfig {
  axis?: 'x' | 'y';
  gap?: number;
  padding?: number;
}

export const stripStrategy: LayoutStrategy<void, WindowId> = {
  name: 'strip',
  layout({
    items,
    container,
    options,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
  }): LayoutResult<WindowId> {
    const cfg = options as StripConfig;
    const axis = cfg.axis ?? 'x';
    const gap = cfg.gap ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<WindowId, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    if (axis === 'x') {
      const y = padding;
      const h = container.h - 2 * padding;
      let x = padding;
      for (const item of items) {
        const w = item.hints?.preferredSize?.w ?? 0;
        placements.set(item.id as WindowId, { x, y, w, h });
        x += w + gap;
      }
    } else {
      const x = padding;
      const w = container.w - 2 * padding;
      let y = padding;
      for (const item of items) {
        const h = item.hints?.preferredSize?.h ?? 0;
        placements.set(item.id as WindowId, { x, y, w, h });
        y += h + gap;
      }
    }
    return { placements, affordances: [] };
  },
};
```

- [ ] **Step 2: Rewrite `packages/core/src/layout/strip.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { stripStrategy } from './strip.js';
import { asWindowId } from '../window.js';
import type { LayoutItem } from '../layout-types.js';

const mkItem = (id: string, opts?: { preferredW?: number; preferredH?: number }): LayoutItem => ({
  id: asWindowId(id),
  ...(opts?.preferredW || opts?.preferredH
    ? { hints: { preferredSize: { w: opts?.preferredW ?? 0, h: opts?.preferredH ?? 0 } } }
    : {}),
});

describe('stripStrategy', () => {
  it('lays out horizontally by default', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredW: 60 }), mkItem('b', { preferredW: 40 })],
      container: { w: 200, h: 40 },
      state: undefined as void,
      options: { axis: 'x', gap: 4, padding: 8 },
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 8, y: 8, w: 60, h: 24 });
    expect(result.placements.get(asWindowId('b'))).toEqual({ x: 72, y: 8, w: 40, h: 24 });
  });

  it('axis y lays out vertically', () => {
    const result = stripStrategy.layout({
      items: [mkItem('a', { preferredH: 20 }), mkItem('b', { preferredH: 30 })],
      container: { w: 50, h: 100 },
      state: undefined as void,
      options: { axis: 'y', gap: 0, padding: 0 },
    });
    expect(result.placements.get(asWindowId('a'))).toEqual({ x: 0, y: 0, w: 50, h: 20 });
    expect(result.placements.get(asWindowId('b'))).toEqual({ x: 0, y: 20, w: 50, h: 30 });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run packages/core/src/layout/strip.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 4: Commit**

```
git add packages/core/src/layout/strip.ts packages/core/src/layout/strip.test.ts
git -c commit.gpgsign=false commit -m "refactor(core): migrate stripStrategy to unified interface"
```

---

## Task 7: Adapt `<Zone>` to new strategy interface + fix store.ts breakage

**Files:**
- Modify: `packages/react/src/Zone.tsx`
- Modify: `packages/core/src/store.ts` (only if Task 3 left compile errors there)

- [ ] **Step 1: Inspect store.ts for breakage**

Run: `npx tsc -b packages/core/tsconfig.json` from `/Users/mike/src/windease/`
Look for errors in `store.ts`. The likely culprit: `import type { CreateZoneInput, ZoneRecord, createZoneRecord } from './zone.js'` is unchanged in shape (still exists), but `LayoutStrategy` import for `hydrate(snap, { strategies: Record<string, LayoutStrategy> })` is now generic-parameterized.

Update the import in `packages/core/src/store.ts` if needed:

```ts
import type { LayoutStrategy } from './layout-types.js';
```

(Drop any old `LayoutStrategy` import from `./zone.js` if present.)

And the `hydrate` signature:

```ts
hydrate(snap: SerializedStore, opts: { strategies: Record<string, LayoutStrategy<unknown, WindowId, unknown>> }): void {
```

`snapshot.ts` may also need the same `LayoutStrategy` import update — search for it and fix similarly.

- [ ] **Step 2: Rewrite `packages/react/src/Zone.tsx`**

The current Zone calls `zone.strategy.layout({ zone, windows: visible, viewport })` and reads a flat `Map<WindowId, Placement>`. Update to use the new interface.

```tsx
// biome-ignore lint/correctness/useExhaustiveDependencies: Depend on whether viewport is provided, not on its identity — consumers commonly pass inline-literal viewport props.
import * as React from 'react';
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import type {
  LayoutItem,
  Rect,
  WindowId,
  WindowRecord,
  ZoneId,
} from '@windease/core';
import { useWindease, useZone } from './hooks.js';

interface ZoneProps {
  id: ZoneId;
  viewport?: { w: number; h: number };
  children: (window: WindowRecord, placement: Rect) => ReactNode;
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

export function Zone({ id, viewport, children }: ZoneProps): React.JSX.Element {
  const store = useWindease();
  const zone = useZone(id);
  const ref = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (viewport || !ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setMeasured({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // biome-ignore lint/correctness/useExhaustiveDependencies: Depend on whether viewport is provided, not on its identity — consumers commonly pass inline-literal viewport props.
  }, [viewport === undefined]);

  const effectiveViewport = viewport ?? measured;
  const visible: WindowRecord[] = zone
    ? zone.windowIds
        .map((wid) => store.getWindow(wid))
        .filter((w): w is WindowRecord => w?.lifecycle.state === 'visible')
    : [];

  let placements: Map<WindowId, Rect> = new Map();
  if (zone && effectiveViewport && visible.length > 0) {
    const items: LayoutItem[] = visible.map((w) => ({
      id: w.id,
      ...(w.hints && Object.keys(w.hints).length > 0 ? { hints: w.hints } : {}),
    }));
    const result = zone.strategy.layout({
      items,
      container: effectiveViewport,
      state: undefined as never,
      options: zone.config,
    });
    placements = result.placements as Map<WindowId, Rect>;
  }

  return (
    <div ref={ref} className="windease-zone" data-zone-id={id}>
      {visible.map((w) => {
        const p = placements.get(w.id);
        if (!p) {
          warnOnce(
            `${id}:${w.id}`,
            `[windease] zone "${id}" strategy "${zone?.strategy.name}" produced no placement for window "${w.id}"`,
          );
          return null;
        }
        const style: CSSProperties = {
          '--w-x': `${p.x}px`,
          '--w-y': `${p.y}px`,
          '--w-w': `${p.w}px`,
          '--w-h': `${p.h}px`,
        } as CSSProperties;
        return (
          <div
            key={w.id}
            className="windease-window"
            data-window-id={w.id}
            data-window-kind={w.kind}
            data-window-state={w.lifecycle.state}
            style={style}
          >
            {children(w, p)}
          </div>
        );
      })}
    </div>
  );
}
```

(The biome-ignore directive at the top was carried from v0.1; keep it.)

- [ ] **Step 3: Build + test**

Run: `npx tsc -b` from `/Users/mike/src/windease/`
Expected: clean.

Run: `npm test`
Expected: full suite green (existing zone tests + zone-component tests + everything).

- [ ] **Step 4: Commit**

```
git add packages/core/src/store.ts packages/core/src/snapshot.ts packages/react/src/Zone.tsx
git -c commit.gpgsign=false commit -m "refactor: adapt Zone + store to unified strategy interface"
```

(Stage only the files you actually changed.)

---

## Task 8: `binarySplit` strategy (TDD)

**Files:**
- Create: `packages/core/src/layout/binarySplit.test.ts`
- Create: `packages/core/src/layout/binarySplit.ts`

- [ ] **Step 1: Write `packages/core/src/layout/binarySplit.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { binarySplit, type BinarySplitState } from './binarySplit.js';
import { WindeaseError } from '../errors.js';

const items2 = [{ id: 'a' }, { id: 'b' }];

describe('binarySplit', () => {
  it('initialState returns ratio 0.5', () => {
    expect(binarySplit.initialState?.(items2)).toEqual({ ratio: 0.5 });
  });

  it('horizontal split places left then right with gutter', () => {
    const result = binarySplit.layout({
      items: items2,
      container: { w: 200, h: 100 },
      state: { ratio: 0.5 },
      options: { direction: 'horizontal', gutterSize: 4 },
    });
    // left: 0..98 (200*0.5 - 4/2 = 98); right: 102..200
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 98, h: 100 });
    expect(result.placements.get('b')).toEqual({ x: 102, y: 0, w: 98, h: 100 });
    expect(result.affordances).toHaveLength(1);
    expect(result.affordances[0]).toMatchObject({
      kind: 'drag-x',
      cursor: 'col-resize',
      rect: { x: 98, y: 0, w: 4, h: 100 },
    });
    expect(result.affordances[0]!.meta).toMatchObject({ direction: 'horizontal' });
  });

  it('vertical split places top then bottom with gutter', () => {
    const result = binarySplit.layout({
      items: items2,
      container: { w: 100, h: 200 },
      state: { ratio: 0.5 },
      options: { direction: 'vertical', gutterSize: 4 },
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 98 });
    expect(result.placements.get('b')).toEqual({ x: 0, y: 102, w: 100, h: 98 });
    expect(result.affordances[0]).toMatchObject({
      kind: 'drag-y',
      cursor: 'row-resize',
    });
  });

  it('throws WRONG_ITEM_COUNT when items != 2', () => {
    expect(() =>
      binarySplit.layout({
        items: [{ id: 'a' }],
        container: { w: 100, h: 100 },
        state: { ratio: 0.5 },
        options: { direction: 'horizontal' },
      }),
    ).toThrow(WindeaseError);
  });

  it('reduce(drag) updates ratio via pixelsPerUnit', () => {
    const state: BinarySplitState = { ratio: 0.5 };
    // Layout first to capture pixelsPerUnit
    const result = binarySplit.layout({
      items: items2,
      container: { w: 200, h: 100 },
      state,
      options: { direction: 'horizontal' },
    });
    const pixelsPerUnit = (result.affordances[0]!.meta as { pixelsPerUnit: number }).pixelsPerUnit;
    // Drag right by 20px → ratio += 20 * pixelsPerUnit
    const next = binarySplit.reduce!(state, {
      affordanceId: result.affordances[0]!.id,
      kind: 'drag',
      payload: { dx: 20, dy: 0 },
    });
    expect(next.ratio).toBeCloseTo(0.5 + 20 * pixelsPerUnit, 5);
  });

  it('reduce clamps to [minRatio, maxRatio]', () => {
    // Use ratio extremely close to max; large dx must not exceed cap
    const result = binarySplit.layout({
      items: items2,
      container: { w: 100, h: 100 },
      state: { ratio: 0.94 },
      options: { direction: 'horizontal', maxRatio: 0.95 },
    });
    // hm — `options` aren't visible to reduce. Reduce uses defaults.
    // So test default cap of 0.95:
    const next = binarySplit.reduce!({ ratio: 0.94 }, {
      affordanceId: result.affordances[0]!.id,
      kind: 'drag',
      payload: { dx: 1000, dy: 0 },
    });
    expect(next.ratio).toBe(0.95);
  });
});
```

- [ ] **Step 2: Run tests (expect FAIL — module missing)**

Run: `npx vitest run packages/core/src/layout/binarySplit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/core/src/layout/binarySplit.ts`**:

```ts
import { WindeaseError } from '../errors.js';
import type {
  Affordance,
  LayoutEvent,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';

export interface BinarySplitState {
  ratio: number;
}

export interface BinarySplitMeta {
  direction: 'horizontal' | 'vertical';
  pixelsPerUnit: number;
}

interface BinarySplitOptions {
  direction?: 'horizontal' | 'vertical';
  gutterSize?: number;
  minRatio?: number;
  maxRatio?: number;
}

const DEFAULT_MIN = 0.05;
const DEFAULT_MAX = 0.95;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export const binarySplit: LayoutStrategy<BinarySplitState, string, BinarySplitMeta> = {
  name: 'binarySplit',
  initialState(_items: LayoutItem[]): BinarySplitState {
    return { ratio: 0.5 };
  },
  layout({
    items,
    container,
    state,
    options,
  }: {
    items: LayoutItem[];
    container: Size;
    state: BinarySplitState;
    options: Record<string, unknown>;
  }): LayoutResult<string, BinarySplitMeta> {
    if (items.length !== 2) {
      throw new WindeaseError(
        'WRONG_ITEM_COUNT',
        `binarySplit requires exactly 2 items, got ${items.length}`,
      );
    }
    const cfg = options as BinarySplitOptions;
    const direction = cfg.direction ?? 'horizontal';
    const gutter = cfg.gutterSize ?? 4;
    const minR = cfg.minRatio ?? DEFAULT_MIN;
    const maxR = cfg.maxRatio ?? DEFAULT_MAX;
    const r = clamp(state.ratio, minR, maxR);

    const placements = new Map<string, Rect>();
    const a = items[0]!;
    const b = items[1]!;
    let affordance: Affordance<BinarySplitMeta>;

    if (direction === 'horizontal') {
      const total = container.w;
      const halfG = gutter / 2;
      const aw = total * r - halfG;
      const bx = total * r + halfG;
      placements.set(a.id, { x: 0, y: 0, w: aw, h: container.h });
      placements.set(b.id, { x: bx, y: 0, w: total - bx, h: container.h });
      affordance = {
        id: 'split-0',
        kind: 'drag-x',
        rect: { x: aw, y: 0, w: gutter, h: container.h },
        cursor: 'col-resize',
        meta: { direction, pixelsPerUnit: 1 / total },
      };
    } else {
      const total = container.h;
      const halfG = gutter / 2;
      const ah = total * r - halfG;
      const by = total * r + halfG;
      placements.set(a.id, { x: 0, y: 0, w: container.w, h: ah });
      placements.set(b.id, { x: 0, y: by, w: container.w, h: total - by });
      affordance = {
        id: 'split-0',
        kind: 'drag-y',
        rect: { x: 0, y: ah, w: container.w, h: gutter },
        cursor: 'row-resize',
        meta: { direction, pixelsPerUnit: 1 / total },
      };
    }

    return { placements, affordances: [affordance] };
  },
  reduce(state: BinarySplitState, event: LayoutEvent): BinarySplitState {
    if (event.kind !== 'drag') return state;
    // Strategy must apply pixelsPerUnit; Workspace dispatched raw pixels.
    // pixelsPerUnit is in affordance.meta but reduce doesn't see meta —
    // the strategy uses a stored value if needed. Since binarySplit only
    // has one affordance, we compute via state alone using defaults: the
    // sign of dx/dy combined with last-known direction. Workspace passes
    // BOTH dx and dy; strategy applies whichever matches the split axis.
    //
    // Simple, axis-agnostic implementation: apply both dx and dy scaled
    // by 1/100 as a fallback if pixelsPerUnit isn't reachable. But we DO
    // know pixelsPerUnit from the most recent layout call. Best practice:
    // strategies that need pixelsPerUnit at reduce time should stash it
    // in state. Update state shape to include it.
    return state;
  },
};
```

**Wait — the above `reduce` doesn't work** because it can't access `pixelsPerUnit`. The spec says strategies should be pure and `pixelsPerUnit` lives in affordance meta. But meta isn't passed to reduce — only the event. Two ways to fix:

**Fix (chosen): stash pixelsPerUnit in state.** Change `BinarySplitState` to include `pixelsPerUnit: number` and have `layout` update it each render. Then `reduce` reads it from state.

Replace the relevant parts:

```ts
export interface BinarySplitState {
  ratio: number;
  /** Updated by layout(); read by reduce() to translate pixel deltas. */
  pixelsPerUnit: number;
  /** Updated by layout(); read by reduce() to choose dx or dy. */
  axis: 'x' | 'y';
}
```

```ts
initialState(_items: LayoutItem[]): BinarySplitState {
  return { ratio: 0.5, pixelsPerUnit: 0, axis: 'x' };
},
```

In `layout`, after computing `direction`, also derive pixelsPerUnit/axis and mutate the state object IN PLACE so subsequent reduce calls see the latest. Wait — `state` is the input; mutating it surprises React. Better: layout RETURNS a wrapped state, but it doesn't — its return shape is `LayoutResult`. Hmm.

**Cleaner fix:** the strategy's `reduce` takes an extra `context` argument carrying the last layout context (container size, etc.). Update the interface.

This pushes us back to changing the `LayoutStrategy` interface. Let's bite the bullet and add the context arg — it's the cleanest model.

Update `layout-types.ts` (revisit Task 1):

```ts
reduce?(state: TState, event: LayoutEvent, context: { container: Size; options: Record<string, unknown> }): TState;
```

`<Workspace>` will pass `{ container: currentSize, options: props.options ?? {} }` when calling reduce.

Apply this update to Task 1's `layout-types.ts` if not already done. Then `binarySplit.reduce` becomes:

```ts
reduce(state, event, context) {
  if (event.kind !== 'drag') return state;
  const cfg = (context.options ?? {}) as BinarySplitOptions;
  const direction = cfg.direction ?? 'horizontal';
  const minR = cfg.minRatio ?? DEFAULT_MIN;
  const maxR = cfg.maxRatio ?? DEFAULT_MAX;
  const total = direction === 'horizontal' ? context.container.w : context.container.h;
  const delta = direction === 'horizontal' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
  return { ratio: clamp(state.ratio + delta / total, minR, maxR) };
},
```

And revert `BinarySplitState` to just `{ ratio: number }` — no need to stash anything.

- [ ] **Step 3a: First, update `packages/core/src/layout-types.ts`** to add the context arg on `reduce`:

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
  }): LayoutResult<TId, TMeta>;
  reduce?(
    state: TState,
    event: LayoutEvent,
    context: { container: Size; options: Record<string, unknown> },
  ): TState;
}
```

- [ ] **Step 3b: Write `packages/core/src/layout/binarySplit.ts`** with the context-using reduce:

```ts
import { WindeaseError } from '../errors.js';
import type {
  Affordance,
  LayoutEvent,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';

export interface BinarySplitState {
  ratio: number;
}

export interface BinarySplitMeta {
  direction: 'horizontal' | 'vertical';
  pixelsPerUnit: number;
}

interface BinarySplitOptions {
  direction?: 'horizontal' | 'vertical';
  gutterSize?: number;
  minRatio?: number;
  maxRatio?: number;
}

const DEFAULT_MIN = 0.05;
const DEFAULT_MAX = 0.95;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export const binarySplit: LayoutStrategy<BinarySplitState, string, BinarySplitMeta> = {
  name: 'binarySplit',
  initialState(_items: LayoutItem[]): BinarySplitState {
    return { ratio: 0.5 };
  },
  layout({ items, container, state, options }) {
    if (items.length !== 2) {
      throw new WindeaseError(
        'WRONG_ITEM_COUNT',
        `binarySplit requires exactly 2 items, got ${items.length}`,
      );
    }
    const cfg = options as BinarySplitOptions;
    const direction = cfg.direction ?? 'horizontal';
    const gutter = cfg.gutterSize ?? 4;
    const minR = cfg.minRatio ?? DEFAULT_MIN;
    const maxR = cfg.maxRatio ?? DEFAULT_MAX;
    const r = clamp(state.ratio, minR, maxR);

    const placements = new Map<string, Rect>();
    const a = items[0]!;
    const b = items[1]!;

    if (direction === 'horizontal') {
      const total = container.w;
      const halfG = gutter / 2;
      const aw = total * r - halfG;
      const bx = total * r + halfG;
      placements.set(a.id, { x: 0, y: 0, w: aw, h: container.h });
      placements.set(b.id, { x: bx, y: 0, w: total - bx, h: container.h });
      return {
        placements,
        affordances: [
          {
            id: 'split-0',
            kind: 'drag-x',
            rect: { x: aw, y: 0, w: gutter, h: container.h },
            cursor: 'col-resize',
            meta: { direction, pixelsPerUnit: 1 / total },
          },
        ],
      };
    }
    const total = container.h;
    const halfG = gutter / 2;
    const ah = total * r - halfG;
    const by = total * r + halfG;
    placements.set(a.id, { x: 0, y: 0, w: container.w, h: ah });
    placements.set(b.id, { x: 0, y: by, w: container.w, h: total - by });
    return {
      placements,
      affordances: [
        {
          id: 'split-0',
          kind: 'drag-y',
          rect: { x: 0, y: ah, w: container.w, h: gutter },
          cursor: 'row-resize',
          meta: { direction, pixelsPerUnit: 1 / total },
        },
      ],
    };
  },
  reduce(state, event, context) {
    if (event.kind !== 'drag') return state;
    const cfg = (context.options ?? {}) as BinarySplitOptions;
    const direction = cfg.direction ?? 'horizontal';
    const minR = cfg.minRatio ?? DEFAULT_MIN;
    const maxR = cfg.maxRatio ?? DEFAULT_MAX;
    const total = direction === 'horizontal' ? context.container.w : context.container.h;
    const delta = direction === 'horizontal' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
    if (total === 0) return state;
    return { ratio: clamp(state.ratio + delta / total, minR, maxR) };
  },
};
```

- [ ] **Step 4: Update the failing test's reduce call** in `binarySplit.test.ts` — it must pass the new context arg. Replace the two `binarySplit.reduce!(state, {...})` calls with:

```ts
const next = binarySplit.reduce!(
  state,
  { affordanceId: result.affordances[0]!.id, kind: 'drag', payload: { dx: 20, dy: 0 } },
  { container: { w: 200, h: 100 }, options: { direction: 'horizontal' } },
);
expect(next.ratio).toBeCloseTo(0.5 + 20 / 200, 5);
```

(And `pixelsPerUnit` is no longer needed in the assertion — just `20/total`.)

For the clamp test:
```ts
const next = binarySplit.reduce!(
  { ratio: 0.94 },
  { affordanceId: 'split-0', kind: 'drag', payload: { dx: 1000, dy: 0 } },
  { container: { w: 100, h: 100 }, options: { direction: 'horizontal' } },
);
expect(next.ratio).toBe(0.95);
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/core/src/layout/binarySplit.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 6: Commit**

```
git add packages/core/src/layout-types.ts packages/core/src/layout/binarySplit.ts packages/core/src/layout/binarySplit.test.ts
git -c commit.gpgsign=false commit -m "feat(core): binarySplit strategy + reduce context arg"
```

---

## Task 9: `recursiveSplit` strategy (TDD)

**Files:**
- Create: `packages/core/src/layout/recursiveSplit.test.ts`
- Create: `packages/core/src/layout/recursiveSplit.ts`

- [ ] **Step 1: Write `packages/core/src/layout/recursiveSplit.test.ts`**:

```ts
import { describe, it, expect } from 'vitest';
import { recursiveSplit, type SplitNode } from './recursiveSplit.js';

const leaf = (id: string): SplitNode => ({ kind: 'leaf', id });
const split = (
  direction: 'horizontal' | 'vertical',
  ratio: number,
  a: SplitNode,
  b: SplitNode,
): SplitNode => ({ kind: 'split', direction, ratio, a, b });

describe('recursiveSplit', () => {
  it('initialState produces equal-ratio right-leaning tree', () => {
    const state = recursiveSplit.initialState!([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(state).toEqual({
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: leaf('a'),
      b: { kind: 'split', direction: 'horizontal', ratio: 0.5, a: leaf('b'), b: leaf('c') },
    });
  });

  it('initialState with 1 item returns single leaf', () => {
    const state = recursiveSplit.initialState!([{ id: 'a' }]);
    expect(state).toEqual(leaf('a'));
  });

  it('layout places a single leaf to fill the container', () => {
    const result = recursiveSplit.layout({
      items: [{ id: 'a' }],
      container: { w: 100, h: 100 },
      state: leaf('a'),
      options: {},
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(result.affordances).toEqual([]);
  });

  it('layout for one horizontal split emits one drag-x affordance', () => {
    const state = split('horizontal', 0.5, leaf('a'), leaf('b'));
    const result = recursiveSplit.layout({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 100 },
      state,
      options: { gutterSize: 4 },
    });
    expect(result.placements.get('a')).toEqual({ x: 0, y: 0, w: 98, h: 100 });
    expect(result.placements.get('b')).toEqual({ x: 102, y: 0, w: 98, h: 100 });
    expect(result.affordances).toHaveLength(1);
    expect(result.affordances[0]).toMatchObject({ kind: 'drag-x', cursor: 'col-resize' });
    expect((result.affordances[0]!.meta as { path: number[] }).path).toEqual([]);
  });

  it('nested splits emit per-split affordances with distinct paths', () => {
    // h-split: [v-split [a, b], c]
    const state = split('horizontal', 0.5, split('vertical', 0.5, leaf('a'), leaf('b')), leaf('c'));
    const result = recursiveSplit.layout({
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      container: { w: 200, h: 200 },
      state,
      options: { gutterSize: 4 },
    });
    expect(result.affordances).toHaveLength(2);
    const paths = result.affordances.map((a) => (a.meta as { path: number[] }).path);
    expect(paths).toEqual(expect.arrayContaining([[], [0]]));
  });

  it('reduce updates the ratio at the targeted path', () => {
    const state = split('horizontal', 0.5, leaf('a'), leaf('b'));
    const result = recursiveSplit.layout({
      items: [{ id: 'a' }, { id: 'b' }],
      container: { w: 200, h: 100 },
      state,
      options: {},
    });
    const aff = result.affordances[0]!;
    const next = recursiveSplit.reduce!(
      state,
      { affordanceId: aff.id, kind: 'drag', payload: { dx: 20, dy: 0 } },
      { container: { w: 200, h: 100 }, options: {} },
    );
    if (next.kind !== 'split') throw new Error('expected split');
    expect(next.ratio).toBeCloseTo(0.5 + 20 / 200, 5);
  });

  it('orphan leaf is dropped and warned once', () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => warns.push(m);
    try {
      const state = split('horizontal', 0.5, leaf('a'), leaf('orphan'));
      const result = recursiveSplit.layout({
        items: [{ id: 'a' }],
        container: { w: 100, h: 100 },
        state,
        options: {},
      });
      expect(result.placements.has('orphan')).toBe(false);
      expect(warns.some((w) => w.includes('orphan'))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });
});
```

- [ ] **Step 2: Run tests (expect FAIL)**

Run: `npx vitest run packages/core/src/layout/recursiveSplit.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write `packages/core/src/layout/recursiveSplit.ts`**:

```ts
import type {
  Affordance,
  LayoutEvent,
  LayoutItem,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
} from '../layout-types.js';

export type SplitNode =
  | { kind: 'leaf'; id: string }
  | {
      kind: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      a: SplitNode;
      b: SplitNode;
    };

export interface RecursiveSplitMeta {
  path: number[];
  direction: 'horizontal' | 'vertical';
}

interface RecursiveSplitOptions {
  gutterSize?: number;
  minRatio?: number;
  maxRatio?: number;
}

const DEFAULT_MIN = 0.05;
const DEFAULT_MAX = 0.95;
const warned = new Set<string>();

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function walk(
  node: SplitNode,
  rect: Rect,
  path: number[],
  gutter: number,
  placements: Map<string, Rect>,
  affordances: Affordance<RecursiveSplitMeta>[],
  validIds: Set<string>,
): void {
  if (node.kind === 'leaf') {
    if (!validIds.has(node.id)) {
      const key = `orphan:${node.id}`;
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`[windease] recursiveSplit: leaf "${node.id}" not in items; dropping`);
      }
      return;
    }
    placements.set(node.id, rect);
    return;
  }
  const halfG = gutter / 2;
  const r = clamp(node.ratio, DEFAULT_MIN, DEFAULT_MAX);
  if (node.direction === 'horizontal') {
    const aw = rect.w * r - halfG;
    const bx = rect.x + rect.w * r + halfG;
    walk(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h }, [...path, 0], gutter, placements, affordances, validIds);
    walk(node.b, { x: bx, y: rect.y, w: rect.x + rect.w - bx, h: rect.h }, [...path, 1], gutter, placements, affordances, validIds);
    affordances.push({
      id: `split-${path.join('.')}`,
      kind: 'drag-x',
      rect: { x: rect.x + rect.w * r - halfG, y: rect.y, w: gutter, h: rect.h },
      cursor: 'col-resize',
      meta: { path, direction: 'horizontal' },
    });
  } else {
    const ah = rect.h * r - halfG;
    const by = rect.y + rect.h * r + halfG;
    walk(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ah }, [...path, 0], gutter, placements, affordances, validIds);
    walk(node.b, { x: rect.x, y: by, w: rect.w, h: rect.y + rect.h - by }, [...path, 1], gutter, placements, affordances, validIds);
    affordances.push({
      id: `split-${path.join('.')}`,
      kind: 'drag-y',
      rect: { x: rect.x, y: rect.y + rect.h * r - halfG, w: rect.w, h: gutter },
      cursor: 'row-resize',
      meta: { path, direction: 'vertical' },
    });
  }
}

function updateAtPath(node: SplitNode, path: number[], newRatio: number): SplitNode {
  if (path.length === 0) {
    if (node.kind !== 'split') return node;
    return { ...node, ratio: newRatio };
  }
  if (node.kind !== 'split') return node;
  const [head, ...rest] = path;
  if (head === 0) return { ...node, a: updateAtPath(node.a, rest, newRatio) };
  if (head === 1) return { ...node, b: updateAtPath(node.b, rest, newRatio) };
  return node;
}

function nodeAtPath(node: SplitNode, path: number[]): SplitNode | undefined {
  if (path.length === 0) return node;
  if (node.kind !== 'split') return undefined;
  const [head, ...rest] = path;
  if (head === 0) return nodeAtPath(node.a, rest);
  if (head === 1) return nodeAtPath(node.b, rest);
  return undefined;
}

function rectAtPath(root: SplitNode, path: number[], container: Rect, gutter: number): Rect | undefined {
  let node = root;
  let rect = container;
  for (const step of path) {
    if (node.kind !== 'split') return undefined;
    const halfG = gutter / 2;
    const r = clamp(node.ratio, DEFAULT_MIN, DEFAULT_MAX);
    if (node.direction === 'horizontal') {
      const aw = rect.w * r - halfG;
      const bx = rect.x + rect.w * r + halfG;
      if (step === 0) { rect = { x: rect.x, y: rect.y, w: aw, h: rect.h }; node = node.a; }
      else { rect = { x: bx, y: rect.y, w: rect.x + rect.w - bx, h: rect.h }; node = node.b; }
    } else {
      const ah = rect.h * r - halfG;
      const by = rect.y + rect.h * r + halfG;
      if (step === 0) { rect = { x: rect.x, y: rect.y, w: rect.w, h: ah }; node = node.a; }
      else { rect = { x: rect.x, y: by, w: rect.w, h: rect.y + rect.h - by }; node = node.b; }
    }
  }
  return rect;
}

export const recursiveSplit: LayoutStrategy<SplitNode, string, RecursiveSplitMeta> = {
  name: 'recursiveSplit',
  initialState(items: LayoutItem[]): SplitNode {
    if (items.length === 0) {
      // No items: return a placeholder leaf with empty id (caller should avoid this).
      return { kind: 'leaf', id: '' };
    }
    if (items.length === 1) return { kind: 'leaf', id: items[0]!.id };
    // Right-leaning equal split tree.
    const [head, ...rest] = items;
    return {
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: { kind: 'leaf', id: head!.id },
      b: recursiveSplit.initialState!(rest),
    };
  },
  layout({ items, container, state, options }): LayoutResult<string, RecursiveSplitMeta> {
    const cfg = options as RecursiveSplitOptions;
    const gutter = cfg.gutterSize ?? 4;
    const placements = new Map<string, Rect>();
    const affordances: Affordance<RecursiveSplitMeta>[] = [];
    const validIds = new Set(items.map((it) => it.id));
    walk(state, { x: 0, y: 0, w: container.w, h: container.h }, [], gutter, placements, affordances, validIds);
    return { placements, affordances };
  },
  reduce(state, event, context) {
    if (event.kind !== 'drag') return state;
    // affordanceId is "split-<path joined by .>"
    const m = event.affordanceId.match(/^split-(.*)$/);
    if (!m) return state;
    const pathStr = m[1]!;
    const path = pathStr === '' ? [] : pathStr.split('.').map(Number);
    const target = nodeAtPath(state, path);
    if (!target || target.kind !== 'split') return state;
    const cfg = (context.options ?? {}) as RecursiveSplitOptions;
    const gutter = cfg.gutterSize ?? 4;
    const minR = cfg.minRatio ?? DEFAULT_MIN;
    const maxR = cfg.maxRatio ?? DEFAULT_MAX;
    const rect = rectAtPath(state, path, { x: 0, y: 0, w: context.container.w, h: context.container.h }, gutter);
    if (!rect) return state;
    const total = target.direction === 'horizontal' ? rect.w : rect.h;
    if (total === 0) return state;
    const delta = target.direction === 'horizontal' ? (event.payload.dx ?? 0) : (event.payload.dy ?? 0);
    return updateAtPath(state, path, clamp(target.ratio + delta / total, minR, maxR));
  },
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/src/layout/recursiveSplit.test.ts`
Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```
git add packages/core/src/layout/recursiveSplit.ts packages/core/src/layout/recursiveSplit.test.ts
git -c commit.gpgsign=false commit -m "feat(core): recursiveSplit strategy"
```

---

## Task 10: Export new types and strategies from core index

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Append to `packages/core/src/index.ts`** (keep existing exports; add at the end before `VERSION`):

```ts
export type {
  ItemId,
  Rect,
  Size,
  LayoutItem,
  Affordance,
  LayoutResult,
  LayoutEvent,
  BuiltinAffordanceKind,
} from './layout-types.js';
// LayoutStrategy already exported via './zone.js' re-export; ensure it now resolves to layout-types.

export { binarySplit, type BinarySplitState, type BinarySplitMeta } from './layout/binarySplit.js';
export { recursiveSplit, type SplitNode, type RecursiveSplitMeta } from './layout/recursiveSplit.js';
```

Then locate the existing `export { ... LayoutStrategy ... } from './zone.js';` line and **delete `LayoutStrategy` from it**, replacing with an export from layout-types:

```ts
export type { LayoutStrategy } from './layout-types.js';
```

(Keep `Placement` re-exported from `./zone.js` for source-level compat with v0.1 demo code; it's just `type Placement = Rect`.)

- [ ] **Step 2: Build + test**

Run: `npx tsc -b` from `/Users/mike/src/windease/`
Expected: clean.

Run: `npm test`
Expected: all green.

- [ ] **Step 3: Commit**

```
git add packages/core/src/index.ts
git -c commit.gpgsign=false commit -m "feat(core): expose new layout types and split strategies"
```

---

## Task 11: `<Workspace>` component (TDD)

**Files:**
- Create: `packages/react/src/Workspace.test.tsx`
- Create: `packages/react/src/Workspace.tsx`

- [ ] **Step 1: Write `packages/react/src/Workspace.test.tsx`**:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { binarySplit } from '@windease/core';
import { Workspace } from './Workspace.js';

describe('<Workspace>', () => {
  it('renders one wrapper per item with CSS custom props', () => {
    render(
      <Workspace
        strategy={binarySplit}
        items={[{ id: 'a' }, { id: 'b' }]}
        options={{ direction: 'horizontal' }}
        initialState={{ ratio: 0.5 }}
        container={{ w: 200, h: 100 }}
      >
        {(item) => <div data-testid={`item-${item.id}`}>{item.id}</div>}
      </Workspace>,
    );
    const a = screen.getByTestId('item-a').parentElement!;
    expect(a.style.getPropertyValue('--w-x')).toBe('0px');
    expect(a.style.getPropertyValue('--w-w')).toBe('98px');
    const b = screen.getByTestId('item-b').parentElement!;
    expect(b.style.getPropertyValue('--w-x')).toBe('102px');
  });

  it('renders affordances as drag handles', () => {
    render(
      <Workspace
        strategy={binarySplit}
        items={[{ id: 'a' }, { id: 'b' }]}
        options={{ direction: 'horizontal' }}
        initialState={{ ratio: 0.5 }}
        container={{ w: 200, h: 100 }}
      >
        {(item) => <div>{item.id}</div>}
      </Workspace>,
    );
    const handle = document.querySelector('.windease-affordance[data-kind="drag-x"]') as HTMLElement;
    expect(handle).toBeTruthy();
    expect(handle.style.cursor).toBe('col-resize');
  });

  it('pointer drag dispatches and onStateChange fires', () => {
    const onStateChange = vi.fn();
    render(
      <Workspace
        strategy={binarySplit}
        items={[{ id: 'a' }, { id: 'b' }]}
        options={{ direction: 'horizontal' }}
        initialState={{ ratio: 0.5 }}
        container={{ w: 200, h: 100 }}
        onStateChange={onStateChange}
      >
        {(item) => <div>{item.id}</div>}
      </Workspace>,
    );
    const handle = document.querySelector('.windease-affordance[data-kind="drag-x"]') as HTMLElement;
    // Simulate pointer down + move + up
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 120, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 120, clientY: 50, pointerId: 1 });
    expect(onStateChange).toHaveBeenCalled();
    const lastState = onStateChange.mock.calls.at(-1)![0] as { ratio: number };
    expect(lastState.ratio).toBeCloseTo(0.5 + 20 / 200, 5);
  });

  it('throws when strategy has no initialState and none provided', () => {
    expect(() =>
      render(
        // @ts-expect-error — deliberately missing initialState
        <Workspace
          strategy={{ name: 'noop', layout: () => ({ placements: new Map(), affordances: [] }) }}
          items={[{ id: 'a' }]}
          container={{ w: 100, h: 100 }}
        >
          {(item) => <div>{item.id}</div>}
        </Workspace>,
      ),
    ).toThrow(/NO_INITIAL_STATE|initial state/i);
  });

  it('custom affordance renderer is invoked for unknown kinds', () => {
    const customStrat = {
      name: 'custom',
      initialState: () => null,
      layout: () => ({
        placements: new Map(),
        affordances: [{ id: 'x', kind: 'custom-toggle', rect: { x: 0, y: 0, w: 10, h: 10 } }],
      }),
    };
    render(
      <Workspace
        strategy={customStrat as never}
        items={[]}
        container={{ w: 100, h: 100 }}
        affordanceRenderers={{
          'custom-toggle': (a) => <button data-testid={`aff-${a.id}`}>{a.id}</button>,
        }}
      >
        {() => null}
      </Workspace>,
    );
    expect(screen.getByTestId('aff-x')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests (expect FAIL — module missing)**

Run: `npx vitest run packages/react/src/Workspace.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `packages/react/src/Workspace.tsx`**:

```tsx
import * as React from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  Affordance,
  ItemId,
  LayoutEvent,
  LayoutItem,
  LayoutStrategy,
  Rect,
  Size,
} from '@windease/core';
import { WindeaseError } from '@windease/core';

interface WorkspaceProps<TState, TMeta> {
  strategy: LayoutStrategy<TState, ItemId, TMeta>;
  items: LayoutItem[];
  options?: Record<string, unknown>;
  initialState?: TState;
  /** Skips ResizeObserver when provided. */
  container?: Size;
  onStateChange?(state: TState): void;
  children: (item: LayoutItem, placement: Rect) => ReactNode;
  affordanceRenderers?: Record<
    string,
    (affordance: Affordance<TMeta>, dispatch: (event: LayoutEvent) => void) => ReactNode
  >;
}

const BUILTIN_KINDS = new Set(['drag-x', 'drag-y', 'drag-xy', 'click', 'keypress']);

export function Workspace<TState, TMeta>(props: WorkspaceProps<TState, TMeta>): React.JSX.Element {
  const { strategy, items, options, container, onStateChange, children, affordanceRenderers } = props;
  const opts = options ?? {};

  // Derive initial state once.
  const initial = useMemo<TState>(() => {
    if ('initialState' in props && props.initialState !== undefined) {
      return props.initialState as TState;
    }
    if (strategy.initialState) return strategy.initialState(items);
    throw new WindeaseError(
      'NO_INITIAL_STATE',
      `strategy "${strategy.name}" has no initialState and no initialState prop was provided`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [state, setState] = useState<TState>(initial);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<Size | null>(null);
  useEffect(() => {
    if (container || !rootRef.current) return;
    const el = rootRef.current;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setMeasured({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // biome-ignore lint/correctness/useExhaustiveDependencies: Depend on whether container is provided, not on its identity.
  }, [container === undefined]);

  const size: Size | null = container ?? measured;

  const dispatch = useCallback(
    (event: LayoutEvent) => {
      if (!strategy.reduce) return;
      if (!size) return;
      setState((prev) => {
        const next = strategy.reduce!(prev, event, { container: size, options: opts });
        if (onStateChange) onStateChange(next);
        return next;
      });
    },
    [strategy, size, opts, onStateChange],
  );

  const result = useMemo(() => {
    if (!size) return null;
    return strategy.layout({ items, container: size, state, options: opts });
  }, [strategy, items, size, state, opts]);

  return (
    <div ref={rootRef} className="windease-workspace" style={{ position: 'relative', width: '100%', height: '100%' }}>
      {result && items.map((item) => {
        const rect = result.placements.get(item.id);
        if (!rect) return null;
        const style: CSSProperties = {
          position: 'absolute',
          '--w-x': `${rect.x}px`,
          '--w-y': `${rect.y}px`,
          '--w-w': `${rect.w}px`,
          '--w-h': `${rect.h}px`,
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
        } as CSSProperties;
        return (
          <div key={item.id} className="windease-workspace-item" data-item-id={item.id} style={style}>
            {children(item, rect)}
          </div>
        );
      })}
      {result && result.affordances.map((aff) => (
        <AffordanceView
          key={aff.id}
          affordance={aff as Affordance<TMeta>}
          dispatch={dispatch}
          customRenderers={affordanceRenderers}
        />
      ))}
    </div>
  );
}

interface AffordanceViewProps<TMeta> {
  affordance: Affordance<TMeta>;
  dispatch: (event: LayoutEvent) => void;
  customRenderers?: Record<
    string,
    (a: Affordance<TMeta>, d: (e: LayoutEvent) => void) => ReactNode
  >;
}

function AffordanceView<TMeta>({ affordance, dispatch, customRenderers }: AffordanceViewProps<TMeta>) {
  const isBuiltin = BUILTIN_KINDS.has(affordance.kind);
  if (!isBuiltin) {
    const renderer = customRenderers?.[affordance.kind];
    if (!renderer) {
      throw new WindeaseError(
        'UNKNOWN_AFFORDANCE_KIND',
        `no built-in or custom renderer for affordance kind "${affordance.kind}"`,
      );
    }
    return <>{renderer(affordance, dispatch)}</>;
  }

  const { rect, kind, cursor, id } = affordance;
  const baseStyle: CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    cursor: cursor ?? 'default',
    userSelect: 'none',
    touchAction: 'none',
  };

  if (kind === 'drag-x' || kind === 'drag-y' || kind === 'drag-xy') {
    const last = { x: 0, y: 0 };
    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      last.x = e.clientX;
      last.y = e.clientY;
    };
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last.x = e.clientX;
      last.y = e.clientY;
      dispatch({ affordanceId: id, kind: 'drag', payload: { dx, dy } });
    };
    const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    };
    return (
      <div
        className="windease-affordance"
        data-affordance-id={id}
        data-kind={kind}
        style={baseStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    );
  }

  if (kind === 'click') {
    return (
      <div
        className="windease-affordance"
        data-affordance-id={id}
        data-kind="click"
        style={baseStyle}
        onClick={() => dispatch({ affordanceId: id, kind: 'click', payload: {} })}
      />
    );
  }

  // keypress
  return (
    <div
      className="windease-affordance"
      data-affordance-id={id}
      data-kind="keypress"
      tabIndex={0}
      style={baseStyle}
      onKeyDown={(e) => dispatch({ affordanceId: id, kind: 'key', payload: { key: e.key } })}
    />
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/react/src/Workspace.test.tsx`
Expected: 5/5 PASS.

If the throw-test fails because React swallows the error, wrap the render call in an ErrorBoundary-aware helper, or use `expect(() => render(...)).toThrow()` and trust React 19's error propagation in test mode. Most modern react-testing-library setups throw out to the test runner.

- [ ] **Step 5: Build + full test**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```
git add packages/react/src/Workspace.tsx packages/react/src/Workspace.test.tsx
git -c commit.gpgsign=false commit -m "feat(react): <Workspace> component with built-in affordances"
```

---

## Task 12: Export `<Workspace>` from react index

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Add to `packages/react/src/index.ts`**:

```ts
export { Workspace } from './Workspace.js';
```

(Append to the existing exports.)

- [ ] **Step 2: Build + test**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 3: Commit**

```
git add packages/react/src/index.ts
git -c commit.gpgsign=false commit -m "feat(react): export Workspace"
```

---

## Task 13: Ladle stories for Workspace + update Playground

**Files:**
- Create: `packages/react/src/stories/Workspace.stories.tsx`
- Modify: `packages/react/src/stories/Playground.stories.tsx`
- Modify: `packages/react/src/stories/windease.css` (add affordance styling)

- [ ] **Step 1: Add to `packages/react/src/stories/windease.css`**:

```css
.windease-workspace {
  background: #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
}

.windease-affordance {
  background: #94a3b8;
  transition: background 0.1s;
}
.windease-affordance:hover {
  background: #475569;
}
.windease-affordance[data-kind="drag-x"] {
  background: linear-gradient(90deg, transparent, #475569 50%, transparent);
}
.windease-affordance[data-kind="drag-y"] {
  background: linear-gradient(0deg, transparent, #475569 50%, transparent);
}
```

- [ ] **Step 2: Create `packages/react/src/stories/Workspace.stories.tsx`**:

```tsx
import { binarySplit, recursiveSplit, type SplitNode } from '@windease/core';
import type { Story } from '@ladle/react';
import { useState } from 'react';
import { Workspace } from '../Workspace.js';
import { Panel } from './Panel.js';
import './windease.css';

const items3 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

export const BinarySplit: Story = () => (
  <div style={{ width: 600, height: 360 }}>
    <Workspace
      strategy={binarySplit}
      items={[{ id: 'a' }, { id: 'b' }]}
      options={{ direction: 'horizontal' }}
    >
      {(item) => (
        <Panel
          window={{ id: item.id, kind: 'panel', lifecycle: { state: 'visible' } } as never}
          label={`Pane ${item.id}`}
        />
      )}
    </Workspace>
  </div>
);

export const RecursiveSplit: Story = () => {
  const initialTree: SplitNode = {
    kind: 'split',
    direction: 'horizontal',
    ratio: 0.65,
    a: {
      kind: 'split',
      direction: 'vertical',
      ratio: 0.7,
      a: { kind: 'leaf', id: 'a' },
      b: { kind: 'leaf', id: 'b' },
    },
    b: { kind: 'leaf', id: 'c' },
  };
  const [snap, setSnap] = useState<string>('');

  return (
    <div>
      <div style={{ width: 600, height: 360 }}>
        <Workspace
          strategy={recursiveSplit}
          items={items3}
          initialState={initialTree}
          onStateChange={(s) => setSnap(JSON.stringify(s, null, 2))}
        >
          {(item) => (
            <Panel
              window={{ id: item.id, kind: 'panel', lifecycle: { state: 'visible' } } as never}
              label={`Pane ${item.id}`}
            />
          )}
        </Workspace>
      </div>
      {snap && (
        <pre className="story-snapshot" style={{ marginTop: 12 }}>
          {snap}
        </pre>
      )}
    </div>
  );
};
```

The `Panel` component currently expects a real `WindowRecord` (with FSM instances). For story purposes, casting `as never` is acceptable — the panel only reads `id`, `kind`, and `lifecycle.state`. If TypeScript complains harder, define a minimal local panel in this story file.

- [ ] **Step 3: Update `packages/react/src/stories/Playground.stories.tsx`**

The existing Playground uses CSS Grid (`.story-playground`) to arrange three zones. Replace the CSS Grid with `<Workspace strategy={recursiveSplit}>` so the playground exercises both layers (zones inside, workspace outside). Keep all the toolbar logic intact.

Replace the JSX block:

```tsx
<div className="story-playground">
  <div className="story-playground__main">…</div>
  <div className="story-playground__sidebar">…</div>
  <div className="story-playground__dock">…</div>
</div>
```

with:

```tsx
<div style={{ width: '100%', height: 600 }}>
  <Workspace
    strategy={recursiveSplit}
    items={[{ id: MAIN }, { id: SIDEBAR }, { id: DOCK }]}
    initialState={{
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.75,
      a: {
        kind: 'split',
        direction: 'vertical',
        ratio: 0.82,
        a: { kind: 'leaf', id: MAIN },
        b: { kind: 'leaf', id: DOCK },
      },
      b: { kind: 'leaf', id: SIDEBAR },
    }}
  >
    {(item) => <Zone id={item.id as typeof MAIN} >{renderPanel}</Zone>}
  </Workspace>
</div>
```

Add `import { Workspace } from '../Workspace.js';` and `import { recursiveSplit } from '@windease/core';` near the existing imports. Remove the `.story-playground*` JSX wrappers and their corresponding label divs (the visual labels are no longer needed since you can see the zones); if you prefer to keep labels, add them inside each `<Zone>`'s `renderPanel` or use a panel overlay.

- [ ] **Step 4: Build Ladle**

Run: `npx ladle build` from `/Users/mike/src/windease/`
Expected: clean build, all stories compile.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```
git add packages/react/src/stories
git -c commit.gpgsign=false commit -m "feat(ladle): stories for Workspace + Playground integration"
```

---

## Task 14: Bump versions to 0.2.0

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/react/package.json`
- Modify: `README.md` (mention breaking change in a brief note)

- [ ] **Step 1: Update `packages/core/package.json`**

Change `"version": "0.1.0"` → `"version": "0.2.0"`.

Also update `packages/core/src/index.ts`'s `VERSION` constant: `'0.1.0'` → `'0.2.0'`.

- [ ] **Step 2: Update `packages/react/package.json`**

Change `"version": "0.1.0"` → `"version": "0.2.0"`, and the `@windease/core` dep from `"0.1.0"` → `"0.2.0"`. Update `REACT_VERSION` constant similarly.

- [ ] **Step 3: Add brief note to `README.md`**

Append a `## v0.2 breaking changes` section after the usage example:

```markdown
## v0.2 breaking changes

- `LayoutStrategy` now returns `{ placements, affordances }` instead of just
  a placement map.
- Strategy inputs renamed: `{ zone, windows, viewport }` → `{ items, container, state, options }`.
- New `<Workspace>` component for multi-zone layout with draggable splits.
- New built-in strategies: `binarySplit`, `recursiveSplit`.

If you wrote custom strategies, migrate by following the migration of the
built-ins (see `packages/core/src/layout/grid.ts`).
```

- [ ] **Step 4: Reinstall to refresh workspace links**

Run: `npm install` from `/Users/mike/src/windease/`
Expected: clean.

- [ ] **Step 5: Final verification — full suite + build + lint + ladle build**

Run: `npm test && npm run build && npm run lint && npx ladle build`
Expected: all green.

- [ ] **Step 6: Commit**

```
git add packages/core/package.json packages/core/src/index.ts packages/react/package.json packages/react/src/index.ts package-lock.json README.md
git -c commit.gpgsign=false commit -m "chore: bump to 0.2.0"
```

---

## Self-review

**Spec coverage** — every section maps to a task:
- Unified LayoutStrategy interface → Task 1, refined in Task 8 (added reduce context)
- Workspace component → Tasks 11, 12
- binarySplit → Task 8
- recursiveSplit → Task 9
- Migration of grid/stack/strip → Tasks 4, 5, 6
- Zone adaptation → Task 7
- Error codes → Task 2
- Stories (Workspace + updated Playground) → Task 13
- Versioning + README → Task 14

**Placeholders / red flags scanned:** Task 8 contained an explanatory aside about why `pixelsPerUnit` in state didn't work; this is intentional teaching context inside the plan, not a TBD. The final implementation uses the context argument approach with full code. No remaining placeholders.

**Type consistency:**
- `LayoutItem.id: ItemId` consistent across all tasks.
- `Rect = { x, y, w, h }` consistent.
- `BinarySplitState = { ratio: number }` consistent across tasks 8.
- `SplitNode` type used in Task 9 matches test usage and reduce signature.
- The `reduce` signature update (adding `context`) is applied in Task 8 (which updates layout-types.ts) and consumed in Task 9 (recursiveSplit) and Task 11 (Workspace) consistently.
- `LayoutStrategy<TState, TId, TMeta>` generics propagate to `ZoneRecord.strategy` typing in Task 3 and `WorkspaceProps` in Task 11 the same way.

**Known plan risks:**
- Task 11's "throws when no initialState" test relies on React surfacing the throw to the test runner. If a React 19 + RTL version swallows it, the test would need an ErrorBoundary wrapper. Flagged inline in Task 11.
- Playground story rewrite in Task 13 is the largest single edit; subagent should be careful to preserve all toolbar logic.
- Migration of `gridStrategy.layout`'s test fixture (Task 4) drops the `zone.windowIds` ordering wrapper — the new test uses items-array ordering directly. Equivalent behavior, different fixture shape.
