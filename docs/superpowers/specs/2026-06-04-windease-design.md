# windease — design spec

**Date:** 2026-06-04
**Status:** approved for implementation planning

## Purpose

`windease` is a client-side TypeScript library that abstracts window-manager
bookkeeping out of [brainhouse](../../../../brainhouse). Brainhouse currently
spreads windowing concerns across `slotAllocator.ts`, `panelOrder.ts`,
`hiddenPanels.ts`, `gridLayout.ts`, a 47 KB `PanelCard.tsx`, and a 56 KB
`App.tsx`. windease collects those concerns into a small framework-agnostic
core with a thin React binding, so brainhouse can slot it in and shed the
inline bookkeeping.

windease is not a generic desktop-WM clone. Its first consumer is brainhouse,
and the v1 surface is scoped to what brainhouse needs.

## Scope

In scope (v1):

- Long-lived placed surfaces: panels and project-widget cards.
- Zones as first-class containers with declared layout strategies.
- Per-window finite state machines for lifecycle, transit (ownership), and
  focus, composed per window (not one mega-FSM).
- Programmatic placement, ownership transfer, and reorder APIs.
- React provider + `<Zone>` components + hooks.

Out of scope (v1):

- Modals, lightboxes, tooltips, popovers — these stay in brainhouse.
- Drag-between-zones UX (architecture accommodates it; the transit FSM and
  ownership transitions are in place; the pointer handling is deferred).
- Persistence — windease exposes `snapshot()` / `hydrate()`; the consumer
  chooses storage.
- Animations beyond what consumers wire up via the event channel.

## Decisions

1. **Ownership model.** Zones claim and release windows. Ownership
   transitions are first-class FSM transitions. A window's `zoneId` is `null`
   when unowned; no separate "limbo" zone.
2. **Layout strategy.** Each zone declares its strategy at registration.
   Built-ins: `grid` (main), `stack` (sidebar), `strip` (dock). Consumers can
   register custom strategies. Strategies are pure functions of
   `{zone, windows, viewport}` → placement map.
3. **FSM concerns.** Separate small machines per concern, composed on each
   window record: `lifecycle` (`mounted` / `visible` / `hidden` / `destroyed`),
   `transit` (`idle` / `claiming` / `releasing`), `focus` (`focused` /
   `blurred`). Hand-rolled typed transition tables (~60 LOC helper). No
   external FSM dependency.
4. **Core architecture.** A vanilla `Store` class exposes typed
   mutation methods and a single coarse `subscribe()` for React via
   `useSyncExternalStore`. A typed `events` emitter on the side fires per
   FSM transition for instrumentation, devtools, and animation hooks.
   Subscribe-callback fan-out is batched on a microtask so multi-step
   mutations (like `moveWindow` = release + claim) produce one render.
5. **Persistence.** Not windease's concern. `snapshot()` returns a JSON-safe
   structure; `hydrate(snap, { strategies })` rebuilds the store. Strategies
   can't round-trip JSON, so callers supply them by name.
6. **React surface.** `<Provider>` holds the store. `<Zone id="…">`
   measures its container, runs the zone's strategy against the current
   viewport, and yields `(window, placement)` pairs via a render prop.
   Hooks: `useWindease`, `useWindow(id)`, `useZone(id)`, `useWindowsByZone`.
   Placements are emitted as CSS custom properties (`--w-x`, `--w-y`,
   `--w-w`, `--w-h`) on the window wrapper, not inline `left/top/width/height`
   — consumers style via class and may animate by reading the variables.

## Package layout

Two-package npm workspace at `~/src/windease/`. Mirrors the brainhouse /
weasel convention; npm is canonical.

```
windease/
├── package.json            # workspaces: packages/core, packages/react
├── biome.jsonc
├── tsconfig.json
├── vitest.config.ts
└── packages/
    ├── core/               # @windease/core — framework-agnostic
    │   └── src/
    │       ├── fsm.ts               # typed transition-table helper
    │       ├── machines/
    │       │   ├── lifecycle.ts
    │       │   ├── transit.ts
    │       │   └── focus.ts
    │       ├── store.ts
    │       ├── window.ts
    │       ├── zone.ts
    │       ├── layout/
    │       │   ├── grid.ts
    │       │   ├── stack.ts
    │       │   └── strip.ts
    │       ├── events.ts
    │       ├── snapshot.ts
    │       └── index.ts
    └── react/              # @windease/react — thin binding
        └── src/
            ├── Provider.tsx
            ├── Zone.tsx
            ├── hooks.ts
            └── index.ts
```

