import type { WindeaseStore } from '../index.js';
import { type ReactNode, createContext, useContext } from 'react';

export const WindeaseContext = createContext<WindeaseStore | null>(null);

export interface WindeaseProviderProps {
  store: WindeaseStore;
  children: ReactNode;
}

export function WindeaseProvider({ store, children }: WindeaseProviderProps) {
  return <WindeaseContext.Provider value={store}>{children}</WindeaseContext.Provider>;
}

export function useStore(): WindeaseStore {
  const store = useContext(WindeaseContext);
  if (!store) {
    throw new Error('useStore must be used inside <WindeaseProvider>');
  }
  return store;
}
