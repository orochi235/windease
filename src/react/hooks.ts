import { useRef, useSyncExternalStore } from 'react';
import type { Node, NodeId, Store } from '../index.js';
import { useStore } from './Provider.js';

const EMPTY: readonly Node[] = [];
const EMPTY_IDS: readonly NodeId[] = [];

/**
 * Subscribe to the published records `readIds` names, as an array that keeps
 * its identity until one of those records is replaced or the list changes.
 *
 * Keyed on the records themselves rather than the id list: a `setMeta` or a
 * hide replaces a record and leaves every id where it was, and under a
 * throttle policy a child held by dwell or a later stagger wave publishes in a
 * flush that leaves its parent untouched.
 */
function useRecords(readIds: (store: Store) => readonly NodeId[] | undefined): readonly Node[] {
  const store = useStore();
  const cache = useRef<readonly Node[]>(EMPTY);
  const read = () => {
    const ids = readIds(store);
    const prev = cache.current;
    const next: Node[] = [];
    let same = true;
    for (const id of ids ?? EMPTY_IDS) {
      const n = store.getNode(id);
      if (!n) continue;
      if (prev[next.length] !== n) same = false;
      next.push(n);
    }
    if (same && next.length === prev.length) return prev;
    cache.current = next.length === 0 ? EMPTY : next;
    return cache.current;
  };
  return useSyncExternalStore((cb) => store.subscribe(cb), read, read);
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
 * returned array is referentially stable until the membership, the published
 * set, or one of the child records actually changes, so it is safe as a
 * dependency.
 * @group Hooks
 */
export function useChildren(parentId: NodeId): readonly Node[] {
  return useRecords((store) => store.getNode(parentId)?.container?.childOrder);
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
  return useRecords((store) => store.rootIds);
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
