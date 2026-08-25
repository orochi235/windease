# Preset Drop Hit-Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a drop on `<Zone>` / `<Panel container={…}>` resolve where the cursor is — an insertion index, a stack, or a split — instead of always appending.

**Architecture:** Extract `<Container>`'s drop-target effect into a shared hook, `useDropIntentTarget`, and call it from both `<Container>` and `PresetShell`. The presets additionally publish the `data-node-container` attribute that `childRectsForContainer` uses to tell a container's own chrome children from its grandchildren. Nothing about what a drop *commits* changes: `DragEngine.drop()` already reads `hover.intent` and calls `store.stackNodes` / `store.split`.

**Tech Stack:** TypeScript, React 19, vitest + @testing-library/react (jsdom), Playwright over Ladle stories, biome.

**Design:** [`docs/superpowers/specs/2026-08-24-preset-drop-intent-design.md`](../specs/2026-08-24-preset-drop-intent-design.md)

**Deviation from the spec, decided while planning:** the spec says `PresetShell` publishes `data-node-container` "on the path that hosts a layout." Publish it unconditionally instead. A flow-mode preset container holds its children as direct DOM children, so the attribute is what excludes *its* children from its parent's harvest — conditioning it on a strategy being in scope would leave exactly the grandchild bug the attribute exists to fix. On a childless `<Panel>` it is inert.

---

### Task 1: Extract the shared hook

Pure refactor. `<Container>`'s behavior must not change; its existing drop specs are the net.

**Files:**
- Create: `src/react/dnd/useDropIntentTarget.ts`
- Modify: `src/react/Container.tsx` (the effect at lines 337-380, and its imports)

- [ ] **Step 1: Write the hook**

Create `src/react/dnd/useDropIntentTarget.ts`:

```ts
import { type RefObject, useContext, useEffect } from 'react';
import type { Point } from '../../dnd/DragEngine.js';
import { type DropIntent, resolveDropIntent } from '../../dnd/dropIntent.js';
import { axisFromRects, childRectsForContainer } from '../../dnd/insertionIndex.js';
import type { NodeId, Rect } from '../../index.js';
import { DragContext } from './DragProvider.js';

/** What a `dropIntent` callback is handed. The container has already measured
 *  and inferred the axis; the callback only decides what the drop means. */
export interface DropIntentContext {
  /** Direct children in DOM order, with the dragged node removed. */
  rects: readonly { id: string; rect: Rect }[];
  /** Cursor, in the space the host samples in. */
  point: Point;
  /** This container's own main axis — a split runs across it. */
  axis: 'x' | 'y';
  /** The node being dragged. */
  sourceId: NodeId;
}

export interface DropIntentTargetOptions {
  /** Skip registration. For a caller that must invoke the hook
   *  unconditionally to hold hook order stable. Defaults to true. */
  enabled?: boolean | undefined;
  /** The container's declared main axis, from `container.config.axis`. */
  axis?: 'x' | 'y' | undefined;
  /** Which strategy places the children, for inferring an axis when the
   *  container declared none. */
  strategyId?: string | undefined;
  /** No strategy places these children — CSS does — so the axis is read off
   *  the arrangement produced. */
  isFlow?: boolean | undefined;
  stackOnDrop?: boolean | undefined;
  splitOnDrop?: boolean | undefined;
  dropIntent?: ((ctx: DropIntentContext) => DropIntent | undefined) | undefined;
  scrollEl?: Element | null | undefined;
  canAccept?: ((sourceId: NodeId) => boolean) | undefined;
}

/** `childRectsForContainer` reports DOMRects; the resolver takes plain bounds. */
function domRectToRect(r: DOMRect): Rect {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/**
 * Register `parentId`'s element as a drop target that resolves a cursor into
 * a `DropIntent`, rather than one that always appends.
 *
 * The hit-test both `<Container>` and the declarative presets run: harvest the
 * direct chrome children, drop the dragged node from the list, infer the axis,
 * and resolve. A host element that publishes no `data-node-container` harvests
 * its grandchildren too — see `childRectsForContainer`.
 */
export function useDropIntentTarget(
  parentId: NodeId,
  ref: RefObject<Element | null>,
  opts: DropIntentTargetOptions = {},
): void {
  const {
    enabled,
    axis: declaredAxis,
    strategyId,
    isFlow,
    stackOnDrop,
    splitOnDrop,
    dropIntent,
    scrollEl,
    canAccept,
  } = opts;
  const controller = useContext(DragContext);
  useEffect(() => {
    if (enabled === false) return;
    if (!controller) return;
    const el = ref.current;
    if (!el) return;
    return controller.registerDropTarget(parentId, el, canAccept, {
      scrollEl: scrollEl ?? null,
      getDropIntent: (point) => {
        const rects = childRectsForContainer(el);
        if (rects.length === 0) return { kind: 'insert', index: 0 };
        // Skip the source itself for same-parent previews.
        const sourceId = controller.state()?.draggingId;
        const filtered = sourceId ? rects.filter((r) => r.id !== sourceId) : rects;
        const axis: 'x' | 'y' =
          declaredAxis ?? (isFlow ? axisFromRects(filtered) : strategyId === 'strip' ? 'x' : 'y');
        const mapped = filtered.map((r) => ({ id: r.id, rect: domRectToRect(r.rect) }));
        if (dropIntent && sourceId) {
          return dropIntent({ rects: mapped, point, axis, sourceId });
        }
        return resolveDropIntent(mapped, point, axis, {
          ...(stackOnDrop ? { stack: true } : {}),
          ...(splitOnDrop ? { split: true } : {}),
        });
      },
    });
  }, [
    controller,
    parentId,
    ref,
    enabled,
    canAccept,
    declaredAxis,
    strategyId,
    isFlow,
    stackOnDrop,
    splitOnDrop,
    dropIntent,
    scrollEl,
  ]);
}
```

