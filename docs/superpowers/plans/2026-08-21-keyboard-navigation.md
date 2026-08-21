# Keyboard Navigation and Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make windease's focus model observable by the browser and reachable by the keyboard, without windease taking the Tab key.

**Architecture:** A DOM-free core (`src/focus/`) holds the navigable set, the directional resolver, focus memory and the successor policy; a DOM adapter in `src/react/focus/` owns roving tabindex, `focusin`, the keydown map and ARIA. This mirrors `ContainerHost.setViewport()` / `observe(el)` — headless setter first, thin DOM wrapper beside it.

**Tech Stack:** TypeScript 6, vitest (node + jsdom), Playwright, React 19, biome.

**Design:** `docs/superpowers/specs/2026-08-21-keyboard-navigation-design.md`

**Coordination:** Another session (`windease-05`) works the palettes wishlist in `store.ts`, `strip.ts` and `layout-types.ts`, **in the same working tree** — commits interleave with no merge step to catch a collision. Tasks 1 and 2 open `store.ts`; Task 6 opens `layout-types.ts`; Task 12 opens `Playground.stories.tsx`. Message that session before each and when leaving. Our region in `store.ts` is `ContainerCap.lastFocusedId` and the focus block at `:954-1006`.

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `src/focus/types.ts` | `NavIntent`, `GeometrySource`, `FocusAdapter` |
| `src/focus/navigable.ts` | `navigableLeaves()` — visible, ≥1×1 leaves |
| `src/focus/resolve.ts` | `resolveNavigation()` — all intents |
| `src/focus/successor.ts` | `chooseSuccessor()` |
| `src/focus/name.ts` | `accessibleName()` |
| `src/focus/nullAdapter.ts` | `nullFocusAdapter` |
| `src/react/focus/useGeometrySource.ts` | `GeometrySource` over `ContainerHost` placements |
| `src/react/focus/FocusProvider.tsx` | roving tabindex, `focusin`, keydown, feedback guard |

**Modify:** `src/node.ts` (`ContainerCap.lastFocusedId`), `src/store.ts` (memory maintenance, successor policy, `focus.successor`), `src/layout-types.ts` (`navigate?`), `src/react/Container.tsx` (wrapper attrs, reduced motion), `src/index.ts` + `src/react/index.ts` (exports).

---

### Task 1: Focus memory on the container

**Files:**
- Modify: `src/node.ts:32-52`
- Modify: `src/store.ts:954-988` (`focusNode`), `src/store.ts:320-337` (`detachAndRemove`)
- Test: `src/focus/memory.test.ts` (create)

- [ ] **Step 1: Message the peer session before opening `store.ts`**

Send: "Opening store.ts now for ContainerCap.lastFocusedId and the focus block (954-1006). Will tell you when I'm out."

- [ ] **Step 2: Write the failing test**

Create `src/focus/memory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function treeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  for (const c of ['a', 'b']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    s.showNode(id(c));
  }
  return s;
}

describe('container focus memory', () => {
  it('records the focused descendant on every ancestor container', () => {
    const s = treeStore();
    s.focusNode(id('b'));
    expect(s.getNode(id('z'))?.container?.lastFocusedId).toBe(id('b'));
  });

  it('clears when the remembered child is removed', () => {
    const s = treeStore();
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.getNode(id('z'))?.container?.lastFocusedId).toBeUndefined();
  });

  it('clears when the remembered child moves to another parent', () => {
    const s = treeStore();
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z2') }),
    );
    s.focusNode(id('b'));
    s.moveNode(id('b'), id('z2'));
    expect(s.getNode(id('z'))?.container?.lastFocusedId).toBeUndefined();
    expect(s.getNode(id('z2'))?.container?.lastFocusedId).toBe(id('b'));
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/focus/memory.test.ts`
Expected: FAIL — `lastFocusedId` does not exist on `ContainerCap`.

- [ ] **Step 4: Add the field**

In `src/node.ts`, inside `ContainerCap` after `allowsPinning: boolean;`:

```ts
  /**
   * The descendant of this container that most recently held focus. Maintained
   * by the store, not by consumers: written on `focusNode`, cleared when that
   * node is removed or reparented. Session-only — deliberately not serialized,
   * see the keyboard-navigation design.
   */
  lastFocusedId?: NodeId;
```

- [ ] **Step 5: Write the memory on focus**

In `src/store.ts`, add a private method just above `focusNode`:

```ts
  private rememberFocus(id: NodeId): void {
    let cursor = this.nodesMap.get(id)?.membership?.parentId;
    while (cursor) {
      const parent = this.nodesMap.get(cursor);
      if (!parent?.container) break;
      this.nodesMap.set(cursor, {
        ...parent,
        container: { ...parent.container, lastFocusedId: id },
      });
      cursor = parent.membership?.parentId;
    }
  }
```

Call it in `focusNode`, immediately after `this.focusedIdValue = id;`:

```ts
    this.rememberFocus(id);
```

- [ ] **Step 6: Clear the memory on detach**

In `src/store.ts`, inside `detachAndRemove`, immediately before `this.nodesMap.delete(id);`:

```ts
    const detachParent = this.nodesMap.get(id)?.membership?.parentId;
    if (detachParent) {
      const p = this.nodesMap.get(detachParent);
      if (p?.container?.lastFocusedId === id) {
        const { lastFocusedId: _dropped, ...rest } = p.container;
        this.nodesMap.set(detachParent, { ...p, container: rest });
      }
    }
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run src/focus/memory.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Confirm nothing else broke**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/node.ts src/store.ts src/focus/memory.test.ts
git commit -m "feat(focus): remember the last-focused descendant per container"
```

---

### Task 2: Successor policy and the `focus.successor` event

**Files:**
- Create: `src/focus/successor.ts`, `src/focus/successor.test.ts`
- Modify: `src/store.ts:27-95` (events), `src/store.ts:296`, `src/store.ts:336`, `hideNode` at `src/store.ts:933`

- [ ] **Step 1: Write the failing test**

