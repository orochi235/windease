# Keyboard navigation and focus — design

windease has a focus concept that nothing outside the library can observe.
`store.focusNode()` moves a single global `focusedId` and drives a two-state
FSM, but there is no `tabIndex`, no `aria-*`, no `role`, and no `.focus()` call
anywhere in `src/react/`; the only `keydown` listener in the repo is
Escape-cancels-drag in `DragController.ts`. A keyboard user cannot reach a
window and a screen-reader user cannot tell which one is active.

This spec is for whoever implements the fix. It defines how model focus and
platform focus reconcile, how the keyboard moves between windows, and where the
DOM boundary sits. It ships as **1.2.0** — additive surface only.

## Problem

Three failures, in descending order of severity.

**Model focus is unobservable.** `focusedId` is a styling flag. Nothing sets DOM
focus from it, and nothing raises it when a user clicks or tabs into a panel's
content, so the model silently disagrees with the browser the moment a user
touches anything.

**Focus evaporates.** `store.ts:296` and `store.ts:336` both do
`if (this.focusedIdValue === id) this.focusedIdValue = null` — no successor, no
event, no `blur` sent to the FSM. Destroying the focused window drops DOM focus
to `<body>`, which returns a screen-reader user to the top of the page.

**Placements animate unconditionally.** `settleMs` defaults non-zero and
`prefers-reduced-motion` is not consulted anywhere.

## The seam

The core is already DOM-free — store, strategies, snapshot, history, throttle,
split and pinning contain no DOM references. The single exception is
`ContainerHost.observe(el)` (`container-host.ts:137`), which sits beside
`setViewport(v)`, commented *"The headless path — no DOM required."*

That pairing is the template, not a new invention: **the headless setter is the
real API; the DOM convenience sits beside it.** Everything below preserves it.

| Layer | Contents | DOM |
|---|---|---|
| `src/focus/` | resolver, focus memory, successor policy | none |
| DOM adapter | roving tabindex, `focusin`, keydown→intent, ARIA, announcements | yes |
| Null adapter | no-op `present` / `announce` | none |

The null adapter is not decoration. A one-implementation interface always leaks;
the null adapter is what proves the resolver never reaches for an element, and
core unit tests run against it.

## Focus model

Focus stays **single** — one active window, as today. Multi-select for group
operations is a separate concept and must not be overloaded onto focus; it
belongs with the unbuilt work under TODO.md's "Groups".

Each container gains `ContainerCap.lastFocusedId?: NodeId`, maintained by the
store: written when a descendant takes focus, cleared when that child is removed
or moved out. It exists so that re-entering a zone restores where you were
instead of snapping to child 0, which is what every real window manager does per
workspace.

It lives on `ContainerCap` rather than in one of the four data buckets because
the store maintains it automatically. `container.state` is wrong — `setStrategy`
clears it. `container.config` is strategy configuration. `node.meta` is a
consumer bag, and store-maintained state does not belong in one.

**It is not serialized.** Snapshot already round-trips `focusedId` and per-node
focus state, so this is a deliberate inconsistency: navigation memory is session
convenience, and carrying it would mean a v6 snapshot plus dangling-id
validation on hydrate for no user-visible gain. Recorded here so nobody
"corrects" it by accident.

## Navigation

`resolveNavigation({ store, from, intent, geometry }) → NodeId | null`. Pure,
DOM-free, returns null when there is nowhere to go. Two families of intent:

- **Sibling-relative** — `next`, `prev`, `first`, `last`. Ordinal over the
  parent's `childOrder`, skipping non-visible children.
- **Directional** — `left`, `right`, `up`, `down`. Geometric.
- **Cycle** — `cycleNext`, `cyclePrev`. Depth-first over the whole tree's
  visible leaves. This is the enumeration primitive, and the one that carries a
  non-visual user.

Directional navigation **crosses container boundaries**, resolving over every
visible focusable leaf in the tree rather than only siblings. That is what makes
arrows feel like a window manager rather than a list widget, and it is the
reason geometry beat ordinal ordering: `childOrder` is DOM order, and
`Container.tsx:254` positions children absolutely from `placements`, so a
strategy is free to render a node bottom-right that `childOrder` reaches first.
Pinning reorders `childOrder` without moving anything on screen.

The algorithm: from the source rect's center, keep candidates whose center falls
in the direction's half-plane; score each by primary-axis distance plus a
cross-axis penalty; take the minimum. Ties break toward lower `childOrder`. **No
wrapping** — running out of candidates returns null, so the user is never
teleported across the workspace.

### Geometry

```ts
interface GeometrySource {
  rectOf(id: NodeId): Rect | null;
}
```

Rects in one coordinate space. The resolver never computes geometry and never
calls `getBoundingClientRect`. The React binding implements this by walking the
ancestor chain and summing origins from each `ContainerHost`'s placements; a
canvas host implements it from its own scene. This is the single decision that
keeps directional navigation testable without a DOM.

### Strategy override

`LayoutStrategy` gains an optional hook, matching how `canAccept?`,
`getDropPreview?` and `dispatchAffordance?` already extend it:

```ts
navigate?(input: {
  items: LayoutItem[];
  from: ItemId;
  direction: 'left' | 'right' | 'up' | 'down';
  options: Record<string, unknown>;
}): ItemId | null | undefined;
```

The source's parent strategy gets first refusal. Returning an id wins;
returning `undefined` falls through to geometric resolution. `null` means "this
direction is deliberately dead here" and stops the search.

## Successor policy

When the focused node is destroyed, hidden, or moved out, the store picks a
successor in this order: next visible sibling → previous visible sibling →
parent's `lastFocusedId` (excluding the departing node) → parent, if focusable →
nearest visible leaf in depth-first order → null.

