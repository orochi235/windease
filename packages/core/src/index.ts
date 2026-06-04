export { Machine, type MachineDef, type MachineSubscriber } from './fsm.js';
export {
  createLifecycleMachine,
  type LifecycleState,
  type LifecycleEvent,
} from './machines/lifecycle.js';
export {
  createTransitMachine,
  type TransitState,
  type TransitEvent,
} from './machines/transit.js';
export {
  createFocusMachine,
  type FocusState,
  type FocusEvent,
} from './machines/focus.js';
export { WindeaseError, type WindeaseErrorCode } from './errors.js';
export { TypedEmitter, type EventMap } from './events.js';
export {
  asWindowId,
  asZoneId,
  createWindowRecord,
  type WindowId,
  type ZoneId,
  type WindowRecord,
  type WindowHints,
  type CreateWindowInput,
} from './window.js';
export {
  createZoneRecord,
  type ZoneRecord,
  type CreateZoneInput,
  type Placement,
} from './zone.js';
export type {
  ItemId,
  Rect,
  Size,
  LayoutItem,
  LayoutResult,
  LayoutEvent,
  LayoutStrategy,
  Affordance,
  BuiltinAffordanceKind,
} from './layout-types.js';
export { WindeaseStore, type StoreEvents } from './store.js';
export {
  serialize,
  deserialize,
  type SerializedStore,
  type SerializedWindow,
  type SerializedZone,
} from './snapshot.js';
export { gridStrategy } from './layout/grid.js';
export { stackStrategy } from './layout/stack.js';
export { stripStrategy } from './layout/strip.js';
export { binarySplit, type BinarySplitState, type BinarySplitMeta } from './layout/binarySplit.js';
export { recursiveSplit, type SplitNode, type RecursiveSplitMeta } from './layout/recursiveSplit.js';

export const VERSION = '0.2.0';
