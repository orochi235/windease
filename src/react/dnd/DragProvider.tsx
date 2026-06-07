import { type ReactNode, createContext, useContext, useMemo } from 'react';
import { useStore } from '../Provider.js';
import { useOptionalStrategyRegistry } from '../strategies.js';
import { DragController } from './DragController.js';

export const DragContext = createContext<DragController | null>(null);

export interface DragProviderProps {
  children: ReactNode;
}

/** @group Components */
export function DragProvider({ children }: DragProviderProps) {
  const store = useStore();
  const registry = useOptionalStrategyRegistry();
  const controller = useMemo(
    () => new DragController(store, registry ? (sid) => registry.get(sid) : undefined),
    [store, registry],
  );
  return <DragContext.Provider value={controller}>{children}</DragContext.Provider>;
}

/** @group Hooks */
export function useDragController(): DragController {
  const ctrl = useContext(DragContext);
  if (!ctrl) {
    throw new Error('useDragController must be used inside <DragProvider>');
  }
  return ctrl;
}