Create `src/focus/successor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { recordEvents } from '../test-utils/record-events.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function row(children: string[]): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  for (const c of children) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    s.showNode(id(c));
  }
  return s;
}

describe('focus successor', () => {
  it('moves focus to the next sibling when the focused node is destroyed', () => {
    const s = row(['a', 'b', 'c']);
    s.focusNode(id('b'));
    const rec = recordEvents(s, 'focus.successor');
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBe(id('c'));
    expect(rec.of('focus.successor')).toEqual([
      { from: id('b'), to: id('c'), reason: 'destroyed' },
    ]);
    rec.stop();
  });

  it('falls back to the previous sibling when the focused node was last', () => {
    const s = row(['a', 'b']);
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBe(id('a'));
  });

  it('reports null when nothing is left to focus', () => {
    const s = row(['a']);
    s.focusNode(id('a'));
    const rec = recordEvents(s, 'focus.successor');
    s.unregisterNode(id('a'));
    expect(s.focusedId).toBeNull();
    expect(rec.of('focus.successor')).toEqual([{ from: id('a'), to: null, reason: 'destroyed' }]);
    rec.stop();
  });

  it('hiding the focused node picks a successor with reason hidden', () => {
    const s = row(['a', 'b']);
    s.focusNode(id('a'));
    const rec = recordEvents(s, 'focus.successor');
    s.hideNode(id('a'));
    expect(s.focusedId).toBe(id('b'));
    expect(rec.of('focus.successor')).toEqual([{ from: id('a'), to: id('b'), reason: 'hidden' }]);
    rec.stop();
  });

  it('does not fire on an explicit focusNode', () => {
    const s = row(['a', 'b']);
    const rec = recordEvents(s, 'focus.successor');
    s.focusNode(id('a'));
    s.focusNode(id('b'));
    expect(rec.of('focus.successor')).toEqual([]);
    rec.stop();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/focus/successor.test.ts`
Expected: FAIL — `focusedId` is null after unregister, and no `focus.successor` event exists.

- [ ] **Step 3: Write the policy**

Create `src/focus/successor.ts`:

```ts
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';

function isFocusable(store: Store, id: NodeId): boolean {
  const n = store.getNode(id);
  return !!n?.focus && n.lifecycle.state === 'visible';
}

function firstLeafDepthFirst(store: Store, roots: readonly NodeId[], skip: NodeId): NodeId | null {
  for (const rid of roots) {
    if (rid === skip) continue;
    const node = store.getNode(rid);
    if (!node || node.lifecycle.state !== 'visible') continue;
    if (isFocusable(store, rid) && !node.container) return rid;
    const nested = firstLeafDepthFirst(
      store,
      store.getChildren(rid).map((c) => c.id),
      skip,
    );
    if (nested) return nested;
  }
  return null;
}

/**
 * Who takes focus when `departing` loses it. Order: next visible sibling,
 * previous visible sibling, the parent's remembered child, the parent itself,
 * then the first visible leaf anywhere. Null when the tree has nobody left.
 */
export function chooseSuccessor(store: Store, departing: NodeId): NodeId | null {
  const node = store.getNode(departing);
  const parentId = node?.membership?.parentId;

  if (parentId) {
    const siblings = store
      .getChildren(parentId)
      .map((c) => c.id)
      .filter((sid) => sid !== departing && isFocusable(store, sid));
    const order = store.getNode(parentId)?.container?.childOrder ?? [];
    const at = order.indexOf(departing);
    const after = siblings.find((sid) => order.indexOf(sid) > at);
    if (after) return after;
    const before = [...siblings].reverse().find((sid) => order.indexOf(sid) < at);
    if (before) return before;

    const remembered = store.getNode(parentId)?.container?.lastFocusedId;
    if (remembered && remembered !== departing && isFocusable(store, remembered)) {
      return remembered;
    }
    if (isFocusable(store, parentId)) return parentId;
  }

  return firstLeafDepthFirst(store, store.rootIds, departing);
}
```

- [ ] **Step 4: Add the event type**

In `src/store.ts`, in `StoreEvents` after `'container.added'`:

```ts
  /**
   * The store chose focus for you because the focused node went away. Never
   * emitted for an explicit `focusNode`. `to` is null when nothing remained.
   */
  'focus.successor': {
    from: NodeId;
    to: NodeId | null;
    reason: 'destroyed' | 'hidden' | 'moved';
  };
```

- [ ] **Step 5: Apply it on unregister and hide**

In `src/store.ts`, add a private method beside `rememberFocus`:

```ts
  private succeedFocus(from: NodeId, reason: 'destroyed' | 'hidden' | 'moved'): void {
    if (this.focusedIdValue !== from) return;
    const to = chooseSuccessor(this, from);
    this.focusedIdValue = null;
    if (to) {
      this.focusNode(to);
    } else {
      this.publisher.markGlobalsDirty();
      this.scheduleNotify();
    }
    this.events.emit('focus.successor', { from, to, reason });
    trace('store', `focus successor: ${from} → ${to ?? 'none'} (${reason})`);
  }
```

Import it at the top of `src/store.ts`:

```ts
import { chooseSuccessor } from './focus/successor.js';
```

Replace `src/store.ts:296` — `if (this.focusedIdValue === id) this.focusedIdValue = null;` — with:

```ts
    if (this.focusedIdValue === id) this.succeedFocus(id, 'destroyed');
```

Leave the identical line inside `detachAndRemove` (`:336`) as-is: it is the last-resort clear for paths that already ran the policy, and calling the policy there would run it twice.

In `hideNode`, after the `node.transitioned` emit:

```ts
    if (this.focusedIdValue === id) this.succeedFocus(id, 'hidden');
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run src/focus/successor.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: green. If a snapshot or lock test now sees an extra focus transition, that is the bug being fixed — read the assertion before changing it.

- [ ] **Step 8: Commit and tell the peer**

```bash
git add src/store.ts src/focus/successor.ts src/focus/successor.test.ts
git commit -m "fix(focus): name a successor instead of dropping focus to nothing"
```

Send: "Out of store.ts for now."

---

### Task 3: The navigable set

**Files:**
- Create: `src/focus/types.ts`, `src/focus/navigable.ts`, `src/focus/navigable.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/focus/navigable.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import type { GeometrySource } from './types.js';
import { navigableLeaves } from './navigable.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function rects(map: Record<string, [number, number, number, number]>): GeometrySource {
  return {
    rectOf(nid) {
      const r = map[nid];
      return r ? { x: r[0], y: r[1], w: r[2], h: r[3] } : null;
    },
  };
}

