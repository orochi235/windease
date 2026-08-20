import { type ChildSort, defaultChildSort } from './child-sort.js';
import type { NodeId } from './node.js';
import type { Store } from './store.js';
import { trace } from './trace.js';

/** A child as a binding observed it: its id, plus an optional sort key. */
export interface ObservedChild {
  id: NodeId;
  order: number | undefined;
}

/**
 * Whether a declared value may be written, and how.
 *
 * A lock stops *direct user manipulation*. A binding reconciling a declared
 * value is host code, not the user, so the rule is per field rather than per
 * axis, and it splits two ways:
 *
 * - **Skip** where a user gesture writes the same state (`childOrder`,
 *   `container.state`, `pinned`). Forcing a stale declared value past the lock
 *   would silently revert the arrangement the lock exists to protect.
 * - **Force** where the lock's own gesture is the only other writer
 *   (`placement.size` under `resize`). Nothing can be clobbered.
 *
 * These functions own that decision so a second binding cannot re-derive it
 * differently. A binding supplies only what it observed.
 */

/** Reconcile the generic `placement` bag. Forces: see the rule above. */
export function reconcilePlacement(
  store: Store,
  id: NodeId,
  placement: Record<string, unknown>,
): void {
  if ('pinned' in placement) {
    throw new Error(
      `windease: the generic \`placement\` prop cannot set "pinned" on "${id}" — use the dedicated \`pinned\` prop instead.`,
    );
  }
  store.patchPlacement(id, placement, { force: true });
}

/**
 * Reconcile a declared pin. Skips under the *parent's* arrange lock — pinning
 * rewrites the parent's `childOrder`, which a live drag also writes.
 */
export function reconcilePinned(store: Store, id: NodeId, pinned: number | boolean): void {
  const parentId = store.getNode(id)?.membership?.parentId;
  // A root has no childOrder to hold a slot in. Skip rather than throw: with
  // `parentId` usually arriving from context, one component renders both ways.
  if (parentId === undefined) {
    trace('layout', `pinned reconcile skipped for ${id}: no parent to hold a slot in`);
    return;
  }
  if (store.isLocked(parentId, 'arrange')) {
    trace('layout', `pinned reconcile skipped for ${id}: parent ${parentId} locked (arrange)`);
    return;
  }
  if (pinned === false) store.unpin(id);
  else store.setPinned(id, pinned === true ? undefined : pinned);
}

/** Reconcile persisted strategy state. Skips under the container's arrange lock. */
export function reconcileContainerState(store: Store, id: NodeId, state: unknown): void {
  if (store.isLocked(id, 'arrange')) {
    trace('layout', `state reconcile skipped for ${id}: locked (arrange)`);
    return;
  }
  store.setContainerState(id, state);
}

/**
 * Merge the order a binding observed into the parent's `childOrder`, then
 * write it unless the container is arrange-locked.
 *
 * `observed` is whatever the binding saw — JSX children for React, DOM child
 * order for custom elements. Ids that are not currently children of `parentId`
 * are dropped; children the binding did not observe (registered imperatively)
 * keep their relative store order and fill in after the observed ones. Pinned
 * children are excluded from sorting entirely and hold their exact index.
 */
export function reconcileChildOrder(
  store: Store,
  parentId: NodeId,
  observed: readonly ObservedChild[],
  opts?: { sort?: ChildSort },
): void {
  const view = store.getContainerView(parentId);
  if (!view) return;
  const currentIds = view.childOrder;
  const currentSet = new Set(currentIds);
  const entries = observed.filter((e) => currentSet.has(e.id));
  const observedIds = new Set(entries.map((e) => e.id));
  const imperativeIds = currentIds.filter((cid) => !observedIds.has(cid));
  const pinnedIds = new Set(currentIds.filter((cid) => store.getPinnedIndex(cid) !== null));

  const sortFn = opts?.sort ?? defaultChildSort;
  const ordered = sortFn(
    entries.filter((e) => !pinnedIds.has(e.id)).map((e) => ({ id: e.id, order: e.order })),
    currentIds,
  );
  const fillQueue = [...ordered, ...imperativeIds.filter((cid) => !pinnedIds.has(cid))];
  let fillIndex = 0;
  // A permutation of currentIds: pinned ids keep their slot, fillQueue takes
  // the rest in order.
  const finalOrder = currentIds.map((cid) =>
    pinnedIds.has(cid) ? cid : (fillQueue[fillIndex++] as NodeId),
  );

  let same = finalOrder.length === currentIds.length;
  if (same) {
    for (let i = 0; i < finalOrder.length; i++) {
      if (finalOrder[i] !== currentIds[i]) {
        same = false;
        break;
      }
    }
  }
  if (same) return;
  if (store.isLocked(parentId, 'arrange')) {
    trace('layout', `sibling-order reconcile skipped for ${parentId}: locked (arrange)`);
    return;
  }
  store.setChildOrder(parentId, finalOrder);
}
