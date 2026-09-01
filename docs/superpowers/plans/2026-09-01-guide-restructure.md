# Guide restructure — outline

**What this is:** the section and chapter breakdown for a published guide, and
where each chapter's prose and live demo come from. Written before any page
exists, so the populate step is mechanical.

**For:** whoever writes the pages, in this session or a later one. Assumes
familiarity with the codebase, not with why this order.

**Reader of the guide itself** (which every decision below is calibrated to):
someone wiring windease into a React app. Knows React. Does not know that
`container` and `membership` answer opposite questions, and will not guess it.

**Granularity:** a **chapter** is one MDX page. A **section** groups them, and
maps onto a Ladle title prefix the way `Policies/Accept` already does —
`Guide/Layout/Strip`. Ten sections, 64 chapters.

**Stories keep their own top-level sections.** The guide lives under a `Guide/`
prefix and does not absorb them; a chapter *embeds* a story rather than
restating it.

---

## Mechanics, verified by spike

Each of these was tested against a running Ladle, not inferred.

**MDX needs no new dependency.** Ladle already carries `@mdx-js/mdx`. Widening
`.ladle/config.mjs` to `src/**/*.stories.{ts,tsx,mdx}` is the whole change, and
it leaves the existing 33 stories untouched.

**Titles come from `<Meta>`, not frontmatter and not the file path.** YAML
frontmatter is ignored, and directory nesting is ignored — `src/guide/foo/Strip.stories.mdx`
titles itself `Strip` and *collides into the existing Strip story group*. The
working form is:

```mdx
import { Meta } from '@ladle/react';
<Meta title="Guide/Layout/Strip" />
```

Ladle splits on the last `/`: group `Guide/Layout`, page `Strip`. Filenames are
therefore free — chapter files can sit flat in `src/guide/`.

**A chapter embeds a story by importing its component.** Story exports are
ordinary components carrying their own provider stack, so this renders live and
fully interactive:

```mdx
import { HorizontalStrip } from '../react/stories/Strip.stories.tsx';
<HorizontalStrip />
```

One source, so the demo cannot drift from the story — and the story still
appears in its own section.

**Most stories carry their own teaching prose, which is the chapter's job.**
Only `Strip`, `Stack`, `Content sizing` and `Split operation` are prose-free
and embed with no duplication; the other 17 ship 1–6 explanatory paragraphs.
Rather than restate or refactor wholesale, split each as it is needed: export
the bare demo component alongside the story that wraps it in prose, and let the
chapter import the bare one. Small per-file change, no duplicated text, both
surfaces keep working.

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

**State machines moved to §8, with an abbreviated §3.1 up front.** A reader
can learn that a registered node is invisible until `showNode` without meeting
the word "machine"; the FSM mechanics are for someone extending, and sat second
only because the README had them there. Layout and Building the tree also
swapped, so the first thing after the tour is what the library does rather than
how a tree is assembled.

**The model is split, not deferred.** §1.3 tours it: one node shape, four
optional capabilities, and the one demonstration that makes the idea land — a
panel that becomes a container is a tray inside a window, and no new type was
involved. That is what a reader needs to *read* the rest of the guide.

§8.1–8.2 is the reference: every capability, every field, which of the four
buckets owns what, and what survives `moveNode`. That is what a reader needs to
*extend* the library, and nothing in §§2–7 requires it.

The split is the load-bearing decision here, so it needs a test rather than good
intentions: **a chapter before §8 may name a capability but must never require
a field of one.** A chapter that cannot be read by someone who has met §1.3 and
not §8.1 is mis-scoped, and the fix is to move the dependency into §1.3 or the
Glossary — not to enlarge it in place.

---

## How a chapter opens

The first paragraph defines the word in the title and says what the chapter
covers. Both halves, in that order, before any fact about the API.