function row(children: string[]): Store {
  const s = new Store();
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  for (const c of children) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    s.showNode(id(c));
  }
  return s;
}

describe('navigableLeaves', () => {
  it('returns visible focusable leaves in depth-first order', () => {
    const s = row(['a', 'b']);
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 10, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a'), id('b')]);
  });

  it('skips a zero-area node', () => {
    const s = row(['a', 'b']);
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 0, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a')]);
  });

  it('skips a sub-pixel node', () => {
    const s = row(['a', 'b']);
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 0.4, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a')]);
  });

  it('skips a hidden node', () => {
    const s = row(['a', 'b']);
    s.hideNode(id('b'));
    const g = rects({ a: [0, 0, 10, 10], b: [20, 0, 10, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a')]);
  });

  it('skips a node with no geometry', () => {
    const s = row(['a', 'b']);
    const g = rects({ a: [0, 0, 10, 10] });
    expect(navigableLeaves(s, g)).toEqual([id('a')]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/focus/navigable.test.ts`
Expected: FAIL — module `./navigable.js` not found.

- [ ] **Step 3: Write the types**

Create `src/focus/types.ts`:

```ts
import type { NodeId } from '../node.js';
import type { Rect } from '../layout-types.js';

/** Where a node sits, in one coordinate space shared by the whole tree. The
 *  resolver never measures — a host supplies this. */
export interface GeometrySource {
  rectOf(id: NodeId): Rect | null;
}

export type NavIntent =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'cycleNext'
  | 'cyclePrev';

export type NavDirection = 'left' | 'right' | 'up' | 'down';

/** Reflects model focus onto whatever the host platform's focus is. The DOM
 *  implementation moves the caret; a canvas host draws a ring. Input flows the
 *  other way through store methods, so it needs no surface here. */
export interface FocusAdapter {
  present(id: NodeId | null): void;
  announce(text: string): void;
}
```

- [ ] **Step 4: Write the navigable set**

Create `src/focus/navigable.ts`:

```ts
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import type { GeometrySource } from './types.js';

/** Below this, a pane is as unreachable as one at zero, and float geometry
 *  makes exact-zero comparisons unreliable. */
const MIN_NAVIGABLE_PX = 1;

export function navigableLeaves(store: Store, geometry: GeometrySource): NodeId[] {
  const out: NodeId[] = [];
  const walk = (ids: readonly NodeId[]): void => {
    for (const nid of ids) {
      const node = store.getNode(nid);
      if (!node || node.lifecycle.state !== 'visible') continue;
      const children = store.getChildren(nid).map((c) => c.id);
      if (children.length > 0) {
        walk(children);
        continue;
      }
      if (!node.focus) continue;
      const r = geometry.rectOf(nid);
      if (!r || r.w < MIN_NAVIGABLE_PX || r.h < MIN_NAVIGABLE_PX) continue;
      out.push(nid);
    }
  };
  walk(store.rootIds);
  return out;
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/focus/navigable.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/focus/types.ts src/focus/navigable.ts src/focus/navigable.test.ts
git commit -m "feat(focus): build the navigable set, skipping zero-area nodes"
```

---

### Task 4: Directional resolution

**Files:**
- Create: `src/focus/resolve.ts`, `src/focus/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/focus/resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { resolveNavigation } from './resolve.js';
import type { GeometrySource } from './types.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

/** a b across the top, c bottom-left. */
function grid(): { store: Store; geometry: GeometrySource } {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'grid', config: {} }, id: id('z') }),
  );
  for (const c of ['a', 'b', 'c']) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    store.showNode(id(c));
  }
  const map: Record<string, { x: number; y: number; w: number; h: number }> = {
    a: { x: 0, y: 0, w: 100, h: 100 },
    b: { x: 110, y: 0, w: 100, h: 100 },
    c: { x: 0, y: 110, w: 100, h: 100 },
  };
  return { store, geometry: { rectOf: (nid) => map[nid] ?? null } };
}

describe('resolveNavigation — directional', () => {
  it('right moves to the neighbor in that half-plane', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('b'));
  });

  it('down moves to the node below', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('a'), intent: 'down', geometry })).toBe(id('c'));
  });

  it('returns null rather than wrapping', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('b'), intent: 'right', geometry })).toBeNull();
  });

  it('prefers the nearer candidate on the primary axis', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('c'), intent: 'up', geometry })).toBe(id('a'));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/focus/resolve.test.ts`
Expected: FAIL — module `./resolve.js` not found.

- [ ] **Step 3: Write the resolver**

Create `src/focus/resolve.ts`:

```ts
import type { Rect } from '../layout-types.js';
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { navigableLeaves } from './navigable.js';
import type { GeometrySource, NavDirection, NavIntent } from './types.js';

export interface ResolveInput {
  store: Store;
  from: NodeId;
  intent: NavIntent;
  geometry: GeometrySource;
}

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Cross-axis drift costs less than primary-axis distance, so a node straight
 *  ahead beats a nearer one far off to the side. */
const CROSS_AXIS_PENALTY = 2;

function directional(
  store: Store,
  from: NodeId,
  direction: NavDirection,
  geometry: GeometrySource,
): NodeId | null {
  const source = geometry.rectOf(from);
  if (!source) return null;
  const origin = center(source);

  let best: { id: NodeId; score: number } | null = null;
  for (const candidate of navigableLeaves(store, geometry)) {
    if (candidate === from) continue;
    const r = geometry.rectOf(candidate);
    if (!r) continue;
    const c = center(r);
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;

    let primary: number;
    let cross: number;
    if (direction === 'left') {
      if (dx >= 0) continue;
      primary = -dx;
      cross = Math.abs(dy);
    } else if (direction === 'right') {
      if (dx <= 0) continue;
      primary = dx;
      cross = Math.abs(dy);
    } else if (direction === 'up') {
      if (dy >= 0) continue;
      primary = -dy;
      cross = Math.abs(dx);
    } else {
      if (dy <= 0) continue;
      primary = dy;
      cross = Math.abs(dx);
    }

    const score = primary + CROSS_AXIS_PENALTY * cross;
    if (!best || score < best.score) best = { id: candidate, score };
  }
  return best ? best.id : null;
}

