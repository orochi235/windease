# Replaceable Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make windease's four hardcoded policies — successor choice, directional navigation, container acceptance, edge-scroll tuning — replaceable by a consumer.

**Architecture:** Not one seam. The two core policies (`chooseSuccessor`, `resolveNavigation`) are injected through `StoreOptions`, beside the `throttle` and `clock` that are already injected there. The two drag concerns become props on `<Container>` and the presets, forwarded into plumbing that mostly exists. Every override is tri-state: `undefined` falls through to the built-in, so a consumer who changes one case does not reimplement the rest.

**Tech Stack:** TypeScript 6.x, React 18, Vitest (headless — no jsdom in core), Playwright over Ladle stories, Biome.

**Spec:** [`docs/superpowers/specs/2026-08-27-replaceable-policies-design.md`](../specs/2026-08-27-replaceable-policies-design.md)

---

## Before you start

**The core is DOM-independent.** Tasks 1–3 touch `src/store.ts`, `src/focus/`, `src/dnd/DragEngine.ts` — none of these may reference `document`, `window`, or `Element`. Their tests run headless. If a test you write needs jsdom, you have put code on the wrong side of the boundary.

**`canAccept` is a hot path.** It runs on every drag `pointermove`. Task 3 is the one place where a careless edit costs real frames; it has an explicit guard step for that reason.

**Every policy call is guarded.** Added after Task 1's review found the failure mode. Each of these callbacks is arbitrary consumer code running inside a library operation, so **a policy that throws, or returns an answer the library cannot use, is traced and treated as `undefined`** — the built-in decides. `TypedEmitter.emit` (`src/events.ts:22-25`) is the house precedent: it already swallows a consumer listener's throw and logs.

This is not defensive padding. `#unregisterNodeInner` calls `succeedFocus` (`src/store.ts:356`) *after* destroying the departing node's descendants and *before* `detachAndRemove`, the `node.unregistered` emit and `scheduleNotify()`. An unguarded throw there escapes `unregisterNode` and leaves the node registered with its children already gone and no notification.

`null` and `false` are deliberate answers and are never second-guessed — only a returned *id* is validated. Tasks 1, 2 and 3 each carry the guard for their own policy.

**Commit gate.** Before every `git commit` step below, invoke the **`prepare-js-commit`** skill. For this repo that resolves to:

```bash
npm run lint        # biome; npm run lint:fix to repair
npm run typecheck   # covers src, tests and stories
npm test            # vitest run
npm run build       # the pre-commit gate proper
```

Biome is pinned in `package.json` and CI installs it with `npm ci`, so the skill's "sync the linter with CI" step is a no-op here — do not run `npm i -D @biomejs/biome@latest`.

Recent history uses `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`; keep it. Do not push to `main` — this work belongs on a branch.

---

## File Structure

| File | Change | Responsibility after |
| --- | --- | --- |
| `src/focus/successor.ts` | Modify | Built-in successor rule **plus** the `SuccessorPolicy` / `SuccessorInput` types |
| `src/focus/resolve.ts` | Modify | Public `resolveNavigation` (policy + re-entrancy guard) wrapping a private `builtinResolve`; `NavigationPolicy` type |
| `src/throttle.ts` | Modify | `StoreOptions` — gains the two policy fields (this is where `StoreOptions` lives, despite the filename) |
| `src/store.ts` | Modify | Holds both policies; `succeedFocus` consults the successor one; exposes `navigationPolicy` for `resolve.ts` to read |
| `src/dnd/DragEngine.ts` | Modify | `AcceptContext` type, `DropTarget.acceptPolicy`, new `checkAccept` ordering |
| `src/dnd/DragController.ts` | Modify | `DropTargetOptions.acceptPolicy`, forwarded to the engine |
| `src/react/dnd/useDropIntentTarget.ts` | Modify | Accepts and forwards `acceptPolicy` and `edgeScroll` |
| `src/react/Container.tsx` | Modify | `canAccept` and `edgeScroll` props |
| `src/react/presets.tsx` | Modify | Same two through `PresetShell`'s `drop` bag, on `<Zone>` and `<Panel>` |
| `src/index.ts` | Modify | Exports the four new types |
| `src/focus/successor.policy.test.ts` | Create | Successor policy tri-state + `reason` |
| `src/focus/resolve.policy.test.ts` | Create | Navigation policy precedence + re-entrancy |
| `src/dnd/DragEngine.accept.test.ts` | Create | `acceptPolicy` widening, narrowing, deferring; deprecated veto |
| `src/react/Container.accept.test.tsx` | Create | Props reach the engine from `<Container>` and `<Zone>` |
| `src/react/stories/AcceptPolicy.stories.tsx` | Create | Operable Ladle story |
| `src/react/stories/accept-policy.css` | Create | Its styles (no inline styles) |
| `e2e/accept-policy.spec.ts` | Create | Playwright coverage of that story |

**One correction to the spec.** The spec's React section says `useDropIntentTarget` "widens `canAccept` to the `acceptPolicy` shape." It does not: `useDropIntentTarget` is internal (not exported from `src/react/index.ts`), no caller passes its `canAccept` today, and the deprecated slot still needs a route for `useDropTarget` consumers. It **gains** `acceptPolicy` and `edgeScroll`; its existing `canAccept` is left alone.

---

## Task 1: Successor policy

