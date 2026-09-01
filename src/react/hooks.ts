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

/**
 * Subscribe to one node, re-rendering whenever its record is replaced.
 * `undefined` while the id is unknown or, under a throttle policy, not yet
 * published. Cheap enough to call per component — the store hands back the
 * same reference until something actually changes.
 * @group Hooks
 */
export function useNode(id: NodeId): Node | undefined {
  const store = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(id),
  );
}

/**
 * Subscribe to a derived slice of one node. `select` runs on every store
 * notification, so it must be cheap and must return a stable value for
 * unchanged input — returning a fresh object or array each call re-renders on
 * every mutation anywhere in the tree.
 * @group Hooks
 */
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

/**
 * A container's children, in `childOrder`, with unpublished ids omitted. The
 * returned array is referentially stable until the membership or the published
 * set actually changes, so it is safe as a dependency.
 * @group Hooks
 */
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: `published` is the snapshot signal, not a value the body reads.
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

/**
 * The single focused node, or `undefined` when nothing holds focus. Tracks the
 * store's focus invariant, not the DOM's `activeElement`.
 * @group Hooks
 */
export function useFocusedNode(): Node | undefined {
  const store = useStore();
  const focusedId = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.focusedId,
  );
  return useNode(focusedId ?? (undefined as unknown as NodeId));
}

/**
 * Every parentless node, in registration order. The entry point for rendering
 * a tree whose roots the consumer doesn't name explicitly.
 * @group Hooks
 */
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

/**
 * A node's free-form `activity` bag — the channel for high-frequency signals a
 * strategy reads (recency, unread counts) that shouldn't churn `node.meta`.
 * @group Hooks
 */
export function useActivity(id: NodeId): Record<string, unknown> | undefined {
  const store = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(id)?.activity,
  );
}