export function resolveNavigation({ store, from, intent, geometry }: ResolveInput): NodeId | null {
  switch (intent) {
    case 'left':
    case 'right':
    case 'up':
    case 'down':
      return directional(store, from, intent, geometry);
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/focus/resolve.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/focus/resolve.ts src/focus/resolve.test.ts
git commit -m "feat(focus): resolve directional navigation against placements"
```

---

### Task 5: Sibling and cycle intents

**Files:**
- Modify: `src/focus/resolve.ts`, `src/focus/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/focus/resolve.test.ts`:

```ts
describe('resolveNavigation — ordinal and cycle', () => {
  it('next moves to the following sibling', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('a'), intent: 'next', geometry })).toBe(id('b'));
  });

  it('next returns null at the end of the row', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('c'), intent: 'next', geometry })).toBeNull();
  });

  it('first and last jump to the ends', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('b'), intent: 'first', geometry })).toBe(id('a'));
    expect(resolveNavigation({ store, from: id('a'), intent: 'last', geometry })).toBe(id('c'));
  });

  it('cycleNext wraps around the whole tree', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('c'), intent: 'cycleNext', geometry })).toBe(id('a'));
  });

  it('cyclePrev wraps backwards', () => {
    const { store, geometry } = grid();
    expect(resolveNavigation({ store, from: id('a'), intent: 'cyclePrev', geometry })).toBe(id('c'));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/focus/resolve.test.ts -t "ordinal and cycle"`
Expected: FAIL — all five return null.

- [ ] **Step 3: Implement the remaining intents**

In `src/focus/resolve.ts`, add above `resolveNavigation`:

```ts
function siblingsOf(store: Store, from: NodeId, geometry: GeometrySource): NodeId[] {
  const parentId = store.getNode(from)?.membership?.parentId;
  if (!parentId) return [];
  const navigable = new Set(navigableLeaves(store, geometry));
  return store
    .getChildren(parentId)
    .map((c) => c.id)
    .filter((cid) => navigable.has(cid));
}
```

Replace the `default:` arm of the switch with:

```ts
    case 'next':
    case 'prev': {
      const row = siblingsOf(store, from, geometry);
      const at = row.indexOf(from);
      if (at < 0) return null;
      const to = intent === 'next' ? row[at + 1] : row[at - 1];
      return to ?? null;
    }
    case 'first':
    case 'last': {
      const row = siblingsOf(store, from, geometry);
      const to = intent === 'first' ? row[0] : row[row.length - 1];
      return to && to !== from ? to : null;
    }
    case 'cycleNext':
    case 'cyclePrev': {
      const all = navigableLeaves(store, geometry);
      if (all.length === 0) return null;
      const at = all.indexOf(from);
      if (at < 0) return all[0] ?? null;
      const step = intent === 'cycleNext' ? 1 : -1;
      return all[(at + step + all.length) % all.length] ?? null;
    }
    default:
      return null;
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/focus/resolve.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/focus/resolve.ts src/focus/resolve.test.ts
git commit -m "feat(focus): add sibling and whole-tree cycle intents"
```

---

### Task 6: Strategy `navigate?` override

**Files:**
- Modify: `src/layout-types.ts` (after `canAccept?`), `src/focus/resolve.ts`
- Test: `src/focus/resolve.override.test.ts` (create)

Coordination: `layout-types.ts` is also touched by the affordance workstream. Confirm with `windease-05` before editing.

- [ ] **Step 1: Write the failing test**

Create `src/focus/resolve.override.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import type { LayoutStrategy } from '../layout-types.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { resolveNavigation } from './resolve.js';
import type { GeometrySource } from './types.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function scene(navigate?: LayoutStrategy['navigate']) {
  const store = new Store();
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'custom', config: {} }, id: id('z') }),
  );
  for (const c of ['a', 'b']) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    store.showNode(id(c));
  }
  const map: Record<string, { x: number; y: number; w: number; h: number }> = {
    a: { x: 0, y: 0, w: 100, h: 100 },
    b: { x: 110, y: 0, w: 100, h: 100 },
  };
  const geometry: GeometrySource = { rectOf: (nid) => map[nid] ?? null };
  const strategy: LayoutStrategy = {
    name: 'custom',
    layout: () => ({ placements: new Map(), affordances: [] }),
    navigate,
  };
  const strategies = new Map([['custom', strategy]]);
  return { store, geometry, strategies };
}

