# Declarative JSX tree binding for the React layer

**Status:** design
**Date:** 2026-06-07
**Ships in:** `windease@0.4.0`

## Problem

Today windease's React presets are decorative: `<Container><Panel /></Container>`
silently drops its children. The only way to build a tree is to imperatively
call `store.registerNode(createPanel({...}))` and let `<Container>`'s chrome
dispatch render whatever the store currently contains. That's not a credible
React API for a library that consumers will reach for from JSX-first apps.

## Goal

Make this work end-to-end and lead the docs with it:

```tsx
import { Store, gridStrategy, stackStrategy } from 'windease';
import {
  Provider, Zone, Panel, StrategyRegistryProvider,
} from 'windease/react';

<Provider store={new Store()}>
  <StrategyRegistryProvider strategies={{ grid: gridStrategy, stack: stackStrategy }}>
    <Zone id="root" strategyId="grid" config={{ cols: 2 }} viewport={{ w: 720, h: 480 }}>
      <Panel id="a" meta={{ title: 'A' }} />
      <Panel id="b" meta={{ title: 'B' }} order={10}>
        <Panel id="b-nested" meta={{ title: 'nested' }} />
      </Panel>
    </Zone>
  </StrategyRegistryProvider>
</Provider>
```

The imperative `store.registerNode(...)` path stays fully supported for
dynamic / server-loaded / programmatically-generated trees. Both write to
the same store; both can coexist in the same app and even under the same
parent.

## Non-goals

- No changes to layout strategies, snapshot/serialize, DnD, or history.
- No new layout strategy, no new persistence layer.
- No removal of imperative APIs. The store remains the single source of
  truth and a fully supported public API.

## Architecture

### Single source of truth: the store

JSX presets do not maintain shadow state. Every JSX preset on mount calls
into the same store APIs that imperative code uses
(`registerNode`, `setMeta`, `patchPlacement`, `setContainerState`, etc.).
Effects/reactivity flow back out through the existing `useNode` /
`useChildren` hooks.

### Ownership model

Two kinds of nodes coexist in the store:

- **JSX-owned**: registered by a mounted `<Panel>`/`<Group>`/`<Zone>`
  component. Lifecycle is tied to the React component:
  - registered on mount
  - props (meta, strategyId, viewport, config, placement, order) are
    reconciled into the store on every render
  - unregistered on unmount
- **Imperative**: registered via `store.registerNode(...)` from outside
  JSX. Persists until the caller removes it.

**Reconciliation rule:** JSX-owned ids "win" their prop values on every
render. An imperative `setMeta` on a JSX-owned id will be visible until
the next render of its owning preset, then overwritten. This is by design:
JSX is declarative; the rendered props are the truth for as long as the
component is mounted.

**Id-collision guardrail:** if imperative code calls `registerNode` with
an id that a JSX preset currently owns (or vice versa), throw
`WindeaseError('node "<id>" is already owned declaratively; …')` with
guidance. This catches the worst class of bug (silent mutual stomping)
early.

### Registration ordering: render-time, ref-guarded

Each preset registers itself with the store **during render** (not in an
effect), guarded by a ref so it runs exactly once per id. This works
because:

- Parents render before children in React, so parent registration always
  precedes child registration — exactly what the store needs.
- The guard ref makes the call idempotent across Strict Mode's
  double-invoke and across re-renders.
- Unregistration happens in a `useEffect` cleanup (the standard pattern;
  Strict Mode's mount/unmount/mount cycle works fine because mount
  re-registers).

This trick is well-precedented (Jotai, Zustand selectors, react-three-fiber
all do equivalent things). It is the simplest model that gets parents
registered before children without resorting to manual tree walking.

### `ParentContext`

A new React context carries the current parent id down the tree. The
`<Provider>` exports `null` (root). `<Zone>` / `<Group>` / `<Panel>` all
override it to their own id for their subtree.

### Sibling order resolution

