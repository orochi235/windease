import { nodeToLayoutItem, runStrategyForContainer } from './layout-node-adapter.js';
import type {
  Affordance,
  LayoutEvent,
  LayoutPreview,
  LayoutResult,
  Rect,
  StrategyRegistry,
} from './layout-types.js';
import type { ContainerCap, NodeId } from './node.js';
import type { Store } from './store.js';
import { trace } from './trace.js';

export interface ContainerLayout {
  placements: Map<NodeId, Rect>;
  affordances: Affordance[];
  unplaced: NodeId[];
  viewport: { w: number; h: number } | null;
  /** True when these placements came from a `preview` input. */
  isPreview: boolean;
}

/** `affects` carries only real child ids, so a miss resolves to false rather than throwing. */
function affectsResizeLocked(store: Store, affects: Affordance['affects']): boolean {
  return affects?.some((cid) => store.isLocked(cid as NodeId, 'resize')) === true;
}

const EMPTY: ContainerLayout = {
  placements: new Map(),
  affordances: [],
  unplaced: [],
  viewport: null,
  isPreview: false,
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

  #viewport: { w: number; h: number } | null = null;
  #preview: LayoutPreview | null = null;
  #observer: ResizeObserver | null = null;
  #cache: ContainerLayout | null = null;
  #dirty = false;
  #containerRef: ContainerCap | undefined;
  #destroyed = false;

  constructor(store: Store, parentId: NodeId, registry: StrategyRegistry) {
    this.#store = store;
    this.#parentId = parentId;
    this.#registry = registry;
    this.#containerRef = store.getNode(parentId)?.container;

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

  /** Measure `el` and keep measuring it. Returns a teardown. */
  observe(el: Element): () => void {
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

  /** Set the viewport directly. The headless path — no DOM required. */
  setViewport(v: { w: number; h: number }): void {
    if (this.#viewport && this.#viewport.w === v.w && this.#viewport.h === v.h) return;
    this.#viewport = v;
    this.#invalidate();
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
        a.cursor.y === p.cursor.y);
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
      strategy.dispatchAffordance({
        event,
        affordance: aff,
        store: this.#store,
        parentId: this.#parentId,
        container: viewport,
        options: (container.config ?? {}) as Record<string, unknown>,
        items,
      });
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
    for (const un of this.#unsubs) un();
    this.#unsubs.length = 0;
    this.#listeners.clear();
  }

  #visibleItems() {
    return this.#store
      .getChildren(this.#parentId)
      .filter((c) => c.lifecycle.state === 'visible')
      .map((c) => nodeToLayoutItem(c));
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

  #compute(): ContainerLayout {
    const container = this.#store.getNode(this.#parentId)?.container;
    const viewport = this.#viewport;
    if (!container || !viewport) return viewport ? { ...EMPTY, viewport } : EMPTY;
    const strategy = this.#registry.get(container.strategyId);
    if (!strategy) return { ...EMPTY, viewport };

    const preview = this.#preview;
    if (preview && strategy.getDropPreview) {
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
    );
    // Suppress affordances the lock forbids so a gutter the user can see but
    // not drag never renders. Complements the dispatch guard, which also
    // covers a custom affordance renderer bypassing this path.
    const affordances = this.#store.isLocked(this.#parentId, 'arrange')
      ? []
      : result.affordances.filter((a) => !affectsResizeLocked(this.#store, a.affects));
    return {
      placements: result.placements,
      affordances,
      unplaced: result.unplaced ?? [],
      viewport,
      isPreview: result.isPreview ?? false,
    };
  }
}
