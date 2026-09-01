import type { Machine } from './fsm.js';
import type { LockSet } from './lock.js';
import type { FocusEvent, FocusState } from './machines/focus.js';
import type { LifecycleEvent, LifecycleState } from './machines/lifecycle.js';
import type { TransitEvent, TransitState } from './machines/transit.js';

/**
 * Opaque identifier for a node. Branded so a bare `string` can't be passed
 * where an id belongs; build one with `asNodeId`.
 */
export type NodeId = string & { readonly __brand: 'NodeId' };

/**
 * Brand a plain string as a `NodeId`. A cast, not a validation — the store
 * still rejects ids it doesn't know.
 */
export const asNodeId = (s: string): NodeId => s as NodeId;

/**
 * Optional consumer-defined role label. Conventional values when using the
 * shipped presets are `'panel'`, `'group'`, `'zone'`, but the core does not
 * enforce or interpret these — `kind` is a free-form string that the React
 * chrome map can dispatch on, and nothing else.
 */
export type NodeKind = string;

/**
 * Node-intrinsic sizing and rendering requests that layout strategies read.
 * Each field is honored only by the strategies implementing it — `stripStrategy`
 * clamps to `maxSize`, `gridStrategy` never reads it — and only on an axis that
 * strategy sizes, so `{ h: 'content' }` is inert in a horizontal strip. None of
 * it is a contract that a given rect comes back.
 */
export interface NodeHints {
  /** Floor for strategy clamping and resize-drag. */
  minSize?: { w: number; h: number };
  /** Ceiling for strategy clamping and resize-drag. */
  maxSize?: { w: number; h: number };
  preferredSize?: { w: number; h: number };
  /**
   * Per-axis request to be sized by measured content rather than by a hint or
   * a share. The core never measures: an adapter reports the measurement as
   * `LayoutItem.natural` and a strategy that understands it obliges. An axis
   * the strategy does not size is ignored, so `{ h: 'content' }` is inert in a
   * horizontal strip.
   */
  sizing?: { w?: 'content'; h?: 'content' };
  /**
   * How this container arranges its children. `'placed'` (the default) runs the
   * registered strategy and produces a rect per child. `'flow'` runs no
   * strategy: children render as ordinary in-flow elements and the consumer's
   * own CSS arranges them, so there are no placements, no affordances, no
   * `unplaced`, and no `sizing` measurement. Meaningless on a childless node.
   */
  render?: 'placed' | 'flow';
  order?: number;
}

/** Every node's state machine: `mounted → visible ↔ hidden → destroyed`. */
export type LifecycleCap = Machine<LifecycleState, LifecycleEvent>;
/** Guards a node's move between parents so a reparent is atomic. Carried on
 *  `membership`, so only a node with a parent has one. */
export type TransitCap = Machine<TransitState, TransitEvent>;
/** Tracks whether this node holds focus. Its presence is what makes a node
 *  focusable at all; the store enforces one focused node per tree. */
export type FocusCap = Machine<FocusState, FocusEvent>;

/**
 * The "can I have children?" capability. A node carrying it hosts children in
 * `childOrder` and lays them out with the strategy named by `strategyId`.
 * Independent of `MembershipCap`: a zone is a container with no membership, a
 * panel the reverse, and a group carries both.
 */
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
  /**
   * Collapse this container into its parent when a removal leaves it holding
   * exactly one child: the survivor is lifted into the grandparent at this
   * container's index, inheriting its placement, and this node is destroyed.
   *
   * Opt-in, because a zone a consumer created on purpose has to survive being
   * emptied. Off by default and never applied to a root, which has no
   * grandparent to lift into.
   */
  autoUnsplit?: boolean;
  /**
   * The descendant of this container that most recently held focus. Maintained
   * by the store, not by consumers: written on `focusNode`, cleared when that
   * node is removed or reparented. Session-only — deliberately not serialized,
   * see the keyboard-navigation design.
   */
  lastFocusedId?: NodeId;
  state?: unknown;
}

/**
 * The "do I have a parent?" capability, holding that parent's id and this
 * node's `placement` within it. Per-membership and therefore transient:
 * `moveNode` clears `placement`, so anything that must survive a move belongs
 * in `node.meta` instead.
 */
export interface MembershipCap {
  parentId: NodeId;
  /**
   * Per-membership bag of placement state. Reserved keys recognized by the
   * shipped layout strategies and React layer:
   *  - `pinned?: number` — the index in the parent's childOrder this child
   *     holds against third-party reorders. Set via `Store.setPinned`/`unpin`.
   *  - `size?: { w?: number; h?: number }` — user intent, in **pixels**;
   *     honored by `stripStrategy` along its main axis. Either
   *     dimension is optional. Gutter drags on split *clear* this key on the
   *     two affected panes.
   *  - `span?: { cols?: number; rows?: number }` — user intent, in **cell
   *     counts**; honored by grid only. Kept separate from `size` so one key
   *     doesn't mean pixels under one strategy and cells under another.
   *  Free-form keys are ignored by core; consumers may add their own.
   */
  placement: Record<string, unknown>;
  transit: TransitCap;
}

/**
 * The single shape every node in the tree takes. There is no window type and
 * no zone type: a node carries `lifecycle` plus any combination of the
 * optional `container` / `membership` / `focus` capabilities, and `kind` is a
 * free-form label the core never interprets. Zone, Group and Panel are React
 * presets over this shape, not distinct types.
 *
 * Build one with `createNode`; treat instances as immutable, since every store
 * mutation produces a fresh reference.
 */
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
