import { expect, type Locator, type Page } from '@playwright/test';

/** Ladle serves each story at `?story=<id>`; ids come from `/meta.json`. */
export async function openStory(page: Page, storyId: string): Promise<void> {
  await page.goto(`/?story=${storyId}`, { waitUntil: 'networkidle' });
  // The first layout pass needs a ResizeObserver callback, which lands after
  // paint — waiting on a placed node is what tells us it has run.
  await expect(page.locator('[data-node]').first()).toBeVisible();
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
