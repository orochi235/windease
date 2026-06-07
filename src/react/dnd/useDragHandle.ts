import type { NodeId } from '../../index.js';
import { type PointerEvent as ReactPointerEvent, useCallback, useRef } from 'react';
import { useStore } from '../WindeaseProvider.js';
import { useNode } from '../hooks.js';
import { useDragController } from './DragProvider.js';

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
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // jsdom or unsupported — ignore.
      }
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
      controller.drop();
    },
    [controller],
  );

  const onPointerCancel = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    controller.cancel('outside');
  }, [controller]);

  if (node?.slot?.placement?.locked === true) return NOOP_HANDLERS;
  if (node?.slot) {
    const parent = store.getNode(node.slot.parentId);
    if (parent?.container?.allowsDragOut === false) return NOOP_HANDLERS;
  }
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