**Files:**
- Modify: `src/focus/successor.ts`
- Modify: `src/throttle.ts:111-114` (`StoreOptions`)
- Modify: `src/store.ts:147-159` (constructor), `src/store.ts:1125-1136` (`succeedFocus`)
- Modify: `src/index.ts:60`
- Test: `src/focus/successor.policy.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/focus/successor.policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import type { SuccessorInput } from './successor.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

function row(children: string[], policy?: (ctx: SuccessorInput) => NodeId | null | undefined) {
  const s = new Store(policy ? { chooseSuccessor: policy } : {});
  s.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'strip', config: {} }, id: id('z') }),
  );
  for (const c of children) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    s.showNode(id(c));
  }
  return s;
}

describe('successor policy', () => {
  it('an id returned by the policy wins over the built-in', () => {
    // Built-in would take the next sibling, 'c'.
    const s = row(['a', 'b', 'c'], () => id('a'));
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBe(id('a'));
  });

  it('undefined falls through to the built-in', () => {
    const s = row(['a', 'b', 'c'], () => undefined);
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBe(id('c'));
  });

  it('null focuses nobody, deliberately', () => {
    const s = row(['a', 'b', 'c'], () => null);
    s.focusNode(id('b'));
    s.unregisterNode(id('b'));
    expect(s.focusedId).toBeNull();
  });

  it('receives the departing node and the reason', () => {
    const seen: SuccessorInput[] = [];
    const s = row(['a', 'b'], (ctx) => {
      seen.push(ctx);
      return undefined;
    });
    s.focusNode(id('a'));
    s.hideNode(id('a'));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.departing).toBe(id('a'));
    expect(seen[0]?.reason).toBe('hidden');
    expect(seen[0]?.store).toBe(s);
  });

  it('reports destroyed when the node is unregistered', () => {
    const reasons: string[] = [];
    const s = row(['a', 'b'], (ctx) => {
      reasons.push(ctx.reason);
      return undefined;
    });
    s.focusNode(id('a'));
    s.unregisterNode(id('a'));
    expect(reasons).toEqual(['destroyed']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/focus/successor.policy.test.ts`
Expected: FAIL — TypeScript/runtime error, `SuccessorInput` is not exported from `./successor.js` and `StoreOptions` has no `chooseSuccessor`.

- [ ] **Step 3: Add the policy types to `src/focus/successor.ts`**

Append to the file (keep the existing `chooseSuccessor` export exactly as it is — its `(store, departing)` signature is public and does not change):

```ts
/**
 * What `Store` is doing to `departing` when it asks. A consumer plausibly
 * wants a different successor on destroy than on hide.
 */
export interface SuccessorInput {
  store: Store;
  departing: NodeId;
  reason: 'destroyed' | 'hidden' | 'moved';
}

/**
 * Replaces {@link chooseSuccessor}. Return an id to choose it, `null` to focus
 * nobody deliberately, or `undefined` to let the built-in decide.
 */
export type SuccessorPolicy = (ctx: SuccessorInput) => NodeId | null | undefined;
```

- [ ] **Step 4: Add the field to `StoreOptions`**

In `src/throttle.ts`, add the type-only import at the top of the file (type-only, because `focus/successor.ts` imports `store.js` which imports this file — the cycle is erased at compile time and a value import would not be):

```ts
import type { SuccessorPolicy } from './focus/successor.js';
```

and extend the interface at `src/throttle.ts:111`:

```ts
export interface StoreOptions {
  throttle?: ThrottlePolicy;
  clock?: Clock;
  /** Replaces the built-in focus-successor rule. See {@link SuccessorPolicy}. */
  chooseSuccessor?: SuccessorPolicy;
}
```

- [ ] **Step 5: Hold and consult it in `Store`**

In `src/store.ts`, add to the imports:

```ts
import type { SuccessorPolicy } from './focus/successor.js';
```

Add a field beside the other private state around `src/store.ts:145`:

```ts
  private readonly successorPolicy: SuccessorPolicy | undefined;
```

Assign it as the first statement of the constructor at `src/store.ts:147`:

```ts
  constructor(options: StoreOptions = {}) {
    this.successorPolicy = options.chooseSuccessor;
    this.publisher = new Publisher({
```

Then rewrite `succeedFocus` (`src/store.ts:1125`) — only the `const to` line changes:

```ts
  private succeedFocus(from: NodeId, reason: 'destroyed' | 'hidden' | 'moved'): void {
    if (this.focusedIdValue !== from) return;
    const chosen = this.successorPolicy?.({ store: this, departing: from, reason });
    const to = chosen === undefined ? chooseSuccessor(this, from) : chosen;
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

- [ ] **Step 6: Export the types**

In `src/index.ts`, replace line 60:

```ts
export {
  chooseSuccessor,
  type SuccessorInput,
  type SuccessorPolicy,
} from './focus/successor.js';
```

- [ ] **Step 7: Run the new test and the existing successor test**

Run: `npx vitest run src/focus/successor.policy.test.ts src/focus/successor.test.ts`
Expected: PASS — 5 new tests plus the 5 existing ones. The existing file constructs `new Store()` with no policy, so every case there must still pass unchanged.

- [ ] **Step 8: Commit**

Invoke `prepare-js-commit` first, then:

```bash
git add src/focus/successor.ts src/focus/successor.policy.test.ts src/throttle.ts src/store.ts src/index.ts
git commit -m "$(cat <<'EOF'
let a consumer replace the focus-successor rule

StoreOptions takes a chooseSuccessor policy beside throttle and clock.
It receives the reason succeedFocus already had and discarded, so a
consumer can pick a different successor on destroy than on hide.
Returning undefined falls through to the built-in, which keeps its
existing exported signature.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Navigation policy and the re-entrancy guard

**Files:**
- Modify: `src/focus/resolve.ts:77-129`
- Modify: `src/throttle.ts` (`StoreOptions`)
- Modify: `src/store.ts` (constructor + a public readonly field)
- Modify: `src/index.ts:59`
- Test: `src/focus/resolve.policy.test.ts` (create)

**Why the hook goes inside `resolveNavigation` and not at its callers:** it already takes `store` as an input, so it can read the policy off it. `resolveMove` (`src/move.ts:47`) and `FocusProvider` (`src/react/focus/FocusProvider.tsx:222`) then both pick up the policy with no edit, and so does any caller added later.

- [ ] **Step 1: Write the failing test**

