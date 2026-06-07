# Declarative JSX tree binding — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `<Provider>`/`<Zone>`/`<Group>`/`<Panel>` register, reconcile, and unregister nodes in the windease store from JSX, so consumers can build trees declaratively while imperative `store.registerNode(...)` keeps working alongside.

**Architecture:** Each preset registers itself into the store **during render** (ref-guarded for idempotence), reads its parent id from a new `ParentContext`, and reconciles its props (meta, placement, hidden, container state) into the store on every render. Each parent preset participates in a `ChildRegistry` so it can collect its JSX child ids and reconcile sibling order via a new bulk `Store.setChildOrder` method, falling back to a default sort that respects an `order?: number` field and otherwise preserves JSX position followed by imperative tail. A custom `sort` prop on container presets fully overrides. `<Container>` becomes a thin convenience that renders JSX children when present and falls back to the existing store-driven chrome dispatch when not.

**Tech Stack:** React 19, TypeScript, Vitest + React Testing Library, Vite/Ladle for the playground story.

**Spec:** `docs/superpowers/specs/2026-06-07-declarative-jsx-binding-design.md`

---

## File map

### Create

- `src/react/ParentContext.tsx` — `ParentContext` (current parent id) + `ChildRegistry` context (mechanism by which a child preset reports its id+order to its parent during render).
- `src/react/useNodeBinding.ts` — internal hook used by every preset: mints id, calls store register/unregister, reconciles props, pushes into parent's ChildRegistry.
- `src/react/presets-declarative.test.tsx` — registration, reconciliation, hidden, Strict Mode.
- `src/react/sibling-order.test.tsx` — JSX order, `order` prop, custom `sort`, mixed JSX+imperative.
- `src/react/nested-presets.test.tsx` — Zone > Panel > Panel nesting via JSX.
- `src/react/collision.test.tsx` — id collisions between JSX and imperative.
- `src/store.setChildOrder.test.ts` — store-level test for the new bulk method.
- `src/react/stories/DeclarativePlayground.stories.tsx` — mixed-provenance Ladle story.

### Modify

- `src/store.ts` — add `setChildOrder(parentId, orderedIds)` bulk reorder method. Add `order?: number` field threading (see Task 2 — read existing Node shape and decide whether `order` lives on the node record or under a reserved key).
- `src/react/presets.tsx` — Panel/Group/Zone gain `id`, `parentId`, `order`, `meta`, `placement`, `hidden`, and (Zone only) `strategyId`, `config`, `viewport`, `state`, `sort` props. Each preset binds to the store and propagates ParentContext.
- `src/react/Provider.tsx` — make `store` prop optional (auto-create via `useState(() => new Store())`); wrap children in the root ParentContext (value `null`) and root ChildRegistry.
- `src/react/Container.tsx` — when `children` are provided, render them directly and skip the chrome dispatch.
- `src/react/index.ts` — export `ParentContext` for advanced consumers; export `defaultChildSort`.
- `src/index.ts` — no new top-level exports (store method is on existing class).
- `src/react/stories/Playground.stories.tsx` — rename file mention in docs; keep imperative story as a reference.
- `README.md` — lead with declarative example; demote imperative to an "Advanced" subsection.
- `package.json` — bump `version` to `0.4.0`.

---

## Task 1: Store — add `setChildOrder` bulk reorder

`reorderInParent(id, at)` is per-node; for the React layer to impose a full sibling order in one shot (atomic, single notification), we need a bulk API.

**Files:**
- Create: `src/store.setChildOrder.test.ts`
- Modify: `src/store.ts` (add method near the existing `reorderInParent`, ~line 329)

- [ ] **Step 1: Write the failing test**

```ts
// src/store.setChildOrder.test.ts
import { describe, expect, it } from 'vitest';
import { Store } from './store.js';
import { createPanel, createZone } from './node-factories.js';

describe('Store.setChildOrder', () => {
  it('applies a full reordering atomically', () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'root' }));
    store.registerNode(createPanel({ id: 'a', parentId: 'root' }));
    store.registerNode(createPanel({ id: 'b', parentId: 'root' }));
    store.registerNode(createPanel({ id: 'c', parentId: 'root' }));

    store.setChildOrder('root', ['c', 'a', 'b']);

    expect(store.getContainerView('root')?.childIds).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op when the order is already correct', () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'root' }));
    store.registerNode(createPanel({ id: 'a', parentId: 'root' }));
    store.registerNode(createPanel({ id: 'b', parentId: 'root' }));

    let notifications = 0;
    store.subscribe(() => notifications++);
    store.setChildOrder('root', ['a', 'b']);

    expect(notifications).toBe(0);
  });

  it('throws if orderedIds is not a permutation of current childIds', () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'root' }));
    store.registerNode(createPanel({ id: 'a', parentId: 'root' }));
    store.registerNode(createPanel({ id: 'b', parentId: 'root' }));

    expect(() => store.setChildOrder('root', ['a'])).toThrow(/permutation/i);
    expect(() => store.setChildOrder('root', ['a', 'b', 'c'])).toThrow(/permutation/i);
    expect(() => store.setChildOrder('root', ['a', 'a'])).toThrow(/permutation/i);
  });

  it('throws when parent has no container capability', () => {
    const store = new Store();
    store.registerNode(createPanel({ id: 'lone' }));
    expect(() => store.setChildOrder('lone', [])).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/store.setChildOrder.test.ts
```

Expected: FAIL — `store.setChildOrder is not a function`.

- [ ] **Step 3: Implement `setChildOrder`**

Insert after the existing `reorderInParent` (around line 360 in `src/store.ts`):

```ts
setChildOrder(parentId: NodeId, orderedIds: readonly NodeId[]): void {
  const parent = this.requireNode(parentId);
  if (!parent.container) {
    throw new InvariantViolationError(
      'parent-not-container',
      `parent ${parentId} has no container`,
      { parentId },
    );
  }
  const current = parent.container.childIds;
  if (orderedIds.length !== current.length) {
    throw new InvariantViolationError(
      'reorder-not-permutation',
      `setChildOrder requires a permutation of current childIds (got ${orderedIds.length}, expected ${current.length})`,
      { parentId, orderedIds: [...orderedIds], current: [...current] },
    );
  }
  const seen = new Set<NodeId>();
  for (const id of orderedIds) {
    if (seen.has(id)) {
      throw new InvariantViolationError(
        'reorder-not-permutation',
        `setChildOrder received duplicate id ${id}`,
        { parentId, id },
      );
    }
    seen.add(id);
    if (!current.includes(id)) {
      throw new InvariantViolationError(
        'reorder-not-permutation',
        `setChildOrder id ${id} is not a child of ${parentId}`,
        { parentId, id, current: [...current] },
      );
    }
  }
  // No-op if already in order.
  let same = true;
  for (let i = 0; i < orderedIds.length; i++) {
    if (orderedIds[i] !== current[i]) {
      same = false;
      break;
    }
  }
  if (same) return;

  this.replaceContainer(parentId, (c) => ({ ...c, childIds: [...orderedIds] }));
  this.resortByPin(parentId);
  trace('store', `setChildOrder: ${parentId} → [${orderedIds.join(', ')}]`);
  this.scheduleNotify();
},
```

