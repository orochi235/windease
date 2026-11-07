import type { NodeId } from '../node.js';
import type { Store } from '../store.js';

/**
 * A drop seam counts the children a host renders — layout places only
 * `visible` ones — with the dragged node left out. `childOrder` also holds
 * hidden and never-shown children, so the two indices part wherever one sits.
 * These convert between them, against `parentId`'s order with `sourceId`
 * removed: the list `moveNode`'s `at` indexes.
 */

/** Positions in that order of the rendered children, or null when every child
 *  is rendered or none is: then the seam already counts the order itself. */
function renderedAt(store: Store, parentId: NodeId, sourceId: NodeId): number[] | null {
  const order = store.getNode(parentId)?.container?.childOrder ?? [];
  const at: number[] = [];
  let others = 0;
  for (const id of order) {
    if (id === sourceId) continue;
    if (store.getNode(id)?.lifecycle.state === 'visible') at.push(others);
    others++;
  }
  return at.length === 0 || at.length === others ? null : at;
}

/** The order index a drop at `seam` inserts at: just before the rendered child
 *  the seam precedes, or just after the last one. */
export function orderIndexOfSeam(
  store: Store,
  parentId: NodeId,
  sourceId: NodeId,
  seam: number,
): number {
  const at = renderedAt(store, parentId, sourceId);
  if (!at) return seam;
  const i = Math.max(0, seam);
  return i < at.length ? (at[i] as number) : (at[at.length - 1] as number) + 1;
}

/** The seam an insert at order index `index` sits at: how many rendered
 *  children come before it. */
export function seamOfOrderIndex(
  store: Store,
  parentId: NodeId,
  sourceId: NodeId,
  index: number,
): number {
  const at = renderedAt(store, parentId, sourceId);
  if (!at) return index;
  let seam = 0;
  while (seam < at.length && (at[seam] as number) < index) seam++;
  return seam;
}

/**
 * A seam counted among `drawn` — the children a host actually drew, in order,
 * with the dragged node left out — as a seam among `parentId`'s visible
 * children, which is what a drop's index counts. The two part where a strategy
 * withholds visible children: other pages of a paged container, a stack's
 * hidden tabs, a grid's unplaced overflow.
 */
export function visibleSeamOf(
  store: Store,
  parentId: NodeId,
  sourceId: NodeId | undefined,
  drawn: readonly string[],
  seam: number,
): number {
  if (drawn.length === 0) return seam;
  const visible = (store.getNode(parentId)?.container?.childOrder ?? []).filter(
    (id) => id !== sourceId && store.getNode(id)?.lifecycle.state === 'visible',
  );
  if (visible.length === drawn.length) return seam;
  const i = Math.max(0, Math.min(seam, drawn.length));
  const anchor = i < drawn.length ? drawn[i] : drawn[drawn.length - 1];
  const at = visible.indexOf(anchor as NodeId);
  if (at < 0) return seam;
  return i < drawn.length ? at : at + 1;
}
