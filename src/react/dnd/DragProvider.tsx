import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragController, type DragState } from '../../dnd/DragController.js';
import { useStore } from '../Provider.js';
import { useOptionalStrategyRegistry } from '../strategies.js';
import { type DragOverlayRenderer, defaultDragOverlay } from './defaultDragOverlay.js';

/** Raw drag-controller context. Prefer {@link useDragController}. */
export const DragContext = createContext<DragController | null>(null);

export interface DragProviderProps {
  children: ReactNode;
  /**
   * Render the drag ghost. Receives the current cursor, dragging node, and
   * hover state. Defaults to `defaultDragOverlay`. Pass `null` to disable
   * the overlay entirely (e.g. if you render your own).
   */
  dragOverlay?: DragOverlayRenderer | null;
  /** Container config given to a stack a drop creates. `headerSize` is the one
   *  that matters: the tab strip is yours to draw, so its height is yours to
   *  declare. */
  stackConfig?: Record<string, unknown>;
  /** Container config given to the strip a split drop creates, merged over its
   *  `axis` and `fill`. */
  splitConfig?: Record<string, unknown>;
}

/**
 * Owns the drag session for its subtree: binds pointer events, tracks the
 * hovered target, and renders the drag overlay. Required above any drag handle
 * or drop target.
 * @group Components
 */
export function DragProvider({
  children,
  dragOverlay = defaultDragOverlay,
  stackConfig,
  splitConfig,
}: DragProviderProps) {
  const store = useStore();
  const registry = useOptionalStrategyRegistry();
  const controller = useMemo(
    () =>
      new DragController(
        store,
        registry ? (sid) => registry.get(sid) : undefined,
        stackConfig,
        splitConfig,
      ),
    [store, registry, stackConfig, splitConfig],
  );

  const [state, setState] = useState<DragState | null>(null);
  useEffect(() => controller.subscribe(setState), [controller]);

  return (
    <DragContext.Provider value={controller}>
      {children}
      {dragOverlay && state ? <DragOverlayPortal state={state} render={dragOverlay} /> : null}
    </DragContext.Provider>
  );
}

function DragOverlayPortal({ state, render }: { state: DragState; render: DragOverlayRenderer }) {
  const store = useStore();
  const node = store.getNode(state.draggingId);
  const cursor = state.cursor;
  const rejected = state.hover?.accepted === false;
  if (typeof document === 'undefined') {
    return (
      <>{render({ draggingId: state.draggingId, cursor, node, hover: state.hover, rejected })}</>
    );
  }
  return createPortal(
    render({ draggingId: state.draggingId, cursor, node, hover: state.hover, rejected }),
    document.body,
  );
}

/**
 * The nearest {@link DragProvider}'s controller, for starting or inspecting a
 * drag imperatively. Throws when no provider is mounted.
 * @group Hooks
 */
export function useDragController(): DragController {
  const ctrl = useContext(DragContext);
  if (!ctrl) {
    throw new Error('useDragController must be used inside <DragProvider>');
  }
  return ctrl;
}