describe('resolveNavigation — strategy override', () => {
  it('an id returned by the strategy wins', () => {
    const { store, geometry, strategies } = scene(() => 'a');
    expect(
      resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies }),
    ).toBe(id('a'));
  });

  it('undefined falls through to geometry', () => {
    const { store, geometry, strategies } = scene(() => undefined);
    expect(
      resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies }),
    ).toBe(id('b'));
  });

  it('null stops the search', () => {
    const { store, geometry, strategies } = scene(() => null);
    expect(
      resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/focus/resolve.override.test.ts`
Expected: FAIL — `navigate` is not a property of `LayoutStrategy`.

- [ ] **Step 3: Add the hook to the strategy interface**

In `src/layout-types.ts`, inside `LayoutStrategy` immediately after `canAccept?`:

```ts
  /**
   * Optional override for directional keyboard navigation within this
   * container. Return an item id to win, `undefined` to fall through to
   * geometric resolution, or `null` to declare the direction dead here.
   */
  navigate?(input: {
    items: LayoutItem[];
    from: ItemId;
    direction: 'left' | 'right' | 'up' | 'down';
    options: Record<string, unknown>;
  }): ItemId | null | undefined;
```

- [ ] **Step 4: Consult it in the resolver**

In `src/focus/resolve.ts`, extend `ResolveInput`:

```ts
  strategies?: ReadonlyMap<string, LayoutStrategy<unknown, string, unknown>>;
```

Import the types:

```ts
import type { LayoutItem, LayoutStrategy, Rect } from '../layout-types.js';
import { nodeToLayoutItem } from '../layout-node-adapter.js';
```

At the top of the directional arm in `resolveNavigation`, before calling `directional`:

```ts
    case 'left':
    case 'right':
    case 'up':
    case 'down': {
      const parentId = store.getNode(from)?.membership?.parentId;
      const parent = parentId ? store.getNode(parentId) : undefined;
      const strategy = parent?.container
        ? strategies?.get(parent.container.strategyId)
        : undefined;
      if (strategy?.navigate && parentId) {
        const items: LayoutItem[] = store
          .getChildren(parentId)
          .map((c) => nodeToLayoutItem(c));
        const chosen = strategy.navigate({
          items,
          from,
          direction: intent,
          options: (parent?.container?.config ?? {}) as Record<string, unknown>,
        });
        if (chosen !== undefined) return chosen === null ? null : (chosen as NodeId);
      }
      return directional(store, from, intent, geometry);
    }
```

Destructure `strategies` in the signature: `({ store, from, intent, geometry, strategies })`.

- [ ] **Step 5: Verify `nodeToLayoutItem` is exported with that name**

Run: `grep -n "export function nodeToLayoutItem" src/layout-node-adapter.ts`
Expected: one match. If the name differs, use the exported one and keep it consistent for the rest of the plan.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/focus/`
Expected: PASS — all focus tests including the three override cases.

- [ ] **Step 7: Commit**

```bash
git add src/layout-types.ts src/focus/resolve.ts src/focus/resolve.override.test.ts
git commit -m "feat(focus): let a strategy override directional navigation"
```

---

### Task 7: Accessible name, null adapter, and exports

**Files:**
- Create: `src/focus/name.ts`, `src/focus/name.test.ts`, `src/focus/nullAdapter.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/focus/name.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { accessibleName } from './name.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

describe('accessibleName', () => {
  it('uses meta.title when present', () => {
    const s = new Store();
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('p'), meta: { title: 'Logs' } }));
    expect(accessibleName(s, id('p'))).toBe('Logs');
  });

  it('falls back to kind plus a one-based index', () => {
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
    );
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('a'), parentId: id('z') }));
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id('b'), parentId: id('z') }));
    expect(accessibleName(s, id('b'))).toBe('panel 2');
  });

  it('falls back to the id when there is no kind', () => {
    const s = new Store();
    s.registerNode(createNode({ focus: true, id: id('solo') }));
    expect(accessibleName(s, id('solo'))).toBe('solo');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/focus/name.test.ts`
Expected: FAIL — module `./name.js` not found.

- [ ] **Step 3: Write it**

Create `src/focus/name.ts`:

```ts
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';

/**
 * The node's accessible name. `meta.title` is the reserved key for it; without
 * one, the node's kind plus its one-based position among siblings, and failing
 * that its id.
 */
export function accessibleName(store: Store, id: NodeId): string {
  const node = store.getNode(id);
  if (!node) return String(id);
  const title = node.meta?.title;
  if (typeof title === 'string' && title.length > 0) return title;
  if (!node.kind) return String(id);
  const parentId = node.membership?.parentId;
  const order = parentId ? (store.getNode(parentId)?.container?.childOrder ?? []) : store.rootIds;
  const at = order.indexOf(id);
  return at >= 0 ? `${node.kind} ${at + 1}` : String(node.kind);
}
```

Create `src/focus/nullAdapter.ts`:

```ts
import type { FocusAdapter } from './types.js';

/**
 * Does nothing, on purpose. Core tests run against it, and it is what a host
 * with no platform focus concept installs. Its real job is keeping the
 * `FocusAdapter` interface honest: an interface with one implementation
 * always grows assumptions about that implementation.
 */
export const nullFocusAdapter: FocusAdapter = {
  present() {},
  announce() {},
};
```

- [ ] **Step 4: Export the public surface**

In `src/index.ts`, add a block in alphabetical position:

```ts
export { accessibleName } from './focus/name.js';
export { navigableLeaves } from './focus/navigable.js';
export { nullFocusAdapter } from './focus/nullAdapter.js';
export { resolveNavigation, type ResolveInput } from './focus/resolve.js';
export { chooseSuccessor } from './focus/successor.js';
export type {
  FocusAdapter,
  GeometrySource,
  NavDirection,
  NavIntent,
} from './focus/types.js';
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/focus/name.ts src/focus/name.test.ts src/focus/nullAdapter.ts src/index.ts
git commit -m "feat(focus): add accessible names, the null adapter, and core exports"
```

---

### Task 8: Geometry from the React layer

**Files:**
- Create: `src/react/focus/useGeometrySource.ts`, `src/react/focus/useGeometrySource.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/react/focus/useGeometrySource.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import { Container } from '../Container.js';
import { Provider } from '../Provider.js';
import { StrategyRegistryProvider } from '../strategies.js';
import { GeometryProvider, useGeometrySource } from './useGeometrySource.js';

function makeStore(): Store {
  const s = new Store();
  const z = asNodeId('z');
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
      id: z,
    }),
  );
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: z }));
    s.showNode(nid);
  }
  return s;
}

function Probe({ onRead }: { onRead: (w: number | null) => void }) {
  const geometry = useGeometrySource();
  onRead(geometry.rectOf(asNodeId('a'))?.w ?? null);
  return null;
}

describe('useGeometrySource', () => {
  it('reports a rect for a placed child', () => {
    const store = makeStore();
    let width: number | null = null;
    render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <GeometryProvider>
            <Container parentId={asNodeId('z')} chrome={{}} viewport={{ w: 200, h: 100 }} />
            <Probe onRead={(w) => { width = w; }} />
          </GeometryProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(width).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/react/focus/useGeometrySource.test.tsx`
Expected: FAIL — module `./useGeometrySource.js` not found.

- [ ] **Step 3: Implement it**

Create `src/react/focus/useGeometrySource.ts`:

```ts
import { createContext, createElement, type ReactNode, useContext, useMemo, useRef } from 'react';
import type { GeometrySource, NodeId, Rect } from '../../index.js';

type RectRegistry = Map<string, Rect>;

const GeometryContext = createContext<RectRegistry | null>(null);

/**
 * Collects absolute rects for every placed node so the resolver can compare
 * across containers. `<Container>` reports each child's rect composed with its
 * own origin, which is what makes directional navigation work across nesting
 * without anyone calling `getBoundingClientRect`.
 */
export function GeometryProvider({ children }: { children: ReactNode }) {
  const registry = useRef<RectRegistry>(new Map()).current;
  return createElement(GeometryContext.Provider, { value: registry }, children);
}

export function useGeometryRegistry(): RectRegistry | null {
  return useContext(GeometryContext);
}

export function useGeometrySource(): GeometrySource {
  const registry = useContext(GeometryContext);
  return useMemo(
    () => ({
      rectOf(id: NodeId): Rect | null {
        return registry?.get(String(id)) ?? null;
      },
    }),
    [registry],
  );
}
```

- [ ] **Step 4: Report rects from `Container`**

In `src/react/Container.tsx`, inside the component that owns `layout.placements`, after the layout is computed:

```ts
  const geometryRegistry = useGeometryRegistry();
  const selfRect = geometryRegistry?.get(String(parentId));
  useEffect(() => {
    if (!geometryRegistry) return;
    const originX = selfRect?.x ?? 0;
    const originY = selfRect?.y ?? 0;
    for (const [cid, r] of layout.placements) {
      geometryRegistry.set(String(cid), {
        x: originX + r.x,
        y: originY + r.y,
        w: r.w,
        h: r.h,
      });
    }
    return () => {
      for (const cid of layout.placements.keys()) geometryRegistry.delete(String(cid));
    };
  }, [geometryRegistry, layout.placements, selfRect?.x, selfRect?.y]);
```

Import at the top: `import { useGeometryRegistry } from './focus/useGeometrySource.js';`

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/react/focus/useGeometrySource.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/react/focus/ src/react/Container.tsx
git commit -m "feat(react): publish composed placement rects as a GeometrySource"
```

---

### Task 9: Roving tabindex and the focusin round-trip

**Files:**
- Create: `src/react/focus/FocusProvider.tsx`, `src/react/focus/FocusProvider.test.tsx`
- Modify: `src/react/Container.tsx` (child wrapper attributes)

- [ ] **Step 1: Write the failing test**

Create `src/react/focus/FocusProvider.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import { Container } from '../Container.js';
import { Provider } from '../Provider.js';
import { StrategyRegistryProvider } from '../strategies.js';
import { FocusProvider } from './FocusProvider.js';
import { GeometryProvider } from './useGeometrySource.js';

function makeStore(): Store {
  const s = new Store();
  const z = asNodeId('z');
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
      id: z,
    }),
  );
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: z }));
    s.showNode(nid);
  }
  return s;
}

