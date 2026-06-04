import * as React from 'react';
import { createContext, useMemo, type ReactNode } from 'react';
import { WindeaseStore, type CreateZoneInput } from '@windease/core';

export const WindeaseContext = createContext<WindeaseStore | null>(null);

interface BaseProps {
  children: ReactNode;
}

type Props =
  | (BaseProps & { store: WindeaseStore; zones?: never })
  | (BaseProps & { store?: never; zones: CreateZoneInput[] });

export function WindeaseProvider(props: Props): React.JSX.Element {
  const store = useMemo(() => {
    if (props.store) return props.store;
    const s = new WindeaseStore();
    for (const z of props.zones) s.registerZone(z);
    return s;
    // We deliberately ignore changes to `zones` after mount — store identity
    // is stable for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WindeaseContext.Provider value={store}>
      {props.children}
    </WindeaseContext.Provider>
  );
}
