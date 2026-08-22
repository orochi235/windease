import type { AffordanceJoin } from '../layout-types.js';
import type { NodeId } from '../node.js';

/** Main-axis pixels past the clamp before a seam arms, when a strategy names
 *  no threshold of its own. */
export const DEFAULT_JOIN_THRESHOLD = 24;

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
  const pinned = delta > 0 ? input.atMax : delta < 0 ? input.atMin : false;
  let next: number;
  if (pinned) {
    next = overshoot + delta;
  } else if (overshoot === 0) {
    next = 0;
  } else {
    // The seam is moving again, so the push is being given back. Unwind
    // toward zero without crossing it into the opposite direction.
    const unwound = overshoot + delta;
    next = Math.sign(unwound) === Math.sign(overshoot) ? unwound : 0;
  }
  const candidateId = next > 0 ? input.join.atMax : next < 0 ? input.join.atMin : undefined;
  if (candidateId === undefined) return { armed: false, overshoot: next };
  const armed = Math.abs(next) > input.join.threshold && input.canDestroy(candidateId);
  return { armed, candidateId, overshoot: next };
}
