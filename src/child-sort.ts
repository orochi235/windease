import type { NodeId } from './node.js';

/** One observed child handed to a {@link ChildSort}: its id and the `order`
 *  its JSX declared, if any. */
export interface ChildSortEntry {
  id: NodeId;
  order: number | undefined;
}

/** A custom sort callback for a parent preset. Receives the parent's observed
 *  children (with their optional `order`) plus the full current child id list
 *  (including imperative ones, in store order). Returns the FINAL ordered id
 *  list. Imperative ids it includes go where it put them; the ones it leaves
 *  out are appended in store order. */
export type ChildSort = (
  observed: readonly ChildSortEntry[],
  currentChildIds: readonly NodeId[],
) => NodeId[];

/** Numeric `order` ascending (undefined ⇒ +Infinity), then declared position. */
export const defaultChildSort: ChildSort = (observed) => {
  return observed
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.index - b.index;
    })
    .map((e) => e.id);
};

/**
 * Keeps the parent's current store order, ignoring declared JSX position.
 *
 * Pass as `<Zone sort={preserveStoreOrder}>` when the host owns *which*
 * children exist but the user owns *how they are arranged* — a drop then
 * survives the host's next render instead of being reverted to declared
 * order. Reconcile short-circuits, so no `setChildOrder` runs and no
 * `arrange` lock is needed. Children the binding did not observe keep their
 * store positions too.
 */
export const preserveStoreOrder: ChildSort = (_observed, currentChildIds) => [...currentChildIds];
