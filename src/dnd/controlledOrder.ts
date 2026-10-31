import type { NodeId } from '../node.js';
import { placeRespectingPins } from '../pinning.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';

/** What changed about a controlled parent's order, alongside the new list. */
export interface ChildOrderChange {
  /** The node the gesture moved. */
  movedId: NodeId;
  /** Where it came from. Equal to the controlled parent on a reorder. */
  fromParentId: NodeId;
  /** Where it is going. Equal to the controlled parent on a reorder. */
  toParentId: NodeId;
}

/**
 * Receives the order a drop *would* have produced, for a parent whose order the
 * host owns. Registering one makes that parent controlled: the drop no longer
 * writes to the store, and the host commits by re-rendering.
 */
export type ChildOrderCommit = (nextChildIds: NodeId[], change: ChildOrderChange) => void;

/**
 * Hand a controlled parent the order this drop would have produced, and
 * report whether the store write was suppressed.
 *
 * Either side of a cross-parent drop may be controlled. If one is, the store
 * writes nothing at all: committing the move here *and* asking the host to
 * commit it would apply the same gesture twice. An uncontrolled counterpart
 * is therefore the host's to update, which is what "controlled" has to mean
 * for the id to end up in exactly one place.
 */
export function commitControlled(
  store: Store,
  orderControls: ReadonlyMap<NodeId, ChildOrderCommit>,
  movedId: NodeId,
  toParentId: NodeId,
  insertIndex: number | undefined,
): boolean {
  const fromParentId = store.getNode(movedId)?.membership?.parentId;
  if (fromParentId === undefined) return false;
  const toCommit = orderControls.get(toParentId);
  const fromCommit = fromParentId === toParentId ? undefined : orderControls.get(fromParentId);
  if (!toCommit && !fromCommit) return false;

  const change: ChildOrderChange = { movedId, fromParentId, toParentId };
  const pinnedIndexOf = (id: NodeId) => store.getPinnedIndex(id);

  if (toCommit) {
    const current = store.getNode(toParentId)?.container?.childOrder ?? [];
    const without = current.filter((cid) => cid !== movedId);
    const at = Math.max(0, Math.min(insertIndex ?? without.length, without.length));
    const spliced = [...without];
    spliced.splice(at, 0, movedId);
    // Same helper the store uses, so a controlled parent and an uncontrolled
    // one resolve a pinned prefix identically.
    toCommit(placeRespectingPins(spliced, movedId, at, pinnedIndexOf), change);
  }
  if (fromCommit) {
    const current = store.getNode(fromParentId)?.container?.childOrder ?? [];
    fromCommit(
      current.filter((cid) => cid !== movedId),
      change,
    );
  }
  trace(
    'dnd',
    `drop: ${movedId} → ${toParentId}@${insertIndex ?? 'append'} (controlled; store not written)`,
  );
  return true;
}
