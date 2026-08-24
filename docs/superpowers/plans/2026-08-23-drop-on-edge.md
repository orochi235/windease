# Drop-on-edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag pane A over the top of pane B and release — B's slot becomes a two-pane strip holding B and A.

**Architecture:** The hit-test already resolves a `split` intent from the cross-axis bands; the engine rejects it for want of a commit path. This adds `store.splitInto` (a wrap mirroring `stackNodes`, not a reuse of `store.split`, which mints a throwaway placeholder pane), teaches `DragEngine` to dispatch it, and gives `<Container>` three props: `splitOnDrop`, `splitPreview`, and a `dropIntent` escape hatch that replaces the built-in resolver.

**Tech Stack:** TypeScript, React, vitest (unit), Playwright + Ladle (browser), biome (lint).

The design is [`docs/superpowers/specs/2026-08-23-drop-on-edge-design.md`](../specs/2026-08-23-drop-on-edge-design.md). Read it first — it carries the decisions this plan executes.

**Commands you will use throughout:**

- Unit tests: `npm test` (all), or `npx vitest run src/path/file.test.ts -t 'name'` (one)
- Typecheck: `npm run typecheck`
- Lint: `npm run lint` (fix with `npm run lint:fix`)
- Browser: `npm run test:e2e` (Playwright starts Ladle itself)
- Traces while debugging: `WINDEASE_TRACE=dnd,store npm test`

**Before Task 1:** branch off `main`.