Create `src/focus/resolve.policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import type { LayoutStrategy } from '../layout-types.js';
import { resolveMove } from '../move.js';
import { asNodeId, type NodeId } from '../node.js';
import { Store } from '../store.js';
import { resolveNavigation } from './resolve.js';
import type { NavigationPolicy } from './resolve.js';
import type { GeometrySource } from './types.js';

function id(s: string): NodeId {
  return asNodeId(s);
}

/** Three panels in a row: a | b | c. The strategy always answers 'c'. */
function scene(policy?: NavigationPolicy) {
  const store = new Store(policy ? { resolveNavigation: policy } : {});
  store.registerNode(
    createNode({ kind: 'zone', container: { strategyId: 'custom', config: {} }, id: id('z') }),
  );
  store.showNode(id('z'));
  for (const c of ['a', 'b', 'c']) {
    store.registerNode(createNode({ kind: 'panel', focus: true, id: id(c), parentId: id('z') }));
    store.showNode(id(c));
  }
  const map: Record<string, { x: number; y: number; w: number; h: number }> = {
    a: { x: 0, y: 0, w: 100, h: 100 },
    b: { x: 110, y: 0, w: 100, h: 100 },
    c: { x: 220, y: 0, w: 100, h: 100 },
  };
  const geometry: GeometrySource = { rectOf: (nid) => map[nid] ?? null };
  const strategy: LayoutStrategy = {
    name: 'custom',
    layout: () => ({ placements: new Map(), affordances: [] }),
    navigate: () => 'c',
  };
  const strategies = new Map([['custom', strategy]]);
  return { store, geometry, strategies };
}

describe('resolveNavigation — consumer policy', () => {
  it('pre-empts strategy.navigate', () => {
    const { store, geometry, strategies } = scene(() => id('a'));
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies })).toBe(
      id('a'),
    );
  });

  it('undefined falls through to strategy.navigate', () => {
    const { store, geometry, strategies } = scene(() => undefined);
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies })).toBe(
      id('c'),
    );
  });

  it('null stops the search before the strategy is asked', () => {
    const { store, geometry, strategies } = scene(() => null);
    expect(
      resolveNavigation({ store, from: id('a'), intent: 'right', geometry, strategies }),
    ).toBeNull();
  });

  it('with no strategy, undefined falls through to geometry', () => {
    const { store, geometry } = scene(() => undefined);
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('b'));
  });

  it('sees the whole ResolveInput, including the intent', () => {
    const intents: string[] = [];
    const { store, geometry } = scene((input) => {
      intents.push(input.intent);
      return undefined;
    });
    resolveNavigation({ store, from: id('a'), intent: 'cycleNext', geometry });
    expect(intents).toEqual(['cycleNext']);
  });

  it('a policy that calls resolveNavigation terminates instead of recursing', () => {
    let depth = 0;
    const { store, geometry } = scene((input) => {
      depth++;
      // The re-entrant call must skip the policy and answer from the built-in.
      return resolveNavigation(input);
    });
    expect(resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toBe(id('b'));
    expect(depth).toBe(1);
  });

  it('the flag resets after a policy throws', () => {
    const { store, geometry } = scene(() => {
      throw new Error('boom');
    });
    expect(() => resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toThrow(
      'boom',
    );
    // A second call must consult the policy again, not silently skip it.
    expect(() => resolveNavigation({ store, from: id('a'), intent: 'right', geometry })).toThrow(
      'boom',
    );
  });

  it('resolveMove honors the policy without being changed to', () => {
    const { store, geometry } = scene(() => id('c'));
    const plan = resolveMove({ store, from: id('a'), direction: 'right', geometry });
    expect(plan).toEqual({ kind: 'reorder', id: id('a'), parentId: id('z'), at: 2 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/focus/resolve.policy.test.ts`
Expected: FAIL — `NavigationPolicy` is not exported and `StoreOptions` has no `resolveNavigation`.

- [ ] **Step 3: Split `builtinResolve` out and add the guard**

In `src/focus/resolve.ts`, rename the existing exported `resolveNavigation` function (`src/focus/resolve.ts:77`) to `builtinResolve` and drop its `export`. The body — the whole `switch` over `intent` — is unchanged; only the signature line changes:

```ts
function builtinResolve({ store, from, intent, geometry, strategies }: ResolveInput): NodeId | null {
```

Then add, after it:

```ts
/**
 * Replaces the built-in navigation resolution. Return an id to choose it,
 * `null` to refuse the move, or `undefined` to fall through to
 * `strategy.navigate` and then to geometry.
 */
export type NavigationPolicy = (input: ResolveInput) => NodeId | null | undefined;

/** A policy that calls back into `resolveNavigation` would otherwise recurse
 *  forever; the re-entrant call answers from the built-in instead. */
let consultingPolicy = false;

export function resolveNavigation(input: ResolveInput): NodeId | null {
  if (consultingPolicy) return builtinResolve(input);
  const policy = input.store.navigationPolicy;
  if (!policy) return builtinResolve(input);
  let chosen: NodeId | null | undefined;
  consultingPolicy = true;
  try {
    chosen = policy(input);
  } catch (err) {
    trace('focus', `navigation policy threw, using built-in: ${err}`);
    chosen = undefined;
  } finally {
    consultingPolicy = false;
  }
  if (chosen && !input.store.getNode(chosen)) {
    trace('focus', `navigation policy returned unknown ${chosen}, using built-in`);
    chosen = undefined;
  }
  if (chosen !== undefined) return chosen;
  return builtinResolve(input);
}
```

Two things here, both load-bearing:

- **The `finally` resets the flag even when the policy throws**, or one bad call silently disables the policy for the rest of the session. Keep the flag reset in `finally` and the fall-through *outside* the `try`, so `builtinResolve` does not run while the flag is set.
- **`chosen &&` deliberately lets `null` through unvalidated.** `null` is the deliberate "refuse the move" answer and must keep working; only a returned id is checked.

`focus` is not currently a trace category. Check the `TRACE_CATEGORIES` tuple in `src/trace.ts` — if it is absent, use `workspace`, which is what `move.ts` already traces navigation under. Do not add a category for this.

**Report back on one thing you must check rather than assume:** `FocusProvider` (`src/react/focus/FocusProvider.tsx:222`) calls `focusNode(to)` with this result, and `focusNode` throws `CapabilityMissingError` for a node with no `focus` capability. Validating "is a known node" prevents `NodeNotFoundError` but not that. Read the call site, decide whether the guard needs to require focusability too, and say what you found and what you chose — do not silently pick one.

