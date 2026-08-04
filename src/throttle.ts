/**
 * Opt-in transition throttling. See
 * `docs/superpowers/specs/2026-08-03-transition-throttling-design.md`.
 *
 * Nothing here runs unless the consumer passes a `throttle` policy to the
 * `Store` constructor; the un-throttled path stays identity-equal to truth.
 */

import { InvalidThrottlePolicyError } from './errors.js';
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
  /**
   * Flush window in ms. Omit for microtask scheduling (the default). Must
   * be a finite number \>= 0 if provided. `0` is legal and meaningful — a
   * real zero-delay timer, distinct from omitting the field.
   */
  notifyMs?: number;
  /**
   * Per-machine minimum dwell in ms. Machines omitted are not gated. Each
   * configured value must be a finite number \>= 0.
   */
  dwell?: Partial<Record<MachineName, number>>;
  /**
   * Starvation cap. Defaults to 4x the largest configured dwell. Must be a
   * finite number \>= 0 if provided. `0` disables the cap (see
   * {@link Publisher.isEligible}) rather than forcing an immediate publish.
   */
  maxWaitMs?: number;
  /**
   * Publish at most `batch` newly-eligible nodes every `ms`. `batch` must
   * be a finite integer \>= 1 — an explicit `0` (or any value below 1)
   * would silently starve every dwelling node forever, so it is rejected
   * at construction rather than papered over. `ms` must be a finite
   * number \>= 0.
   */
  stagger?: { batch: number; ms: number };
}

/**
 * Throws `InvalidThrottlePolicyError` for any field whose value would
 * silently misbehave rather than do something sensible. Called once, at
 * `Publisher` construction — a bad policy fails loudly up front instead of
 * quietly never publishing.
 */
function validateThrottlePolicy(policy: ThrottlePolicy): void {
  const reject = (field: string, value: unknown, requirement: string): never => {
    throw new InvalidThrottlePolicyError(
      field,
      value,
      `ThrottlePolicy.${field} must be ${requirement} (got ${String(value)})`,
    );
  };

  if (policy.notifyMs !== undefined) {
    if (!Number.isFinite(policy.notifyMs) || policy.notifyMs < 0) {
      reject('notifyMs', policy.notifyMs, 'a finite number >= 0');
    }
  }

  if (policy.dwell) {
    for (const [machine, ms] of Object.entries(policy.dwell)) {
      if (ms === undefined) continue;
      if (!Number.isFinite(ms) || ms < 0) {
        reject(`dwell.${machine}`, ms, 'a finite number >= 0');
      }
    }
  }

  if (policy.maxWaitMs !== undefined) {
    if (!Number.isFinite(policy.maxWaitMs) || policy.maxWaitMs < 0) {
      reject('maxWaitMs', policy.maxWaitMs, 'a finite number >= 0');
    }
  }

  if (policy.stagger) {
    const { batch, ms } = policy.stagger;
    if (!Number.isFinite(batch) || !Number.isInteger(batch) || batch < 1) {
      reject('stagger.batch', batch, 'a finite integer >= 1');
    }
    if (!Number.isFinite(ms) || ms < 0) {
      reject('stagger.ms', ms, 'a finite number >= 0');
    }
  }
}

export interface StoreOptions {
  throttle?: ThrottlePolicy;
  clock?: Clock;
}

/**
 * A read-only snapshot of what is currently being withheld for one node,
 * as returned by {@link Store.getPending}. Answers "why hasn't this
 * published yet?" — a plain value derived from internal bookkeeping, not
 * a live view of it.
 *
 * Every field describes the **current pending episode** — from the moment
 * a clean node is marked dirty until it publishes. A node that publishes
 * and goes dirty again reports fresh values; nothing here is cumulative.
 *
 * @group Store
 */
