import type { Store } from './store.js';

/**
 * Drives a store's pending turns from `requestAnimationFrame`.
 *
 * The convenience, not the API: `store.tick(now)` is what actually advances a
 * turn, and a consumer with its own loop — a game tick, a test's fake clock, a
 * framework's scheduler — calls that instead and never needs this. It lives
 * here rather than in the core for the usual reason: the core reads no clock
 * and touches no `window`.
 *
 * Frames are scheduled only while a turn is running, so an idle store costs
 * nothing. Returns a disposer.
 *
 * @group Adapters
 */
export function driveWithRaf(store: Store): () => void {
  let frame: number | undefined;
  let stopped = false;

  const step = (now: number): void => {
    frame = undefined;
    if (stopped) return;
    if (store.tick(now)) schedule();
  };

  const schedule = (): void => {
    if (frame !== undefined || stopped) return;
    frame = requestAnimationFrame(step);
  };

  const unsubscribe = store.events.on('turn.started', () => schedule());
  schedule();

  return () => {
    stopped = true;
    unsubscribe();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
