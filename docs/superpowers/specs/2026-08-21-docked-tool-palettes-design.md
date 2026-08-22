# Docked tool palettes — content-driven sizing and gutter keys

For whoever implements this. Assumes windease fluency (`docs/concepts.md`) and
the two tenets in `CLAUDE.md`: the core is DOM-independent, and instrument
liberally with `trace`.

Closes the two genuinely-open items in `TODO.md`'s "Wishlist: docked tool
palettes". The other three in that section are already resolved or shipped;
overflow *policy* stays parked until a second consumer asks for it.

Two independent halves, one spec because one consumer wants both:

- **Content-driven sizing** — a pane can be as tall as its contents without the
  consumer measuring the DOM and writing `preferredSize` back.
- **Keyboard gutter resize** — a gutter is reachable and operable from the
  keyboard, with the ARIA a screen reader needs.

## Content-driven sizing

Today strip derives an extent from `placement.size`, `hints.preferredSize`, or
an equal share (`src/layout/strip.ts:114-131`). There is no way to say "as tall
as my contents", so a consumer measures the rendered pane and writes
`preferredSize` back — a layout pass keyed on the output of a layout pass.

### Declaration

```ts
hints.sizing?: { w?: 'content'; h?: 'content' }
```

It joins `minSize` / `maxSize` / `preferredSize` because it is the same kind of
statement: node-intrinsic layout advice, not per-membership intent. Per-axis
means a palette declares `h: 'content'` and a horizontal strip, which sizes on
`w`, ignores it — no separate opt-out needed.

The key is added to `Node['hints']`, to `LayoutItem['hints']`, and to the
projection between them in `src/layout-node-adapter.ts:15-20`.

### Measurement and delivery

A `NaturalSizeRegistry` modeled on `GeometryRegistry`
(`src/react/focus/useGeometrySource.ts`): a `Map`, a value-deduping `commit()`,
a `subscribe()`. `<Container>` observes only children whose node declares
`hints.sizing`, so ordinary children cost nothing. A registry change drives a
relayout through the path `ContainerHost.observe()` already uses for viewport
changes.

The measurement reaches a strategy as `LayoutItem.natural?: Size`, filled
alongside the existing projection in `src/layout-node-adapter.ts:13`. This is
the DOM-independence tenet's stated rule — measurement is an input, never a
call. A `layout()` call with no `natural` present behaves exactly as it does
today, so headless callers and existing tests are unaffected, and no core type
carries a value only a DOM can resolve.

### Precedence in strip

`placement.size` → `natural` → `hints.preferredSize` → equal share.

A resolved `natural` joins the explicit set that `clampExplicitSizes` sees, so
a column of content-sized palettes above one flex pane works, and `minSize` /
`maxSize` clamp it like any other size.

**A gutter drag pins the pane.** It writes `placement.size`, which outranks
`natural`, so the pane stops tracking its content. That is the right reading of
an explicit user override, but it is one-way unless documented: clearing the
size resumes tracking, and the README pattern must say so.

### Convergence

A pane's natural height depends on the width the layout just assigned it, so
this settles in two passes rather than one: layout runs with no measurement and
the pane falls back; the adapter measures; the registry commits; layout re-runs
with `natural`.

It converges only if the measured element is not the one the main-axis extent
was written to. Measure the child's content, never the positioned wrapper. A
0.5px deadband on `commit()` keeps float churn from oscillating.

## Keyboard gutter resize

Panels are already reachable and labelled — the child wrapper carries
`tabIndex` / `role="group"` / `aria-label`, and 1.2.0's keyboard navigation
moves between them. Gutters are still pointer-only.

All of this lands in `AffordanceHandle` (`src/react/Container.tsx:371`), which
already owns the pointer path. A key press synthesizes the same
`{ affordanceId, kind: 'drag', payload: { dx, dy } }` the pointer sends, so the
strategy clamps once where it already clamps. Deliberately not a second clamp.

`keypress` on `BuiltinAffordanceKind` and `LayoutEvent`'s `kind: 'key'` stay
dead and `@deprecated`; they are removed at 2.0.0 (see `TODO.md` Loose ends).

### ARIA

On the outer hit div, following the W3C APG window-splitter pattern:
`role="separator"`, `tabIndex={0}`, `aria-orientation` from
`bounds.orientation`, and `aria-valuenow` / `aria-valuemin` / `aria-valuemax`
from `bounds`, rounded — sub-pixel floats are noise to a screen reader.

**The accessible name is not yet available.** `Affordance.bounds`
(`src/layout-types.ts:113-122`) carries `orientation`, `valueNow`, `valueMin`,
`valueMax`, `atMin`, `atMax` and no name field; `TODO.md` claims otherwise and
is wrong. The adapter composes one from `affordance.affects` via
`accessibleName()` (`src/focus/name.ts`) — "resize Palette 2 and Palette 3" —
which keeps pane titles out of the strategy and gives a consumer who set
`meta.title` a good name for free.

### Keys

Arrow keys along the orientation axis step. The perpendicular pair is ignored
so it bubbles to pane navigation. `Home` / `End` jump to `valueMin` /
`valueMax`. Step defaults to 8px, overridable via an `affordanceKeyStep` prop
on `<Container>` (named for the existing `affordanceHitPad`).

### Two omissions, both deliberate

**No live region.** Under `resizeMode: 'neighbor'` a step is clamped by
whichever of the two panes binds first, so it can be truncated by the
*neighbor's* minimum while the focused pane is nowhere near its own. `bounds`
describes the dragged child, so announcing from `atMin` would state something
false. `aria-valuenow` carries the truth without the lie.

**Gutter tab stops are opt-out.** Every gutter being a tab stop is correct by
the APG and miserable in a sixteen-pane dock, so an `affordanceTabStops` prop
on `<Container>` disables them, defaulting on.

### Locks need no new handling

`ContainerHost` filters resize-locked affordances out of the layout result
(`src/container-host.ts:338`), so a locked gutter never renders and there is no
handle to focus. Keyboard inherits the suppression.

## Testing

The interesting sizing logic is headless, which is the payoff for delivering
measurement as an input. Strip's precedence rules — `natural` beats
`preferredSize`, loses to `placement.size`, is clamped by min/max, joins the
explicit set beside a flex sibling, drives `overflow` when naturals exceed the
container — are plain `layout()` calls with a hand-fed `LayoutItem.natural`, in
the `node` project.

jsdom has no `ResizeObserver` and `vitest.setup.ts` adds no polyfill. React
tests write into the registry and `commit()` directly, as
`useGeometrySource.test.tsx` already does. Faking `ResizeObserver` would test
the fake.

Playwright takes the two things jsdom cannot: a palette that really grows when
content is appended, and real Tab order through gutters.

Three cases to pin specifically:

- Convergence asserts a **bounded number of layout passes**. "It settled" is
  the claim, and only a count proves it.
- A content-sized pane with no measurement yet falls back on the first pass
  rather than flashing at zero.
- `natural` never reaches `serialize`. It is not store state, and a v5 snapshot
  carrying it would be a silent contract break.

Each is broken deliberately and watched go red before it is committed — a
regression test written alongside its fix may be vacuous.

## Open

Whether this lands in the unminted 1.2.0 or becomes 1.3.0. Releasing is the
user's call and nothing here forces it either way.
