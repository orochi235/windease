import type { Machine } from './fsm.js';
import type { FocusEvent, FocusState } from './machines/focus.js';
import { createFocusMachine } from './machines/focus.js';
import type { LifecycleEvent, LifecycleState } from './machines/lifecycle.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import type { TransitEvent, TransitState } from './machines/transit.js';
import { createTransitMachine } from './machines/transit.js';

/** @deprecated v0.1 type — use `NodeId` from the v0.2 node model. */
export type WindowId = string & { readonly __brand: 'WindowId' };
/** @deprecated v0.1 type — use `NodeId` from the v0.2 node model. */
export type ZoneId = string & { readonly __brand: 'ZoneId' };

/** @deprecated v0.1 — use `asNodeId` from the v0.2 node model. */
export const asWindowId = (s: string): WindowId => s as WindowId;
/** @deprecated v0.1 — use `asNodeId` from the v0.2 node model. */
export const asZoneId = (s: string): ZoneId => s as ZoneId;

export interface WindowHints {
  minSize?: { w: number; h: number };
  preferredSize?: { w: number; h: number };
  order?: number;
}

/** @deprecated v0.1 record — use the v0.2 `Node` type with constructors. */
export interface WindowRecord {
  id: WindowId;
  kind: string;
  zoneId: ZoneId | null;
  lifecycle: Machine<LifecycleState, LifecycleEvent>;
  transit: Machine<TransitState, TransitEvent>;
  focus: Machine<FocusState, FocusEvent>;
  hints: WindowHints;
  meta: Record<string, unknown>;
}

export interface CreateWindowInput {
  id: WindowId;
  kind: string;
  hints?: WindowHints;
  meta?: Record<string, unknown>;
}

/** @deprecated v0.1 — use `createPanel` from the v0.2 node model. */
export function createWindowRecord(input: CreateWindowInput): WindowRecord {
  return {
    id: input.id,
    kind: input.kind,
    zoneId: null,
    lifecycle: createLifecycleMachine(),
    transit: createTransitMachine(),
    focus: createFocusMachine(),
    hints: input.hints ?? {},
    meta: input.meta ?? {},
  };
}
