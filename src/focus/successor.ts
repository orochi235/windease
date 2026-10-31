import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { rendersSubtree } from './navigable.js';

// Truth throughout: the store decides succession mid-mutation, and under a
// throttle the published view can lag what it just did.

export function isFocusable(store: Store, id: NodeId): boolean {
  const n = store.getNodeTruth(id);
  return !!n?.focus && n.lifecycle.state === 'visible';
}

/** Whether `id` is `root` or sits under it. */
export function isWithin(store: Store, id: NodeId, root: NodeId): boolean {
  let cursor: NodeId | undefined = id;
  while (cursor !== undefined) {
    if (cursor === root) return true;
    cursor = store.getNodeTruth(cursor)?.membership?.parentId;
  }
  return false;
}

function firstLeafDepthFirst(store: Store, roots: readonly NodeId[], skip: NodeId): NodeId | null {
  for (const rid of roots) {
    if (rid === skip) continue;
    const node = store.getNodeTruth(rid);
    if (!node || !rendersSubtree(node)) continue;
    if (isFocusable(store, rid) && !node.container) return rid;
    const nested = firstLeafDepthFirst(
      store,
      store.getChildren(rid).map((c) => c.id),
      skip,
    );
    if (nested) return nested;
  }
  return null;
}

/**
 * Who takes focus when `departing` loses it. Order: next visible sibling,
 * previous visible sibling, the parent's remembered child, the parent itself,
 * then the first visible leaf anywhere. Null when the tree has nobody left.
 *
 * `departing` may be a container whose subtree holds focus; nothing under it
 * is chosen.
 */
export function chooseSuccessor(store: Store, departing: NodeId): NodeId | null {
  const node = store.getNodeTruth(departing);
  const parentId = node?.membership?.parentId;

  if (parentId) {
    const siblings = store
      .getChildren(parentId)
      .map((c) => c.id)
      .filter((sid) => sid !== departing && isFocusable(store, sid));
    const order = store.getNodeTruth(parentId)?.container?.childOrder ?? [];
    const at = order.indexOf(departing);
    const after = siblings.find((sid) => order.indexOf(sid) > at);
    if (after) return after;
    const before = [...siblings].reverse().find((sid) => order.indexOf(sid) < at);
    if (before) return before;

    const remembered = store.getNodeTruth(parentId)?.container?.lastFocusedId;
    if (remembered && !isWithin(store, remembered, departing) && isFocusable(store, remembered)) {
      return remembered;
    }
    if (isFocusable(store, parentId)) return parentId;
  }

  return firstLeafDepthFirst(store, store.rootIdsTruth, departing);
}

/**
 * What `Store` is doing to `departing` when it asks. A consumer plausibly
 * wants a different successor on destroy than on hide.
 */
export interface SuccessorInput {
  store: Store;
  departing: NodeId;
  reason: 'destroyed' | 'hidden' | 'moved';
}

/**
 * Replaces {@link chooseSuccessor}. Return an id to choose it, `null` to focus
 * nobody deliberately, or `undefined` to let the built-in decide.
 */
export type SuccessorPolicy = (ctx: SuccessorInput) => NodeId | null | undefined;