function tree(store: Store) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          <FocusProvider>
            <Container parentId={asNodeId('z')} chrome={{}} viewport={{ w: 200, h: 100 }} />
          </FocusProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

describe('FocusProvider', () => {
  it('gives exactly one wrapper tabIndex 0', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('b'));
    const { container } = render(tree(store));
    await waitFor(() => {
      const stops = container.querySelectorAll('[data-node][tabindex="0"]');
      expect(stops.length).toBe(1);
      expect(stops[0]?.getAttribute('data-node')).toBe('b');
    });
  });

  it('raises model focus when a wrapper receives focusin', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    const { container } = render(tree(store));
    const wrapper = container.querySelector('[data-node="b"]') as HTMLElement;
    wrapper.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await waitFor(() => expect(store.focusedId).toBe(asNodeId('b')));
  });

  it('does not oscillate when it moves focus itself', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    render(tree(store));
    let transitions = 0;
    store.events.on('node.transitioned', (e) => {
      if (e.machine === 'focus') transitions++;
    });
    store.focusNode(asNodeId('b'));
    await waitFor(() => expect(store.focusedId).toBe(asNodeId('b')));
    // a blurs, b focuses. A feedback loop would keep adding pairs.
    expect(transitions).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/react/focus/FocusProvider.test.tsx`
Expected: FAIL — module `./FocusProvider.js` not found.

- [ ] **Step 3: Write the provider**

Create `src/react/focus/FocusProvider.tsx`:

```tsx
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from 'react';
import { type NodeId, asNodeId } from '../../index.js';
import { useStore } from '../Provider.js';

interface FocusBinding {
  /** True while the adapter is writing DOM focus from model focus; the
   *  `focusin` this causes must be ignored or the two directions oscillate. */
  applying: { current: boolean };
}

const FocusBindingContext = createContext<FocusBinding | null>(null);

export function useFocusBinding(): FocusBinding | null {
  return useContext(FocusBindingContext);
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const applying = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const binding = useMemo<FocusBinding>(() => ({ applying }), []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onFocusIn = (e: FocusEvent) => {
      if (applying.current) return;
      const target = e.target as Element | null;
      const wrapper = target?.closest('[data-node]');
      const raw = wrapper?.getAttribute('data-node');
      if (!raw) return;
      const id = asNodeId(raw) as NodeId;
      if (store.focusedId === id) return;
      if (!store.hasFocus(id)) return;
      store.focusNode(id);
    };
    el.addEventListener('focusin', onFocusIn);
    return () => el.removeEventListener('focusin', onFocusIn);
  }, [store]);

  useEffect(() => {
    return store.subscribe(() => {
      const el = rootRef.current;
      const id = store.focusedId;
      if (!el || !id) return;
      const wrapper = el.querySelector(`[data-node="${CSS.escape(String(id))}"]`);
      if (!(wrapper instanceof HTMLElement)) return;
      if (document.activeElement === wrapper || wrapper.contains(document.activeElement)) return;
      applying.current = true;
      try {
        wrapper.focus();
      } finally {
        applying.current = false;
      }
    });
  }, [store]);

  return (
    <FocusBindingContext.Provider value={binding}>
      <div ref={rootRef} className="windease-focus-root">
        {children}
      </div>
    </FocusBindingContext.Provider>
  );
}
```

- [ ] **Step 4: Put the attributes on the wrapper**

In `src/react/Container.tsx`, in the real-child branch (currently `<div key={id} style={childStyle} data-node={id}>`), replace with:

```tsx
          return (
            <div
              key={id}
              style={childStyle}
              data-node={id}
              tabIndex={focusedId === id ? 0 : -1}
              role="group"
              aria-label={accessibleName(store, id as NodeId)}
            >
              <NodeRenderer id={id} chrome={chrome} />
            </div>
          );