Readers arrive mid-guide from a search and from the sidebar, so a chapter cannot
assume the one before it was read. "Announcements" meant nothing until the page
said an announcement is text spoken to a screen reader; "Mixed provenance" meant
nothing until the page said provenance is where a node came from. A chapter that
opens on `store.getPending(id)` answers it. has told the reader nothing at all.

Defining is not explaining from first principles. One or two sentences, in the
reader's vocabulary, then get on with it.

---

## §1 · Tour

A brief tour of the engine that shows off two or three capabilities worth being
impressed by. Not a vocabulary lesson — the reader should want to keep reading.

| Chapter | Source | Demo |
| --- | --- | --- |
| 1.1 Install and entry points | README L1–46 | — |
| 1.2 A tree in twenty lines | README `Quick start` (L47–93) | new, minimal |
| 1.3 One shape, four capabilities — a tour | concepts `Mental model` | `Recursive zones / Trays` |
| 1.4 What it can do | — | `Tab stack`, `Seam join`, `Drop on edge` |

**1.3 shows the model; it does not teach it.** The reader has just written a
`<Zone>` and a `<Panel>` in 1.2 and reasonably believes those are two types.
This chapter's whole job is that they are one: a node carries `lifecycle` plus
any of `container` / `membership` / `focus`, `kind` is a label the core never
reads, and setting `container` on a panel makes it host children — which is why
"a tray inside a window" needs no new component. One demo, one paragraph per
capability, and a link to §8 for the fields. It ends there; the four state
buckets, locks and the `moveNode` lifetime rules are §8's.

1.4 has to earn the rest of the guide. Strongest first: drag a pane onto
another and watch it become a tab stack; overshoot a seam and watch the
neighbour be absorbed; drop on an edge and watch a slot split in two. All three
already have stories, and all three read as "I could not build that in an
afternoon."

## §2 · Layout

| Chapter | Source | Demo |
| --- | --- | --- |
| 2.1 What a strategy is | concepts `Layout strategies` | — |
| 2.2 `strip` | — | `Strip` |
| 2.3 `grid` | README `Sizing a grid to its rows` (L274–294) | `Grid` |
| 2.4 `stack` | — | `Stack` |
| 2.5 `floating` — a wrapper, not a peer | README L725–784 | `Floating` |
| 2.6 Sizing a pane to its contents | README L235–273 | `Content sizing` |
| 2.7 When panes don't fit | README L360–404 | `Scrolling / GridOverflowModes` |
| 2.8 Telling windease where the scroll got to | README L405–448 | `Scrolling` |
| 2.9 Letting CSS do the layout | README L449–506 | `Flow mode` |
| 2.10 Non-DOM and canvas hosts | README `Canvas hosts` (L507–533) | needed |

## §3 · Building the tree

The fork every integrator hits in their first hour, and the one the README never
states outright: **who owns the tree, JSX or the store?**

| Chapter | Source | Demo |
| --- | --- | --- |
| 3.1 Showing and hiding nodes | README `State machines` (L112–157) | needed |
| 3.1 Declarative: `<Zone>` and `<Panel>` | README L178–205 | `Declarative / MixedProvenance` |
| 3.2 Imperative: `<Container>`, chrome, `<Root>` | README `Imperative API` (L94–111) | needed (`<Root>`) |
| 3.3 Mixed provenance | — | `Declarative / MixedProvenance` |
| 3.4 Who owns child order | README L178–234 | `Declarative / MixedProvenance` |
| 3.5 Nesting and recursion | — | `Recursive zones / Trays` |

## §4 · Resize

Placed here deliberately: it costs no new provider, so it is the cheapest
interactivity in the library. Say that on 5.1.