- [ ] **Step 4: Add the field to `StoreOptions` and expose it on `Store`**

In `src/throttle.ts`, add the type-only import and the field:

```ts
import type { NavigationPolicy } from './focus/resolve.js';
```

```ts
export interface StoreOptions {
  throttle?: ThrottlePolicy;
  clock?: Clock;
  /** Replaces the built-in focus-successor rule. See {@link SuccessorPolicy}. */
  chooseSuccessor?: SuccessorPolicy;
  /** Replaces the built-in navigation resolution. See {@link NavigationPolicy}. */
  resolveNavigation?: NavigationPolicy;
}
```

In `src/store.ts`, add the import:

```ts
import type { NavigationPolicy } from './focus/resolve.js';
```

Add a **public** readonly field beside `successorPolicy` — `resolve.ts` is a different module and cannot read a private one. It reads back exactly what the consumer passed, so it exposes nothing new:

```ts
  /** The navigation policy this store was constructed with, read by
   *  `resolveNavigation`. */
  readonly navigationPolicy: NavigationPolicy | undefined;
```

and assign it in the constructor beside the other:

```ts
  constructor(options: StoreOptions = {}) {
    this.successorPolicy = options.chooseSuccessor;
    this.navigationPolicy = options.resolveNavigation;
    this.publisher = new Publisher({
```

- [ ] **Step 5: Export the type**

In `src/index.ts`, replace line 59:

```ts
export {
  type NavigationPolicy,
  type ResolveInput,
  resolveNavigation,
} from './focus/resolve.js';
```

- [ ] **Step 6: Run the new test plus every existing navigation test**

Run: `npx vitest run src/focus/`
Expected: PASS — 8 new tests, and `resolve.test.ts`, `resolve.override.test.ts`, `resolve.cross-root.test.ts`, `navigable.test.ts`, `successor*.test.ts` all still green. A store with no policy must take the `if (!policy) return builtinResolve(input)` line, so nothing there changes behavior.

- [ ] **Step 7: Commit**

Invoke `prepare-js-commit` first, then:

```bash
git add src/focus/resolve.ts src/focus/resolve.policy.test.ts src/throttle.ts src/store.ts src/index.ts
git commit -m "$(cat <<'EOF'
let a consumer replace directional navigation

StoreOptions takes a resolveNavigation policy, consulted ahead of
strategy.navigate and the geometric fallback. The hook sits inside
resolveNavigation rather than at its two call sites, so resolveMove and
FocusProvider pick it up unchanged and so does any later caller.

A policy that calls resolveNavigation would recurse; the re-entrant call
answers from the built-in instead.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `acceptPolicy` on the drop target

**Files:**
- Modify: `src/dnd/DragEngine.ts:44-60` (`DropTarget`), `src/dnd/DragEngine.ts:332-374` (`checkAccept`)
- Modify: `src/index.ts` (export `AcceptContext`)
- Test: `src/dnd/DragEngine.accept.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/dnd/DragEngine.accept.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, type LayoutStrategy, type Rect, Store } from '../index.js';
import { type AcceptContext, DragEngine, type DropTarget } from './DragEngine.js';

/** Refuses anything past 2 items — stands in for a strip at its maxItems cap. */
const exactlyTwoStrategy: LayoutStrategy<unknown, string, unknown> = {
  name: 'exactly-two',
  canAccept: (items) => items.length <= 2,
  layout: () => ({ placements: new Map(), affordances: [] }),
};

const SQUARE: Rect = { x: 0, y: 0, w: 100, h: 100 };

function at(rect: Rect, extra: Partial<DropTarget> = {}): DropTarget {
  return { bounds: () => rect, ...extra };
}

/** z2 already holds two panels, so the strategy refuses a third. */
function fullStore(): Store {
  const s = new Store();
  for (const z of ['z1', 'z2']) {
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'exactly-two', config: {} },
        id: asNodeId(z),
      }),
    );
  }
  for (const [p, parent] of [
    ['p', 'z1'],
    ['a', 'z2'],
    ['b', 'z2'],
  ] as const) {
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId(p), parentId: asNodeId(parent) }),
    );
  }
  return s;
}

function engineWith(s: Store, target: Partial<DropTarget>): DragEngine {
  const e = new DragEngine(s, { getStrategy: () => exactlyTwoStrategy });
  e.addDropTarget(asNodeId('z2'), at(SQUARE, target));
  e.tryBegin(asNodeId('p'));
  e.updateHoverByPoint(50, 50);
  return e;
}

