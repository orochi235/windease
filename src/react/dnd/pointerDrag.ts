import type { DragController } from '../../dnd/DragController.js';
import type { NodeId } from '../../index.js';
import { trace } from '../../index.js';

/** Where and with which pointer a press began. */
export interface PressStart {
  clientX: number;
  clientY: number;
  pointerId: number;
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
): void {
  const hasWindow = typeof window !== 'undefined';
  let begun = false;

  const same = (e: PointerEvent) =>
    e.pointerId === undefined || start.pointerId === undefined || e.pointerId === start.pointerId;
  const ours = () => controller.state()?.draggingId === nodeId;

  const begin = (): boolean => {
    if (!controller.tryBegin(nodeId)) return false;
    begun = true;
    if (hasWindow) {
      window.getSelection?.()?.removeAllRanges();
      window.addEventListener('selectstart', preventDefault);
    }
    return true;
  };

  const stop = () => {
    if (!hasWindow) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('selectstart', preventDefault);
  };

  const onMove = (e: PointerEvent) => {
    if (!same(e)) return;
    if (!begun) {
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
    if (!same(e)) return;
    stop();
    if (!begun) {
      trace('dnd', `press on ${nodeId} released under the threshold — left as a click`);
      return;
    }
    if (!ours()) return;
    trace('dnd', `pointerUp at (${e.clientX},${e.clientY}) — dispatching drop`);
    controller.drop();
    swallowNextClick();
  };

  const onCancel = (e: PointerEvent) => {
    if (!same(e)) return;
    stop();
    if (begun && ours()) {
      trace('dnd', 'pointerCancel — dispatching cancel');
      controller.cancel('outside');
    }
  };

  if (threshold <= 0 && !begin()) return;
  if (!hasWindow) return;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}
