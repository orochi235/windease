# Root Container Origins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a root `<Container>` a real position in the geometry registry so sibling roots stop overlapping at `(0, 0)` and directional keyboard navigation works across top-level zones.

**Architecture:** A `<Container>` whose store node has no `membership` measures its own element into document coordinates (`getBoundingClientRect()` + `window.scrollX/Y`), holds the result in React state, publishes it to the geometry registry under its own node id, and composes its children against it. Non-root containers are untouched — they keep reading their entry, which their parent writes. Spec: `docs/superpowers/specs/2026-08-22-root-origin-geometry-design.md`.

**Tech Stack:** TypeScript, React 18, Vitest + @testing-library/react (jsdom), Playwright (drives Ladle), Biome.

---

## Background the engineer needs

**The geometry registry** (`src/react/focus/useGeometrySource.ts`) is a plain `Map<string, Rect>` plus a change signal, provided by `<GeometryProvider>`. `<Container>` writes one entry per placed child in an effect; `resolveNavigation` reads it to decide where an arrow key goes. It is not React state — writes are followed by `registry.commit()`, which notifies subscribers.

**Why roots break.** `StoreContainer` reads its *own* rect out of that map (`src/react/Container.tsx:208`) and adds it as an origin to every child placement (`:213-222`). Only a parent `<Container>` ever writes that entry, so a root's is missing and `?? 0` puts its children at the page origin. Two roots therefore occupy the same coordinates.

**Node vocabulary.** `node.membership` is the "do I have a parent?" capability — `undefined` means the node is a root. See `docs/concepts.md`. A store node is fetched in React with `useNode(id)`.

**Repo conventions that apply here:**
- Every feature ships with an operable Ladle story in the same change; the Playwright suite drives Ladle.
- Trace with `trace(category, msg)` from `@windease/core`, never `console.log`. The category here is `zone`.
- Comments are 1–2 lines and only for something a reader cannot get from the code.
- Every user-visible change gets a `CHANGELOG.md` entry under `## Unreleased`.

**Commands:**
- One unit test file: `npx vitest run src/react/Container.root-origin.test.tsx`
- All unit tests: `npm test`
- Lint + types: `npm run lint && npm run typecheck`
- One e2e file, one engine: `npx playwright test e2e/parallel-zones.spec.ts --project=chromium`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/react/Container.tsx` (modify) | Detect roothood, measure the root's own rect, publish it, compose children against it. All production code for this change lives here. |
| `src/react/Container.root-origin.test.tsx` (create) | jsdom coverage: a root publishes its own rect; two sibling roots do not overlap; a non-root does not measure. |
| `src/focus/resolve.cross-root.test.ts` (create) | Headless coverage: directional navigation picks the correct target across two roots, given a hand-built `GeometrySource`. No DOM. |
| `src/react/stories/ParallelZonesDnd.stories.tsx` (modify) | Add `GeometryProvider` + `FocusProvider` so the sibling-roots fixture is keyboard-operable. |
| `src/react/stories/parallel-zones-dnd.css` (modify) | Focus-ring styling for the caret pane. |
| `e2e/parallel-zones.spec.ts` (create) | Browser coverage: ArrowRight crosses roots; Shift+ArrowRight reparents across roots. |
| `CHANGELOG.md`, `TODO.md` (modify) | Record the change and correct the stale claim about the Playground. |

---

### Task 1: A root publishes its own rect

**Files:**
- Modify: `src/react/Container.tsx:206-229`
- Test: `src/react/Container.root-origin.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/react/Container.root-origin.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, createNode, Store, stripStrategy } from '../index.js';
import { Container } from './Container.js';
import { GeometryProvider, useGeometrySource } from './focus/useGeometrySource.js';
import type { GeometrySource } from '../index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

/** jsdom reports every element at the page origin, so each root's box is
 *  stubbed by the `data-node-container` id its own div carries. */
function stubRects(boxes: Record<string, { x: number; y: number; w: number; h: number }>) {
  const spy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const id = this.getAttribute('data-node-container') ?? '';
      const b = boxes[id] ?? { x: 0, y: 0, w: 0, h: 0 };
      return {
        x: b.x,
        y: b.y,
        left: b.x,
        top: b.y,
        right: b.x + b.w,
        bottom: b.y + b.h,
        width: b.w,
        height: b.h,
        toJSON: () => ({}),
      } as DOMRect;
    });
  return spy;
}

