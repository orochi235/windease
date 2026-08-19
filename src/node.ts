import type { Machine } from './fsm.js';
import type { LockSet } from './lock.js';
import type { FocusEvent, FocusState } from './machines/focus.js';
import type { LifecycleEvent, LifecycleState } from './machines/lifecycle.js';
import type { TransitEvent, TransitState } from './machines/transit.js';

export type NodeId = string & { readonly __brand: 'NodeId' };

export const asNodeId = (s: string): NodeId => s as NodeId;

/**
 * Optional consumer-defined role label. Conventional values when using the
 * shipped presets are `'panel'`, `'group'`, `'zone'`, but the core does not
 * enforce or interpret these — `kind` is a free-form string that the React
 * chrome map can dispatch on, and nothing else.
 */
export type NodeKind = string;

export interface NodeHints {
  /** Floor for strategy clamping and resize-drag. */
  minSize?: { w: number; h: number };
  /** Ceiling for strategy clamping and resize-drag. */
  maxSize?: { w: number; h: number };
  preferredSize?: { w: number; h: number };
  order?: number;
}

export type LifecycleCap = Machine<LifecycleState, LifecycleEvent>;
export type TransitCap = Machine<TransitState, TransitEvent>;
export type FocusCap = Machine<FocusState, FocusEvent>;

export interface ContainerCap {
  strategyId: string;
  config: unknown;
  /**
   * Canonical record of this container's children **and their order**. The
   * store is the source of truth: every mutation that adds, removes, moves, or
   * reorders a child rewrites this array. Layout strategies, the React
   * `useChildren` hook, snapshot/hydrate, and DnD all read from here.
   *
   * Today this is the *only* place child order lives. The declarative React
   * layer reconciles JSX sibling order into this array via
   * `Store.setChildOrder(parentId, orderedIds)`; a future iteration may move
   * to an order-keyed model (e.g. sparse fractional keys) so that concurrent
   * reorder operations don't have to round-trip the full permutation. Until
   * then, **treat this array as the single canonical ordering** and prefer
   * `setChildOrder` / `reorderInParent` / `moveNode` over mutating it.
   */
  childOrder: NodeId[];
  allowsPinning: boolean;
  state?: unknown;
}

export interface MembershipCap {
  parentId: NodeId;
  /**
   * Per-membership bag of placement state. Reserved keys recognized by the
   * shipped layout strategies and React layer:
   *  - `pinned?: number` — the index in the parent's childOrder this child
   *     holds against third-party reorders. Set via `Store.setPinned`/`unpin`.
   *  - `size?: { w?: number; h?: number }` — user intent; honored by stack /
   *     strip / split along their main axis. Either dimension is optional.
   *     Gutter drags on split *clear* this key on the two affected panes.
   *  Free-form keys are ignored by core; consumers may add their own.
   */
  placement: Record<string, unknown>;
  transit: TransitCap;
}

export interface Node {
  id: NodeId;
  /** Free-form role label; see `NodeKind` JSDoc. Optional. */
  kind?: NodeKind;
  meta?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  hints?: NodeHints;
  /** Optional numeric sort key used by container presets when reconciling
   *  sibling order. Lower values come first; ties preserve input order. */
  order?: number;
  lifecycle: LifecycleCap;

  container?: ContainerCap;
  membership?: MembershipCap;
  focus?: FocusCap;

  /** Permissions restricting what may be done to this node. Node-intrinsic:
   *  survives `moveNode`, unlike `membership.placement`. */
  lock?: LockSet;
}