- [ ] **Step 4: Verify the test passes**

```bash
npx vitest run src/store.setChildOrder.test.ts
```

Expected: PASS, all four cases green.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: 205 passing (201 existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/store.ts src/store.setChildOrder.test.ts
git commit -m "feat(store): add setChildOrder bulk reorder

Atomic full-permutation reorder used by the upcoming declarative React
layer to reconcile sibling order in one notification.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Decide where `order` lives on the node record

The React layer needs an `order?: number` per node. Investigate whether to thread it as a top-level Node field or store it under a reserved key in existing metadata.

**Files:**
- Read: `src/node-factories.ts`, `src/types.ts` (or wherever `Node` is defined)

- [ ] **Step 1: Locate the Node type**

```bash
grep -rn "interface Node\|type Node\s*=" src/ | head -5
```

- [ ] **Step 2: Decide and document**

Pick ONE:
- **(A) Top-level `order?: number` on `Node`:** behavioral, not user-data, deserves its own field. Pro: discoverable, typed. Con: touches every factory.
- **(B) Reserved key `order` under `WindowRecord.meta`:** zero schema change. Con: easy to clobber accidentally.

If unsure, pick **(A)** — the spec describes `order` as behavioral, and the CLAUDE.md guidance about reserved itemMeta keys (`pinned`, `locked`) shows reserved-keys-in-meta accumulates over time. A dedicated field stays clean.

Update this plan inline with the choice before writing any code. The remaining tasks assume **(A) top-level field**; if you pick (B), s/`node.order`/`node.meta?.order`/ in Tasks 4–6.

- [ ] **Step 3: If choosing (A), add the field**

```bash
grep -n "kind:" src/types.ts | head -3   # find the Node interface
```

Add to the `Node` interface (location depends on file layout):

```ts
export interface Node {
  // ...existing fields...
  /** Optional numeric sort key used by container presets when reconciling
   *  sibling order. Lower values come first; ties preserve input order. */
  order?: number;
}
```

Add an `order` parameter to `createPanel`, `createGroup`, `createZone` in `src/node-factories.ts`:

```ts
export function createPanel(opts: {
  id?: NodeId;
  parentId?: NodeId;
  meta?: Record<string, unknown>;
  placement?: Placement;
  order?: number;     // ← add
}): Node {
  // existing body, plus:
  // order: opts.order,
}
```

- [ ] **Step 4: Add a tiny test confirming the field round-trips**

Append to an existing factory test (or create `src/node-factories.order.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { createPanel } from './node-factories.js';

describe('node factories — order', () => {
  it('round-trips an explicit order', () => {
    expect(createPanel({ id: 'a', order: 7 }).order).toBe(7);
  });
  it('leaves order undefined when not provided', () => {
    expect(createPanel({ id: 'a' }).order).toBeUndefined();
  });
});
```

```bash
npx vitest run src/node-factories.order.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/node-factories.ts src/node-factories.order.test.ts
git commit -m "feat(core): add optional Node.order field

Behavioral sort key used by the declarative React layer; pure data
in core (strategies don't consult it).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Create `ParentContext` and `ChildRegistry`

These two contexts are the spine of the declarative binding.

**Files:**
- Create: `src/react/ParentContext.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/react/ParentContext.tsx
import { type ReactNode, createContext, useContext, useMemo } from 'react';
import type { NodeId } from '../index.js';

/** Current parent id for descendant presets. `null` means "root of the store". */
export const ParentContext = createContext<NodeId | null>(null);

/** Push `parentId` into context for the subtree. Use inside container presets. */
export function ParentScope({
  parentId,
  children,
}: {
  parentId: NodeId;
  children: ReactNode;
}) {
  return <ParentContext.Provider value={parentId}>{children}</ParentContext.Provider>;
}

/**
 * Mechanism by which JSX-mounted child presets report their id (and optional
 * `order`) to their parent during render, so the parent can reconcile sibling
 * order after children have self-registered.
 *
 * The registry is a mutable list that is RESET at the top of every parent
 * render (see `useChildRegistry`). Children push during their own render
 * (which happens after the parent's render body but before its layout
 * effect). The parent reads in a layout effect.
 */
export interface ChildEntry {
  id: NodeId;
  order: number | undefined;
}

export interface ChildRegistryAPI {
  /** Called by a child preset during render to report its identity + order. */
  report(entry: ChildEntry): void;
  /** Read the current snapshot. Called from the parent's layout effect. */
  snapshot(): readonly ChildEntry[];
  /** Called by the parent at the start of its render body to clear stale state. */
  reset(): void;
}

const NOOP_REGISTRY: ChildRegistryAPI = {
  report() {},
  snapshot() {
    return [];
  },
  reset() {},
};

export const ChildRegistryContext = createContext<ChildRegistryAPI>(NOOP_REGISTRY);

/** Provider wrapper. Allocates a stable registry that lives for the parent's
 *  lifetime and is reset on each render. */
export function useChildRegistry(): ChildRegistryAPI {
  // Stable across renders; reset by the parent at render start.
  return useMemo<ChildRegistryAPI>(() => {
    let entries: ChildEntry[] = [];
    return {
      report(entry) {
        entries.push(entry);
      },
      snapshot() {
        return entries;
      },
      reset() {
        entries = [];
      },
    };
  }, []);
}

export function useParentId(): NodeId | null {
  return useContext(ParentContext);
}

export function useChildRegistryFromContext(): ChildRegistryAPI {
  return useContext(ChildRegistryContext);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/react/ParentContext.tsx
git commit -m "feat(react): add ParentContext and ChildRegistry

Foundation for declarative JSX tree binding: ParentContext carries the
current parent id down the tree; ChildRegistry lets a parent collect
its JSX-mounted child ids during render for sibling-order reconciliation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `useNodeBinding` — the per-preset registration hook

This is the workhorse used by Panel/Group/Zone. It handles: id minting, render-time registration, prop reconciliation, ChildRegistry reporting, and unmount cleanup.

**Files:**
- Create: `src/react/useNodeBinding.ts`
- Create: `src/react/useNodeBinding.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/react/useNodeBinding.test.tsx
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, createPanel } from '../index.js';
import { Provider } from './Provider.js';
import { useNodeBinding } from './useNodeBinding.js';

afterEach(cleanup);

function TestPanel(props: { id?: string; meta?: Record<string, unknown>; order?: number }) {
  useNodeBinding({
    id: props.id,
    factory: (id, parentId) => createPanel({ id, parentId, meta: props.meta, order: props.order }),
    reconcile: (store, id) => {
      if (props.meta !== undefined) store.setMeta(id, props.meta);
    },
  });
  return null;
}

describe('useNodeBinding', () => {
  it('registers a node on mount and unregisters on unmount', () => {
    const store = new Store();
    const { unmount } = render(
      <Provider store={store}>
        <TestPanel id="a" />
      </Provider>,
    );
    expect(store.getNode('a')).toBeTruthy();
    unmount();
    expect(store.getNode('a')).toBeUndefined();
  });

  it('reconciles meta prop changes across re-renders', () => {
    const store = new Store();
    const { rerender } = render(
      <Provider store={store}>
        <TestPanel id="a" meta={{ title: 'A1' }} />
      </Provider>,
    );
    expect(store.getNode('a')?.meta).toEqual({ title: 'A1' });
    rerender(
      <Provider store={store}>
        <TestPanel id="a" meta={{ title: 'A2' }} />
      </Provider>,
    );
    expect(store.getNode('a')?.meta).toEqual({ title: 'A2' });
  });

  it('mints a stable id when none is provided', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <TestPanel />
      </Provider>,
    );
    // Exactly one node registered (no Provider-bound root nodes in this test).
    const rootIds = store.getRootIds();
    expect(rootIds.length).toBe(1);
    expect(rootIds[0]).toMatch(/^panel-/);
  });

  it('is idempotent under React 19 Strict Mode double-mount', async () => {
    const { StrictMode } = await import('react');
    const store = new Store();
    render(
      <StrictMode>
        <Provider store={store}>
          <TestPanel id="a" />
        </Provider>
      </StrictMode>,
    );
    expect(store.getNode('a')).toBeTruthy();
    expect(store.getRootIds().filter((id) => id === 'a').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/react/useNodeBinding.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useNodeBinding`**

```ts
// src/react/useNodeBinding.ts
import { useEffect, useId, useRef } from 'react';
import type { Node, NodeId, Store } from '../index.js';
import { useStore } from './Provider.js';
import {
  type ChildRegistryAPI,
  useChildRegistryFromContext,
  useParentId,
} from './ParentContext.js';

export interface NodeBindingOptions {
  /** Explicit id from props. If absent, a stable auto-id is minted. */
  id?: NodeId;
  /** Optional explicit parentId override. If absent, uses ParentContext. */
  parentId?: NodeId;
  /** Sort key reported to the parent's ChildRegistry. */
  order?: number;
  /** Build the initial Node to register. Called exactly once per id. */
  factory: (id: NodeId, parentId: NodeId | null) => Node;
  /** Apply prop-derived state to the already-registered node. Called on every render. */
  reconcile?: (store: Store, id: NodeId) => void;
  /** Optional kind hint used by the auto-id minter ("panel-:r1:", "zone-:r2:", ...). */
  kindHintForAutoId?: string;
}

export interface NodeBindingResult {
  id: NodeId;
}

/** OWNERSHIP_KEY — used to mark store nodes as JSX-owned for collision detection.
 *  Stored on `node.meta.__windease_jsxOwner` as a stable per-mount symbol. */
export const JSX_OWNER_META_KEY = '__windease_jsxOwner';

/** Strict-Mode-safe, render-time, idempotent node registration.
 *
 *  Why render-time and not useLayoutEffect? Parents render before children,
 *  so registering during render means the parent is in the store before any
 *  child tries to attach to it. A ref guard makes the call idempotent across
 *  re-renders and StrictMode double-invokes. Unregister happens in a layout
 *  effect's cleanup. */
export function useNodeBinding(opts: NodeBindingOptions): NodeBindingResult {
  const store = useStore();
  const parentIdFromCtx = useParentId();
  const parentId = opts.parentId ?? parentIdFromCtx ?? undefined;
  const reactId = useId();
  const id =
    opts.id ?? `${opts.kindHintForAutoId ?? 'node'}-${reactId.replace(/:/g, '')}`;

  // Per-mount ownership token. Distinct for every (mount, id) pair so we can
  // detect collision with imperative registrations.
  const ownerRef = useRef<symbol | null>(null);
  if (ownerRef.current === null) ownerRef.current = Symbol(`jsx:${id}`);

  // Render-time registration, guarded.
  const registeredRef = useRef(false);
  if (!registeredRef.current) {
    const existing = store.getNode(id);
    if (existing) {
      const owner = (existing.meta as Record<string, unknown> | undefined)?.[JSX_OWNER_META_KEY];
      if (owner === undefined || owner === null) {
        throw new Error(
          `windease: node "${id}" is already registered imperatively; remove the imperative ` +
            `registerNode call or change the JSX preset's id (see CLAUDE.md ownership model).`,
        );
      }
      if (owner !== ownerRef.current) {
        throw new Error(
          `windease: node "${id}" is mounted by another <Panel/Group/Zone>; ids must be unique.`,
        );
      }
      // Strict-mode replay path: same owner, already registered. Skip.
    } else {
      const node = opts.factory(id, parentId ?? null);
      // Stamp ownership into meta so imperative collisions can be detected.
      const mergedMeta = { ...(node.meta ?? {}), [JSX_OWNER_META_KEY]: ownerRef.current };
      store.registerNode({ ...node, meta: mergedMeta });
    }
    registeredRef.current = true;
  }

  // Report to parent's ChildRegistry every render so the parent always sees
  // children in their current JSX order.
  const registry: ChildRegistryAPI = useChildRegistryFromContext();
  registry.report({ id, order: opts.order });

  // Prop reconciliation: every render after registration.
  if (opts.reconcile) {
    opts.reconcile(store, id);
  }

  // Unregister on unmount.
  useEffect(() => {
    return () => {
      if (store.getNode(id)) {
        store.unregisterNode(id);
      }
    };
  // We intentionally key by id only — store identity is provider-stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { id };
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/react/useNodeBinding.test.tsx
```

Expected: all 4 cases PASS. If the auto-id test fails because `getRootIds` doesn't exist with that name, grep for the actual name (`grep -n "rootIds\|getRootIds\|useRootNodes" src/store.ts`) and adjust the test accordingly.

- [ ] **Step 5: Commit**

```bash
git add src/react/useNodeBinding.ts src/react/useNodeBinding.test.tsx
git commit -m "feat(react): add useNodeBinding hook

Render-time, ref-guarded node registration with prop reconciliation,
ChildRegistry reporting, and Strict-Mode-safe cleanup. Stamps a
per-mount ownership symbol into node.meta for collision detection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rewrite `<Panel>`, `<Group>`, `<Zone>` to bind to the store

**Files:**
- Modify: `src/react/presets.tsx` (full rewrite — current file is ~55 lines of decorative components)
- Create: `src/react/presets-declarative.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/react/presets-declarative.test.tsx
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Group, Zone } from './presets.js';

afterEach(cleanup);

describe('declarative presets', () => {
  it('Panel registers and renders DOM', () => {
    const store = new Store();
    const { getByTestId } = render(
      <Provider store={store}>
        <Panel id="p1" data-testid="p1" meta={{ title: 'A' }} />
      </Provider>,
    );
    expect(store.getNode('p1')).toBeTruthy();
    expect(getByTestId('p1')).toBeInTheDocument();
  });

  it('Zone registers as container and propagates parent context', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id="z1" strategyId="grid" config={{ cols: 2 }} viewport={{ w: 200, h: 100 }}>
          <Panel id="p1" />
          <Panel id="p2" />
        </Zone>
      </Provider>,
    );
    expect(store.getNode('z1')?.container).toBeTruthy();
    expect(store.getContainerView('z1')?.childIds).toEqual(['p1', 'p2']);
  });

  it('reconciles meta prop changes', () => {
    const store = new Store();
    const { rerender } = render(
      <Provider store={store}>
        <Panel id="p1" meta={{ title: 'one' }} />
      </Provider>,
    );
    rerender(
      <Provider store={store}>
        <Panel id="p1" meta={{ title: 'two' }} />
      </Provider>,
    );
    expect((store.getNode('p1')?.meta as Record<string, unknown>).title).toBe('two');
  });

  it('hidden prop toggles hideNode/showNode', () => {
    const store = new Store();
    const { rerender } = render(
      <Provider store={store}>
        <Panel id="p1" />
      </Provider>,
    );
    expect(store.getNode('p1')?.lifecycle.state).toBe('visible');
    rerender(
      <Provider store={store}>
        <Panel id="p1" hidden />
      </Provider>,
    );
    expect(store.getNode('p1')?.lifecycle.state).toBe('hidden');
    rerender(
      <Provider store={store}>
        <Panel id="p1" />
      </Provider>,
    );
    expect(store.getNode('p1')?.lifecycle.state).toBe('visible');
  });

  it('unmount unregisters the node', () => {
    const store = new Store();
    const { unmount } = render(
      <Provider store={store}>
        <Panel id="p1" />
      </Provider>,
    );
    expect(store.getNode('p1')).toBeTruthy();
    unmount();
    expect(store.getNode('p1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/react/presets-declarative.test.tsx
```

Expected: FAIL — presets don't accept these props / don't register.

- [ ] **Step 3: Rewrite `presets.tsx`**

```tsx
// src/react/presets.tsx
import type { CSSProperties, ReactNode } from 'react';
import type { NodeId, Placement } from '../index.js';
import { createGroup, createPanel, createZone } from '../index.js';
import {
  ChildRegistryContext,
  ParentScope,
  useChildRegistry,
  useChildRegistryFromContext,
} from './ParentContext.js';
import { useNodeBinding } from './useNodeBinding.js';
import { useStore } from './Provider.js';
import { useLayoutEffect } from 'react';
import { defaultChildSort, type ChildSort } from './childSort.js';

interface CommonBindingProps {
  id?: NodeId;
  parentId?: NodeId;
  order?: number;
  meta?: Record<string, unknown>;
  placement?: Placement;
  hidden?: boolean;
}

interface PresentationalProps {
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  children?: ReactNode;
  /** Forwarded to the rendered wrapper div for testing/inspection. */
  'data-testid'?: string;
}

function compose(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Panel ---------- */

export interface PanelProps extends CommonBindingProps, PresentationalProps {}

export function Panel(props: PanelProps) {
  const store = useStore();
  const { id } = useNodeBinding({
    id: props.id,
    parentId: props.parentId,
    order: props.order,
    kindHintForAutoId: 'panel',
    factory: (id, parentId) =>
      createPanel({ id, parentId: parentId ?? undefined, meta: props.meta, placement: props.placement, order: props.order }),
    reconcile: (store, id) => {
      if (props.meta !== undefined) store.setMeta(id, props.meta);
      if (props.placement !== undefined) store.patchPlacement(id, props.placement);
      if (props.hidden) {
        if (store.getNode(id)?.lifecycle.state !== 'hidden') store.hideNode(id);
      } else {
        if (store.getNode(id)?.lifecycle.state === 'hidden') store.showNode(id);
      }
    },
  });

  // Panel can host nested presets (e.g. <Panel><Panel /></Panel>). Establish
  // ParentContext and a local ChildRegistry so nested children attach to us.
  return (
    <PresetShell
      kind="panel"
      id={id}
      className={props.className}
      style={props.style}
      title={props.title}
      testId={props['data-testid']}
    >
      {props.children}
    </PresetShell>
  );
}

/* ---------- Group ---------- */

export interface GroupProps extends CommonBindingProps, PresentationalProps {}

export function Group(props: GroupProps) {
  const { id } = useNodeBinding({
    id: props.id,
    parentId: props.parentId,
    order: props.order,
    kindHintForAutoId: 'group',
    factory: (id, parentId) =>
      createGroup({ id, parentId: parentId ?? undefined, meta: props.meta, placement: props.placement, order: props.order }),
    reconcile: (store, id) => {
      if (props.meta !== undefined) store.setMeta(id, props.meta);
      if (props.placement !== undefined) store.patchPlacement(id, props.placement);
      if (props.hidden) {
        if (store.getNode(id)?.lifecycle.state !== 'hidden') store.hideNode(id);
      } else {
        if (store.getNode(id)?.lifecycle.state === 'hidden') store.showNode(id);
      }
    },
  });

  return (
    <PresetShell
      kind="group"
      id={id}
      className={props.className}
      style={props.style}
      title={props.title}
      testId={props['data-testid']}
    >
      {props.children}
    </PresetShell>
  );
}

/* ---------- Zone ---------- */

export interface ZoneProps extends CommonBindingProps, PresentationalProps {
  strategyId?: string;
  config?: unknown;
  viewport?: { w: number; h: number };
  state?: unknown;
  sort?: ChildSort;
}

export function Zone(props: ZoneProps) {
  const { id } = useNodeBinding({
    id: props.id,
    parentId: props.parentId,
    order: props.order,
    kindHintForAutoId: 'zone',
    factory: (id, parentId) =>
      createZone({
        id,
        parentId: parentId ?? undefined,
        meta: props.meta,
        placement: props.placement,
        order: props.order,
        strategyId: props.strategyId,
        config: props.config,
      }),
    reconcile: (store, id) => {
      if (props.meta !== undefined) store.setMeta(id, props.meta);
      if (props.placement !== undefined) store.patchPlacement(id, props.placement);
      if (props.state !== undefined) store.setContainerState(id, props.state);
      if (props.hidden) {
        if (store.getNode(id)?.lifecycle.state !== 'hidden') store.hideNode(id);
      } else {
        if (store.getNode(id)?.lifecycle.state === 'hidden') store.showNode(id);
      }
    },
  });

  return (
    <PresetShell
      kind="zone"
      id={id}
      className={props.className}
      style={{
        ...(props.viewport ? { width: props.viewport.w, height: props.viewport.h } : null),
        ...props.style,
      }}
      title={props.title}
      testId={props['data-testid']}
      sort={props.sort}
    >
      {props.children}
    </PresetShell>
  );
}

/* ---------- Shared shell ---------- */

interface PresetShellProps {
  kind: 'panel' | 'group' | 'zone';
  id: NodeId;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: ReactNode;
  testId?: string;
  sort?: ChildSort;
}

/** Renders the wrapper div, hosts the ChildRegistry for nested presets, and
 *  pushes our id into ParentContext for them to see. After children have
 *  rendered (and reported), reconciles sibling order in a layout effect. */
function PresetShell({ kind, id, children, className, style, title, testId, sort }: PresetShellProps) {
  const registry = useChildRegistry();
  // Reset at render start so we always reflect the current JSX subtree.
  registry.reset();

  const store = useStore();

  // After children render and self-report, reconcile sibling order.
  useLayoutEffect(() => {
    const jsxEntries = registry.snapshot();
    const view = store.getContainerView(id);
    if (!view) return; // Not a container (e.g. Panel with no nested presets).
    const jsxIds = jsxEntries.map((e) => e.id);
    const currentIds = view.childIds;
    const imperativeIds = currentIds.filter((cid) => !jsxIds.includes(cid));
    const sortFn = sort ?? defaultChildSort;
    const orderedJsx = sortFn(
      jsxEntries.map((e) => ({ id: e.id, order: e.order })),
      currentIds,
    );
    const finalOrder = [...orderedJsx, ...imperativeIds];
    if (finalOrder.length === currentIds.length) {
      // setChildOrder requires a permutation; only call if lengths match.
      store.setChildOrder(id, finalOrder);
    }
  });

  const wrapperClass =
    kind === 'panel' ? 'windease-panel' : kind === 'group' ? 'windease-group' : 'windease-zone';
  const headerClass =
    kind === 'group' ? 'windease-group__title' : kind === 'panel' ? 'windease-panel__title' : undefined;

  return (
    <ChildRegistryContext.Provider value={registry}>
      <ParentScope parentId={id}>
        <div className={compose(wrapperClass, className)} style={style} data-testid={testId} data-node={id}>
          {title !== undefined && headerClass && <header className={headerClass}>{title}</header>}
          {children}
        </div>
      </ParentScope>
    </ChildRegistryContext.Provider>
  );
}
```

- [ ] **Step 4: Create `childSort.ts`**

```ts
// src/react/childSort.ts
import type { NodeId } from '../index.js';

export interface ChildSortEntry {
  id: NodeId;
  order: number | undefined;
}

/** A custom sort callback for a parent preset. Receives the parent's JSX
 *  children (with their optional `order`) plus the full current child id list
 *  (including imperative ones, in store order). Returns the FINAL ordered id
 *  list — JSX ids only; imperative ids will be appended in store order. */
export type ChildSort = (
  jsxChildren: readonly ChildSortEntry[],
  currentChildIds: readonly NodeId[],
) => NodeId[];

/** Numeric `order` ascending (undefined ⇒ +Infinity), then JSX position. */
export const defaultChildSort: ChildSort = (jsxChildren) => {
  return jsxChildren
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.index - b.index;
    })
    .map((e) => e.id);
};
```

- [ ] **Step 5: Update the old `presets.test.tsx`**

The existing `src/react/presets.test.tsx` tests the decorative API. Update it (or delete its now-obsolete assertions and rely on the new declarative test file):

```bash
cat src/react/presets.test.tsx
```

If it tests `<Panel title="x">` → `<header>x</header>`, those assertions still hold (`title` still renders). Update any assertions that asserted "children render directly" — they still do, just inside the wrapper div with the new `data-node` attribute. Delete this file only if every test in it is duplicated by `presets-declarative.test.tsx`.

- [ ] **Step 6: Run the new test**

```bash
npx vitest run src/react/presets-declarative.test.tsx
```

Expected: PASS, all 5 cases.

- [ ] **Step 7: Run the full suite**

```bash
npm test
```

Expected: previous 201 + 4 (Task 1) + 2 (Task 2) + 4 (Task 4) + 5 (Task 5) = 216 passing, minus any obsolete `presets.test.tsx` cases you deleted.

If existing tests break, the common breakage is:
- `<Panel title="x">` still works (good)
- Decorative-only tests that mounted `<Panel>` outside a Provider — these now throw. Wrap them in `<Provider store={new Store()}>` or move the assertion into the new test file.

- [ ] **Step 8: Commit**

```bash
git add src/react/presets.tsx src/react/childSort.ts src/react/presets-declarative.test.tsx src/react/presets.test.tsx
git commit -m "feat(react): bind Panel/Group/Zone presets to the store

JSX presets now register themselves into the store during render
(ref-guarded for Strict-Mode safety), reconcile meta/placement/hidden/
state props on every render, and unregister on unmount. Each container
preset hosts a ChildRegistry and reconciles sibling order via the new
defaultChildSort (numeric \`order\` ascending, then JSX position).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Sibling-order tests

**Files:**
- Create: `src/react/sibling-order.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/react/sibling-order.test.tsx
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, createPanel } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import type { ChildSort } from './childSort.js';

afterEach(cleanup);

describe('sibling order reconciliation', () => {
  it('JSX child order is reflected in store childIds', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id="z" strategyId="grid" config={{ cols: 1 }}>
          <Panel id="a" />
          <Panel id="b" />
          <Panel id="c" />
        </Zone>
      </Provider>,
    );
    expect(store.getContainerView('z')?.childIds).toEqual(['a', 'b', 'c']);
  });

  it('reordering JSX siblings updates the store', () => {
    const store = new Store();
    const Tree = ({ reversed }: { reversed: boolean }) => (
      <Provider store={store}>
        <Zone id="z" strategyId="grid" config={{ cols: 1 }}>
          {reversed ? (
            <>
              <Panel id="c" />
              <Panel id="b" />
              <Panel id="a" />
            </>
          ) : (
            <>
              <Panel id="a" />
              <Panel id="b" />
              <Panel id="c" />
            </>
          )}
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree reversed={false} />);
    expect(store.getContainerView('z')?.childIds).toEqual(['a', 'b', 'c']);
    rerender(<Tree reversed={true} />);
    expect(store.getContainerView('z')?.childIds).toEqual(['c', 'b', 'a']);
  });

  it('numeric `order` prop overrides JSX position', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id="z" strategyId="grid" config={{ cols: 1 }}>
          <Panel id="a" order={20} />
          <Panel id="b" order={10} />
          <Panel id="c" />
        </Zone>
      </Provider>,
    );
    // b (10) < a (20) < c (Infinity)
    expect(store.getContainerView('z')?.childIds).toEqual(['b', 'a', 'c']);
  });

  it('custom `sort` prop fully overrides', () => {
    const store = new Store();
    const reverseSort: ChildSort = (jsx) => jsx.map((e) => e.id).reverse();
    render(
      <Provider store={store}>
        <Zone id="z" strategyId="grid" config={{ cols: 1 }} sort={reverseSort}>
          <Panel id="a" />
          <Panel id="b" />
          <Panel id="c" />
        </Zone>
      </Provider>,
    );
    expect(store.getContainerView('z')?.childIds).toEqual(['c', 'b', 'a']);
  });

  it('mixed JSX + imperative children: JSX first (sorted), imperative tail', () => {
    const store = new Store();
    // Imperatively pre-register children of "z" before JSX mounts.
    // Order: imperatively register the zone too, since Provider doesn't.
    // We let JSX register the zone, then imperatively append children.
    function Stage() {
      return (
        <Provider store={store}>
          <Zone id="z" strategyId="grid" config={{ cols: 1 }}>
            <Panel id="jsx-a" />
            <Panel id="jsx-b" order={5} />
          </Zone>
        </Provider>
      );
    }
    const { rerender } = render(<Stage />);
    // Now add an imperative child.
    store.registerNode(createPanel({ id: 'imp-1', parentId: 'z' }));
    // Force a re-render so the parent's layout effect runs again and
    // reconciles. (In production, the parent re-renders when store changes
    // because hooks observe; here we trigger explicitly.)
    rerender(<Stage />);
    expect(store.getContainerView('z')?.childIds).toEqual(['jsx-b', 'jsx-a', 'imp-1']);
  });
});
```

- [ ] **Step 2: Run**

```bash
npx vitest run src/react/sibling-order.test.tsx
```

Expected: 5 PASS. If the mixed-provenance test fails because the parent didn't re-reconcile after `registerNode`, that's a real issue: the parent's layout effect only runs when *it* re-renders. To make imperative additions reorder live, the parent needs to subscribe to its container-view changes. Add this to `PresetShell`:

```tsx
// In PresetShell, before useLayoutEffect:
const childIdsView = useChildren(id); // already a subscribed hook
// childIdsView changes when store children change; triggers re-render and the layout effect.
```

If `useChildren` returns `Node[]` (not just ids), use its length+content as the dependency signal. The layout effect runs on every render anyway, so just *touching* `useChildren(id)` is enough to wire the subscription.

- [ ] **Step 3: Commit**

```bash
git add src/react/sibling-order.test.tsx src/react/presets.tsx
git commit -m "test(react): sibling order reconciliation across JSX, order prop, sort, and imperative

