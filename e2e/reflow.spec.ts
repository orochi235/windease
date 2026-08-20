import { expect, test } from '@playwright/test';
import { openStory, settledWidth } from './fixtures.js';

/**
 * The Playground's canvas is flex-sized and its Container measures a ref, so
 * this is the fixture that exercises the ResizeObserver path. The split story
 * cannot: it passes an explicit `viewport` prop and never observes anything.
 */
test.describe('ResizeObserver-driven relayout', () => {
  test('shrinking the window reflows placements', async ({ page }) => {
    await openStory(page, 'playground--playground');
    const main = page.locator('[data-node="main"]');
    const wide = await settledWidth(main);

    await page.setViewportSize({ width: 760, height: 800 });

    await expect.poll(async () => settledWidth(main)).toBeLessThan(wide);
  });

  test('growing it back restores the wider placement exactly', async ({ page }) => {
    await openStory(page, 'playground--playground');
    const main = page.locator('[data-node="main"]');
    const original = await settledWidth(main);

    await page.setViewportSize({ width: 760, height: 800 });
    await expect.poll(async () => settledWidth(main)).toBeLessThan(original);

    await page.setViewportSize({ width: 1200, height: 800 });
    await expect.poll(async () => settledWidth(main)).toBe(original);
  });

  test('nested containers reflow with their parent', async ({ page }) => {
    await openStory(page, 'playground--playground');
    // `panel-1` lives in `main`, which lives in `root` — a two-level chain,
    // each level measuring its own element.
    const panel = page.locator('[data-node="panel-1"]');
    const wide = await settledWidth(panel);

    await page.setViewportSize({ width: 760, height: 800 });

    await expect.poll(async () => settledWidth(panel)).toBeLessThan(wide);
  });
});
