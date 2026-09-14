import { useEffect, useRef } from 'react';
import type { Run } from '../core/types.js';

/** Canvas resolution. CSS scales the element to its tile and keeps this shape. */
const CANVAS_W = 480;
const CANVAS_H = 360;
const PAD = 8;

/** The world-space box a canvas is scaled to fit. */
export interface Extent {
  w: number;
  h: number;
}

/** The box that holds every run: its packing and the width its packer was given. */
export function extentOf(runs: readonly Run[]): Extent {
  let w = 1;
  let h = 1;
  for (const run of runs) {
    w = Math.max(w, run.bounds.w, run.width);
    h = Math.max(h, run.bounds.h);
  }
  return { w, h };
}

export function drawRun(
  ctx: CanvasRenderingContext2D,
  run: Run,
  w: number,
  h: number,
  extent: Extent,
): void {
  ctx.clearRect(0, 0, w, h);
  const scale = Math.min((w - PAD * 2) / extent.w, (h - PAD * 2) / extent.h);
  const indexOf = new Map(run.dataset.items.map((item, i) => [item.id, i]));
  ctx.save();
  ctx.translate(PAD, PAD);
  ctx.scale(scale, scale);
  ctx.lineWidth = 1 / scale;
  for (const [id, r] of run.placements) {
    const hue = ((indexOf.get(id) ?? 0) * 47) % 360;
    ctx.fillStyle = `hsl(${hue} 55% 60% / 0.55)`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = `hsl(${hue} 55% 35%)`;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  // The width the packer was given, which the boxes should stay left of.
  ctx.strokeStyle = '#888';
  ctx.setLineDash([4 / scale, 4 / scale]);
  ctx.beginPath();
  ctx.moveTo(run.width, 0);
  ctx.lineTo(run.width, extent.h);
  ctx.stroke();
  ctx.restore();
}

export function PackView({ run, extent }: { run: Run; extent: Extent }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    drawRun(ctx, run, canvas.width, canvas.height, extent);
  }, [run, extent]);
  return (
    <figure className="pl-view">
      <canvas
        ref={ref}
        className="pl-view__canvas"
        width={CANVAS_W}
        height={CANVAS_H}
        role="img"
        aria-label={`${run.dataset.label} packed by ${run.packer.id}, ${run.bounds.w.toFixed(1)} × ${run.bounds.h.toFixed(1)}`}
      />
      <figcaption className="pl-view__caption">
        {run.dataset.label} · {run.packer.id}
      </figcaption>
    </figure>
  );
}
