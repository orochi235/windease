import { type PointerEvent as ReactPointerEvent, useCallback, useContext, useEffect } from 'react';
import type { TouchScrollMode } from '../../container-config.js';
import { retainTouchMoveGuard } from '../../dnd/touchHold-dom.js';
import type { NodeId } from '../../index.js';
import { trace } from '../../index.js';
import { useNode } from '../hooks.js';
import { useStore } from '../Provider.js';
import { DragThresholdContext, DragTouchHoldContext, useDragController } from './DragProvider.js';
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

/** Options for {@link useDragHandle}. */
export interface DragHandleOptions {
  /** `'hold'` makes a touch press hold still before it drags, so a swipe on
   *  the element scrolls. The hook sets no `touch-action`; leave the element's
   *  default so the swipe can scroll. Other values change nothing here. */
  touchScroll?: boolean | TouchScrollMode;
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
export function useDragHandle(nodeId: NodeId, options?: DragHandleOptions): DragHandleHandlers {
  const controller = useDragController();
  const threshold = useContext(DragThresholdContext);
  const touchHold = useContext(DragTouchHoldContext);
  const node = useNode(nodeId);
  const store = useStore();
  const holds = options?.touchScroll === 'hold';

  useEffect(() => (holds ? retainTouchMoveGuard() : undefined), [holds]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<Element>) => {
      if (e.button > 0) return;
      trace('dnd', `pointerDown on handle for ${nodeId} at (${e.clientX},${e.clientY})`);
      trackPress(controller, nodeId, e, threshold, holds ? { touchHold } : undefined);
    },
    [controller, nodeId, threshold, touchHold, holds],
  );

  if (store.isLocked(nodeId, 'move')) {
    return NOOP_HANDLERS;
  }
  if (node?.membership && store.isLocked(node.membership.parentId, 'dragOut')) {
    return NOOP_HANDLERS;
  }
  return { onPointerDown, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop };
}
