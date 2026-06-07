import type { NodeId } from '../index.js';

export interface ChildSortEntry {
  id: NodeId;
  order: number | undefined;
}

/** A custom sort callback for a parent preset. Receives the parent's JSX
 *  children (with their optional `order`) plus the full current child id list
 *  (including imperative ones, in store order). Returns the FINAL ordered id
 *  list — JSX ids only; imperative ids will be appended in store order. */
export type ChildSort = (
  jsxChildren: readonly ChildSortEntry[],
  currentChildIds: readonly NodeId[],
) => NodeId[];

/** Numeric `order` ascending (undefined ⇒ +Infinity), then JSX position. */
export const defaultChildSort: ChildSort = (jsxChildren) => {
  return jsxChildren
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.index - b.index;
    })
    .map((e) => e.id);
};
