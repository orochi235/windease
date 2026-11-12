import { type Clock, systemClock } from '../throttle.js';
import { trace } from '../trace.js';

/** Milliseconds a finger holds still before a `touchScroll: 'hold'` press becomes a drag. */
export const TOUCH_HOLD_DELAY = 450;
/** Pixels a held finger may drift before the press counts as a scroll. */
export const TOUCH_HOLD_SLOP = 8;

/** Timing for {@link startTouchHold}. */
export interface TouchHoldOptions {
  /** Default {@link TOUCH_HOLD_DELAY}. */
  delay?: number;
  /** Default {@link TOUCH_HOLD_SLOP}. */
  slop?: number;
  clock?: Clock;
  /** Names the press in traces. */
  label?: string;
}

export type TouchHoldPhase = 'pending' | 'armed' | 'canceled';

/** A press waiting out its hold. */
export interface TouchHold {
  phase(): TouchHoldPhase;
  /** Report the finger's position. Past the slop while pending, the hold is
   *  canceled. Returns whether the hold is still alive. */
  move(x: number, y: number): boolean;
  /** End the hold before it arms: a release, a browser cancel, an unmount. */
  cancel(reason: string): void;
}

/**
 * Wait for a press at `(x, y)` to stay within `slop` for `delay`, then call
 * `onArm`. Moving out of the slop first cancels it, which is what leaves a
 * swipe to the browser as a scroll.
 */
export function startTouchHold(
  x: number,
  y: number,
  onArm: () => void,
  options: TouchHoldOptions = {},
): TouchHold {
  const delay = options.delay ?? TOUCH_HOLD_DELAY;
  const slop = options.slop ?? TOUCH_HOLD_SLOP;
  const clock = options.clock ?? systemClock;
  const label = options.label ?? 'press';
  let phase: TouchHoldPhase = 'pending';

  const timer = clock.setTimeout(() => {
    if (phase !== 'pending') return;
    phase = 'armed';
    trace('dnd', `touch hold on ${label} armed after ${delay}ms`);
    onArm();
  }, delay);

  const cancel = (reason: string) => {
    if (phase !== 'pending') return;
    phase = 'canceled';
    clock.clearTimeout(timer);
    trace('dnd', `touch hold on ${label} canceled: ${reason}`);
  };

  return {
    phase: () => phase,
    move(mx, my) {
      if (phase !== 'pending') return phase === 'armed';
      const drift = Math.hypot(mx - x, my - y);
      if (drift > slop) cancel(`moved ${drift.toFixed(1)}px > ${slop} — left to scroll`);
      return phase === 'pending';
    },
    cancel,
  };
}
