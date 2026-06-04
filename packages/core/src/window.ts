import type { Machine } from './fsm.js';
import type { FocusEvent, FocusState } from './machines/focus.js';
import { createFocusMachine } from './machines/focus.js';
import type { LifecycleEvent, LifecycleState } from './machines/lifecycle.js';
import { createLifecycleMachine } from './machines/lifecycle.js';
import type { TransitEvent, TransitState } from './machines/transit.js';
import { createTransitMachine } from './machines/transit.js';

export type WindowId = string & { readonly __brand: 'WindowId' };
export type ZoneId = string & { readonly __brand: 'ZoneId' };

export const asWindowId = (s: string): WindowId => s as WindowId;
export const asZoneId = (s: string): ZoneId => s as ZoneId;

export interface WindowHints {
  minSize?: { w: number; h: number };
  preferredSize?: { w: number; h: number };
  order?: number;
}

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
