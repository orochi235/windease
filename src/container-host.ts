import { checkStrategyConfig } from './layout/config-check.js';
import { splitPreviewPlacements } from './layout/split-preview.js';
import { nodeToLayoutItem, runStrategyForContainer } from './layout-node-adapter.js';
import type {
  Affordance,
  LayoutEvent,
  LayoutPreview,
  LayoutResult,
  LayoutStrategy,
  Rect,
  StrategyRegistry,
} from './layout-types.js';
import type { ContainerCap, NodeId } from './node.js';
import { SPLIT_STRATEGY_ID, type Store } from './store.js';
import { trace } from './trace.js';

export interface ContainerLayout {
  placements: Map<NodeId, Rect>;
  affordances: Affordance[];
  unplaced: NodeId[];
  viewport: { w: number; h: number } | null;
  /** True when these placements came from a `preview` input. */
  isPreview: boolean;
  /**
   * How far the placed content exceeds the viewport per axis, absent when it
   * fits. A binding sizes its inner box to `viewport + overflow` so a
   * scrolling wrapper has something to scroll.
   */
  overflow?: { w: number; h: number };
  /**
   * `'placed'` when these came from a strategy run, `'flow'` when the container
   * declared `hints.render: 'flow'` and the browser arranges its children. A
   * flow layout carries no placements, affordances or overflow — a binding
   * renders the children in order and lets CSS position them.
   */
  mode: 'placed' | 'flow';
  /**
   * How far this container's content is scrolled away from its origin. Zero
   * unless a host reports otherwise through `setScroll`.
   *
   * Placements are unscrolled — the strategy lays out the whole extent and
   * knows nothing about what is on screen. A binding that needs a pane's
   * *visible* position subtracts this: each container answers for its own
   * scroll and the composition of the chain gives one space for the tree.
   */
  scroll: { x: number; y: number };
}

/** What produced a controlled child's proposed placement. */
export interface PlacementChange {
  /** The affordance whose gesture produced it. */
  affordanceId: string;
  /** The container the gesture ran in. */
  parentId: NodeId;
}

/**
 * Receives the placement a gesture *would* have written, for a child whose
 * placement the host owns. Registering one makes that child controlled: the
 * gesture no longer writes to the store, and the host commits by re-rendering.
 *
 * The bag is the whole placement as it would have stood, not just the keys the
 * gesture touched — a host that stored a patch would drift from the store's
 * copy on the first key a later gesture removes.
 */
export type PlacementCommit = (
  nextPlacement: Readonly<Record<string, unknown>>,
  change: PlacementChange,
) => void;

/** `affects` carries only real child ids, so a miss resolves to false rather than throwing. */
function affectsResizeLocked(store: Store, affects: Affordance['affects']): boolean {
  return affects?.some((cid) => store.isLocked(cid as NodeId, 'resize')) === true;
}

/** Placement bags are JSON-safe by contract and a few keys wide, so comparing
 *  by value costs nothing measurable. Identity would report every gesture as a
 *  change: a strategy rebuilds `size` as a fresh object on each write. */
function placementEqual(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!(k in b)) return false;
    const va = a[k];
    const vb = b[k];
    if (va === vb) continue;
    if (typeof va !== 'object' || typeof vb !== 'object' || va === null || vb === null)
      return false;
    if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
  }
  return true;
}

/** A patch that turns `next` back into `prev`: every key `prev` had restored to
 *  its value, every key only `next` has deleted. `patchPlacement` reads
 *  `undefined` as a delete, which is what makes the second half expressible. */
function revertPatch(
  prev: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(next)) if (!(k in prev)) patch[k] = undefined;
  for (const [k, v] of Object.entries(prev)) patch[k] = v;
  return patch;
}

const NO_SCROLL = { x: 0, y: 0 } as const;

const EMPTY: ContainerLayout = {
  placements: new Map(),
  affordances: [],
  unplaced: [],
  viewport: null,
  isPreview: false,
  mode: 'placed',
  scroll: NO_SCROLL,
};