## Core data model

```ts
type WindowId = string & { __brand: 'WindowId' };
type ZoneId   = string & { __brand: 'ZoneId' };

type LifecycleState = 'mounted' | 'visible' | 'hidden' | 'destroyed';
type TransitState   = 'idle' | 'claiming' | 'releasing';
type FocusState     = 'focused' | 'blurred';

interface WindowRecord {
  id: WindowId;
  kind: string;                     // consumer-defined ('panel', 'widget', …)
  zoneId: ZoneId | null;            // null = unowned
  lifecycle: Machine<LifecycleState>;
  transit:   Machine<TransitState>;
  focus:     Machine<FocusState>;
  hints: {
    minSize?:       { w: number; h: number };
    preferredSize?: { w: number; h: number };
    order?:         number;
  };
  meta: Record<string, unknown>;    // consumer escape hatch
}

interface ZoneRecord {
  id: ZoneId;
  strategy: LayoutStrategy;
  windowIds: WindowId[];            // ordered membership
  config: Record<string, unknown>;
}

interface LayoutStrategy {
  name: string;
  layout(input: {
    zone: ZoneRecord;
    windows: WindowRecord[];
    viewport: { w: number; h: number };
  }): Map<WindowId, { x: number; y: number; w: number; h: number }>;
}
```

## FSM helper

```ts
interface MachineDef<S extends string, E extends string> {
  initial: S;
  transitions: { [from in S]?: { [event in E]?: S } };
  onEnter?: { [s in S]?: (m: Machine<S, E>) => void };
}

class Machine<S extends string, E extends string = string> {
  state: S;
  constructor(def: MachineDef<S, E>);
  can(event: E): boolean;
  send(event: E): boolean;          // true if transitioned
  subscribe(fn: (s: S, prev: S, e: E) => void): () => void;
}
```

Roughly 60 LOC. `send()` returns `false` on illegal transitions rather than
throwing, because event delivery is the lower-level primitive and a routine
`can`/`send` check should not need try/catch.

## Store API

```ts
class Store {
  // Read
  getWindow(id: WindowId): WindowRecord | undefined;
  getZone(id: ZoneId):     ZoneRecord   | undefined;
  listWindows(filter?: { zoneId?: ZoneId | null; kind?: string }): WindowRecord[];
  listZones(): ZoneRecord[];

  // Window lifecycle
  createWindow(input: { id?: WindowId; kind: string; hints?: …; meta?: … }): WindowId;
  show(id: WindowId): void;         // lifecycle: → visible
  hide(id: WindowId): void;         // lifecycle: → hidden
  destroy(id: WindowId): void;      // lifecycle: → destroyed, then GC

  // Zone management
  registerZone(input: { id: ZoneId; strategy: LayoutStrategy; config?: … }): void;
  unregisterZone(id: ZoneId, opts?: { orphan?: boolean }): void;

  // Ownership (zones claim and release)
  claim(zoneId: ZoneId, windowId: WindowId, at?: number): void;
  release(windowId: WindowId): void;
  moveWindow(windowId: WindowId, toZoneId: ZoneId, at?: number): void;
  reorderInZone(zoneId: ZoneId, order: WindowId[]): void;

  // Focus
  focus(id: WindowId): void;        // blurs whatever was focused

  // Reactive
  subscribe(fn: () => void): () => void;
  events: TypedEventEmitter<StoreEvents>;

  // Persistence-agnostic
  snapshot(): SerializedStore;
  hydrate(snap: SerializedStore, opts: { strategies: Record<string, LayoutStrategy> }): void;
}

type StoreEvents = {
  'window.created':       { id: WindowId };
  'window.destroyed':     { id: WindowId };
  'window.transitioned':  { id: WindowId; machine: 'lifecycle'|'transit'|'focus'; from: string; to: string; event: string };
  'zone.claimed':         { zoneId: ZoneId; windowId: WindowId };
  'zone.released':        { zoneId: ZoneId; windowId: WindowId };
  'zone.reordered':       { zoneId: ZoneId };
};
```

