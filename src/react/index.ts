export { WindeaseProvider, WindeaseContext, useStore } from './WindeaseProvider.js';
export {
  useNode,
  useNodeSelector,
  useChildren,
  useFocusedNode,
  useRootNodes,
  useActivity,
} from './hooks.js';
export {
  NodeRenderer,
  WindeaseRoot,
  type Chrome,
  type ChromeArgs,
  type ChromeHandler,
  type ChromeMap,
  type NodeRendererProps,
  type WindeaseRootProps,
} from './NodeRenderer.js';

// Preset components
export { Panel, Group, Zone } from './presets.js';

// DnD
export {
  DragController,
  type DragState,
  type DragCancelReason,
} from './dnd/DragController.js';
export { DragProvider, DragContext, useDragController } from './dnd/DragProvider.js';
export { useDragHandle, type DragHandleHandlers } from './dnd/useDragHandle.js';
export { DragHandle, type DragHandleProps } from './dnd/DragHandle.js';
export { useDropTarget } from './dnd/useDropTarget.js';
export { useDragState } from './dnd/useDragState.js';

// Strategy + layout
export {
  StrategyRegistryProvider,
  useStrategyRegistry,
  type StrategyRegistry,
  type StrategyRegistryProviderProps,
} from './strategies.js';
export { useContainerLayout, type ContainerLayout } from './useContainerLayout.js';
export {
  Container,
  type ContainerProps,
  type OverlayContext,
  type OverlayRenderer,
  type AffordanceRenderArgs,
  type AffordanceRenderer,
} from './Container.js';
