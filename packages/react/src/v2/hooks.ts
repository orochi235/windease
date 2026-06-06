import type { Node, NodeId } from '@windease/core';
import { useMemo, useSyncExternalStore } from 'react';
import { useNodeStore } from './NodeProvider.js';

export function useNode(id: NodeId): Node | undefined {
  const store = useNodeStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getNode(id),
  );
}

export function useNodeSelector<T>(id: NodeId, select: (n: Node) => T): T | undefined {
  const store = useNodeStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => {
      const n = store.getNode(id);
      return n ? select(n) : undefined;
    },
  );
}

export function useChildren(parentId: NodeId): readonly Node[] {
  // Subscribe to the parent node directly; derive children from its
  // container.childIds via useMemo so the array is stable until childIds
  // actually changes. (getChildren() would allocate a new array per call
  // and cause useSyncExternalStore to loop.)
  const store = useNodeStore();
  const parent = useNode(parentId);
  const childIds = parent?.container?.childIds;
  return useMemo(() => {
    if (!childIds) return [];
    const out: Node[] = [];
    for (const cid of childIds) {
      const n = store.getNode(cid);
      if (n) out.push(n);
    }
    return out;
  }, [store, childIds]);
}

export function useFocusedNode(): Node | undefined {
  const store = useNodeStore();
  const focusedId = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.focusedId,
  );
  return useNode(focusedId ?? (undefined as unknown as NodeId));
}

export function useRootNodes(): readonly Node[] {
  const store = useNodeStore();
  // Subscribe to a stable snapshot of rootIds. We rely on the store
  // mutating rootIds in place (push/splice) only on register/unregister,
  // and recompute children only when the array length differs or any
  // entry differs. Simplest correct approach: subscribe to a serialized
  // key and memoize on it.
  const rootKey = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.rootIds.join('|'),
  );
  return useMemo(() => {
    const out: Node[] = [];
    for (const id of store.rootIds) {
      const n = store.getNode(id);
      if (n) out.push(n);
    }
    return out;
    // rootKey is the gate — when the joined id string changes we recompute.
    // biome-ignore lint/correctness/useExhaustiveDependencies: rootKey is the snapshot signal.
  }, [store, rootKey]);
}
