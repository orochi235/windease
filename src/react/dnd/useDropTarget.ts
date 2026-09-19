import { type RefObject, useContext, useEffect } from 'react';
import type { AcceptPolicy } from '../../dnd/DragEngine.js';
import type { DropIntent, NodeId } from '../../index.js';
import { DragContext } from './DragProvider.js';

/** Options for {@link useDropTarget}. */
export interface UseDropTargetOptions {
  /** Whether this target takes the drop, from the prospective post-drop child
   *  list. `true` accepts even where the strategy would refuse, `false`
   *  refuses, `undefined` defers to it. */
  acceptPolicy?: AcceptPolicy;
  /** When false, skip registration. Useful for opt-in props on declarative
   *  presets where the hook must be called unconditionally to preserve hook
   *  order, but registration should depend on a runtime flag. Defaults to
   *  true. */
  enabled?: boolean;
  /** Map a cursor point (viewport coords) to a prospective insertion index in
   *  the target's childOrder. Returning undefined leaves `insertIndex` unset
   *  on the drag state (the strategy then falls back to "append"). */
  getInsertionIndex?: (point: { x: number; y: number }) => number | undefined;
  /** Map a cursor point to what kind of drop it is asking for. Takes
   *  precedence over `getInsertionIndex`. */
  getDropIntent?: (point: { x: number; y: number }) => DropIntent | undefined;
}

/**
 * Register `nodeId`'s element as a drop target. On drop within the element's
 * bounding rect, the controller invokes `store.moveNode(source, nodeId)`.
 *
 * @group Hooks
 */
export function useDropTarget(
  nodeId: NodeId,
  ref: RefObject<Element | null>,
  options: UseDropTargetOptions = {},
): void {
  const { acceptPolicy, enabled, getDropIntent, getInsertionIndex } = options;
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
      acceptPolicy || getInsertionIndex || getDropIntent
        ? {
            ...(acceptPolicy ? { acceptPolicy } : {}),
            ...(getInsertionIndex ? { getInsertionIndex } : {}),
            ...(getDropIntent ? { getDropIntent } : {}),
          }
        : undefined,
    );
  }, [controller, nodeId, ref, enabled, acceptPolicy, getInsertionIndex, getDropIntent]);
}