Each parent preset runs a `useLayoutEffect` after its children have
self-registered, and calls `store.reorderInParent(myId, finalOrder)`
where `finalOrder` is derived as:

1. The parent collects its JSX-owned child ids in JSX order. (Children
   push themselves into a small `ChildRegistry` context during render;
   the parent reads the accumulated list in its layout effect.)
2. The parent looks up its current store children, partitions them into
   JSX-owned vs imperative, and constructs:
   ```
   [...jsxOrderedByDefaultOrCustomSort, ...imperativeInStoreOrder]
   ```
3. If the parent has a custom `sort` prop, that callback runs on the
   *full* child list (both JSX and imperative) and its return value
   is the final order.

#### Default sort

Numeric `order` field (top-level on the node record, not buried in meta,
because it's behavioral) sorts ascending; nodes without `order` keep
their stable input position. JSX children come first, imperative tail
after — unless `order` explicitly interleaves them. This matches the
mental model of CSS `flex: order`.

#### Custom sort prop

```tsx
<Zone id="root" sort={(children) => children.toSorted(byCreatedAt)}>…</Zone>
```

When provided, fully overrides the default. Receives all children
(JSX + imperative) and returns the canonical id order. The default sort
is exposed as `defaultChildSort` for callers that want to delegate.

### `<Container>` simplification

`<Container>` becomes a thin convenience that just renders its React
children and (when no children are passed) falls back to the existing
store-driven chrome dispatch. There is no dual-mode behavior switch on
"are these children declarative or decorative" — JSX children are always
the declarative tree, and they happen to also render. The docs lead
with `<Zone>` as the primary mount point because Zone is where the
strategy + viewport live.

### Rendering nested presets

Each preset renders its React children directly inside its own wrapper
element. So `<Panel id="b"><Panel id="b-nested" /></Panel>` produces
nested DOM and registers nested store hierarchy. Strategy-driven layout
only activates inside a `<Zone>`; nested `<Panel>` inside a `<Panel>`
just stacks naturally in the DOM and establishes parent/child in the
store. This keeps the model predictable: visual layout is a Zone
concern; tree structure is a node concern.

## Affected files

- `src/react/presets.tsx` — primary change. Each preset gains
  registration, prop reconciliation, child-registry participation, and
  parent-context propagation.
- `src/react/ParentContext.tsx` *(new)* — context + ChildRegistry context.
- `src/react/Container.tsx` — simplified to render children or fall
  back to chrome dispatch.
- `src/react/Provider.tsx` — exports the root `ParentContext` value
  (null) and ChildRegistry root.
- `src/react/index.ts`, `src/index.ts` — no new public components, but
  the existing preset types gain new props (`order`, `sort`, etc.).
- `src/react/stories/Playground.stories.tsx` — rewrite to declarative
  *and* keep an imperative section in the same story to stress-test
  the union (see Playground section below).
- `README.md` — declarative example up top; imperative example moved
  to "Advanced / dynamic trees" subsection.

## Public API additions

On every preset (`<Panel>`, `<Group>`, `<Zone>`):

- `id?: string` — when omitted, a stable id is minted via `useId()`
- `parentId?: string` — defaults to value from `ParentContext`; explicit
  prop overrides (escape hatch for reparenting across the JSX tree)
- `order?: number` — sort key; default behavior is "untouched"
- `meta?: Record<string, unknown>` — reconciled via `setMeta`
- `placement?: Placement` — reconciled via `patchPlacement`
- `hidden?: boolean` — when true, the node is registered but
  `store.hideNode(id)` is called; flips back via `showNode`
- `children?: ReactNode` — rendered inline; nested presets self-register
- For `<Zone>` specifically: `strategyId`, `config`, `viewport`, `state`,
  and `sort`. `state` is reconciled via `setContainerState`.

## Playground stress test

The playground story must demonstrate mixed provenance in one tree:

```tsx
function MixedProvenanceStory() {
  const store = useMemo(() => new Store(), []);

  // Imperatively pre-register a couple of nodes...
  useEffect(() => {
    store.registerNode(createPanel({ id: 'imp-1', parentId: 'root', meta: { title: 'imperative-1' } }));
    store.registerNode(createPanel({ id: 'imp-2', parentId: 'root', meta: { title: 'imperative-2' }, order: 5 }));
  }, [store]);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ grid: gridStrategy }}>
        <Zone id="root" strategyId="grid" config={{ cols: 3 }} viewport={{ w: 900, h: 600 }}>
          <Panel id="jsx-a" meta={{ title: 'jsx-a' }} />
          <Panel id="jsx-b" meta={{ title: 'jsx-b' }} order={10} />
          <Panel id="jsx-c" meta={{ title: 'jsx-c' }} />
          {/* imp-1 and imp-2 also exist as children of "root" */}
        </Zone>
        <ImperativeControlPanel store={store} />
      </StrategyRegistryProvider>
    </Provider>
  );
}
```

`<ImperativeControlPanel>` exposes buttons to:

- add a new imperative panel under `root`
- remove an imperative panel
- attempt to `registerNode({ id: 'jsx-a', ... })` → verifies the
  collision guard throws
- `setMeta('jsx-b', { title: 'mutated' })` → verifies JSX reconciliation
  wins on the next render
- `setMeta('imp-1', { title: 'mutated' })` → verifies imperative
  mutations stick for imperative-owned ids
- reorder via `reorderInParent` → verifies that JSX-owned ids snap back
  to their JSX/order-resolved position on next render

This story is the canonical proof that the union of the two modes
behaves coherently.

## Testing plan

New `*.test.tsx` files under `src/react/`:

1. `presets-declarative.test.tsx`
   - Mounting `<Panel>` registers a node with the expected parent id.
   - Unmounting unregisters.
   - Changing `meta` prop re-runs `setMeta`.
   - Changing `placement` re-runs `patchPlacement`.
   - `hidden` toggles call `hideNode`/`showNode`.
   - Strict Mode double-mount still results in exactly one registered
     node.

2. `sibling-order.test.tsx`
   - JSX child order is reflected in `store.zones[parent].childIds`.
   - Reordering JSX siblings reorders the store.
   - Numeric `order` prop overrides JSX position.
   - Custom `sort` prop fully overrides.
   - Mixed JSX + imperative children: JSX wins ordering by default,
     imperative tail preserved.

3. `nested-presets.test.tsx`
   - `<Zone><Panel><Panel /></Panel></Zone>` produces three nodes with
     the correct parent chain.
   - Inner `<Panel>`s with no surrounding `<Zone>` still register with
     the outer `<Panel>` as parent.

4. `collision.test.tsx`
   - Imperative `registerNode` on a JSX-owned id throws.
   - JSX `<Panel id="x">` when `x` is already imperatively registered
     throws.

5. Existing 201 tests must continue to pass. Specifically the existing
   imperative `Playground.stories.tsx` flow needs an equivalent
   regression test if the story itself is rewritten.

## Versioning

Ship as `windease@0.4.0`. The breaking changes:

- `<Container>` and presets now register nodes from JSX; existing code
  that put unrelated children inside a `<Container>` will start
  attempting to register them.
- Preset components gain required-when-no-Provider semantics: they
  throw outside a `<Provider>`. (Today they're inert.)

README rewrite: declarative example first, "Imperative for dynamic
trees" subsection second.

## Open questions deferred

- Should `<Panel hidden>` unregister-on-hide or just call `hideNode`?
  Plan picks the latter (cheap, preserves identity). Revisit if hidden
  nodes' bookkeeping is measurably heavy.
- Should server rendering emit registration into a serializable store
  for hydration? Out of scope for 0.4.0; effects run on client hydrate
  is fine for now.

## Process

This design supersedes the proposal in `HANDOFF.md`. After user
approval, transition to `superpowers:writing-plans` to produce the
implementation plan.
