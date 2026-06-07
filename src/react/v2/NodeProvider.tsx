import type { WindeaseNodeStore } from '../../index.js';
import { type ReactNode, createContext, useContext } from 'react';

export const WindeaseNodeContext = createContext<WindeaseNodeStore | null>(null);

export interface WindeaseNodeProviderProps {
  store: WindeaseNodeStore;
  children: ReactNode;
}

export function WindeaseNodeProvider({ store, children }: WindeaseNodeProviderProps) {
  return <WindeaseNodeContext.Provider value={store}>{children}</WindeaseNodeContext.Provider>;
}

export function useNodeStore(): WindeaseNodeStore {
  const store = useContext(WindeaseNodeContext);
  if (!store) {
    throw new Error('useNodeStore must be used inside <WindeaseNodeProvider>');
  }
  return store;
}