Includes the wiring fix for live imperative additions: PresetShell now
subscribes to its own container children via useChildren so the layout
effect re-runs when imperative siblings are added or removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Nested-presets test

**Files:**
- Create: `src/react/nested-presets.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/react/nested-presets.test.tsx
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';

afterEach(cleanup);

describe('nested declarative presets', () => {
  it('Zone > Panel > Panel produces the correct parent chain', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id="z" strategyId="grid" config={{ cols: 1 }}>
          <Panel id="outer">
            <Panel id="inner" />
          </Panel>
        </Zone>
      </Provider>,
    );
    expect(store.getNode('z')?.container).toBeTruthy();
    expect(store.getNode('outer')?.slot?.parentId).toBe('z');
    expect(store.getNode('inner')?.slot?.parentId).toBe('outer');
  });

  it('unmounting a parent cascades unregister to JSX children', () => {
    const store = new Store();
    const { unmount } = render(
      <Provider store={store}>
        <Zone id="z" strategyId="grid" config={{ cols: 1 }}>
          <Panel id="p1" />
          <Panel id="p2" />
        </Zone>
      </Provider>,
    );
    expect(store.getNode('p1')).toBeTruthy();
    unmount();
    expect(store.getNode('z')).toBeUndefined();
    expect(store.getNode('p1')).toBeUndefined();
    expect(store.getNode('p2')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run**

```bash
npx vitest run src/react/nested-presets.test.tsx
```

Expected: 2 PASS. The cascade test relies on `unregisterNode` cascading to descendants (it does — see `src/store.ts:180`). The child components' own unmount cleanup will try to `unregisterNode(p1)` again; the guard `if (store.getNode(id))` in `useNodeBinding` (Task 4 Step 3) prevents the error.

- [ ] **Step 3: Commit**

```bash
git add src/react/nested-presets.test.tsx
git commit -m "test(react): nested declarative presets

