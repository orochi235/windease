import type { DragController } from '../../dnd/DragController.js';
import { startTouchHold, type TouchHold, type TouchHoldOptions } from '../../dnd/touchHold.js';
import { claimTouchMoves, retainTouchMoveGuard } from '../../dnd/touchHold-dom.js';
import { watchRelease } from '../../gesture-dom.js';
import type { NodeId } from '../../index.js';
import { trace } from '../../index.js';

/** Where and with which pointer a press began. */
export interface PressStart {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType?: string;
}

/** How {@link trackPress} starts a drag beyond the travel threshold. */
export interface TrackPressOptions {
  /** A touch press must hold still this long before it drags; moving first
   *  leaves it to the browser as a scroll. Mouse and pen are unaffected. */
  touchHold?: TouchHoldOptions;
}

function preventDefault(e: Event): void {
  e.preventDefault();
}

/** The click a browser fires after a release belongs to the drag, not to
 *  whatever sits under the cursor where it ended. It is dispatched in the same
 *  task as the pointerup, so a zero timeout outlives it and nothing later. */
function swallowNextClick(): void {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

/**
 * Follow one press on `window` and turn it into a drag of `nodeId` once it has
 * traveled `threshold` pixels; a release before that leaves the click alone.
 * Listening on `window` rather than the pressed element keeps the gesture alive
 * when a drop preview re-renders or moves that element.
 */
export function trackPress(
  controller: DragController,
  nodeId: NodeId,
  start: PressStart,
  threshold: number,
  options?: TrackPressOptions,
): void {
  const hasWindow = typeof window !== 'undefined';
  let begun = false;
  let hold: TouchHold | null = null;
  let releaseGuard: (() => void) | null = null;
  let releaseClaim: (() => void) | null = null;

  const same = (e: PointerEvent) =>
    e.pointerId === undefined || start.pointerId === undefined || e.pointerId === start.pointerId;
  const ours = () => controller.state()?.draggingId === nodeId;

  const begin = (): boolean => {
    const options = start.pointerId === undefined ? undefined : { pointerId: start.pointerId };
    if (!controller.tryBegin(nodeId, options)) return false;
    begun = true;
    if (hasWindow) {
      window.getSelection?.()?.removeAllRanges();
      window.addEventListener('selectstart', preventDefault);
    }
    return true;
  };

  let unbindRelease: (() => void) | null = null;
  const stop = () => {
    if (!hasWindow) return;
    window.removeEventListener('pointermove', onMove);
    unbindRelease?.();
    unbindRelease = null;
    window.removeEventListener('selectstart', preventDefault);
    window.removeEventListener('contextmenu', preventDefault);
    releaseClaim?.();
    releaseClaim = null;
    releaseGuard?.();
    releaseGuard = null;
  };

  const onMove = (e: PointerEvent) => {
    if (!same(e)) return;
    if (hold) {
      if (!hold.move(e.clientX, e.clientY)) stop();
      if (!begun) return;
    } else if (!begun) {
      const traveled = Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY);
      if (traveled < threshold) return;
      trace('dnd', `press on ${nodeId} traveled ${traveled.toFixed(1)}px ≥ ${threshold} — drag`);
      if (!begin()) {
        stop();
        return;
      }
    }
    // Escape, or anything else, may have ended the drag under us.
    if (!ours()) {
      stop();
      return;
    }
    controller.updateHoverByPoint(e.clientX, e.clientY);
  };

  const onUp = (e: PointerEvent) => {
    stop();
    hold?.cancel('released before the hold — left as a click');
    if (!begun) {
      if (!hold) trace('dnd', `press on ${nodeId} released under the threshold — left as a click`);
      return;
    }
    if (!ours()) return;
    trace('dnd', `pointerUp at (${e.clientX},${e.clientY}) — dispatching drop`);
    controller.drop();
    swallowNextClick();
  };

  const onCancel = () => {
    stop();
    hold?.cancel('pointercancel — the browser scrolled');
    if (begun && ours()) {
      trace('dnd', 'pointerCancel — dispatching cancel');
      controller.cancel('outside');
    }
  };

  if (options?.touchHold && start.pointerType === 'touch') {
    hold = startTouchHold(
      start.clientX,
      start.clientY,
      () => {
        if (!begin()) {
          stop();
          return;
        }
        releaseClaim = claimTouchMoves();
      },
      { ...options.touchHold, label: String(nodeId) },
    );
    if (hasWindow) {
      releaseGuard = retainTouchMoveGuard();
      // A long press is the browser's context menu gesture too.
      window.addEventListener('contextmenu', preventDefault);
    }
  } else if (threshold <= 0 && !begin()) return;
  if (!hasWindow) return;
  window.addEventListener('pointermove', onMove);
  unbindRelease = watchRelease(start.pointerId, { up: onUp, cancel: onCancel });
}
