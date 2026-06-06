import { useSyncExternalStore } from 'react';
import { type DragState, NodeDragController } from './NodeDragController.js';
import { useNodeDragController } from './NodeDragProvider.js';

export function useNodeDragState(): DragState | null {
  const controller = useNodeDragController();
  return useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.state(),
  );
}

export type { DragState } from './NodeDragController.js';
export { NodeDragController };