describe('DragEngine — acceptPolicy', () => {
  it('true overrides a strategy rejection', () => {
    const e = engineWith(fullStore(), { acceptPolicy: () => true });
    expect(e.state()?.hover?.accepted).toBe(true);
  });

  it('undefined defers to the strategy, which refuses', () => {
    const e = engineWith(fullStore(), { acceptPolicy: () => undefined });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('false rejects even where the strategy would accept', () => {
    const s = new Store();
    for (const z of ['z1', 'z2']) {
      s.registerNode(
        createNode({
          kind: 'zone',
          container: { strategyId: 'exactly-two', config: {} },
          id: asNodeId(z),
        }),
      );
    }
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId('p'), parentId: asNodeId('z1') }),
    );
    const e = engineWith(s, { acceptPolicy: () => false });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('sees the prospective post-drop child list and the container config', () => {
    const seen: AcceptContext[] = [];
    engineWith(fullStore(), {
      acceptPolicy: (ctx) => {
        seen.push(ctx);
        return true;
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.items.map((i) => i.id)).toEqual(['a', 'b', 'p']);
    expect(seen[0]?.sourceId).toBe('p');
    expect(seen[0]?.options).toEqual({});
  });

  it('lock.accept still refuses, whatever the policy says', () => {
    const s = fullStore();
    s.setLock(asNodeId('z2'), { accept: true });
    const e = engineWith(s, { acceptPolicy: () => true });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('the deprecated canAccept still vetoes after the policy accepted', () => {
    const e = engineWith(fullStore(), { acceptPolicy: () => true, canAccept: () => false });
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('a policy that throws defers to the strategy instead of killing the drag', () => {
    const e = engineWith(fullStore(), {
      acceptPolicy: () => {
        throw new Error('boom');
      },
    });
    // fullStore's z2 is at the exactly-two cap, so the strategy refuses.
    expect(e.state()?.hover?.accepted).toBe(false);
  });

  it('is not called when the target has no policy', () => {
    // Regression guard for the hot path: no policy and no strategy means the
    // prospective child list is never built.
    const s = new Store();
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'stack', config: {} }, id: asNodeId('z1') }),
    );
    s.registerNode(
      createNode({ kind: 'zone', container: { strategyId: 'stack', config: {} }, id: asNodeId('z2') }),
    );
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId('p'), parentId: asNodeId('z1') }),
    );
    const e = new DragEngine(s);
    e.addDropTarget(asNodeId('z2'), at(SQUARE));
    e.tryBegin(asNodeId('p'));
    e.updateHoverByPoint(50, 50);
    expect(e.state()?.hover?.accepted).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/dnd/DragEngine.accept.test.ts`
Expected: FAIL — `AcceptContext` is not exported and `DropTarget` has no `acceptPolicy`.

If `DragEngine`'s constructor options or `store.setLock` do not match the shapes used above, read `src/dnd/DragEngine.test.ts` and `src/react/lock.test.tsx` and correct the test to the real API before proceeding — the assertions are what matter, not the scaffolding.

- [ ] **Step 3: Add the types to `src/dnd/DragEngine.ts`**

Above the `DropTarget` interface (`src/dnd/DragEngine.ts:44`):

```ts
/** What a drop target's `acceptPolicy` is asked about: the child list the
 *  container would have after the drop, exactly as `strategy.canAccept` sees
 *  it, plus who is being dropped. */
export interface AcceptContext {
  items: { id: NodeId }[];
  options: Record<string, unknown>;
  sourceId: NodeId;
}
```

and inside `DropTarget`, replace the `canAccept` line with:

```ts
  /**
   * @deprecated Removed at 2.0.0. Use `acceptPolicy`, which can widen a
   * strategy's answer as well as narrow it.
   */
  canAccept?(sourceId: NodeId): boolean;
  /** Replaces `strategy.canAccept` for this target. `true` accepts even where
   *  the strategy would refuse, `false` refuses, `undefined` defers to it. */
  acceptPolicy?(ctx: AcceptContext): boolean | undefined;
```

- [ ] **Step 4: Rewrite `checkAccept`**

Replace `src/dnd/DragEngine.ts:332-374` — everything from `const targetNode` to the closing `return true;` — with:

```ts
    const targetNode = this.store.getNode(targetId);
    if (this.store.isLocked(targetId, 'accept')) {
      trace('dnd', `checkAccept ${targetId}: REJECT (lock.accept)`);
      return false;
    }

    const target = this.dropTargets.get(targetId);
    const container = targetNode?.container;
    const strategy =
      container && this.getStrategy ? this.getStrategy(container.strategyId) : undefined;

    // Building the prospective child list is O(children) on the pointermove
    // path, so only pay for it when something will actually read it.
    if (target?.acceptPolicy || strategy?.canAccept) {
      const current = this.store
        .getChildren(targetId)
        .filter((c) => c.lifecycle.state !== 'destroyed');
      const alreadyChild = current.some((c) => c.id === draggingId);
      const items = alreadyChild
        ? current.map((c) => ({ id: c.id }))
        : [...current.map((c) => ({ id: c.id })), { id: draggingId }];
      const options = (container?.config ?? {}) as Record<string, unknown>;

      let verdict: boolean | undefined;
      try {
        verdict = target?.acceptPolicy?.({ items, options, sourceId: draggingId });
      } catch (err) {
        // A policy that throws must not kill the drag; the strategy decides.
        trace('dnd', `checkAccept ${targetId}: acceptPolicy threw, deferring: ${err}`);
        verdict = undefined;
      }
      if (verdict === false) {
        trace('dnd', `checkAccept ${targetId}: REJECT (acceptPolicy said no)`);
        return false;
      }
      if (verdict === undefined && strategy?.canAccept && !strategy.canAccept(items, options)) {
        trace(
          'dnd',
          `checkAccept ${targetId}: REJECT (strategy ${strategy.name}.canAccept said no for ${items.length} items)`,
        );
        return false;
      }
      if (verdict === true && strategy?.canAccept) {
        trace('dnd', `checkAccept ${targetId}: acceptPolicy overrode ${strategy.name}.canAccept`);
      }
    }

    if (target?.canAccept && !target.canAccept(draggingId)) {
      trace('dnd', `checkAccept ${targetId}: REJECT (consumer canAccept said no)`);
      return false;
    }
    return true;
```

- [ ] **Step 5: Export the type**

In `src/index.ts`, add `type AcceptContext,` to the existing `./dnd/DragEngine.js` export block (the one ending at line 29), keeping the block alphabetized as Biome expects.

- [ ] **Step 6: Run the new test and every existing drag test**

Run: `npx vitest run src/dnd/`
Expected: PASS — 7 new tests, plus `DragEngine.test.ts`, `DragEngine.intent.test.ts`, `DragController.test.ts` and the rest unchanged. `DragEngine.test.ts:115` asserts the deprecated `canAccept` still rejects; that must stay green.

- [ ] **Step 7: Commit**

Invoke `prepare-js-commit` first, then:

```bash
git add src/dnd/DragEngine.ts src/dnd/DragEngine.accept.test.ts src/index.ts
git commit -m "$(cat <<'EOF'
let a drop target override its strategy's acceptance

A target's canAccept could only narrow: a container at its strategy's
item cap stayed unacceptable however the consumer answered. acceptPolicy
is tri-state over the same prospective child list the strategy sees, so
true widens, false refuses and undefined defers. lock.accept still wins
unconditionally.

canAccept is deprecated and removed at 2.0.0. Building the child list
stays guarded on a policy or a strategy existing, since checkAccept runs
on every pointermove.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Forward both through the React drag plumbing

**Files:**
- Modify: `src/dnd/DragController.ts:27-42` (`DropTargetOptions`), `src/dnd/DragController.ts:136-160` (`registerDropTarget`)
- Modify: `src/react/dnd/useDropIntentTarget.ts:30-41` (options), `:87-95` (registration), `:110-125` (deps)

`DragController.registerDropTarget` already forwards `options.edgeScroll` into the scroll bag (`src/dnd/DragController.ts:157`), so edge-scroll needs nothing here beyond the hook accepting it.

- [ ] **Step 1: Add `acceptPolicy` to `DropTargetOptions`**

In `src/dnd/DragController.ts`, extend the import at line 14 to bring in the context type, then add to the interface:

```ts
  /** Overrides `strategy.canAccept` for this target. See `DropTarget.acceptPolicy`. */
  acceptPolicy?: (ctx: AcceptContext) => boolean | undefined;
```

and forward it in `registerDropTarget`, beside the existing `canAccept` spread:

```ts
      ...(canAccept ? { canAccept } : {}),
      ...(options?.acceptPolicy ? { acceptPolicy: options.acceptPolicy } : {}),
```

- [ ] **Step 2: Accept both in `useDropIntentTarget`**

In `src/react/dnd/useDropIntentTarget.ts`, add to `DropIntentTargetOptions` (beside the existing `canAccept` at line 40):

```ts
  acceptPolicy?: ((ctx: AcceptContext) => boolean | undefined) | undefined;
  /** Ramp shape for edge scrolling. Inert without `scrollRef`. */
  edgeScroll?: EdgeScrollOptions | undefined;
```

with the type imports:

```ts
import type { AcceptContext } from '../../dnd/DragEngine.js';
import type { EdgeScrollOptions } from '../../dnd/edgeScroll.js';
```

Destructure both from `opts`, then pass them in the `registerDropTarget` call at line 87:

```ts
    return controller.registerDropTarget(parentId, el, canAccept, {
      scrollEl: scrollRef?.current ?? null,
      ...(acceptPolicy ? { acceptPolicy } : {}),
      ...(edgeScroll ? { edgeScroll } : {}),
      getDropIntent: (point) => {
```

and add `acceptPolicy` and `edgeScroll` to the effect's dependency array.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. No test yet — Task 5 exercises this path end to end.

- [ ] **Step 4: Commit**

Invoke `prepare-js-commit` first, then:

```bash
git add src/dnd/DragController.ts src/react/dnd/useDropIntentTarget.ts
git commit -m "$(cat <<'EOF'
route acceptPolicy and edgeScroll to the drop target

DropTargetOptions already carried edgeScroll and never reached it from
React; useDropIntentTarget hardcoded scrollEl and getDropIntent. Both
options now travel from the hook to the engine.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<Container canAccept>` and `<Container edgeScroll>`

**Files:**
- Modify: `src/react/Container.tsx` — props interface near `:94-101`, destructuring near `:208-221`, hook call at `:284-292`
- Test: `src/react/Container.accept.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `src/react/Container.accept.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { asNodeId, createNode, Store } from '../index.js';
import type { AcceptContext } from '../index.js';
import { Container } from './Container.js';
import { DragProvider } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';

function storeWithRow(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { maxItems: 2 } },
      id: asNodeId('z'),
    }),
  );
  s.showNode(asNodeId('z'));
  for (const p of ['a', 'b']) {
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: asNodeId(p), parentId: asNodeId('z') }),
    );
    s.showNode(asNodeId(p));
  }
  return s;
}