/**
 * Owns one container's layout: viewport measurement, strategy resolution, the
 * layout run, lock-based affordance suppression, and affordance dispatch. No
 * framework and no rendering — a binding subscribes, reads `layout()`, and
 * turns rects into pixels.
 *
 * One host per container. Nesting is the binding's business: whoever renders a
 * child container constructs that child's host.
 */
export class ContainerHost {
  readonly #store: Store;
  readonly #parentId: NodeId;
  readonly #registry: StrategyRegistry;
  readonly #listeners = new Set<() => void>();
  readonly #unsubs: Array<() => void> = [];
  readonly #placementControls = new Map<NodeId, PlacementCommit>();

  #viewport: { w: number; h: number } | null = null;
  #scroll: { x: number; y: number } = NO_SCROLL;
  #scrollTeardown: (() => void) | null = null;
  #checkedConfig: unknown = Symbol('unchecked');
  #preview: LayoutPreview | null = null;
  #observer: ResizeObserver | null = null;
  readonly #natural = new Map<string, { w: number; h: number }>();
  #naturalObserver: ResizeObserver | null = null;
  readonly #naturalIds = new Map<Element, string>();
  #cache: ContainerLayout | null = null;
  #dirty = false;
  #containerRef: ContainerCap | undefined;
  #destroyed = false;

  constructor(store: Store, parentId: NodeId, registry: StrategyRegistry) {
    this.#store = store;
    this.#parentId = parentId;
    this.#registry = registry;
    this.#wire();
  }

  /**
   * Re-wire a host a previous `destroy()` tore down. A no-op while attached.
   *
   * React's StrictMode mounts effects, tears them down and mounts them again
   * against the same host, so without this the second mount runs on a host
   * with no subscriptions left — it renders once and then never hears about
   * another change.
   */
  attach(): void {
    if (!this.#destroyed) return;
    this.#destroyed = false;
    this.#wire();
    this.#invalidate();
  }

  #wire(): void {
    const store = this.#store;
    this.#containerRef = store.getNode(this.#parentId)?.container;

    // Mirrors what the React hook watched: the parent node's container
    // reference, plus two events whose effects that reference cannot show.
    this.#unsubs.push(
      store.subscribe(() => {
        const next = this.#store.getNode(this.#parentId)?.container;
        if (next !== this.#containerRef) {
          this.#containerRef = next;
          this.#invalidate();
        }
      }),
    );
    // `store.subscribe` above notifies on a later tick, so on its own it
    // leaves a window where a read taken right after a mutation sees the old
    // snapshot. These events fire synchronously and close it. The catch-all
    // stays as the backstop: anything not enumerated here is still caught,
    // just a tick late.
    const self = (e: { id: NodeId }) => e.id === this.#parentId;
    const child = (e: { id: NodeId }) =>
      this.#store.getChildren(this.#parentId).some((c) => c.id === e.id);

