import type { Clock, TimerHandle } from '../throttle.js';

interface Entry {
  at: number;
  seq: number;
  fn: () => void;
}

/**
 * Deterministic `Clock` for tests. `advance(ms)` fires every timer due in
 * the window, in due order (ties broken by creation order), setting `now()`
 * to each timer's due time before invoking it — so code that reads the
 * clock inside a callback sees the time it was scheduled for, not the end
 * of the advance window.
 *
 * Timers scheduled from within a callback are picked up by the same
 * `advance` call if they come due inside the window.
 */
export class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private readonly timers = new Map<number, Entry>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle = ++this.seq;
    this.timers.set(handle, { at: this.t + ms, seq: handle, fn });
    return handle;
  }

  clearTimeout(h: TimerHandle): void {
    this.timers.delete(h as number);
  }

  /** Number of timers still pending. Useful for leak assertions. */
  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let nextHandle = -1;
      let next: Entry | undefined;
      for (const [handle, entry] of this.timers) {
        if (entry.at > target) continue;
        if (!next || entry.at < next.at || (entry.at === next.at && entry.seq < next.seq)) {
          next = entry;
          nextHandle = handle;
        }
      }
      if (!next) break;
      this.timers.delete(nextHandle);
      this.t = next.at;
      next.fn();
    }
    this.t = target;
  }
}
