import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../Provider.js';
import { useOptionalStrategyRegistry } from '../strategies.js';
import { DragController, type DragState } from './DragController.js';
import { defaultDragOverlay, type DragOverlayRenderer } from './defaultDragOverlay.js';

export const DragContext = createContext<DragController | null>(null);

export interface DragProviderProps {
  children: ReactNode;
  /**
   * Render the drag ghost. Receives the current cursor, dragging node, and
   * hover state. Defaults to `defaultDragOverlay`. Pass `null` to disable
   * the overlay entirely (e.g. if you render your own).
   */
  dragOverlay?: DragOverlayRenderer | null;
}

/** @group Components */
export function DragProvider({ children, dragOverlay = defaultDragOverlay }: DragProviderProps) {
  const store = useStore();
  const registry = useOptionalStrategyRegistry();
  const controller = useMemo(
    () => new DragController(store, registry ? (sid) => registry.get(sid) : undefined),
    [store, registry],
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
    return <>{render({ draggingId: state.draggingId, cursor, node, hover: state.hover, rejected })}</>;
  }
  return createPortal(
    <>{render({ draggingId: state.draggingId, cursor, node, hover: state.hover, rejected })}</>,
    document.body,
  );
}

/** @group Hooks */
export function useDragController(): DragController {
  const ctrl = useContext(DragContext);
  if (!ctrl) {
    throw new Error('useDragController must be used inside <DragProvider>');
  }
  return ctrl;
}