Verifies parent-chain registration and the cascade-on-unmount behavior
(JSX child cleanup is a no-op when the store already removed it via
parent cascade).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Collision test

**Files:**
- Create: `src/react/collision.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/react/collision.test.tsx
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store, createPanel } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';

afterEach(cleanup);

describe('id collisions between JSX and imperative', () => {
  it('throws when JSX mounts an id that is already imperatively registered', () => {
    const store = new Store();
    store.registerNode(createPanel({ id: 'collide' }));

    // Silence React's error logging for this test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Provider store={store}>
          <Panel id="collide" />
        </Provider>,
      ),
    ).toThrow(/already registered imperatively/);
    spy.mockRestore();
  });

  it('throws when imperative code registers an id already owned by JSX', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Panel id="jsx-owned" />
      </Provider>,
    );
    expect(() => store.registerNode(createPanel({ id: 'jsx-owned' }))).toThrow(
      /duplicate|already/i,
    );
  });
});
```

- [ ] **Step 2: Run**

```bash
npx vitest run src/react/collision.test.tsx
```

Expected: PASS. (The imperative-after-JSX case is already covered by the store's existing `DuplicateNodeError`.)

- [ ] **Step 3: Commit**

```bash
git add src/react/collision.test.tsx
git commit -m "test(react): id-collision guardrails between JSX and imperative

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Provider — optional store + root contexts

**Files:**
- Modify: `src/react/Provider.tsx`
- Create: `src/react/Provider.test.tsx` (if it doesn't exist already)

- [ ] **Step 1: Write the failing test**

```tsx
// src/react/Provider.test.tsx (append to existing if present)
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Provider, useStore } from './Provider.js';
import { Panel } from './presets.js';

