import type { Affordance, AffordanceJoin } from '../layout-types.js';
import type { NodeId } from '../node.js';
import type { Store } from '../store.js';
import { trace } from '../trace.js';

/** Main-axis pixels past the clamp before a seam arms, when a strategy names
 *  no threshold of its own. */
export const DEFAULT_JOIN_THRESHOLD = 24;

/** Input to {@link trackJoin}: the seam's current overshoot and the rules for
 *  whether the node it would destroy may be destroyed.
 *  @group Layout */
export interface TrackJoinInput {
  join: AffordanceJoin;
  /** Overshoot accumulated so far this gesture; 0 when it began. */
  overshoot: number;
  /** Main-axis travel this move asked for. */
  delta: number;
  /** Whether the affordance is pinned at each end, from `bounds`. Only a
   *  pinned seam accumulates: an unpinned one is still resizing, however fast
   *  the pointer is moving. */
  atMin: boolean;
  atMax: boolean;
  /** Whether this node may be destroyed. Injected rather than read from a
   *  store so the arithmetic stays pure and testable with plain numbers. */
  canDestroy: (id: NodeId | string) => boolean;
}

/** Whether the seam is armed to destroy a node, and which one — what a host
 *  needs to preview the join before the pointer is released.
 *  @group Layout */
export interface JoinState {
  armed: boolean;
  /**
   * The node at the end of the range being pushed against. A candidate, not a
   * verdict: it is populated whenever the gesture has a direction, so read it
   * only together with `armed`.
   */
  candidateId?: NodeId | string;
  /** Signed distance past the clamp. Feed it back as `overshoot` next move. */
  overshoot: number;
}

/**
 * Whether a seam gesture has been pushed far enough past its clamp to destroy
 * something on release, and what.
 *
 * A reducer over one move at a time: the caller keeps the returned `overshoot`
 * and hands it back with the next delta. Travel counts only while the
 * affordance reports itself pinned at the end being pushed toward, which is
 * the one signal that distinguishes pushing against a floor from resizing
 * quickly.
 *
 * @group Layout
 */
export function trackJoin(input: TrackJoinInput): JoinState {
  const { overshoot, delta } = input;
  // Pinned at both ends is the container being too small for its panes' floors,
  // not a push against one, so no move in either direction is overshoot.
  const pinned =
    delta > 0 ? input.atMax && !input.atMin : delta < 0 ? input.atMin && !input.atMax : false;
  let next: number;
  if (pinned) {
    next = overshoot + delta;
  } else if (overshoot === 0) {
    next = 0;
  } else {
    // Unpinned travel can give the push back but never add to it.
    const unwound = overshoot + delta;
    if (Math.sign(unwound) !== Math.sign(overshoot)) next = 0;
    else if (Math.abs(unwound) < Math.abs(overshoot)) next = unwound;
    else next = overshoot;
  }
  const candidateId = next > 0 ? input.join.atMax : next < 0 ? input.join.atMin : undefined;
  if (candidateId === undefined) return { armed: false, overshoot: next };
  const armed = Math.abs(next) > input.join.threshold && input.canDestroy(candidateId);
  return { armed, candidateId, overshoot: next };
}

/** The row's pane sizes as a seam gesture found them. See {@link captureSeam}.
 *  @group Layout */
export type SeamCapture = ReadonlyMap<NodeId, { size?: unknown; share?: unknown }>;

/** The placement keys a seam writes. */
const SIZE_KEYS = ['size', 'share'] as const;

/**
 * Record the sizes of every pane in the row a seam resizes, before the gesture
 * writes any. {@link commitJoin} restores them when it hides a pane, so the row
 * comes back as it was when that pane is shown again. Take one when the gesture
 * begins: on pointer down, or on the first key press of a keyboard gesture.
 *
 * @group Layout
 */
export function captureSeam(store: Store, affordance: Affordance): SeamCapture {
  const out = new Map<NodeId, { size?: unknown; share?: unknown }>();
  const first = affordance.affects?.[0] ?? affordance.childId;
  const parentId = first ? store.getParent(first as NodeId)?.id : undefined;
  if (!parentId) return out;
  for (const child of store.getChildren(parentId)) {
    const placement = child.membership?.placement ?? {};
    const kept: { size?: unknown; share?: unknown } = {};
    for (const k of SIZE_KEYS) if (k in placement) kept[k] = placement[k];
    out.set(child.id, kept);
  }
  return out;
}

/**
 * Carry out an armed seam join on `victimId`, in one transaction. A join whose
 * `action` is `'hide'` puts every size `before` recorded back, then hides the
 * victim; `showNode` later returns it at the size it had when the gesture
 * began. Otherwise the victim is unregistered, as `destroyBlockedBy` allowed.
 *
 * Only sizes the gesture changed are written, so a resize-locked pane it never
 * touched is left alone.
 *
 * @group Layout
 */
export function commitJoin(
  store: Store,
  affordance: Affordance,
  victimId: NodeId,
  before?: SeamCapture,
): void {
  if (affordance.join?.action !== 'hide') {
    trace('store', `join: ${affordance.id} destroys ${victimId}`);
    store.unregisterNode(victimId);
    return;
  }
  store.transact(() => {
    for (const [id, was] of before ?? []) {
      const now = store.getNode(id)?.membership?.placement;
      if (!now) continue;
      const patch: Record<string, unknown> = {};
      for (const k of SIZE_KEYS) {
        if (JSON.stringify(now[k]) !== JSON.stringify(was[k])) patch[k] = was[k];
      }
      if (Object.keys(patch).length > 0) store.patchPlacement(id, patch);
    }
    trace('store', `join: ${affordance.id} hides ${victimId}`);
    store.hideNode(victimId);
  }, 'seam-hide');
}
