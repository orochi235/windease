import type { Node, NodeId } from './node.js';
import type { Store } from './store.js';

export type LockAxis = 'move' | 'resize' | 'destroy' | 'accept' | 'dragOut' | 'arrange';

export type LockSet = Partial<Record<LockAxis, boolean>>;

const MEMBERSHIP_AXES = ['move', 'resize'] as const;
const CONTAINER_AXES = ['accept', 'dragOut'] as const;
// `arrange` governs whether this node's children may be rearranged — including
// whether it may acquire any. Gating it on an existing container would make it
// bind everywhere except on `ensureContainer`, the one call it has to stop.
const ALWAYS_AXES = ['destroy', 'arrange'] as const;

/** Axes meaningful for this node, decided by which capabilities it carries. */
export function supportedAxes(node: Node): ReadonlySet<LockAxis> {
  const axes = new Set<LockAxis>(ALWAYS_AXES);
  if (node.membership) for (const a of MEMBERSHIP_AXES) axes.add(a);
  if (node.container) for (const a of CONTAINER_AXES) axes.add(a);
  return axes;
}

/**
 * Unsupported axes are dropped rather than rejected, so a host can pass `true`
 * without branching on node shape.
 */
export function resolveLock(node: Node, input: boolean | LockSet): LockSet {
  const supported = supportedAxes(node);
  const out: LockSet = {};
  if (input === true) {
    for (const axis of supported) out[axis] = true;
    return out;
  }
  if (input === false) return out;
  for (const [key, value] of Object.entries(input)) {
    const axis = key as LockAxis;
    if (value === true && supported.has(axis)) out[axis] = true;
  }
  return out;
}

/**
 * The first node in `id`'s subtree — `id` itself included — carrying
 * `lock.destroy`, or null when nothing does.
 *
 * Deliberately stricter than the store it guards: `unregisterNode` asserts the
 * lock on the id it is handed and then cascades with no further checks, so a
 * locked descendant dies silently. A gesture that offers to destroy a subtree
 * asks this first, and returns the blocker rather than a boolean so the
 * refusal can name which descendant refused.
 */
export function destroyBlockedBy(store: Store, id: NodeId): NodeId | null {
  const node = store.getNode(id);
  if (!node) return null;
  if (node.lock?.destroy === true) return id;
  for (const childId of node.container?.childOrder ?? []) {
    const blocker = destroyBlockedBy(store, childId);
    if (blocker !== null) return blocker;
  }
  return null;
}