`claim` and `release` drive the `transit` machine through
`claiming`/`releasing` and back to `idle`. `moveWindow` is `release` + `claim`
batched into one microtask flush so the React layer renders once.

## React surface

```tsx
<Provider
  zones={[
    { id: 'main',    strategy: gridStrategy,  config: { cols: 3, gap: 8 } },
    { id: 'sidebar', strategy: stackStrategy, config: { gap: 4 } },
    { id: 'dock',    strategy: stripStrategy, config: { axis: 'x' } },
  ]}
>
  <Zone id="main">
    {(window, placement) => (
      <div
        className="windease-window"
        style={{
          '--w-x': `${placement.x}px`,
          '--w-y': `${placement.y}px`,
          '--w-w': `${placement.w}px`,
          '--w-h': `${placement.h}px`,
        } as React.CSSProperties}
        data-window-kind={window.kind}
        data-window-state={window.lifecycle.state}
      >
        <PanelOrWidget window={window} />
      </div>
    )}
  </Zone>
</Provider>
```

`<Zone>` measures its container via `ResizeObserver`, runs the strategy each
render, and filters out hidden/destroyed windows before invoking the render
prop. Hooks build on `useSyncExternalStore(store.subscribe, selector)` so a
window-level update does not re-render every consumer.

Setting placements as CSS custom properties (rather than inline
`left`/`top`/`width`/`height`) keeps styling under consumer control and
avoids the inline-style anti-pattern called out in the user's coding rules.
Consumer CSS resolves `transform: translate(var(--w-x), var(--w-y))` and
similar.

## Error handling and edge cases

- **Programmer errors throw `WindeaseError`** with a typed `code`:
  `UNKNOWN_WINDOW`, `UNKNOWN_ZONE`, `ILLEGAL_TRANSITION`, `DUPLICATE_ZONE`,
  `ZONE_NOT_EMPTY`. These should never fire in correct consumer code; if
  they do, it is a bug.
- **Destroy releases first.** `destroy(id)` releases the window from its
  zone before transitioning to `destroyed`. `zone.released` fires.
- **Hidden retains placement.** `hide` keeps `zoneId`; `destroy` clears it.
- **Zone removal.** `unregisterZone` throws `ZONE_NOT_EMPTY` unless
  `{ orphan: true }`; with orphan, members release to `zoneId: null`.
- **Layout failure.** If a strategy returns a placement map missing some
  windows, `<Zone>` omits them and `console.warn`s once per window-id per
  session. We never throw — layout bugs should not blank the app.
- **Mutation batching.** Subscribe-callback fan-out is microtask-batched;
  the `events` emitter fires synchronously per transition.

## Testing strategy

- `@windease/core` unit tests (Vitest):
  - FSM helper: legal/illegal transitions, `onEnter` ordering, subscribe.
  - Each machine: exhaustive transition table.
  - `Store`: table-driven arrange/act/assert.
  - Layout strategies: pure-function checks against fixture inputs.
  - `snapshot`/`hydrate` round-trip.
- `@windease/react` tests:
  - Hook re-render counts under `act()` (selector granularity).
  - `<Zone>` render-prop pairs match expected placements.
  - `<Provider>` hydration round-trip.
- Ladle stories (parity with brainhouse) per layout strategy, rendering the
  same window set arranged three ways. Doubles as visual regression and as
  living documentation.

## Tooling

- TypeScript, React 19, Vite (for the Ladle harness only — core has no
  bundler), Biome, Vitest, Ladle. Matches brainhouse.
- npm workspaces. Never commit `pnpm-lock.yaml` (per the weasel convention).
- No runtime dependencies in `@windease/core`. `@windease/react` depends
  only on `react` (peer) and `@windease/core`.

## Migration into brainhouse

Out of scope for this spec. A follow-on plan will:

1. Map brainhouse's `slotAllocator` / `panelOrder` / `hiddenPanels` /
   `gridLayout` concepts onto windease primitives.
2. Replace the relevant `PanelCard` / `App` bookkeeping incrementally,
   one zone at a time.
3. Move app-domain notions (blacklisted, awaiting, hued) onto window `meta`.

## Open questions

None blocking implementation. Items to revisit at the migration phase:

- Does brainhouse's "awaiting" notion warrant its own machine or stay as
  `meta`?
- Should `<Zone>` expose a `transitionWrap` slot for animation libs, or do
  consumers wire that themselves via the `events` emitter?