```bash
git checkout -b drop-on-edge
```

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/dnd/dropIntent.ts` | Add `axis` to the `split` variant; emit it from both cross bands | 1 |
| `src/dnd/dropIntent.test.ts` | Cover the new field | 1 |
| `src/store.ts` | `splitInto`, inline beside `stackNodes` (it needs the same private helpers) | 2 |
| `src/store.split-into.test.ts` | New — mirrors `src/store.stack.test.ts` | 2 |
| `src/dnd/DragEngine.ts` | Accept a split intent; mint an id and commit it at drop; carry `splitConfig` | 3, 4 |
| `src/dnd/DragEngine.intent.test.ts` | Acceptance and dispatch | 3, 4 |
| `src/dnd/DragController.ts` | Thread `splitConfig` through | 4 |
| `src/react/dnd/DragProvider.tsx` | `splitConfig` prop | 4 |
| `src/react/Container.tsx` | `splitOnDrop`, `dropIntent`, `splitPreview`, the preview element | 5, 6 |
| `src/react/container.dropIntent.test.tsx` | New — the prop overrides and the preview | 5, 6 |
| `src/react/styles.css` | `.windease-split-preview` default appearance | 6 |
| `src/react/stories/DropOnEdge.stories.tsx` | New — operable story | 7 |
| `src/react/stories/drop-on-edge.css` | New — story styling | 7 |
| `e2e/drop-on-edge.spec.ts` | New — the gesture in three engines | 7 |
| `README.md`, `CHANGELOG.md`, `TODO.md` | Docs | 7 |

---

### Task 1: The split intent carries the group axis

`splitInto` needs to know which way to slice, and it cannot re-derive it: `<Container>` picks the axis from `cfg.axis`, falling back to `axisFromRects` in flow mode, which is a *measurement* (`Container.tsx:313`). So the resolver, which already knows, says so.

`axis` on the intent is **the axis of the group to create** — the cross axis of the container that resolved it. In a horizontal strip (`axis: 'x'`), a split stacks the two panes vertically, so the intent carries `'y'`.

**Files:**
- Modify: `src/dnd/dropIntent.ts:5-8`, `src/dnd/dropIntent.ts:73-80`
- Test: `src/dnd/dropIntent.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('resolveDropIntent', …)` block in `src/dnd/dropIntent.test.ts`:

```ts
  it('splits with the cross axis of a horizontal container', () => {
    const intent = resolveDropIntent(row, { x: 150, y: 5 }, 'x', { split: true });
    expect(intent).toEqual({ kind: 'split', ontoId: 'b', edge: 'start', axis: 'y' });
  });

  it('splits with the cross axis of a vertical container', () => {
    const column = [
      { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } },
      { id: 'b', rect: { x: 0, y: 100, w: 100, h: 100 } },
    ];
    const intent = resolveDropIntent(column, { x: 95, y: 150 }, 'y', { split: true });
    expect(intent).toEqual({ kind: 'split', ontoId: 'b', edge: 'end', axis: 'x' });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/dnd/dropIntent.test.ts -t 'cross axis'`

Expected: both FAIL — the returned object has no `axis` key, so `toEqual` reports a missing property.

- [ ] **Step 3: Add the field to the type**

In `src/dnd/dropIntent.ts`, replace the `split` variant (line 8):

```ts
  | { kind: 'split'; ontoId: ItemId; edge: 'start' | 'end'; axis: 'x' | 'y' };
```

and document it directly above the union member:

```ts
/** What kind of drop the cursor is asking for. */
export type DropIntent =
  | { kind: 'insert'; index: number }
  | { kind: 'stack'; ontoId: ItemId }
  /** `axis` is the strip axis of the group a split would create — the *cross*
   *  axis of the container that resolved this, not that container's own. */
  | { kind: 'split'; ontoId: ItemId; edge: 'start' | 'end'; axis: 'x' | 'y' };
```

- [ ] **Step 4: Emit it from both bands**

In `resolveDropIntent`, inside the `if (options.split)` block, replace the two return statements:

```ts
  if (options.split) {
    const cross: 'x' | 'y' = axis === 'x' ? 'y' : 'x';
    const crossPos = axis === 'x' ? cursor.y : cursor.x;
    const crossStart = axis === 'x' ? rect.y : rect.x;
    const crossExtent = axis === 'x' ? rect.h : rect.w;
    const crossOffset = crossPos - crossStart;
    if (crossOffset < crossExtent * band) {
      return { kind: 'split', ontoId: id, edge: 'start', axis: cross };
    }
    if (crossOffset > crossExtent * (1 - band)) {
      return { kind: 'split', ontoId: id, edge: 'end', axis: cross };
    }
  }
```

- [ ] **Step 5: Run the whole file to verify it passes and nothing regressed**

Run: `npx vitest run src/dnd/dropIntent.test.ts`

Expected: PASS, including the pre-existing `agrees with insertionIndexByMidpoint at every x when no other intent is enabled` sweep.

- [ ] **Step 6: Mutation-check the two new assertions**

Flip `cross` to `axis === 'x' ? 'x' : 'y'` and re-run. Both new tests must fail. Restore.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/dnd/dropIntent.ts src/dnd/dropIntent.test.ts
git commit -m "carry the group axis on a split intent"
```

---

### Task 2: `store.splitInto`

Mirrors `stackNodes` (`src/store.ts:1288-1360`), which is the shape to copy — not `store.split`, whose `splitNode` mints a `kind: 'panel'` placeholder for every new half (`split.ts:358`) that this gesture would immediately have to destroy.

It goes **inline in `store.ts`**, immediately after `stackNodes`, because it needs the same private helpers (`requireNode`, `assertUnlocked`, `isDescendantOf`) that keep `stackNodes` there. `split.ts` uses only public store methods, which is why it can live outside.

**Files:**
- Modify: `src/store.ts` (after `stackNodes`, which ends at line 1360)
- Test: `src/store.split-into.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/store.split-into.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from './constructors.js';
import { asNodeId, LockedError, type NodeId, Store } from './index.js';
import { serialize } from './snapshot.js';

const id = (s: string) => asNodeId(s);

/** zone `z` (horizontal strip) › panels `a`, `b`, `c`. */
function seeded(): { s: Store; z: NodeId; a: NodeId; b: NodeId; c: NodeId } {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x' } },
      id: id('z'),
    }),
  );
  for (const p of ['a', 'b', 'c']) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(p), parentId: id('z') }));
    s.showNode(id(p));
  }
  return { s, z: id('z'), a: id('a'), b: id('b'), c: id('c') };
}

const order = (s: Store, parent: NodeId) => s.getContainerView(parent)?.childOrder ?? [];

describe('Store.splitInto', () => {
  it('wraps both nodes in a strip at the onto-child slot', () => {
    const { s, z, a, b, c } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(order(s, z)).toEqual([id('g1'), c]);
    expect(order(s, id('g1'))).toEqual([a, b]);
    expect(s.getNode(id('g1'))?.container?.strategyId).toBe('strip');
  });

  it('puts the source last when the edge is the end', () => {
    const { s, a, b } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'end' });
    expect(order(s, id('g1'))).toEqual([b, a]);
  });

  it('gives the group the requested axis and fills it', () => {
    const { s, a, b } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(s.getNode(id('g1'))?.container?.config).toMatchObject({ axis: 'y', fill: true });
  });

  it('merges caller config over the defaults', () => {
    const { s, a, b } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start', config: { gap: 8 } });
    expect(s.getNode(id('g1'))?.container?.config).toMatchObject({ axis: 'y', fill: true, gap: 8 });
  });

  it('keeps the onto-child index rather than appending', () => {
    const { s, z, a, c } = seeded();
    s.splitInto(a, c, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(order(s, z)).toEqual([id('b'), id('g1')]);
  });

  it('gives the group the placement the onto-child was carrying', () => {
    const { s, a, b } = seeded();
    s.patchPlacement(b, { size: { w: 300 } });
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(s.getNode(id('g1'))?.membership?.placement).toMatchObject({ size: { w: 300 } });
  });

  it('clears a stale size from both children', () => {
    const { s, a, b } = seeded();
    s.patchPlacement(b, { size: { w: 300 } });
    s.patchPlacement(a, { size: { w: 120 } });
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(s.getNode(a)?.membership?.placement?.size).toBeUndefined();
    expect(s.getNode(b)?.membership?.placement?.size).toBeUndefined();
  });

  it('moves a pin from the onto-child to the group', () => {
    const { s, a, b } = seeded();
    s.setPinned(b, 0);
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(s.getPinnedIndex(id('g1'))).toBe(0);
    expect(s.getPinnedIndex(b)).toBeNull();
  });

  it('sets autoUnsplit so dragging one child out dissolves the group', () => {
    const { s, z, a, b, c } = seeded();
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    s.moveNode(a, z);
    expect(s.getNode(id('g1'))).toBeUndefined();
    expect(order(s, z)).toEqual([b, c, a]);
  });

  it('refuses to split a node onto itself and leaves the tree untouched', () => {
    const { s, a } = seeded();
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(a, a, { id: id('g1'), axis: 'y', edge: 'start' })).toThrow();
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses to split onto its own descendant and leaves the tree untouched', () => {
    const { s, a, b } = seeded();
    s.splitInto(b, a, { id: id('g1'), axis: 'y', edge: 'start' });
    // `b` now lives under g1, which lives under... a's old slot. Split g1 onto b:
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(id('g1'), b, { id: id('g2'), axis: 'x', edge: 'start' })).toThrow();
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses a duplicate group id and leaves the tree untouched', () => {
    const { s, a, b, c } = seeded();
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(a, b, { id: c, axis: 'y', edge: 'start' })).toThrow();
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses when the onto-child is move-locked, before mutating anything', () => {
    const { s, a, b } = seeded();
    s.setLock(b, { move: true });
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' })).toThrow(LockedError);
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('refuses when the parent is arrange-locked, before mutating anything', () => {
    const { s, z, a, b } = seeded();
    s.setLock(z, { arrange: true });
    const before = JSON.stringify(serialize(s));
    expect(() => s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' })).toThrow(LockedError);
    expect(JSON.stringify(serialize(s))).toBe(before);
  });

  it('is one undo step', () => {
    const { s, a, b } = seeded();
    let begins = 0;
    let ends = 0;
    s.events.on('transaction.begin', () => {
      begins += 1;
    });
    s.events.on('transaction.end', () => {
      ends += 1;
    });
    s.splitInto(a, b, { id: id('g1'), axis: 'y', edge: 'start' });
    expect(begins).toBe(1);
    expect(ends).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/store.split-into.test.ts`

Expected: every test FAILS with `s.splitInto is not a function`.

- [ ] **Step 3: Implement `splitInto`**

In `src/store.ts`, immediately after the closing brace of `stackNodes` (line 1360), add:

```ts
  /**
   * Put `sourceId` and `ontoId` in one new strip, splitting the slot `ontoId`
   * occupied. The group takes that slot — same parent, same index, inheriting
   * its placement and its pin — and `edge: 'start'` puts the source first.
   *
   * `axis` is the new strip's axis, which the caller supplies because a drop
   * resolves it from geometry the store cannot see.
   *
   * The group gets `autoUnsplit`, so dragging either child out dissolves it.
   */
  splitInto(
    sourceId: NodeId,
    ontoId: NodeId,
    opts: {
      id: NodeId;
      axis: 'x' | 'y';
      edge: 'start' | 'end';
      config?: Record<string, unknown>;
    } & MutateOptions,
  ): void {
    const source = this.requireNode(sourceId);
    const onto = this.requireNode(ontoId);
    if (sourceId === ontoId) {
      throw new InvariantViolationError('split-self', `cannot split ${sourceId} onto itself`, {
        id: sourceId,
      });
    }
    if (this.isDescendantOf(ontoId, sourceId)) {
      throw new CycleError(sourceId, ontoId);
    }
    if (!onto.membership) {
      throw new CapabilityMissingError(ontoId, 'membership', 'splitInto');
    }
    if (!source.membership) {
      throw new CapabilityMissingError(sourceId, 'membership', 'splitInto');
    }
    const parentId = onto.membership.parentId;
    const parent = this.requireNode(parentId);

    // Everything the transaction needs, checked before it opens: `transact`
    // does not roll back, so a throw from inside leaves a half-built group.
    if (this.nodesMap.has(opts.id)) throw new DuplicateNodeError(opts.id);
    if (!parent.container) {
      throw new InvariantViolationError(
        'parent-not-container',
        `parent ${parentId} has no container capability`,
        { parentId, childId: ontoId },
      );
    }
    this.assertUnlocked(sourceId, 'move', 'splitInto', opts);
    this.assertUnlocked(ontoId, 'move', 'splitInto', opts);
    this.assertUnlocked(parentId, 'arrange', 'splitInto', opts);
    this.assertUnlocked(parentId, 'accept', 'splitInto', opts);
    this.assertUnlocked(parentId, 'dragOut', 'splitInto', opts);
    this.assertUnlocked(source.membership.parentId, 'dragOut', 'splitInto', opts);

    const at = parent.container.childOrder.indexOf(ontoId);
    const placement = { ...onto.membership.placement };
    delete placement.pinned;
    const pinned = this.getPinnedIndex(ontoId);

    this.transact(() => {
      this.registerNode(
        createNode({
          id: opts.id,
          kind: 'group',
          parentId,
          placement,
          container: {
            strategyId: 'strip',
            config: { axis: opts.axis, fill: true, ...opts.config },
          },
        }),
      );
      this.showNode(opts.id);
      this.setAutoUnsplit(opts.id, true);
      this.reorderInParent(opts.id, at);
      const [first, second] = opts.edge === 'start' ? [sourceId, ontoId] : [ontoId, sourceId];
      this.moveNode(first, opts.id);
      this.moveNode(second, opts.id);
      // Both sizes were measured against the old parent's axis and mean
      // nothing against this one; the group carries the outer slot's size.
      this.patchPlacement(sourceId, { size: undefined });
      this.patchPlacement(ontoId, { size: undefined });
      if (pinned !== null) this.setPinned(opts.id, pinned);
    }, 'splitInto');
    trace(
      'store',
      `splitInto: ${sourceId} onto ${ontoId} ${opts.axis}/${opts.edge} as ${opts.id}@${at}`,
    );
  }
```

`CycleError` is already imported in `store.ts` (it is what `stackNodes` throws); confirm the import list at the top of the file covers `CapabilityMissingError`, `CycleError`, `DuplicateNodeError` and `InvariantViolationError`, and add any that is missing.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/store.split-into.test.ts`

Expected: PASS, all 15.

- [ ] **Step 5: Mutation-check the negative assertions**

One at a time, break the behaviour and confirm the named test fails, then restore:

| Break | Test that must fail |
| --- | --- |
| Delete the `patchPlacement(sourceId, { size: undefined })` line | `clears a stale size from both children` |
| Delete `this.setAutoUnsplit(opts.id, true)` | `sets autoUnsplit so dragging one child out dissolves the group` |
| Move the `assertUnlocked(ontoId, 'move', …)` call inside `transact` | `refuses when the onto-child is move-locked` (the tree comparison, not the throw) |
| Delete `if (pinned !== null) this.setPinned(opts.id, pinned)` | `moves a pin from the onto-child to the group` |
| Swap the `edge === 'start'` ternary arms | `wraps both nodes in a strip at the onto-child slot` |

Any of these that still passes is a vacuous test — rewrite it before moving on.

- [ ] **Step 6: Run the full suite, typecheck, lint, commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/store.ts src/store.split-into.test.ts
git commit -m "wrap two nodes in a split strip"
```

---

### Task 3: The engine accepts a split intent

`checkIntent` currently rejects every split (`DragEngine.ts:371-374`). The four rejections a split needs are the four the stack branch already runs, so the shared part is lifted rather than duplicated.

**Files:**
- Modify: `src/dnd/DragEngine.ts:369-394`
- Test: `src/dnd/DragEngine.intent.test.ts`

- [ ] **Step 1: Write the failing tests**

Read `src/dnd/DragEngine.intent.test.ts` first and reuse its existing harness (its `seeded()`/setup helper and the way it registers drop targets) rather than inventing a second one. Append tests equivalent to these, adapted to that harness:

```ts
  it('accepts a split intent', () => {
    const { engine, a, b } = seededDrag();
    engine.start(a, { x: 0, y: 0 });
    engine.moveTo(pointInside(b, { edge: 'start' }));
    expect(engine.state()?.hover?.accepted).toBe(true);
    expect(engine.state()?.hover?.intent).toMatchObject({ kind: 'split', ontoId: b });
  });

  it('refuses a split onto the dragged node', () => {
    const { engine, a } = seededDrag();
    engine.start(a, { x: 0, y: 0 });
    engine.moveTo(pointInside(a, { edge: 'start' }));
    expect(engine.state()?.hover?.accepted).toBe(false);
  });

  it('refuses a split onto a move-locked node', () => {
    const { engine, store, a, b } = seededDrag();
    store.setLock(b, { move: true });
    engine.start(a, { x: 0, y: 0 });
    engine.moveTo(pointInside(b, { edge: 'start' }));
    expect(engine.state()?.hover?.accepted).toBe(false);
  });

  it('refuses a split onto its own descendant', () => {
    const { engine, store, a, b } = seededDrag();
    store.moveNode(b, a); // b is now a child of a
    engine.start(a, { x: 0, y: 0 });
    engine.moveTo(pointInside(b, { edge: 'start' }));
    expect(engine.state()?.hover?.accepted).toBe(false);
  });

  it('refuses a split into a controlled parent', () => {
    const { engine, a, b, z } = seededDrag();
    engine.registerOrderControl(z, () => {});
    engine.start(a, { x: 0, y: 0 });
    engine.moveTo(pointInside(b, { edge: 'start' }));
    expect(engine.state()?.hover?.accepted).toBe(false);
  });
```

The existing stack tests in this file show the exact call shapes for `start`/`moveTo`/`registerOrderControl` — copy them rather than guessing.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/dnd/DragEngine.intent.test.ts -t 'split'`

Expected: `accepts a split intent` FAILS (`accepted` is `false`). The four refusal tests **pass for the wrong reason** — the blanket stub rejects everything. That is why Step 5 mutation-checks them.

- [ ] **Step 3: Replace the stub**

In `src/dnd/DragEngine.ts`, replace `checkIntent` (lines 369-394) with:

```ts
  private checkIntent(targetId: NodeId, draggingId: NodeId, intent: DropIntent): boolean {
    if (intent.kind === 'insert') return true;
    const ontoId = intent.ontoId as NodeId;
    if (ontoId === draggingId) {
      trace('dnd', `checkAccept ${targetId}: REJECT (${intent.kind} onto the dragged node)`);
      return false;
    }
    if (this.store.isLocked(ontoId, 'move')) {
      trace('dnd', `checkAccept ${targetId}: REJECT (${intent.kind} onto ${ontoId} with lock.move)`);
      return false;
    }
    if (this.isWithin(ontoId, draggingId)) {
      trace('dnd', `checkAccept ${targetId}: REJECT (${intent.kind} onto own descendant ${ontoId})`);
      return false;
    }
    // A wrap creates a node the host never asked for, so it cannot be handed to
    // a parent that owns its own child order.
    if (this.orderControls.has(targetId)) {
      trace('dnd', `checkAccept ${targetId}: REJECT (${intent.kind} into a controlled parent)`);
      return false;
    }
    return true;
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/dnd/DragEngine.intent.test.ts`

Expected: PASS, including every pre-existing stack test.

- [ ] **Step 5: Mutation-check each refusal**

Delete one guard at a time and confirm exactly the matching test fails, then restore:

| Delete | Test that must fail |
| --- | --- |
| `ontoId === draggingId` | `refuses a split onto the dragged node` |
| `isLocked(ontoId, 'move')` | `refuses a split onto a move-locked node` |
| `isWithin(ontoId, draggingId)` | `refuses a split onto its own descendant` |
| `orderControls.has(targetId)` | `refuses a split into a controlled parent` |

A refusal test that still passes with its guard deleted is reaching a different branch — rewrite it so it exercises the guard it is named after. (Four tests in the drop-intent work passed this way.)

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/dnd/DragEngine.ts src/dnd/DragEngine.intent.test.ts
git commit -m "accept a split intent at the hover"
```

---

### Task 4: The engine commits the split on drop

**Files:**
- Modify: `src/dnd/DragEngine.ts` (options ~102, field ~154, constructor ~168, `drop()` ~457, id minting ~407)
- Modify: `src/dnd/DragController.ts:87-96`
- Modify: `src/react/dnd/DragProvider.tsx:17-34`
- Test: `src/dnd/DragEngine.intent.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/dnd/DragEngine.intent.test.ts`, adapted to its harness:

```ts
  it('commits a split at the drop', () => {
    const { engine, store, a, b, z } = seededDrag();
    engine.start(a, { x: 0, y: 0 });
    engine.moveTo(pointInside(b, { edge: 'start' }));
    engine.drop();
    const outer = store.getContainerView(z)?.childOrder ?? [];
    expect(outer).toHaveLength(2);
    const groupId = outer[0];
    expect(store.getContainerView(groupId)?.childOrder).toEqual([a, b]);
    expect(store.getNode(groupId)?.container?.config).toMatchObject({ axis: 'y' });
  });

  it('puts the source in the far half for an end-edge drop', () => {
    const { engine, store, a, b, z } = seededDrag();
    engine.start(a, { x: 0, y: 0 });
    engine.moveTo(pointInside(b, { edge: 'end' }));
    engine.drop();
    const groupId = (store.getContainerView(z)?.childOrder ?? [])[0];
    expect(store.getContainerView(groupId)?.childOrder).toEqual([b, a]);
  });

  it('merges splitConfig into the group it creates', () => {
    const { engine, store, a, b, z } = seededDrag({ splitConfig: { gap: 6 } });
    engine.start(a, { x: 0, y: 0 });
    engine.moveTo(pointInside(b, { edge: 'start' }));
    engine.drop();
    const groupId = (store.getContainerView(z)?.childOrder ?? [])[0];
    expect(store.getNode(groupId)?.container?.config).toMatchObject({ gap: 6 });
  });
```

Extend the file's `seededDrag` helper to forward an optional options bag into the `DragEngine` constructor, matching how the stack tests pass `stackConfig`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/dnd/DragEngine.intent.test.ts -t 'split at the drop'`

Expected: FAIL — the drop falls through to `moveNode`, so `z` still holds three children and no group exists.

- [ ] **Step 3: Add `splitConfig` and the id minter**

In `src/dnd/DragEngine.ts`, beside `stackConfig` in the options interface (line 102):

```ts
  splitConfig?: Record<string, unknown>;
```

beside the field (line 154):

```ts
  private readonly splitConfig: Record<string, unknown> | undefined;
```

in the constructor (line 168):

```ts
    this.splitConfig = options.splitConfig;
```

and beside `nextStackId` (line 407), add a counter field `private splitSeq = 0;` next to `stackSeq` and:

```ts
  private nextSplitId(): NodeId {
    let candidate: NodeId;
    do {
      this.splitSeq += 1;
      candidate = `split-${this.splitSeq}` as NodeId;
    } while (this.store.getNode(candidate) !== undefined);
    return candidate;
  }
```

- [ ] **Step 4: Dispatch it in `drop()`**

In `drop()`, directly after the existing `if (hover.intent?.kind === 'stack') { … }` block (which ends at line 469), add:

```ts
    if (hover.intent?.kind === 'split') {
      const { ontoId, edge, axis } = hover.intent;
      const id = this.nextSplitId();
      try {
        this.store.splitInto(draggingId, ontoId as NodeId, {
          id,
          axis,
          edge,
          ...(this.splitConfig ? { config: this.splitConfig } : {}),
        });
        trace('dnd', `drop: split ${draggingId} onto ${ontoId} ${axis}/${edge} as ${id}`);
      } catch (err) {
        trace('dnd', `drop failed: ${(err as Error).message}`);
      }
      this.clear();
      return;
    }
```

- [ ] **Step 5: Thread `splitConfig` through the controller and provider**

`src/dnd/DragController.ts:87` — add a fourth optional parameter and forward it:

```ts
  constructor(
    store: Store,
    getStrategy?: StrategyLookup,
    stackConfig?: Record<string, unknown>,
    splitConfig?: Record<string, unknown>,
  ) {
```

and beside the existing `if (stackConfig) options.stackConfig = stackConfig;`:

```ts
    if (splitConfig) options.splitConfig = splitConfig;
```

`src/react/dnd/DragProvider.tsx` — add the prop beside `stackConfig` (line 21), destructure it (line 28), and pass it (lines 33-34):

```ts
  splitConfig?: Record<string, unknown>;
```

```tsx
  splitConfig,
```

```tsx
    () =>
      new DragController(
        store,
        registry ? (sid) => registry.get(sid) : undefined,
        stackConfig,
        splitConfig,
      ),
    [store, registry, stackConfig, splitConfig],
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/dnd/DragEngine.intent.test.ts`

Expected: PASS.

- [ ] **Step 7: Mutation-check**

Swap `edge` for a hardcoded `'start'` in the `drop()` dispatch; `puts the source in the far half for an end-edge drop` must fail. Restore.

- [ ] **Step 8: Full suite, typecheck, lint, commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/dnd/DragEngine.ts src/dnd/DragController.ts src/react/dnd/DragProvider.tsx src/dnd/DragEngine.intent.test.ts
git commit -m "commit a split intent at the drop"
```

---

### Task 5: `<Container splitOnDrop>` and the `dropIntent` override

`<Container>` hardcodes its resolver today (`Container.tsx:304-319`). This turns that into a default and lets a consumer replace it — which is also the answer to band thickness, so no `band` prop ships.

**Files:**
- Modify: `src/react/Container.tsx:43-128` (props), `:186` (destructure), `:302-330` (registration)
- Test: `src/react/container.dropIntent.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/react/container.dropIntent.test.tsx`. Model the render harness on `src/react/dnd/dragOverlay.test.tsx`, which already mounts a `<DragProvider>` over a store — copy its setup rather than writing a new one. The two behaviours to assert:

```tsx
  it('resolves a split when splitOnDrop is set', async () => {
    const seen: DropIntent[] = [];
    // Mount a <Container splitOnDrop> whose children have known rects, then
    // drive a drag to a point in the top band of the second child and read
    // controller.state()?.hover?.intent.
    expect(seen.at(-1)).toMatchObject({ kind: 'split', edge: 'start', axis: 'y' });
  });

  it('uses a dropIntent prop instead of the built-in resolver', async () => {
    const calls: { axis: 'x' | 'y'; sourceId: NodeId }[] = [];
    const dropIntent = (ctx: {
      rects: readonly { id: NodeId; rect: Rect }[];
      point: { x: number; y: number };
      axis: 'x' | 'y';
      sourceId: NodeId;
    }): DropIntent => {
      calls.push({ axis: ctx.axis, sourceId: ctx.sourceId });
      return { kind: 'insert', index: 0 };
    };
    // Mount <Container splitOnDrop dropIntent={dropIntent}>, drive the same
    // drag, and assert the built-in never ran.
    expect(calls.length).toBeGreaterThan(0);
    expect(controller.state()?.hover?.intent).toEqual({ kind: 'insert', index: 0 });
  });
```

jsdom reports zero-sized rects, so give the children explicit rects by stubbing `getBoundingClientRect` on the container's child elements — `src/react/dnd/dragOverlay.test.tsx` does exactly this; follow it. If the geometry proves impossible to fake cleanly, assert the prop plumbing here (that `dropIntent` is called, with the right `sourceId` and `axis`) and let Task 7's Playwright spec carry the band geometry, which is where it belongs anyway.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/react/container.dropIntent.test.tsx`

Expected: FAIL — `splitOnDrop` and `dropIntent` are not props, so TypeScript rejects them and the test file does not compile.

- [ ] **Step 3: Add the props**

In `ContainerProps` (`src/react/Container.tsx`), after `stackOnDrop` (line 62):

```ts
  /**
   * Let a drop in a cross-axis band of a child split that child: the child's
   * slot becomes a two-pane strip holding it and the dropped node. Off by
   * default, like `stackOnDrop`, because it restructures the tree.
   *
   * With `stackOnDrop` off, the centre of a child still resolves to an insert
   * — the centre band is only carved for stacking — which is the "edges split,
   * everything else inserts" model a consumer without tabs wants.
   */
  splitOnDrop?: boolean;
  /**
   * Replace the built-in drop hit-test. Receives the measured child rects with
   * the dragged node already removed, the cursor, this container's own axis,
   * and the dragged node's id; returns what the drop means.
   *
   * The default is
   * `resolveDropIntent(rects, point, axis, { stack: stackOnDrop, split: splitOnDrop })`.
   * Use this to change band thickness, add quadrant zones, or refuse an intent
   * on small panes — `resolveDropIntent` is exported, so a tweak is one call.
   */
  dropIntent?: (ctx: {
    rects: readonly { id: NodeId; rect: Rect }[];
    point: Point;
    axis: 'x' | 'y';
    sourceId: NodeId;
  }) => DropIntent | undefined;
```

Import `DropIntent`, `Point` and `Rect` from the paths the file already uses for layout types; `resolveDropIntent` is already imported for the built-in.

Destructure both in `StoreContainer` beside `stackOnDrop = false` (line 186):

```ts
  splitOnDrop = false,
  dropIntent,
```

- [ ] **Step 4: Route the registration through them**

Replace the body of `getDropIntent` in the `registerDropTarget` effect (lines 304-319):

```ts
      getDropIntent: (point) => {
        const rects = childRectsForContainer(el);
        if (rects.length === 0) return { kind: 'insert', index: 0 };
        // Skip the source itself for same-parent previews.
        const sourceId = dragController.state()?.draggingId;
        const filtered = sourceId ? rects.filter((r) => r.id !== sourceId) : rects;
        // A flow container has no strategy to infer an axis from and no reason
        // to have set one, so read it off the arrangement CSS produced.
        const axis: 'x' | 'y' =
          cfg.axis ?? (isFlow ? axisFromRects(filtered) : strategyId === 'strip' ? 'x' : 'y');
        const mapped = filtered.map((r) => ({ id: r.id, rect: domRectToRect(r.rect) }));
        if (dropIntent && sourceId) {
          return dropIntent({ rects: mapped, point, axis, sourceId });
        }
        return resolveDropIntent(mapped, point, axis, {
          ...(stackOnDrop ? { stack: true } : {}),
          ...(splitOnDrop ? { split: true } : {}),
        });
      },
```

and add `splitOnDrop` and `dropIntent` to that effect's dependency array beside `stackOnDrop`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/react/container.dropIntent.test.tsx`

Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add src/react/Container.tsx src/react/container.dropIntent.test.tsx
git commit -m "enable split drops and let a consumer replace the resolver"
```

---

### Task 6: The split preview element

**Files:**
- Modify: `src/react/Container.tsx` (props, render tail at `:411-424`)
- Modify: `src/react/styles.css:57-65`
- Test: `src/react/container.dropIntent.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/react/container.dropIntent.test.tsx`, reusing the same harness:

```tsx
  it('draws a preview over the half the source would take', async () => {
    // Drive a drag into the start band of a child whose placement is
    // { x: 100, y: 0, w: 100, h: 100 }, with the container axis 'x'.
    const preview = container.querySelector('.windease-split-preview') as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.style.top).toBe('0px');
    expect(preview.style.height).toBe('50px');
    expect(preview.style.left).toBe('100px');
    expect(preview.style.width).toBe('100px');
  });

  it('draws the far half for an end-edge intent', async () => {
    const preview = container.querySelector('.windease-split-preview') as HTMLElement;
    expect(preview.style.top).toBe('50px');
    expect(preview.style.height).toBe('50px');
  });

  it('draws nothing when splitPreview is none', async () => {
    expect(container.querySelector('.windease-split-preview')).toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/react/container.dropIntent.test.tsx -t 'preview'`

Expected: FAIL — no element carries that class.

- [ ] **Step 3: Add the prop**

In `ContainerProps`, after `dropIntent`:

```ts
  /**
   * What a prospective split draws. `'element'` positions a
   * `div.windease-split-preview` over the half the dragged node would take;
   * restyle it through that class. `'none'` draws nothing, for consumers
   * drawing their own through `<DragProvider dragOverlay>`, whose context
   * already carries the intent. Default `'element'`.
   */
  splitPreview?: 'none' | 'element';
```

and destructure it beside `splitOnDrop`:

```ts
  splitPreview = 'element',
```

- [ ] **Step 4: Render it**

In `StoreContainer`, just above the `return (` of the main render, compute the rect:

```tsx
  const splitHint =
    splitPreview === 'element' &&
    dragState?.hover?.targetId === parentId &&
    dragState.hover.accepted &&
    dragState.hover.intent?.kind === 'split'
      ? dragState.hover.intent
      : null;
  const splitRect = splitHint ? layout.placements.get(splitHint.ontoId as NodeId) : undefined;
  const splitStyle: CSSProperties | null =
    splitHint && splitRect
      ? splitHint.axis === 'y'
        ? {
            ...CHILD_BASE,
            left: splitRect.x,
            width: splitRect.w,
            height: splitRect.h / 2,
            top: splitHint.edge === 'start' ? splitRect.y : splitRect.y + splitRect.h / 2,
          }
        : {
            ...CHILD_BASE,
            top: splitRect.y,
            height: splitRect.h,
            width: splitRect.w / 2,
            left: splitHint.edge === 'start' ? splitRect.x : splitRect.x + splitRect.w / 2,
          }
      : null;
```

and render it immediately before `{renderedOverlay}` in the JSX tail:

```tsx
      {splitStyle ? (
        <div className="windease-split-preview" style={splitStyle} aria-hidden="true" />
      ) : null}
```

The inline `style` here is geometry the strategy computed this frame, exactly as every child rect above it is positioned; appearance stays in the stylesheet.

- [ ] **Step 5: Add the default appearance**

In `src/react/styles.css`, after the `.windease-insertion-outline` block (line 65):

```css
.windease-split-preview {
  background: currentColor;
  opacity: 0.25;
  pointer-events: none;
}
```

and extend the header comment at line 11 to name it alongside `.windease-insertion-line`.

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/react/container.dropIntent.test.tsx`

Expected: PASS.

- [ ] **Step 7: Mutation-check**

Swap the `edge === 'start'` ternary in the `axis === 'y'` branch; `draws a preview over the half the source would take` must fail. Restore.

- [ ] **Step 8: Full suite, typecheck, lint, commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/react/Container.tsx src/react/styles.css src/react/container.dropIntent.test.tsx
git commit -m "draw the half a split drop would take"
```

---

### Task 7: Story, browser specs, and docs

The gestures this library exists for are the ones unit tests are worst at, and the drop-intent work found two defects that only a render could see. A story that merely renders the feature is not integration — it has to be operable.

**Files:**
- Create: `src/react/stories/DropOnEdge.stories.tsx`, `src/react/stories/drop-on-edge.css`
- Create: `e2e/drop-on-edge.spec.ts`
- Modify: `README.md`, `CHANGELOG.md`, `TODO.md`

- [ ] **Step 1: Write the story**

Create `src/react/stories/DropOnEdge.stories.tsx`, modelled on `src/react/stories/TabStack.stories.tsx` — copy its provider setup, its `data-testid="pane-<id>"` convention and its readout element, which the spec below depends on. It must render:

- a horizontal `<Container splitOnDrop affordances>` over three panes `a`, `b`, `c`, each with a `<DragHandle>` carrying `data-windease-drag-handle="<id>"`
- a `data-testid="doe-readout"` element printing the live tree as `parent:child,child` pairs, so a spec can assert structure without reaching into the store
- `<DragProvider splitConfig={{ gap: 4 }}>`

Add `src/react/stories/drop-on-edge.css` for pane borders and a visible `.windease-split-preview` colour, imported by the story.

- [ ] **Step 2: Check it by hand**

```bash
npm run ladle
```

Open the story, drag `a` onto the top quarter of `b`, and confirm: the preview appears over `b`'s top half, the drop produces a vertical pair, the new seam drags, and dragging `a` back out dissolves the group. Fix anything broken here before writing the spec — this is the step that catches what headless tests cannot.

- [ ] **Step 3: Write the browser spec**

Create `e2e/drop-on-edge.spec.ts`, modelled on `e2e/tab-stack.spec.ts` — reuse its `dragOnto` helper shape, but take a vertical fraction so the drop lands in a cross-axis band:

```ts
import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, openStory } from './fixtures.js';

const STORY = 'drop-on-edge--split-on-drop';

const readout = (page: Page) => page.locator('[data-testid="doe-readout"]');
const handle = (page: Page, id: string) => page.locator(`[data-windease-drag-handle="${id}"]`);
const pane = (page: Page, id: string) => page.locator(`[data-testid="pane-${id}"]`);

/** Drag `sourceId` into `ontoId` at `fy` down its height, centred horizontally. */
async function dragOnto(page: Page, sourceId: string, ontoId: string, fy: number) {
  const from = centerOf(await boxOf(handle(page, sourceId)));
  const box = await boxOf(pane(page, ontoId).locator('xpath=ancestor::*[@data-node][1]'));
  const to = { x: box.x + box.w / 2, y: box.y + box.h * fy };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up();
}

test.describe('drop on edge', () => {
  test('a drop in the top band splits the pane', async ({ page }) => {
    await openStory(page, STORY);
    await dragOnto(page, 'a', 'b', 0.1);
    await expect(readout(page)).toContainText('split-1:a,b');
  });

  test('a drop in the bottom band puts the source second', async ({ page }) => {
    await openStory(page, STORY);
    await dragOnto(page, 'a', 'b', 0.9);
    await expect(readout(page)).toContainText('split-1:b,a');
  });

  test('the preview shows the half the drop would take', async ({ page }) => {
    await openStory(page, STORY);
    const from = centerOf(await boxOf(handle(page, 'a')));
    const box = await boxOf(pane(page, 'b').locator('xpath=ancestor::*[@data-node][1]'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w / 2, box.y + box.h * 0.1, { steps: 12 });
    const preview = page.locator('.windease-split-preview');
    await expect(preview).toBeVisible();
    const pb = await boxOf(preview);
    expect(pb.h).toBeLessThan(box.h * 0.6);
    expect(pb.y).toBeLessThan(box.y + box.h * 0.5);
    await page.mouse.up();
  });

  test('a drop in a main-axis band still plain-inserts', async ({ page }) => {
    await openStory(page, STORY);
    const from = centerOf(await boxOf(handle(page, 'c')));
    const box = await boxOf(pane(page, 'a').locator('xpath=ancestor::*[@data-node][1]'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w * 0.05, box.y + box.h / 2, { steps: 12 });
    await page.mouse.up();
    await expect(readout(page)).not.toContainText('split-1');
  });

  test('dragging the pane back out dissolves the group', async ({ page }) => {
    await openStory(page, STORY);
    await dragOnto(page, 'a', 'b', 0.1);
    await expect(readout(page)).toContainText('split-1:a,b');
    const from = centerOf(await boxOf(handle(page, 'a')));
    const box = await boxOf(pane(page, 'c').locator('xpath=ancestor::*[@data-node][1]'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w * 0.95, box.y + box.h / 2, { steps: 12 });
    await page.mouse.up();
    await expect(readout(page)).not.toContainText('split-1');
  });
});
```

- [ ] **Step 4: Run the browser suite**

Run: `npm run test:e2e -- drop-on-edge`

Expected: 5 specs × 3 engines = 15 PASS. A failure here after green unit tests is the interesting kind — the drop-intent work found two such defects, both one-liners.

- [ ] **Step 5: Update the docs**

`README.md` — in the Drag and drop section, after the tab-stacking paragraph, document `splitOnDrop`, `splitPreview`, `dropIntent` and `<DragProvider splitConfig>`, with the one-line band-tuning example from the design doc.

`CHANGELOG.md` — under `## Unreleased`:

```markdown
- **Drop on a pane's edge to split it.** `<Container splitOnDrop>` lets a drop in a
  child's cross-axis band split that child: its slot becomes a two-pane strip holding
  it and the dropped node, committed by the new `store.splitInto`. `splitPreview`
  (`'element'` by default) draws the half the drop would take, restyled through
  `.windease-split-preview`. `<Container dropIntent>` replaces the built-in hit-test
  outright, which is how band thickness and custom drop zones are tuned.
```

`TODO.md` — delete the `Drop on a pane's edge to split it [HIGH]` bullet from the Drag and drop section; it has shipped.

- [ ] **Step 6: Full verification and commit**

```bash
npm test && npm run typecheck && npm run lint && npm run test:e2e
git add -A
git commit -m "drive drop-on-edge from a Ladle story and three browser engines"
```

Report the actual counts from each command. If any suite fails, say so with the output rather than describing the change as done.

---

## Self-Review

**Spec coverage.** `splitInto` → Task 2. Intent axis → Task 1. Engine acceptance → Task 3. Engine commit, `nextSplitId`, `splitConfig` → Task 4. `splitOnDrop`, `dropIntent`, no `band` prop → Task 5. `splitPreview` and the element → Task 6. Story, three-engine specs, README, CHANGELOG, TODO → Task 7. Size-clearing, pin transfer and `autoUnsplit` are Task 2 steps 3 and 5. Mutation-checking appears in Tasks 1, 2, 3, 4 and 6 with the specific break named.

Two spec items are deliberately absent, both recorded as `[MED]` in `TODO.md`: `splitPreview: 'layout'`, and splitting under `<Zone>`/`<Panel>`, which needs the presets to get a hit-test at all.

**Type consistency.** `splitInto(sourceId, ontoId, { id, axis, edge, config? })` is the same shape in Task 2's implementation, Task 4's dispatch and every test. The intent's `axis` means the *group's* axis throughout; `<Container>`'s `dropIntent` ctx `axis` means the *container's* — the two are one flip apart, which is why Task 1 puts that distinction in the doc comment on the type.

**Known soft spot.** Task 5's and Task 6's assertions depend on faking child rects in jsdom. Task 5 Step 1 says what to do if that proves unworkable: assert the plumbing headlessly and let Task 7's Playwright specs carry the geometry, which is where band behaviour belongs regardless.
