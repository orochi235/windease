import { type PointerEvent as ReactPointerEvent, useCallback, useRef } from 'react';
import type { NodeId } from '../../index.js';
import { trace } from '../../index.js';
import { useNode } from '../hooks.js';
import { useStore } from '../Provider.js';
import { useDragController } from './DragProvider.js';

/** Props to spread onto whatever element should start a drag. */
export interface DragHandleHandlers {
  onPointerDown: (e: ReactPointerEvent<Element>) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  onPointerCancel: (e: ReactPointerEvent<Element>) => void;
}

const NOOP_HANDLERS: DragHandleHandlers = {
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
};

/**
 * The handler props that make an element drag `nodeId`. The hook behind
 * {@link DragHandle}; use it directly to keep your own element and styling.
 * @group Hooks
 */
export function useDragHandle(nodeId: NodeId): DragHandleHandlers {
  const controller = useDragController();
  const node = useNode(nodeId);
  const store = useStore();
  const draggingRef = useRef(false);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<Element>) => {
      const ok = controller.tryBegin(nodeId);
      if (!ok) return;
      draggingRef.current = true;
      let captured = false;
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        captured = true;
      } catch {
        // jsdom or unsupported — ignore.
      }
      trace(
        'dnd',
        `pointerDown on handle for ${nodeId} at (${e.clientX},${e.clientY}); pointerCapture=${captured}`,
      );
    },
    [controller, nodeId],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (!draggingRef.current) return;
      controller.updateHoverByPoint(e.clientX, e.clientY);
    },
    [controller],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }
      trace('dnd', `pointerUp at (${e.clientX},${e.clientY}) — dispatching drop`);
      controller.drop();
    },
    [controller],
  );

  const onPointerCancel = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    trace('dnd', 'pointerCancel — dispatching cancel');
    controller.cancel('outside');
  }, [controller]);

  if (store.isLocked(nodeId, 'move')) {
    return NOOP_HANDLERS;
  }
  if (node?.membership && store.isLocked(node.membership.parentId, 'dragOut')) {
    return NOOP_HANDLERS;
  }
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
