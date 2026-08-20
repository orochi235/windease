export { type ChildSort, type ChildSortEntry, defaultChildSort } from './child-sort.js';
export { type CreateNodeInput, createNode } from './constructors.js';
export { ContainerHost, type ContainerLayout } from './container-host.js';
export {
  type DragCancelReason,
  DragController,
  type DragState,
  type DropTargetOptions,
  type StrategyLookup,
} from './dnd/DragController.js';
export { childRectsForContainer, insertionIndexByMidpoint } from './dnd/insertionIndex.js';
export {
  CapabilityMissingError,
  CycleError,
  DuplicateNodeError,
  InvalidThrottlePolicyError,
  InvariantViolationError,
  LockedError,
  NodeNotFoundError,
  PinIndexError,
  StrategyRejectionError,
  WindeaseError,
  type WindeaseErrorCode,
} from './errors.js';
export { type EventMap, TypedEmitter } from './events.js';
export { Machine, type MachineDef, type MachineSubscriber } from './fsm.js';
export { HistoryController, type HistoryControllerOptions } from './history.js';
export { gridStrategy } from './layout/grid.js';
export { stripStrategy } from './layout/strip.js';
export {
  getLayoutNodes,
  nodeToLayoutItem,
  nodeToLayoutNode,
  runStrategyForContainer,
} from './layout-node-adapter.js';
export type {
  Affordance,
  BuiltinAffordanceKind,
  ItemId,
  LayoutEvent,
  LayoutItem,
  LayoutNode,
  LayoutPreview,
  LayoutResult,
  LayoutStrategy,
  Rect,
  Size,
  StrategyRegistry,
} from './layout-types.js';
export { type LockAxis, type LockSet, resolveLock, supportedAxes } from './lock.js';
export {
  createFocusMachine,
  type FocusEvent,
  type FocusState,
} from './machines/focus.js';
export {
  createLifecycleMachine,
  type LifecycleEvent,
  type LifecycleState,
} from './machines/lifecycle.js';
export {
  createTransitMachine,
  type TransitEvent,
  type TransitState,
} from './machines/transit.js';
// Node model
export {
  asNodeId,
  type ContainerCap,
  type FocusCap,
  type LifecycleCap,
  type MembershipCap,
  type Node,
  type NodeHints,
  type NodeId,
  type NodeKind,
  type TransitCap,
} from './node.js';
export { type PinnedIndexOf, placeRespectingPins } from './pinning.js';
export {
  type ObservedChild,
  reconcileChildOrder,
  reconcileContainerState,
  reconcilePinned,
  reconcilePlacement,
} from './reconcile.js';
export {
  deserialize,
  type SerializedNode,
  type SerializedStore,
  serialize,
} from './snapshot.js';
export type { SplitInput } from './split-types.js';
export { type MutateOptions, Store, type StoreEvents } from './store.js';
export {
  type Clock,
  type MachineName,
  type PendingPublish,
  type StoreOptions,
  systemClock,
  type ThrottlePendingPayload,
  type ThrottlePolicy,
  type ThrottlePublishedPayload,
  type TimerHandle,
} from './throttle.js';
export {
  configureTrace,
  isTraceEnabled,
  TRACE_CATEGORIES,
  type TraceCategory,
  trace,
} from './trace.js';

export const VERSION = '1.0.0';
