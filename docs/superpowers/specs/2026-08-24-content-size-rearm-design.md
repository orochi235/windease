# Handing a pinned pane back to measurement

**What this is:** the design for closing the last untested half of content
sizing, and the recorded answer to a `[HIGH]` TODO question that turned out to
be asking for something no consumer wants.

**Who it's for:** whoever implements it, and whoever later asks why windease has
no `<Workspace>` primitive.

**The question it answers:** a pane declaring `hints.sizing: { h: 'content' }`
tracks its contents until a gutter drag pins it. Going the other way — handing it
back to measurement — is documented and works, but nothing proves it and nothing
in the Ladle stories lets you do it.

## What already exists

`stripStrategy` resolves an item's requested extent as
`explicitAxis(item) ?? naturalAxis(item)` (`src/layout/strip.ts:106`): a
measurement is a stated size that loses to an explicit `placement.size`. A gutter
drag writes that size, so the pane stops tracking. Clearing it —
`store.patchPlacement(id, { size: { h: undefined } })`, which deletes the key
rather than storing `undefined` — restores the measurement.

The README's **Sizing a pane to its contents** section documents both directions.
Covered today: `strip.natural.test.ts` asserts a measurement yields to an explicit
size, `e2e/content-sizing.spec.ts` asserts a gutter drag pins the pane, and the
`ContentSizing / ContentSizedDock` story shows a dock tracking its contents.

Uncovered: the return trip. No test clears a size, and the story has no control
that does.

## What ships

- **A unit test** in `src/layout/strip.natural.test.ts`: an item with
  `sizing: 'content'` and no `placement.size` tracks its `natural` extent again,
  the mirror of the existing "yields to an explicit placement size".
- **A release control** on `ContentSizedDock`: a button calling
  `patchPlacement(id, { size: { h: undefined } })`, making the pin/release cycle
  operable rather than only described.
- **A browser spec** beside the existing pin test in
  `e2e/content-sizing.spec.ts`: drag the gutter, add content and watch the pane
  hold still, press release, watch it return to its content height.

No new API. The composition is the API, and a `<Zone autoFit>` prop or a
`store.clearSize` helper would be a second way to say what `patchPlacement`
already says.

## Why there is no `<Workspace>`

The TODO asked whether windease needs a primitive owning multi-zone arrangement —
collapsible sidebars, gutters between separate roots, full-screen takeover of one
zone. The evidence says no, yet.

`brainhouse/client` is the only application consumer. It composes its shell from
one root container plus its own CSS, and the two things it hand-rolls against the
library are both *sizing*: a loop that fits a section to its content and stops
once the user drags a gutter, and a clamp capping a sidebar's width. The first is
this recipe. The second is `hints.maxSize`. Neither is an arrangement primitive,
and nothing in that app wants one. (It is pinned at `^0.8.0`, so its shell
predates all of this — `splitStrategy` no longer exists — but what it reaches for
is the evidence, not the version it reaches from.)

So the TODO entry becomes a `[MED]` note recording that. What stays genuinely
unowned is the arrangement itself — a gutter *between* separate roots, a
collapsible sidebar, full-screen takeover — and whether zones should know about
each other ("dock at the bottom of whichever zone has focus"). Those wait for a
consumer to ask for them, the same rule that deferred floating chrome's z-order.

## Testing

The two new tests are the deliverable. Nothing else changes, so the existing
suites are the regression net.
