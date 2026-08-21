// DnD. DragController and insertionIndex live in core; re-exported here so
// `windease/react` consumers keep the import path they had before 0.10.

export {
  type ChildSort,
  type ChildSortEntry,
  defaultChildSort,
  preserveStoreOrder,
} from '../child-sort.js';
export type { DropTargetOptions } from '../dnd/DragController.js';
export {
  type DragCancelReason,
  DragController,
  type DragState,
} from '../dnd/DragController.js';
export { childRectsForContainer, insertionIndexByMidpoint } from '../dnd/insertionIndex.js';
export {
  type AffordanceRenderArgs,
  type AffordanceRenderer,
  Container,
  type ContainerProps,
  type OverlayContext,
  type OverlayRenderer,
} from './Container.js';
export { DragHandle, type DragHandleProps } from './dnd/DragHandle.js';
export { DragContext, DragProvider, useDragController } from './dnd/DragProvider.js';
export {
  type DragOverlayContext,
  type DragOverlayRenderer,
  defaultDragOverlay,
} from './dnd/defaultDragOverlay.js';
export { type DragHandleHandlers, useDragHandle } from './dnd/useDragHandle.js';
export { useDragState } from './dnd/useDragState.js';
export { useDropTarget } from './dnd/useDropTarget.js';
// Keyboard focus and navigation
export { FocusProvider, useFocusBinding } from './focus/FocusProvider.js';
export {
  GeometryProvider,
  useGeometryRegistry,
  useGeometrySource,
} from './focus/useGeometrySource.js';
export {
  useActivity,
  useChildren,
  useFocusedNode,
  useNode,
  useNodeSelector,
  useRootNodes,
} from './hooks.js';
export {
  LayoutContext,
  type LayoutInfo,
  LayoutScope,
  type Rect,
  useLayoutContext,
  useLayoutForSelf,
} from './LayoutContext.js';
export {
  type Chrome,
  type ChromeArgs,
  type ChromeHandler,
  type ChromeMap,
  NodeRenderer,
  type NodeRendererProps,
  Root,
  type RootProps,
} from './NodeRenderer.js';
// Declarative tree binding
export { ParentContext, ParentScope, useParentId } from './ParentContext.js';
export { Context, Provider, useStore } from './Provider.js';
export type { PanelProps, ZoneProps } from './presets.js';
// Preset components
export { Panel, Zone } from './presets.js';
// Strategy + layout
export {
  type StrategyRegistry,
  StrategyRegistryProvider,
  type StrategyRegistryProviderProps,
  useStrategyRegistry,
} from './strategies.js';
export { type ContainerLayout, useContainerLayout } from './useContainerLayout.js';
