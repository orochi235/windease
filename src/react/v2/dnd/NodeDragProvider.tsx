import { type ReactNode, createContext, useContext, useMemo } from 'react';
import { useNodeStore } from '../NodeProvider.js';
import { useOptionalStrategyRegistry } from '../strategies.js';
import { NodeDragController } from './NodeDragController.js';

export const NodeDragContext = createContext<NodeDragController | null>(null);

export interface NodeDragProviderProps {
  children: ReactNode;
}

export function NodeDragProvider({ children }: NodeDragProviderProps) {
  const store = useNodeStore();
  const registry = useOptionalStrategyRegistry();
  const controller = useMemo(
    () => new NodeDragController(store, registry ? (sid) => registry.get(sid) : undefined),
    [store, registry],
  );
  return <NodeDragContext.Provider value={controller}>{children}</NodeDragContext.Provider>;
}

export function useNodeDragController(): NodeDragController {
  const ctrl = useContext(NodeDragContext);
  if (!ctrl) {
    throw new Error('useNodeDragController must be used inside <NodeDragProvider>');
  }
  return ctrl;
}
