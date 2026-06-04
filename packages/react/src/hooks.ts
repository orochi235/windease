import { useContext, useSyncExternalStore } from 'react';
import type { WindeaseStore, WindowId, WindowRecord, ZoneId, ZoneRecord } from '@windease/core';
import { WindeaseContext } from './WindeaseProvider.js';

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
