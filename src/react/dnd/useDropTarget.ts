import type { NodeId } from '../../index.js';
import { type RefObject, useContext, useEffect } from 'react';
import { DragContext } from './DragProvider.js';

export interface UseDropTargetOptions {
  /** Predicate to reject specific sources (e.g. forbid drops from outside a
   *  particular sub-tree). */
  canAccept?: (sourceId: NodeId) => boolean;
  /** When false, skip registration. Useful for opt-in props on declarative
   *  presets where the hook must be called unconditionally to preserve hook
   *  order, but registration should depend on a runtime flag. Defaults to
   *  true. */
  enabled?: boolean;
  /** Map a cursor point (viewport coords) to a prospective insertion index in
   *  the target's childOrder. Returning undefined leaves `insertIndex` unset
   *  on the drag state (the strategy then falls back to "append"). */
  getInsertionIndex?: (point: { x: number; y: number }) => number | undefined;
}

/**
 * Register `nodeId`'s element as a drop target. On drop within the element's
 * bounding rect, the controller invokes `store.moveNode(source, nodeId)`.
 *
 * The third argument accepts either a legacy `canAccept` callback or an
 * options object `{ canAccept, enabled }`. Both forms are supported for
 * backward compatibility.
 *
 * @group Hooks
 */
export function useDropTarget(
  nodeId: NodeId,
  ref: RefObject<Element | null>,
  canAcceptOrOptions?: ((sourceId: NodeId) => boolean) | UseDropTargetOptions,
): void {
  const opts: UseDropTargetOptions =
    typeof canAcceptOrOptions === 'function'
      ? { canAccept: canAcceptOrOptions }
      : (canAcceptOrOptions ?? {});
  const { canAccept, enabled, getInsertionIndex } = opts;
  // Always read the controller via useContext (not useDragController) so that
  // trees without a <DragProvider> can still call this hook with
  // `enabled: false` (e.g. PresetShell's unconditional call). When enabled
  // and there's no provider, surface the same error the strict accessor
  // would have thrown.
  const controller = useContext(DragContext);
  if (enabled !== false && !controller) {
    throw new Error('useDropTarget requires a <DragProvider> ancestor');
  }
  useEffect(() => {
    if (enabled === false) return;
    if (!controller) return;
    const el = ref.current;
    if (!el) return;
    return controller.registerDropTarget(
      nodeId,
      el,
      canAccept,
      getInsertionIndex ? { getInsertionIndex } : undefined,
    );
  }, [controller, nodeId, ref, enabled, canAccept, getInsertionIndex]);
}