afterEach(cleanup);

describe('Provider auto-store', () => {
  it('auto-creates a Store when none is provided', () => {
    let captured: ReturnType<typeof useStore> | null = null;
    function Probe() {
      captured = useStore();
      return null;
    }
    render(
      <Provider>
        <Probe />
      </Provider>,
    );
    expect(captured).not.toBeNull();
  });

  it('uses the provided store when one is passed', async () => {
    const { Store } = await import('../index.js');
    const store = new Store();
    let captured: ReturnType<typeof useStore> | null = null;
    function Probe() {
      captured = useStore();
      return null;
    }
    render(
      <Provider store={store}>
        <Probe />
      </Provider>,
    );
    expect(captured).toBe(store);
  });

  it('auto-store works end-to-end with a JSX preset', () => {
    let capturedStore: ReturnType<typeof useStore> | null = null;
    function Probe() {
      capturedStore = useStore();
      return null;
    }
    render(
      <Provider>
        <Panel id="p" />
        <Probe />
      </Provider>,
    );
    expect(capturedStore?.getNode('p')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rewrite Provider**

```tsx
// src/react/Provider.tsx
import { type ReactNode, createContext, useContext, useState } from 'react';
import { Store } from '../index.js';

export const Context = createContext<Store | null>(null);

export interface ProviderProps {
  /** Optional. If omitted, Provider creates and owns a Store. Subsequent
   *  renders ignore changes to this prop — pick one mode per Provider
   *  instance (auto-owned vs. consumer-owned) and stick with it. */
  store?: Store;
  children: ReactNode;
}

export function Provider({ store: storeProp, children }: ProviderProps) {
  const [store] = useState<Store>(() => storeProp ?? new Store());
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useStore(): Store {
  const store = useContext(Context);
  if (!store) {
    throw new Error('useStore must be used inside <Provider>');
  }
  return store;
}
```

- [ ] **Step 3: Run**

```bash
npx vitest run src/react/Provider.test.tsx
```

Expected: 3 PASS.

- [ ] **Step 4: Run full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/react/Provider.tsx src/react/Provider.test.tsx
git commit -m "feat(react): Provider auto-creates a Store when none is provided

Drops one line of boilerplate for the common single-Provider case. Once
chosen at mount, the mode (auto vs. consumer-provided) is locked for the
Provider's lifetime to avoid mid-life store swaps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Container — render JSX children when present

**Files:**
- Modify: `src/react/Container.tsx`

- [ ] **Step 1: Inspect current behavior**

```bash
grep -n "children" src/react/Container.tsx
```

Confirms `ContainerProps` has no `children` prop today. We add one.

- [ ] **Step 2: Add a `children` branch**

In `src/react/Container.tsx`, add to `ContainerProps`:

```ts
/** When provided, Container renders these directly and skips the chrome
 *  dispatch. Use this for declarative trees built with <Panel>/<Group>/<Zone>.
 *  When omitted, Container reads children from the store and renders each
 *  via `chrome`. */
children?: ReactNode;
```

And at the top of the `Container` function body, before the `parent.container` check:

```ts
if (children !== undefined) {
  return (
    <div
      ref={ref}
      className={className}
      style={containerStyle}
      data-node-container={parentId}
    >
      {children}
    </div>
  );
}
```

Also: make `chrome` optional (`chrome?: Chrome`) since declarative mode doesn't need it; guard the store-driven branch with `if (!chrome) return null` after `if (!parent?.container)`.

- [ ] **Step 3: Add a test**

Append to `src/react/Container.test.tsx`:

```tsx
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Container } from './Container.js';
import { Provider } from './Provider.js';
import { Store, createZone } from '../index.js';

afterEach(cleanup);

describe('Container declarative children', () => {
  it('renders provided children directly', () => {
    const store = new Store();
    store.registerNode(createZone({ id: 'z' }));
    const { getByText } = render(
      <Provider store={store}>
        <Container parentId="z">
          <span>hello</span>
        </Container>
      </Provider>,
    );
    expect(getByText('hello')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run**

```bash
npx vitest run src/react/Container.test.tsx
```

Expected: existing cases still pass + new case passes.

- [ ] **Step 5: Commit**

```bash
git add src/react/Container.tsx src/react/Container.test.tsx
git commit -m "feat(react): Container renders JSX children when provided

When the consumer passes children, skip the chrome dispatch and render
them directly. \`chrome\` becomes optional. Keeps the store-driven path
untouched for consumers that pass no children.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Mixed-provenance playground story

**Files:**
- Create: `src/react/stories/DeclarativePlayground.stories.tsx`
- (Optional) Modify: `src/react/stories/playground.css` if styling needed

- [ ] **Step 1: Write the story**

```tsx
// src/react/stories/DeclarativePlayground.stories.tsx
import { useEffect, useMemo, useState } from 'react';
import { Store, createPanel, gridStrategy } from '../../index.js';
import { Provider } from '../Provider.js';
import { StrategyRegistryProvider } from '../strategies.js';
import { Panel, Zone } from '../presets.js';
import './playground.css';

export default { title: 'Declarative / Mixed Provenance' };

export function MixedProvenance() {
  const store = useMemo(() => new Store(), []);
  const [impCount, setImpCount] = useState(2);

  // Imperatively pre-register a couple of children of "root" on first render.
  useEffect(() => {
    if (!store.getNode('imp-1')) {
      store.registerNode(createPanel({ id: 'imp-1', parentId: 'root', meta: { title: 'imp-1' } }));
    }
    if (!store.getNode('imp-2')) {
      store.registerNode(createPanel({ id: 'imp-2', parentId: 'root', meta: { title: 'imp-2' }, order: 15 }));
    }
  }, [store]);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
        <Zone
          id="root"
          strategyId="grid"
          config={{ cols: 3 }}
          viewport={{ w: 900, h: 540 }}
        >
          <Panel id="jsx-a" meta={{ title: 'jsx-a' }} />
          <Panel id="jsx-b" meta={{ title: 'jsx-b' }} order={10} />
          <Panel id="jsx-c" meta={{ title: 'jsx-c' }} />
        </Zone>
        <ImperativeControls
          onAdd={() => {
            const next = impCount + 1;
            setImpCount(next);
            store.registerNode(
              createPanel({ id: `imp-${next}`, parentId: 'root', meta: { title: `imp-${next}` } }),
            );
          }}
          onRemove={() => {
            // Remove the last imperative panel if any exist.
            const view = store.getContainerView('root');
            const last = view?.childIds
              .slice()
              .reverse()
              .find((id) => id.startsWith('imp-'));
            if (last) store.unregisterNode(last);
          }}
          onAttemptCollision={() => {
            try {
              store.registerNode(createPanel({ id: 'jsx-a', parentId: 'root' }));
              alert('UNEXPECTED: collision did not throw');
            } catch (err) {
              alert(`Collision correctly rejected: ${(err as Error).message}`);
            }
          }}
          onMutateJsxOwned={() => {
            store.setMeta('jsx-b', { title: 'mutated-from-outside' });
            alert('Set meta on jsx-b. Watch: next render will revert it to "jsx-b".');
          }}
          onMutateImperative={() => {
            store.setMeta('imp-1', { title: 'mutated-imp-1' });
          }}
        />
      </StrategyRegistryProvider>
    </Provider>
  );
}

function ImperativeControls(props: {
  onAdd: () => void;
  onRemove: () => void;
  onAttemptCollision: () => void;
  onMutateJsxOwned: () => void;
  onMutateImperative: () => void;
}) {
  return (
    <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button onClick={props.onAdd}>+ imperative panel</button>
      <button onClick={props.onRemove}>− last imperative</button>
      <button onClick={props.onAttemptCollision}>collide with jsx-a (should throw)</button>
      <button onClick={props.onMutateJsxOwned}>setMeta(jsx-b) (should revert)</button>
      <button onClick={props.onMutateImperative}>setMeta(imp-1) (should stick)</button>
    </div>
  );
}
```

- [ ] **Step 2: Start Ladle and verify by eye**

```bash
npm run ladle &
LADLE_PID=$!
sleep 5
# Visit http://localhost:61000/?story=declarative--mixed-provenance manually.
# Verify:
#   - JSX children sort: jsx-b (order=10), jsx-a, jsx-c, then imp-1, imp-2 (order=15) appended.
#   - "+ imperative panel" appends a new imp-N tile.
#   - "collide" alert shows the error message.
#   - "setMeta(jsx-b)" alert; tile title flips momentarily then reverts on next render.
#   - "setMeta(imp-1)" updates imp-1's title and it stays.
kill $LADLE_PID 2>/dev/null
```

If anything is off, fix in `presets.tsx` or `Container.tsx` and re-verify. No automated test for the story itself — the behaviors are covered by Tasks 5–8.

- [ ] **Step 3: Commit**

```bash
git add src/react/stories/DeclarativePlayground.stories.tsx
git commit -m "ladle(stories): mixed-provenance declarative playground

Stress-tests the union of JSX and imperative tree provenance: ordering,
collision throw, JSX-wins-reconciliation, and imperative-mutation
persistence for imperative-owned ids.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Public exports

**Files:**
- Modify: `src/react/index.ts`

- [ ] **Step 1: Update exports**

Add to `src/react/index.ts`:

```ts
export { ParentContext, ParentScope, useParentId } from './ParentContext.js';
export { defaultChildSort, type ChildSort, type ChildSortEntry } from './childSort.js';
export type { PanelProps, GroupProps, ZoneProps } from './presets.js';
```

Do NOT export `useNodeBinding`, `ChildRegistryContext`, `JSX_OWNER_META_KEY`, or `PresetShell` — they're internal.

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: PASS, no TS errors.

- [ ] **Step 3: Commit**

```bash
git add src/react/index.ts
git commit -m "feat(react): export ParentContext, ParentScope, defaultChildSort, ChildSort, preset props

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: README — lead with declarative

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README structure**

```bash
grep -n "^#" README.md | head -20
```

- [ ] **Step 2: Rewrite the "Quick start" section**

Replace the current imperative quick-start with:

````markdown
## Quick start

```bash
npm install windease
```

```tsx
import { gridStrategy } from 'windease';
import {
  Provider,
  StrategyRegistryProvider,
  Zone,
  Panel,
} from 'windease/react';

export function App() {
  return (
    <Provider>
      <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
        <Zone
          id="root"
          strategyId="grid"
          config={{ cols: 2 }}
          viewport={{ w: 720, h: 480 }}
        >
          <Panel id="a" meta={{ title: 'A' }} />
          <Panel id="b" meta={{ title: 'B' }} order={10}>
            <Panel id="b-nested" meta={{ title: 'nested' }} />
          </Panel>
        </Zone>
      </StrategyRegistryProvider>
    </Provider>
  );
}
```

`<Panel>` / `<Group>` / `<Zone>` register themselves with the underlying
store on mount and unregister on unmount. JSX is the source of truth for
the shape of the tree.

### Imperative API (advanced / dynamic trees)

For server-loaded layouts, programmatically generated nodes, or anything
that can't be expressed as static JSX, use the store directly:

```tsx
import { Store, createPanel } from 'windease';

const store = new Store();
store.registerNode(createPanel({ id: 'p1', parentId: 'root' }));

<Provider store={store}>{/* ... */}</Provider>
```

Imperative and declarative nodes coexist under the same parent. JSX-owned
ids reconcile their props on every render; imperative ids retain
whatever the caller set. See `docs/concepts.md` for the ownership model.
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): lead with declarative JSX example

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump version**

In `package.json`, change `"version": "0.3.0"` to `"version": "0.4.0"`.

- [ ] **Step 2: Run final verification**

```bash
npm test && npm run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.4.0

Declarative JSX tree binding is a breaking change to <Container> and
preset components; major-minor bump per semver pre-1.0 conventions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Update TODO and HANDOFF

**Files:**
- Modify: `TODO.md`
- Delete: `HANDOFF.md` (its task is now done)

- [ ] **Step 1: Cross off the TODO line**

```bash
grep -n "Declarative JSX" TODO.md
```

Update the matching line to mark it complete (e.g. add a `~~strikethrough~~` or move under a "Done in 0.4.0" section, matching the file's existing conventions).

- [ ] **Step 2: Remove HANDOFF.md**

```bash
git rm HANDOFF.md
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md
git commit -m "chore: mark declarative JSX binding done; drop HANDOFF

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** every section of the spec has at least one task. Ownership model → Task 4 + 8. Render-time registration → Task 4. ParentContext → Task 3. Sibling order + default sort + custom sort → Tasks 5 + 6. Container simplification → Task 10. API additions → Task 5 (presets) + Task 9 (Provider). Playground stress test → Task 11. Versioning → Task 14. README rewrite → Task 13.
- **Placeholders:** none. Every code block is concrete.
- **Type consistency:** `ChildSort` defined in Task 5 Step 4, consumed in Task 6 Step 1. `JSX_OWNER_META_KEY` defined in Task 4 Step 3 and not exported (Task 12). `setChildOrder` signature is `(parentId, orderedIds)` everywhere.
- **Sequencing:** Tasks 1–3 are independent foundations. Tasks 4–10 are linear (each depends on earlier ones). Tasks 11–15 are wrap-up and can be done in any order.

The trickiest task is **Task 5** (preset rewrite). If anything breaks, the
likely culprit is the `useChildren` subscription not triggering re-renders
when imperative siblings are added; Task 6 Step 2 has the fix.
