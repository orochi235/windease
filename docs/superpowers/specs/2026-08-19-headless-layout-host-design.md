# Headless layout host — design

Consumers who don't use `windease/react` get no drag-to-rearrange and no
drag-to-resize. This spec is for whoever implements the fix. It defines the seam
between framework-agnostic layout/gesture logic and the per-framework wrapper
that renders it, and answers: what moves into core, what stays in a binding, and
in what order.

A **binding** here means a per-framework wrapper. Today there is exactly one,
`src/react/`.

## Problem

The gesture logic is mostly not React-coupled — it is merely *located* in
`src/react/`, and the glue that drives it is React-only.

- `src/react/dnd/DragController.ts` (375 lines) imports `LayoutStrategy`,
  `NodeId`, `Store`, `trace`. No React import. It owns lock checks on
  drag-begin, hit-testing, `canAccept` consultation, insertion index,
  `moveNode` on drop, rAF coalescing, and escape/window-pointerup handling.
- `src/react/dnd/insertionIndex.ts` (54 lines) imports nothing.
- Resize math already lives in each strategy's `reduce()`, which is pure core.

What is genuinely React-bound is smaller than it looks: `useContainerLayout`
(229 lines) fusing four jobs, and `AffordanceHandle`'s ~30 lines of pointer
bookkeeping in `Container.tsx`.

So this is an extraction, not a rewrite.

## The seam

**The host owns gestures. The binding owns rendering.**

Duplication is not uniformly expensive. Turning a `Rect` into pixels is three
lines and idiomatic per framework — React spreads it into `style`, vanilla
writes `el.style`. Duplicating that is cheap and stays correct because it is
trivial. Pointer plumbing is where the edge cases live, and where a second
implementation silently falls behind.

The test to apply when placing any line:

> Could this be wrong in a way a user notices? Then it belongs in the host.

Lock guards, insertion index, pointer capture, escape-to-cancel: host. Which CSS
property carries the rect: binding, and it is fine that it is written twice.

## Topology

Recursion today is driven by the binding's tree. `<Container parentId>` mounts
one `useContainerLayout` and renders each child at its rect with a
`<NodeRenderer>` inside; a child that is itself a container renders another
`<Container>`, which measures its own element with its own ResizeObserver. Keep
that shape.

**`ContainerHost` — one per container.** Owns measurement, strategy resolution,
the layout run, lock-based affordance suppression, and affordance dispatch.
Constructed by whoever renders that container. Nesting needs no new machinery:
the binding creating a child host *is* the recursion.

**`DragController` — one per tree.** Drag is inherently cross-container, so
something must be tree-scoped. `<DragProvider>` already is exactly this, and its
controller is already framework-free.

Rejected: a single tree-scoped host owning every container. It would have to
discover containers appearing and disappearing, which the binding currently
reports for free via mount/unmount, and would maintain its own model of the tree
alongside the binding's — new machinery bought with nothing.

## API surface

```ts
class ContainerHost {
  constructor(store: Store, parentId: NodeId, registry: StrategyRegistry)

  observe(el: Element): () => void                 // ResizeObserver
  setViewport(v: { w: number; h: number }): void   // explicit — headless tests
  setPreview(p: Preview | null): void

  layout(): ContainerLayout                        // identity-stable
  subscribe(fn: () => void): () => void

  dispatchAffordance(event: LayoutEvent): void
  attachAffordance(el: Element, affordanceId: string): () => void

  destroy(): void
}

class DragController {        // relocated from src/react/dnd/, plus:
  attachDragHandle(el: Element, nodeId: NodeId): () => void
}
```

`ContainerLayout` is the existing interface at `useContainerLayout.ts:16`,
unchanged.

Two types move or get named as part of step 2. `StrategyRegistry` is declared in
`src/react/strategies.tsx` but is only `ReadonlyMap<string, LayoutStrategy<…>>`
with no React in it — move the type to core and let the React file re-export it.
`Preview` has no name today; it is the inline fourth parameter of
`useContainerLayout` (`{ insertId, insertIndex?, cursor }`).

`setViewport` is what makes the host testable with no DOM at all — drive it with
synthetic points and assert on `layout()`.