describe('<Container canAccept>', () => {
  it('reaches the drop target as an acceptPolicy', () => {
    const s = storeWithRow();
    const seen: AcceptContext[] = [];
    render(
      <Provider store={s}>
        <DragProvider>
          <Container parentId={asNodeId('z')} viewport={{ w: 300, h: 100 }} canAccept={(ctx) => {
            seen.push(ctx);
            return true;
          }} />
        </DragProvider>
      </Provider>,
    );
    // The policy is registered, not yet called — no drag is in flight.
    expect(seen).toHaveLength(0);
  });
});
```

**This test is a scaffold, not the real assertion.** Registering a policy and never dragging proves nothing. Before writing it, read `src/react/container.dropIntent.test.tsx` — it already drives a drag through `<Container>` in jsdom — and copy its drag-driving helper so this file asserts what actually matters:

1. A `<Container>` on a `strip` with `config: { maxItems: 2 }` holding two panels **rejects** a third with no `canAccept`.
2. The same container with `canAccept={() => true}` **accepts** it.
3. With `canAccept={() => false}` on a container under its cap, it **rejects**.
4. With `canAccept={() => undefined}`, behavior matches case 1.
5. The `ctx` the prop receives carries `items` of length 3 and `options.maxItems === 2`.

Write those five, not the scaffold.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/react/Container.accept.test.tsx`
Expected: FAIL — `<Container>` has no `canAccept` prop.

- [ ] **Step 3: Add both props**

In `src/react/Container.tsx`, add to `ContainerProps` beside `scrollRef` (`:101`):

```ts
  /**
   * Decide whether this container accepts a drop, overriding the strategy's
   * own `canAccept`. `true` accepts where the strategy would refuse, `false`
   * refuses, `undefined` defers to it. A `lock.accept` refuses regardless.
   *
   * Runs on every drag `pointermove` — keep it O(items.length) or smaller.
   */
  canAccept?: (ctx: AcceptContext) => boolean | undefined;
  /** Ramp shape for edge scrolling during a drag. Inert without `scrollRef`. */
  edgeScroll?: EdgeScrollOptions;
```

with the type imports:

```ts
import type { AcceptContext } from '../dnd/DragEngine.js';
import type { EdgeScrollOptions } from '../dnd/edgeScroll.js';
```

Destructure both in the component signature beside `dropIntent` (`:221`), then extend the `useDropIntentTarget` call (`:284`):

