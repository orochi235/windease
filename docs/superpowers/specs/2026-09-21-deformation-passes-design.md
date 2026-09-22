# Deformation passes: perspective, swell and bow over any layout

**Status, 2026-09-21: designed, unbuilt.** Nothing in this document exists in the
tree yet.

For whoever implements this. It adds four small pieces of core surface that let a
layout be drawn in perspective, magnify under the cursor, and bend onto a curve —
without any of them knowing about the others, and without a new strategy. The use
case that drove it is a digital card game's duel board; the second consumer for
every piece is a macOS-style dock, which the preset corpus already holds.

## Why this is core's problem and not the app's

The obvious way to tilt a board is CSS: `perspective` and `rotateX` on the
container, with a flat layout inside it. That breaks three ways, and all three
break inside this library rather than in the app:

- **Hit-testing.** `DragController` measures elements with
  `getBoundingClientRect()`, which on a 3D-transformed element returns the
  axis-aligned bounding box of the projected quad. Every drop target inflates and
  overlaps its neighbors, and `insertionIndexByMidpoint()` gets midpoints that are
  not where the child looks. Drops land in the wrong row.
- **Drag deltas.** The pointer moves in screen space, the container's coordinates
  are pre-transform, and the ratio between them varies with depth. A ghost tracks
  the pointer at the near edge and drifts further the deeper it goes.
- **Fit arithmetic runs in the wrong space.** A strip fitting nine children into
  900px is really fitting them into a trapezoid 900px at the near edge and 500px
  at the far one. Uniform extents in table space are non-uniform on screen, so
  `overflow` is computed against a width that does not exist.

Doing the projection as arithmetic and emitting screen-space rects fixes all
three at once: every existing consumer keeps working unchanged, because what it
receives is already where the thing is.

Two signs this is the shape the library was already reaching for. `Rect.z` is on
every placement and documented as "`0` from a 2D strategy, which is where a 2D
layout genuinely sits" — nothing has ever set it to anything else. And
`LayoutResult.channels` is reserved for "an opacity, a rotation, an LOD tier",
numbers the core carries and never reads.

## The surface

Four pieces. None depends on another.

### 1. `pointer` — a transient input on `layout()`

```ts
layout(input: {
  items; container; state; options;
  preview?: LayoutPreview;
  pointer?: { x: number; y: number };   // new
})
```

Container-relative, present only while a pointer is over the container, never
persisted and never written to the store. It copies `preview`'s contract exactly:
a strategy or pass that ignores it still works, and the host degrades to the
static layout.

It cannot be container state — state is snapshotted, and a hover position in a
saved workspace is junk. It cannot be declared config either: config is diffed
against what the last render declared, so a value that changes every pointermove
would rewrite `container.config` at pointer rate and flood history.

### 2. `overflowMode: 'overlap'` on strip

Strip has three answers to "the panes want more extent than I have" and none of
them is what a hand of cards does. `squeeze` shrinks until floors bind — a card
at 60% is unreadable. `scroll` is the wrong gesture. `unplaced` hides the eighth
card. A hand keeps every card at full size and **increases the overlap**.

That is a fourth answer to the same question, computed from the overshoot strip
already measures internally, so it belongs in the enum rather than in a pass.

```ts
overflowMode?: 'squeeze' | 'scroll' | 'unplaced' | 'overlap';
peek?: number;   // px of each child that stays visible; default 24
```

Spacing solves for the container width: children keep their full extent and the
step between them shrinks until they fit. `peek` floors the step — the direct
analogue of `squeeze`'s `minSize` floor, and for the same reason, since below it
a child stops being separately clickable. When `peek` cannot be honored the
remainder is reported as `overflow`, exactly as `squeeze` reports what its floors
would not absorb. Composes with `maxItems`, which caps by count first.

The last child in the run is fully visible; every earlier one shows `step` px.
Children overlap in child order, so a host draws them in that order and the
last-painted wins the pointer — which is how a real client resolves a fan.

This retires the negative `gap` the prototype leaned on. A negative gap is the
static version: you pick an overlap up front and it is wrong at every count but
one.

### 3. The passes

A pass is a pure function of the same arguments the strategy got, plus the result
it produced:

```ts
type Pass<TState = unknown> = (
  result: LayoutResult,
  args: { items: LayoutItem[]; container: Size; state: TState; options: Record<string, unknown> },
) => LayoutResult;
```

**The rule for where a pass writes:** to the rect when it changes where a child
is or how big it is, to a channel when it only changes how the child looks. A
consumer that ignores every channel still gets a correct, operable layout.

| Pass | Deforms by | Writes to rect | Channels |
| --- | --- | --- | --- |
| `tilt` | depth | `x`, `y`, `w`, `h`, `z` | `scale`, `keystone` |
| `swell` | cursor proximity | `x`, `y`, `w`, `h` | `lift`, `focus` |
| `bow` | curvature | — | `angle` |

**`tilt(camera)`** maps table space to screen space through a one-point
perspective. `camera` is `{ tilt, horizon, vanishX? }`: `tilt` 0 is top-down and
leaves every rect untouched, `horizon` is where the far edge converges as a
fraction of container height, `vanishX` defaults to the container's midline.

Its contract, which the tests check rather than any particular formula:

- The near edge (`y = container.h`) is fixed. Nothing moves there.
- Scale is monotonic in depth, and `z` is the depth in 0..1, far = 1.
- **The map is invertible in closed form.** This is a hard requirement, not a
  nicety — `warp` needs the inverse for gestures, and a numeric solve inside a
  pointermove is not acceptable.
