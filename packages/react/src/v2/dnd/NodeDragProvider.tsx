import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useNodeStore } from '../NodeProvider.js';
import { NodeDragController } from './NodeDragController.js';

export const NodeDragContext = createContext<NodeDragController | null>(null);

export interface NodeDragProviderProps {
  children: ReactNode;
}

export function NodeDragProvider({ children }: NodeDragProviderProps) {
  const store = useNodeStore();
  const controller = useMemo(() => new NodeDragController(store), [store]);
  return <NodeDragContext.Provider value={controller}>{children}</NodeDragContext.Provider>;
}

export function useNodeDragController(): NodeDragController {
  const ctrl = useContext(NodeDragContext);
  if (!ctrl) {
    throw new Error('useNodeDragController must be used inside <NodeDragProvider>');
  }
  return ctrl;
}
