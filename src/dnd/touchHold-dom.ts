let retained = 0;
let claims = 0;

function onTouchMove(e: TouchEvent): void {
  if (claims > 0 && e.cancelable) e.preventDefault();
}

/**
 * Keep a non-passive `touchmove` listener on `window` until the returned
 * function is called. A browser decides at `touchstart` whether it may scroll
 * without waiting on script, so a listener added once a hold arms comes too
 * late to stop the scroll: hold it for as long as a hold-to-drag source is
 * mounted.
 */
export function retainTouchMoveGuard(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (retained++ === 0) window.addEventListener('touchmove', onTouchMove, { passive: false });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--retained === 0) window.removeEventListener('touchmove', onTouchMove);
  };
}

/** Cancel every `touchmove` until the returned function is called, so an armed
 *  touch drag moves instead of scrolling the page. Needs a retained guard. */
export function claimTouchMoves(): () => void {
  claims++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims--;
  };
}
