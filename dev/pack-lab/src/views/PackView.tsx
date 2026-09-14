import { useEffect, useRef } from 'react';
import type { Run } from '../core/types.js';

/** Canvas resolution. CSS scales the element to its tile and keeps this shape. */
const CANVAS_W = 480;
const CANVAS_H = 360;
const PAD = 8;

export function drawRun(ctx: CanvasRenderingContext2D, run: Run, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const extentW = Math.max(run.bounds.w, run.width, 1);
  const extentH = Math.max(run.bounds.h, 1);
  const scale = Math.min((w - PAD * 2) / extentW, (h - PAD * 2) / extentH);
  ctx.save();
  ctx.translate(PAD, PAD);
  ctx.scale(scale, scale);
  ctx.lineWidth = 1 / scale;
  let i = 0;
  for (const r of run.placements.values()) {
    const hue = (i * 47) % 360;
    ctx.fillStyle = `hsl(${hue} 55% 60% / 0.55)`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = `hsl(${hue} 55% 35%)`;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    i++;
  }
  // The width the packer was given, which the boxes should stay left of.
  ctx.strokeStyle = '#888';
  ctx.setLineDash([4 / scale, 4 / scale]);
  ctx.beginPath();
  ctx.moveTo(run.width, 0);
  ctx.lineTo(run.width, extentH);
  ctx.stroke();
  ctx.restore();
}

export function PackView({ run }: { run: Run }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    drawRun(ctx, run, canvas.width, canvas.height);
  }, [run]);
  return (
    <figure className="pl-view">
      <canvas ref={ref} className="pl-view__canvas" width={CANVAS_W} height={CANVAS_H} />
      <figcaption className="pl-view__caption">
        {run.dataset.label} · {run.packer.id}
      </figcaption>
    </figure>
  );
}
