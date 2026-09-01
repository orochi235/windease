import { createContext, type ReactNode, useContext, useState } from 'react';
import { Store } from '../index.js';

/**
 * Raw store context. Prefer `useStore`, which throws a useful message when no
 * `Provider` is mounted; reach for this only to compose your own context.
 */
export const Context = createContext<Store | null>(null);

export interface ProviderProps {
  /** Optional. If omitted, Provider creates and owns a Store. Subsequent
   *  renders ignore changes to this prop — pick one mode per Provider
   *  instance (auto-owned vs. consumer-owned) and stick with it. */
  store?: Store;
  children: ReactNode;
}

/**
 * Puts a `Store` in context for every windease hook and component below it.
 * Omit `store` to have the Provider create and own one.
 *
 * The store is captured on first render and never swapped, so a Provider is
 * either consumer-owned or auto-owned for its whole life. Remount it under a
 * new `key` to change stores.
 * @group Components
 */
export function Provider({ store: storeProp, children }: ProviderProps) {
  // Lazy init so the same Store instance survives re-renders. If `storeProp`
  // is provided on the first render, we capture it; if it changes later we
  // ignore it (documented above).
  const [store] = useState<Store>(() => storeProp ?? new Store());
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

/**
 * The `Store` from the nearest `Provider`. Throws when there is none, rather
 * than returning `null` and failing later at the first mutation.
 * @group Hooks
 */
export function useStore(): Store {
  const store = useContext(Context);
  if (!store) {
    throw new Error('useStore must be used inside <Provider>');
  }
  return store;
}
