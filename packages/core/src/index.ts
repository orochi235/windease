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
  type ZoneItemMeta,
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
export { HistoryController, type HistoryControllerOptions } from './history.js';
export {
  configureTrace,
  isTraceEnabled,
  trace,
  TRACE_CATEGORIES,
  type TraceCategory,
} from './trace.js';

// v0.2 unified node model — additive in Phase 1; not yet wired into store/snapshot.
export {
  asNodeId,
  type Node,
  type NodeId,
  type NodeKind,
  type NodeHints,
  type ContainerCap,
  type SlotCap,
  type FocusCap,
  type LifecycleCap,
  type TransitCap,
} from './node.js';
export {
  createZone,
  createGroup,
  createPanel,
  // CreateZoneInput collides with v0.1's existing export; re-export under
  // disambiguated names. The internal constructor file keeps the spec names.
  type CreateZoneInput as CreateZoneNodeInput,
  type CreateGroupInput,
  type CreatePanelInput,
} from './constructors.js';
export { validateKindShape } from './validators.js';
export {
  NodeNotFoundError,
  DuplicateNodeError,
  KindShapeError,
  CapabilityMissingError,
  CycleError,
  StrategyRejectionError,
  InvariantViolationError,
} from './errors.js';
export { WindeaseNodeStore, type NodeStoreEvents } from './store-v2.js';

export const VERSION = '0.3.0';
