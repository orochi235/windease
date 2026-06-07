import { type ReactNode, createContext, useContext, useState } from 'react';
import { Store } from '../index.js';

export const Context = createContext<Store | null>(null);

export interface ProviderProps {
  /** Optional. If omitted, Provider creates and owns a Store. Subsequent
   *  renders ignore changes to this prop — pick one mode per Provider
   *  instance (auto-owned vs. consumer-owned) and stick with it. */
  store?: Store;
  children: ReactNode;
}

/** @group Components */
export function Provider({ store: storeProp, children }: ProviderProps) {
  // Lazy init so the same Store instance survives re-renders. If `storeProp`
  // is provided on the first render, we capture it; if it changes later we
  // ignore it (documented above).
  const [store] = useState<Store>(() => storeProp ?? new Store());
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

/** @group Hooks */
export function useStore(): Store {
  const store = useContext(Context);
  if (!store) {
    throw new Error('useStore must be used inside <Provider>');
  }
  return store;
}
