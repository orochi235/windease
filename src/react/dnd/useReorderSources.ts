import {
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';
import { readReorderConfig } from '../../container-config.js';
import type { NodeId } from '../../index.js';
import { trace } from '../../index.js';
import { useStore } from '../Provider.js';
import { DragContext, DragThresholdContext } from './DragProvider.js';
import { preventNativeDrag } from './nativeDrag.js';
import { trackPress } from './pointerDrag.js';

/** What a child's wrapper spreads to become a `reorder` drag source. */
export interface ReorderSourceProps {
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  draggable?: false;
  onDragStart?: (e: DragEvent<HTMLElement>) => void;
  'data-windease-reorder'?: 'true' | 'handle';
}

const NONE: ReorderSourceProps = {};

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Whether `target`'s nearest element matching `selector` sits inside `wrapper`. */
function within(target: Element, selector: string, wrapper: Element): boolean {
  const hit = target.closest(selector);
  return hit !== null && wrapper.contains(hit);
}

/**
 * The props that make each child of `parentId` a drag source when its config
 * declares `reorder`. Returns a per-child builder so `<Container>`, which
 * renders every child's wrapper in one component, and a preset shell, which
 * renders its own, share one reading of the config.
 */
export function useReorderSources(
  parentId: NodeId | undefined,
): (childId: NodeId) => ReorderSourceProps {
  const store = useStore();
  const controller = useContext(DragContext);
  const threshold = useContext(DragThresholdContext);
  const mode = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () =>
      parentId === undefined
        ? undefined
        : readReorderConfig(store.getNode(parentId)?.container?.config),
  );

  useEffect(() => {
    if (mode && !controller) {
      trace('dnd', `reorder: ${parentId} declares reorder=${mode} but no DragProvider — inert`);
    }
  }, [mode, controller, parentId]);

  const onPress = useCallback(
    (childId: NodeId) => (e: ReactPointerEvent<HTMLElement>) => {
      if (!controller || e.button > 0) return;
      const wrapper = e.currentTarget;
      const target = e.target;
      if (!(target instanceof Element)) return;
      // A nested source's wrapper is the one the press belongs to.
      if (target.closest('[data-windease-reorder]') !== wrapper) return;
      if (within(target, '[data-affordance], [data-affordance-hit]', wrapper)) return;
      if (within(target, '[data-windease-drag-handle]', wrapper)) return;
      if (within(target, EDITABLE, wrapper)) return;
      if (mode === 'handle' && !within(target, '[data-windease-handle]', wrapper)) return;
      trace('dnd', `pointerDown on reorder child ${childId} at (${e.clientX},${e.clientY})`);
      trackPress(controller, childId, e, threshold);
    },
    [controller, threshold, mode],
  );

  return useCallback(
    (childId: NodeId) =>
      mode && controller
        ? {
            onPointerDown: onPress(childId),
            draggable: false,
            onDragStart: preventNativeDrag,
            'data-windease-reorder': mode === true ? 'true' : 'handle',
          }
        : NONE,
    [mode, controller, onPress],
  );
}
