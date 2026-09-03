import { InvariantViolationError } from './errors.js';
import type { NodeId } from './node.js';

/** Reports a child's held index, or `null` when it isn't pinned. */
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
  if (!order.includes(movingId)) {
    throw new InvariantViolationError(
      'pin-nonmember',
      `cannot place ${movingId}: not a member of order (length ${order.length})`,
      { movingId, length: order.length },
    );
  }
  return placeRunRespectingPins(order, [movingId], desired, pinnedIndexOf);
}

/**
 * The `placeRespectingPins` rule for a whole run: `movingIds` land on
 * consecutive free slots starting at or after `desired`, in the order given,
 * so a batch inserted next to a pin moves as a run rather than being
 * interleaved with it. Every id must already be a member of `order`.
 */
export function placeRunRespectingPins(
  order: readonly NodeId[],
  movingIds: readonly NodeId[],
  desired: number,
  pinnedIndexOf: PinnedIndexOf,
): NodeId[] {
  const n = order.length;
  const moving = new Set(movingIds);
  for (const id of moving) {
    if (!order.includes(id)) {
      throw new InvariantViolationError(
        'pin-nonmember',
        `cannot place ${id}: not a member of order (length ${n})`,
        { movingId: id, length: n },
      );
    }
  }

  const held = new Map<number, NodeId>();
  for (const cid of order) {
    if (moving.has(cid)) continue;
    const pin = pinnedIndexOf(cid);
    if (pin === null) continue;
    const slot = Math.min(Math.max(pin, 0), n - 1);
    if (!held.has(slot)) held.set(slot, cid);
  }

  const heldIds = new Set(held.values());
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!held.has(i)) free.push(i);

  const run = movingIds.filter((id, i) => movingIds.indexOf(id) === i);
  const target = Math.min(Math.max(desired, 0), Math.max(n - 1, 0));
  let start = free.findIndex((i) => i >= target);
  if (start < 0) start = free.length - run.length;
  start = Math.max(0, Math.min(start, free.length - run.length));
  const runSlots = free.slice(start, start + run.length);

  const rest = order.filter((c) => !moving.has(c) && !heldIds.has(c));
  const result = new Array<NodeId | undefined>(n);
  for (const [i, cid] of held) result[i] = cid;
  for (const [k, slot] of runSlots.entries()) result[slot] = run[k];

  let r = 0;
  for (let i = 0; i < n; i++) {
    if (result[i] === undefined) result[i] = rest[r++];
  }
  return result as NodeId[];
}
