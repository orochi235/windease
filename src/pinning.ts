import { InvariantViolationError } from './errors.js';
import type { NodeId } from './node.js';

export type PinnedIndexOf = (id: NodeId) => number | null;

/**
 * Rebuild `order` with `movingId` placed at (or as near as possible after)
 * `desired`, honoring the held indices of every *other* pinned child. A pinned
 * node holds its slot against third parties but yields when it is itself the
 * node being reordered. `movingId` must already be a member of `order` —
 * inserting a new child is the caller's job (splice it in first).
 */
export function placeRespectingPins(
  order: readonly NodeId[],
  movingId: NodeId,
  desired: number,
  pinnedIndexOf: PinnedIndexOf,
): NodeId[] {
  const n = order.length;
  if (!order.includes(movingId)) {
    throw new InvariantViolationError(
      'pin-nonmember',
      `cannot place ${movingId}: not a member of order (length ${n})`,
      { movingId, length: n },
    );
  }

  const held = new Map<number, NodeId>();
  for (const cid of order) {
    if (cid === movingId) continue;
    const pin = pinnedIndexOf(cid);
    if (pin === null) continue;
    const slot = Math.min(Math.max(pin, 0), n - 1);
    if (!held.has(slot)) held.set(slot, cid);
  }

  const heldIds = new Set(held.values());
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!held.has(i)) free.push(i);

  const target = Math.min(Math.max(desired, 0), n - 1);
  const slot = free.find((i) => i >= target) ?? free[free.length - 1];

  const rest = order.filter((c) => c !== movingId && !heldIds.has(c));
  const result = new Array<NodeId | undefined>(n);
  for (const [i, cid] of held) result[i] = cid;
  if (slot !== undefined) result[slot] = movingId;

  let r = 0;
  for (let i = 0; i < n; i++) {
    if (result[i] === undefined) result[i] = rest[r++];
  }
  return result as NodeId[];
}
