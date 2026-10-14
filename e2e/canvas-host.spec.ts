import { expect, type Page, test } from '@playwright/test';
import { centerOf, openStory, settledBox } from './fixtures.js';

const STORY = 'canvas-host--focus-proxies-over-a-canvas';
const proxy = (page: Page, name: string) => page.locator(`[data-node="view-${name}"]`);
const scene = (page: Page) => page.getByTestId('scene');

test.describe('a canvas host with focus proxies', () => {
  test('each tile has a named, focusable proxy over where the canvas paints it', async ({
    page,
  }) => {
    await openStory(page, STORY);
    await expect(proxy(page, 'top')).toHaveAttribute('role', 'group');
    await expect(proxy(page, 'top')).toHaveAttribute('aria-label', 'Top');
    const top = await settledBox(proxy(page, 'top'));
    const side = await settledBox(proxy(page, 'side'));
    // Second row, first column: one 138px row and an 8px gap below the first.
    expect(Math.round(side.x - top.x)).toBe(0);
    expect(Math.round(side.y - top.y)).toBe(146);
    expect(Math.round(side.w)).toBe(288);
  });

  test('the arrow keys move focus between tiles and the canvas follows', async ({ page }) => {
    await openStory(page, STORY);
    await proxy(page, 'top').focus();
    await expect(scene(page)).toHaveAttribute('data-focused', 'view-top');
    await page.keyboard.press('ArrowRight');
    await expect(scene(page)).toHaveAttribute('data-focused', 'view-front');
    await page.keyboard.press('ArrowDown');
    await expect(scene(page)).toHaveAttribute('data-focused', 'view-camera');
    await expect(proxy(page, 'camera')).toBeFocused();
  });

  test('a click on the canvas focuses the tile under it', async ({ page }) => {
    await openStory(page, STORY);
    const at = centerOf(await settledBox(proxy(page, 'side')));
    await page.mouse.click(at.x, at.y);
    await expect(scene(page)).toHaveAttribute('data-focused', 'view-side');
  });
});
