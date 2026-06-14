import { useMemo, useSyncExternalStore } from 'react';
import type { Node, NodeId } from '../index.js';
import { useStore } from './Provider.js';

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
  return useMemo(() => {
    if (!childOrder) return [];
    const out: Node[] = [];
    for (const cid of childOrder) {
      const n = store.getNode(cid);
      if (n) out.push(n);
    }
    return out;
  }, [store, childOrder]);
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
  const rootKey = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.rootIds.join('|'),
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