## Constraints the implementation must honor

**`layout()` must be identity-stable.** `useSyncExternalStore`'s `getSnapshot`
must return the same reference until something changes, or React infinite-loops.
The host caches and recomputes only on invalidation. This fails as a hang rather
than a wrong value, so it will not announce itself.

**The invalidation set must be replicated exactly.** Today it is three
subscriptions plus `useNode`: `container.stateChanged`, `node.lockChanged`, and
the node reference. The lock subscription fires for the parent *or any child*
(`useContainerLayout.ts:84-91`) — that child clause is load-bearing and was a bug
fix. A resize lock lands on a child, so the parent's reference never changes and
a naive port leaves the layout stale. Consolidating these three into one host
subscription is most of this extraction's real risk.

**The React public API does not change.** `useContainerLayout` keeps its exact
signature and return type. `Container.tsx` is untouched except that
`AffordanceHandle` loses its pointer logic and keeps its markup and hit-padding.
0.9.0 already carries three breaking changes; this adds none.

The React binding then reduces to roughly:

```ts
const host = useMemo(() => new ContainerHost(store, parentId, registry), [store, parentId, registry]);
useEffect(() => () => host.destroy(), [host]);
useEffect(() => viewportRef?.current ? host.observe(viewportRef.current) : undefined, [host, viewportRef]);
return useSyncExternalStore(host.subscribe, host.layout);
```

## What stays in the bindings

The declarative tree binding in `presets.tsx` reconciles JSX into store state.
That is React-specific and stays. "React becomes thin" is true of layout and
gestures; it is not true of `presets.tsx`, which remains substantial.

But the reconcile *decisions* must move to core, and this is the one addition
this design makes beyond a straight extraction. Any future binding needs the
same rules — including the skip-vs-force distinction that took a whole-branch
review and five fix commits to get right. Extract a decision surface (e.g.
`reconcileChildOrder(store, parentId, ids)`) that owns the lock rules, and let
each binding supply only its own notion of what order it observed. Cheap now,
expensive to retrofit once a second binding exists.

## Staging

Each step is independently shippable.

1. **Relocate `DragController` and `insertionIndex` into core** and export them.
   A file move plus export lines; the 225-line test file moves unchanged. This
   alone unblocks a consumer willing to write their own pointer handlers.
2. **Extract `ContainerHost`** from `useContainerLayout` and `AffordanceHandle`.
3. **Rewire the React binding** over the host; extract the reconcile decisions.
4. **Add a second binding.** Open — see below.

## Step 4 is an open choice

Steps 1–3 are identical either way, so this is decided when reached, with real
code in hand.

**`windease/vanilla`** — imperative attach functions. Serves exactly one kind of
consumer.

**`windease/elements`** — custom elements (`<windease-zone>`,
`<windease-panel>`). Serves vanilla plus Vue, Svelte, and Angular with one
binding, and is what a vanilla consumer would rather write than construct a host
by hand. If this is chosen, a curated vanilla binding is never needed: core is
public and documented, and exotic consumers use it directly.

Three facts bearing on the choice:

- The peer dependency is already `react: ^19`, which passes non-primitive props
  as properties and handles custom events. The historical reason custom elements
  were a poor fit for this library — `lock={{arrange: true}}` arriving as
  `"[object Object]"` — does not apply.
- **Light DOM only.** The CSS surface is `.windease-zone`, `.windease-window`,
  and `--w-x/y/w/h`, and consumer chrome supplies the visuals. A shadow root
  would encapsulate exactly what consumers must reach. Custom elements would be
  used purely as a lifecycle mechanism, not for style encapsulation.
- The `chrome` render-callback model does not fully resolve. A React consumer
  rendering into regions owned by a custom element is the "who owns this
  subtree" fight. Survivable because React consumers use `windease/react` and
  never touch the elements, but the two bindings stay separate at the chrome
  layer rather than one wrapping the other.

## Prerequisite

`TODO.md` still lists the Playwright e2e suite as unbuilt: DnD and resize are
exercised only through synthetic pointer events in jsdom. This refactor touches
exactly that code. Build the suite first, or accept that steps 2–3 land without a
real-browser net.
