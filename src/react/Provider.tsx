import type { Store } from '../index.js';
import { type ReactNode, createContext, useContext } from 'react';

export const Context = createContext<Store | null>(null);

export interface ProviderProps {
  store: Store;
  children: ReactNode;
}

export function Provider({ store, children }: ProviderProps) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useStore(): Store {
  const store = useContext(Context);
  if (!store) {
    throw new Error('useStore must be used inside <Provider>');
  }
  return store;
}
