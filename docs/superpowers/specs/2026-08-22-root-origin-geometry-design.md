# Root container origins — design

Two sibling root containers occupy the same coordinate space and cannot be told
apart. `<Container>` composes each child's rect against its own entry in the
geometry registry (`src/react/Container.tsx:208-229`), and only a parent
`<Container>` ever writes that entry — so a root has none, its children land at
origin `(0, 0)`, and every root's children overlap.

This spec is for whoever implements the fix. It says how a root learns its own
position, why the value lives in React state rather than only in the registry,
and what stays out of scope. Additive — no new public surface, no config.

## What actually breaks

`resolveNavigation`'s `directional` (`src/focus/resolve.ts:31`) scores every
navigable leaf in the store, walking `store.rootIds`. It is not scoped to a
root. So the symptom is not that an arrow key stops at a top-level zone
boundary — it is that candidates in the other root are scored from coordinates
that are not theirs, and the winner is arbitrary.

`resolveMove` (`src/move.ts:57-73`) takes whatever navigation returned and
reparents into that node's parent, with no same-root check. Cross-root
`Shift`+arrow therefore starts working the moment the coordinates are real;
it needs no code of its own.

`ParallelZonesDnd.stories.tsx` is the fixture: two flexbox-composed root zones.
Drag between them already works, because DnD hit-tests DOM elements rather than
the registry.

## Mechanism

A `<Container>` is a root when its node has no `membership`. Ask the store, not
the registry: a missing registry entry is ambiguous during the first commit,
because child effects run before parent effects and a nested container would
briefly mistake itself for a root.

A root measures its own element — `getBoundingClientRect()` plus
`window.scrollX` / `window.scrollY`. Document coordinates, not viewport ones, so
that a page scroll between one root's re-measure and another's does not pull
them apart.

The measured origin goes into React state. A root that wrote only to the
registry would compose its children against a stale value for one commit, since
`selfRect` is read during render (`Container.tsx:208`) and the write happens in
an effect. Composition then reads one value either way:

```ts
const origin = isRoot ? measuredOrigin : selfRect;
```

The existing composition effect (`:209-229`) is otherwise unchanged. The root
also writes its own rect into the registry under its node id, so `rectOf(rootId)`
answers for a root the way it already does for a placed container.

Re-measured on two triggers, guarded by an equality check against the last
published rect so `setState` does not loop:

- once per commit — the same unconditional re-measure the flow path already
  runs at `:284-286`, which is what catches a pane moved by a class toggle that
  no observer reports. This covers resize too: the viewport ResizeObserver
  inside `ContainerHost.observe` already re-renders the container when its own
  size changes, so a second observer for the origin would only duplicate it.
- passive `resize` on `window`, and `scroll` in the capture phase, so a scroll
  anywhere in the page — including an ancestor scroller — re-measures.

With no `GeometryProvider` above it the registry is null and the whole path is
skipped, as it is today.

## Coverage

`ParallelZonesDnd.stories.tsx` gains `GeometryProvider` and `FocusProvider` and
becomes keyboard-operable, keeping its existing drag coverage. It is the story
for this feature, per the repo convention that a capability with no operable
story has no browser coverage.

- **e2e** (`e2e/`, driving that story): `ArrowRight` from the left zone's pane
  lands in the right zone; `Shift`+`ArrowRight` reparents it there.
- **jsdom**: two sibling roots with stubbed `getBoundingClientRect` publish
  non-overlapping registry rects, and a root's children compose against its
  origin rather than `(0, 0)`.
- **headless**: a resolver test that directional navigation picks the
  geometrically correct cross-root target, given a `GeometrySource` that
  reports two separated roots. No DOM — the resolver never measures.

## Limits

- **No `<Workspace>` component, and no inter-zone gutters.** A root `strip` or
  `grid` container already tiles zones and emits resize affordances between
  them; `Playground.stories.tsx:33-60` builds main / sidebar / dock that way
  through `store.split`. `TODO.md`'s claim that the Playground composes zones in
  CSS is stale and is corrected in the same change.
- **A `<Container>` rendered for a non-root node whose parent no `<Container>`
  renders keeps origin `(0, 0)`.** It has `membership`, so it does not measure,
  and nothing writes its entry. Unchanged from today.
- **A root moved without a scroll, a resize, or a React commit stays where it
  was last measured** — a CSS animation or transition sliding one root past
  another is the case. Same residual gap the flow path has.

## Consequence to note

Registry rects become document coordinates rather than root-relative ones for
every consumer, single-root included. Nothing in the library reads an absolute
value — navigation, moves and `navigableLeaves` all compare rects to each other
— but a consumer reading `useGeometrySource().rectOf(id)` sees different
numbers. `CHANGELOG.md` entry under `## Unreleased`.
