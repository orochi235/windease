import { useSyncExternalStore } from 'react';
import { type DragState, DragController } from './DragController.js';
import { useDragController } from './DragProvider.js';

/** @group Hooks */
export function useDragState(): DragState | null {
  const controller = useDragController();
  return useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.state(),
  );
}

export type { DragState } from './DragController.js';
export { DragController };
