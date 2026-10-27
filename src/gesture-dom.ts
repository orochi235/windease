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