| Chapter | Source | Demo |
| --- | --- | --- |
| 4.1 Affordances and seams | README `Resize` (L785–834) | `Strip` |
| 4.2 `bounds`, and why a host never recomputes reach | README L785–834 | `Recursive zones / SplitResize` |
| 4.3 Seam join: overshoot to destroy | README `Seam join` (L835–879) | `Seam join` |
| 4.4 Grid seams | README `Grid seams` (L880–900) | `Grid / ResizableGrid` |
| 4.5 Collapsing a pane | README L295–330 | `Split operation` |
| 4.6 Collapsing a group that empties out | README L331–359 | `Split operation` |

## §5 · Drag and drop — `+ DragProvider`

| Chapter | Source | Demo |
| --- | --- | --- |
| 5.1 Wiring a drag | README `Drag and drop` (L534–585) | `Declarative / DropIntent` |
| 5.2 Drop intent | README `Drop intent` (L586–632) | `Declarative / DropIntent` |
| 5.3 Tab stacking | README `Tab stacking` (L633–665) | `Tab stack` |
| 5.4 Drop on edge | README `Drop on edge` (L666–724) | `Drop on edge` |
| 5.5 Edge scroll during a drag | README L405–448 | `Scrolling / DragToTheEdgeToScroll` |
| 5.6 Floating chrome over a tiled zone | README L725–784 | `Floating` |
| 5.7 The parallel-zones trap | — | `Parallel zones` |

## §6 · Keyboard and focus — `+ Geometry` `+ Focus`

Parallel to §6, not after it. Say so on 7.1.

| Chapter | Source | Demo |
| --- | --- | --- |
| 6.1 The focus model and `canFocus` | README L901–940 | `Keyboard move` |
| 6.2 Geometry is an input, never a measurement | concepts `React layer` | `Scrolling / ScrollAwareNavigation` |
| 6.3 Navigating | README L901–940 | `Declarative / KeyboardNav` |
| 6.4 Moving a pane without a pointer | README L941–986 | `Keyboard move` |
| 6.5 Announcements | README `Announcements` (L987–1008) | needed |

## §7 · Customization

The through-line: every chapter is the host taking back a decision the library
was making. It opens with the model in full, because that is the first thing an
extender needs and the first place the tour's summary stops being enough.

| Chapter | Source | Demo |
| --- | --- | --- |
| 7.1 The capabilities in full | concepts `Capabilities` | `Recursive zones / Trays` |
| 7.2 Where state goes: the four buckets | concepts `Two scopes of free-form data` | — |
| 7.3 Locks | concepts `node.lock` | `Seam join` |
| 7.4 The policy contract | README L158–177 | — |
| 7.5 `acceptPolicy` | README L534–585 | `Policies/Accept` |
| 7.6 `chooseSuccessor` | README L941–986 | `Policies/Focus successor` |
| 7.7 `resolveNavigation` | README L941–986 | `Policies/Navigation` |
| 7.8 Controlled placement and order | — | needed |
| 7.9 Writing a strategy | concepts `Layout strategies` | needed |
| 7.10 `configSpec` and `configConflicts` | CHANGELOG 1.3.0 | — |
| 7.11 Custom chrome and affordance renderers | concepts `React layer` | `Playground` |

`edgeScroll` is named in 8.4 as the counter-example — a tuning bag, not a
policy, with nothing to refuse and nothing to defer to. Locks get 8.3 rather
than a mention in 8.4 because a lock refuses regardless of what a policy says,
which is a different mechanism wearing a similar shape.

## §8 · State machines

Every node carries a lifecycle, and every story calls `showNode` — a reader who
skips this gets a blank screen and no idea why. One chapter each, per the
markup.

| Chapter | Source | Demo |
| --- | --- | --- |
| 8.1 Lifecycle: `mounted → visible ↔ hidden → destroyed` | README `State machines` (L112–157) | needed |
| 8.2 Transit: moves that must be atomic | same | needed |
| 8.3 Focus: the single-focus invariant | same | `Keyboard move` |

## §9 · History and persistence