function makeStore(rootIds: string[]): Store {
  const s = new Store();
  for (const rid of rootIds) {
    const zone = asNodeId(rid);
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'y', fill: true } },
        id: zone,
      }),
    );
    s.showNode(zone);
    for (const suffix of ['a', 'b']) {
      const nid = asNodeId(`${rid}-${suffix}`);
      s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: zone }));
      s.showNode(nid);
    }
  }
  return s;
}

function Probe({ onSource }: { onSource: (g: GeometrySource) => void }) {
  onSource(useGeometrySource());
  return null;
}

function mount(rootIds: string[]): GeometrySource {
  const store = makeStore(rootIds);
  let geometry: GeometrySource | null = null;
  render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          {rootIds.map((rid) => (
            <Container
              key={rid}
              parentId={asNodeId(rid)}
              chrome={{}}
              viewport={{ w: 100, h: 200 }}
            />
          ))}
          <Probe
            onSource={(g) => {
              geometry = g;
            }}
          />
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>,
  );
  if (!geometry) throw new Error('Probe never rendered');
  return geometry as GeometrySource;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('root container origins', () => {
  it('publishes the root own rect in document coordinates', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    window.scrollTo(0, 0);
    const geometry = mount(['left']);
    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 40, y: 10, w: 100, h: 200 });
  });

  it('composes a root children against that origin', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const geometry = mount(['left']);
    const a = geometry.rectOf(asNodeId('left-a'));
    if (!a) throw new Error('child should be placed');
    expect(a.x).toBeGreaterThanOrEqual(40);
    expect(a.y).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/react/Container.root-origin.test.tsx`

Expected: FAIL. The first test reports `rectOf('left')` as `null` (nothing writes a root's entry); the second reports `a.x` as `0`.

- [ ] **Step 3: Implement the measurement**

In `src/react/Container.tsx`, add `useState` to the React import if it is not already there (it is, at `:9`). Inside `StoreContainer`, replace the block at `:206-229`:

```tsx
  const geometryRegistry = useGeometryRegistry();
  const selfRect = geometryRegistry?.rects.get(String(parentId));
  useEffect(() => {
    if (!geometryRegistry) return;
```

with:

```tsx
  const geometryRegistry = useGeometryRegistry();
  const selfRect = geometryRegistry?.rects.get(String(parentId));
  // A root has no parent to place it, so it answers for its own position.
  // Document coordinates, so a page scroll cannot pull two roots apart.
  const isRoot = parent !== undefined && parent.membership === undefined;
  const [rootOrigin, setRootOrigin] = useState<{ x: number; y: number } | null>(null);

  const measureRoot = useCallback(() => {
    if (!isRoot || !geometryRegistry) return;
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    const r = el.getBoundingClientRect();
    const next = {
      x: r.x + window.scrollX,
      y: r.y + window.scrollY,
      w: r.width,
      h: r.height,
    };
    const key = String(parentId);
    const prev = geometryRegistry.rects.get(key);
    if (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) {
      return;
    }
    geometryRegistry.rects.set(key, next);
    geometryRegistry.commit();
    trace('zone', `root origin: ${key} at ${next.x},${next.y}`);
    setRootOrigin({ x: next.x, y: next.y });
  }, [isRoot, geometryRegistry, parentId]);

  // Every commit, matching the flow path below: a class toggle can move a root
  // without resizing it, and no observer reports that.
  useEffect(() => {
    measureRoot();
  });

  useEffect(() => {
    if (!isRoot || !geometryRegistry) return;
    const key = String(parentId);
    return () => {
      geometryRegistry.rects.delete(key);
      geometryRegistry.commit();
    };
  }, [isRoot, geometryRegistry, parentId]);

  const origin = isRoot ? rootOrigin : selfRect;
  useEffect(() => {
    if (!geometryRegistry) return;
```

Then in the body of that same composition effect, change the two origin lines from `selfRect` to `origin`:

```tsx
    const originX = (origin?.x ?? 0) - layout.scroll.x;
    const originY = (origin?.y ?? 0) - layout.scroll.y;
```

and change its dependency array from `selfRect?.x, selfRect?.y` to `origin?.x, origin?.y`:

```tsx
  }, [geometryRegistry, layout.placements, layout.scroll, origin?.x, origin?.y]);
```

Add `trace` to the import from `'../index.js'` at `:17`, so it reads:

```tsx
import { accessibleName, type ChildOrderCommit, type NodeId, trace } from '../index.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/react/Container.root-origin.test.tsx`

Expected: PASS, 2 tests.

- [ ] **Step 5: Run the full unit suite for regressions**

Run: `npm test`

Expected: PASS. Registry rects are now document coordinates rather than root-relative ones; in jsdom every unstubbed element measures at `(0, 0)`, so existing assertions are unaffected. If a test does fail here, read it before changing it — a real regression is more likely than a stale assertion.

- [ ] **Step 6: Commit**

```bash
git add src/react/Container.tsx src/react/Container.root-origin.test.tsx
git commit -m "let a root container report its own origin"
```

---

### Task 2: Two sibling roots stop overlapping

**Files:**
- Test: `src/react/Container.root-origin.test.tsx` (modify — append to the existing `describe`)

This is the behavior the whole change exists for, and it is worth its own test rather than being implied by Task 1.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('root container origins', ...)` block in `src/react/Container.root-origin.test.tsx`:

```tsx
  it('keeps two sibling roots in disjoint coordinate ranges', () => {
    stubRects({
      left: { x: 0, y: 0, w: 100, h: 200 },
      right: { x: 300, y: 0, w: 100, h: 200 },
    });
    const geometry = mount(['left', 'right']);
    const leftA = geometry.rectOf(asNodeId('left-a'));
    const rightA = geometry.rectOf(asNodeId('right-a'));
    if (!leftA || !rightA) throw new Error('both children should be placed');
    expect(rightA.x).toBeGreaterThanOrEqual(leftA.x + leftA.w);
  });

  it('does not measure a non-root container', () => {
    stubRects({ left: { x: 40, y: 10, w: 100, h: 200 } });
    const store = makeStore(['left']);
    const nested = asNodeId('nested');
    store.registerNode(
      createNode({
        kind: 'zone',
        id: nested,
        parentId: asNodeId('left'),
        container: { strategyId: 'strip', config: { axis: 'y', fill: true } },
      }),
    );
    store.showNode(nested);
    let geometry: GeometrySource | null = null;
    render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <GeometryProvider>
            <Container parentId={nested} chrome={{}} viewport={{ w: 50, h: 50 }} />
            <Probe
              onSource={(g) => {
                geometry = g;
              }}
            />
          </GeometryProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    if (!geometry) throw new Error('Probe never rendered');
    // Nobody rendered its parent, so nothing places it — and it must not
    // decide it is a root and measure itself.
    expect((geometry as GeometrySource).rectOf(nested)).toBeNull();
  });
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/react/Container.root-origin.test.tsx`

Expected: PASS, 4 tests. Both new tests should pass against Task 1's implementation. If `keeps two sibling roots in disjoint coordinate ranges` fails, the origin is not reaching the composition effect; if `does not measure a non-root container` fails, the roothood test is checking the registry instead of `membership`.

- [ ] **Step 3: Commit**

```bash
git add src/react/Container.root-origin.test.tsx
git commit -m "pin sibling-root separation and the non-root case"
```

---

### Task 3: Re-measure on window resize and scroll

**Files:**
- Modify: `src/react/Container.tsx` (the block added in Task 1)
- Test: `src/react/Container.root-origin.test.tsx` (modify)

- [ ] **Step 1: Write the failing test**

Append inside the same `describe` block:

```tsx
  it('re-measures on a scroll anywhere in the page', () => {
    const boxes = { left: { x: 0, y: 100, w: 100, h: 200 } };
    stubRects(boxes);
    const geometry = mount(['left']);
    expect(geometry.rectOf(asNodeId('left'))?.y).toBe(100);
    // The page scrolls down 50px: the element's viewport-relative top falls by
    // 50 while its document position is unchanged. The height changes too, so
    // that only an actual re-measure can produce the expected rect — a stale
    // entry happens to carry the right `y`.
    boxes.left = { x: 0, y: 50, w: 100, h: 999 };
    Object.defineProperty(window, 'scrollY', { value: 50, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(geometry.rectOf(asNodeId('left'))).toEqual({ x: 0, y: 100, w: 100, h: 999 });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/react/Container.root-origin.test.tsx -t "re-measures on a scroll"`

Expected: FAIL — the published rect still has `h: 200`, because nothing re-measured.

- [ ] **Step 3: Add the listeners**

In `src/react/Container.tsx`, directly after the per-commit `useEffect` added in Task 1:

```tsx
  // Capture phase so a scroll in any ancestor scroller re-measures, not just
  // the page.
  useEffect(() => {
    if (!isRoot || typeof window === 'undefined') return;
    const onViewportChange = () => measureRoot();
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, { capture: true });
    };
  }, [isRoot, measureRoot]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/react/Container.root-origin.test.tsx`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/react/Container.tsx src/react/Container.root-origin.test.tsx
git commit -m "re-measure a root origin on scroll and resize"
```

---

### Task 4: Cross-root directional navigation, headless

**Files:**
- Test: `src/focus/resolve.cross-root.test.ts` (create)

The resolver already scores every navigable leaf in the store (`src/focus/resolve.ts:31`), so this test should pass with no production change. It exists to pin that the resolver is not root-scoped — which is what makes Task 1 sufficient — and it runs with no DOM.

- [ ] **Step 1: Write the test**

Create `src/focus/resolve.cross-root.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store } from '../index.js';
import type { GeometrySource, NodeId, Rect } from '../index.js';
import { resolveNavigation } from './resolve.js';

function makeStore(): Store {
  const s = new Store();
  for (const rid of ['left', 'right']) {
    const zone = asNodeId(rid);
    s.registerNode(
      createNode({
        kind: 'zone',
        id: zone,
        container: { strategyId: 'strip', config: { axis: 'y' } },
      }),
    );
    s.showNode(zone);
    for (const suffix of ['a', 'b']) {
      const nid = asNodeId(`${rid}-${suffix}`);
      s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: zone }));
      s.showNode(nid);
    }
  }
  return s;
}

/** Two roots side by side, 200px apart, each stacking two panes vertically. */
function geometry(): GeometrySource {
  const rects: Record<string, Rect> = {
    'left-a': { x: 0, y: 0, w: 100, h: 50 },
    'left-b': { x: 0, y: 50, w: 100, h: 50 },
    'right-a': { x: 200, y: 0, w: 100, h: 50 },
    'right-b': { x: 200, y: 50, w: 100, h: 50 },
  };
  return { rectOf: (id: NodeId) => rects[String(id)] ?? null };
}

describe('directional navigation across roots', () => {
  it('crosses from one root to the other', () => {
    const to = resolveNavigation({
      store: makeStore(),
      from: asNodeId('left-a'),
      intent: 'right',
      geometry: geometry(),
    });
    expect(to).toBe('right-a');
  });

  it('prefers the pane straight ahead over one diagonally nearer', () => {
    const to = resolveNavigation({
      store: makeStore(),
      from: asNodeId('left-b'),
      intent: 'right',
      geometry: geometry(),
    });
    expect(to).toBe('right-b');
  });

  it('has nowhere to go past the last root', () => {
    const to = resolveNavigation({
      store: makeStore(),
      from: asNodeId('right-a'),
      intent: 'right',
      geometry: geometry(),
    });
    expect(to).toBeNull();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/focus/resolve.cross-root.test.ts`

Expected: PASS, 3 tests. If `crosses from one root to the other` fails, the resolver *is* root-scoped somewhere and this change needs more than origins — stop and re-read `navigableLeaves`.

- [ ] **Step 3: Commit**

```bash
git add src/focus/resolve.cross-root.test.ts
git commit -m "pin that directional navigation is not root-scoped"
```

---

### Task 5: Make the sibling-roots story keyboard-operable

**Files:**
- Modify: `src/react/stories/ParallelZonesDnd.stories.tsx`
- Modify: `src/react/stories/parallel-zones-dnd.css`

- [ ] **Step 1: Add the providers**

In `src/react/stories/ParallelZonesDnd.stories.tsx`, extend the import from `'../index.js'` (currently at `:5-14`) with `FocusProvider` and `GeometryProvider`, keeping the list alphabetical:

```tsx
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
  useDragState,
} from '../index.js';
```

Then wrap the existing tree in the returned JSX of `DragBetween`, inside `<DragProvider>`:

```tsx
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <GeometryProvider>
            <FocusProvider>
              <div className="pz-row">
                <ZoneShell zoneId={LEFT} label="Left zone" chrome={chrome} />
                <ZoneShell zoneId={RIGHT} label="Right zone" chrome={chrome} />
              </div>
              <p className="pz-hint">
                Drag any panel by its grip into the other zone — Escape cancels. Or click a panel
                and use <kbd>←</kbd> <kbd>→</kbd> to move the caret between the two zones, and{' '}
                <kbd>Shift</kbd> plus an arrow to send the panel across.
              </p>
            </FocusProvider>
          </GeometryProvider>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
```

- [ ] **Step 2: Style the focus ring**

Append to `src/react/stories/parallel-zones-dnd.css`:

```css
.pz-panel:focus-visible,
[data-node]:focus-visible .pz-panel {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
```

- [ ] **Step 3: Check it renders and is operable**

Run: `npm run ladle` (or `npx ladle serve`), open `http://localhost:61000/?story=parallel-zones--drag-between`.

Expected: two zones side by side. Clicking a panel gives it a focus ring; `ArrowRight` from a left-zone panel moves the ring into the right zone; `Shift`+`ArrowRight` moves the panel itself across. Stop the server when done.

- [ ] **Step 4: Run the story smoke tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/react/stories/ParallelZonesDnd.stories.tsx src/react/stories/parallel-zones-dnd.css
git commit -m "make the parallel-zones story keyboard-operable"
```

---

### Task 6: Browser coverage for cross-root gestures

**Files:**
- Create: `e2e/parallel-zones.spec.ts`

`e2e/drag.spec.ts` already drives this story for drag; this file covers the keyboard gestures the origin fix unlocks. Do not add them to `drag.spec.ts` — the files are named by the gesture under test.

- [ ] **Step 1: Write the spec**

Create `e2e/parallel-zones.spec.ts`:

```ts
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { openStory } from './fixtures.js';

const STORY = 'parallel-zones--drag-between';

function focusedNode(page: Page) {
  return page.evaluate(
    () => document.activeElement?.closest('[data-node]')?.getAttribute('data-node') ?? null,
  );
}

/** Which zone a panel is rendered under, read from the DOM rather than the
 *  store: the reparent has to survive all the way to the render. */
function zoneOf(page: Page, nodeId: string) {
  return page.evaluate(
    (id) =>
      document
        .querySelector(`[data-node="${id}"]`)
        ?.closest('[data-node-container]')
        ?.getAttribute('data-node-container') ?? null,
    nodeId,
  );
}

test.describe('sibling root zones', () => {
  test('an arrow key crosses from one root zone to the other', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node="left-a"]').click();
    await expect.poll(() => focusedNode(page)).toBe('left-a');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focusedNode(page)).toBe('right-a');
  });

  test('shift+arrow reparents a panel into the other root zone', async ({ page }) => {
    await openStory(page, STORY);
    await page.locator('[data-node="left-a"]').click();
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => zoneOf(page, 'left-a')).toBe('right-zone');
  });

  test('an arrow key at the outer edge is inert', async ({ page }) => {
    await openStory(page, STORY);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('[data-node="right-a"]').click();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    expect(await focusedNode(page)).toBe('right-a');
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it on one engine**

Run: `npx playwright test e2e/parallel-zones.spec.ts --project=chromium`

Expected: PASS, 3 tests. If `an arrow key crosses` fails with focus staying on `left-a`, the roots are still overlapping — check that the story has `GeometryProvider` above both `<Container>`s (a registry-less container skips the whole path).

- [ ] **Step 3: Run it on all three engines**

Run: `npx playwright test e2e/parallel-zones.spec.ts`

Expected: PASS, 9 tests.

- [ ] **Step 4: Commit**

```bash
git add e2e/parallel-zones.spec.ts
git commit -m "cover cross-root navigation and reparenting in the browser"
```

---

### Task 7: Documentation and the stale TODO claim

**Files:**
- Modify: `CHANGELOG.md` (the `## Unreleased` section)
- Modify: `TODO.md` ("Strategy for partitioning workspace")

- [ ] **Step 1: Add the changelog entry**

Under `## Unreleased` → `### Added` in `CHANGELOG.md`, matching the surrounding entries' voice (what it does and why, not how it was built):

```markdown
- **A root `<Container>` reports its own position.** Sibling roots used to share
  origin `(0, 0)` — only a parent container ever wrote a geometry entry — so
  directional keyboard navigation between two top-level zones picked an
  arbitrary target. A root now measures its own element into document
  coordinates, which makes arrow navigation and `Shift`-arrow moves work across
  zones a consumer laid out in its own CSS. Geometry rects are consequently
  document coordinates rather than root-relative ones; nothing in the library
  reads an absolute value, but a consumer reading
  `useGeometrySource().rectOf(id)` directly will see different numbers.
```

- [ ] **Step 2: Correct the TODO section**

In `TODO.md`, the "Strategy for partitioning workspace" section opens with a claim that is no longer true — the Playground builds one root `strip` container and derives its zones through `store.split` (`src/react/stories/Playground.stories.tsx:33-60`). Replace the opening paragraph:

```markdown
Right now consumers compose zones by laying them out in plain CSS (see the
Ladle Playground: a CSS grid with `main`, `sidebar`, `dock` slots). The
library has no opinion about how zones relate to each other in the visible
workspace.
```

with:

```markdown
Zones nested under one root container already tile, with draggable gutters
between them — the Ladle Playground builds `main` / `sidebar` / `dock` that way,
through `store.split` on a root `strip`. What the library has no opinion about
is zones the consumer composes as *separate roots* in its own CSS, which is the
case a `<Workspace>` would own.
```

Then replace the bolded paragraph that begins "**One thing a `<Workspace>` has to solve, found building the keyboard-move story.**" and runs to the end of that section — the sibling-root origin problem it describes is fixed — with:

```markdown
Sibling roots now share one coordinate space: a root `<Container>` measures its
own element into document coordinates and publishes it, so directional
navigation and `Shift`-arrow moves cross a top-level zone boundary. See
`docs/superpowers/specs/2026-08-22-root-origin-geometry-design.md`. What is left
for a `<Workspace>` is owning the arrangement itself — collapsible sidebars,
gutters *between* roots, full-screen takeover — not the geometry.
```

Finally, under "## Drag and drop" → "Still open", the "**Inter-zone resize**" bullet says it is blocked behind workspace partitioning. Leave it: it is still true for zones composed as separate roots.

- [ ] **Step 3: Verify the changelog guard still passes**

Run: `bash scripts/check-changelog.sh || true`

Expected: it fails only on the `Unreleased` heading, which is expected on `main` until a release retitles it. Any *other* complaint is a real problem.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md TODO.md
git commit -m "record root origins and correct the stale workspace premise"
```

---

### Task 8: Full verification

**Files:** none — this task runs the suite and fixes what it finds.

- [ ] **Step 1: Lint and typecheck**

Run: `npm run lint && npm run typecheck`

Expected: clean. The `useEffect` with no dependency array added in Task 1 needs no suppression — the flow path at `src/react/Container.tsx:284-286` is the same shape and carries none.

- [ ] **Step 2: Full unit suite**

Run: `npm test`

Expected: PASS. The baseline before this branch was 1120; each task states what it adds. Do not treat a specific total as the check — treat "no failures, and the count went up by what this branch added" as the check.

- [ ] **Step 3: Full e2e suite on three engines**

Run: `npm run test:e2e`

Expected: PASS. The suite was 48 specs across eleven files; this adds a twelfth file with 3. Note the known ~1% flake under parallel load recorded in `TODO.md` — a single unrelated failure that passes in isolation is that, not a regression from this change. Re-run the failing file alone before concluding anything.

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: clean.

- [ ] **Step 5: Commit anything the verification changed**

```bash
git add -A
git commit -m "fix lint and test fallout from root origins"
```

Skip this step if nothing changed.
