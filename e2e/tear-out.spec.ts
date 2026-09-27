import { expect, type Page, test } from '@playwright/test';
import { type Box, boxOf, centerOf, dropAt, openStory, settledBox } from './fixtures.js';

/**
 * Tear-out is a drop outside the stack onto its floating ancestor, and the
 * torn tab lands where the cursor lets go — geometry jsdom does not have.
 */

const STORY = 'tear-out--tear-out';

const floating = (page: Page) => page.getByTestId('to-floating');
const docked = (page: Page) => page.getByTestId('to-docked');

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up();
}

/** How far `id`'s box is from `want` on the worst of the edges `want` names. */
async function drift(page: Page, id: string, want: Partial<Box>): Promise<number> {
  const box = await boxOf(page.getByTestId(id));
  const keys = Object.keys(want) as (keyof Box)[];
  return Math.max(...keys.map((k) => Math.abs(box[k] - (want[k] ?? 0))));
}

/** The story with the stack's `tearSize` set to 240x200. */
async function openFixed(page: Page) {
  await page.goto(`/?story=${STORY}&arg-size=fixed`);
  await expect(page.locator('[data-node]').first()).toBeVisible({ timeout: 30_000 });
}

/** Tear `id` out of the stack and let go at `frac` of the canvas's box. */
async function tearOut(page: Page, id: string, frac = { x: 0.3, y: 0.3 }) {
  const canvas = await settledBox(page.getByTestId('canvas'));
  const to = dropAt({ x: canvas.x + canvas.w * frac.x, y: canvas.y + canvas.h * frac.y });
  await drag(page, centerOf(await settledBox(page.getByTestId(`tab-${id}`))), to);
  return to;
}

test.describe('tear-out', () => {
  test('a tab dragged onto the canvas floats with its corner at the drop point', async ({
    page,
  }) => {
    await openStory(page, STORY);
    await expect(docked(page)).toHaveText('layers channels paths');
    const stack = await settledBox(page.locator('[data-node-container="panels"]'));

    // Near the top: a body-sized panel is nearly as tall as the canvas, and
    // any lower the strategy clamps it back inside.
    const to = await tearOut(page, 'channels', { x: 0.3, y: 0.02 });

    await expect(floating(page)).toHaveText('channels');
    await expect(docked(page)).toHaveText('layers paths');
    // The tab body's size: the stack's box less its 30px strip.
    const want = { x: to.x, y: to.y, w: stack.w, h: stack.h - 30 };
    await expect.poll(() => drift(page, 'palette-channels', want)).toBeLessThan(0.5);
  });

  test('a tearSize in the stack config sizes the torn tab', async ({ page }) => {
    await openFixed(page);

    const to = await tearOut(page, 'layers');

    const want = { x: to.x, y: to.y, w: 240, h: 200 };
    await expect.poll(() => drift(page, 'palette-layers', want)).toBeLessThan(0.5);
  });

  test('a floating tab dragged onto the tab strip docks there as the shown tab', async ({
    page,
  }) => {
    await openStory(page, STORY);
    await tearOut(page, 'layers', { x: 0.2, y: 0.5 });
    await expect(floating(page)).toHaveText('layers');

    // Onto the strip, just left of the middle of the last tab.
    const paths = await settledBox(page.getByTestId('tab-paths'));
    const to = { x: paths.x + paths.w * 0.25, y: paths.y + paths.h / 2 };
    await drag(page, centerOf(await settledBox(page.getByTestId('chip-layers'))), to);

    await expect(floating(page)).toHaveText('');
    await expect(docked(page)).toHaveText('channels layers paths');
    await expect(page.getByTestId('tab-layers')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('page-layers')).toBeVisible();
  });

  test('a drag that stays in the strip reorders instead of tearing', async ({ page }) => {
    await openStory(page, STORY);
    const paths = await settledBox(page.getByTestId('tab-paths'));
    await drag(page, centerOf(await settledBox(page.getByTestId('tab-layers'))), {
      x: paths.x + paths.w * 0.9,
      y: paths.y + paths.h / 2,
    });
    await expect(floating(page)).toHaveText('');
    await expect(docked(page)).toHaveText('channels paths layers');
  });

  test('a floating tab moves by its top band without docking', async ({ page }) => {
    await openFixed(page);
    await tearOut(page, 'paths', { x: 0.2, y: 0.2 });
    const before = await settledBox(page.getByTestId('palette-paths'));

    await drag(
      page,
      { x: before.x + 60, y: before.y + 10 },
      { x: before.x + 160, y: before.y + 70 },
    );

    await expect(floating(page)).toHaveText('paths');
    const want = { x: before.x + 100, y: before.y + 60 };
    await expect.poll(() => drift(page, 'palette-paths', want)).toBeLessThan(0.5);
  });
});
