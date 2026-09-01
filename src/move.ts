import { resolveNavigation } from './focus/resolve.js';
import type { GeometrySource, NavDirection } from './focus/types.js';
import type { LayoutStrategy } from './layout-types.js';
import type { NodeId } from './node.js';
import type { Store } from './store.js';
import { trace } from './trace.js';

/** Where a directional move would land, resolved but not yet performed. */
export type MovePlan =
  | { kind: 'reorder'; id: NodeId; parentId: NodeId; at: number }
  | { kind: 'reparent'; id: NodeId; fromParentId: NodeId; parentId: NodeId; at: number };

/** Input to `resolveMove`: the node to move, the direction, and the geometry
 *  to resolve it against. */
export interface ResolveMoveInput {
  store: Store;
  /** The node being moved — the focused one, for a keyboard gesture. */
  from: NodeId;
  direction: NavDirection;
  geometry: GeometrySource;
  strategies?: ReadonlyMap<string, LayoutStrategy<unknown, string, unknown>>;
}

function isWithinSubtree(store: Store, candidate: NodeId, root: NodeId): boolean {
  let cursor: NodeId | undefined = candidate;
  while (cursor) {
    if (cursor === root) return true;
    cursor = store.getNode(cursor)?.membership?.parentId;
  }
  return false;
}

/**
 * Resolve a directional move by asking navigation where the arrow would have
 * gone, then taking that node's slot. Every refusal returns null rather than
 * throwing, so a key that cannot move anything is inert instead of noisy.
 */
export function resolveMove({
  store,
  from,
  direction,
  geometry,
  strategies,
}: ResolveMoveInput): MovePlan | null {
  const fromParentId = store.getNode(from)?.membership?.parentId;
  if (!fromParentId) return null;
  if (store.getLock(from).move) return null;

  const target = resolveNavigation({
    store,
    from,
    intent: direction,
    geometry,
    ...(strategies ? { strategies } : {}),
  });
  if (!target) return null;

  const parentId = store.getNode(target)?.membership?.parentId;
  if (!parentId) return null;
  const at = store.getNode(parentId)?.container?.childOrder.indexOf(target) ?? -1;
  if (at < 0) return null;

  if (parentId === fromParentId) {
    // `reorderInParent` would throw on this; resolved here so the key is inert
    // rather than noisy, like every other refusal above.
    if (store.getLock(parentId).arrange) return null;
    trace('workspace', `move ${direction}: ${from} → ${at} in ${parentId}`);
    return { kind: 'reorder', id: from, parentId, at };
  }

  if (store.getLock(parentId).accept) return null;
  if (store.getLock(fromParentId).dragOut) return null;
  if (isWithinSubtree(store, parentId, from)) return null;

  trace('workspace', `move ${direction}: ${from} → ${parentId}@${at}`);
  return { kind: 'reparent', id: from, fromParentId, parentId, at };
}

/**
 * Perform a plan from `resolveMove`. Split from resolution so a host can show
 * the destination, or refuse it, before anything is committed.
 *
 * Plans go stale: a tree mutated between resolve and apply may reject this one
 * or move the node somewhere the plan no longer describes.
 */
export function applyMove(store: Store, plan: MovePlan): void {
  if (plan.kind === 'reorder') store.reorderInParent(plan.id, plan.at);
  else store.moveNode(plan.id, plan.parentId, plan.at);
}
