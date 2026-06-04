import { useCallback, useRef } from 'react';
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

export function usePointerDrag(opts: UsePointerDragOptions): PointerDragHandlers {
  const stateRef = useRef<{
    active: boolean;
    dragging: boolean;
    pointerId: number;
    origin: { x: number; y: number };
    last: { x: number; y: number };
  } | null>(null);

  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      stateRef.current = {
        active: true,
        dragging: false,
        pointerId: e.pointerId,
        origin: { x: e.clientX, y: e.clientY },
        last: { x: e.clientX, y: e.clientY },
      };
    },
    [],
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
        suppressSelection();
        opts.onDragStart(e.nativeEvent);
      }
      const delta = { dx: e.clientX - s.last.x, dy: e.clientY - s.last.y };
      s.last = { x: e.clientX, y: e.clientY };
      opts.onDragMove(e.nativeEvent, delta);
    },
    [opts, threshold],
  );

  const finish = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = stateRef.current;
      if (!s || !s.active || s.pointerId !== e.pointerId) return;
      const didDrag = s.dragging;
      stateRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (didDrag) restoreSelection();
      opts.onDragEnd(e.nativeEvent, didDrag);
    },
    [opts],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
  };
}
