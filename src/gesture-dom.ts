import { trace } from './trace.js';

/**
 * Cancel a gesture when Escape is pressed anywhere in the window, until the
 * returned function is called. Bound only while a pointer gesture is in
 * flight: the pressed element may not hold focus, so its own key handler
 * would never see the key.
 */
export function cancelOnEscape(cancel: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cancel();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

export interface ReleaseHandlers {
  up(e: PointerEvent): void;
  cancel(e: PointerEvent): void;
}

/**
 * Read one pointer's release and cancel off the window until the returned
 * function is called, so a lost pointer capture cannot strand a gesture.
 * Either side not naming a pointer counts as a match; any other pointer's
 * events are ignored.
 */
export function watchRelease(
  pointerId: number | undefined,
  on: ReleaseHandlers,
  options?: { capture?: boolean },
): () => void {
  if (typeof window === 'undefined') return () => {};
  const capture = options?.capture ?? false;
  const ours = (e: PointerEvent) => {
    const id = e.pointerId;
    if (pointerId === undefined || id === undefined || id === pointerId) return true;
    trace('dnd', `window ${e.type} from pointer ${id} ignored (watching pointer ${pointerId})`);
    return false;
  };
  const onUp = (e: PointerEvent) => {
    if (ours(e)) on.up(e);
  };
  const onCancel = (e: PointerEvent) => {
    if (ours(e)) on.cancel(e);
  };
  window.addEventListener('pointerup', onUp, capture);
  window.addEventListener('pointercancel', onCancel, capture);
  return () => {
    window.removeEventListener('pointerup', onUp, capture);
    window.removeEventListener('pointercancel', onCancel, capture);
  };
}
