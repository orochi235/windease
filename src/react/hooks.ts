import { useMemo, useSyncExternalStore } from 'react';
import type { Node, NodeId, Store } from '../index.js';
import { useStore } from './Provider.js';

/**
 * A stable string recording which of `ids` are currently *published*.
 *
 * Under a throttle policy the published set can change while the id list that
 * names it does not: a child held by dwell, or deferred to a later stagger
 * wave, publishes in a flush that leaves its parent's record — and therefore
 * `container.childOrder` — untouched. Memoizing on the id list alone would
 * freeze a derived node array at whatever had published when the list last
 * changed, so hooks that resolve ids to records key on this too.
 *
 * Returns a string so it is safe as a `useSyncExternalStore` snapshot.
 */
function publishedKey(store: Store, ids: readonly NodeId[] | undefined): string {
  if (!ids) return '';
  let key = '';
  for (const id of ids) key += store.getNode(id) ? '1' : '0';
  return key;
}

/** @group Hooks */
export function useNode(id: NodeId): Node | undefined {
  const store = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(id),
  );
}

/** @group Hooks */
export function useNodeSelector<T>(id: NodeId, select: (n: Node) => T): T | undefined {
  const store = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => {
      const n = store.getNode(id);
      return n ? select(n) : undefined;
    },
  );
}

/** @group Hooks */
export function useChildren(parentId: NodeId): readonly Node[] {
  // Subscribe to the parent node directly; derive children from its
  // container.childOrder via useMemo so the array is stable until childOrder
  // actually changes. (getChildren() would allocate a new array per call
  // and cause useSyncExternalStore to loop.)
  const store = useStore();
  const parent = useNode(parentId);
  const childOrder = parent?.container?.childOrder;
  // `childOrder` identity alone is not enough: a staggered or dwell-held child
  // publishes in a flush that leaves the parent record untouched, so the memo
  // would never recompute and the list would stall mid-reveal. See publishedKey.
  const published = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => publishedKey(store, childOrder),
  );
  return useMemo(() => {
    if (!childOrder) return [];
    const out: Node[] = [];
    for (const cid of childOrder) {
      const n = store.getNode(cid);
      if (n) out.push(n);
    }
    return out;
  }, [store, childOrder, published]);
}

/** @group Hooks */
export function useFocusedNode(): Node | undefined {
  const store = useStore();
  const focusedId = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.focusedId,
  );
  return useNode(focusedId ?? (undefined as unknown as NodeId));
}

/** @group Hooks */
export function useRootNodes(): readonly Node[] {
  const store = useStore();
  // Subscribe to a stable snapshot of rootIds. We rely on the store
  // mutating rootIds in place (push/splice) only on register/unregister,
  // and recompute children only when the array length differs or any
  // entry differs. Simplest correct approach: subscribe to a serialized
  // key and memoize on it.
  // The key carries both the id list and which of those ids have published —
  // `rootIds` reaches its final value in the globals flush while the root
  // records themselves can arrive in later waves. See publishedKey.
  const rootKey = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => `${store.rootIds.join('|')}#${publishedKey(store, store.rootIds)}`,
  );
  // rootKey is the gate — when the joined id string changes we recompute.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rootKey is the snapshot signal.
  return useMemo(() => {
    const out: Node[] = [];
    for (const id of store.rootIds) {
      const n = store.getNode(id);
      if (n) out.push(n);
    }
    return out;
  }, [store, rootKey]);
}

/** @group Hooks */
export function useActivity(id: NodeId): Record<string, unknown> | undefined {
  const store = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(id)?.activity,
  );
}
