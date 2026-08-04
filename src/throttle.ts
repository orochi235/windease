/**
 * Opt-in transition throttling. See
 * `docs/superpowers/specs/2026-08-03-transition-throttling-design.md`.
 *
 * Nothing here runs unless the consumer passes a `throttle` policy to the
 * `Store` constructor; the un-throttled path stays identity-equal to truth.
 */

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
