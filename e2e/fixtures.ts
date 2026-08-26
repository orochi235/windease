import { expect, type Locator, type Page } from '@playwright/test';

/** Ladle serves each story at `?story=<id>`; ids come from `/meta.json`. */
export async function openStory(page: Page, storyId: string): Promise<void> {
  await page.goto(`/?story=${storyId}`);
  // The first layout pass needs a ResizeObserver callback, which lands after
  // paint — waiting on a placed node is what tells us it has run, and is why
  // `goto` needs no readiness option of its own.
  //
  // 30s rather than the 5s default: the first open in a browser process pays
  // for a cold start and a cold Vite transform, which under machine load
  // measured 6.2s on Firefox against 2.8s on Chromium — the whole of this
  // suite's flake history. Every real assertion in these specs keeps the
  // default budget; this is a precondition, not a claim about the library.
  await expect(page.locator('[data-node]').first()).toBeVisible({ timeout: 30_000 });
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function boxOf(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box');
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

/**
 * Press at `from`, move to `to` in steps, release. Stepping matters: a single
 * jump produces one pointermove, which cannot exercise the incremental dx/dy
 * accumulation a real drag depends on.
 */
export async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export function centerOf(b: Box): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * The whole box once it holds steady across `holds` consecutive reads. Panes
 * animate between placements (`settleMs`, 150ms by default), so a box read the
 * instant a gesture changes the layout is a frame of that animation rather
 * than the layout — which reads as "the preview did nothing".
 */
export async function settledBox(locator: Locator, holds = 3): Promise<Box> {
  let last = '';
  let streak = 0;
  let box: Box | null = null;
  for (let i = 0; i < 60; i++) {
    const b = await locator.boundingBox();
    const key = b ? [b.x, b.y, b.width, b.height].map(Math.round).join(',') : '';
    if (b) box = { x: b.x, y: b.y, w: b.width, h: b.height };
    streak = key === last && key !== '' ? streak + 1 : 0;
    if (streak >= holds - 1 && box) return box;
    last = key;
    await locator.page().waitForTimeout(40);
  }
  throw new Error(`box never settled (last ${last})`);
}

/**
 * Width once it holds steady across `holds` consecutive reads. A single
 * repeat is not enough: on first paint each container measures itself only
 * when its own ResizeObserver reports, so a parent can sit at a stale width
 * for a beat before a sibling's measurement pushes it to its final value.
 */
export async function settledWidth(locator: Locator, holds = 4): Promise<number> {
  let last = Number.NaN;
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const b = await locator.boundingBox();
    const w = b ? Math.round(b.width) : Number.NaN;
    streak = w === last && !Number.isNaN(w) ? streak + 1 : 0;
    if (streak >= holds - 1) return w;
    last = w;
    await locator.page().waitForTimeout(60);
  }
  throw new Error(`width never settled (last ${last})`);
}