- [ ] **Step 2: Point `<Container>` at it**

In `src/react/Container.tsx`, delete the `useEffect` that begins with the comment `// Register a default getInsertionIndex on the container element` (lines 337-380) and the now-unused `domRectToRect` helper, and replace the effect with:

```tsx
  const containerCfg = (parent?.container?.config ?? {}) as { axis?: 'x' | 'y' };
  useDropIntentTarget(parentId, ref, {
    ...(containerCfg.axis ? { axis: containerCfg.axis } : {}),
    ...(parent?.container?.strategyId ? { strategyId: parent.container.strategyId } : {}),
    isFlow,
    stackOnDrop,
    splitOnDrop,
    ...(dropIntent ? { dropIntent } : {}),
    scrollEl: scrollRef?.current ?? null,
  });
```

Re-export the type so the public name does not move — `DropIntentContext` is exported from `Container.tsx` today and consumers import it from there. In `Container.tsx` replace the local `interface DropIntentContext {…}` declaration with:

```ts
export type { DropIntentContext } from './dnd/useDropIntentTarget.js';
```

and add `import { useDropIntentTarget } from './dnd/useDropIntentTarget.js';` to the import block. Drop the now-unused `resolveDropIntent`, `axisFromRects`, `childRectsForContainer` and `Point` imports if nothing else in the file uses them (check with `grep -n` before deleting each).

- [ ] **Step 3: Verify the refactor changed nothing**

Run: `npx vitest run src/react && npx tsc -p tsconfig.json --noEmit && npx biome check src`
Expected: all pass. `container.dropIntent.test.tsx` is the specific proof.

Run: `npx playwright test e2e/drop-on-edge.spec.ts e2e/tab-stack.spec.ts e2e/insertion.spec.ts --project=chromium`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/react/dnd/useDropIntentTarget.ts src/react/Container.tsx
git commit -m "extract the drop hit-test Container runs into a hook"
```

---

### Task 2: Publish `data-node-container` from the presets

**Files:**
- Modify: `src/react/presets.tsx` (`PresetShell`'s wrapper div, `AbsoluteWrapper`)
- Test: `src/react/presets.dropIntent.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/react/presets.dropIntent.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, Store, stripStrategy } from '../index.js';
import { childRectsForContainer } from '../dnd/insertionIndex.js';
import { Panel, Provider, StrategyRegistryProvider, Zone } from './index.js';

