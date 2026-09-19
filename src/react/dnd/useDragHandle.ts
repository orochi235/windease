import { type PointerEvent as ReactPointerEvent, useCallback, useContext } from 'react';
import type { NodeId } from '../../index.js';
import { trace } from '../../index.js';
import { useNode } from '../hooks.js';
import { useStore } from '../Provider.js';
import { DragThresholdContext, useDragController } from './DragProvider.js';
import { trackPress } from './pointerDrag.js';

/**
 * Props to spread onto whatever element should start a drag. Only
 * `onPointerDown` does anything: from the press on, the gesture is followed on
 * `window`. The others stay so a spread written against earlier versions keeps
 * type-checking.
 */
export interface DragHandleHandlers {
  onPointerDown: (e: ReactPointerEvent<Element>) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  onPointerCancel: (e: ReactPointerEvent<Element>) => void;
}

const noop = () => {};

const NOOP_HANDLERS: DragHandleHandlers = {
  onPointerDown: noop,
  onPointerMove: noop,
  onPointerUp: noop,
  onPointerCancel: noop,
};

/**
 * The handler props that make an element drag `nodeId`. The hook behind
 * {@link DragHandle}; use it directly to keep your own element and styling.
 * The drag starts once the press travels the `DragProvider`'s `dragThreshold`,
 * so a click on the element still clicks.
 * @group Hooks
 */
export function useDragHandle(nodeId: NodeId): DragHandleHandlers {
  const controller = useDragController();
  const threshold = useContext(DragThresholdContext);
  const node = useNode(nodeId);
  const store = useStore();

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (e.button > 0) return;
      trace('dnd', `pointerDown on handle for ${nodeId} at (${e.clientX},${e.clientY})`);
      trackPress(controller, nodeId, e, threshold);
    },
    [controller, nodeId, threshold],
  );

  if (store.isLocked(nodeId, 'move')) {
    return NOOP_HANDLERS;
  }
  if (node?.membership && store.isLocked(node.membership.parentId, 'dragOut')) {
    return NOOP_HANDLERS;
  }
  return { onPointerDown, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop };
}
