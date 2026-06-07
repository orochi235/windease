import { type CreateZoneInput, type HistoryController, trace, WindeaseStore } from '../index.js';
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
    trace('history', 'provider: pushing initial snapshot');
    history.controller.push(history.capture());
    const evt = store.events;
    const pushFor = (name: string) => () => {
      trace('store', `event: ${name} → history push`);
      history.controller.push(history.capture());
    };
    const offs = [
      evt.on('window.created', pushFor('window.created')),
      evt.on('window.destroyed', pushFor('window.destroyed')),
      evt.on('window.transitioned', pushFor('window.transitioned')),
      evt.on('zone.claimed', pushFor('zone.claimed')),
      evt.on('zone.released', pushFor('zone.released')),
      evt.on('zone.reordered', pushFor('zone.reordered')),
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
