export { Provider, Context, useStore } from './Provider.js';
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
  Root,
  type Chrome,
  type ChromeArgs,
  type ChromeHandler,
  type ChromeMap,
  type NodeRendererProps,
  type RootProps,
} from './NodeRenderer.js';

// Preset components
export { Panel, Group, Zone } from './presets.js';
export type { PanelProps, GroupProps, ZoneProps } from './presets.js';

// Declarative tree binding
export { ParentContext, ParentScope, useParentId } from './ParentContext.js';
export { defaultChildSort, type ChildSort, type ChildSortEntry } from './childSort.js';
export {
  LayoutContext,
  LayoutScope,
  useLayoutContext,
  useLayoutForSelf,
  type LayoutInfo,
  type Rect,
} from './LayoutContext.js';

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
export {
  defaultDragOverlay,
  type DragOverlayRenderer,
  type DragOverlayContext,
} from './dnd/defaultDragOverlay.js';
export type { DropTargetOptions } from './dnd/DragController.js';
export { insertionIndexByMidpoint, childRectsForContainer } from './dnd/insertionIndex.js';

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
