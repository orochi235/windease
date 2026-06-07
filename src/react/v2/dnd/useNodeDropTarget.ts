import type { NodeId } from '../../../index.js';
import { type RefObject, useEffect } from 'react';
import { useNodeDragController } from './NodeDragProvider.js';

/**
 * Register `nodeId`'s element as a drop target. On drop within the element's
 * bounding rect, the controller invokes `store.moveNode(source, nodeId)`.
 *
 * Pass an optional `canAccept(sourceId)` predicate to reject specific sources
 * (e.g. forbid drops from outside a particular sub-tree).
 */
export function useNodeDropTarget(
  nodeId: NodeId,
  ref: RefObject<Element | null>,
  canAccept?: (sourceId: NodeId) => boolean,
): void {
  const controller = useNodeDragController();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return controller.registerDropTarget(nodeId, el, canAccept);
  }, [controller, nodeId, ref, canAccept]);
}
