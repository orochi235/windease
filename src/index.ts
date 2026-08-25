export {
  type ChildSort,
  type ChildSortEntry,
  defaultChildSort,
  preserveStoreOrder,
} from './child-sort.js';
export { type CreateNodeInput, createNode } from './constructors.js';
export {
  ContainerHost,
  type ContainerLayout,
  type PlacementChange,
  type PlacementCommit,
} from './container-host.js';
export {
  type ChildOrderChange,
  type ChildOrderCommit,
  type DragCancelReason,
  DragController,
  type DragState,
  type DropTargetOptions,
  type StrategyLookup,
} from './dnd/DragController.js';
export {
  DragEngine,
  type DragEngineOptions,
  type DropTarget,
  type FrameScheduler,
  type Point,
} from './dnd/DragEngine.js';
export {
  type DropIntent,
  type DropIntentOptions,
  resolveDropIntent,
} from './dnd/dropIntent.js';
export { type EdgeScrollOptions, edgeScrollDelta } from './dnd/edgeScroll.js';
export {
  axisFromRects,
  childRectsForContainer,
  insertionIndexByMidpoint,
} from './dnd/insertionIndex.js';
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
export { bindAnnouncer } from './focus/announcer.js';
export { accessibleName } from './focus/name.js';
export { navigableLeaves } from './focus/navigable.js';
export { nullFocusAdapter } from './focus/nullAdapter.js';
export { type ResolveInput, resolveNavigation } from './focus/resolve.js';
export { chooseSuccessor } from './focus/successor.js';
export type { FocusAdapter, GeometrySource, NavDirection, NavIntent } from './focus/types.js';
export { Machine, type MachineDef, type MachineSubscriber } from './fsm.js';
export { HistoryController, type HistoryControllerOptions } from './history.js';
export {
  type ConfigFieldSpec,
  type ConfigSpec,
  checkStrategyConfig,
} from './layout/config-check.js';
export {
  type Corner,
  DEFAULT_ANCHOR,
  DEFAULT_INSET,
  DEFAULT_SNAP_THRESHOLD,
  FLOATING_CORNERS,
  FLOATING_DRAG_PREFIX,
  type FloatingConfig,
  type FloatingPlacement,
  type FloatingState,
  floatingStrategy,
} from './layout/floating.js';
export { gridStrategy } from './layout/grid.js';
export {
  DEFAULT_JOIN_THRESHOLD,
  type JoinState,
  type TrackJoinInput,
  trackJoin,
} from './layout/seam-join.js';
export { stackStrategy } from './layout/stack.js';
export { stripStrategy } from './layout/strip.js';
export {
  getLayoutNodes,
  nodeToLayoutItem,
  nodeToLayoutNode,
  runStrategyForContainer,
} from './layout-node-adapter.js';
export type {
  Affordance,
  AffordanceJoin,
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
  StatefulLayoutStrategy,
  StrategyRegistry,
} from './layout-types.js';
export {
  destroyBlockedBy,
  type LockAxis,
  type LockSet,
  resolveLock,
  supportedAxes,
} from './lock.js';
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
export { applyMove, type MovePlan, type ResolveMoveInput, resolveMove } from './move.js';
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
export { observePixelRatio } from './pixel-ratio.js';
export {
  type ObservedChild,
  reconcileChildOrder,
  reconcileContainerConfig,
  reconcileContainerState,
  reconcileHints,
  reconcilePinned,
  reconcilePlacement,
} from './reconcile.js';
export {
  deserialize,
  type GraftOptions,
  graft,
  type SerializedNode,
  type SerializedStore,
  type SerializeOptions,
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

export const VERSION = '1.2.1';
