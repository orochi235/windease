# Replaceable policies — successor, navigation, acceptance, edge scroll

For anyone implementing or reviewing this in windease. It assumes the
vocabulary in [`docs/concepts.md`](../../concepts.md).

windease exports four pure policies and then calls each from exactly one
hardcoded site, so a consumer who wants a different rule can only re-implement
it and correct the result afterward. This makes all four replaceable. It is not
one seam: they sit in three layers, and forcing them into one bag would put two
DOM-level drag concerns into the DOM-independent core.

| Policy | Called from | Seam |
| --- | --- | --- |
| `chooseSuccessor` | `Store.succeedFocus` | `StoreOptions` |
| `resolveNavigation` | `resolveMove`, `FocusProvider` | `StoreOptions`, read inside `resolveNavigation` |
| a container's `canAccept` | `DragEngine.checkAccept` | `<Container>` / preset prop |
| edge-scroll tuning | `DragEngine`'s scroll sampler | `<Container>` prop |

## Every override is tri-state

`undefined` means "you decide" and falls through to the built-in; `null` (or
`false`) is a deliberate answer. `strategy.navigate` already means exactly this
(`focus/resolve.ts`), so the shape is not new to the codebase.

This is what keeps a consumer from reimplementing the 90% they did not want to
change. Wanting the left sibling on destroy is a three-line callback that
returns `undefined` for every other case.

## A policy that misbehaves is treated as `undefined`

Every one of these callbacks is arbitrary consumer code running inside a
library operation. Each call is wrapped: **a policy that throws, or that
returns an answer the library cannot use, is traced and falls through to the
built-in.** `TypedEmitter.emit` (`events.ts`) already swallows and logs a
consumer listener's throw for the same reason.

Without this the successor policy is a store-corrupter, not a nuisance.
`#unregisterNodeInner` calls `succeedFocus` *after* destroying the departing
node's descendants and *before* `detachAndRemove`, the `node.unregistered`
emit, and `scheduleNotify()` — so a policy that throws, or that names a node
`focusNode` will reject, escapes `unregisterNode` and leaves the node
registered with its children already gone and no notification. This is the
`store.transact` rule in `CLAUDE.md` applied one level out: validate before
mutating rather than relying on an inner call to throw.

"Cannot use" is per policy: a successor id that is not `isFocusable`, or that
names the departing node itself; a navigation id that is not `isFocusable`.
`null` and `false` are deliberate answers and are never second-guessed — only a
returned *id* is validated.

## `StoreOptions` grows two policies

```ts
interface StoreOptions {
  throttle?: ThrottlePolicy;
  clock?: Clock;
  chooseSuccessor?: SuccessorPolicy;
  resolveNavigation?: NavigationPolicy;
}

type SuccessorPolicy = (ctx: SuccessorInput) => NodeId | null | undefined;
type NavigationPolicy = (input: ResolveInput) => NodeId | null | undefined;

interface SuccessorInput {
  store: Store;
  departing: NodeId;
  reason: 'destroyed' | 'hidden' | 'moved';
}
```

`reason` is information `succeedFocus` already has and currently discards; a
consumer plausibly wants a different successor on destroy than on hide.

The exported `chooseSuccessor(store, departing)` keeps its signature. The
override's bag and the export's positional arguments never appear side by side,
because tri-state means a consumer never calls the built-in themselves.

## Navigation hooks inside `resolveNavigation`, not at its callers

`resolveNavigation` takes `store` as an input, so it can read the policy off it.
Both callers — `resolveMove` (`move.ts`) and `FocusProvider` — then get the
policy with no change, and so does any caller added later. Hooking the two call
sites instead would leave every future one on the built-in.

Precedence is consumer first:

```
policy(input)        → undefined ↓
strategy.navigate()  → undefined ↓
directional()
```

The consumer is the outermost authority, and the case a consumer is most likely
to want changed is one a strategy has an opinion about. A custom strategy's
`navigate` can therefore be pre-empted by an app policy its author did not
anticipate; that is the intended direction.

**The trap: a policy that calls `resolveNavigation` re-enters it.** The policy
is consulted once per top-level call, and a re-entrant call skips it. Split an
internal `builtinResolve` (no policy) out of the public entry, and have the
public entry own the re-entrancy flag. Without this a policy that computes
against the default recurses until the stack dies.

## `canAccept` becomes an override, not a third veto

`DragEngine.checkAccept` today runs `lock.accept`, then
`strategy.canAccept(items, options)`, then the drop target's
`canAccept(sourceId)` — every one a veto. So a consumer can only narrow: a
`strip` at its `maxItems` cap stays unacceptable no matter what the container
says, which is half the gap.

`DropTarget` grows a second slot:

```ts
interface DropTarget {
  /** @deprecated Removed at 2.0.0. Use `acceptPolicy`. */
  canAccept?(sourceId: NodeId): boolean;
  acceptPolicy?(ctx: AcceptContext): boolean | undefined;
}

interface AcceptContext {
  /** The prospective post-drop child list, as `strategy.canAccept` sees it. */
  items: { id: NodeId }[];
  options: Record<string, unknown>;
  sourceId: NodeId;
}
```

`checkAccept` becomes:

```
lock.accept          → reject, unconditionally. A lock is not a policy.
acceptPolicy(ctx)    → false: reject. true: skip the strategy. undefined: fall through.
strategy.canAccept   → consulted only when the policy deferred.
canAccept(sourceId)  → trailing veto, deprecated.
```

A new slot rather than a widened one: `useDropTarget(id, ref, canAccept)` is
documented in the README, and an existing `(sourceId) => boolean` callback
handed a bag would read an object as an id. Deprecating rather than deleting
matches how the repo already parks dead exported surface.

`items` is the list `checkAccept` builds at the `strategy.canAccept` site
today; hoist it so the policy sees it even where no strategy has an opinion.
**Keep it guarded on "a policy or a strategy exists"** — this is the
per-`pointermove` path, and building the list for a container with neither is a
new cost on every drag.

## The React props are forwarding, not new machinery

`useDropIntentTarget` already takes `canAccept` and forwards it to
`registerDropTarget`; `<Container>` never passes one. `DropTargetOptions`
already carries `edgeScroll`; `useDropIntentTarget` does not accept it and
hardcodes `{ scrollEl, getDropIntent }`.

- `<Container>` gains `canAccept` and `edgeScroll` props.
- `useDropIntentTarget` gains `edgeScroll`, and widens `canAccept` to the
  `acceptPolicy` shape.
- `PresetShell`'s `drop` bag gains `canAccept`, and `<Zone>` / `<Panel>` expose
  it — the path 1.3.0 used for `stackOnDrop` / `splitOnDrop` / `dropIntent`.

`edgeScroll` stops at `<Container>`. Presets pass no `scrollRef`, so
`registerDropTarget` gets no scroll element and registers no scroll bag at all;
an `edgeScroll` prop on a preset would tune something that never runs.

## Tests

Core, headless: the successor policy sees the right `reason`, and each of the
three return values does what it says; the navigation policy pre-empts
`strategy.navigate`; a policy that calls `resolveNavigation` terminates;
`resolveMove` honors the policy without being changed to.

React: a container widening a `strip` past its `maxItems` cap, narrowing within
it, and deferring; a deprecated `canAccept` still vetoing after a policy
returned `true`; `edgeScroll` reaching the engine from `<Container>`.

A Ladle story carries the browser coverage: a container that refuses drops by
source kind, operable rather than merely rendered, so Playwright can drive it.
