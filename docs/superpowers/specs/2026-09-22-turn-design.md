# Turn: a rotation the layout reserves for

**Status: built** (2026-09-22).

For someone working on windease's layout core who needs to know why a rotated
child has two rects. Answers: where a node's rotation lives, which rectangle a
strategy reserves for it, and who moves the angle over time.

## The problem

A card turned sideways — tapped, in the duel board story — could not be
expressed. The story faked it by swapping `hints.preferredSize` behind the
library's back and drawing the turn with `100cqh`/`100cqw` and a
`translate(-50%, -50%) rotate(90deg)`. It came out square: an x-strip reads
`preferredSize` on its main axis only and gives every child the container's full
cross extent (`strip.ts:833-841`), so the box became 120 wide by band-tall.
Measured on the shipped story: the drag box was 204.1 × 204.1 and the card
computed 120 × 120.

The turn could not animate either, because tapping jumped the element from
static flow to `position: absolute` with container-query widths, and neither
interpolates.

## The model

Two rotations exist and they are different kinds of thing:

- **`hints.turn`** bears a footprint. The layout reserves the rotated
  axis-aligned box for it, so siblings flow around the turn.
- **the `angle` channel** is decoration. The layout reserves nothing, because a
  bowed child "covers the same area centered on the same point" — `bow`'s own
  rule, unchanged.

Both reach the screen; neither knows about the other.

`turn` is node-intrinsic, in `hints` beside `preferredSize` and `aspect`, so a
turned node stays turned wherever it is dragged. It is in degrees, any value,
not restricted to quarter turns.

## What a strategy reserves

The tight axis-aligned bounding box, recomputed at every angle:

```
turnedExtent(w, h, deg) → { w: |w·cosθ| + |h·sinθ|,
                            h: |w·sinθ| + |h·cosθ| }
```

| deg | reserved for 86 × 120 |
| --: | --------------------: |
|   0 |          86.0 × 120.0 |
|  35 |         139.3 × 147.6 |
|  45 |         145.7 × 145.7 |
|  90 |         120.0 ×  86.0 |

A turn animating 0 → 90 therefore grows its footprint as it goes and the row
makes room for it continuously. The alternative — reserving the 45° hull once,
so nothing reflows mid-turn — leaves every rotatable child sitting in permanent
slack, and was rejected for that.

One shared helper, `src/layout/turn.ts`, so no two strategies disagree.
**`stripStrategy` honors `turn`; `grid`, `justified`, the packers and `desktop`
ignore it** and say so in their docstrings, exactly as they already do for
`aspect`. Adding them later is additive.

## The rect contract

The placed rect stays the reserved box. The drawn box rides beside it:

```ts
interface LayoutRect {
  x: number; y: number; z: number; w: number; h: number;
  /** Only when turned. The rect above is what the layout reserved; this is
   *  the box the child is drawn at, centered in it and rotated about center. */
  turn?: { deg: number; w: number; h: number };
}
```

Everything that hit-tests — `insertionIndexByMidpoint`, `canAccept`, drop
routing — keeps reading `x/y/w/h` and is correct without changing. A turned
card's corners over-report; that is accepted and documented rather than fixed
with polygon hit-testing.

`view-dom` centers by arithmetic (`left = x + (w - turn.w) / 2`) and writes the
two rotations as custom properties, summed once:

```css
transform: rotate(calc(var(--wd-turn, 0deg) + var(--wd-angle, 0deg)));
```

`--wd-turn` comes from `rect.turn.deg`; a host sets `--wd-angle` from the
`angle` channel. A tapped card in a bowed hand gets both.

## Strip's cross axis

Strip gave every child the full cross extent, flat. The rule becomes: a child
fills the cross axis **unless it declares a shape** — `hints.aspect` or
`hints.turn` — in which case its cross extent is derived and it is aligned in
the row by a new `crossAlign: 'stretch' | 'center' | 'start' | 'end'` config,
default `'stretch'`.

This fixes card proportions independently of rotation: an 86 × 120 card in a
120-tall band derives 86 from its aspect instead of being stretched. It also
closes a gap `hints.aspect`'s docstring already admitted.

## Moving the angle

The clock is injected, never owned — the core stays free of `requestAnimationFrame`,
the same way `ContainerHost.setViewport()` is the real API and `observe(el)` is a
convenience over it. Three rungs; a consumer picks one:

```ts
store.setHints(id, { turn: 90 })          // 1. you drive every frame
store.turnTo(id, 90, { ms: 180, ease })   // 2. library interpolates
store.tick(nowMs)                         //    you call this from your own loop
driveWithRaf(store)                       // 3. DOM convenience over tick()
```

Rung 1 needed no new API: `setHints` already no-ops when the value is unchanged,
which is what a tween's final frame wants. `tick` takes the time rather than
reading a clock, so a headless test advances it with fake numbers and asserts the
exact angle at 40ms. `ease` is a plain `(t: number) => number` defaulting to a
cubic. React's hook wraps `driveWithRaf`, so React consumes the public surface
rather than being where the feature lives.

The interpolator is turn-specific. A second animated value adds a sibling setter
on the same tick, not a redesign.

**History.** A 180ms turn would otherwise push ~11 undo steps into a consumer
bracketing on `node.*`. `turnTo` emits `transaction.begin { label: 'turn' }` and
the settling tick emits `transaction.end` — the pair whose contract at
`store.ts:113` already says to bracket history on it. Spanning frames is fine;
these are events, not a callback scope. The pending-turn map is transient and
never snapshotted.

## Testing

Core tests stay headless: `turnedExtent` is a table of angles, strip's cross
sizing is rects, and the tween is `tick` against a fake clock. The duel board
story is the integration — its click becomes
`turnTo(id, tapped ? 0 : 90, { ms: 180 })` and `.xb-card--tapped` is deleted.
The Playwright spec asserts a tapped card's box is 120 × 86 and that its
neighbors moved.
