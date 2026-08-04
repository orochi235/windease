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

interface DirtyEntry {
  /** clock.now() when this node first went dirty and has stayed dirty. */
  since: number;
  /** clock.now() of the most recent change; the debounce restarts here. */
  touched: number;
  /**
   * Largest dwell among the machines that transitioned since the last
   * publish. 0 means this node is not dwell-gated — only non-FSM changes
   * have landed, so it rides the notifyMs window.
   */
  dwellMs: number;
  /** Structural change (register/unregister/move); bypasses dwell entirely. */
  bypass: boolean;
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

  private readonly dirty = new Map<NodeId, DirtyEntry>();
  private globalsDirty = false;
  private scheduled = false;
  private timer: TimerHandle | null = null;
  private readonly maxWaitMs: number;
  private forceFullFlush = false;

  constructor(deps: PublisherDeps) {
    this.truth = deps.truth;
    this.policy = deps.policy;
    this.clock = deps.clock;
    this.readGlobals = deps.readGlobals;
    this.notify = deps.notify;
    this.passthrough = deps.policy === undefined;
    this.publishedNodes = this.passthrough ? null : new Map();

    const dwells = Object.values(deps.policy?.dwell ?? {}).filter(
      (v): v is number => typeof v === 'number',
    );
    const largestDwell = dwells.length > 0 ? Math.max(...dwells) : 0;
    this.maxWaitMs = deps.policy?.maxWaitMs ?? largestDwell * 4;
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

  /**
   * `opts` is accepted but inert until dwell lands; it exists now so that
   * Store's call sites don't need a second pass to add it.
   */
  markDirty(id: NodeId, opts?: { machine?: MachineName; bypass?: boolean }): void {
    if (!this.passthrough) {
      const now = this.clock.now();
      const dwellForMachine = opts?.machine ? (this.policy?.dwell?.[opts.machine] ?? 0) : 0;
      const existing = this.dirty.get(id);
      if (existing) {
        existing.touched = now;
        // A node dwells for the longest gate that applies to it.
        if (dwellForMachine > existing.dwellMs) existing.dwellMs = dwellForMachine;
        if (opts?.bypass) existing.bypass = true;
      } else {
        this.dirty.set(id, {
          since: now,
          touched: now,
          dwellMs: dwellForMachine,
          bypass: opts?.bypass ?? false,
        });
      }
    }
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
    const bypassed = this.passthrough ? 0 : this.dirty.size;
    trace('throttle', `flushNow: bypassing gates for ${bypassed} dirty node(s)`);
    this.forceFullFlush = true;
    this.flush();
  }

  /**
   * Drop all pending state and resync published to truth. Used by
   * `deserialize`. Notifies synchronously and unconditionally — hydration
   * always changes everything, so callers (e.g. the upcoming
   * `Store.deserialize`) must not notify a second time after calling this.
   */
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
    trace('throttle', `reset: published resynced to truth (${this.nodes.size} node(s))`);
    this.notify();
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
    const now = this.clock.now();
    const full = this.forceFullFlush;
    this.forceFullFlush = false;

    // Oldest-dirty-first, ties by insertion order, so waves are
    // deterministic and reproducible across runs.
    const eligible: NodeId[] = [];
    let held = 0;
    for (const [id, entry] of this.dirty) {
      if (!full && !this.isEligible(entry, now)) {
        held++;
        continue;
      }
      eligible.push(id);
    }
    eligible.sort((x, y) => {
      const ex = this.dirty.get(x) as DirtyEntry;
      const ey = this.dirty.get(y) as DirtyEntry;
      return ex.since - ey.since;
    });

    const batch = full ? eligible.length : (this.policy?.stagger?.batch ?? eligible.length);
    const wave = eligible.slice(0, batch);
    const deferred = eligible.length - wave.length;

    for (const id of wave) {
      const node = this.truth.get(id);
      if (node === undefined) published.delete(id);
      else published.set(id, node);
      this.dirty.delete(id);
    }

    if (this.globalsDirty) {
      const g = this.readGlobals();
      this.publishedRootIds = [...g.rootIds];
      this.publishedFocusedId = g.focusedId;
      this.globalsDirty = false;
    }

    if (wave.length > 0 || (held === 0 && deferred === 0)) {
      trace('throttle', `flush: published ${wave.length}, deferred ${deferred}, held ${held}`);
      this.notify();
    }

    if (this.dirty.size > 0) this.scheduleNextWave(deferred > 0, now);
  }

  /**
   * Re-arm after a partial flush. A stagger-deferred remainder waits the
   * configured wave interval; a dwell-held remainder wakes when it becomes
   * eligible.
   *
   * Neither branch may re-arm via `schedule()` — see `scheduleRecheck` for
   * why that busy-spins.
   */
  private scheduleNextWave(staggered: boolean, now: number): void {
    if (this.scheduled) return;
    const waveMs = this.policy?.stagger?.ms;
    if (staggered && waveMs !== undefined) {
      this.scheduled = true;
      trace('throttle', `scheduleNextWave: next wave in ${waveMs}ms`);
      this.timer = this.clock.setTimeout(() => this.runFlush(), waveMs);
      return;
    }
    this.scheduleRecheck(now);
  }

  /**
   * Re-arm for nodes held back by dwell, waking at the earliest moment any
   * held entry becomes eligible.
   *
   * Do NOT re-arm via `schedule()` here. That would reschedule at the notify
   * window — or, when `notifyMs` is undefined, on a microtask — and a node
   * held by dwell would then be re-checked over and over without publishing,
   * busy-spinning for the entire dwell duration. On the microtask path that
   * starves the event loop outright.
   */
  private scheduleRecheck(now: number): void {
    if (this.scheduled) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const entry of this.dirty.values()) {
      if (entry.bypass || entry.dwellMs === 0) {
        earliest = now;
        break;
      }
      const byDwell = entry.touched + entry.dwellMs;
      const byMaxWait =
        this.maxWaitMs > 0 ? entry.since + this.maxWaitMs : Number.POSITIVE_INFINITY;
      earliest = Math.min(earliest, byDwell, byMaxWait);
    }
    if (earliest === Number.POSITIVE_INFINITY) return;
    this.scheduled = true;
    const delay = Math.max(0, earliest - now);
    trace('throttle', `scheduleRecheck: waking in ${delay}ms for ${this.dirty.size} held node(s)`);
    this.timer = this.clock.setTimeout(() => this.runFlush(), delay);
  }

  /**
   * A node publishes once it has been quiet for `dwellMs`, or when
   * `maxWaitMs` has elapsed since it first went dirty — the starvation cap
   * that stops a permanently-noisy node from never updating.
   */
  private isEligible(entry: DirtyEntry, now: number): boolean {
    if (entry.bypass || entry.dwellMs === 0) return true;
    if (now - entry.touched >= entry.dwellMs) return true;
    if (this.maxWaitMs > 0 && now - entry.since >= this.maxWaitMs) {
      trace('throttle', `maxWait forced publish after ${now - entry.since}ms`);
      return true;
    }
    return false;
  }
}
