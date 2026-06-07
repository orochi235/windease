import type { Machine } from './fsm.js';
import type { FocusEvent, FocusState } from './machines/focus.js';
import type { LifecycleEvent, LifecycleState } from './machines/lifecycle.js';
import type { TransitEvent, TransitState } from './machines/transit.js';

export type NodeId = string & { readonly __brand: 'NodeId' };

export const asNodeId = (s: string): NodeId => s as NodeId;

export type NodeKind = 'panel' | 'group' | 'zone';

export interface NodeHints {
  minSize?: { w: number; h: number };
  preferredSize?: { w: number; h: number };
  order?: number;
}

export type LifecycleCap = Machine<LifecycleState, LifecycleEvent>;
export type TransitCap = Machine<TransitState, TransitEvent>;
export type FocusCap = Machine<FocusState, FocusEvent>;

export interface ContainerCap {
  strategyId: string;
  config: unknown;
  childIds: NodeId[];
  allowsPinning: boolean;
  /** When false, this container rejects all DnD drops. Default true. */
  allowsDrop: boolean;
  /** When false, this container suppresses drag handles on all its children
   *  (in addition to per-child `slot.placement.locked`). Default true. */
  allowsDragOut: boolean;
  state?: unknown;
}

export interface SlotCap {
  parentId: NodeId;
  placement: Record<string, unknown>;
  transit: TransitCap;
}

export interface Node {
  id: NodeId;
  kind: NodeKind;
  meta?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  hints?: NodeHints;
  lifecycle: LifecycleCap;

  container?: ContainerCap;
  slot?: SlotCap;
  focus?: FocusCap;
}
