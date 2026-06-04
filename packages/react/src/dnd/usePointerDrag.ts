import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface UsePointerDragOptions {
  threshold?: number;
  onDragStart(e: PointerEvent): void;
  onDragMove(e: PointerEvent, delta: { dx: number; dy: number }): void;
  onDragEnd(e: PointerEvent, didDrag: boolean): void;
}

export interface PointerDragHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

const DEFAULT_THRESHOLD = 5;

let suppressionDepth = 0;
let savedUserSelect: string | null = null;
function suppressSelection(): void {
  if (suppressionDepth === 0 && typeof document !== 'undefined') {
    savedUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
  }
  suppressionDepth += 1;
}
function restoreSelection(): void {
  if (suppressionDepth === 0) return;
  suppressionDepth -= 1;
  if (suppressionDepth === 0 && typeof document !== 'undefined') {
    document.body.style.userSelect = savedUserSelect ?? '';
    savedUserSelect = null;
  }
}

interface DragState {
  active: boolean;
  dragging: boolean;
  pointerId: number;
  origin: { x: number; y: number };
  last: { x: number; y: number };
  captureEl: Element | null;
  /** Detach window-level safety net listeners. */
  detachSafetyNet: () => void;
}

export function usePointerDrag(opts: UsePointerDragOptions): PointerDragHandlers {
  const stateRef = useRef<DragState | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  const endDrag = useCallback(
    (nativeEvent: PointerEvent | null, opts: { synthesizeEndMove?: { dx: number; dy: number } } = {}) => {
      const s = stateRef.current;
      if (!s || !s.active) return;
      let didDrag = s.dragging;
      const o = optsRef.current;
      if (!didDrag && opts.synthesizeEndMove && nativeEvent) {
        const { dx, dy } = opts.synthesizeEndMove;
        if (Math.hypot(dx, dy) >= threshold) {
          didDrag = true;
          suppressSelection();
          o.onDragStart(nativeEvent);
          o.onDragMove(nativeEvent, { dx, dy });
        }
      }
      // Snapshot and clear state before invoking user code so re-entrant
      // callbacks see a clean slate.
      const captureEl = s.captureEl;
      const pointerId = s.pointerId;
      s.detachSafetyNet();
      stateRef.current = null;
      if (captureEl && (captureEl as Element & { hasPointerCapture?(id: number): boolean }).hasPointerCapture?.(pointerId)) {
        try {
          (captureEl as Element & { releasePointerCapture?(id: number): void }).releasePointerCapture?.(pointerId);
        } catch {
          // ignore — capture may already be gone
        }
      }
      if (didDrag) restoreSelection();
      if (nativeEvent) o.onDragEnd(nativeEvent, didDrag);
      else {
        // Synthesize a minimal PointerEvent-shaped object for the consumer.
        // Used when the drag is force-ended by blur/visibilitychange.
        const fake = new MouseEvent('pointercancel') as unknown as PointerEvent;
        o.onDragEnd(fake, didDrag);
      }
    },
    [threshold],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // If somehow a previous drag wasn't cleaned up, force-end it first.
      if (stateRef.current) endDrag(null);

      // Don't call setPointerCapture yet — that redirects pointerup (and the
      // synthesized click) to this element, breaking clicks on descendants
      // like close buttons. We capture only once the threshold is crossed.
      const captureEl = e.currentTarget;

      // Attach a window-level safety net so we always learn when the drag
      // ends, even if the element never receives pointerup.
      const pointerId = e.pointerId;
      const onWindowPointerUp = (we: PointerEvent) => {
        if (we.pointerId !== pointerId) return;
        endDrag(we);
      };
      const onWindowPointerCancel = (we: PointerEvent) => {
        if (we.pointerId !== pointerId) return;
        endDrag(we);
      };
      const onLostCapture = (we: PointerEvent) => {
        if (we.pointerId !== pointerId) return;
        endDrag(we);
      };
      const onBlur = () => endDrag(null);
      const onVisibility = () => {
        if (document.hidden) endDrag(null);
      };
      window.addEventListener('pointerup', onWindowPointerUp);
      window.addEventListener('pointercancel', onWindowPointerCancel);
      window.addEventListener('lostpointercapture', onLostCapture);
      window.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', onVisibility);
      const detachSafetyNet = () => {
        window.removeEventListener('pointerup', onWindowPointerUp);
        window.removeEventListener('pointercancel', onWindowPointerCancel);
        window.removeEventListener('lostpointercapture', onLostCapture);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVisibility);
      };

      stateRef.current = {
        active: true,
        dragging: false,
        pointerId,
        origin: { x: e.clientX, y: e.clientY },
        last: { x: e.clientX, y: e.clientY },
        captureEl,
        detachSafetyNet,
      };
    },
    [endDrag],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = stateRef.current;
      if (!s || !s.active || s.pointerId !== e.pointerId) return;
      const dxFromOrigin = e.clientX - s.origin.x;
      const dyFromOrigin = e.clientY - s.origin.y;
      if (!s.dragging) {
        if (Math.hypot(dxFromOrigin, dyFromOrigin) < threshold) return;
        s.dragging = true;
        // Now that we've committed to a drag, capture the pointer so we
        // keep receiving moves even if the cursor leaves this element.
        if (s.captureEl) {
          try {
            (s.captureEl as Element & { setPointerCapture?(id: number): void }).setPointerCapture?.(s.pointerId);
          } catch {
            // ignore
          }
        }
        suppressSelection();
        optsRef.current.onDragStart(e.nativeEvent);
      }
      const delta = { dx: e.clientX - s.last.x, dy: e.clientY - s.last.y };
      s.last = { x: e.clientX, y: e.clientY };
      optsRef.current.onDragMove(e.nativeEvent, delta);
    },
    [threshold],
  );

  const finish = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = stateRef.current;
      if (!s || !s.active || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.origin.x;
      const dy = e.clientY - s.origin.y;
      endDrag(e.nativeEvent, { synthesizeEndMove: { dx, dy } });
    },
    [endDrag],
  );

  // Safety net at unmount: end any active drag so timers/listeners don't leak.
  useEffect(() => {
    return () => {
      if (stateRef.current) endDrag(null);
    };
  }, [endDrag]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
  };
}
