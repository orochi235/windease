# Page strategy

For whoever works on windease's layout strategies next. **Status, 2026-09-19: built on branch
`page-strategy`.**

`pageStrategy(inner)` shows one page of a container's children at a time and hands that page to
`inner` to lay out. It is a wrapper strategy, like `desktopStrategy(inner)`. One strategy covers
two products: virtual desktops, where each window is assigned a page, and pagination, where
children flow onto the next page when `inner` runs out of room.

## Config

Page's own keys sit at the top level. `inner`'s keys go under `config.inner`, so the two
strategies never share a key name. Desktop and floating still share one namespace with their
inner; page is the first wrapper that nests.

| Key | Default | Meaning |
| --- | --- | --- |
| `mode` | `'assigned'` | `'assigned'`: a child's page is `placement.page`. `'flowed'`: children fill pages in `childOrder`. |
| `pages` | `1` | Assigned only: the fewest pages there are, so empty desktops still exist. |
| `bar` | `0` | Pixels reserved for the page switcher. `0` reserves none and emits no switcher affordances. |
| `barSide` | `'bottom'` | `'top'` or `'bottom'`: which edge the bar sits on. |
| `inner` | `{}` | `inner`'s own config. |

## State

`{ page, inner }`: the current page, zero-based, and `inner`'s state. `inner`'s state is shared by
every page. Floating keys its state by child id, so sharing costs nothing.

A `page` past the last page shows the last page. Layout never writes that back, so the stored
page comes back into range if children return.

## Assigned mode

- A child's page is `placement.page`. A child without one, or with one that is not a
  non-negative integer, is on page 0; an invalid value is traced.
- There are `max(pages, highest page + 1)` pages.

## Flowed mode

`inner` runs with `overflowMode: 'unplaced'` forced into its config. What it places is page 0;
what it reports `unplaced` starts page 1, and so on. A pass that places nothing puts its first
child on a page of its own, so the loop always ends. Every layout costs one `inner` run per page,
since counting the pages needs them all.

An `inner` without an `'unplaced'` overflow mode never reports anything unplaced, so every child
lands on page 0. Only `strip`, `grid` and the packers honor the mode today.

## Result

- `placements` — `inner`'s, for the current page's children, inside the area the bar leaves.
- `unplaced` — every child on another page, plus whatever `inner` could not place.
- `channels` — every child gets `{ page }`, merged over `inner`'s channels for the current page.
  A host reads it to label a window's page or build a "send to page" menu.
- `affordances` — `inner`'s, plus one `click` affordance per page, splitting the bar evenly. Each
  is named `Page 2 of 4` and carries `meta: { page, count, current }`. The affordance is an
  invisible button; the host draws the switcher beneath it, from the same meta.
- `overflow` — `inner`'s, for the current page.

## Switching pages

Both paths go through the strategy and write container state, so a switch snapshots and undoes.

- **A switcher affordance** is clicked: `reduce` sets `page` to its `meta.page`.
- **A command.** New, and not specific to paging: a strategy may define
  `command(state, cmd, context)`, and `ContainerHost.command(cmd)` runs it and stores the state it
  returns. `ContainerLayout` exposes the same `command`, so a container's `overlay` and
  `useContainerLayout` reach it. Page answers `{ type: 'page', to }`, `{ type: 'next' }` and
  `{ type: 'prev' }`. `next` on the last page and `prev` on the first stay put. A command is
  refused under `lock.arrange`, as an affordance dispatch is.

`LayoutEvent` is not widened for commands: every existing `reduce` assumes an `affordanceId`.

## Arrival

`placement` survives `moveNode`, so a window dragged in from another page container carries that
container's page number. In assigned mode it has to land on the page being shown instead.

A pure strategy cannot see an arrival, and the store cannot write it, because the current page is
in strategy state whose shape the store does not know. So strategies get a second new hook,
`land({ ids, state, store, parentId, options, items, container })`. `ContainerHost` calls it for
the children that arrived by a move from another parent, synchronously at the end of that move,
so its writes join the move's undo step. Page writes the page shown into each one's
`placement.page`. A child registered with a page keeps it.

The hook runs only while a host is attached. A `moveNode` into a container nothing is rendering
leaves the carried page as it was.

## Also delegated

- `dispatchAffordance` and `reduce` pass `inner`'s affordances through, with `inner`'s options
  and the current page's items.
- `navigate` delegates to `inner` over the children on the same page as the one navigated from,
  in assigned mode. In flowed mode it answers `undefined`, since it is handed no container size to
  paginate with, and geometry resolves the move.
- `canAccept` is not implemented, so every drop is accepted. It receives no state, so it cannot
  know which page a capacity check should count.
- `preview` is not passed to `inner`: its insert index counts every child, not the page's.
- `config.inner` is not checked against `inner`'s `configSpec`; page's own spec types it only as
  an object.

## Out of scope

- **Dragging a window onto a page's switcher** to move it there. There is no drop target on an
  affordance. From code, `patchPlacement(id, { page })` moves it.
- **`show` and `fallback`,** stack's keys for which child shows after a drop or a close. The store
  reads both straight from config and writes stack's `activeId`, so reusing the names on page
  would set a key page does not read. In assigned mode a drop already lands on the shown page, and
  an emptied page past `pages` falls back to the last one through the clamp above.
- **Sliding between pages.** Other pages are unplaced, not laid out off-screen.

## Coverage

- `src/layout/page.test.ts`, headless: both modes, page counts, the clamp, the bar, channels,
  affordances, reduce, command, and passing config and events to `inner`.
- `src/container-host.pages.test.ts`: the two host paths, locks, a multi-node move, and one undo
  step for a move plus its land.
- The **Pages** Ladle story: four desktops with a drawn switcher, Page Up / Page Down, a menu per
  window that sends it to another desktop, and an inbox to drag windows in from; and a flowed grid
  of tiles that grows a page as tiles are added. `e2e/pages.spec.ts` drives both.
