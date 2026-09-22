import type { Size } from '../layout-types';

/** Degrees to radians. */
const RAD = Math.PI / 180;

/**
 * The axis-aligned box a `w`×`h` child needs once it is rotated `deg` about its
 * own center — what a strategy reserves for a turned child so its siblings flow
 * around the turn rather than through it.
 *
 * Tight at every angle, so a turn animating 0 → 90 grows its footprint as it
 * goes and the row makes room for it continuously.
 *
 * @group Layout
 */
export function turnedExtent(w: number, h: number, deg: number): Size {
  if (!Number.isFinite(deg) || deg % 180 === 0) return { w, h };
  const r = deg * RAD;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return { w: w * cos + h * sin, h: w * sin + h * cos };
}

/** Whether `deg` turns a child at all. A child at 0° or 180° occupies its own
 *  box, so it needs no reserved extent and no `turn` on its rect. */
export function turns(deg: number | undefined): deg is number {
  return deg !== undefined && Number.isFinite(deg) && deg % 360 !== 0;
}