export interface PendingPublish {
  /** `clock.now()` when the node first went dirty and has stayed dirty. */
  since: number;
  /** `clock.now()` of the most recent dwell-restarting change. */
  touched: number;
  /**
   * Largest dwell gating this node; `0` means it is not dwell-gated.
   * Ignored while `bypass` is set — a bypassing entry can carry a
   * non-zero `dwellMs` that gates nothing.
   */
  dwellMs: number;
  /**
   * The machine that set the current `dwellMs`, or `null` when no dwell
   * applies. Not necessarily the machine restarting the debounce — a
   * shorter-dwell machine can be the one churning while a longer-dwell
   * machine still governs the deadline. Like `dwellMs`, inert while
   * `bypass` is set.
   */
  machine: MachineName | null;
  /** Structural change (register/unregister/move); skips dwell entirely. */
  bypass: boolean;
  /**
   * Internal dirty-marks after the first one in this episode. **Not** a
   * count of store operations — a single call like `showNode` marks the
   * node more than once (the record swap and the FSM transition are
   * separate marks), so read this as a churn indicator, not a change
   * tally.
   */
  coalesced: number;
  /**
   * Earliest the gate opens — **not** when the node will publish.
   * `notifyMs` coalescing and stagger waves can both defer the actual
   * flush past this moment. Expressed in the domain of the clock the
   * store was constructed with (`Date.now()` unless one was injected).
   *
   * Which gate is binding, in precedence order: `bypass` releases the
   * node immediately and outranks everything below it; otherwise, when
   * `eligibleAt` is less than `touched + dwellMs`, the `maxWaitMs`
   * starvation cap is what will release this node rather than the dwell
   * debounce.
   */
  eligibleAt: number;
}

interface DirtyEntry {
  /** clock.now() when this node first went dirty and has stayed dirty. */
  since: number;
  /**
   * clock.now() of the most recent dwell-restarting change; the debounce
   * restarts here.
   */
  touched: number;
  /**
   * Largest dwell among the machines that transitioned since the last
   * publish. 0 means this node is not dwell-gated — only non-FSM changes
   * have landed, so it rides the notifyMs window.
   */
  dwellMs: number;
  /** Machine whose dwell set the current `dwellMs`; null when ungated. */
  machine: MachineName | null;
  /** Structural change (register/unregister/move); bypasses dwell entirely. */
  bypass: boolean;
  /** Changes that landed while this entry was already pending. */
  coalesced: number;
}

/**
 * Emitted as `throttle.pending` on `store.events` when a node first goes
 * dirty and starts being withheld. Fires once per pending episode, not
 * once per change — see `throttle.published` for the other end.
 *
 * Carries only what is settled at emit time. The dwell gate is not: one
 * store mutation marks a node several times, and the mark that creates
 * the entry is typically the untagged one from `replaceNode`, so
 * `dwellMs` is still `0` here and is raised immediately afterwards. Read
 * {@link Store.getPending} for the settled gate.
 *
 * Never emitted by an un-throttled store.
 *
 * Fires mid-mutation, from inside `markDirty`, so a handler that walks the
 * node tree may observe a half-applied change — e.g. during `moveNode` it
 * lands after the old parent's `removeChild` but before the new parent's
 * `addChild`. Consistent with how `node.transitioned` already behaves.
 *
 * @group Store
 */
export interface ThrottlePendingPayload {
  id: NodeId;
  /** `clock.now()` when the node went dirty. */
  since: number;
}

export interface PublisherDeps {
  /** Live reference to the Store's truth map. Never copied wholesale. */
  truth: ReadonlyMap<NodeId, Node>;
  policy: ThrottlePolicy | undefined;
  clock: Clock;
  readGlobals: () => { rootIds: readonly NodeId[]; focusedId: NodeId | null };
  notify: () => void;
  /**
   * Called when a node starts being withheld. Optional so test harnesses
   * and any future embedder can omit it; `Store` always supplies it.
   */
  onPending?: (payload: ThrottlePendingPayload) => void;
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
  private readonly onPending: PublisherDeps['onPending'];

  private readonly publishedNodes: Map<NodeId, Node> | null;
  private publishedRootIds: readonly NodeId[] = [];
  private publishedFocusedId: NodeId | null = null;

