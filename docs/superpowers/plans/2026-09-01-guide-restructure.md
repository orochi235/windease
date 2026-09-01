# Guide restructure — outline

**What this is:** the section order for a published guide, and where each
section's prose and live demo come from. Written before any page exists, so the
populate step is mechanical.

**For:** whoever writes the pages, in this session or a later one. Assumes
familiarity with the codebase, not with why this order.

**Reader of the guide itself** (which every decision below is calibrated to):
someone wiring windease into a React app. Knows React. Does not know that
`container` and `membership` answer opposite questions, and will not guess it.

---

## Where the order comes from

Not the README's. That order is accretive — sections landed as features shipped,
so `Resize` sits beside `Drag and drop` as a sibling and hides that resize is
strictly cheaper to adopt.

The engine's own order is visible in what each Ladle story has to mount. Every
story is a subset of one provider stack, and the subsets are not arbitrary:

```
<Provider>                          store — the tree exists
  <StrategyRegistryProvider>        strategies — it has placements
    <GeometryProvider>              ─┐ keyboard
      <FocusProvider>               ─┘ (always together, never one alone)
        <DragProvider>              drag between containers
          <Container> / <Zone>
```

Counting the 22 stories against that stack gives four tiers:

| Providers mounted | Stories | What is reachable |
| --- | ---: | --- |
| `Provider` + `StrategyRegistryProvider` | 8 | Layout, **resize**, split, overflow, throttling |
| `+ DragProvider` | 4 | Drag between containers, drop intent, stacking |
| `+ Geometry` + `Focus` | 4 | Navigation, moving a pane by key |
| all five | 6 | The full thing |

Two facts fall out, and both contradict the README's shape:

**Resize is a layout feature, not a drag feature.** Seams bind their own pointer
handlers; nothing in the affordance path reads `DragContext`. `Seam join`,
`Strip` and `ResizableGrid` all run on two providers. A reader can ship
resizable panes without ever mounting `DragProvider` — the README's ordering
implies otherwise.

**Keyboard and drag are parallel branches, not sequential.** Neither depends on
the other. Teaching them as a sequence makes the second look like it requires
the first.

Everything else — snapshots, history, locks, throttling, tracing, policies —
attaches at any tier and belongs after the ladder, not inside it.

---

## The order

Nine parts. One MDX page each unless noted; headings within a page are listed
where they carry a distinct source or demo.

### 0. Start here

Install, the two entry points, one tree that renders. No vocabulary yet — the
reader sees it work, then Part 1 explains what they just wrote.

- Source: README `Quick start` (L47–93)
- Demo: a new minimal one; `Playground` is far too large to open with

### 1. The model

The vocabulary gate. Everything downstream is unreadable without it, and it is
currently the least-published thing in the repo.

- One node shape, four optional capabilities
- `container` vs `membership` — the opposite-questions rule
- Where state goes: `hints` / `container.config` / `node.meta` /
  `membership.placement`, and which survives `moveNode`
- Lifecycle, transit, focus machines
- The store: record replacement, `subscribe`, the invariants it enforces
- Source: `docs/concepts.md` (**published nowhere today**), README
  `State machines` (L112–157)
- Demo: `Recursive zones / Trays` — a panel whose `container` is set

### 2. Putting a tree on screen

The fork every integrator hits in their first hour, and the one the README never
states outright: **who owns the tree, JSX or the store?**

- Declarative: `<Zone>` / `<Panel>`, JSX owns shape and order
- Imperative: `<Container>` + chrome, store owns it; `<Root>` for the top
- Mixed provenance, and what reconciliation does to a child JSX did not declare
- Who owns child order; `preserveStoreOrder` for when the host owns existence
  but the user owns arrangement
- Source: README `Who owns child order` (L178–234), `Imperative API` (L94–111)
- Demo: `Declarative / MixedProvenance`

### 3. Layout

- The strategy contract: pure over `{ items, container, state, options }`
- The four built-ins: `strip`, `grid`, `stack`, `floating` (a wrapper over
  another strategy, not a peer)
- Sizing: `hints`, content-measured axes, `gridTiling` for row counts
- When it does not fit: `unplaced` vs `overflow`, scrolling
- Flow mode: opting out of placement entirely and letting CSS do it
- Writing your own strategy; `configSpec` and `configConflicts`
- Non-DOM hosts: `ContainerHost` without React
- Source: README L235–533 (six sections), concepts `Layout strategies`
- Demos: `Strip`, `Grid`, `Stack`, `Floating`, `Content sizing`, `Scrolling`,
  `Flow mode`

### 4. Resize

Placed here deliberately — it costs no new provider, so it is the cheapest
interactivity in the library.

- Affordances: what a strategy emits, what the host binds
- Seams, and `bounds` as the reason a host never recomputes reach
- Seam join: overshoot to destroy
- Grid seams; collapsing a pane; collapsing a group that empties out
- Source: README `Resize` (L785–900), `Collapsing …` (L295–359)
- Demos: `Seam join`, `Recursive zones / SplitResize`, `Grid / ResizableGrid`

### 5. Drag and drop — `+ DragProvider`

