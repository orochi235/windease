import { trace } from './trace.js';

/** How a gesture ended: its armed target was carried out, or it was not. */
export type GestureEnd = 'commit' | 'cancel';

/** The rules one kind of gesture runs by. `T` is what a release would act on:
 *  a drop target, the node a seam would close. */
export interface GestureOptions<T> {
  /** Names the gesture in traces: `drag w1`, `seam split:0`. */
  name: string;
  /** The lock check on starting at all: a reason to refuse, or null. */
  refuse?: () => string | null;
  /** The lock check on one target. Asked only when a target is offered, so a
   *  reducer that offers nothing below its threshold costs nothing per move. */
  permits?: (target: T) => boolean;
  /** Carry the gesture out on release. Runs while the gesture is still active. */
  commit: (target: T) => void;
  /** Make the commit one undo step. A `label` that answers undefined for a
   *  target leaves the commit to be one already, through the store call it
   *  makes, whose own label then stands. */
  undo?: {
    transact: (fn: () => void, label?: string) => void;
    label: (target: T) => string | undefined;
  };
  /** What a screen reader hears while `target` is armed. */
  describe?: (target: T) => string;
  /** Whether two offers name the same target; an offer of the same one updates
   *  the armed value without reporting a change. Defaults to `Object.is`. */
  same?: (a: T, b: T) => boolean;
  /** How a target reads in a trace. Defaults to `String`. */
  show?: (target: T) => string;
  /** Called on every change of the armed target, with null on disarm and end. */
  onArm?: (target: T | null) => void;
  /** Called once per gesture after it ends, either way. */
  onEnd?: (how: GestureEnd) => void;
}

/** A gesture as a host draws it. */
export interface GestureState<T> {
  active: boolean;
  /** What a release would act on now, or null. */
  armed: T | null;
  /** `describe(armed)`, or empty while nothing is armed. */
  message: string;
}

const IDLE: GestureState<never> = Object.freeze({ active: false, armed: null, message: '' });

/**
 * The lifecycle every drag gesture shares, whatever it drags: begin under a
 * lock check, arm a target under another, then release to commit it as one
 * undo step, or cancel. Knows nothing of pointers or elements; a host feeds it
 * `begin` / `offer` / `release` / `cancel` and draws `state()`.
 *
 * `offer` takes what the gesture's own reducer resolved from geometry — a
 * hover, a seam's overshoot — so the lifecycle stays the same across them.
 */
export class Gesture<T> {
  private current: GestureState<T> = IDLE;
  private readonly listeners = new Set<(state: GestureState<T>) => void>();

  constructor(private readonly options: GestureOptions<T>) {}

  state(): GestureState<T> {
    return this.current;
  }

  subscribe(fn: (state: GestureState<T>) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  begin(): boolean {
    const { name, refuse } = this.options;
    if (this.current.active) {
      trace('dnd', `${name}: begin refused (already active)`);
      return false;
    }
    const reason = refuse?.() ?? null;
    if (reason !== null) {
      trace('dnd', `${name}: begin refused (${reason})`);
      return false;
    }
    trace('dnd', `${name}: begin`);
    this.set({ active: true, armed: null, message: '' });
    return true;
  }

  /** Arm `target`, or disarm with null. Answers whether it is armed now. */
  offer(target: T | null): boolean {
    if (!this.current.active) return false;
    const { permits, same = Object.is } = this.options;
    const next = target !== null && (permits?.(target) ?? true) ? target : null;
    const was = this.current.armed;
    const changed = next === null || was === null ? next !== was : !same(was, next);
    if (changed) this.trace(next, was);
    if (changed || next !== was) {
      this.set({ active: true, armed: next, message: this.describe(next) }, changed);
    }
    if (changed) this.options.onArm?.(next);
    return next !== null;
  }

  /** Commit the armed target, if any, and end. Answers whether it committed. */
  release(): boolean {
    if (!this.current.active) return false;
    const target = this.current.armed;
    if (target === null) {
      this.end('cancel', 'released unarmed');
      return false;
    }
    const { name, commit, undo } = this.options;
    try {
      trace('dnd', `${name}: commit ${this.show(target)}`);
      const label = undo?.label(target);
      if (undo && label !== undefined) undo.transact(() => commit(target), label);
      else commit(target);
    } finally {
      this.end('commit');
    }
    return true;
  }

  cancel(reason: string): void {
    if (!this.current.active) return;
    this.end('cancel', reason);
  }

  private end(how: GestureEnd, reason?: string): void {
    const wasArmed = this.current.armed !== null;
    if (how === 'cancel') trace('dnd', `${this.options.name}: cancel (${reason})`);
    this.set(IDLE);
    if (wasArmed) this.options.onArm?.(null);
    this.options.onEnd?.(how);
  }

  private trace(next: T | null, was: T | null): void {
    const { name } = this.options;
    if (next === null) trace('dnd', `${name}: disarmed (was ${this.show(was as T)})`);
    else trace('dnd', `${name}: armed → ${this.show(next)}`);
  }

  private describe(target: T | null): string {
    return target === null ? '' : (this.options.describe?.(target) ?? '');
  }

  private show(target: T): string {
    return this.options.show ? this.options.show(target) : String(target);
  }

  private set(next: GestureState<T>, notify = true): void {
    this.current = next;
    if (notify) for (const fn of this.listeners) fn(next);
  }
}