  // Allocated only for a throttled Publisher — see the class doc. Every
  // read site is reached exclusively via a `!this.passthrough` guard (or,
  // in `flush()`/`scheduleNextWave()`/`scheduleRecheck()`, code that only
  // runs after `flush()`'s own passthrough early-return), so the non-null
  // assertions below are safe.
  private readonly dirty: Map<NodeId, DirtyEntry> | null;
  private globalsDirty = false;
  private scheduled = false;
  private timer: TimerHandle | null = null;
  private readonly maxWaitMs: number;
  private forceFullFlush = false;

  constructor(deps: PublisherDeps) {
    if (deps.policy) validateThrottlePolicy(deps.policy);

    this.truth = deps.truth;
    this.policy = deps.policy;
    this.clock = deps.clock;
    this.readGlobals = deps.readGlobals;
    this.notify = deps.notify;
    this.onPending = deps.onPending;
    this.passthrough = deps.policy === undefined;
    this.publishedNodes = this.passthrough ? null : new Map();
    this.dirty = this.passthrough ? null : new Map();

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

  /**
   * What is currently being withheld for `id`, or `null` if nothing is —
   * either the node is clean, or this Publisher is in passthrough, which
   * tracks nothing and so can never withhold anything. Covers node
   * updates only — withheld global state (`rootIds`, `focusedId`) is
   * tracked separately and is not reflected here.
   */
  getPending(id: NodeId): PendingPublish | null {
    if (this.passthrough) return null;
    const entry = (this.dirty as Map<NodeId, DirtyEntry>).get(id);
    if (entry === undefined) return null;
    return {
      since: entry.since,
      touched: entry.touched,
      dwellMs: entry.dwellMs,
      machine: entry.machine,
      bypass: entry.bypass,
      coalesced: entry.coalesced,
      eligibleAt: this.eligibleAt(entry),
    };
  }

  // ===== Dirty marking =====

  /**
   * Only a dwell-gated FSM transition restarts the debounce clock
   * (`touched`). A call with no `machine` tag — or one whose machine has no
   * configured dwell — still marks the node dirty (so it publishes on the
   * usual window/dwell schedule) but must NOT push the deadline out, or a
   * dwelling node fed a steady stream of ordinary field writes (activity,
   * placement, meta) would never go quiet and would ride `maxWaitMs`
   * instead of `dwellMs`. `since` (which drives `maxWaitMs`) is never
   * touched here either way.
   */
  markDirty(id: NodeId, opts?: { machine?: MachineName; bypass?: boolean }): void {
    if (!this.passthrough) {
      const dirty = this.dirty as Map<NodeId, DirtyEntry>;
      const now = this.clock.now();
      const dwellForMachine = opts?.machine ? (this.policy?.dwell?.[opts.machine] ?? 0) : 0;
      const restartsDebounce = dwellForMachine > 0;
      const existing = dirty.get(id);
      if (existing) {
        existing.coalesced++;
        if (restartsDebounce) existing.touched = now;
        // A node dwells for the longest gate that applies to it. The
        // `?? null` here is unreachable: `dwellForMachine > 0` is only
        // true when `opts.machine` produced it, so `opts?.machine` is
        // always set on this branch — `machine` never gets cleared by a
        // winning dwell.
        if (dwellForMachine > existing.dwellMs) {
          existing.dwellMs = dwellForMachine;
          existing.machine = opts?.machine ?? null;
        }
        if (opts?.bypass) existing.bypass = true;
      } else {
        const entry: DirtyEntry = {
          since: now,
          touched: now,
          dwellMs: dwellForMachine,
          // Same invariant as above: dwellForMachine > 0 implies opts.machine is set.
          machine: dwellForMachine > 0 ? (opts?.machine ?? null) : null,
          bypass: opts?.bypass ?? false,
          coalesced: 0,
        };
        dirty.set(id, entry);
        // No dwell in the message: this fires on entry creation, and the
        // gate is raised by a later mark in the same mutation. The mark
        // that created the entry is named instead — usually 'untagged',
        // since that's the mark that typically wins the race.
        trace(
          'throttle',
          `pending: ${id} withheld from ${now} (mark: ${opts?.machine ?? 'untagged'}${opts?.bypass ? ', bypass' : ''})`,
        );
        this.onPending?.({ id, since: now });
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
    const bypassed = this.passthrough ? 0 : (this.dirty as Map<NodeId, DirtyEntry>).size;
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
    this.dirty?.clear();
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
    const dirty = this.dirty as Map<NodeId, DirtyEntry>;
    const now = this.clock.now();
    const full = this.forceFullFlush;
    this.forceFullFlush = false;

    // Oldest-dirty-first, ties by insertion order, so waves are
    // deterministic and reproducible across runs.
    const eligible: NodeId[] = [];
    let held = 0;
    for (const [id, entry] of dirty) {
      if (!full && !this.isEligible(entry, now)) {
        held++;
        continue;
      }
      eligible.push(id);
    }
    eligible.sort((x, y) => {
      const ex = dirty.get(x) as DirtyEntry;
      const ey = dirty.get(y) as DirtyEntry;
      return ex.since - ey.since;
    });

    const batch = full ? eligible.length : (this.policy?.stagger?.batch ?? eligible.length);
    const wave = eligible.slice(0, batch);
    const deferred = eligible.length - wave.length;

    for (const id of wave) {
      const node = this.truth.get(id);
      if (node === undefined) published.delete(id);
      else published.set(id, node);
      dirty.delete(id);
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

    if (dirty.size > 0) this.scheduleNextWave(deferred > 0, now);
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
    const dirty = this.dirty as Map<NodeId, DirtyEntry>;
    let earliest = Number.POSITIVE_INFINITY;
    for (const entry of dirty.values()) {
      earliest = Math.min(earliest, this.eligibleAt(entry));
    }
    if (earliest === Number.POSITIVE_INFINITY) return;
    this.scheduled = true;
    const delay = Math.max(0, earliest - now);
    trace('throttle', `scheduleRecheck: waking in ${delay}ms for ${dirty.size} held node(s)`);
    this.timer = this.clock.setTimeout(() => this.runFlush(), delay);
  }

  /**
   * The earliest moment `entry`'s gate opens: its dwell debounce or the
   * `maxWaitMs` starvation cap, whichever lands first. An entry that is
   * not dwell-gated (`bypass`, or `dwellMs === 0`) opened its gate the
   * moment it went dirty, so it reports `since`.
   *
   * A pure function of the entry — it never reads the clock, so two
   * callers in the same tick always agree. Single source of truth for
   * `isEligible`, `scheduleRecheck`, and the public `getPending`
   * descriptor; do not re-inline this expression at a call site.
   */
  private eligibleAt(entry: DirtyEntry): number {
    if (entry.bypass || entry.dwellMs === 0) return entry.since;
    const byDwell = entry.touched + entry.dwellMs;
    const byMaxWait = this.maxWaitMs > 0 ? entry.since + this.maxWaitMs : Number.POSITIVE_INFINITY;
    return Math.min(byDwell, byMaxWait);
  }

  /**
   * A node publishes once it has been quiet for `dwellMs`, or when
   * `maxWaitMs` has elapsed since it first went dirty — the starvation cap
   * that stops a permanently-noisy node from never updating.
   */
  private isEligible(entry: DirtyEntry, now: number): boolean {
    // `eligibleAt` already special-cases these, so this guard is not what
    // makes the boolean correct — it keeps a fresh un-gated entry from
    // falling into the maxWait trace below and being mislabeled. A node
    // marked `{ machine, bypass: true }` has a real `dwellMs` it never
    // waited on; without this it would log a starvation publish that
    // never happened.
    if (entry.bypass || entry.dwellMs === 0) return true;
    if (now < this.eligibleAt(entry)) return false;
    // The gate opened. If the dwell debounce isn't what opened it, the
    // starvation cap did — that's the interesting case to log.
    if (now - entry.touched < entry.dwellMs) {
      trace(
        'throttle',
        `maxWait forced publish after ${now - entry.since}ms (${entry.coalesced} coalesced)`,
      );
    }
    return true;
  }
}
