import { useSyncExternalStore } from 'react';
import { DragController, type DragState } from '../../dnd/DragController.js';
import { useDragController } from './DragProvider.js';

/**
 * The drag in progress, or `null` when nothing is being dragged. Re-renders on
 * every hover sample, so keep the subscribing component small.
 * @group Hooks
 */
export function useDragState(): DragState | null {
  const controller = useDragController();
  return useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.state(),
  );
}

export type { DragState } from '../../dnd/DragController.js';
export { DragController };
