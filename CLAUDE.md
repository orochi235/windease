# windease — project conventions

## Terminology

**Always read [`docs/concepts.md`](docs/concepts.md) before touching this
codebase if you're not already fluent in the vocabulary.** It's the
canonical reference for what counts as a window vs. zone vs. workspace,
which of the four data buckets (`hints` / `config` / `WindowRecord.meta` /
`ZoneItemMeta`) a given piece of state belongs in, and how reserved
itemMeta keys (`pinned`, `locked`) interact with layout and DnD.

Common naming-trap rules:

- **`meta` is overloaded by scope.** `WindowRecord.meta` is window-intrinsic
  and survives `moveWindow`; `ZoneRecord.itemMeta` (alias `ZoneItemMeta`)
  is per-membership and is cleared on `release`. Pick the one whose lifetime
  matches the data.
- **`pinned` ≠ `locked`.** Pinned means "sorted to the prefix of
  `windowIds`." Locked means "pinned, AND the React layer refuses to drag
  or destroy it." Don't conflate; both are reserved keys on `itemMeta`.
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

## Other conventions

- TDD where reasonable; new strategies/hooks ship with their tests.
- Strategies are pure functions of `{ items, container, state, options }` and
  return `LayoutResult`. Side effects belong in React glue (Zone, Workspace).
- Snapshot/hydrate keeps everything JSON-safe.
- No breaking changes between minor versions without a README note.
