import { expect, type Page, test } from '@playwright/test';
import { boxOf, centerOf, openStory, settledBox } from './fixtures.js';

/**
 * The three affordance knobs are each observable only through the input device
 * they serve — the pad through a pointer box, the step through an arrow key,
 * the stops through `Tab` — so none of them can be asserted without a browser.
 */

const STORY = 'affordance-tuning--tuning';
const OVERLAY_STORY = 'affordance-tuning--layout-overlay';

const GUTTER_W = 4;

const seam = (page: Page, after: string) =>
  page.locator(`[data-affordance-hit="resize-x-${after}"]`);
const line = (page: Page, after: string) => page.locator(`[data-affordance="resize-x-${after}"]`);

async function valueNow(page: Page, after: string): Promise<number> {
  return Number(await seam(page, after).getAttribute('aria-valuenow'));
}

test.describe('affordanceHitPad', () => {
  test('widens the grab area and leaves the drawn line where it was', async ({ page }) => {
    await openStory(page, STORY);
    const narrow = await settledBox(seam(page, 'left'));
    const drawn = await settledBox(line(page, 'left'));
    expect(Math.round(narrow.w)).toBe(GUTTER_W + 2 * 4);

    await page.getByTestId('hit-pad').fill('16');
    await expect
      .poll(async () => Math.round((await boxOf(seam(page, 'left'))).w))
      .toBe(GUTTER_W + 2 * 16);

    // The visible gutter is the inner element, so it must not have moved or
    // grown with the hit area.
    const drawnAfter = await settledBox(line(page, 'left'));
    expect(Math.round(drawnAfter.w)).toBe(Math.round(drawn.w));
    expect(Math.round(drawnAfter.x)).toBe(Math.round(drawn.x));
  });

  test('the widened area takes a press the 4px line would have missed', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('hit-pad').fill('16');
    const box = await settledBox(seam(page, 'left'));
    const before = await valueNow(page, 'left');

    // 10px off the gutter's centre: inside the 16px pad, outside the default 4.
    await page.mouse.move(box.x + box.w / 2 - 10, centerOf(box).y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w / 2 - 10 + 40, centerOf(box).y, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => valueNow(page, 'left')).toBeGreaterThan(before);
  });
});

test.describe('affordanceKeyStep', () => {
  test('an arrow key moves the seam by the configured step', async ({ page }) => {
    await openStory(page, STORY);
    await seam(page, 'left').focus();
    const before = await valueNow(page, 'left');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => valueNow(page, 'left')).toBe(before + 8);

    await page.getByTestId('key-step').fill('32');
    await seam(page, 'left').focus();
    const mid = await valueNow(page, 'left');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => valueNow(page, 'left')).toBe(mid + 32);
  });

  test('Home and End ignore the step and jump to the reported bounds', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('key-step').fill('32');
    await seam(page, 'left').focus();
    const max = Number(await seam(page, 'left').getAttribute('aria-valuemax'));
    await page.keyboard.press('End');
    await expect.poll(() => valueNow(page, 'left')).toBe(max);
  });
});

test.describe('affordanceTabStops', () => {
  const focusedIsSeam = (page: Page) =>
    page.evaluate(() => document.activeElement?.hasAttribute('data-affordance-hit') ?? false);

  test('on by default, so Tab reaches the seams', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('before-seams').focus();
    await page.keyboard.press('Tab');
    expect(await focusedIsSeam(page)).toBe(true);
  });

  test('off drops the stops and keeps the ARIA', async ({ page }) => {
    await openStory(page, STORY);
    await page.getByTestId('tab-stops').uncheck();
    await expect(seam(page, 'left')).not.toHaveAttribute('tabindex');

    await page.getByTestId('before-seams').focus();
    await page.keyboard.press('Tab');
    expect(await focusedIsSeam(page)).toBe(false);

    // A screen reader still finds it: the stop is gone, the slider is not.
    await expect(seam(page, 'left')).toHaveAttribute('role', 'separator');
    await expect(seam(page, 'left')).toHaveAttribute('aria-orientation', 'horizontal');
    expect(await valueNow(page, 'left')).toBeGreaterThan(0);
  });
});

test.describe('overlay', () => {
  test('reports the layout that ran and names the seam under the pointer', async ({ page }) => {
    await openStory(page, OVERLAY_STORY);
    const status = page.getByTestId('overlay-status');
    await expect(status).toHaveText(/640×180 · 2 seams · idle/);

    const pane = await settledBox(page.locator('[data-node="left"]'));
    await expect(page.getByTestId('tag-left')).toHaveText(
      `${Math.round(pane.w)}×${Math.round(pane.h)}`,
    );

    const box = await settledBox(seam(page, 'left'));
    const from = centerOf(box);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y, { steps: 8 });
    await expect(status).toHaveText(/resize-x-left/);

    await page.mouse.up();
    await expect(status).toHaveText(/idle/);
    // The overlay re-ran on the new layout rather than holding the old sizes.
    const grown = await settledBox(page.locator('[data-node="left"]'));
    await expect(page.getByTestId('tag-left')).toHaveText(
      `${Math.round(grown.w)}×${Math.round(grown.h)}`,
    );
  });
});
