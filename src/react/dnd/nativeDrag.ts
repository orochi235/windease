import type { DragEvent as ReactDragEvent } from 'react';

/**
 * Refuse the browser's own drag-and-drop on a pointer-driven handle.
 *
 * WebKit starts a native drag on a plain element partway through a pointer
 * gesture and then stops delivering pointer events entirely — no further
 * `pointermove`, no `pointerup`, no `pointercancel` — so a drag freezes
 * wherever it was and the handle never learns the gesture ended.
 *
 * @internal
 */
export function preventNativeDrag(event: ReactDragEvent<HTMLElement>): void {
  event.preventDefault();
}