- `keystone` is the far-edge-to-near-edge width ratio of the child's own quad, so
  a host that wants true trapezoid fidelity can build a `matrix3d` from it and a
  host that does not can ignore it and use `scale`.

**`swell(options)`** reads `pointer` and displaces and scales each child by a
falloff from the cursor. `{ reach, gain, lift, axis }`: `reach` is the falloff
radius in px, `gain` the peak scale multiplier, `lift` the peak displacement
along the cross axis. With no `pointer` it returns the result untouched, so the
static layout is the no-cursor case and needs no separate path.

Dock magnification is `gain` with no `lift`. A card hand parting around the
pointer is `lift` with a small `gain`. Same pass.

`focus` is the falloff's own value for that child, 0 at the edge of `reach` and 1
under the cursor, so a host can drive emphasis it cares about — a shadow, a
z-order, a label that only appears on the focused card — without recomputing the
falloff.

**`bow(amount)`** bends a run onto a circle of radius derived from `amount` and
the run's extent, centered on the cross axis beyond the container, and emits each
child's tangential `angle`. It does not touch rects: a rotated child covers the
same area centered on the same point, so the rect stays truthful and the angle is
decoration.

### 4. `warp(strategy, passes)`

Returns a `LayoutStrategy` so `strategyId` resolution, `configSpec` checking and
the affordance paths keep working:

```ts
const handStrategy = warp(stripStrategy, [bow(0.4), swell({ reach: 160, lift: 28 })]);
```

`layout()` runs the base strategy, then each pass in order, threading the same
args. The composed `configSpec` is the base's keys plus each pass's, so a typo in
a camera key is caught like any other.

**Gestures run the inverse.** `reduce`, `dispatchAffordance` and `command` all
receive coordinates in screen space and must hand the base strategy table space,
so `warp` runs `LayoutEvent.point`, `dx` and `dy` back through each pass's inverse
in reverse order before forwarding. A pass that moves nothing (`bow`) supplies
the identity. This is the arithmetic the CSS approach gets silently wrong, and
it is the single place in this design where a bug will be subtle, so it gets the
most direct test: a drag of *n* screen pixels at a given depth must move the child
under the pointer to the position the pointer is at.

Affordance rects come back through the forward map like any other rect, so a
strip's seams stay under the seams as drawn.

## Channels are a transport, not a vocabulary

The channel keys above (`scale`, `keystone`, `lift`, `focus`, `angle`) are
documented in the README beside each pass. **No `channelsToTransform()` helper
ships.** `LayoutResult.channels` commits deliberately to "the transport, not a
vocabulary it has no predicate over", and shipping a helper that reads the keys
would quietly undo that. The story carries the ten-line adapter that maps them
onto a `matrix3d`, as the worked example.

## Edge cases

| Case | Behavior |
| --- | --- |
| `tilt: 0` | Every rect identical to the base result; no channels emitted. |
| `horizon` ≥ 1 or ≤ 0 | Read as absent, like `gap`'s handling; falls back to the default. |
| No `pointer` | `swell` returns the base result untouched. |
| `pointer` outside the container | Same as absent. A host may keep sending it during a drag that leaves the container; the falloff handles it. |
| Empty run | Every pass returns the result untouched. |
| One child, `overflowMode: 'overlap'` | No overlap possible; behaves as `squeeze`. |
| `peek` ≥ child extent | Read as absent. |
| `peek` ≤ 0 or non-finite | Read as absent, default 24. |
| Passes composed in either order | Both orders produce a valid operable layout; `tilt` last is the documented order, since it is the one that ends in screen space. |
| A pass with no inverse | Refused at `warp()` time with a `WindeaseError`, not at gesture time. |

## Testing

Core tests stay headless; none of this touches the DOM.

- Each pass: pure input/output against its contract, plus `f(f⁻¹(p)) === p` for
  every pass that claims an inverse, over a grid of sample points and depths.
- `tilt`: near edge fixed, scale monotonic in depth, `z` in 0..1.
- `swell`: no `pointer` is identity; peak is at the cursor; total displacement
  sums to zero across a symmetric run.
- `overflowMode: 'overlap'`: step shrinks with count, floors at `peek`, reports
  the remainder as `overflow`, last child fully visible, composes with `maxItems`.
- `warp`: gesture round-trip — a screen-space drag lands the child where the
  pointer is, at three depths.
- Playwright, against the story: drag a card from the hand onto a battlefield
  band and assert it lands in the band under the cursor, not the one behind it.
  That is the test that would fail under the CSS approach.

## The story

`Exotic / Board` — a tilted table with two battlefield bands receding toward a
horizon, a fanned hand at the near edge, and three piles on a rail. It integrates
all four pieces: bands are `warp(strip, [tilt(camera)])`, the hand is
`warp(strip, [bow, swell])` with `overflowMode: 'overlap'`, and the hand's card
limit is strip's existing `maxItems` with its `canAccept` refusal.

Operable, not a render:

- Drag a card from the hand onto a battlefield band, and back.
- Click a permanent to turn it a quarter — a `hints.preferredSize` swap, which
  every strategy already honors, so the band reflows around the new footprint.
- Hover the hand and watch the fan part.

**No trademarks.** Invented card names, CSS-drawn art, and no product, set or
character named in source, comments, class names, test ids or the preset's
`source` string. The genre is named generically: a duel board.

## Out of scope

- A rules engine. Nothing validates a move.
- Combat: a transient band appearing between two battlefields, pairing two
  containers' children against each other. It is a genuine layout problem and a
  good follow-up, but it is additive and it is where game rules start leaking in.
- A dock preset built on `swell`. The second consumer is the argument for the
  input, not work this change owes.
