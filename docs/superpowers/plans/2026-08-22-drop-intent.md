# Drop Intent + Tab-Stacking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the drop pipeline a vocabulary beyond "which seam", and ship a tabbed stack container as its first consumer.

**Architecture:** One pure resolver (`resolveDropIntent`) turns child rects plus a cursor into an `insert` / `stack` / `split` intent; `DragEngine` carries it on hover and switches on it at drop; `store.stackNodes` performs the wrap; `stackStrategy` lays out the active tab and sends the rest to `unplaced`; `PresetShell` learns to render nothing for an unplaced id. Split is resolved but never emitted — its commit path is a later change.

**Tech Stack:** TypeScript (`exactOptionalPropertyTypes` on), Vitest for unit tests, Ladle for stories, Playwright across Chromium/Firefox/WebKit for e2e.

**Spec:** `docs/superpowers/specs/2026-08-22-drop-intent-design.md`

---

## Ground rules for every task

- **Mutation-check every negative assertion.** After a test asserting something does *not* happen goes green, break the implementation on purpose and confirm the test fails. Three seam-join defects survived ordinary review and died to this. Revert the break before committing.
- `exactOptionalPropertyTypes` is on: `{ intent: maybeUndefined }` does not compile against `intent?: T`. Spread conditionally: `...(x !== undefined ? { intent: x } : {})`.
- `store.transact` does not roll back. Validate fully before opening it.
- Trace liberally: `trace('dnd', …)` in the engine, `trace('store', …)` in mutations, `trace('layout', …)` in the strategy.
- Run `npx vitest run <file>` for a single file; `npm test` for the suite.

## File structure

| File | Responsibility |
|---|---|
| `src/dnd/dropIntent.ts` (new) | Pure resolver + `DropIntent` type. No DOM. |
| `src/layout/stack.ts` (new) | `stackStrategy`. Pure layout. |
| `src/react/dnd/useStack.ts` (new) | Headless tab model over a stack container. |
| `src/react/stories/TabStack.stories.tsx` (new) | Operable tab strip; the e2e fixture. |
| `e2e/tab-stack.spec.ts` (new) | Browser coverage across three engines. |
| `src/dnd/DragEngine.ts` | `getDropIntent` on `DropTarget`, `intent` on hover, drop dispatch. |
| `src/store.ts` | `stackNodes`. |
| `src/react/LayoutContext.tsx` | `unplaced` on `LayoutInfo`. |
| `src/react/presets.tsx` | `PresetShell` renders nothing for an unplaced id. |
| `src/react/Container.tsx` | Default `getDropIntent` wiring from container config. |
| `src/layout-types.ts` | Correct the stale "strip / stack / split" comment. |
| `src/index.ts`, `src/react/index.ts` | Exports. |

---

### Task 1: The intent resolver

