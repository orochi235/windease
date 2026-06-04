import { type CreateZoneInput, WindeaseStore } from '@windease/core';
import type * as React from 'react';
import { type ReactNode, createContext, useMemo } from 'react';

export const WindeaseContext = createContext<WindeaseStore | null>(null);

interface BaseProps {
  children: ReactNode;
}

type Props =
  | (BaseProps & { store: WindeaseStore; zones?: never })
  | (BaseProps & { store?: never; zones: CreateZoneInput[] });

export function WindeaseProvider(props: Props): React.JSX.Element {
  // biome-ignore lint/correctness/useExhaustiveDependencies: Store identity is stable for the provider's lifetime; re-running this memo would orphan subscribers mid-tree.
  const store = useMemo(() => {
    if (props.store) return props.store;
    const s = new WindeaseStore();
    for (const z of props.zones) s.registerZone(z);
    return s;
  }, []);

  return <WindeaseContext.Provider value={store}>{props.children}</WindeaseContext.Provider>;
}
