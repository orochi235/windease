import type { Size } from './layout-types.js';

/**
 * A container's pan and zoom: where its layout origin sits in the space it is
 * shown in, and how many screen pixels one layout pixel covers. A presentation
 * transform only — layout runs in layout pixels whatever the view.
 */
export interface View {
  x: number;
  y: number;
  scale: number;
}

/** Per-axis scale, for transforms a consumer applied that need not be uniform. */
export interface AxisScale {
  x: number;
  y: number;
}

export const IDENTITY_VIEW: View = Object.freeze({ x: 0, y: 0, scale: 1 }) as View;

/** How a designed viewport fits the space it is shown in. `'contain'` shows all
 *  of it; `'width'` fills the width and lets the height run over or fall short. */
export type FitMode = 'contain' | 'width';

export function isIdentityView(v: View): boolean {
  return v.x === 0 && v.y === 0 && v.scale === 1;
}

/** The scale that fits `viewport` into `available`. 1 when either is empty,
 *  so a frame that has not been measured yet shows the layout at its size. */
export function fitScale(viewport: Size, available: Size, mode: FitMode = 'contain'): number {
  if (viewport.w <= 0 || viewport.h <= 0 || available.w <= 0 || available.h <= 0) return 1;
  const sx = available.w / viewport.w;
  if (mode === 'width') return sx;
  return Math.min(sx, available.h / viewport.h);
}

/** `fitScale` plus the offset that centers the scaled viewport in `available`
 *  on each axis it does not fill. `'width'` pins the top edge instead. */
export function fitView(viewport: Size, available: Size, mode: FitMode = 'contain'): View {
  if (viewport.w <= 0 || viewport.h <= 0 || available.w <= 0 || available.h <= 0) {
    return IDENTITY_VIEW;
  }
  const scale = fitScale(viewport, available, mode);
  const x = (available.w - viewport.w * scale) / 2;
  const y = mode === 'width' ? 0 : (available.h - viewport.h * scale) / 2;
  return { x, y, scale };
}

/** A screen-pixel pointer delta in layout pixels. */
export function toLayoutDelta(
  dx: number,
  dy: number,
  scale: AxisScale,
): { dx: number; dy: number } {
  return { dx: dx / scale.x, dy: dy / scale.y };
}

/** A screen point in the layout space whose origin is at `origin` on screen. */
export function toLocalPoint(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  scale: AxisScale,
): { x: number; y: number } {
  return { x: (point.x - origin.x) / scale.x, y: (point.y - origin.y) / scale.y };
}

/**
 * Zoom `view` by `factor` about `anchor`, a point in the space the view is
 * shown in, so the layout point under the anchor stays under it — a wheel
 * zoom that keeps the cursor on what it pointed at.
 */
export function zoomView(view: View, anchor: { x: number; y: number }, factor: number): View {
  const scale = view.scale * factor;
  return {
    x: anchor.x - (anchor.x - view.x) * factor,
    y: anchor.y - (anchor.y - view.y) * factor,
    scale,
  };
}

/** The CSS transform that shows a layout box under `view`, with its origin at
 *  the box's top-left. Undefined for the identity view. */
export function viewTransform(view: View): string | undefined {
  if (isIdentityView(view)) return undefined;
  return `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}