```

Add near the top of that component:

```ts
  const store = useStore();
  const focusedId = useFocusedNode()?.id ?? null;
```

Imports: `import { accessibleName, type NodeId } from '../index.js';`, `import { useFocusedNode } from './hooks.js';`, `import { useStore } from './Provider.js';` (skip any already present).

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/react/focus/FocusProvider.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/react/focus/FocusProvider.tsx src/react/focus/FocusProvider.test.tsx src/react/Container.tsx
git commit -m "feat(react): roving tabindex and a guarded focusin round-trip"
```

---

### Task 10: The keymap

**Files:**
- Modify: `src/react/focus/FocusProvider.tsx`
- Test: `src/react/focus/keymap.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/react/focus/keymap.test.tsx`. Reuse the `makeStore`/`tree` helpers from `FocusProvider.test.tsx` verbatim (copy them in — the engineer may be reading tasks out of order), then:

```tsx
describe('keymap', () => {
  it('ArrowRight on a wrapper moves focus', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    const { container } = render(tree(store));
    const wrapper = container.querySelector('[data-node="a"]') as HTMLElement;
    wrapper.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    await waitFor(() => expect(store.focusedId).toBe(asNodeId('b')));
  });

  it('ArrowRight inside content does NOT move focus', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    const { container } = render(tree(store));
    const wrapper = container.querySelector('[data-node="a"]') as HTMLElement;
    const input = document.createElement('input');
    wrapper.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(store.focusedId).toBe(asNodeId('a'));
  });

  it('F6 cycles from inside content', async () => {
    const store = makeStore();
    store.focusNode(asNodeId('a'));
    const { container } = render(tree(store));
    const wrapper = container.querySelector('[data-node="a"]') as HTMLElement;
    const input = document.createElement('input');
    wrapper.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', bubbles: true }));
    await waitFor(() => expect(store.focusedId).toBe(asNodeId('b')));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/react/focus/keymap.test.tsx`
Expected: FAIL — the first and third cases leave focus on `a`.

- [ ] **Step 3: Add the handler**

In `src/react/focus/FocusProvider.tsx`, add inside the component:

```ts
  const geometry = useGeometrySource();
  const strategies = useStrategyRegistry();

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const from = store.focusedId;
      if (!from) return;
      const target = e.target as Element | null;
      const onWrapper = target instanceof HTMLElement && target.hasAttribute('data-node');

      let intent: NavIntent | null = null;
      if (e.key === 'F6') {
        intent = e.shiftKey ? 'cyclePrev' : 'cycleNext';
      } else if (onWrapper) {
        if (e.key === 'ArrowLeft') intent = 'left';
        else if (e.key === 'ArrowRight') intent = 'right';
        else if (e.key === 'ArrowUp') intent = 'up';
        else if (e.key === 'ArrowDown') intent = 'down';
        else if (e.key === 'Home') intent = 'first';
        else if (e.key === 'End') intent = 'last';
      }
      if (!intent) return;

      const to = resolveNavigation({ store, from, intent, geometry, strategies });
      if (!to) return;
      e.preventDefault();
      store.focusNode(to);
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [store, geometry, strategies]);
```

Imports: `import { type NavIntent, resolveNavigation } from '../../index.js';`, `import { useStrategyRegistry } from '../strategies.js';`, `import { useGeometrySource } from './useGeometrySource.js';`

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/react/focus/keymap.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Export the React surface**

In `src/react/index.ts`:

```ts
export { FocusProvider, useFocusBinding } from './focus/FocusProvider.js';
export {
  GeometryProvider,
  useGeometryRegistry,
  useGeometrySource,
} from './focus/useGeometrySource.js';
```

- [ ] **Step 6: Full suite and commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build`

```bash
git add src/react/focus/ src/react/index.ts
git commit -m "feat(react): bind arrows, Home/End and F6 to navigation intents"
```

---

### Task 11: Reduced motion

**Files:**
- Modify: `src/react/Container.tsx:211`
- Test: `src/react/reduced-motion.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/react/reduced-motion.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

function makeStore(): Store {
  const s = new Store();
  const z = asNodeId('z');
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
      id: z,
    }),
  );
  const a = asNodeId('a');
  s.registerNode(createNode({ kind: 'panel', focus: true, id: a, parentId: z }));
  s.showNode(a);
  return s;
}

