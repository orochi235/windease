import type { NodeId } from '@windease/core';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
} from 'react';
import { useNode } from '../hooks.js';
import { useNodeDragController } from './NodeDragProvider.js';

export interface NodeDragHandleHandlers {
  onPointerDown: (e: ReactPointerEvent<Element>) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  onPointerCancel: (e: ReactPointerEvent<Element>) => void;
}

const NOOP_HANDLERS: NodeDragHandleHandlers = {
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
};

export function useNodeDragHandle(nodeId: NodeId): NodeDragHandleHandlers {
  const controller = useNodeDragController();
  const node = useNode(nodeId);
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
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
