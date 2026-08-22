import type { AffordanceJoin } from '../layout-types.js';
import type { NodeId } from '../node.js';

/** Main-axis pixels past the clamp before a seam arms, when a strategy names
 *  no threshold of its own. */
export const DEFAULT_JOIN_THRESHOLD = 24;

export interface TrackJoinInput {
  join: AffordanceJoin;
  /** Cumulative main-axis pointer travel since the gesture began. */
  requested: number;
  /** Main-axis extent the layout absorbed: `bounds.valueNow` now, less its
   *  value when the gesture began. */
  consumed: number;
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
  /** Signed distance past the clamp; zero while the seam is still moving. */
  overshoot: number;
}

/**
 * Whether a seam gesture has been pushed far enough past its clamp to destroy
 * something on release, and what.
 *
 * The seam stops moving but the pointer does not, and nothing else in the
 * system records the difference: `requested` keeps growing while `consumed`
 * freezes at the floor. The gap is the overshoot, and its sign picks which end
 * of the affordance's range the user is pressing against.
 *
 * @group Layout
 */
export function trackJoin(input: TrackJoinInput): JoinState {
  const overshoot = input.requested - input.consumed;
  const candidateId =
    overshoot > 0 ? input.join.atMax : overshoot < 0 ? input.join.atMin : undefined;
  if (candidateId === undefined) return { armed: false, overshoot };
  const armed = Math.abs(overshoot) > input.join.threshold && input.canDestroy(candidateId);
  return { armed, candidateId, overshoot };
}