const STRATEGIES = { strip: stripStrategy as never };

describe('preset DOM contract', () => {
  it('harvests a zone’s own panes, not its grandchildren', () => {
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('outer')}
            container={{ strategyId: 'strip', config: { axis: 'x', fill: true } }}
            viewport={{ w: 200, h: 100 }}
          >
            <Panel id={asNodeId('a')} />
            <Zone
              id={asNodeId('inner')}
              container={{ strategyId: 'strip', config: { axis: 'y', fill: true } }}
            >
              <Panel id={asNodeId('deep')} />
            </Zone>
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const outer = container.querySelector('[data-node="outer"]') as HTMLElement;
    const ids = childRectsForContainer(outer).map((r) => r.id);
    expect(ids).toEqual(['a', 'inner']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/react/presets.dropIntent.test.tsx`
Expected: FAIL — the harvest returns `['a', 'inner', 'deep']`, because with no `data-node-container` anywhere the parent-match test compares `null` to `null` and accepts every depth.

- [ ] **Step 3: Publish the attribute**

In `src/react/presets.tsx`, `PresetShell`'s wrapper div gains one attribute:

```tsx
        <div
          ref={wrapperRef}
          className={compose(wrapperClass, className)}
          style={style}
          data-testid={testId}
          data-node={id}
          data-node-container={id}
          data-join-armed={armedByParent === id ? 'true' : undefined}
          tabIndex={focusable ? (rovingId === id ? 0 : -1) : undefined}
        >
```

`AbsoluteWrapper` gains a `parentId` prop and publishes it, so a placed child's box names the container that placed it:

```tsx
function AbsoluteWrapper({
  rect,
  parentId,
  children,
}: {
  rect: Rect;
  parentId?: NodeId | undefined;
  children: ReactNode;
}) {
  const { settleMs } = useLayoutContext();
  const style: CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
  };
  if (settleMs > 0) {
    style.transition = `left ${settleMs}ms ease, top ${settleMs}ms ease, width ${settleMs}ms ease, height ${settleMs}ms ease`;
  }
  return (
    <div style={style} data-node-container={parentId}>
      {children}
    </div>
  );
}
```

Both call sites pass it. At the end of `PresetShell`:

```tsx
  if (withheld) return null;
  if (!selfRect) return shell;

  const ownParentId = store.getNode(id)?.membership?.parentId;
  return (
    <AbsoluteWrapper rect={selfRect} parentId={ownParentId}>
      {shell}
    </AbsoluteWrapper>
  );
```

And in `ZoneWithLayout`'s imperative-child loop (the `imperativeRenders` memo), pass the zone's own id, since those boxes are its children:

```tsx
        <AbsoluteWrapper key={`imp-${node.id}`} rect={rect} parentId={props.id}>
          {renderImperative(node)}
        </AbsoluteWrapper>,
```

- [ ] **Step 4: Run the test and the suite**

Run: `npx vitest run src/react/presets.dropIntent.test.tsx`
Expected: PASS.

Run: `npx vitest run src/react`
Expected: all pass. If a test queried `[data-node-container]` expecting only `<Container>` to publish it, that test now has more matches — fix the query to name the id it means (`[data-node-container="z"]`), not the attribute alone.

- [ ] **Step 5: Commit**

```bash
git add src/react/presets.tsx src/react/presets.dropIntent.test.tsx
git commit -m "name the container each preset box belongs to"
```

---

### Task 3: Give `PresetShell` the hit-test

**Files:**
- Modify: `src/react/presets.tsx` (`PresetShell`)
- Test: `src/react/presets.dropIntent.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/react/presets.dropIntent.test.tsx` — this mirrors `container.dropIntent.test.tsx`, whose helpers (`stubRects`, `hover`) show the pattern; jsdom lays nothing out, so the rects are stubbed.

```tsx
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import {
  createNode,
  type DragController,
  type Rect,
} from '../index.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';

afterEach(cleanup);

function CaptureController({ into }: { into: (c: DragController) => void }) {
  into(useDragController());
  return null;
}

/** Horizontal strip `z` › panels `a`, `b`, each the 100×100 half the strip
 *  would have produced had jsdom laid anything out. */
function stubRects(container: HTMLElement): void {
  const rects: Record<string, Rect> = {
    a: { x: 0, y: 0, w: 100, h: 100 },
    b: { x: 100, y: 0, w: 100, h: 100 },
  };
  for (const el of Array.from(container.querySelectorAll('[data-node]'))) {
    const id = el.getAttribute('data-node');
    const r = id ? rects[id] : undefined;
    if (!r) continue;
    el.getBoundingClientRect = () =>
      ({
        left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h,
        width: r.w, height: r.h, x: r.x, y: r.y, toJSON: () => ({}),
      }) as DOMRect;
  }
}

function presetTree(store: Store, capture: (c: DragController) => void, extra: {
  stackOnDrop?: boolean;
  splitOnDrop?: boolean;
}) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <CaptureController into={capture} />
          <Zone
            id={asNodeId('z')}
            container={{ strategyId: 'strip', config: { axis: 'x', fill: true } }}
            viewport={{ w: 200, h: 100 }}
            acceptsDrops
            {...extra}
          >
            <Panel id={asNodeId('a')} />
            <Panel id={asNodeId('b')} />
          </Zone>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

async function hoverAt(
  c: DragController,
  container: HTMLElement,
  point: { x: number; y: number },
): Promise<void> {
  stubRects(container);
  c.tryBegin(asNodeId('a'));
  await new Promise((r) => setTimeout(r, 20));
  stubRects(container);
  c.updateHoverByPoint(point.x, point.y);
}

describe('a preset resolves a drop intent', () => {
  it('reports the insertion index the cursor is nearest', async () => {
    const store = new Store();
    let c!: DragController;
    const { container } = render(presetTree(store, (ctl) => { c = ctl; }, {}));
    // `a` is being dragged, so `b` is the only rect; a cursor left of b’s
    // midpoint inserts before it.
    await hoverAt(c, container, { x: 120, y: 50 });
    expect(c.state()?.hover?.intent).toEqual({ kind: 'insert', index: 0 });
  });

  it('stacks on a centre drop when stackOnDrop is on', async () => {
    const store = new Store();
    let c!: DragController;
    const { container } = render(
      presetTree(store, (ctl) => { c = ctl; }, { stackOnDrop: true }),
    );
    await hoverAt(c, container, { x: 150, y: 50 });
    expect(c.state()?.hover?.intent?.kind).toBe('stack');
  });

  it('splits on a cross-axis edge drop when splitOnDrop is on', async () => {
    const store = new Store();
    let c!: DragController;
    const { container } = render(
      presetTree(store, (ctl) => { c = ctl; }, { splitOnDrop: true }),
    );
    // Top edge of `b`: the cross axis of a horizontal strip.
    await hoverAt(c, container, { x: 150, y: 4 });
    expect(c.state()?.hover?.intent?.kind).toBe('split');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/react/presets.dropIntent.test.tsx`
Expected: FAIL on all three — `intent` is undefined, because `PresetShell` registers a target with no `getDropIntent`. The two `stackOnDrop` / `splitOnDrop` cases also fail to typecheck until Step 4 adds the props.

- [ ] **Step 3: Swap the hook in**

In `src/react/presets.tsx`, extend `PresetShellProps` with the drop bag and replace the `useDropTarget` call. Delete the `useDropTarget` import if nothing else in the file uses it.

```ts
  /** Drop hit-test inputs, from the preset that owns them. `<Container>` runs
   *  the same hook. */
  drop?:
    | {
        stackOnDrop?: boolean | undefined;
        splitOnDrop?: boolean | undefined;
        dropIntent?: ((ctx: DropIntentContext) => DropIntent | undefined) | undefined;
      }
    | undefined;
```

In the body, replacing `useDropTarget(id, wrapperRef, { enabled: acceptsDrops === true })`:

```tsx
  const store = useStore();
  const ownContainer = store.getNode(id)?.container;
  const ownAxis = (ownContainer?.config as { axis?: 'x' | 'y' } | undefined)?.axis;
  const hostsLayout = useLayoutContext() !== undefined;
  useDropIntentTarget(id, wrapperRef, {
    enabled: acceptsDrops === true,
    ...(ownAxis ? { axis: ownAxis } : {}),
    ...(ownContainer?.strategyId ? { strategyId: ownContainer.strategyId } : {}),
    isFlow: !hostsLayout,
    ...(drop?.stackOnDrop ? { stackOnDrop: drop.stackOnDrop } : {}),
    ...(drop?.splitOnDrop ? { splitOnDrop: drop.splitOnDrop } : {}),
    ...(drop?.dropIntent ? { dropIntent: drop.dropIntent } : {}),
  });
```

`PresetShell` already calls `useStore()` further down; hoist that single call rather than calling it twice. `isFlow` matters only when the container declared no axis — a preset with no strategy in scope arranges its children with CSS, and the axis is read off what that produced.

- [ ] **Step 4: Thread the three props through `<Zone>` and `<Panel>`**

Add to `CommonBindingProps` in `src/react/presets.tsx`, beside `acceptsDrops`:

```ts
  /** Let a drop onto the middle of a child stack the two into one tabbed
   *  container. Off by default, like `<Container stackOnDrop>`: the gesture
   *  restructures the tree. Requires `acceptsDrops`. */
  stackOnDrop?: boolean;
  /** Let a drop in a cross-axis band of a child split that child's slot into a
   *  two-pane strip. Off by default. Requires `acceptsDrops`. */
  splitOnDrop?: boolean;
  /** Replace the built-in drop hit-test — the same callback `<Container
   *  dropIntent>` takes. */
  dropIntent?: (ctx: DropIntentContext) => DropIntent | undefined;
```

Every one of the four `<PresetShell>` call sites (`Panel` ~line 227, `PanelWithLayout` ~278, `Zone` ~394, `ZoneWithLayout` ~482) passes the bag. For the two `*WithLayout` variants the props arrive on their own props object; for `Panel` / `Zone` they arrive on `props` directly. In each:

```tsx
        drop={{
          ...(props.stackOnDrop ? { stackOnDrop: props.stackOnDrop } : {}),
          ...(props.splitOnDrop ? { splitOnDrop: props.splitOnDrop } : {}),
          ...(props.dropIntent ? { dropIntent: props.dropIntent } : {}),
        }}
```

`ZoneWithLayoutProps` / `PanelWithLayoutProps` must carry the three fields for the forward to typecheck; both already mirror their preset's props this way for `acceptsDrops`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/react/presets.dropIntent.test.tsx`
Expected: PASS, all four (the harvest test from Task 2 included).

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit && npx biome check src`
Expected: all pass.

- [ ] **Step 6: Mutation-check the negative half**

Temporarily change `resolveDropIntent`'s call in `useDropIntentTarget` to pass `{}` (no stack, no split) and re-run: the stack and split tests must fail. Restore. This is the repo's standing practice — an assertion that cannot fail is not coverage.

- [ ] **Step 7: Commit**

```bash
git add src/react/presets.tsx src/react/presets.dropIntent.test.tsx
git commit -m "resolve a drop intent on the declarative presets"
```

---

### Task 4: A story that operates the gesture

Per `CLAUDE.md`, a capability with no story has no browser coverage, and the story must be operable rather than a render.

**Files:**
- Create: `src/react/stories/DeclarativeDrop.stories.tsx`, `src/react/stories/declarative-drop.css`

- [ ] **Step 1: Write the story**

`src/react/stories/DeclarativeDrop.stories.tsx` — two side-by-side `<Zone acceptsDrops stackOnDrop splitOnDrop>` built entirely from presets, each holding draggable panels, so a drop can be aimed at a seam, a centre, or an edge. Model it on `DropOnEdge.stories.tsx` (which does this for `<Container>`) and `DeclarativePlayground.stories.tsx` (which shows the preset + `DragProvider` + `FocusProvider` + `GeometryProvider` wiring). Requirements:

- `export default { title: 'Declarative' }` so it joins the existing group; export the story as `DropIntent`, giving the story id `declarative--drop-intent`.
- Each pane renders a `<DragHandle>` and a `data-testid` naming it, so Playwright can grab a specific pane.
- A visible tab strip on any stack that forms — reuse `useStack` as `TabStack.stories.tsx` does — or a drop that stacks produces children the user cannot reach.
- Styling in `declarative-drop.css`; no inline `style` attributes.

- [ ] **Step 2: Check it renders and is operable**

Run: `npm run ladle` and open `http://localhost:61000/?story=declarative--drop-intent`
Expected: two zones, panes draggable by their handles, a drop landing where aimed.

Note: Ladle serves port 61000 per checkout. If a second checkout is serving, you are looking at the wrong tree.

- [ ] **Step 3: Commit**

```bash
git add src/react/stories/DeclarativeDrop.stories.tsx src/react/stories/declarative-drop.css
git commit -m "drive preset drops from a Ladle story"
```

---

### Task 5: Browser coverage across three engines

**Files:**
- Create: `e2e/declarative-drop.spec.ts`

- [ ] **Step 1: Write the spec**

Model it on `e2e/drop-on-edge.spec.ts` and `e2e/tab-stack.spec.ts`; `e2e/fixtures.ts` provides `openStory` and `boxOf`. Three tests against story `declarative--drop-intent`:

```ts
import { expect, test } from '@playwright/test';
import { boxOf, openStory } from './fixtures.js';

const STORY = 'declarative--drop-intent';
```

1. **"a drop into a seam lands at that index, not at the end"** — drag a pane from the right zone onto the seam between the left zone's first and second pane; assert the moved pane's box is between them afterwards (compare `boxOf` x/y against its neighbors), which appending would not produce.
2. **"a drop in the middle of a pane stacks the two"** — drop onto a pane's centre; assert a tab strip appears with both titles.
3. **"a drop on a pane's cross-axis edge splits it"** — drop on the top edge of a pane in a horizontal strip; assert the target pane and the dropped pane now share the target's former slot, stacked along the cross axis.

Drive the pointer the way the existing specs do — `page.mouse.move` / `down` / `move(..., { steps: 10 })` / `up` — never `dragTo`, which does not produce the intermediate moves the hover hit-test needs.

- [ ] **Step 2: Run all three engines**

Run: `npx playwright test e2e/declarative-drop.spec.ts`
Expected: 9 passed (3 tests × chromium/firefox/webkit).

- [ ] **Step 3: Run the whole browser suite**

Run: `npx playwright test`
Expected: all pass — the existing `<Container>` drop specs are the regression net for Task 1's extraction.

- [ ] **Step 4: Commit**

```bash
git add e2e/declarative-drop.spec.ts
git commit -m "drive preset drops from three browser engines"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md` (~line 629), `CHANGELOG.md`, `TODO.md`

- [ ] **Step 1: Correct the README**

`README.md` currently ends the split/stack section with:

> Both are `<Container>` props. The declarative presets register a drop target
> with no hit-test at all, so a `<Zone>` drop still appends.

Replace with a statement that `<Zone>` and `<Panel container={…}>` take the same
`stackOnDrop` / `splitOnDrop` / `dropIntent` props, gated by `acceptsDrops`.

- [ ] **Step 2: Add the CHANGELOG entry**

Under `## Unreleased` → `### Added` in `CHANGELOG.md`, one entry: the presets resolve a drop intent, the three new props, and that a preset drop used to append regardless of where the cursor was.

- [ ] **Step 3: Delete the TODO entry**

Remove the `**The declarative presets have no drop hit-test [HIGH].**` bullet from `TODO.md`'s "Drag and drop" section. If the trap it describes survives in any form — a consumer's own `useDropTarget` on a preset id now clobbers a real hit-test — fold that sentence into the existing note about the same hazard under "Playwright e2e suite".

- [ ] **Step 4: Full verification, then commit**

Run: `npx vitest run && npx playwright test && npx tsc -p tsconfig.json --noEmit && npx biome check src e2e && npm run build`
Expected: all pass.

```bash
git add README.md CHANGELOG.md TODO.md
git commit -m "document drop intent on the declarative presets"
```
