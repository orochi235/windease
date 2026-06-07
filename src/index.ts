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

// Node model
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
  type CreateZoneInput,
  type CreateGroupInput,
  type CreatePanelInput,
} from './constructors.js';
export {
  NodeNotFoundError,
  DuplicateNodeError,
  CapabilityMissingError,
  CycleError,
  StrategyRejectionError,
  InvariantViolationError,
} from './errors.js';
export { WindeaseStore, type StoreEvents } from './store.js';
export {
  serialize,
  deserialize,
  type SerializedNode,
  type SerializedStore,
} from './snapshot.js';
export type { LayoutNode } from './layout-types.js';
export {
  nodeToLayoutItem,
  nodeToLayoutNode,
  getLayoutNodes,
  runStrategyForContainer,
} from './layout-node-adapter.js';

export const VERSION = '0.3.0';