```ts
  useDropIntentTarget(parentId, ref, {
    ...(containerCfg.axis ? { axis: containerCfg.axis } : {}),
    ...(parent?.container?.strategyId ? { strategyId: parent.container.strategyId } : {}),
    isFlow,
    stackOnDrop,
    splitOnDrop,
    ...(dropIntent ? { dropIntent } : {}),
    ...(scrollRef ? { scrollRef } : {}),
    ...(canAccept ? { acceptPolicy: canAccept } : {}),
    ...(edgeScroll ? { edgeScroll } : {}),
  });
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/react/Container.accept.test.tsx`
Expected: PASS — all five cases.

- [ ] **Step 5: Run the whole React suite**

Run: `npx vitest run src/react/`
Expected: PASS. Nothing else passes `canAccept`, so no existing behavior moves.

- [ ] **Step 6: Commit**

Invoke `prepare-js-commit` first, then:

```bash
git add src/react/Container.tsx src/react/Container.accept.test.tsx
git commit -m "$(cat <<'EOF'
give Container a canAccept and an edgeScroll prop

Per-container acceptance was only expressible through a strategy, which
is per-strategy, or lock.accept, which is all or nothing. edgeScroll's
rate and threshold were unreachable from React at all.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The same two on `<Zone>` and `<Panel>`

**Files:**
- Modify: `src/react/presets.tsx` — shared props near `:69-71`, `PresetShellProps.drop` at `:616-627`, `PresetShell`'s hook call at `:664-671`, and the three `drop={{…}}` sites at `:266-270`, `:454-458`, `:549-554`
- Test: extend `src/react/Container.accept.test.tsx`

This is the path 1.3.0 used to carry `stackOnDrop` / `splitOnDrop` / `dropIntent` through the presets — follow it exactly.

- [ ] **Step 1: Write the failing test**

Append to `src/react/Container.accept.test.tsx` a `describe('<Zone canAccept>')` block mirroring cases 1, 2 and 5 from Task 5, but rendering:

```tsx
<Zone id="z" acceptsDrops strategy="strip" config={{ maxItems: 2 }} canAccept={…}>
```

Read `src/react/presets.dropIntent.test.tsx` for the exact `<Zone>` prop spelling this repo uses for strategy and config — do not guess it — and match that file's drag-driving setup.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/react/Container.accept.test.tsx`
Expected: FAIL on the new block — `<Zone>` has no `canAccept` prop.

- [ ] **Step 3: Add the props to the shared preset prop type**

In `src/react/presets.tsx`, beside the `dropIntent` declaration at `:69`:

```ts
  /** Override this preset's drop acceptance — the callback `<Container canAccept>`
   *  takes. Runs on every drag `pointermove`. */
  canAccept?: (ctx: AcceptContext) => boolean | undefined;
  /** Ramp shape for edge scrolling during a drag. */
  edgeScroll?: EdgeScrollOptions;
```

with the matching `import type` lines.

- [ ] **Step 4: Carry them through `PresetShell`**

Extend the `drop` bag type at `:616`:

```ts
        canAccept?: ((ctx: AcceptContext) => boolean | undefined) | undefined;
        edgeScroll?: EdgeScrollOptions | undefined;
```

and the hook call at `:664`:

```ts
  useDropIntentTarget(id, wrapperRef, {
    enabled: acceptsDrops === true,
    ...(ownAxis ? { axis: ownAxis } : {}),
    ...(ownContainer?.strategyId ? { strategyId: ownContainer.strategyId } : {}),
    isFlow: !drop?.hostsLayout,
    ...(drop?.stackOnDrop ? { stackOnDrop: drop.stackOnDrop } : {}),
    ...(drop?.splitOnDrop ? { splitOnDrop: drop.splitOnDrop } : {}),
    ...(drop?.dropIntent ? { dropIntent: drop.dropIntent } : {}),
    ...(drop?.canAccept ? { acceptPolicy: drop.canAccept } : {}),
    ...(drop?.edgeScroll ? { edgeScroll: drop.edgeScroll } : {}),
  });
```

- [ ] **Step 5: Fill the bag at all three call sites**

At `src/react/presets.tsx:266` (`Panel`), `:454` (`Zone`) and `:549` (`ZoneWithLayout`), add the same two lines to each `drop={{…}}` literal:

```tsx
        ...(props.canAccept ? { canAccept: props.canAccept } : {}),
        ...(props.edgeScroll ? { edgeScroll: props.edgeScroll } : {}),
```

All three. Missing one leaves a preset silently ignoring the prop — the exact failure mode this task exists to remove.

- [ ] **Step 6: Run the React suite**

Run: `npx vitest run src/react/`
Expected: PASS, including the new `<Zone>` block and every existing preset test.

- [ ] **Step 7: Commit**

Invoke `prepare-js-commit` first, then:

```bash
git add src/react/presets.tsx src/react/Container.accept.test.tsx
git commit -m "$(cat <<'EOF'
expose canAccept and edgeScroll on Zone and Panel

The declarative presets are the documented front door, so a policy only
Container could take was a policy most consumers could not reach.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Ladle story and e2e coverage

**Files:**
- Create: `src/react/stories/AcceptPolicy.stories.tsx`
- Create: `src/react/stories/accept-policy.css`
- Create: `e2e/accept-policy.spec.ts`

Per `CLAUDE.md`, every feature ships with an operable story in the same change — the Playwright suite drives Ladle, so a capability with no story has no browser coverage.

- [ ] **Step 1: Read the two files you are modeling on**

Read `src/react/stories/DropOnEdge.stories.tsx` and `src/react/stories/drop-on-edge.css` for the story shape this repo uses (store construction, `<DragProvider>`, `data-testid` conventions), and `e2e/drag.spec.ts` plus `e2e/fixtures.ts` for `openStory` and `settledBox`.

- [ ] **Step 2: Write the story**

`AcceptPolicy.stories.tsx` renders two zones side by side, both `strip` with `config: { maxItems: 2 }`, both holding two draggable panels:

- **Left zone** — no `canAccept`. At its cap, so it refuses a third panel.
- **Right zone** — `canAccept={(ctx) => (ctx.items.length <= 3 ? true : undefined)}`, so it accepts a third and refuses a fourth.

Every panel carries `data-testid`. The zones carry `data-testid="zone-strict"` and `data-testid="zone-lenient"`. No inline styles — everything through `accept-policy.css`.

Operable, not merely rendered: the panels must be draggable via `<DragHandle>` so Playwright can actually attempt both drops.

- [ ] **Step 3: Verify it by hand**

Run: `npm run ladle` and open the story. Drag a left-zone panel onto the right zone — it lands. Drag one onto the left zone from the right — it is refused. Stop Ladle before continuing.

- [ ] **Step 4: Write the e2e spec**

`e2e/accept-policy.spec.ts`, using `openStory` and `settledBox` from `e2e/fixtures.ts`:

```ts
test('a lenient zone takes a drop its strategy would refuse', async ({ page }) => {
  // drag panel from zone-strict onto zone-lenient; assert it became a child
});

