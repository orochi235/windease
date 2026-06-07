/**
 * jsdom's PointerEvent constructor drops clientX/clientY (and pointerId in some
 * versions). This helper dispatches a MouseEvent with the missing fields patched
 * on, which @testing-library/react's fireEvent can't easily produce.
 *
 * Test-only — never imported by production code.
 */
export function firePointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { clientX: number; clientY: number; pointerId?: number },
): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1, configurable: true });
  Object.defineProperty(event, 'clientX', { value: init.clientX, configurable: true });
  Object.defineProperty(event, 'clientY', { value: init.clientY, configurable: true });
  target.dispatchEvent(event);
}

/** Shim Element.prototype with no-op pointer-capture methods for jsdom. */
export function installPointerCaptureShim(): void {
  const proto = Element.prototype as unknown as {
    setPointerCapture: (id: number) => void;
    releasePointerCapture: (id: number) => void;
    hasPointerCapture: (id: number) => boolean;
  };
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  proto.hasPointerCapture = () => true;
}