**Files:**
- Create: `src/dnd/dropIntent.ts`
- Test: `src/dnd/dropIntent.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { insertionIndexByMidpoint } from './insertionIndex.js';
import { resolveDropIntent } from './dropIntent.js';

const row = [
  { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
  { id: 'b', rect: { x: 100, y: 0, w: 100, h: 100 } },
  { id: 'c', rect: { x: 200, y: 0, w: 100, h: 100 } },
];

describe('resolveDropIntent', () => {
  it('agrees with insertionIndexByMidpoint at every x when no other intent is enabled', () => {
    const bounds = row.map((r) => ({ left: r.rect.x, right: r.rect.x + r.rect.w }));
    for (let x = 0; x <= 300; x += 1) {
      const intent = resolveDropIntent(row, { x, y: 50 }, 'x');
      expect(intent).toEqual({ kind: 'insert', index: insertionIndexByMidpoint(bounds, x, 'x') });
    }
  });

  it('stacks in the centre band when stacking is enabled', () => {
    expect(resolveDropIntent(row, { x: 150, y: 50 }, 'x', { stack: true })).toEqual({
      kind: 'stack',
      ontoId: 'b',
    });
  });

  it('inserts at the neighbouring seam from a main-axis band', () => {
    expect(resolveDropIntent(row, { x: 105, y: 50 }, 'x', { stack: true })).toEqual({
      kind: 'insert',
      index: 1,
    });
    expect(resolveDropIntent(row, { x: 195, y: 50 }, 'x', { stack: true })).toEqual({
      kind: 'insert',
      index: 2,
    });
  });

  it('resolves corners to insert, not split', () => {
    expect(resolveDropIntent(row, { x: 105, y: 5 }, 'x', { stack: true, split: true })).toEqual({
      kind: 'insert',
      index: 1,
    });
  });

  it('splits from a cross-axis band when splitting is enabled', () => {
    expect(resolveDropIntent(row, { x: 150, y: 5 }, 'x', { stack: true, split: true })).toEqual({
      kind: 'split',
      ontoId: 'b',
      edge: 'start',
    });
    expect(resolveDropIntent(row, { x: 150, y: 95 }, 'x', { stack: true, split: true })).toEqual({
      kind: 'split',
      ontoId: 'b',
      edge: 'end',
    });
  });

  it('never lets opposing bands meet on a narrow pane', () => {
    const narrow = [{ id: 'n', rect: { x: 0, y: 0, w: 10, h: 100 } }];
    // A centre must survive at any width, or a pane becomes unstackable.
    expect(resolveDropIntent(narrow, { x: 5, y: 50 }, 'x', { stack: true, band: 0.49 })).toEqual({
      kind: 'stack',
      ontoId: 'n',
    });
  });

  it('returns index 0 for an empty child list', () => {
    expect(resolveDropIntent([], { x: 0, y: 0 }, 'x', { stack: true })).toEqual({
      kind: 'insert',
      index: 0,
    });
  });

  it('falls back to a midpoint insert when the cursor is over no child', () => {
    expect(resolveDropIntent(row, { x: 400, y: 50 }, 'x', { stack: true })).toEqual({
      kind: 'insert',
      index: 3,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dnd/dropIntent.test.ts`
Expected: FAIL — cannot resolve `./dropIntent.js`.

- [ ] **Step 3: Implement**