test('a strict zone still refuses at its cap', async ({ page }) => {
  // drag the other way; assert child counts are unchanged
});
```

Poll geometry with `settledBox` — never read a box straight after a gesture. `TODO.md`'s test-harness section explains why: a rect read mid-settle is a frame of the animation, and reads as "the gesture did nothing."

- [ ] **Step 5: Run it on all three engines**

Run: `npx playwright test e2e/accept-policy.spec.ts`
Expected: PASS on chromium, firefox and webkit. Playwright starts Ladle itself.

If it fails on one engine only, check for another worktree's dev server on port 61000 before assuming a real failure.

- [ ] **Step 6: Commit**

Invoke `prepare-js-commit` first, then:

```bash
git add src/react/stories/AcceptPolicy.stories.tsx src/react/stories/accept-policy.css e2e/accept-policy.spec.ts
git commit -m "$(cat <<'EOF'
drive an overridden drop acceptance from the browser

Two strips at the same maxItems cap, one of which overrides it. Covers
the gesture jsdom cannot: a real pointer crossing a real refusal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Documentation

**Files:**
- Modify: `CHANGELOG.md` (under `## Unreleased`)
- Modify: `README.md`
- Modify: `TODO.md` (remove the closed section)

- [ ] **Step 1: Add the CHANGELOG entry**

Under `## Unreleased`, in an `### Added` section (create it above the existing `### Changed`):

```markdown
- **Four hardcoded policies are now replaceable.** Each was exported and then called from
  exactly one site, so a consumer wanting a different rule could only re-implement it and
  correct the result afterward.

  `new Store({ chooseSuccessor, resolveNavigation })` replaces who takes focus when the focused
  node goes away and how a direction resolves to a node. `<Container canAccept>` — and the same
  prop on `<Zone>` and `<Panel>` — overrides whether a container takes a drop, and can now widen
  a strategy's answer as well as narrow it: a `strip` at its `maxItems` cap can be made to accept
  anyway. `<Container edgeScroll>` reaches the rate and threshold that were previously unreachable
  from React.

  Every one is tri-state — return `undefined` and the built-in decides — so changing one case is
  a three-line callback rather than a reimplementation. `lock.accept` still refuses regardless;
  a lock is not a policy.
```

Then, under `### Changed`, note the deprecation:

```markdown
- **`DropTarget.canAccept` is deprecated**, removed at 2.0.0. It could only narrow a strategy's
  answer. `acceptPolicy` replaces it and still runs it as a trailing veto until then, so nothing
  breaks now.
```

- [ ] **Step 2: Document the props in the README**

Add `canAccept` and `edgeScroll` to the `<Container>` prop table, and the two `StoreOptions`
policies wherever `throttle` and `clock` are documented. Find those sections with:

```bash
grep -n "splitPreview\|scrollRef\|StoreOptions\|throttle" README.md | head -30
```

Match the surrounding density — the README documents props in tables, not prose paragraphs.

- [ ] **Step 3: Close the TODO section**

Delete the whole `## Policies the library exports but nobody can replace [MED]` section from
`TODO.md` (`:163` through the `insertionIndexByMidpoint` paragraph that closes it). All four
entries have shipped. Leave the deliberate-absence note about `insertionIndexByMidpoint` and
`axisFromRects` only if it still says something true elsewhere; it is about `dropIntent`
subsuming them, so move that one sentence into the Drag and drop section rather than deleting it.

- [ ] **Step 4: Verify the changelog check passes**

Run: `bash scripts/check-changelog.sh` (read the script first for its expected arguments)
Expected: clean, with an `Unreleased` section present.

- [ ] **Step 5: Full verification before the final commit**

Run, in order:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: all clean. Do not claim completion on any of these without the output in front of you.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md README.md TODO.md
git commit -m "$(cat <<'EOF'
document the four replaceable policies

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

**Spec coverage.** Successor policy → Task 1. Navigation policy, precedence, re-entrancy guard → Task 2. `acceptPolicy` tri-state, ordering, deprecation, hot-path guard → Task 3. React forwarding → Tasks 4–6. Story and browser coverage → Task 7. The spec's Tests section is distributed across the task that owns each behavior. Nothing in the spec is unimplemented.

**Two places the plan deliberately refuses to hand you finished code**, because guessing at it would be worse than reading the repo: the jsdom drag-driving helper in Tasks 5–6 (copy it from `container.dropIntent.test.tsx`) and the story scaffold in Task 7 (copy it from `DropOnEdge.stories.tsx`). Both are established patterns you must match rather than invent — the assertions and the story's behavior are fully specified, only the boilerplate is by reference.

**Type consistency.** `SuccessorPolicy` / `SuccessorInput` (Task 1), `NavigationPolicy` (Task 2), `AcceptContext` (Task 3) are spelled identically everywhere they appear downstream. The `DropTarget` slot and `DropTargetOptions` field are both `acceptPolicy`; the consumer-facing React prop is `canAccept` on `<Container>`, `<Zone>` and `<Panel>`, mapped to `acceptPolicy` at the `useDropIntentTarget` call. That rename is intentional — `canAccept` reads better as a prop and there is no prop of that name to collide with — and it happens in exactly two places (Task 5 Step 3, Task 6 Step 4).
