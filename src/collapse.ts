import type { NodeId } from './node.js';
import type { Store } from './store.js';
import { trace } from './trace.js';

/** The main-axis extent an empty container is laid out at, in pixels. */
export interface CollapseAnswer {
  extent: number;
}

/**
 * A drag in flight, described by whoever knows about it. The store holds no
 * drag state, so a caller that runs layout during a drag passes this in.
 */
export interface CollapseDrag {
  /** The nodes being dragged. */
  ids: readonly NodeId[];
  /** Whether `targetId` would take them if they were dropped on it. */
  accepts(targetId: NodeId): boolean;
}

/** Input to {@link resolveCollapse} and to a {@link CollapsePolicy}. */
export interface CollapseInput {
  store: Store;
  /** The empty container being asked about. */
  id: NodeId;
  drag?: CollapseDrag;
}

/**
 * Decides what an empty container does with the room it held. Return
 * `{ extent }` to lay it out at that many main-axis pixels, `null` to leave it
 * as it is, or `undefined` to let the built-in decide, which leaves it too.
 *
 * Asked on every layout of the parent, about each child that is a container
 * with nothing to show, so keep it pure and cheap. Nothing is stored: the
 * container's own `placement.size` stays where it was and takes over again as
 * soon as a child arrives.
 */
export type CollapsePolicy = (input: CollapseInput) => CollapseAnswer | null | undefined;

/** Whether `id` is a container none of whose children would reach layout. */
export function isEmptyContainer(store: Store, id: NodeId): boolean {
  if (!store.getNode(id)?.container) return false;
  for (const child of store.getChildren(id)) {
    const state = child.lifecycle.state;
    if (state !== 'hidden' && state !== 'destroyed') return false;
  }
  return true;
}

/** A policy that calls back into `resolveCollapse` would otherwise recurse
 *  forever; the re-entrant call answers from the built-in instead. */
let consultingPolicy = false;

/**
 * The extent `id` collapses to, or `null` when it keeps the extent it has.
 * Consults the store's `collapsePolicy`, and only about a parented container
 * that is empty; with no policy every container stays as it is.
 *
 * A policy that throws, or answers with an extent that is not a finite
 * non-negative number, is traced and read as `undefined`.
 */
export function resolveCollapse(input: CollapseInput): CollapseAnswer | null {
  const { store, id } = input;
  const policy = store.collapsePolicy;
  if (!policy || consultingPolicy) return null;
  if (!store.getNode(id)?.membership || !isEmptyContainer(store, id)) return null;

  let chosen: CollapseAnswer | null | undefined;
  consultingPolicy = true;
  try {
    chosen = policy(input);
  } catch (err) {
    trace('layout', `collapse policy threw for ${id}, leaving it open: ${err}`);
    chosen = undefined;
  } finally {
    consultingPolicy = false;
  }
  if (chosen === undefined || chosen === null) return null;
  const extent = chosen.extent;
  if (typeof extent !== 'number' || !Number.isFinite(extent) || extent < 0) {
    trace('layout', `collapse policy returned unusable extent ${String(extent)} for ${id}`);
    return null;
  }
  return { extent };
}

/** The collapse policy that never collapses: an empty container keeps its extent. */
export const stay: CollapsePolicy = () => null;

/**
 * A collapse policy that takes every empty container to `to` pixels, zero by
 * default. With `dragTo`, a container opens to that extent while a drag it
 * would accept is in flight, which is how a pane gets back into one that
 * collapsed to nothing.
 */
export function collapse({
  to = 0,
  dragTo,
}: {
  to?: number;
  dragTo?: number;
} = {}): CollapsePolicy {
  return ({ id, drag }) =>
    dragTo !== undefined && drag?.accepts(id) ? { extent: dragTo } : { extent: to };
}
