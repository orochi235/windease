export { WindeaseProvider, WindeaseContext } from './WindeaseProvider.js';
export { Zone } from './Zone.js';
export { Workspace } from './Workspace.js';
export { useWindease, useWindow, useZone, useWindowsByZone, useItemMeta } from './hooks.js';

// v0.2 node model surface
export {
  WindeaseNodeProvider,
  WindeaseNodeContext,
  useNodeStore,
  useNode,
  useNodeSelector,
  useChildren,
  useFocusedNode,
  useRootNodes,
  NodeRenderer,
  WindeaseNodeRoot,
  type ChromeArgs,
  type ChromeHandler,
  type ChromeMap,
  type NodeRendererProps,
  type WindeaseNodeRootProps,
  // DnD
  NodeDragController,
  type DragState,
  type DragCancelReason,
  NodeDragProvider,
  NodeDragContext,
  useNodeDragController,
  useNodeDragHandle,
  type NodeDragHandleHandlers,
  NodeDragHandle,
  type NodeDragHandleProps,
  useNodeDropTarget,
  useNodeDragState,
  // Strategy + layout
  StrategyRegistryProvider,
  useStrategyRegistry,
  type StrategyRegistry,
  type StrategyRegistryProviderProps,
  useContainerLayout,
  type ContainerLayout,
  NodeContainer,
  type NodeContainerProps,
} from './v2/index.js';