    for (const name of ['container.stateChanged', 'container.configChanged'] as const) {
      this.#unsubs.push(store.events.on(name, (e) => self(e) && this.#invalidate()));
    }
    for (const name of [
      'node.registered',
      'node.unregistered',
      'node.placementChanged',
      'node.pinnedChanged',
      'node.metaChanged',
      'node.hintsChanged',
    ] as const) {
      this.#unsubs.push(store.events.on(name, (e) => (self(e) || child(e)) && this.#invalidate()));
    }
    // Lifecycle decides which children are visible, so it changes the item set.
    this.#unsubs.push(
      store.events.on('node.transitioned', (e) => {
        if (e.machine === 'lifecycle' && (self(e) || child(e))) this.#invalidate();
      }),
    );
    this.#unsubs.push(
      store.events.on('node.reordered', (e) => {
        if (e.parentId === this.#parentId) this.#invalidate();
      }),
    );
    this.#unsubs.push(
      store.events.on('node.moved', (e) => {
        if (e.fromParentId === this.#parentId || e.toParentId === this.#parentId) {
          this.#invalidate();
        }
      }),
    );
    this.#unsubs.push(
      store.events.on('node.cascadeDestroyed', (e) => {
        if (e.parentId === this.#parentId) this.#invalidate();
      }),
    );
    // A resize lock lands on a *child*, leaving the parent's reference
    // untouched — without the child clause the layout goes stale holding
    // affordances the lock forbids.
    this.#unsubs.push(
      store.events.on('node.lockChanged', (e) => {
        if (
          e.id === this.#parentId ||
          this.#store.getChildren(this.#parentId).some((c) => c.id === e.id)
        ) {
          this.#invalidate();
        }
      }),
    );
  }

  /** Measure `el` and keep measuring it. Returns a teardown.
   *
   *  A binding with no fixed viewport (`<Panel container>`) reaches this on
   *  every mount, so an environment without ResizeObserver has to hold at the
   *  last known viewport rather than throw — same contract as `observeNatural`. */
  observe(el: Element): () => void {
    if (typeof ResizeObserver === 'undefined') return () => {};
    this.#observer?.disconnect();
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) this.setViewport({ w: r.width, h: r.height });
    });
    ro.observe(el);
    this.#observer = ro;
    return () => {
      ro.disconnect();
      if (this.#observer === ro) this.#observer = null;
    };
  }

  /**
   * Report a child's measured content extent, or drop it with `null`. The
   * headless path for content sizing — no DOM required, and the counterpart to
   * `observeNatural`.
   *
   * Reaches only children whose `hints.sizing` asked to be measured; anything
   * else is stored and ignored. Sub-pixel changes are dropped: a measurement
   * feeds a layout that resizes the measured element, and float churn across
   * that cycle would never settle.
   */
  setNaturalSize(id: NodeId, size: { w: number; h: number } | null): void {
    this.#writeNatural(String(id), size);
  }

  #writeNatural(key: string, size: { w: number; h: number } | null): void {
    const prev = this.#natural.get(key);
    if (size === null) {
      if (!prev) return;
      this.#natural.delete(key);
      this.#invalidate();
      return;
    }
    if (prev && Math.abs(prev.w - size.w) < 0.5 && Math.abs(prev.h - size.h) < 0.5) return;
    this.#natural.set(key, size);
    trace('layout', `natural: ${key} → ${Math.round(size.w)}×${Math.round(size.h)}`);
    this.#invalidate();
  }

  /**
   * Measure `el` as `id`'s content extent and keep measuring it. Returns a
   * teardown. The DOM convenience over `setNaturalSize`, mirroring
   * `observe` / `setViewport`.
   *
   * `el` must not be the element the layout sizes, or the measurement is of
   * the extent just written and the two never converge — pass an inner element
   * whose height is its content's.
   */
  observeNatural(id: NodeId, el: Element): () => void {
    const key = String(id);
    // A content-sized pane reaches this on every mount, unlike `observe`,
    // which a fixed viewport skips. Environments without ResizeObserver (jsdom)
    // must render the fallback size rather than throw.
    if (typeof ResizeObserver === 'undefined') return () => {};
    this.#naturalObserver ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const owner = this.#naturalIds.get(entry.target);
        if (!owner) continue;
        const r = entry.contentRect;
        this.#writeNatural(owner, { w: r.width, h: r.height });
      }
    });
    this.#naturalIds.set(el, key);
    this.#naturalObserver.observe(el);
    return () => {
      this.#naturalObserver?.unobserve(el);
      this.#naturalIds.delete(el);
      this.#writeNatural(key, null);
    };
  }

  /** Set the viewport directly. The headless path — no DOM required. */
  setViewport(v: { w: number; h: number }): void {
    if (this.#viewport && this.#viewport.w === v.w && this.#viewport.h === v.h) return;
    this.#viewport = v;
    this.#invalidate();
  }

  /**
   * Report how far this container's content is scrolled. The headless path —
   * a canvas host panning its own surface has no DOM scroll box to read, and
   * says so here. `observeScroll` is the DOM convenience over it.
   *
   * Does not re-run the strategy. Scroll moves where placements are shown, not
   * what they are, and a scroll event arrives per frame; the cached result is
   * republished with the new offset instead.
   */
  setScroll(s: { x: number; y: number }): void {
    if (this.#scroll.x === s.x && this.#scroll.y === s.y) return;
    this.#scroll = s;
    trace('layout', `scroll: ${this.#parentId} → ${Math.round(s.x)},${Math.round(s.y)}`);
    if (this.#cache && !this.#dirty) {
      this.#cache = { ...this.#cache, scroll: s };
      for (const fn of this.#listeners) fn();
      return;
    }
    this.#invalidate();
  }

  /**
   * Track `el`'s scroll offset and keep tracking it. Returns a teardown.
   *
   * `el` is whichever element actually scrolls for this container — usually
   * the wrapper the consumer put `overflow: auto` on, not the container box
   * itself, which is sized to `viewport + overflow` precisely so it does not.
   */
  observeScroll(el: Element): () => void {
    this.#scrollTeardown?.();
    const read = () => this.setScroll({ x: el.scrollLeft, y: el.scrollTop });
    read();
    el.addEventListener('scroll', read, { passive: true });
    const off = () => {
      el.removeEventListener('scroll', read);
      if (this.#scrollTeardown === off) this.#scrollTeardown = null;
    };
    this.#scrollTeardown = off;
    return off;
  }

  setPreview(p: LayoutPreview | null): void {
    const a = this.#preview;
    const same =
      (a === null && p === null) ||
      (a !== null &&
        p !== null &&
        a.insertId === p.insertId &&
        a.insertIndex === p.insertIndex &&
        a.cursor.x === p.cursor.x &&
        a.cursor.y === p.cursor.y &&
        a.split?.ontoId === p.split?.ontoId &&
        a.split?.edge === p.split?.edge &&
        a.split?.axis === p.split?.axis);
    if (same) return;
    this.#preview = p;
    this.#invalidate();
  }

  /**
   * The current layout. Identity-stable until something invalidates it, which
   * is what lets React use it as a `useSyncExternalStore` snapshot — returning
   * a fresh object per call loops the render forever.
   */
  layout = (): ContainerLayout => {
    if (this.#cache && !this.#dirty) return this.#cache;
    this.#cache = this.#compute();
    this.#dirty = false;
    return this.#cache;
  };

  /**
   * Notified when the layout goes stale. Notifications describe a transition
   * away from a value already read, so a listener that subscribes before the
   * first `layout()` hears nothing until it has read once — there is no
   * "changed" to report before then.
   */
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };

  /**
   * Make `id`'s placement controlled: a gesture that would have written it
   * instead hands the bag to `commit` and the store is left untouched. Returns
   * a teardown that restores uncontrolled commits.
   *
   * Scoped to `placement` only. A strategy that keeps its arrangement in
   * container state (split's ratio) is unaffected — that state is not the
   * child's to own.
   */
  registerPlacementControl(id: NodeId, commit: PlacementCommit): () => void {
    this.#placementControls.set(id, commit);
    trace('layout', `registerPlacementControl: ${id} (total: ${this.#placementControls.size})`);
    return () => {
      if (this.#placementControls.get(id) === commit) this.#placementControls.delete(id);
    };
  }

  /** Snapshot of every controlled child's placement, taken before a dispatch so
   *  the write it makes can be handed back and undone. */
  #capturePlacements(): Map<NodeId, Record<string, unknown>> {
    const out = new Map<NodeId, Record<string, unknown>>();
    for (const id of this.#placementControls.keys()) {
      const p = this.#store.getNode(id)?.membership?.placement;
      out.set(id, p ? { ...p } : {});
    }
    return out;
  }

  /** Hand each controlled child what the dispatch just wrote for it, then put
   *  the store back the way it was. Uncontrolled siblings keep their writes. */
  #divertControlled(before: Map<NodeId, Record<string, unknown>>, affordanceId: string): void {
    for (const [id, commit] of this.#placementControls) {
      const now = this.#store.getNode(id)?.membership?.placement;
      if (!now) continue;
      const prev = before.get(id) ?? {};
      if (placementEqual(prev, now)) continue;
      const proposed = { ...now };
      this.#store.patchPlacement(id, revertPatch(prev, proposed));
      trace('layout', `placement diverted to host: ${id} (${affordanceId})`);
      commit(proposed, { affordanceId, parentId: this.#parentId });
    }
  }

  /**
   * Feed a strategy event (e.g. a gutter drag delta) into the container's
   * `reduce()` and persist the result. No-op when a lock forbids it.
   */
  dispatchAffordance(event: LayoutEvent): void {
    const container = this.#store.getNode(this.#parentId)?.container;
    const viewport = this.#viewport;
    if (!container || !viewport) return;
    const strategy = this.#registry.get(container.strategyId);
    if (!strategy) return;
    if (this.#store.isLocked(this.#parentId, 'arrange')) {
      trace('layout', `dispatchAffordance ${this.#parentId}: REJECTED (lock.arrange)`);
      return;
    }
    const items = this.#visibleItems();
    const lastLayout = strategy.layout({
      items,
      container: viewport,
      state: (this.#store.getContainerState(this.#parentId) ??
        (strategy.initialState
          ? strategy.initialState(items, (container.config ?? {}) as Record<string, unknown>)
          : undefined)) as never,
      options: (container.config ?? {}) as Record<string, unknown>,
    });
    const aff = lastLayout.affordances.find((a) => a.id === event.affordanceId);
    if (affectsResizeLocked(this.#store, aff?.affects)) {
      trace('layout', `dispatchAffordance ${event.affordanceId}: REJECTED (pane lock.resize)`);
      return;
    }
    // Runs in addition to reduce — split clears placement.size here, then
    // updates its ratio in reduce.
    if (strategy.dispatchAffordance && aff) {
      const run = () => {
        strategy.dispatchAffordance?.({
          event,
          affordance: aff,
          store: this.#store,
          parentId: this.#parentId,
          container: viewport,
          options: (container.config ?? {}) as Record<string, unknown>,
          items,
        });
      };
      if (this.#placementControls.size === 0) {
        run();
      } else {
        // The revert is bookkeeping, not a second edit — a subscriber that sees
        // both halves separately would render the write it is meant never to see.
        const before = this.#capturePlacements();
        this.#store.transact(() => {
          run();
          this.#divertControlled(before, event.affordanceId);
        }, 'placement-control');
      }
    }
    if (!strategy.reduce) return;
    const current =
      this.#store.getContainerState(this.#parentId) ??
      (strategy.initialState
        ? strategy.initialState(items, (container.config ?? {}) as Record<string, unknown>)
        : undefined);
    const next = strategy.reduce(current as never, event, {
      container: viewport,
      options: (container.config ?? {}) as Record<string, unknown>,
      items,
    });
    if (next === current) return;
    this.#store.setContainerState(this.#parentId, next);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#observer?.disconnect();
    this.#observer = null;
    this.#naturalObserver?.disconnect();
    this.#naturalObserver = null;
    this.#scrollTeardown?.();
    this.#scrollTeardown = null;
    this.#naturalIds.clear();
    this.#natural.clear();
    for (const un of this.#unsubs) un();
    this.#unsubs.length = 0;
    this.#listeners.clear();
  }

  #visibleItems() {
    return this.#store
      .getChildren(this.#parentId)
      .filter((c) => c.lifecycle.state === 'visible')
      .map((c) => {
        const item = nodeToLayoutItem(c);
        const measured = this.#natural.get(String(c.id));
        if (measured && item.hints?.sizing) item.natural = measured;
        return item;
      });
  }

  // Coalesces: a mutation fires a synchronous `node.*` event and then, later,
  // the catch-all `store.subscribe`. Notifying once per read is enough — a
  // listener already told the layout is stale gains nothing from being told
  // again before it looks.
  #invalidate(): void {
    if (this.#destroyed || this.#dirty) return;
    this.#dirty = true;
    for (const fn of this.#listeners) fn();
  }

  /** Report config problems once per distinct config, not once per layout —
   *  `#compute` runs on every viewport change and every store notification. */
  #checkConfig(strategy: LayoutStrategy<unknown, string, unknown>, config: unknown): void {
    if (!strategy.configSpec || config === this.#checkedConfig) return;
    this.#checkedConfig = config;
    for (const problem of checkStrategyConfig(strategy.name, config, strategy.configSpec)) {
      trace('layout', problem);
    }
  }

  /**
   * Replace the onto-child's slot with the two halves the prospective split
   * would produce. Mutates `placements` and reports whether it could: a
   * registry with no split strategy, or an onto-child the parent did not
   * place, leaves the un-split layout alone rather than a half-applied one.
   */
  #applySplitPreview(
    placements: Map<NodeId, Rect>,
    sourceId: string,
    split: NonNullable<LayoutPreview['split']>,
  ): boolean {
    const slot = placements.get(split.ontoId as NodeId);
    if (!slot) {
      trace('layout', `split preview: ${split.ontoId} unplaced, showing the un-split layout`);
      return false;
    }
    const strategy = this.#registry.get(SPLIT_STRATEGY_ID);
    if (!strategy) {
      trace('layout', `split preview: no '${SPLIT_STRATEGY_ID}' strategy registered`);
      return false;
    }
    const halves = splitPreviewPlacements(
      slot,
      sourceId,
      split,
      strategy as LayoutStrategy<never, string, unknown>,
    );
    if (!halves) return false;
    for (const [id, rect] of halves) placements.set(id as NodeId, rect);
    trace('layout', `split preview: ${sourceId} into ${split.ontoId} ${split.axis}/${split.edge}`);
    return true;
  }

  #compute(): ContainerLayout {
    const node = this.#store.getNode(this.#parentId);
    const container = node?.container;
    const viewport = this.#viewport;
    if (!container) return viewport ? { ...EMPTY, viewport } : EMPTY;
    // Checked before the viewport guard: a flow container needs no measurement,
    // so waiting for one would leave its children unrendered forever.
    if (node?.hints?.render === 'flow')
      return { ...EMPTY, viewport, mode: 'flow', scroll: this.#scroll };
    if (!viewport) return EMPTY;
    const strategy = this.#registry.get(container.strategyId);
    if (!strategy) return { ...EMPTY, viewport };
    this.#checkConfig(strategy, container.config);

    const preview = this.#preview;
    if (preview && !preview.split && strategy.getDropPreview) {
      const fast = strategy.getDropPreview({
        items: this.#store
          .getChildren(this.#parentId)
          .filter((c) => c.lifecycle.state === 'visible')
          .map((c) => ({ id: c.id })),
        container: viewport,
        options: (container.config ?? {}) as Record<string, unknown>,
        insertId: preview.insertId,
        insertIndex: preview.insertIndex,
        cursor: preview.cursor,
      });
      if (fast) {
        return {
          placements: fast.placements as Map<NodeId, Rect>,
          affordances: [],
          unplaced: [],
          viewport,
          isPreview: fast.accepted,
          mode: 'placed',
          scroll: this.#scroll,
        };
      }
    }

    const persisted = this.#store.getContainerState(this.#parentId);
    const state =
      persisted ??
      (strategy.initialState
        ? strategy.initialState(
            this.#store
              .getChildren(this.#parentId)
              .filter((c) => c.lifecycle.state === 'visible')
              .map((c) => ({ id: c.id })),
            (container.config ?? {}) as Record<string, unknown>,
          )
        : undefined);
    const result: LayoutResult<NodeId, unknown> = runStrategyForContainer(
      this.#store,
      this.#parentId,
      viewport,
      strategy,
      state as never,
      preview ?? undefined,
      this.#natural,
    );
    // Suppress affordances the lock forbids so a gutter the user can see but
    // not drag never renders. Complements the dispatch guard, which also
    // covers a custom affordance renderer bypassing this path.
    const affordances = this.#store.isLocked(this.#parentId, 'arrange')
      ? []
      : result.affordances.filter((a) => !affectsResizeLocked(this.#store, a.affects));
    const split = preview?.split
      ? this.#applySplitPreview(result.placements, preview.insertId, preview.split)
      : true;
    const out: ContainerLayout = {
      placements: result.placements,
      affordances,
      unplaced: result.unplaced ?? [],
      viewport,
      isPreview: split ? (result.isPreview ?? false) : false,
      mode: 'placed',
      scroll: this.#scroll,
    };
    if (result.overflow) out.overflow = result.overflow;
    return out;
  }
}
