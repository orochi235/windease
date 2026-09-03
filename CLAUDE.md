# windease — project conventions

## Terminology

**Always read [`docs/concepts.md`](docs/concepts.md) before touching this
codebase if you're not already fluent in the vocabulary.** It's the
canonical reference for the capability model, which of the four data
buckets (`hints` / `container.config` / `node.meta` /
`membership.placement`) a given piece of state belongs in, and how the
reserved placement keys (`pinned`, `locked`, `size`) interact with layout
and DnD.

There is no distinct "window" or "zone" *type*. Everything is one `Node`
shape carrying any combination of four optional capabilities —
`lifecycle`, `container`, `membership`, `focus`. Zone / Group / Panel are
presets over that shape, and `node.kind` is a free-form label the core
never interprets.

Common naming-trap rules:

- **`container` and `membership` answer opposite questions.** `container`
  is "can I have children?" (holds `childOrder`); `membership` is "do I
  have a parent?" (holds `parentId` + my `placement` in that parent). A
  zone is a container with no membership — it has children and no parent.
  A panel is the childless one.
- **`meta` is overloaded by scope.** `node.meta` is node-intrinsic;
  `membership.placement` describes a node *in one parent*. Both survive
  `moveNode` — placement is carried, not cleared — so the scope is a
  statement of intent, not a lifetime the store enforces. Every reserved
  placement key is parent-relative (`pinned` is an index into that parent's
  `childOrder`, `size` a pixel extent on its main axis, `span` a cell count
  only `grid` reads), so a moved node arrives holding keys the new parent may
  read differently or not at all.
- **`pinned` ≠ `locked`, and they are not the same kind of thing.** Pinned is
  `placement.pinned`, the index a node holds in its parent's `childOrder`.
  Locked is `node.lock`, a per-axis permission set, node-intrinsic like `meta`.
  `placement.locked` is a v3 key with no live readers — `snapshot.ts` folds it
  into `node.lock` on hydrate and drops it.
- **`canAccept(items, options)` is a hot path.** It runs on every drag
  pointermove. Keep it O(items.length) or smaller; defer expensive checks
  to drop time.

## Tenet: instrument liberally with optional debug traces

This is a library that runs in someone else's app, mostly in response to
pointer events, history hookups, and layout strategies they didn't write. The
fastest path to diagnosing a bad drop, a stuck drag, or a missing undo step
is **always** a categorized log of what the library was doing at the time.

Write trace calls freely. The cost of an enabled-by-default `console.log` is
real (noise, perf), but the cost of `trace('dnd', '…')` is one Set lookup
when disabled — effectively free. There's no reason to be stingy.

### How to add traces

Use `trace(category, message, data?)` from `@windease/core`:

```ts
import { trace } from '@windease/core';

trace('dnd', `move: ${sourceWid} → ${targetId}@${index}`);
trace('history', `undo → cursor ${cursor}/${stack.length - 1}`);
trace('layout', `grid: ${items.length} items in ${cols}×${rows}`, { unplaced });
```

### Categories

Pre-declared in `packages/core/src/trace.ts`:

| Category    | When to use                                                  |
| ----------- | ------------------------------------------------------------ |
| `dnd`       | Pointer drag lifecycle, hit-tests, drops, capture transitions |
| `history`   | Push, undo, redo, transaction begin/end, evictions           |
| `layout`    | Strategy `.layout()` calls, results, overflow decisions       |
| `store`     | Window/zone mutations, event emissions                       |
| `workspace` | Workspace state changes, gestures, zone-swap                 |
| `zone`      | Zone mount, viewport changes, render decisions               |

If a new category genuinely doesn't fit, add it to the `TRACE_CATEGORIES`
tuple and use it. Don't reach for `console.log` directly in library code.

### When NOT to trace

- Inside a tight hot loop that runs per-frame (e.g. inside the pointermove
  handler's no-op early-return path — only trace after we know something
  interesting happened).
- For data so large it would dominate the log (truncate or summarize).
- For user-visible errors — those should `throw WindeaseError` or surface in
  another contract-bound way. Traces are diagnostic, not API.

### How to enable

The trace system is configured via any of:

- **Node tests:** `WINDEASE_TRACE=dnd,history npm test`
- **Browser console:** `localStorage.setItem('windease.trace', '*'); location.reload()`
- **Runtime:** `import { configureTrace } from '@windease/core'; configureTrace('dnd')`

Use `'*'` for everything, or a comma-separated list of categories.

### What good traces look like

- **Direct:** "move: w1 → zone-b@2" beats "moving thing".
- **Stateful:** include the key values that change. "cursor 5/12" beats "cursor moved".
- **Actionable when read in isolation:** assume the reader sees one line at a
  time and may not have surrounding context. Include enough state.

## Tenet: the core is DOM-independent

The core — store, node model, snapshot, layout strategies, `ContainerHost` —
runs with no `document`, no `window`, no `Element`. Layout is arithmetic over
`{ items, container, state, options }`; anything that reads or writes the DOM
is an adapter layered on top.

Three places in the tree already have the shape to copy: `ContainerHost.setViewport()`
is the real API and `observe(el)` is a ResizeObserver convenience over it;
`insertionIndexByMidpoint()` takes plain bounds and `childRectsForContainer()`
is the DOM harvester that feeds it; `DragEngine` hit-tests `bounds()` callbacks
and `DragController` is the DOM host that measures elements and binds pointers
for it. Pure function first, thin DOM wrapper beside it — never one function
that does both.

What this means when you design against it:

- **Measurement is an input, never a call.** A strategy that needs a child's
  natural size receives it on `LayoutItem`; it does not measure. The adapter
  fills the field.
- **Don't name core types after the DOM.** An affordance carries `orientation` /
  `valueNow` / `label`, and the adapter maps those onto `aria-*`.
  `role="separator"` means nothing to a non-DOM consumer.
- **Core tests run headless.** If a new one needs jsdom — or a hand-faked
  `Element` — the boundary moved.
- **A DOM convenience is not automatically a layout input.** `observe` /
  `observeNatural` belong on `ContainerHost` because a strategy reads what they
  report; `observePixelRatio` is standalone because nothing in `layout()` reads
  the ratio and no placement moves with it. Routing it through the host would
  make it a bus for a value it never consumes, and would notify a canvas host
  on every ordinary resize.

## Other conventions

- TDD where reasonable; new strategies/hooks ship with their tests.
- **Every feature ships with a Ladle story** — a new one, or real integration into
  an existing one, in the same change that adds the feature. Not a demo afterthought:
  the Playwright suite drives Ladle (`playwright.config.ts` starts it), so a
  capability with no story has no browser coverage, and the gestures this library
  exists for are the ones unit tests are worst at. A story that only renders the
  feature is not integration — it has to be operable.
- Strategies are pure functions of `{ items, container, state, options }` and
  return `LayoutResult`. Side effects belong in React glue (Zone, Workspace).
- **`store.transact` does not roll back.** A callback that throws partway leaves
  every mutation it already made, so a multi-step operation validates fully
  before opening the transaction rather than relying on an inner call to throw.
- Snapshot/hydrate keeps everything JSON-safe.
- No breaking changes between minor versions without a README note.
- Every user-visible change gets a `CHANGELOG.md` entry under `## Unreleased`, which
  is retitled to the version at release. `scripts/check-changelog.sh` fails a release
  whose version has no section, or where an `Unreleased` heading survived the bump.
