import { type AxisScale, type FitMode, fitView, type View } from './view.js';

const UNSCALED: AxisScale = Object.freeze({ x: 1, y: 1 }) as AxisScale;

/**
 * How many screen pixels one of `el`'s own CSS pixels covers, per axis: every
 * transform between it and the page, composed — a view's scale, a nested
 * view's inside it, or one the consumer applied. 1 where it cannot tell (an
 * element with no layout box, or jsdom, which lays nothing out).
 *
 * Divide a pointer delta taken against `el` by this to get `el`'s own pixels.
 */
export function elementScale(el: Element): AxisScale {
  const box = el as HTMLElement;
  const ow = box.offsetWidth;
  const oh = box.offsetHeight;
  if (!(ow > 0) && !(oh > 0)) return UNSCALED;
  const r = el.getBoundingClientRect();
  const x = ow > 0 && r.width > 0 ? r.width / ow : 1;
  const y = oh > 0 && r.height > 0 ? r.height / oh : 1;
  return x === 1 && y === 1 ? UNSCALED : { x, y };
}

/**
 * Measure `frame` and report the view that fits `viewport` into it, now and on
 * every resize. Returns a teardown. The DOM convenience over `fitView`.
 *
 * `frame` is the element the view is shown in, not the scaled box: the box is
 * sized to `viewport` whatever the frame does, so measuring it would report the
 * size just asked for.
 */
export function observeFit(
  frame: Element,
  viewport: { w: number; h: number },
  mode: FitMode,
  onView: (view: View) => void,
): () => void {
  const report = (w: number, h: number) => onView(fitView(viewport, { w, h }, mode));
  const box = frame as HTMLElement;
  report(box.clientWidth ?? 0, box.clientHeight ?? 0);
  if (typeof ResizeObserver === 'undefined') return () => {};
  const ro = new ResizeObserver((entries) => {
    const r = entries[0]?.contentRect;
    if (r) report(r.width, r.height);
  });
  ro.observe(frame);
  return () => ro.disconnect();
}