A new event fires **only** when the store chose for you, never on an explicit
`focusNode`:

```ts
'focus.successor': { from: NodeId; to: NodeId | null; reason: 'destroyed' | 'hidden' | 'moved' }
```

The existing `node.transitioned` still fires for the FSM transitions themselves.

## DOM adapter

**Roving tabindex.** Exactly one window wrapper carries `tabIndex=0` — the one
matching `store.focusedId`, or the first visible leaf when nothing is focused.
Every other wrapper is `-1`. The whole tree therefore costs one tab stop to
reach, regardless of window count.

**Tab is not intercepted.** Consumer content keeps native tabbing entirely.
Windease renders consumer chrome, and that chrome contains inputs, buttons and
third-party widgets; stealing Tab breaks all of them.

**Feedback guard.** The adapter both writes DOM focus from model focus and
raises model focus from `focusin`. It must flag in-flight model→DOM application
and ignore the `focusin` it causes, or the two directions oscillate. This is the
trap most likely to be reintroduced later.

**Default keymap.** Fixed in 1.2.0. Because the mapping is isolated in the
adapter, a user-supplied keymap is a later parameter on one function rather than
a refactor.

| Key | Intent | Active when |
|---|---|---|
| `ArrowLeft/Right/Up/Down` | directional | the event target **is** a window wrapper |
| `Home` / `End` | `first` / `last` | the event target **is** a window wrapper |
| `F6` / `Shift+F6` | `cycleNext` / `cyclePrev` | anywhere, including inside content |

Arrows are gated on the wrapper being the event target. Without that gate,
pressing Left in a text input inside a panel navigates away mid-word.

`Cmd+\`` is **not** bound, reversing an earlier suggestion: browsers use it for
their own window switching. `Escape` is not bound either — drag already claims
it, and consumer modals claim it too.

**Announcements.** Moving real DOM focus announces the wrapper's accessible name
for free, so `announce()` covers only changes with no accompanying focus
movement: a successor chosen after a destroy, or a window relocated to another
zone. Keeping it narrow matters because a canvas host has no live region.

## Accessible name and roles

Split across the seam, per the DOM-independence tenet in CLAUDE.md: **core
carries the name, the adapter maps it onto ARIA.**

Core — `meta.title` becomes a **reserved key**, documented as the accessible
name, with a fallback to `kind` plus index. `node.meta` is node-intrinsic and
survives `moveNode`, which is the right lifetime for a window's name, and this
adds no new surface to `Node`. It follows the existing precedent of reserved
keys on `membership.placement` (`pinned`, `locked`, `size`).

Adapter — containers and window wrappers get `role="group"` with `aria-label`
drawn from that name.

Explicitly rejected: `role="application"`, which suppresses screen-reader browse
mode, and `role="region"` on every window, which floods landmark navigation. A
consumer wanting a landmark can label a top-level zone itself.

## Boundary with affordance work

Keyboard-operable affordances are a second keyboard surface, developed
concurrently. The split:

- **Core fields are the strategy's** — `orientation`, `valueNow`, `valueMin`,
  `valueMax`, `label` on `Affordance`. The strategy already computes those
  numbers in `dispatchAffordance`, so it emits them rather than making React
  re-derive them. No `aria`-prefixed names in core; the adapter does that
  mapping.
- **`AffordanceHandle` (`Container.tsx:334`) is this workstream's.** It is
  pointer-only today — no `tabIndex`, no keydown, and it dispatches only
  `kind: 'drag'`.

Two hooks for it already exist and are **dead**: `LayoutEvent.kind` admits
`'key'` with `payload.key` (`layout-types.ts:127`), and `'keypress'` is a
`BuiltinAffordanceKind` (`layout-types.ts:71`). Nothing constructs or handles
either. They are the seam for keyboard-operable affordances; if that work does
not use them, delete them rather than leaving a third dead declaration.

**Affordance handles must not become tab stops.** A sixteen-pane workbench has
fifteen gutters, and putting each in the tab order recreates exactly the problem
roving tabindex solves for windows. They get `tabIndex=-1` and are reached from
the focused window, not by tabbing.

No collision with window navigation: arrows are gated on the event target
*being* a window wrapper, and a handle is not one.

## Reduced motion

`Container` consults `matchMedia('(prefers-reduced-motion: reduce)')` and forces
`effectiveSettleMs` to 0, guarding for absent `matchMedia` under SSR.

## Testing

- **Resolver** — pure unit tests over synthetic rects, no jsdom: direction
  half-planes, cross-axis penalty, ties, nesting, empty candidate sets, and the
  strategy override's three return values.
- **Successor policy** — store tests via `recordEvents`, asserting after the
  mutation returns. An `expect` inside a `store.events` handler cannot fail a
  test, because `TypedEmitter.emit` swallows listener throws.
- **Adapter** — jsdom for roving tabindex and the `focusin` round-trip,
  including a test that pins the feedback guard.
- **e2e** — Playwright, where jsdom lies about focus. Tab reaches the tree in one
  stop; arrows move between windows; F6 cycles from inside a text input; **an
  arrow key pressed inside a text input does not navigate**; focus survives
  destroying the focused panel.

## Out of scope

- Keyboard move, resize, split and unsplit. Navigation first.
- A visible window switcher. The F6 cycle ships and so does the ordered, named
  list a switcher renders from; the overlay is the consumer's.
- Custom keymaps.
- Multi-select.
- A DOM-proxy adapter for canvas hosts — see TODO.md. windease has no WebGL in
  its dev dependencies and no way to test one in CI. The existing WebGL consumer
  (`blitsklieg`, `packages/core/dev/tube-lab`) is a React DOM app that draws into
  a canvas from `placements`, so it uses the DOM adapter unchanged.