- Wiring: `DragProvider`, `DragHandle`, drop targets, `acceptsDrops`
- Drop intent: the hit-test, and the three restructuring drops it can return
- Tab stacking, with `stackStrategy` and `useStack` paying off from Part 3
- Split on drop
- Edge scroll during a drag
- Floating chrome over a tiled zone
- The parallel-zones trap
- Source: README L534–784
- Demos: `Declarative / DropIntent`, `Tab stack`, `Drop on edge`,
  `Scrolling / DragToTheEdgeToScroll`, `Floating`, `Parallel zones`

### 6. Keyboard and focus — `+ GeometryProvider` `+ FocusProvider`

Parallel to Part 5, not after it. Say so on the page.

- The focus model and `canFocus`; why geometry is an input, never a measurement
- Navigating; moving a pane without a pointer
- Announcements
- Source: README `Keyboard navigation` (L901–1008)
- Demos: `Keyboard move`, `Declarative / KeyboardNav`

### 7. Changing the built-in decisions

The three policies plus the two controlled-value props, which are the same idea
— the host taking a decision back — and are currently documented far apart.

- The shared tri-state contract, and the degrade-on-garbage guarantee
- `acceptPolicy`, `chooseSuccessor`, `resolveNavigation`
- Controlled placement (`onPlacementChange`) and controlled order
  (`onChildOrderChange`)
- `edgeScroll` is adjacent but not a policy — nothing to refuse, nothing to
  defer to
- Locks are not policies either: a lock refuses regardless of what a policy says
- Source: README `Replacing the built-in rules` (L158–177), concepts `node.lock`
- Demos: the `Policies/` section, complete as of this branch

### 8. State over time

- `serialize` / `deserialize`, and hydrating into an existing store
- Serializing one subtree and `graft`ing it elsewhere
- Undo/redo with `HistoryController`; why `transact` does not roll back
- Source: README L1088–1122, concepts `Snapshot`, `History`
- Demos: **none exist** — see gaps

### 9. Performance and diagnosis

- Throttling: truth vs published, and `getPending` for "why has this not
  appeared?"
- Tracing: the categories and how to turn them on
- Errors: the `code` discriminant
- Hot paths worth respecting (`acceptPolicy` runs per `pointermove`)
- Source: README L1009–1087, concepts `Truth vs. published`, `Tracing`,
  `Errors`
- Demo: `Throttling`

### Glossary

Its own page, linked from every part's first use of a term. This library's
difficulty is almost entirely vocabulary, and a term defined three pages back
is not available to someone who landed mid-guide from a search.

Entries: node, capability, container, membership, placement, hints, meta,
activity, kind, pinned, locked, zone, group, panel, strategy, affordance, seam,
gutter, join, drop intent, chrome, provenance, truth vs published, policy,
graft.

Carries the four naming traps outright, since each is a bug someone will
otherwise ship: `container` vs `membership`; `node.meta` vs
`membership.placement`; `pinned` vs `locked`; `acceptsDrops` vs `lock.accept`.

- Source: `docs/concepts.md`, plus the naming-trap rules in `CLAUDE.md`

---

## What the README keeps

It stays the npm tarball's document, for a reader deciding whether to install:

- Title, install, the two entry points, the capability bullets
- `Quick start` — the guide's Part 0 duplicates it, and that is fine; a package
  page with no runnable example is worse than a repeated one
- `Breaking changes` in full (L1123–1318). Migration steps ship with the
  version, not with the site.
- `Develop`
- Links out to guide, API reference, playground

Everything from L112 to L1122 moves. That is ~1,010 of 1,330 lines.

---

## Gaps this survey found

Ordered by how much they cost.

**`docs/concepts.md` is published nowhere.** The Pages build ships Ladle and
`/api`. The document the README calls the canonical vocabulary is readable only
on GitHub, and Parts 1 and the Glossary are both built almost entirely from it.
This is the single largest hole.

**Part 8 has no demo of any kind.** No story touches `HistoryController`,
`undo`, or `graft`. Snapshot round-trips appear inside `Playground` and
`RecursiveSplit` as plumbing, never as the subject. An undo/redo story would
also be the first browser coverage history has.

**`<Root>` has no story.** Unit-tested in `NodeRenderer.test.tsx`, demonstrated
nowhere, and it is the top-level entry point Part 2 has to introduce.

**Announcements have no story.** `bindAnnouncer` and `accessibleName` are
exported and documented in the README; nothing operable exercises them, which
for an accessibility feature is the wrong way round.

**Canvas / non-DOM hosts have no story.** Unstoryable in Ladle by definition —
Part 3 should show `ContainerHost` driving a `<canvas>`, which is a story Ladle
can host even though the point is that React is absent.

**`observePixelRatio` is exported and appears in no story and no README
section.** Decide whether it is public surface or an oversight.

**Two `Recursive zones` files and two `Declarative` files share a title each.**
Fine in Ladle, ambiguous in a guide that links to a demo by name. Rename when
the pages start pointing at them.

---

## Sequencing

1. Widen `.ladle/config.mjs` to `src/**/*.stories.{ts,tsx,mdx}` — MDX needs no
   new dependency, Ladle already carries `@mdx-js/mdx`.
2. Decide where guide pages live (`src/guide/*.mdx` beside the stories, or a
   top-level `guide/`) and how the Pages build lays out Ladle + guide + `/api`.
3. Glossary and Part 1 first — every other page links into them.
4. Parts 2–4, then 5 and 6 in either order, then 7–9.
5. Trim the README last, once each moved section has a live home to point at.
