import type {
  WindeaseStore,
  WindowId,
  WindowRecord,
  ZoneId,
  ZoneItemMeta,
  ZoneRecord,
} from '../index.js';
import { useContext, useSyncExternalStore } from 'react';
import { HistoryHookupContext, type HistoryHookup, WindeaseContext } from './WindeaseProvider.js';

/** @deprecated v0.1 hook — use `useNodeStore` from the v0.2 node model. */
export function useWindease(): WindeaseStore {
  const s = useContext(WindeaseContext);
  if (!s) throw new Error('useWindease must be used inside <WindeaseProvider>');
  return s;
}

/** @deprecated v0.1 hook — use `useNode` (v0.2) which re-renders on FSM
 *  state changes via record replacement. */
export function useWindow(id: WindowId): WindowRecord | undefined {
  const store = useWindease();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getWindow(id),
  );
}

/** @deprecated v0.1 hook — use `useNode` from the v0.2 node model. */
export function useZone(id: ZoneId): ZoneRecord | undefined {
  const store = useWindease();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getZone(id),
  );
}

/** @deprecated v0.1 hook — use `useChildren` from the v0.2 node model. */
export function useWindowsByZone(id: ZoneId): WindowRecord[] {
  const store = useWindease();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.listWindows({ zoneId: id }),
  );
}

/** @deprecated v0.1 hook — `slot.placement` on the v0.2 Node carries the
 *  same data; read via `useNodeSelector(id, n => n.slot?.placement)`. */
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
