# Desktop strategy

For whoever works on windease's layout strategies next, and for astv, its first consumer.
**Status, 2026-09-13: built on branch `desktop-strategy`.**

`desktopStrategy(inner?)` lays windows out the way a desktop does: each at a position its host
chose, overlapping freely, stacked front to back, and minimizable. Items marked as icons are
tiled underneath by `inner`. astv uses it for diagrams on its WebGL wall, calling the strategy
directly with no store, so the first version is driven entirely by what the items carry — no
drags, no strategy state of its own.

## Why not `floatingStrategy`

`floatingStrategy` keeps each panel's position in strategy state as a sticky corner anchor, moved
by drag events. A desktop's position is the host's to write, so it lives in the placement bag.
Putting both models in one strategy would make every config key say which model it belongs to.

## Layers

- An item whose placement has `icon: true` is an **icon**; every other item is a **window**.
- `inner` receives the icons, plus any window with `minimized: true` when `minimize` is `'icon'`.
  Those minimized windows arrive with `natural` set to `iconWidth` × `iconHeight`, since their own
  size is the window's.
- With no `inner`, there is no icon layer: icons are unplaced, and `minimize: 'icon'` shades
  instead, with a `layout` trace naming the window.

## Windows

Windows are placed in item order. Under a store, item order is the parent's `childOrder`.

- **Size** — `placement.size` over `natural`, over `hints.preferredSize`, per axis. A window with no
  width or no height is unplaced, with a trace.
- **Position** — `x` and `y` from the placement, used as given: no clamping. A window missing
  either takes the next cascade slot, `(k × cascade, k × cascade)` for the k-th such window.
- **Shade** — a minimized window that is not an icon keeps its `x`, `y` and `w`, and its `h`
  becomes `shadeHeight`.
- **Stacking** — the window at rank `r` among placed windows gets `z = r + 1`. Icons stay at `0`,
  so every window is above every icon. On astv's wall `z` is depth, which is what stacking is
  there; `Rect.z` needs no new meaning.

Raising a window is moving it to the end of its parent's `childOrder`. That is a normal store
mutation: it snapshots, it undoes, and a `pinned` window holds its slot, so a window pinned last
stays on top.

## Result

- `placements` — the icons as `inner` placed them, and the windows.
- `affordances`, `channels` — `inner`'s, passed through. The desktop emits none.
- `unplaced` — `inner`'s, plus unsized windows, plus icons when there is no `inner`.
- `overflow` — how far any window's right or bottom edge passes the container, combined with
  `inner`'s by maximum per axis. Absent when both are zero.
- `canAccept` and `navigate` delegate to `inner` over the icon layer, as `floatingStrategy` does.
- State is `{ inner }`, seeded from `inner.initialState` over the icon layer; `reduce` forwards
  `inner`'s events.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `minimize` | `'shade'` | `'shade'` rolls a minimized window up in place; `'icon'` hands it to the icon layer |
| `shadeHeight` | `28` | height of a shaded window |
| `iconWidth`, `iconHeight` | `64` | size a minimized window takes in the icon layer |
| `cascade` | `24` | offset between successive windows with no position |

Plus `inner`'s keys. `ConfigSpec` has no object type, hence two icon keys.

## DOM host

`<Container>` and the presets set `z-index` to `Math.round(z)` on a child whose `z` is nonzero. No
shipped strategy emitted a nonzero `z` before this one; a custom strategy that did now gets a
`z-index` too.

## Out of scope

- **Dragging and resizing.** A later `reduce` would write `x`/`y` and `size` into the placement.
  Nothing here would change for it.
- **Raise on focus as a library helper.** Every focus change would push an undo step, which needs a
  history decision first. The story does it in host code.
- **Maximize** and keyboard movement between windows.

## Coverage

- `src/layout/desktop.test.ts`, headless: layers, `z`, cascade, shade, the icon fallback, overflow,
  unplaced items, config spec.
- A `<Container>` test that a nonzero `z` becomes `z-index`.
- The **Desktop** Ladle story: overlapping windows over an icon grid. Pressing a window raises it,
  its button minimizes and restores it, and a control switches `minimize`.
  `e2e/desktop.spec.ts` checks what is on top with `elementFromPoint`.