| Chapter | Source | Demo |
| --- | --- | --- |
| 9.1 The store: record replacement, `subscribe`, invariants | concepts `Store API` | — |
| 9.2 Snapshot and hydrate | concepts `Snapshot` | needed |
| 9.3 Hydrating in place | README L1088–1103 | needed |
| 9.4 Saving one subtree, and `graft` | README L1104–1122 | needed |
| 9.5 Undo and redo | concepts `History` | needed |
| 9.6 `transact` does not roll back | CLAUDE.md | needed |

Five of six chapters need a demo that does not exist. This is the section to
budget for.

## §10 · Performance and diagnosis

| Chapter | Source | Demo |
| --- | --- | --- |
| 10.1 Truth vs published | concepts `Truth vs. published` | `Throttling / TruthVsPublished` |
| 10.2 Throttling | README L1009–1042 | `Throttling` |
| 10.3 Why has this not appeared yet? | README L1043–1087 | `Throttling` |
| 10.4 Tracing | concepts `Tracing` | — |
| 10.5 Errors and their codes | concepts `Errors` | — |
| 10.6 Hot paths | CLAUDE.md | — |

## Glossary

Its own page, linked from every chapter's first use of a term. It exists for
navigation, not because the terms are the hard part: readers arrive mid-guide
from a search, and a term defined six chapters back is not available to them.
It also carries §§1–7, which deliberately run ahead of the model in §8.

Several terms are overloaded rather than merely unfamiliar, which is what makes
a single lookup point worth having — `meta` means different things by scope,
and `stack` has meant two different strategies.

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
- `Quick start` — chapter 1.2 duplicates it, and that is fine; a package page
  with no runnable example is worse than a repeated one
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
on GitHub, and §8, §9.1 and the Glossary are built almost entirely from it.
This is the single largest hole.

**§9 has no demo of any kind.** No story touches `HistoryController`, `undo`,
or `graft`. Snapshot round-trips appear inside `Playground` and
`RecursiveSplit` as plumbing, never as the subject. An undo/redo story would
also be the first browser coverage history has.

**§2 needs two stories.** Nothing demonstrates the lifecycle or transit
machines directly — `showNode` is called in every story's setup and explained
in none.

**`<Root>` has no story.** Unit-tested in `NodeRenderer.test.tsx`, demonstrated
nowhere, and it is the top-level entry point 3.2 has to introduce.

**Announcements have no story.** `bindAnnouncer` and `accessibleName` are
exported and documented in the README; nothing operable exercises them, which
for an accessibility feature is the wrong way round.

**Canvas / non-DOM hosts have no story.** 4.10 should show `ContainerHost`
driving a `<canvas>` — a story Ladle can host even though the point is that
React is absent.

**`observePixelRatio` is exported and appears in no story and no README
section.** Decide whether it is public surface or an oversight.

**Two `Recursive zones` files and two `Declarative` files share a title each.**
Fine in Ladle, ambiguous in a guide that links to a demo by name. Rename when
the chapters start pointing at them.

Tally: **13 chapters need a demo that does not exist**, concentrated in §9 (5),
§2 (2) and one each in §3, §4, §7, §8.

---

## Sequencing

1. Widen `.ladle/config.mjs` to `src/**/*.stories.{ts,tsx,mdx}`. **Done on this
   branch** — verified inert against the existing 33 stories.
2. Chapters go in `src/guide/`, flat, one `.stories.mdx` per chapter, titled by
   `<Meta>`. Still open: how the Pages build presents Ladle + guide + `/api` as
   three sections rather than one Ladle tree with `/api` bolted on.
3. Glossary first — every chapter links into it, and §§1–7 depend on it
   carrying the vocabulary §8 defers.
4. §1, then §§2–5, then §6 and §7 in either order, then §§8–10.
5. Write the 13 missing stories as their chapters come up, not in a batch —
   a story with no chapter around it has nothing to be right about.
6. Trim the README last, once each moved section has a live home to point at.