describe('prefers-reduced-motion', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      (q: string) => ({
        matches: q.includes('prefers-reduced-motion'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    );
  });

  it('drops the settle transition', () => {
    const { container } = render(
      <Provider store={makeStore()}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Container
            parentId={asNodeId('z')}
            chrome={{}}
            viewport={{ w: 200, h: 100 }}
            settleMs={200}
          />
        </StrategyRegistryProvider>
      </Provider>,
    );
    const child = container.querySelector('[data-node="a"]') as HTMLElement;
    expect(child.style.transition).toBe('');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/react/reduced-motion.test.tsx`
Expected: FAIL — transition string is present.

- [ ] **Step 3: Implement**

In `src/react/Container.tsx`, replace the `effectiveSettleMs` line (`:211`):

```ts
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effectiveSettleMs = draggingAffordanceId !== null || reducedMotion ? 0 : settleMs;
```

- [ ] **Step 4: Run the test, then the suite**

Run: `npx vitest run src/react/reduced-motion.test.tsx`
Expected: PASS.
Run: `npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/react/Container.tsx src/react/reduced-motion.test.tsx
git commit -m "fix(react): honor prefers-reduced-motion for settle transitions"
```

---

### Task 12: End-to-end coverage

**Files:**
- Create: `e2e/keyboard.spec.ts`
- Modify: `src/react/stories/Playground.stories.tsx` (wrap in the two providers)

- [ ] **Step 1: Wrap the Playground story**

In `src/react/stories/Playground.stories.tsx`, wrap the existing tree inside `<StrategyRegistryProvider>`:

```tsx
        <GeometryProvider>
          <FocusProvider>
            {/* existing children unchanged */}
          </FocusProvider>
        </GeometryProvider>
```

Import: `import { FocusProvider, GeometryProvider } from '../index.js';`

- [ ] **Step 2: Write the spec**

Create `e2e/keyboard.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'playground--playground';

function focusedNode(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => document.activeElement?.closest('[data-node]')?.getAttribute('data-node') ?? null,
  );
}

test.describe('keyboard navigation', () => {
  test('the whole tree costs one tab stop', async ({ page }) => {
    await openStory(page, STORY);
    const stops = await page.locator('[data-node][tabindex="0"]').count();
    expect(stops).toBe(1);
  });

  test('an arrow key moves focus between windows', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node][tabindex="0"]').focus();
    const before = await focusedNode(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focusedNode(page)).not.toBe(before);
  });

  test('F6 cycles from inside a text input', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node][tabindex="0"]').focus();
    const before = await focusedNode(page);
    await page.keyboard.press('F6');
    await expect.poll(() => focusedNode(page)).not.toBe(before);
  });

  test('focus survives destroying the focused panel', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node][tabindex="0"]').focus();
    const doomed = await focusedNode(page);
    await page.evaluate((id) => {
      const w = window as unknown as { __store?: { unregisterNode: (i: string) => void } };
      w.__store?.unregisterNode(id as string);
    }, doomed);
    await expect.poll(() => focusedNode(page)).not.toBeNull();
  });
});
```

- [ ] **Step 3: Expose the store to the last test**

In `Playground.stories.tsx`, inside the component after `const store = useMemo(...)`:

```ts
  useEffect(() => {
    (window as unknown as { __store?: Store }).__store = store;
  }, [store]);
```

- [ ] **Step 4: Run e2e**

Run: `npm run test:e2e -- e2e/keyboard.spec.ts`
Expected: PASS, 4 tests. If the arrow test fails because nothing sits to the right, use `ArrowDown` — check the Playground's actual arrangement first with `npx playwright test --headed`.

- [ ] **Step 5: Full green**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`

- [ ] **Step 6: Commit**

```bash
git add e2e/keyboard.spec.ts src/react/stories/Playground.stories.tsx
git commit -m "test(e2e): cover tab budget, arrows, F6 and focus survival"
```

---

### Task 13: Documentation and release

**Files:**
- Modify: `docs/concepts.md` (events list ~line 356, a new Focus section), `README.md`, `TODO.md`, `package.json`

- [ ] **Step 1: Add `focus.successor` to the events list**

In `docs/concepts.md`, in the events code block after `container.added`:

```
focus.successor
```

- [ ] **Step 2: Document the reserved `meta.title` key**

In `docs/concepts.md`, under the node-meta discussion:

```markdown
`meta.title` is reserved as a node's **accessible name**. The React layer maps
it onto `aria-label`; without one, `accessibleName()` falls back to the node's
kind plus its one-based sibling index.
```

- [ ] **Step 3: Add a README section**

Document `FocusProvider`, `GeometryProvider`, the keymap table from the spec, and that Tab is not intercepted.

- [ ] **Step 4: Move the TODO entries**

In `TODO.md`, add a "Shipped in 1.2.0" section describing keyboard navigation, and delete the two now-fixed Loose ends entries if present.

- [ ] **Step 5: Verify, then bump**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`
Expected: all green.

```bash
git add docs/concepts.md README.md TODO.md
git commit -m "docs: keyboard navigation, focus.successor, and reserved meta.title"
npm version minor
```

`postversion` pushes the branch and tag; the tag triggers the Release workflow, which publishes via OIDC.

---

## Self-Review

**Spec coverage.** Focus memory → Task 1. Successor policy and `focus.successor` → Task 2. Navigable set and the zero-area rule → Task 3. Directional resolution → Task 4. Sibling and cycle intents → Task 5. `navigate?` override → Task 6. Accessible name, null adapter, `GeometrySource` type → Tasks 3 and 7. React geometry → Task 8. Roving tabindex, `focusin`, feedback guard → Task 9. Keymap → Task 10. ARIA role and label → Task 9, Step 4. Reduced motion → Task 11. e2e → Task 12.

**Deliberately not covered, matching the spec's Out of scope:** keyboard move/resize/split, a visible switcher, custom keymaps, multi-select, the DOM-proxy adapter.

**Two gaps recorded rather than papered over:**

1. **`announce()` has no call site yet.** `FocusAdapter` and `nullFocusAdapter` ship in Task 7, and DOM focus movement announces names for free — but the live region for successor and relocation announcements has no task. It needs one before the a11y story is complete; it is small and additive, and folding it in would have meant writing a live-region implementation this plan has not designed.
2. **`accessibleName` reads `store.rootIds` for a root node's index**, so two roots with the same kind and no title get "zone 1" / "zone 2" — correct, but it means a name can change when a sibling is added. Acceptable for a fallback; a consumer wanting stability sets `meta.title`.

**Type consistency check.** `GeometrySource.rectOf`, `NavIntent`, `NavDirection`, `FocusAdapter.present`/`announce`, `navigableLeaves(store, geometry)`, `resolveNavigation({store, from, intent, geometry, strategies})`, `chooseSuccessor(store, departing)`, `accessibleName(store, id)`, `nullFocusAdapter`, `FocusProvider`, `GeometryProvider`, `useGeometrySource`, `useGeometryRegistry`, `useFocusBinding` — each is defined once and referenced under the same name throughout.

**One unverified assumption, flagged for the implementer:** Task 6 Step 5 checks that `nodeToLayoutItem` is exported under that exact name before relying on it. Do not skip that step.
