import { useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ResizeGestureContext } from './resize-gesture.js';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(cb: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mql = matchMedia(REDUCED_MOTION);
  mql.addEventListener?.('change', cb);
  return () => mql.removeEventListener?.('change', cb);
}

function readReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches;
}

/** Whether the user asked for reduced motion, re-rendering when that changes. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

/**
 * Whether this render's viewport differs from the last committed one. A resize
 * moves every placement at once and keeps moving it while the edge is dragged,
 * so easing toward each new rect only makes the tiles trail the edge. A
 * rearrange landing in the same render as a resize goes unanimated too.
 */
function useViewportResized(viewport: { w: number; h: number } | null): boolean {
  const committed = useRef(viewport);
  useLayoutEffect(() => {
    committed.current = viewport;
  });
  const prev = committed.current;
  return prev !== null && viewport !== null && (prev.w !== viewport.w || prev.h !== viewport.h);
}

/** What {@link useSettle} decides for one container's render. */
export interface Settle {
  /** The settle duration to animate children with this render; 0 for none. */
  settleMs: number;
  /** A resize gesture is running here or above; provide it to descendants. */
  resizing: boolean;
  /** The affordance this container's own layer is dragging, or null. */
  draggingAffordanceId: string | null;
  /** Hand to the affordance layer's `onActiveChange`. */
  setDraggingAffordanceId: (id: string | null) => void;
}

/**
 * The settle-animation rule every container host follows: animate children by
 * `settleMs`, except while a resize gesture runs here or in an ancestor (the
 * pointer is the motion), while the user prefers reduced motion, or on a render
 * whose viewport changed.
 */
export function useSettle(settleMs: number, viewport: { w: number; h: number } | null): Settle {
  const [draggingAffordanceId, setDraggingAffordanceId] = useState<string | null>(null);
  const ancestorResizing = useContext(ResizeGestureContext);
  const reducedMotion = useReducedMotion();
  const viewportResized = useViewportResized(viewport);
  const resizing = draggingAffordanceId !== null || ancestorResizing;
  return {
    settleMs: resizing || reducedMotion || viewportResized ? 0 : settleMs,
    resizing,
    draggingAffordanceId,
    setDraggingAffordanceId,
  };
}
