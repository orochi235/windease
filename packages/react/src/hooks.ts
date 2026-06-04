import type {
  WindeaseStore,
  WindowId,
  WindowRecord,
  ZoneId,
  ZoneItemMeta,
  ZoneRecord,
} from '@windease/core';
import { useContext, useSyncExternalStore } from 'react';
import { HistoryHookupContext, type HistoryHookup, WindeaseContext } from './WindeaseProvider.js';

export function useWindease(): WindeaseStore {
  const s = useContext(WindeaseContext);
  if (!s) throw new Error('useWindease must be used inside <WindeaseProvider>');
  return s;
}

export function useWindow(id: WindowId): WindowRecord | undefined {
  const store = useWindease();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getWindow(id),
  );
}

export function useZone(id: ZoneId): ZoneRecord | undefined {
  const store = useWindease();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getZone(id),
  );
}

export function useWindowsByZone(id: ZoneId): WindowRecord[] {
  const store = useWindease();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.listWindows({ zoneId: id }),
  );
}

export function useItemMeta(zoneId: ZoneId, windowId: WindowId): ZoneItemMeta | undefined {
  const store = useWindease();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getItemMeta(zoneId, windowId),
  );
}

export function useHistory<T = unknown>(): HistoryHookup<T> | null {
  return useContext(HistoryHookupContext) as HistoryHookup<T> | null;
}