```ts
import type { ItemId, Rect } from '../layout-types.js';
import { insertionIndexByMidpoint } from './insertionIndex.js';

/** What kind of drop the cursor is asking for. */
export type DropIntent =
  | { kind: 'insert'; index: number }
  | { kind: 'stack'; ontoId: ItemId }
  | { kind: 'split'; ontoId: ItemId; edge: 'start' | 'end' };

export interface DropIntentOptions {
  /** Carve a centre band that stacks onto the hovered child. */
  stack?: boolean;
  /** Carve cross-axis bands that split the hovered child. */
  split?: boolean;
  /** Band thickness as a fraction of the child's extent. Default 0.25. */
  band?: number;
}

/** Largest band fraction that still leaves a centre. */
const MAX_BAND = 0.49;
const DEFAULT_BAND = 0.25;

export function resolveDropIntent(
  rects: readonly { id: ItemId; rect: Rect }[],
  cursor: { x: number; y: number },
  axis: 'x' | 'y',
  options: DropIntentOptions = {},
): DropIntent {
  const bounds = rects.map((r) =>
    axis === 'x'
      ? { left: r.rect.x, right: r.rect.x + r.rect.w }
      : { top: r.rect.y, bottom: r.rect.y + r.rect.h },
  );
  const main = axis === 'x' ? cursor.x : cursor.y;
  const insert = (): DropIntent => ({
    kind: 'insert',
    index: insertionIndexByMidpoint(bounds, main, axis),
  });

  if (!options.stack && !options.split) return insert();

  const hit = rects.findIndex(
    (r) =>
      cursor.x >= r.rect.x &&
      cursor.x <= r.rect.x + r.rect.w &&
      cursor.y >= r.rect.y &&
      cursor.y <= r.rect.y + r.rect.h,
  );
  if (hit === -1) return insert();

  const { id, rect } = rects[hit]!;
  const band = Math.min(Math.max(options.band ?? DEFAULT_BAND, 0), MAX_BAND);
  const mainStart = axis === 'x' ? rect.x : rect.y;
  const mainExtent = axis === 'x' ? rect.w : rect.h;
  const crossPos = axis === 'x' ? cursor.y : cursor.x;
  const crossStart = axis === 'x' ? rect.y : rect.x;
  const crossExtent = axis === 'x' ? rect.h : rect.w;

  // Main axis wins the corners: an insert is the reversible answer, and the
  // gesture that reaches a corner was usually aiming at the seam.
  const mainOffset = main - mainStart;
  if (mainOffset < mainExtent * band) return { kind: 'insert', index: hit };
  if (mainOffset > mainExtent * (1 - band)) return { kind: 'insert', index: hit + 1 };

  if (options.split) {
    const crossOffset = crossPos - crossStart;
    if (crossOffset < crossExtent * band) return { kind: 'split', ontoId: id, edge: 'start' };
    if (crossOffset > crossExtent * (1 - band)) return { kind: 'split', ontoId: id, edge: 'end' };
  }

  if (options.stack) return { kind: 'stack', ontoId: id };
  return insert();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/dnd/dropIntent.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-check the compatibility sweep**

Temporarily change `MAX_BAND` to `0.6` and confirm the narrow-pane test fails. Revert.

- [ ] **Step 6: Export and commit**

Add to `src/index.ts` beside the other `dnd` exports:
```ts
export { type DropIntent, type DropIntentOptions, resolveDropIntent } from './dnd/dropIntent.js';
```

```bash
git add src/dnd/dropIntent.ts src/dnd/dropIntent.test.ts src/index.ts
git commit -m "resolve a drop intent from child rects and a cursor"
```

---

### Task 2: The stack strategy

**Files:**
- Create: `src/layout/stack.ts`
- Test: `src/layout/stack.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import type { LayoutItem } from '../layout-types.js';
import { stackStrategy } from './stack.js';

