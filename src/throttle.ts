/**
 * Opt-in transition throttling. See
 * `docs/superpowers/specs/2026-08-03-transition-throttling-design.md`.
 *
 * Nothing here runs unless the consumer passes a `throttle` policy to the
 * `Store` constructor; the un-throttled path stays identity-equal to truth.
 */

import type { Node, NodeId } from './node.js';
import { trace } from './trace.js';

/** The FSM machines a node can carry; dwell is configured per machine. */
export type MachineName = 'lifecycle' | 'transit' | 'focus';

/** Opaque to windease; the clock implementation owns its meaning. */
export type TimerHandle = unknown;

/**
 * Injectable time source. Tests supply a `FakeClock` so dwell and stagger
 * assertions are deterministic — windease has snapshot round-trip and
 * history tests that real timers would make flaky.
 */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface ThrottlePolicy {
  /** Flush window in ms. Omit for microtask scheduling (the default). */
  notifyMs?: number;
  /** Per-machine minimum dwell in ms. Machines omitted are not gated. */
  dwell?: Partial<Record<MachineName, number>>;
  /** Starvation cap. Defaults to 4x the largest configured dwell. */
  maxWaitMs?: number;
  /** Publish at most `batch` newly-eligible nodes every `ms`. */
  stagger?: { batch: number; ms: number };
}

export interface StoreOptions {
  throttle?: ThrottlePolicy;
  clock?: Clock;
}

export interface PublisherDeps {
  /** Live reference to the Store's truth map. Never copied wholesale. */
  truth: ReadonlyMap<NodeId, Node>;
  policy: ThrottlePolicy | undefined;
  clock: Clock;
  readGlobals: () => { rootIds: readonly NodeId[]; focusedId: NodeId | null };
  notify: () => void;
}

/**
 * Owns the published projection of the store.
 *
 * With no policy the Publisher is in **passthrough**: `nodes` returns the
 * truth map by identity, dirty marking is a no-op, and scheduling is the
 * plain `queueMicrotask` the Store has always used. Nothing is allocated
 * and nothing is tracked, so an un-throttled Store pays no cost.
 */
export class Publisher {
  readonly passthrough: boolean;

  private readonly truth: ReadonlyMap<NodeId, Node>;
  private readonly policy: ThrottlePolicy | undefined;
  private readonly clock: Clock;
  private readonly readGlobals: PublisherDeps['readGlobals'];
  private readonly notify: () => void;

  private readonly publishedNodes: Map<NodeId, Node> | null;
  private publishedRootIds: readonly NodeId[] = [];
  private publishedFocusedId: NodeId | null = null;

  private readonly dirty = new Set<NodeId>();
  private globalsDirty = false;
  private scheduled = false;
  private timer: TimerHandle | null = null;

  constructor(deps: PublisherDeps) {
    this.truth = deps.truth;
    this.policy = deps.policy;
    this.clock = deps.clock;
    this.readGlobals = deps.readGlobals;
    this.notify = deps.notify;
    this.passthrough = deps.policy === undefined;
    this.publishedNodes = this.passthrough ? null : new Map();
  }

  // ===== Published reads =====

  get nodes(): ReadonlyMap<NodeId, Node> {
    return this.passthrough ? this.truth : (this.publishedNodes as Map<NodeId, Node>);
  }

  get rootIds(): readonly NodeId[] {
    return this.passthrough ? this.readGlobals().rootIds : this.publishedRootIds;
  }

  get focusedId(): NodeId | null {
    return this.passthrough ? this.readGlobals().focusedId : this.publishedFocusedId;
  }

  // ===== Dirty marking =====

  markDirty(id: NodeId): void {
    if (!this.passthrough) this.dirty.add(id);
    this.schedule();
  }

  markGlobalsDirty(): void {
    if (!this.passthrough) this.globalsDirty = true;
    this.schedule();
  }

  // ===== Scheduling =====

  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const windowMs = this.policy?.notifyMs;
    if (windowMs === undefined) {
      queueMicrotask(() => this.runFlush());
    } else {
      this.timer = this.clock.setTimeout(() => this.runFlush(), windowMs);
    }
  }

  /** Publish everything pending right now, bypassing every gate. */
  flushNow(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    // A queued microtask can't be cancelled; clearing `scheduled` makes it
    // a no-op when it lands.
    this.scheduled = false;
    this.flush();
  }

  /** Drop all pending state. Used by `deserialize`. */
  reset(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduled = false;
    this.dirty.clear();
    this.globalsDirty = false;
    if (this.publishedNodes) {
      this.publishedNodes.clear();
      for (const [id, node] of this.truth) this.publishedNodes.set(id, node);
      const g = this.readGlobals();
      this.publishedRootIds = [...g.rootIds];
      this.publishedFocusedId = g.focusedId;
    }
  }

  private runFlush(): void {
    // flushNow() may have already drained us.
    if (!this.scheduled) return;
    this.scheduled = false;
    this.timer = null;
    this.flush();
  }

  private flush(): void {
    if (this.passthrough) {
      this.notify();
      return;
    }
    const published = this.publishedNodes as Map<NodeId, Node>;
    let count = 0;
    for (const id of this.dirty) {
      const node = this.truth.get(id);
      if (node === undefined) published.delete(id);
      else published.set(id, node);
      count++;
    }
    this.dirty.clear();
    if (this.globalsDirty) {
      const g = this.readGlobals();
      this.publishedRootIds = [...g.rootIds];
      this.publishedFocusedId = g.focusedId;
      this.globalsDirty = false;
    }
    trace('throttle', `flush: published ${count} node(s)`);
    this.notify();
  }
}
