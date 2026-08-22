import type { Node } from './node.js';

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