const items: LayoutItem[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const container = { w: 400, h: 300 };
const run = (options: Record<string, unknown>) =>
  stackStrategy.layout({ items, container, state: undefined as void, options });

describe('stackStrategy', () => {
  it('gives the active child the container less the header and padding', () => {
    const r = run({ activeId: 'b', headerSize: 30, padding: 4 });
    expect(r.placements.get('b')).toEqual({ x: 4, y: 34, w: 392, h: 262 });
  });

  it('sends every inactive child to unplaced', () => {
    const r = run({ activeId: 'b', headerSize: 30 });
    expect(r.unplaced).toEqual(['a', 'c']);
    expect(r.placements.has('a')).toBe(false);
    expect(r.placements.has('c')).toBe(false);
  });

  it('falls back to the first child when activeId names one that has left', () => {
    const r = run({ activeId: 'gone', headerSize: 30 });
    expect(r.placements.has('a')).toBe(true);
    expect(r.unplaced).toEqual(['b', 'c']);
  });

  it('falls back to the first child when activeId is unset', () => {
    const r = run({ headerSize: 30 });
    expect(r.placements.has('a')).toBe(true);
  });

  it('places nothing and reports no unplaced for an empty container', () => {
    const r = stackStrategy.layout({
      items: [],
      container,
      state: undefined as void,
      options: {},
    });
    expect(r.placements.size).toBe(0);
    expect(r.unplaced ?? []).toEqual([]);
  });

  it('never gives the active child a negative extent', () => {
    const r = stackStrategy.layout({
      items,
      container: { w: 40, h: 10 },
      state: undefined as void,
      options: { activeId: 'a', headerSize: 30, padding: 8 },
    });
    const rect = r.placements.get('a')!;
    expect(rect.w).toBeGreaterThanOrEqual(0);
    expect(rect.h).toBeGreaterThanOrEqual(0);
  });

  it('emits no affordances — a stack has no seams', () => {
    expect(run({ activeId: 'a' }).affordances).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/layout/stack.test.ts`
Expected: FAIL — cannot resolve `./stack.js`.

- [ ] **Step 3: Implement**

```ts
import type { LayoutItem, LayoutResult, LayoutStrategy, Rect, Size } from '../layout-types.js';
import { trace } from '../trace.js';

interface StackConfig {
  /** Which child fills the body. Defaults to the first in `childOrder`. */
  activeId?: string;
  /** Main-axis pixels reserved at the top for the consumer's tab strip.
   *  An input, not a measurement: the core never measures the strip. */
  headerSize?: number;
  padding?: number;
}

export const stackStrategy: LayoutStrategy<void, string> = {
  name: 'stack',
  configSpec: {
    activeId: 'string',
    headerSize: 'number',
    padding: 'number',
  },
  layout({
    items,
    container,
    options,
  }: {
    items: LayoutItem[];
    container: Size;
    state: void;
    options: Record<string, unknown>;
  }): LayoutResult<string> {
    const cfg = options as StackConfig;
    const headerSize = cfg.headerSize ?? 0;
    const padding = cfg.padding ?? 0;

    const placements = new Map<string, Rect>();
    if (items.length === 0) return { placements, affordances: [] };

    const active = items.find((i) => i.id === cfg.activeId) ?? items[0]!;
    placements.set(active.id, {
      x: padding,
      y: headerSize + padding,
      w: Math.max(0, container.w - padding * 2),
      h: Math.max(0, container.h - headerSize - padding * 2),
    });

    const unplaced = items.filter((i) => i.id !== active.id).map((i) => i.id);
    trace('layout', `stack: active=${active.id}, ${unplaced.length} hidden`);
    const result: LayoutResult<string> = { placements, affordances: [] };
    if (unplaced.length > 0) result.unplaced = unplaced;
    return result;
  },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/layout/stack.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Mutation-check the fallback**

Change `?? items[0]!` to `!` (non-null assert on the find) and confirm the departed-`activeId` test fails rather than throwing at a different point. Revert.

- [ ] **Step 6: Export and commit**

Add to `src/index.ts` beside `stripStrategy`:
```ts
export { stackStrategy } from './layout/stack.js';
```

```bash
git add src/layout/stack.ts src/layout/stack.test.ts src/index.ts
git commit -m "lay out a stack as one active child and the rest unplaced"
```

---

### Task 3: `unplaced` reaches the declarative presets

**Files:**
- Modify: `src/react/LayoutContext.tsx`
- Modify: `src/react/presets.tsx` (`ZoneWithLayout`'s `layoutInfo`, `PresetShell`'s return)
- Test: `src/react/presets.unplaced.test.tsx`

This is the change with a blast radius. `<Container>` already gates on the rect
(`Container.tsx:403–404`), so it needs nothing. `PresetShell` ends with
`if (!selfRect) return shell` — which must keep meaning "render me" for flow
mode and for a preset under no container at all.

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LayoutScope } from './LayoutContext.js';
import { PresetShell } from './presets.js';  // export it for the test if not already exported
```

Write three cases against a `<Zone>` whose strategy is `stackStrategy`:

1. **hides an unplaced child** — a zone with three panels and `activeId: 'b'`
   renders only `b`'s content; `a` and `c` are absent from the DOM.
2. **still renders every child under flow mode** — the same three panels in a
   zone with no strategy (flow) all appear. This is the case that makes reusing
   `unplaced` safe rather than coincidental: flow reports an empty list.
3. **still renders a `<Panel>` with no container above it** — no
   `LayoutContext`, so `placements` and `unplaced` are both empty.

Follow the existing preset test files for the render harness; match whichever of
`src/react/*.test.tsx` already mounts a `<Zone>` with a strategy registry.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/react/presets.unplaced.test.tsx`
Expected: FAIL — case 1 finds all three panels rendered.

- [ ] **Step 3: Add `unplaced` to `LayoutInfo`**

In `src/react/LayoutContext.tsx`:
```ts
export interface LayoutInfo {
  placements: ReadonlyMap<NodeId, Rect>;
  /** Children a strategy ran and deliberately withheld. Empty when no strategy
   *  ran at all — flow mode, or a preset with no container above it — which is
   *  what lets a consumer of this list treat membership as "hide me". */
  unplaced: ReadonlyArray<NodeId>;
  settleMs: number;
  registerPlacementControl?: (id: NodeId, commit: PlacementCommit) => () => void;
  observeNatural?: (id: NodeId, el: Element) => () => void;
}

const EMPTY_LAYOUT: LayoutInfo = { placements: new Map(), unplaced: [], settleMs: 0 };

/** @group Hooks */
export function useIsUnplaced(id: NodeId): boolean {
  return useContext(LayoutContext).unplaced.includes(id);
}
```

- [ ] **Step 4: Populate it and honour it**

In `src/react/presets.tsx`, `ZoneWithLayout`'s `layoutInfo` object gains
`unplaced: layout.unplaced`. In `PresetShell`, immediately before the existing
`if (!selfRect) return shell;`:

```tsx
if (unplaced) return null;
```

with `const unplaced = useIsUnplaced(id);` read beside `useLayoutForSelf(id)`.
Hooks must stay unconditional — read it at the top with the other hooks, return
late.

- [ ] **Step 5: Run to verify all three pass**

Run: `npx vitest run src/react/presets.unplaced.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Mutation-check cases 2 and 3**

Change `if (unplaced) return null` to `if (!selfRect) return null` and confirm
cases 2 and 3 both fail. That is the regression the whole task exists to avoid.
Revert.

- [ ] **Step 7: Run the full suite — this is the blast-radius check**

Run: `npm test`
Expected: PASS. Any grid-`unplace`-through-presets test that now fails is the
documented behaviour change; update it and note it.

- [ ] **Step 8: Commit**

```bash
git add src/react/LayoutContext.tsx src/react/presets.tsx src/react/presets.unplaced.test.tsx
git commit -m "render nothing for a child a strategy withheld"
```

---

### Task 4: `store.stackNodes`

**Files:**
- Modify: `src/store.ts`
- Test: `src/store.stack.test.ts`

- [ ] **Step 1: Write the failing tests**

Cover, with a fixture of a strip zone holding `a`, `b`, `c`:

1. **wraps** — `stackNodes(a, b, { id: 's' })` leaves the zone holding `s` and
   `c`; `s` sits at `b`'s old index; `s.container.childOrder` is `[b, a]`.
2. **inherits placement** — `b` carrying `placement.size = { w: 120 }` gives `s`
   that placement, and `b`'s own is cleared by the reparent.
3. **appends when already a stack** — a second `stackNodes(c, b, …)` calls
   `moveNode` into `s` and creates nothing; the node count is unchanged.
4. **rejects and writes nothing** — `stackNodes(a, a)` throws, and a snapshot
   taken before equals one taken after. Same for stacking onto a descendant of
   the source.
5. **one undo step** — one `transaction.begin` / `transaction.end` pair,
   recorded with `src/test-utils/record-events.ts`. There is no `store.undo()`.
6. **sets `autoUnsplit`** — `s.container.autoUnsplit === true`, so removing one
   of its two children collapses it. Assert the collapse directly: `moveNode(a,
   zone)` leaves `b` a direct child of the zone and `s` destroyed.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store.stack.test.ts`
Expected: FAIL — `store.stackNodes is not a function`.

- [ ] **Step 3: Implement**

Add to `Store`, near `split`:

```ts
stackNodes(
  sourceId: NodeId,
  ontoId: NodeId,
  opts: { id: NodeId; config?: Record<string, unknown> } & MutateOptions,
): void {
  const source = this.requireNode(sourceId);
  const onto = this.requireNode(ontoId);
  if (sourceId === ontoId) {
    throw new InvariantViolationError('stack-self', `cannot stack ${sourceId} onto itself`, {
      id: sourceId,
    });
  }
  if (this.isAncestorOf(sourceId, ontoId)) {
    throw new InvariantViolationError(
      'stack-descendant',
      `cannot stack ${sourceId} onto its own descendant ${ontoId}`,
      { id: sourceId },
    );
  }
  if (!onto.membership) {
    throw new CapabilityMissingError(ontoId, 'membership', 'stackNodes');
  }
  const parentId = onto.membership.parentId;

  // Already a stack: this is an ordinary move, no wrap.
  const parent = this.requireNode(parentId);
  if (parent.container?.strategyId === 'stack') {
    this.moveNode(sourceId, parentId, undefined, opts);
    return;
  }

  // Validate everything the transaction will need BEFORE opening it —
  // `transact` does not roll back.
  this.assertUnlocked(sourceId, 'move', 'stackNodes', opts);
  this.assertUnlocked(ontoId, 'move', 'stackNodes', opts);
  this.assertUnlocked(parentId, 'arrange', 'stackNodes', opts);
  if (source.membership) {
    this.assertUnlocked(source.membership.parentId, 'dragOut', 'stackNodes', opts);
  }

  const at = parent.container?.childOrder.indexOf(ontoId) ?? 0;
  const placement = { ...(onto.membership.placement ?? {}) };

  this.transact(() => {
    this.registerNode(
      createNode({
        kind: 'group',
        id: opts.id,
        parentId,
        placement,
        container: { strategyId: 'stack', config: opts.config ?? {} },
      }),
    );
    this.setAutoUnsplit(opts.id, true);
    this.reorderInParent(opts.id, at);
    this.moveNode(ontoId, opts.id);
    this.moveNode(sourceId, opts.id);
  });
  trace('store', `stack: ${sourceId} onto ${ontoId} in new ${opts.id}@${at}`);
}
```

Note: `createNode` takes `parentId` and `placement` as **top-level** fields —
there is no `membership:` input — and `container` needs `{ strategyId, config }`.
If `isAncestorOf` does not exist, write it as a private walk up `membership.parentId`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/store.stack.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Mutation-check the write-nothing case**

Move the `sourceId === ontoId` throw to *inside* the `transact` callback and
confirm test 4 fails with a half-written tree. Revert. This is exactly the
failure mode the "validate before transact" convention exists for.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts src/store.stack.test.ts
git commit -m "wrap two nodes into a stack container"
```

---

### Task 5: The engine carries and dispatches intent

**Files:**
- Modify: `src/dnd/DragEngine.ts`
- Test: `src/dnd/DragEngine.intent.test.ts`

- [ ] **Step 1: Write the failing tests**

1. **hover carries the intent** — a target registering `getDropIntent` returning
   a stack intent puts it on `state().hover.intent`.
2. **`getInsertionIndex` still works** — a target registering only the old
   callback still produces `hover.insertIndex` and an insert drop. No break.
3. **drop dispatches** — a stack intent at drop calls `stackNodes`, not
   `moveNode`, and the tree ends up wrapped.
4. **rejects stacking onto the dragged node** — intent naming `ontoId ===
   draggingId` reports `accepted: false`, and the drop cancels with `rejected`.
5. **rejects stacking onto a locked child** — `lock.move` on the onto-child
   rejects; assert the tree is unchanged after the drop.
6. **a controlled parent refuses a non-insert intent** — with
   `registerOrderControl` on the target, a stack intent is not accepted, the
   commit callback is never called, and the store is unwritten.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dnd/DragEngine.intent.test.ts`
Expected: FAIL — `getDropIntent` is not part of `DropTarget`.

- [ ] **Step 3: Implement**

- Add `getDropIntent?(point: Point): DropIntent | undefined` to `DropTarget`.
- Add `intent?: DropIntent` to `DragState['hover']`, spread conditionally, and
  include it in `sameHover` so a band change re-renders.
- In `sample()`: read the intent first; when it is `insert`, set `insertIndex`
  from it, so the two paths cannot disagree. Fall back to `getInsertionIndex`
  when no intent function is registered.
- In `checkAccept()`: take the resolved intent. For `stack`, additionally reject
  when `ontoId === draggingId`, when the onto-child is a descendant of the
  dragged node, when `store.isLocked(ontoId, 'move')`, and when the target's
  order is controlled (`this.orderControls.has(targetId)`).
- In `drop()`: switch on `hover.intent?.kind`. `stack` calls
  `store.stackNodes(draggingId, intent.ontoId, { id: newStackId() })`; anything
  else keeps today's `moveNode` path exactly. `split` is unreachable — throw
  `new Error('split intent has no commit path yet')` so a future wiring mistake
  is loud rather than silent.
- The new stack node needs an id. Take a `makeId?: () => NodeId` in
  `DragEngineOptions`, defaulting to a counter-based `stack-N` that checks the
  store for a collision. Trace it: `trace('dnd', \`drop: stack ${draggingId} onto ${ontoId} as ${id}\`)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/dnd/DragEngine.intent.test.ts && npx vitest run src/dnd/`
Expected: PASS, including every pre-existing DragEngine test.

- [ ] **Step 5: Mutation-check tests 4, 5 and 6**

Delete each rejection clause in turn and confirm exactly the matching test
fails. All three are "asserts something does not happen" — the shape that
passed vacuously twice in seam-join. Revert each.

- [ ] **Step 6: Commit**

```bash
git add src/dnd/DragEngine.ts src/dnd/DragEngine.intent.test.ts
git commit -m "carry a drop intent through hover and dispatch it at drop"
```

---

### Task 6: React wiring — default intent and the tab model

**Files:**
- Modify: `src/react/Container.tsx` (the `getInsertionIndex` wiring near line 305)
- Create: `src/react/dnd/useStack.ts`
- Modify: `src/react/index.ts`
- Modify: `src/react/dnd/defaultDragOverlay.tsx` (`DragOverlayContext.hover` gains `intent`)
- Test: `src/react/useStack.test.tsx`

- [ ] **Step 1: Write the failing test for `useStack`**

Assert against a stack container holding `a`, `b`:
- `tabs` is `[{ id: 'a', … }, { id: 'b', … }]` in `childOrder` order;
- `activeId` defaults to `'a'` with no config;
- `activate('b')` writes `container.config.activeId` and the next render reports `'b'`;
- `activate` on an id that is not a child is a no-op, not a write. (Mutation-check this one.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/react/useStack.test.tsx`
Expected: FAIL — cannot resolve `./dnd/useStack.js`.

- [ ] **Step 3: Implement `useStack`**

```ts
export interface StackTab {
  id: NodeId;
  title: string;
}

export interface StackModel {
  tabs: StackTab[];
  activeId: NodeId | undefined;
  activate(id: NodeId): void;
}

export function useStack(containerId: NodeId): StackModel;
```

Read children through the store binding the other hooks use (`useNodeBinding` /
`store.getChildren`), filter to `lifecycle.state !== 'destroyed'`, take `title`
from `node.meta.title` falling back to the id, and write activation with
`store.updateContainerConfig(containerId, { activeId: id })`. That call is gated
by `lock.arrange` — a known and deliberate wart, recorded in the spec.

- [ ] **Step 4: Wire the container's default intent**

In `Container.tsx`, where `getInsertionIndex` is composed from
`childRectsForContainer`, additionally supply `getDropIntent` built from
`resolveDropIntent` over the same rects, with `stack` enabled when the
container's own strategy is `stack`, or when its config sets
`stackOnDrop: true`. Keep `split` off — nothing commits it yet.

Both callbacks share one `childRectsForContainer` call per sample; do not
measure twice. This runs on every pointermove.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/react/`
Expected: PASS.

- [ ] **Step 6: Export and commit**

```bash
git add src/react/dnd/useStack.ts src/react/Container.tsx src/react/index.ts \
        src/react/dnd/defaultDragOverlay.tsx src/react/useStack.test.tsx
git commit -m "expose a stack's tab model and default its drop intent"
```

---

### Task 7: The story

**Files:**
- Create: `src/react/stories/TabStack.stories.tsx`

A story that only renders the feature is not integration — the Playwright suite
drives Ladle, so this file is the browser coverage.

- [ ] **Step 1: Build the fixture**

A strip zone holding three panels and one stack container, registry
`{ strip: stripStrategy, stack: stackStrategy }`. The stack's `headerSize`
matches the strip's rendered height.

- [ ] **Step 2: Render an operable tab strip**

Through `ChromeMap`, for `kind: 'group'` with a stack strategy: a row of buttons
from `useStack(id).tabs`, each with `data-testid={\`tab-${id}\`}`,
`aria-selected`, and `onClick={() => activate(id)}`. Roving tabindex — the
active tab is `tabIndex={0}`, the rest `-1`, arrow keys move between them.

- [ ] **Step 3: Make every pane draggable**

Each panel gets a `<DragHandle>` so a pointer drag can create and dissolve
stacks. Copy the handle wiring from `SeamJoin.stories.tsx`.

- [ ] **Step 4: Verify by hand**

Run: `npm run ladle` (or let the Playwright config start it). Confirm: dragging
a pane onto another's centre forms a stack, tabs switch, dragging the last tab
out dissolves it.

- [ ] **Step 5: Commit**

```bash
git add src/react/stories/TabStack.stories.tsx
git commit -m "drive tab-stacking from a Ladle story"
```

---

### Task 8: Browser coverage

**Files:**
- Create: `e2e/tab-stack.spec.ts`

- [ ] **Step 1: Write the specs**

Model them on `e2e/seam-join.spec.ts`. Four cases:
1. a drop in a pane's centre band forms a stack with two tabs;
2. clicking the inactive tab swaps which pane body is visible;
3. dragging the last tab out dissolves the stack and lifts the survivor;
4. a drop in a main-axis edge band still plain-inserts — no stack is created.

Case 4 is the negative assertion. Mutation-check it: force the resolver to
always stack and confirm it fails.

- [ ] **Step 2: Run across all three engines**

Run: `npm run test:e2e -- tab-stack`
Expected: PASS in Chromium, Firefox and WebKit. The config starts Ladle itself.

- [ ] **Step 3: Commit**

```bash
git add e2e/tab-stack.spec.ts
git commit -m "cover tab-stacking in three browser engines"
```

---

### Task 9: Documentation and the passing correction

**Files:**
- Modify: `src/layout-types.ts`, `README.md`, `CHANGELOG.md`, `TODO.md`

- [ ] **Step 1: Correct the stale comment**

`layout-types.ts` documents `maxSize` as honoured by "the strip / stack / split
strategies". `splitStrategy` does not exist. Now that `stackStrategy` does, make
the sentence true rather than aspirational.

- [ ] **Step 2: README**

Document `resolveDropIntent`, `stackStrategy`, `stackNodes` and `useStack`, and
the `headerSize` contract (the consumer draws the strip; the config reserves the
room).

- [ ] **Step 3: CHANGELOG under `## Unreleased`**

Two entries. The feature, and — separately — the behaviour change: grid
`unplace` overflow cells rendered in flow under `<Zone>` / `<Panel>` and now
render not at all, matching what `<Container>` has always done.

- [ ] **Step 4: TODO**

Close the "Drop *intent*" line under "Still uncovered" and the tab-stacking
bullet under "Merging adjacent nodes". Rewrite the drop-on-edge entry: it is now
a commit path, not a hit-test.

- [ ] **Step 5: Full verification**

```bash
npm test && npm run lint && npm run typecheck && npm run build && npm run test:e2e
```
Expected: all green. Report the actual counts, not "tests pass".

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "document drop intent and tab-stacking"
```

---

## Self-review notes

- Spec coverage: resolver (T1), stack strategy (T2), `unplaced` plumbing (T3),
  `stackNodes` (T4), engine dispatch + acceptance + controlled parent (T5),
  activation and chrome (T6, T7), tests (throughout), story (T7), e2e (T8),
  deferrals and the stale comment (T9). No spec section is unclaimed.
- Deferred by design and named in T5: the `split` intent has no commit path, and
  the engine throws rather than silently mis-dropping if one is ever wired.
