import { type CreateZoneInput, type HistoryController, WindeaseStore } from '@windease/core';
import type * as React from 'react';
import { type ReactNode, createContext, useEffect, useMemo } from 'react';

export const WindeaseContext = createContext<WindeaseStore | null>(null);

export interface HistoryHookup<T = unknown> {
  controller: HistoryController<T>;
  capture: () => T;
  restore: (snap: T) => void;
}

export const HistoryHookupContext = createContext<HistoryHookup<unknown> | null>(null);

interface BaseProps {
  children: ReactNode;
  history?: HistoryHookup<unknown>;
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

  const { history } = props;

  useEffect(() => {
    if (!history) return;
    history.controller.push(history.capture());
    const evt = store.events;
    const push = () => history.controller.push(history.capture());
    const offs = [
      evt.on('window.created', push),
      evt.on('window.destroyed', push),
      evt.on('window.transitioned', push),
      evt.on('zone.claimed', push),
      evt.on('zone.released', push),
      evt.on('zone.reordered', push),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [store, history]);

  return (
    <WindeaseContext.Provider value={store}>
      <HistoryHookupContext.Provider value={history ?? null}>
        {props.children}
      </HistoryHookupContext.Provider>
    </WindeaseContext.Provider>
  );
}
