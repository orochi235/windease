# Handoff — declarative JSX tree binding

## What's shipped on `main` (state at handoff)

- **Published:** `windease@0.3.0` on npm (unscoped). Install with
  `npm install windease`.
- **GH Pages:**
  - Playground: <https://orochi235.github.io/windease/>
  - API reference: <https://orochi235.github.io/windease/api/>
- **Core surface today**: store-driven. Consumers build the tree by
  imperatively calling `store.registerNode(createPanel({...}))` then mount
  `<Container parentId={...} chrome={...} viewport={...} />` which renders
  children pulled from the store via a chrome dispatch.
- **Bare exports** (in `windease/react`): `Provider`, `Container`, `Panel`,
  `Group`, `Zone`, `Root`, `NodeRenderer`, `DragProvider`, `DragHandle`,
  `useStore`, `useNode`, `useChildren`, `useFocusedNode`, `useRootNodes`,
  `useDragHandle`, `useDropTarget`, `useDragState`, `useContainerLayout`,
  `StrategyRegistryProvider`, `useStrategyRegistry`.
- **Layout strategies** in `windease`: `gridStrategy`, `stackStrategy`,
  `stripStrategy`, `splitStrategy` (one merged strategy; binary vs.
  recursive controlled by `config.recursive` — default `true`).
- **Node kind** is a free-form optional string. Core enforces no
  panel/group/zone-shape rules; `createPanel` / `createGroup` /
  `createZone` are convention presets that set `kind` as a label.
- **Tests**: 201 passing (vitest). Run `npm test`.
- **Build**: `npm run build` (`tsc -b` + copy styles.css) → `dist/`.
- **Ladle**: `npm run ladle` to serve, `npm run ladle:build` for
  static.
- **API docs**: `npm run docs:api` (typedoc; output `docs-api/`).

## The task

**Make the React layer accept declarative JSX as its primary tree
declaration.** Today `<Container><Panel /></Container>` silently drops
its children. That's not a credible React API. The target shape:

```tsx
import { Store, gridStrategy, stackStrategy } from 'windease';
import { Provider, Zone, Group, Panel, StrategyRegistryProvider } from 'windease/react';

<Provider store={new Store()}>
  <StrategyRegistryProvider strategies={{ grid: gridStrategy, stack: stackStrategy }}>
    <Zone id="root" strategyId="grid" config={{ cols: 2 }} viewport={{ w: 720, h: 480 }}>
      <Panel id="a" meta={{ title: 'A' }} />
      <Panel id="b" meta={{ title: 'B' }}>
        <Panel id="b-nested" meta={{ title: 'nested' }} />
      </Panel>
    </Zone>
  </StrategyRegistryProvider>
</Provider>
```

The imperative `store.registerNode(...)` path stays available for
dynamic / server-loaded trees, but **declarative is the path the docs
lead with**.

## Approach (proposed; refine in brainstorming)

1. **Add a `ParentContext`** in `src/react/` — each preset reads it to
   know its parent id. Default is `null` (root). `<Zone>` overrides it
   so its children mount with `parentId = zone.id`.
2. **Each preset (`<Panel>` / `<Group>` / `<Zone>`)** runs a
   `useLayoutEffect` that:
   - If `id` is missing, mints a stable auto-id (e.g. `panel-${useId()}`).
   - Calls `store.registerNode(createPanel/Group/Zone({...props, id,
     parentId: parentFromContext}))` on mount.
   - Calls `store.unregisterNode(id)` on unmount.
   - Calls `store.showNode(id)` (or accept a `hidden` prop).
   - Calls `setMeta`, `patchPlacement`, etc. on prop changes.
   - Pushes a fresh `ParentContext` value for children = `id`.
3. **Effect ordering**: React runs effects children-first by default;
   you need parents registered *before* children. Two-pass strategy:
   register the local node in `useLayoutEffect`, AND have a
   `useInsertionEffect` (or run the body imperatively in render via
   a memo) so parent registration precedes child render. Test this
   carefully — it's the gnarliest part.
4. **Reordering**: when JSX child order changes, derive the new
   `childIds` from the React children array and call
   `store.reorderInParent`. Use the children's keys as the join.
5. **`<Container>`**: in declarative mode (children present), render
   the JSX children directly (after the registration effects have
   queued node creates) and skip the chrome dispatch. With no
   children, fall back to current store-driven chrome rendering.
6. **Strategy state**: `<Zone state={...}>` calls `setContainerState`
   in an effect when the prop changes.

## Files to know

- `src/react/Container.tsx` — current store-driven renderer. Needs the
  declarative branch.
- `src/react/presets.tsx` — `<Panel>` / `<Group>` / `<Zone>` are
  styled wrappers today; they don't touch the store. This file is
  where the new registration logic goes (or a parallel
  `presets-declarative.tsx` if you want to keep the dumb
  presentational components separate from the smart binding versions).
- `src/react/Provider.tsx` — exposes `useStore`. The `ParentContext`
  can live next to it or in `presets.tsx`.
- `src/react/NodeRenderer.tsx` — `chrome` dispatch; might gain a
  fallback for "no chrome, render JSX as-is."
- `src/index.ts` and `src/react/index.ts` — public exports.
- `src/react/stories/Playground.stories.tsx` — current imperative
  story; rewrite to declarative as the canonical demo.

## Constraints & gotchas

- **React 19** is the peer dep. Use `useId` for stable auto-ids.
- **`useLayoutEffect`** is what you need for parent-first ordering; do
  NOT use `useEffect` here.
- **Server rendering**: the registration effects don't fire on the
  server. That's fine — declarative trees still render the static
  shape; effects run on client hydrate. But guard `useLayoutEffect`
  with the standard `typeof window` check, or use the
  `useIsomorphicLayoutEffect` pattern.
- **Strict Mode**: effects double-invoke. Registration logic must be
  idempotent (check store before registering; idempotent
  unregister; etc.).
- **Tests**: write `*.test.tsx` for: mount renders JSX, unmount
  unregisters, reordering JSX siblings calls `reorderInParent`,
  nested zones nest correctly, dynamic add/remove works under React
  Strict Mode.
- **Existing tests**: don't break the 201 store-driven tests. The
  store-driven path must keep working.

## Versioning

This is a breaking change to `<Container>` semantics (children prop
now meaningful) and adds props to `<Panel>` / `<Group>` / `<Zone>`.
Bump to `0.4.0` when shipping. Update README example to lead with
declarative; keep an "Imperative" subsection as fallback.

## Process

Recommend using `superpowers:brainstorming` first to refine the
approach (especially effect ordering and reordering), then
`writing-plans` to scope the implementation. The TODO entry in
`TODO.md` ("Declarative JSX tree binding [HIGH — blocks credible 1.0]")
mirrors much of this handoff.

## What's *not* the task

- Don't touch the layout strategies. They're stable.
- Don't change snapshot/serialize. Stable.
- Don't change DnD — drag still works because it operates on the
  store, which is the same.
- Don't add new layout strategies, DnD modes, or persistence layers.
  Focus on the declarative React surface only.
